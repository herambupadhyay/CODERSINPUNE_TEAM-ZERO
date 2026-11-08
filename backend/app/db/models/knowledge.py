"""Knowledge models: structured items, relationships, evidence links, review."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, Timestamped, UUIDPk
from app.domain.enums import (
    AccessScope,
    EvidenceStatus,
    RelationshipType,
    ReviewAction,
    ReviewState,
)


class KnowledgeItem(UUIDPk, Timestamped, Base):
    """One structured claim/entity extracted from authorised sources."""

    __tablename__ = "knowledge_items"
    __table_args__ = (
        Index("ix_knowledge_project_type", "project_id", "type"),
        Index("ix_knowledge_project_review", "project_id", "review_state"),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    type: Mapped[str] = mapped_column(String(40))  # KnowledgeType
    title: Mapped[str] = mapped_column(String(400))
    description: Mapped[str] = mapped_column(Text, default="")
    # rationale / reasoning text when documented (never invented)
    reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)

    # structured, type-specific payload (owner, status, dates, impact...)
    attributes: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    evidence_status: Mapped[str] = mapped_column(
        String(30), default=EvidenceStatus.SUPPORTED
    )
    review_state: Mapped[str] = mapped_column(String(30), default=ReviewState.PENDING)
    access_scope: Mapped[str] = mapped_column(
        String(30), default=AccessScope.PROJECT
    )

    # who this claim concerns (e.g. departing member for ownership items)
    subject_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # provenance of extraction
    source_document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="SET NULL"),
        nullable=True,
    )
    extraction_run: Mapped[str | None] = mapped_column(String(60), nullable=True)
    is_sample: Mapped[bool] = mapped_column(default=False)  # labelled demo data

    # review bookkeeping
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    corrected_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    evidences: Mapped[list["KnowledgeEvidence"]] = relationship(
        back_populates="item", cascade="all, delete-orphan", passive_deletes=True
    )
    reviews: Mapped[list["ReviewRecord"]] = relationship(
        back_populates="item", cascade="all, delete-orphan", passive_deletes=True
    )


class KnowledgeEvidence(UUIDPk, Base):
    """Pointer from a knowledge item to exact source chunks (+ quoted span)."""

    __tablename__ = "knowledge_evidence"
    __table_args__ = (
        UniqueConstraint("item_id", "chunk_id", "quote_hash", name="uq_item_chunk_quote"),
    )

    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("knowledge_items.id", ondelete="CASCADE"),
        index=True,
    )
    chunk_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("evidence_chunks.id", ondelete="CASCADE"),
        index=True,
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    quote: Mapped[str] = mapped_column(Text)
    quote_hash: Mapped[str] = mapped_column(String(40))
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    section: Mapped[str | None] = mapped_column(String(255), nullable=True)
    confidence: Mapped[str | None] = mapped_column(String(30), nullable=True)

    item: Mapped[KnowledgeItem] = relationship(back_populates="evidences")


class KnowledgeRelationship(UUIDPk, Base):
    """Directed edge between knowledge items (the knowledge graph)."""

    __tablename__ = "knowledge_relationships"
    __table_args__ = (
        UniqueConstraint(
            "src_item_id", "dst_item_id", "rel_type", name="uq_edge"
        ),
        Index("ix_edges_dst", "dst_item_id"),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    src_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("knowledge_items.id", ondelete="CASCADE"),
        index=True,
    )
    dst_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("knowledge_items.id", ondelete="CASCADE"),
        index=True,
    )
    rel_type: Mapped[str] = mapped_column(String(40), default=RelationshipType.RELATED_TO)
    label: Mapped[str | None] = mapped_column(String(140), nullable=True)
    evidence_status: Mapped[str] = mapped_column(
        String(30), default=EvidenceStatus.SUPPORTED
    )
    is_sample: Mapped[bool] = mapped_column(default=False)


class ReviewRecord(UUIDPk, Base):
    """Audit trail of human review actions on knowledge items."""

    __tablename__ = "review_records"

    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("knowledge_items.id", ondelete="CASCADE"),
        index=True,
    )
    reviewer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    action: Mapped[str] = mapped_column(String(30))  # ReviewAction
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    previous_state: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    item: Mapped[KnowledgeItem] = relationship(back_populates="reviews")


__all__ = [
    "KnowledgeItem",
    "KnowledgeEvidence",
    "KnowledgeRelationship",
    "ReviewRecord",
    "ReviewAction",
]
