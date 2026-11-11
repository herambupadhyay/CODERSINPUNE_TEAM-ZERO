"""Assistant + search + activity schemas."""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import Field

from app.schemas.common import ApiModel, EvidenceRef


class ConversationOut(ApiModel):
    id: UUID
    project_id: UUID
    title: str
    created_at: datetime | None = None
    updated_at: datetime | None = None
    message_count: int = 0


class MessageOut(ApiModel):
    id: UUID
    conversation_id: UUID
    role: str
    content: str
    meta: dict = {}
    error: str | None = None
    created_at: datetime | None = None
    citations: list[EvidenceRef] = []


class AskIn(ApiModel):
    conversation_id: UUID | None = None
    message: str = Field(min_length=1, max_length=4000)


class AskOut(ApiModel):
    conversation_id: UUID
    message: MessageOut
    # surfaced to the UI for transparency
    retrieved_count: int = 0
    model: str | None = None
    demo_mode: bool = False
    uncertainty: str | None = None


class SearchHit(ApiModel):
    chunk_id: UUID
    document_id: UUID
    document_name: str
    text: str
    page_number: int | None = None
    section: str | None = None
    score: float = 0.0
    access_scope: str = "project"


class SearchOut(ApiModel):
    query: str
    hits: list[SearchHit] = []
    total: int = 0
    demo_mode: bool = False


class ActivityOut(ApiModel):
    id: UUID
    action: str
    actor_id: UUID | None = None
    actor_name: str | None = None
    actor_type: str = "user"
    target_type: str | None = None
    target_id: str | None = None
    summary: str | None = None
    meta: dict = {}
    created_at: datetime | None = None


__all__ = [
    "ConversationOut", "MessageOut", "AskIn", "AskOut", "SearchHit",
    "SearchOut", "ActivityOut",
]
