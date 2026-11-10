"""Assistant routes: conversations (own-only) + ask."""
from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends
from pydantic import Field
from sqlalchemy.orm import Session

from app.core.deps import ProjectContext, get_db, project_context
from app.schemas.assistant import AskIn, AskOut, ConversationOut, MessageOut
from app.schemas.common import ApiModel, OkResponse
from app.services import assistant_svc

log = logging.getLogger("projectpulse.assistant")
router = APIRouter()


class ConversationCreateIn(ApiModel):
    title: str | None = Field(default=None, max_length=255)


@router.get("/{project_id}/assistant/conversations", response_model=list[ConversationOut])
def list_conversations(
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> list[ConversationOut]:
    rows = assistant_svc.list_conversations(db, ctx=ctx)
    return [ConversationOut.model_validate(r) for r in rows]


@router.post("/{project_id}/assistant/conversations", response_model=ConversationOut)
def create_conversation(
    payload: ConversationCreateIn | None = None,
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> ConversationOut:
    title = payload.title if payload else None
    row = assistant_svc.create_conversation(db, ctx=ctx, title=title)
    return ConversationOut.model_validate(row)


@router.get(
    "/{project_id}/assistant/conversations/{conversation_id}/messages",
    response_model=list[MessageOut],
)
def list_messages(
    conversation_id: uuid.UUID,
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> list[MessageOut]:
    return assistant_svc.get_conversation_messages(
        db, ctx=ctx, conversation_id=conversation_id
    )


@router.post("/{project_id}/assistant/ask", response_model=AskOut)
async def ask(
    payload: AskIn,
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> AskOut:
    try:
        result = await assistant_svc.ask(db, ctx=ctx, payload=payload)
    except Exception as exc:
        log.exception("Assistant ask failed")
        # Return a graceful error message instead of 500
        from app.services.audit import audit
        from app.db.base import utcnow
        import uuid as _uuid
        conv_id = _uuid.uuid4()
        error_msg = (
            "I couldn't produce an answer — the assistant encountered an error. "
            "Please try again in a moment."
        )
        result = {
            "conversation_id": conv_id,
            "message": {
                "id": _uuid.uuid4(),
                "conversation_id": conv_id,
                "role": "assistant",
                "content": error_msg,
                "meta": {},
                "error": error_msg,
                "created_at": utcnow().isoformat(),
                "citations": [],
            },
            "retrieved_count": 0,
            "model": None,
            "demo_mode": False,
            "uncertainty": "No authorised sources matched this question.",
        }
    return AskOut.model_validate(result)


@router.delete(
    "/{project_id}/assistant/conversations/{conversation_id}",
    response_model=OkResponse,
)
def delete_conversation(
    conversation_id: uuid.UUID,
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> OkResponse:
    return assistant_svc.delete_conversation(
        db, ctx=ctx, conversation_id=conversation_id
    )


__all__ = ["router"]
