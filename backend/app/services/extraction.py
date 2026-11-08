"""AI knowledge extraction: LLM-backed, provenance-verified, failure-tolerant.

Every persisted claim must point at verbatim quotes that are checked against
the chunk text; unverifiable evidence is dropped rather than trusted. A provider
hiccup marks the run skipped — it never fails the surrounding document job.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import (
    Document,
    EvidenceChunk,
    KnowledgeEvidence,
    KnowledgeItem,
    KnowledgeRelationship,
)
from app.domain.enums import EvidenceStatus, KnowledgeType, RelationshipType, ReviewState
from app.services.llm import LLMError, chat_json

log = logging.getLogger("projectpulse.extract")

WINDOW_CHARS = 6_000
QUOTE_MAX = 300
DESCRIPTION_MAX = 4000
_UNVERIFIABLE = {EvidenceStatus.SUPPORTED, EvidenceStatus.INFERRED, EvidenceStatus.CONFLICTING}

# Compact on purpose: a longer rule-heavy prompt pushes nemotron into
# unbounded reasoning (it burns the whole token budget, never emits content,
# and attempt 2 then times out). Keep the contract tight here and let
# _build_draft / _resolve_relationship validate everything strictly.
SYSTEM_PROMPT = """You are ProjectPulse's extraction engine. Read the numbered chunks and reply with ONLY one JSON object {"items":[...],"relationships":[...]} — no prose, no narrative.

Item: {"type":"decision|task|risk|dependency|person|gap|question|contact","title":"<=90 chars specific","description":"1-3 sentences","attributes":{natural named fields for the type such as owner, due_date, severity, rationale, name, channel},"reasoning":"string if evidence_status is inferred else null","evidence_status":"supported|inferred|conflicting|missing","evidence":[{"chunk_seq":N,"quote":"verbatim from chunk N, <=300 chars"}]}

Relationship: {"src_title":"title of an item","dst_title":"title of an item","rel_type":"owns|assigned_to|depends_on|blocks|decided_by|supports|supersedes|mentioned_in|resolved_by|related_to","label":"<=100 chars or null","evidence_status":"supported|inferred|conflicting|missing"}

Extract only what the chunks state; never invent facts or quotes. supported=explicit quote; inferred=implied, add reasoning and quote; conflicting=quote both sides; missing=flagged absence. Each supported/inferred/conflicting item needs a quote except type "gap". Prefer fewer well-evidenced items. Nothing to extract? {"items":[],"relationships":[]}"""


@dataclass
class ExtractionStats:
    items_created: int = 0
    relationships_created: int = 0
    evidences_created: int = 0
    skipped: bool = False
    reason: str = ""
    demo_mode: bool = False


@dataclass
class _Draft:
    """A validated item candidate before it is matched to a graph node."""
    type: str
    title: str
    description: str
    reasoning: str | None
    attributes: dict
    evidence_status: str
    evidences: list[tuple[EvidenceChunk, str]]


def _normalize_ws(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _quote_hash(quote: str) -> str:
    return hashlib.sha1(quote.encode("utf-8")).hexdigest()[:40]


def _as_list(value: object) -> list:
    return value if isinstance(value, list) else []


def _evidence_status(value: object) -> EvidenceStatus:
    try:
        return EvidenceStatus(str(value).lower())
    except ValueError:
        return EvidenceStatus.MISSING


def _word_trim(value: str, floor: int = 20) -> str:
    if len(value) <= floor:
        return value
    cut = value.rfind(" ")
    return value[:cut] if cut >= floor else value


def _resolve_evidence(
    entry: object,
    chunks: list[EvidenceChunk],
    chunk_by_seq: dict[int, EvidenceChunk],
    norm_texts: dict[int, str],
) -> tuple[EvidenceChunk, str] | None:
    if not isinstance(entry, dict):
        return None
    try:
        seq = int(entry.get("chunk_seq"))
    except (TypeError, ValueError):
        return None
    raw_quote = entry.get("quote")
    if not isinstance(raw_quote, str):
        return None
    quote = _normalize_ws(raw_quote)
    if not quote:
        return None

    target = chunk_by_seq.get(seq)
    if target is not None and quote in norm_texts[seq]:
        return target, quote[:QUOTE_MAX]

    # the model occasionally mis-numbers chunks: fall back to locating the
    # quote's opening words anywhere in the document
    probe = _word_trim(quote[:60], floor=12)
    if len(probe) >= 12:
        for chunk in chunks:
            body = norm_texts[chunk.seq]
            if probe in body:
                verified = quote if quote in body else probe
                return chunk, verified[:QUOTE_MAX]
    return None


def _build_draft(
    raw: object,
    chunks: list[EvidenceChunk],
    chunk_by_seq: dict[int, EvidenceChunk],
    norm_texts: dict[int, str],
) -> _Draft | None:
    if not isinstance(raw, dict):
        return None
    try:
        item_type = KnowledgeType(str(raw.get("type", "")).lower())
    except ValueError:
        log.info("Dropping item with unknown type %r", raw.get("type"))
        return None
    title = _normalize_ws(str(raw.get("title") or ""))[:90]
    if not title:
        return None

    status = _evidence_status(raw.get("evidence_status"))
    evidences: list[tuple[EvidenceChunk, str]] = []
    seen: set[tuple[uuid.UUID, str]] = set()
    for entry in _as_list(raw.get("evidence")):
        resolved = _resolve_evidence(entry, chunks, chunk_by_seq, norm_texts)
        if resolved is None:
            continue
        chunk, quote = resolved
        key = (chunk.id, _quote_hash(quote))
        if key in seen:
            continue
        seen.add(key)
        evidences.append((chunk, quote))

    if not evidences and status in _UNVERIFIABLE and item_type != KnowledgeType.GAP:
        log.info("Dropping item without verified evidence: %r", title)
        return None

    raw_attributes = raw.get("attributes")
    return _Draft(
        type=item_type.value,
        title=title,
        description=str(raw.get("description") or "")[:DESCRIPTION_MAX],
        reasoning=(
            (_normalize_ws(str(raw.get("reasoning") or "")) or None)
            if status == EvidenceStatus.INFERRED
            else None
        ),
        attributes=raw_attributes if isinstance(raw_attributes, dict) else {},
        evidence_status=status.value,
        evidences=evidences,
    )


def _windows(chunks: list[EvidenceChunk]) -> list[list[EvidenceChunk]]:
    windows: list[list[EvidenceChunk]] = []
    current: list[EvidenceChunk] = []
    size = 0
    for chunk in chunks:
        if current and size + len(chunk.text) > WINDOW_CHARS:
            windows.append(current)
            current, size = [], 0
        current.append(chunk)
        size += len(chunk.text)
    if current:
        windows.append(current)
    return windows


def _user_message(document: Document, window: list[EvidenceChunk]) -> str:
    lines = [
        f'Extract structured knowledge from the document "{document.original_name}".',
        "Return only the JSON object described in your system instructions.",
        "",
    ]
    for chunk in window:
        page = f"p. {chunk.page_number}" if chunk.page_number is not None else "p. -"
        lines.append(f"[chunk {chunk.seq}] ({page} | {chunk.section or '-'})")
        lines.append(chunk.text)
        lines.append("")
    return "\n".join(lines)


def _attach_evidence(
    db: Session,
    item_id: uuid.UUID,
    confidence: str,
    evidences: list[tuple[EvidenceChunk, str]],
    attached: set[tuple[uuid.UUID, uuid.UUID, str]],
) -> int:
    created = 0
    for chunk, quote in evidences:
        quote_hash = _quote_hash(quote)
        key = (item_id, chunk.id, quote_hash)
        if key in attached:
            continue
        # autoflush is off: pending adds are invisible to this SELECT, so the
        # in-memory `attached` set is the within-run dedupe and the query
        # only guards against evidence committed by a previous run
        existing = db.scalar(
            select(KnowledgeEvidence.id).where(
                KnowledgeEvidence.item_id == item_id,
                KnowledgeEvidence.chunk_id == chunk.id,
                KnowledgeEvidence.quote_hash == quote_hash,
            )
        )
        if existing is not None:
            attached.add(key)
            continue
        db.add(
            KnowledgeEvidence(
                item_id=item_id,
                chunk_id=chunk.id,
                document_id=chunk.document_id,
                quote=quote,
                quote_hash=quote_hash,
                page_number=chunk.page_number,
                section=chunk.section,
                confidence=confidence,
            )
        )
        attached.add(key)
        created += 1
    return created


def _resolve_relationship(
    raw: object, title_ids: dict[str, uuid.UUID]
) -> tuple[uuid.UUID, uuid.UUID, str, str | None, EvidenceStatus] | None:
    if not isinstance(raw, dict):
        return None
    try:
        rel_type = RelationshipType(str(raw.get("rel_type", "")).lower())
    except ValueError:
        log.info("Dropping relationship with unknown type %r", raw.get("rel_type"))
        return None
    src = title_ids.get(_normalize_ws(str(raw.get("src_title") or "")).casefold())
    dst = title_ids.get(_normalize_ws(str(raw.get("dst_title") or "")).casefold())
    if src is None or dst is None or src == dst:
        return None
    label = _normalize_ws(str(raw.get("label") or ""))[:100] or None
    return src, dst, rel_type.value, label, _evidence_status(raw.get("evidence_status"))


async def extract_from_document(
    db: Session, document: Document, *, run_id: str | None = None
) -> ExtractionStats:
    """Extract structured knowledge + evidence links for one document."""
    settings = get_settings()
    run = run_id or f"run_{uuid.uuid4().hex[:8]}"

    chunks = list(
        db.scalars(
            select(EvidenceChunk)
            .where(EvidenceChunk.document_id == document.id)
            .order_by(EvidenceChunk.seq)
        ).all()
    )
    if not chunks:
        return ExtractionStats(skipped=True, reason="No text chunks to extract from.")

    raw_items: list[object] = []
    raw_relationships: list[object] = []
    demo_seen = False
    failed_windows = 0
    last_error = ""
    for window in _windows(chunks):
        # explicit budget: reasoning models otherwise burn the default
        # 4096 tokens on reasoning and return no JSON payload
        try:
            payload = await chat_json(
                [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": _user_message(document, window)},
                ],
                max_tokens=8192,
            )
        except (LLMError, json.JSONDecodeError) as exc:
            # one flaky window must not sink the whole extraction
            failed_windows += 1
            last_error = str(exc)
            log.warning(
                "Extraction window %s failed for document %s: %s",
                failed_windows, document.id, exc,
            )
            continue
        if payload.get("demo") is True:
            demo_seen = True
            continue
        raw_items.extend(_as_list(payload.get("items")))
        raw_relationships.extend(_as_list(payload.get("relationships")))
    if failed_windows and not raw_items and not raw_relationships:
        log.warning("Extraction LLM failure for document %s: %s", document.id, last_error)
        return ExtractionStats(
            skipped=True, reason=last_error[:300],
            demo_mode=settings.demo_sample_mode,
        )

    stats = ExtractionStats(demo_mode=settings.demo_sample_mode or demo_seen)
    if failed_windows:
        stats.reason = (
            f"{failed_windows} window(s) failed, using partial results: {last_error[:200]}"
        )

    chunk_by_seq = {chunk.seq: chunk for chunk in chunks}
    norm_texts = {chunk.seq: _normalize_ws(chunk.text) for chunk in chunks}

    # project-wide claim index: identical (type, title) claims share one node
    # so reprocessing a document enriches it instead of duplicating the graph
    claims: dict[tuple[str, str], tuple[uuid.UUID, str]] = {}
    title_ids: dict[str, uuid.UUID] = {}
    for item_id, item_type, title, item_status in db.execute(
        select(
            KnowledgeItem.id, KnowledgeItem.type, KnowledgeItem.title,
            KnowledgeItem.evidence_status,
        ).where(KnowledgeItem.project_id == document.project_id)
    ).all():
        key = (item_type, _normalize_ws(title).casefold())
        claims.setdefault(key, (item_id, item_status))
        title_ids.setdefault(_normalize_ws(title).casefold(), item_id)
    existing_edges = {
        (src, dst, rel)
        for src, dst, rel in db.execute(
            select(
                KnowledgeRelationship.src_item_id,
                KnowledgeRelationship.dst_item_id,
                KnowledgeRelationship.rel_type,
            ).where(KnowledgeRelationship.project_id == document.project_id)
        ).all()
    }

    counted: set[tuple[str, str]] = set()
    attached: set[tuple[uuid.UUID, uuid.UUID, str]] = set()
    for raw in raw_items:
        draft = _build_draft(raw, chunks, chunk_by_seq, norm_texts)
        if draft is None:
            continue
        key = (draft.type, _normalize_ws(draft.title).casefold())
        target = claims.get(key)
        if target is None:
            item = KnowledgeItem(
                project_id=document.project_id,
                type=draft.type,
                title=draft.title,
                description=draft.description,
                reasoning=draft.reasoning,
                attributes=draft.attributes,
                evidence_status=draft.evidence_status,
                review_state=ReviewState.PENDING.value,
                access_scope=document.access_scope,
                subject_user_id=None,
                source_document_id=document.id,
                extraction_run=run,
                is_sample=False,
            )
            db.add(item)
            db.flush()
            target = (item.id, item.evidence_status)
            claims[key] = target
            title_ids.setdefault(_normalize_ws(draft.title).casefold(), item.id)
        if key not in counted:
            counted.add(key)
            stats.items_created += 1
        stats.evidences_created += _attach_evidence(
            db, target[0], target[1], draft.evidences, attached
        )

    for raw in raw_relationships:
        resolved = _resolve_relationship(raw, title_ids)
        if resolved is None:
            continue
        src, dst, rel_type, label, status = resolved
        edge = (src, dst, rel_type)
        if edge in existing_edges:
            continue
        existing_edges.add(edge)
        db.add(
            KnowledgeRelationship(
                project_id=document.project_id,
                src_item_id=src,
                dst_item_id=dst,
                rel_type=rel_type,
                label=label,
                evidence_status=status.value,
                is_sample=False,
            )
        )
        stats.relationships_created += 1

    db.commit()
    log.info(
        "Extraction for document %s: %s items, %s relationships, %s evidence links%s",
        document.id, stats.items_created, stats.relationships_created,
        stats.evidences_created, " (demo)" if stats.demo_mode else "",
    )
    return stats


__all__ = ["ExtractionStats", "extract_from_document"]
