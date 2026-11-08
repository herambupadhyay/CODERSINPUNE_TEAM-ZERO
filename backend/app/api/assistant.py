"""Assistant routes: conversations (own-only) + ask."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from pydantic import Field
from sqlalchemy.orm import Session

from app.core.deps import ProjectContext, get_db, project_context
from app.schemas.assistant import AskIn, AskOut, ConversationOut, MessageOut
from app.schemas.common import ApiModel, OkResponse
from app.services import assistant_svc

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
    result = await assistant_svc.ask(db, ctx=ctx, payload=payload)
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
