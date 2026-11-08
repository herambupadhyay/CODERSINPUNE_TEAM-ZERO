"""Handover models: handovers, sections, findings, approvals, shares."""
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

from app.db.base import Base, UUIDPk, utcnow
from app.domain.enums import EvidenceStatus, FindingReviewState, HandoverStatus


class Handover(UUIDPk, Base):
    __tablename__ = "handovers"
    __table_args__ = (
        Index("ix_handovers_project_status", "project_id", "status"),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    departing_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    successor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
        index=True,
    )
    role_transferred: Mapped[str] = mapped_column(String(140))
    title: Mapped[str] = mapped_column(String(400))
    status: Mapped[str] = mapped_column(String(40), default=HandoverStatus.DRAFT)
    version: Mapped[int] = mapped_column(Integer, default=1)

    # scope the requester selected (categories, e.g. ["decisions","tasks"])
    scope: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # departure impact analysis snapshot (tasks, decisions, docs affected)
    impact: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    generation_meta: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    summary: Mapped[str | None] = mapped_column(Text, nullable=True)

    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    shared_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    sections: Mapped[list["HandoverSection"]] = relationship(
        back_populates="handover",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="HandoverSection.position",
    )
    findings: Mapped[list["HandoverFinding"]] = relationship(
        back_populates="handover",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    approvals: Mapped[list["HandoverApproval"]] = relationship(
        back_populates="handover", cascade="all, delete-orphan", passive_deletes=True
    )
    shares: Mapped[list["HandoverShare"]] = relationship(
        back_populates="handover", cascade="all, delete-orphan", passive_deletes=True
    )


class HandoverSection(UUIDPk, Base):
    __tablename__ = "handover_sections"
    __table_args__ = (
        UniqueConstraint("handover_id", "key", name="uq_section_key"),
    )

    handover_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("handovers.id", ondelete="CASCADE"),
        index=True,
    )
    key: Mapped[str] = mapped_column(String(60))  # overview, responsibilities...
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text, default="")
    position: Mapped[int] = mapped_column(Integer, default=0)
    meta: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    handover: Mapped[Handover] = relationship(back_populates="sections")


class HandoverFinding(UUIDPk, Base):
    """An individual claim in a handover with evidence + human review state."""

    __tablename__ = "handover_findings"

    handover_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("handovers.id", ondelete="CASCADE"),
        index=True,
    )
    section_key: Mapped[str] = mapped_column(String(60), index=True)
    item_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("knowledge_items.id", ondelete="SET NULL"),
        nullable=True,
    )
    label: Mapped[str] = mapped_column(String(140))
    content: Mapped[str] = mapped_column(Text)
    evidence_status: Mapped[str] = mapped_column(
        String(30), default=EvidenceStatus.SUPPORTED
    )
    review_state: Mapped[str] = mapped_column(
        String(30), default=FindingReviewState.PENDING
    )
    evidence: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    reviewer_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    handover: Mapped[Handover] = relationship(back_populates="findings")


class HandoverApproval(UUIDPk, Base):
    __tablename__ = "handover_approvals"

    handover_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("handovers.id", ondelete="CASCADE"),
        index=True,
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(40))  # submitted/approved/rejected/changes_requested/shared
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    handover: Mapped[Handover] = relationship(back_populates="approvals")


class HandoverShare(UUIDPk, Base):
    """Explicit record of who a handover was shared with (successor access)."""

    __tablename__ = "handover_shares"

    handover_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("handovers.id", ondelete="CASCADE"),
        index=True,
    )
    recipient_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    shared_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    handover: Mapped[Handover] = relationship(back_populates="shares")
