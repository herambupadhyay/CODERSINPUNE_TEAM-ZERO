"""Assistant service: permission-filtered RAG + chat + citation capture."""
from __future__ import annotations

import logging
import re
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import ProjectContext
from app.db.base import utcnow
from app.db.models import Conversation, Message, MessageCitation
from app.schemas.assistant import AskIn, MessageOut
from app.schemas.common import OkResponse
from app.services import audit
from app.services.llm import chat
from app.services.permissions import NotFoundError
from app.services.rag import RetrievedChunk, retrieve

log = logging.getLogger("projectpulse.assistant")

_CITE_RE = re.compile(r"\[(\d+)\]")
_MAX_CITATIONS = 6
_HISTORY_LIMIT = 10
_SYSTEM_TMPL = (
    "You are ProjectPulse's assistant for {project}. "
    "Answer ONLY from the numbered source excerpts. "
    "Cite like [1] [2] after claims that come from them. "
    "If the excerpts don't contain the answer, say plainly that the authorised "
    "sources don't cover it and suggest what document might — never invent "
    "facts, names or dates. Be concise and concrete."
)
_EMPTY_ANSWER = "I couldn't produce an answer — please try again."
_NO_SOURCES = "No authorised sources matched this question."


def _context_blocks(chunks: list[RetrievedChunk]) -> list[str]:
    blocks: list[str] = []
    for n, c in enumerate(chunks, start=1):
        bits: list[str] = []
        if c.page_number is not None:
            bits.append(f"p.{c.page_number}")
        if c.section:
            bits.append(c.section)
        loc = f" ({', '.join(bits)})" if bits else ""
        text = c.text if len(c.text) <= 600 else c.text[:600] + "…"
        blocks.append(f'[{n}] "{c.document_name}"{loc}: {text}')
    return blocks


def _build_messages(
    project_name: str,
    question: str,
    chunks: list[RetrievedChunk],
    prior: list[Message],
) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = [
        {"role": "system", "content": _SYSTEM_TMPL.format(project=project_name)}
    ]
    for m in prior[-_HISTORY_LIMIT:]:
        content = (m.content or "").strip()
        if content and m.role in ("user", "assistant"):
            messages.append({"role": m.role, "content": content})

    blocks = _context_blocks(chunks)
    if blocks:
        user_content = (
            "Sources:\n" + "\n".join(blocks) + "\n\nQuestion: " + question
        )
    else:
        user_content = (
            "No sources are available for this question.\n\nQuestion: " + question
        )
    messages.append({"role": "user", "content": user_content})
    return messages


def _extract_citations(
    content: str, chunks: list[RetrievedChunk], message_id: uuid.UUID
) -> list[MessageCitation]:
    """Map [n] markers (first appearance, deduped) to retrieved chunks."""
    citations: list[MessageCitation] = []
    seen: set[int] = set()
    for match in _CITE_RE.finditer(content):
        n = int(match.group(1))
        if n in seen or n < 1 or n > len(chunks):
            continue
        seen.add(n)
        if len(citations) >= _MAX_CITATIONS:
            break
        c = chunks[n - 1]
        citations.append(
            MessageCitation(
                id=uuid.uuid4(),
                message_id=message_id,
                chunk_id=c.chunk_id,
                document_id=c.document_id,
                item_id=None,
                label=c.document_name[:255],
                quote=(c.text or "")[:400],
                page_number=c.page_number,
                position=len(citations),
            )
        )
    return citations


def _message_out(msg: Message, citations: list[MessageCitation]) -> MessageOut:
    # Build explicitly: Message.citations holds MessageCitation rows which are
    # not EvidenceRef — model_validate(msg) would try to coerce them.
    citation_dicts = [
        {
            "document_id": c.document_id,
            "document_name": c.label,
            "chunk_id": c.chunk_id,
            "quote": c.quote,
            "page_number": c.page_number,
            "section": None,
            "label": c.label,
            "position": c.position,
        }
        for c in sorted(citations, key=lambda x: x.position)
    ]
    return MessageOut.model_validate(
        {
            "id": msg.id,
            "conversation_id": msg.conversation_id,
            "role": msg.role,
            "content": msg.content,
            "meta": msg.meta or {},
            "error": msg.error,
            "created_at": msg.created_at,
            "citations": citation_dicts,
        }
    )


def _batch_citations(db: Session, message_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[MessageCitation]]:
    if not message_ids:
        return {}
    rows = db.scalars(
        select(MessageCitation)
        .where(MessageCitation.message_id.in_(message_ids))
        .order_by(MessageCitation.position)
    ).all()
    grouped: dict[uuid.UUID, list[MessageCitation]] = {}
    for c in rows:
        grouped.setdefault(c.message_id, []).append(c)
    return grouped


async def ask(db: Session, *, ctx: ProjectContext, payload: AskIn) -> dict:
    """One assistant turn: retrieve → chat → persist message + citations."""
    question = payload.message.strip()

    if payload.conversation_id is not None:
        conv = db.scalar(
            select(Conversation).where(
                Conversation.id == payload.conversation_id,
                Conversation.project_id == ctx.project.id,
                Conversation.user_id == ctx.user.id,
            )
        )
        if conv is None:
            raise NotFoundError("Conversation not found.")
    else:
        title = question[:58] + ("…" if len(question) > 58 else "")
        conv = Conversation(
            id=uuid.uuid4(),
            project_id=ctx.project.id,
            user_id=ctx.user.id,
            title=title or "New conversation",
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        db.add(conv)
        db.flush()

    user_msg = Message(
        id=uuid.uuid4(),
        conversation_id=conv.id,
        role="user",
        content=payload.message,
        meta={},
        created_at=utcnow(),
    )
    db.add(user_msg)
    db.flush()

    try:
        chunks = await retrieve(
            db,
            project_id=ctx.project.id,
            user=ctx.user,
            role=ctx.role,
            query=question,
            top_k=15,
        )
    except Exception:
        chunks = []
        log.exception("Semantic retrieval failed, returning empty chunks")

    prior = db.scalars(
        select(Message)
        .where(
            Message.conversation_id == conv.id,
            Message.id != user_msg.id,
        )
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(_HISTORY_LIMIT)
    ).all()
    prior = list(reversed(prior))

    messages = _build_messages(ctx.project.name, question, chunks, prior)
    try:
        result = await chat(
            messages, json_mode=False, temperature=0.2, max_tokens=1400
        )
    except LLMError as exc:
        log.warning("Assistant generation failed: %s", exc)
        result = None
        content = (
            "I couldn't produce an answer — the assistant is unavailable right now. "
            "Please try again in a moment."
        )
    if result is not None:
        content = (result.content or "").strip()
        if not content:
            content = _EMPTY_ANSWER

    meta: dict = {
        "retrieved_count": len(chunks),
        "model": result.model if result else None,
        "demo_mode": bool(result.demo_mode) if result else False,
        "scores": [round(c.score, 3) for c in chunks[:8]],
    }
    if not chunks:
        meta["uncertainty"] = _NO_SOURCES

    assistant_msg = Message(
        id=uuid.uuid4(),
        conversation_id=conv.id,
        role="assistant",
        content=content,
        meta=meta,
        created_at=utcnow(),
    )
    db.add(assistant_msg)
    db.flush()

    citations = _extract_citations(content, chunks, assistant_msg.id)
    for c in citations:
        db.add(c)

    conv.updated_at = utcnow()

    audit.record(
        db,
        action=audit.A.ASSISTANT_MESSAGE,
        actor_id=ctx.user.id,
        project_id=ctx.project.id,
        workspace_id=ctx.project.workspace_id,
        target_type="conversation",
        target_id=conv.id,
        summary=f"Assistant answered ({len(chunks)} sources)",
        meta={"retrieved": len(chunks), "demo": bool(result.demo_mode) if result else False},
    )
    db.commit()
    db.refresh(assistant_msg)

    out = _message_out(assistant_msg, citations)
    return {
        "conversation_id": str(conv.id),
        "message": out.model_dump(mode="json"),
        "retrieved_count": len(chunks),
        "model": result.model,
        "demo_mode": bool(result.demo_mode),
        "uncertainty": meta.get("uncertainty"),
    }


def list_conversations(db: Session, *, ctx: ProjectContext) -> list[dict]:
    rows = db.scalars(
        select(Conversation)
        .where(
            Conversation.project_id == ctx.project.id,
            Conversation.user_id == ctx.user.id,
        )
        .order_by(Conversation.updated_at.desc())
    ).all()
    if not rows:
        return []
    counts = dict(
        db.execute(
            select(Message.conversation_id, func.count(Message.id))
            .where(Message.conversation_id.in_([r.id for r in rows]))
            .group_by(Message.conversation_id)
        ).all()
    )
    return [
        {
            "id": str(r.id),
            "project_id": str(r.project_id),
            "title": r.title,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            "message_count": int(counts.get(r.id, 0)),
        }
        for r in rows
    ]


def get_conversation_messages(db: Session, *, ctx: ProjectContext, conversation_id: uuid.UUID) -> list[MessageOut]:
    conv = db.scalar(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.project_id == ctx.project.id,
            Conversation.user_id == ctx.user.id,
        )
    )
    if conv is None:
        raise NotFoundError("Conversation not found.")
    messages = db.scalars(
        select(Message)
        .where(Message.conversation_id == conv.id)
        .order_by(Message.created_at, Message.id)
    ).all()
    citations = _batch_citations(db, [m.id for m in messages])
    return [_message_out(m, citations.get(m.id, [])) for m in messages]


def create_conversation(db: Session, *, ctx: ProjectContext, title: str | None) -> dict:
    text = (title or "").strip() or "New conversation"
    conv = Conversation(
        id=uuid.uuid4(),
        project_id=ctx.project.id,
        user_id=ctx.user.id,
        title=text[:255],
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return {
        "id": str(conv.id),
        "project_id": str(conv.project_id),
        "title": conv.title,
        "created_at": conv.created_at.isoformat() if conv.created_at else None,
        "updated_at": conv.updated_at.isoformat() if conv.updated_at else None,
        "message_count": 0,
    }


def delete_conversation(db: Session, *, ctx: ProjectContext, conversation_id: uuid.UUID) -> OkResponse:
    conv = db.scalar(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.project_id == ctx.project.id,
            Conversation.user_id == ctx.user.id,
        )
    )
    if conv is None:
        raise NotFoundError("Conversation not found.")
    db.delete(conv)  # ORM cascades messages + citations
    db.commit()
    return OkResponse(message="Conversation deleted.")


__all__ = [
    "ask",
    "list_conversations",
    "get_conversation_messages",
    "create_conversation",
    "delete_conversation",
]
