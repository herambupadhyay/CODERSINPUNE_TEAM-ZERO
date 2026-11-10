"""Handover report generation: impact analysis + LLM/deterministic authoring.

Generation is all-or-nothing: the LLM (or demo path) builds sections/findings
in memory first; only then are existing rows replaced and committed.
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.base import utcnow
from app.db.models import (
    Document,
    EvidenceChunk,
    Handover,
    HandoverFinding,
    HandoverSection,
    KnowledgeEvidence,
    KnowledgeItem,
    KnowledgeRelationship,
    Project,
    User,
)
from app.domain.enums import (
    EvidenceStatus,
    KnowledgeType,
    RelationshipType,
    ReviewState,
)
from app.schemas.handover import HANDOVER_CATEGORIES
from app.services.llm import LLMError, chat

log = logging.getLogger("projectpulse.handover_gen")

SECTION_TITLES: dict[str, str] = {
    "overview": "Overview of the transfer",
    "responsibilities": "Responsibilities transferring",
    "decisions": "Decisions made",
    "tasks": "Open tasks & priorities",
    "risks": "Risks & watch items",
    "contacts": "Key contacts",
    "systems": "Systems & access",
    "documents": "Documents to know",
    "next_steps": "Next steps before departure",
}

# Knowledge item type -> report section that should surface it as a finding.
_TYPE_SECTION: dict[str, str] = {
    "task": "tasks",
    "decision": "decisions",
    "risk": "risks",
    "person": "contacts",
    "contact": "contacts",
    "dependency": "systems",
    "gap": "next_steps",
    "question": "next_steps",
}

_EVIDENCE_RANK = {
    EvidenceStatus.SUPPORTED: 0,
    EvidenceStatus.INFERRED: 1,
    EvidenceStatus.CONFLICTING: 2,
    EvidenceStatus.MISSING: 3,
}

_MAX_EVIDENCE_REFS = 40

_SYSTEM_PROMPT = (
    "You are ProjectPulse's handover editor. "
    "Respond with ONLY a raw JSON object — no markdown fences, no prose.\n"
    'Schema: {"sections":[{"key","title","body"}],'
    '"findings":[{"section_key","label","content","evidence_status","evidence_refs"}],'
    '"summary":"2-3 sentences"}\n'
    "- body: markdown paragraphs + \"- \" bullets, 2-6 sentences per section.\n"
    "- Every requested category key must appear as a section (use title hints).\n"
    "- Cover only authorised facts from the context; never invent names or dates.\n"
    "- findings: specific claims (who owns what, open items, conflicts, gaps).\n"
    "- evidence_status: supported (>=1 supporting ref), conflicting (refs disagree), "
    "missing only for genuinely absent info with evidence_refs [].\n"
    "- evidence_refs: only E-numbers from the provided list.\n"
    "- section_key must be one of the requested categories."
)


def _parse_json_object(content: str) -> dict:
    """Parse a JSON object from model output, tolerating fences/prose around it."""
    text = (content or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
    # last resort: first balanced {...} block
    start = text.find("{")
    if start >= 0:
        depth = 0
        for i in range(start, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    try:
                        parsed = json.loads(text[start : i + 1])
                        if isinstance(parsed, dict):
                            return parsed
                    except json.JSONDecodeError:
                        break
    raise LLMError("Model did not return a JSON object.")


# ---------------------------------------------------------------------------
# Impact analysis (read-only, shared by the endpoint and generate)
# ---------------------------------------------------------------------------

def compute_impact(db: Session, project: Project, departing_user_id: uuid.UUID) -> dict:
    """Departure impact snapshot — pure SQL, no LLM."""
    departing = db.get(User, departing_user_id)
    name = ((departing.name if departing else "") or "").strip().lower()

    items = db.scalars(
        select(KnowledgeItem).where(
            KnowledgeItem.project_id == project.id,
            KnowledgeItem.review_state != ReviewState.REJECTED,
        )
    ).all()

    person_items = [
        i for i in items
        if i.type == KnowledgeType.PERSON and i.subject_user_id == departing_user_id
    ]
    person_ids = [i.id for i in person_items]

    owned_ids: set[uuid.UUID] = set()
    if person_ids:
        rows = db.execute(
            select(KnowledgeRelationship.dst_item_id).where(
                KnowledgeRelationship.project_id == project.id,
                KnowledgeRelationship.src_item_id.in_(person_ids),
                KnowledgeRelationship.rel_type == RelationshipType.OWNS,
            )
        ).all()
        owned_ids = {r[0] for r in rows}

    def _name_in(value) -> bool:
        if not name or not isinstance(value, str):
            return False
        return name in value.lower()

    def _subject_or_name(item: KnowledgeItem, *attr_keys: str) -> bool:
        if item.subject_user_id == departing_user_id:
            return True
        attrs = item.attributes if isinstance(item.attributes, dict) else {}
        return any(_name_in(attrs.get(k)) for k in attr_keys)

    open_tasks = [
        i for i in items
        if i.type == KnowledgeType.TASK
        and (_subject_or_name(i, "owner") or i.id in owned_ids)
    ]
    decisions = [
        i for i in items
        if i.type == KnowledgeType.DECISION
        and _subject_or_name(i, "decided_by", "decidedBy")
    ]

    documents_uploaded = db.scalar(
        select(func.count(Document.id)).where(
            Document.project_id == project.id,
            Document.uploaded_by == departing_user_id,
        )
    ) or 0

    unresolved = [
        i for i in items
        if i.subject_user_id == departing_user_id
        and i.review_state == ReviewState.PENDING
    ]

    gaps = db.scalar(
        select(func.count(KnowledgeItem.id)).where(
            KnowledgeItem.project_id == project.id,
            KnowledgeItem.type == KnowledgeType.GAP,
        )
    ) or 0

    owned_items = [
        i for i in items
        if i.id in owned_ids and i.review_state != ReviewState.REJECTED
    ]

    items_out: list[dict] = []
    seen: set[uuid.UUID] = set()
    for i in [*open_tasks, *owned_items]:
        if i.id in seen:
            continue
        seen.add(i.id)
        attrs = i.attributes if isinstance(i.attributes, dict) else {}
        status = attrs.get("status") or i.review_state
        items_out.append({"label": i.title, "type": i.type, "status": str(status)})
        if len(items_out) >= 20:
            break

    return {
        "departing_user_id": str(departing_user_id),
        "open_tasks": len(open_tasks),
        "decisions": len(decisions),
        "owned_systems": len(owned_items),
        "documents_uploaded": int(documents_uploaded),
        "unresolved_items": len(unresolved),
        "gaps": int(gaps),
        "items": items_out,
    }


# ---------------------------------------------------------------------------
# Evidence collection
# ---------------------------------------------------------------------------

def _evidence_catalog(
    db: Session, project: Project, departing_user_id: uuid.UUID | None
) -> tuple[dict[str, dict], dict[uuid.UUID, list[dict]]]:
    """Numbered E-refs for the LLM (capped) + full per-item EvidenceRef lists."""
    rows = db.execute(
        select(KnowledgeEvidence, KnowledgeItem, EvidenceChunk, Document)
        .join(KnowledgeItem, KnowledgeItem.id == KnowledgeEvidence.item_id)
        .join(EvidenceChunk, EvidenceChunk.id == KnowledgeEvidence.chunk_id)
        .join(Document, Document.id == KnowledgeEvidence.document_id)
        .where(
            KnowledgeItem.project_id == project.id,
            KnowledgeItem.review_state != ReviewState.REJECTED,
        )
    ).all()

    def sort_key(row):
        ev, item, _chunk, _doc = row
        first = 0 if (
            departing_user_id is not None and item.subject_user_id == departing_user_id
        ) else 1
        return (first, _EVIDENCE_RANK.get(item.evidence_status, 4))

    rows.sort(key=sort_key)

    e_map: dict[str, dict] = {}
    by_item: dict[uuid.UUID, list[dict]] = defaultdict(list)

    for idx, (ev, item, chunk, doc) in enumerate(rows, start=1):
        info = {
            "item_id": item.id,
            "item": item.title,
            "item_type": item.type,
            "document_id": ev.document_id,
            "document": doc.original_name,
            "chunk_id": str(ev.chunk_id),
            "quote": (ev.quote or "")[:300],
            "page_number": ev.page_number if ev.page_number is not None else chunk.page_number,
            "section": ev.section or chunk.section,
        }
        if idx <= _MAX_EVIDENCE_REFS:
            e_map[f"E{idx}"] = info
        by_item[item.id].append(info)

    return e_map, by_item


def _ref_dict(info: dict, position: int) -> dict:
    chunk_id = info["chunk_id"]
    # JSONB cannot encode uuid.UUID — store strings; Pydantic coerces on output
    if isinstance(chunk_id, uuid.UUID):
        chunk_id = str(chunk_id)
    doc_id = info["document_id"]
    if isinstance(doc_id, uuid.UUID):
        doc_id = str(doc_id)
    return {
        "document_id": doc_id,
        "document_name": info["document"],
        "chunk_id": chunk_id,
        "quote": info["quote"],
        "page_number": info["page_number"],
        "section": info["section"],
        "label": (info["item"] or "")[:255],
        "position": position,
    }


# ---------------------------------------------------------------------------
# Deterministic (demo / no-LLM) authoring
# ---------------------------------------------------------------------------

def _items_for_sections(
    items: list[KnowledgeItem],
    categories: list[str],
    owned_ids: set[uuid.UUID],
) -> dict[str, list[KnowledgeItem]]:
    grouped: dict[str, list[KnowledgeItem]] = defaultdict(list)
    for item in items:
        key = _TYPE_SECTION.get(item.type)
        if key and key in categories:
            grouped[key].append(item)
        # owned systems (owns-edge targets) also surface under systems
        if item.id in owned_ids and "systems" in categories and item not in grouped.get("systems", []):
            grouped["systems"].append(item)
    return grouped


def _deterministic_body(key: str, section_items: list[KnowledgeItem]) -> str:
    if not section_items:
        return f"No documented {key} yet — flagged as a gap for review."
    lines = [f"{len(section_items)} documented item(s) for {key}:"]
    for it in section_items[:8]:
        desc = (it.description or "").strip()
        if len(desc) > 160:
            desc = desc[:157] + "…"
        lines.append(f"- **{it.title}**" + (f" — {desc}" if desc else ""))
    return "\n".join(lines)


def _fallback_content(item: KnowledgeItem) -> str:
    parts: list[str] = []
    if item.description and item.description.strip():
        parts.append(item.description.strip())
    attrs = item.attributes if isinstance(item.attributes, dict) else {}
    for k in ("owner", "status", "due", "due_date", "system", "impact"):
        v = attrs.get(k)
        if v:
            parts.append(f"{k}: {v}")
    if not parts and item.reasoning:
        parts.append(item.reasoning.strip())
    if not parts:
        parts.append(item.title)
    return " — ".join(parts)


def _fallback_finding(
    key: str,
    item: KnowledgeItem,
    by_item: dict[uuid.UUID, list[dict]],
    position: int,
) -> dict:
    infos = by_item.get(item.id, [])
    refs = [_ref_dict(info, n) for n, info in enumerate(infos)]
    status = item.evidence_status
    if status not in _EVIDENCE_RANK:
        status = EvidenceStatus.SUPPORTED if refs else EvidenceStatus.MISSING
    label = f"{str(item.type).title()}: {item.title}"[:140]
    return {
        "section_key": key,
        "label": label,
        "content": _fallback_content(item),
        "evidence_status": status,
        "evidence": refs,
        "item_id": item.id,
        "position": position,
    }


def _owned_person_ids(
    db: Session, project: Project, items: list[KnowledgeItem]
) -> set[uuid.UUID]:
    person_ids = [
        i.id for i in items if i.type == KnowledgeType.PERSON
    ]
    if not person_ids:
        return set()
    rows = db.execute(
        select(KnowledgeRelationship.dst_item_id).where(
            KnowledgeRelationship.project_id == project.id,
            KnowledgeRelationship.src_item_id.in_(person_ids),
            KnowledgeRelationship.rel_type == RelationshipType.OWNS,
        )
    ).all()
    return {r[0] for r in rows}


# ---------------------------------------------------------------------------
# LLM path + resolution
# ---------------------------------------------------------------------------

def _digest(items: list[KnowledgeItem]) -> str:
    by_type: dict[str, list[KnowledgeItem]] = defaultdict(list)
    for it in items:
        by_type[str(it.type)].append(it)
    lines: list[str] = []
    for t in sorted(by_type):
        lines.append(f"[{t}]")
        for it in by_type[t][:20]:
            desc = (it.description or "").strip()
            if len(desc) > 160:
                desc = desc[:157] + "…"
            lines.append(f"- {it.title}" + (f" — {desc}" if desc else ""))
    return "\n".join(lines) or "(none)"


def _llm_user_message(
    handover: Handover,
    categories: list[str],
    items: list[KnowledgeItem],
    e_map: dict[str, dict],
    departing_name: str | None,
    successor_name: str | None,
) -> str:
    refs = "\n".join(
        f'{rid}: "{info["quote"][:200]}" ({info["document"]})'
        for rid, info in e_map.items()
    ) or "(none)"
    return (
        f"Departing: {departing_name or 'unknown'}\n"
        f"Successor: {successor_name or 'TBD'}\n"
        f"Role: {handover.role_transferred}\n"
        f"Categories: {', '.join(categories)}\n"
        f"Section key hints: {', '.join(categories)}\n"
        f"Knowledge digest:\n{_digest(items)}\n"
        f"Evidence refs:\n{refs}"
    )


def _valid_status(value, refs: list) -> str:
    if isinstance(value, str) and value in _EVIDENCE_RANK:
        return value
    return EvidenceStatus.SUPPORTED if refs else EvidenceStatus.MISSING


def _resolve_llm_report(
    raw: dict,
    categories: list[str],
    e_map: dict[str, dict],
) -> tuple[list[dict], list[dict], str | None]:
    """Normalize LLM JSON into section/finding dicts safe to persist."""
    fallback_key = "next_steps" if "next_steps" in categories else categories[0]
    cat_set = set(categories)

    sections_out: list[dict] = []
    seen_keys: set[str] = set()
    raw_sections = raw.get("sections") if isinstance(raw.get("sections"), list) else []
    for i, sec in enumerate(raw_sections):
        if not isinstance(sec, dict):
            continue
        key = str(sec.get("key") or "").strip()
        if key not in cat_set:
            key = fallback_key if key else (categories[i % len(categories)])
        if key in seen_keys:
            continue
        seen_keys.add(key)
        title = str(sec.get("title") or SECTION_TITLES.get(key, key.replace("_", " ").title()))
        body = str(sec.get("body") or "")
        sections_out.append({"key": key, "title": title[:255], "body": body})

    findings_out: list[dict] = []
    raw_findings = raw.get("findings") if isinstance(raw.get("findings"), list) else []
    for f in raw_findings:
        if not isinstance(f, dict):
            continue
        content = str(f.get("content") or "").strip()
        if not content:
            continue
        key = str(f.get("section_key") or "").strip()
        if key not in cat_set:
            key = fallback_key
        refs: list[dict] = []
        raw_refs = f.get("evidence_refs") if isinstance(f.get("evidence_refs"), list) else []
        for n, rid in enumerate(raw_refs):
            info = e_map.get(str(rid))
            if info:
                refs.append(_ref_dict(info, len(refs)))
        label = str(f.get("label") or content[:80]).strip()[:140] or key
        findings_out.append({
            "section_key": key,
            "label": label,
            "content": content,
            "evidence_status": _valid_status(f.get("evidence_status"), refs),
            "evidence": refs,
            "item_id": None,
            "position": len(findings_out),
        })

    summary = raw.get("summary")
    summary = summary.strip() if isinstance(summary, str) and summary.strip() else None
    return sections_out, findings_out, summary


def _ensure_sections(
    categories: list[str],
    sections_out: list[dict],
    grouped: dict[str, list[KnowledgeItem]],
) -> list[dict]:
    by_key = {s["key"]: s for s in sections_out}
    ordered: list[dict] = []
    for i, key in enumerate(categories):
        if key in by_key:
            sec = by_key[key]
        else:
            sec = {
                "key": key,
                "title": SECTION_TITLES.get(key, key.replace("_", " ").title()),
                "body": _deterministic_body(key, grouped.get(key, [])),
            }
        sec["position"] = i
        ordered.append(sec)
    # keep any extra LLM sections that matched categories but lost ordering above
    return ordered


def _ensure_findings(
    categories: list[str],
    findings_out: list[dict],
    grouped: dict[str, list[KnowledgeItem]],
    by_item: dict[uuid.UUID, list[dict]],
) -> list[dict]:
    """Guarantee >=1 finding per section that has knowledge items."""
    covered = {f["section_key"] for f in findings_out}
    extra: list[dict] = []
    for key in categories:
        if key in covered:
            continue
        for item in grouped.get(key, []):
            extra.append(_fallback_finding(key, item, by_item, 0))
    all_findings = findings_out + extra
    for i, f in enumerate(all_findings):
        f["position"] = i
    return all_findings


# ---------------------------------------------------------------------------
# Public entrypoint
# ---------------------------------------------------------------------------

async def generate_handover(
    db: Session, *, handover: Handover, project: Project, actor: User
) -> dict:
    """(Re)generate sections/findings for a handover. Commits on success."""
    categories = list((handover.scope or {}).get("categories") or HANDOVER_CATEGORIES)
    categories = [c for c in categories if c in HANDOVER_CATEGORIES] or list(HANDOVER_CATEGORIES)

    items = db.scalars(
        select(KnowledgeItem).where(
            KnowledgeItem.project_id == project.id,
            KnowledgeItem.review_state != ReviewState.REJECTED,
        )
    ).all()
    owned_ids = _owned_person_ids(db, project, items)
    grouped = _items_for_sections(items, categories, owned_ids)

    departing = db.get(User, handover.departing_user_id)
    successor = db.get(User, handover.successor_user_id) if handover.successor_user_id else None
    departing_name = departing.name if departing else None
    successor_name = successor.name if successor else None

    e_map, by_item = _evidence_catalog(db, project, handover.departing_user_id)

    settings = get_settings()
    model_name: str | None = None
    demo_mode = bool(settings.demo_sample_mode)
    raw: dict = {}

    try:
        # chat is imported into this module so tests can patch it directly.
        # Try strict JSON mode first; if the model still emits junk, retry
        # without response_format and parse leniently ourselves.
        try:
            result = await chat(
                [
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": _llm_user_message(
                            handover, categories, items, e_map, departing_name, successor_name
                        ),
                    },
                ],
                json_mode=True,
                temperature=0.1,
                max_tokens=4096,
            )
            raw = _parse_json_object(result.content)
            model_name = result.model or settings.llm_model
            demo_mode = bool(result.demo_mode)
        except LLMError:
            result = await chat(
                [
                    {"role": "system", "content": _SYSTEM_PROMPT + " Output raw JSON only."},
                    {
                        "role": "user",
                        "content": _llm_user_message(
                            handover, categories, items, e_map, departing_name, successor_name
                        ),
                    },
                ],
                json_mode=False,
                temperature=0.0,
                max_tokens=4096,
            )
            if result.demo_mode:
                raw = {}
                demo_mode = True
                model_name = "demo"
            else:
                raw = _parse_json_object(result.content)
                model_name = result.model or settings.llm_model
                demo_mode = False
        if raw.get("demo") is True or not isinstance(raw.get("sections"), list):
            raw = {}
            demo_mode = True
            model_name = "demo"
    except LLMError as exc:
        log.warning("Handover generation LLM failed: %s", exc)
        raw = {}
        demo_mode = True
        model_name = "demo"

    if raw:
        sections_out, findings_out, llm_summary = _resolve_llm_report(
            raw, categories, e_map
        )
    else:
        sections_out = []
        findings_out = []
        llm_summary = None
        demo_mode = True
        model_name = "demo"

    sections_out = _ensure_sections(categories, sections_out, grouped)
    findings_out = _ensure_findings(categories, findings_out, grouped, by_item)

    if not findings_out:
        # last resort: any knowledge at all becomes a finding somewhere
        for item in items[:5]:
            key = _TYPE_SECTION.get(item.type)
            if key and key in categories:
                findings_out.append(_fallback_finding(key, item, by_item, 0))
        for i, f in enumerate(findings_out):
            f["position"] = i

    # impact snapshot (same helper the /impact endpoint uses)
    impact = compute_impact(db, project, handover.departing_user_id)

    awaiting = sum(1 for _ in findings_out)  # all freshly created are PENDING
    if llm_summary:
        summary = llm_summary
    else:
        succ_label = successor_name or "an unassigned successor"
        summary = (
            f"{departing_name or 'A team member'} hands over "
            f"{handover.role_transferred} to {succ_label} — "
            f"{len(findings_out)} findings across {len(sections_out)} sections, "
            f"{awaiting} awaiting review."
        )

    # --- persist atomically: wipe previous generation, then insert ---------
    db.execute(
        delete(HandoverSection).where(HandoverSection.handover_id == handover.id)
    )
    db.execute(
        delete(HandoverFinding).where(HandoverFinding.handover_id == handover.id)
    )
    db.flush()
    # drop stale ORM state so relationship doesn't re-emit deleted rows
    handover.sections.clear()
    handover.findings.clear()

    for sec in sections_out:
        handover.sections.append(
            HandoverSection(
                id=uuid.uuid4(),
                handover_id=handover.id,
                key=sec["key"][:60],
                title=sec["title"][:255],
                body=sec["body"],
                position=int(sec.get("position", 0)),
                meta={},
            )
        )
    for f in findings_out:
        handover.findings.append(
            HandoverFinding(
                id=uuid.uuid4(),
                handover_id=handover.id,
                section_key=f["section_key"][:60],
                item_id=f.get("item_id"),
                label=f["label"][:140],
                content=f["content"],
                evidence_status=f["evidence_status"],
                review_state="pending",
                evidence=f["evidence"],
                position=int(f.get("position", 0)),
            )
        )

    handover.impact = impact
    handover.summary = summary
    handover.generation_meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model": model_name,
        "demo_mode": bool(demo_mode),
        "findings": len(findings_out),
        "evidence_refs": len(e_map),
        "sections": len(sections_out),
    }
    # status/version untouched — regeneration never advances the workflow

    db.commit()
    db.refresh(handover)

    return dict(handover.generation_meta)


__all__ = ["generate_handover", "compute_impact", "SECTION_TITLES"]
