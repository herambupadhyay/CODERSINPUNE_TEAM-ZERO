"""Shared Pydantic building blocks."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Generic, TypeVar
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class OkResponse(BaseModel):
    ok: bool = True
    message: str | None = None


class ErrorBody(BaseModel):
    error: str
    detail: str | None = None


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int


class MessageOut(BaseModel):
    message: str


class IdName(ApiModel):
    id: UUID
    name: str


class ActorBrief(ApiModel):
    id: UUID
    name: str
    email: str
    title: str | None = None


class EvidenceRef(BaseModel):
    """A provenance pointer used across knowledge, findings and citations."""

    document_id: UUID | None = None
    document_name: str | None = None
    chunk_id: UUID | None = None
    quote: str = ""
    page_number: int | None = None
    section: str | None = None
    label: str | None = None
    position: int = 0


class Counts(BaseModel):
    documents: int = 0
    chunks: int = 0
    knowledge: int = 0
    pending_review: int = 0
    handovers: int = 0
    open_tasks: int = 0
    gaps: int = 0
    members: int = 0


class HealthOut(BaseModel):
    status: str = "ok"
    database: str = "unknown"
    pgvector: bool = False
    ai_configured: bool = False
    demo_mode: bool = False
    embed_dim: int = 0
    version: str = "1.0.0"


__all__ = [
    "ApiModel", "OkResponse", "ErrorBody", "Page", "MessageOut", "IdName",
    "ActorBrief", "EvidenceRef", "Counts", "HealthOut", "Field", "Any",
    "datetime", "Generic", "T",
]
