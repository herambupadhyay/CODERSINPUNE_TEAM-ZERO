"""Document ingestion models: documents, jobs, evidence chunks."""
from __future__ import annotations

import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.config import get_settings
from app.db.base import Base, Timestamped, UUIDPk
from app.domain.enums import AccessScope, DocumentKind, DocumentStatus, JobStatus


# Explicit per-user grants for RESTRICTED documents (Authority Intelligence).
# A restricted document is readable only by: workspace owner, project head,
# or a user with a row here. Never implied by membership alone.
document_grants = Table(
    "document_grants",
    Base.metadata,
    Column("document_id", UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True),
    Column("user_id", UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("granted_by", UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    Column("created_at", DateTime(timezone=True), server_default=func.now()),
)


class Document(UUIDPk, Timestamped, Base):
    __tablename__ = "documents"
    __table_args__ = (
        Index("ix_documents_project_status", "project_id", "status"),
        UniqueConstraint(
            "project_id", "content_hash", name="uq_document_content_hash"
        ),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    uploaded_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    filename: Mapped[str] = mapped_column(String(255))
    original_name: Mapped[str] = mapped_column(String(255))
    kind: Mapped[str] = mapped_column(String(20), default=DocumentKind.TXT)
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    content_hash: Mapped[str] = mapped_column(String(64), index=True)
    storage_path: Mapped[str] = mapped_column(String(512))
    mime_type: Mapped[str | None] = mapped_column(String(120), nullable=True)

    status: Mapped[str] = mapped_column(String(30), default=DocumentStatus.UPLOADED)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    access_scope: Mapped[str] = mapped_column(
        String(30), default=AccessScope.PROJECT
    )

    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    char_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    extracted_count: Mapped[int] = mapped_column(Integer, default=0)

    processed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    chunks: Mapped[list["EvidenceChunk"]] = relationship(
        back_populates="document", cascade="all, delete-orphan", passive_deletes=True
    )
    job: Mapped["DocumentProcessingJob | None"] = relationship(
        back_populates="document", cascade="all, delete-orphan", uselist=False
    )


class DocumentProcessingJob(UUIDPk, Base):
    __tablename__ = "document_processing_jobs"

    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("documents.id", ondelete="CASCADE"),
        unique=True,
        index=True,
    )
    status: Mapped[str] = mapped_column(String(30), default=JobStatus.QUEUED)
    stage: Mapped[str] = mapped_column(String(60), default="queued")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    stats: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    document: Mapped[Document] = relationship(back_populates="job")


class EvidenceChunk(UUIDPk, Timestamped, Base):
    """A passage of source text with precise provenance, searchable by embedding."""

    __tablename__ = "evidence_chunks"
    __table_args__ = (
        Index("ix_chunks_project_doc", "project_id", "document_id"),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    seq: Mapped[int] = mapped_column(Integer, default=0)
    text: Mapped[str] = mapped_column(Text)
    # provenance
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    section: Mapped[str | None] = mapped_column(String(255), nullable=True)
    char_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    char_end: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_type: Mapped[str] = mapped_column(String(40), default="document")
    access_scope: Mapped[str] = mapped_column(
        String(30), default=AccessScope.PROJECT
    )
    meta: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    embedding: Mapped[list | None] = mapped_column(
        Vector(get_settings().embed_dim), nullable=True
    )

    document: Mapped[Document] = relationship(back_populates="chunks")
