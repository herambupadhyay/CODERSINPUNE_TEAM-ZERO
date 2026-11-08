"""Document + processing job + chunk schemas."""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from app.domain.enums import (
    AccessScope,
    DocumentKind,
    DocumentStatus,
    JobStatus,
)
from app.schemas.common import ApiModel


class DocumentOut(ApiModel):
    id: UUID
    project_id: UUID
    original_name: str
    kind: DocumentKind
    size_bytes: int
    status: DocumentStatus
    access_scope: AccessScope
    mime_type: str | None = None
    page_count: int | None = None
    char_count: int | None = None
    chunk_count: int = 0
    extracted_count: int = 0
    error_message: str | None = None
    uploaded_by: UUID | None = None
    uploaded_by_name: str | None = None
    created_at: datetime | None = None
    processed_at: datetime | None = None


class DocumentGrantIn(ApiModel):
    user_id: UUID


class DocumentGrantOut(ApiModel):
    document_id: UUID
    user_id: UUID
    name: str = ""
    email: str = ""
    granted_by: UUID | None = None


class JobOut(ApiModel):
    id: UUID
    document_id: UUID
    status: JobStatus
    stage: str
    attempts: int = 0
    error_message: str | None = None
    stats: dict = {}
    created_at: datetime | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None


class ChunkOut(ApiModel):
    id: UUID
    document_id: UUID
    seq: int
    text: str
    page_number: int | None = None
    section: str | None = None
    source_type: str = "document"
    access_scope: AccessScope = AccessScope.PROJECT
    # filled when returned by vector search
    score: float | None = None
    document_name: str | None = None


class UploadResult(ApiModel):
    document: DocumentOut
    job: JobOut | None = None
    duplicate: bool = False
    warnings: list[str] = []


__all__ = [
    "DocumentOut", "DocumentGrantIn", "DocumentGrantOut", "JobOut",
    "ChunkOut", "UploadResult",
]
