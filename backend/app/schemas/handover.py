"""Handover lifecycle schemas."""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import Field

from app.domain.enums import (
    EvidenceStatus,
    FindingReviewState,
    HandoverStatus,
    ReviewAction,
)
from app.schemas.common import ApiModel, EvidenceRef


HANDOVER_CATEGORIES = [
    "responsibilities", "decisions", "tasks", "risks", "contacts",
    "systems", "documents", "next_steps",
]


class HandoverCreateIn(ApiModel):
    departing_user_id: UUID
    successor_user_id: UUID | None = None
    role_transferred: str = Field(min_length=1, max_length=140)
    title: str = Field(min_length=1, max_length=400)
    categories: list[str] = Field(default_factory=lambda: list(HANDOVER_CATEGORIES))


class HandoverUpdateIn(ApiModel):
    title: str | None = Field(default=None, min_length=1, max_length=400)
    successor_user_id: UUID | None = None
    role_transferred: str | None = Field(default=None, min_length=1, max_length=140)
    scope: dict | None = None


class SectionOut(ApiModel):
    id: UUID
    key: str
    title: str
    body: str = ""
    position: int = 0
    meta: dict = {}


class FindingOut(ApiModel):
    id: UUID
    handover_id: UUID
    section_key: str
    item_id: UUID | None = None
    label: str
    content: str
    evidence_status: EvidenceStatus
    review_state: FindingReviewState
    evidence: list[EvidenceRef] = []
    reviewer_note: str | None = None
    position: int = 0


class FindingReviewIn(ApiModel):
    action: str = Field(pattern="^(accept|reject|edit)$")
    content: str | None = Field(default=None, max_length=8000)
    note: str | None = Field(default=None, max_length=2000)


class ApprovalOut(ApiModel):
    id: UUID
    actor_id: UUID | None = None
    actor_name: str | None = None
    action: str
    note: str | None = None
    created_at: datetime | None = None


class HandoverOut(ApiModel):
    id: UUID
    project_id: UUID
    created_by: UUID
    departing_user_id: UUID
    departing_name: str | None = None
    successor_user_id: UUID | None = None
    successor_name: str | None = None
    role_transferred: str
    title: str
    status: HandoverStatus
    version: int = 1
    scope: dict = {}
    impact: dict = {}
    summary: str | None = None
    approved_by: UUID | None = None
    approved_at: datetime | None = None
    shared_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    section_count: int = 0
    finding_count: int = 0


class HandoverDetailOut(HandoverOut):
    sections: list[SectionOut] = []
    findings: list[FindingOut] = []
    approvals: list[ApprovalOut] = []
    # what the caller may do (server-computed, role driven)
    can: dict = {}


class HandoverActionIn(ApiModel):
    """State machine transitions: submit / approve / request_changes / share / archive."""

    note: str | None = Field(default=None, max_length=2000)
    recipient_user_id: UUID | None = None  # required for share


class ImpactAnalysis(ApiModel):
    departing_user_id: UUID
    open_tasks: int = 0
    decisions: int = 0
    owned_systems: int = 0
    documents_uploaded: int = 0
    unresolved_items: int = 0
    gaps: int = 0
    items: list[dict] = []


__all__ = [
    "HANDOVER_CATEGORIES", "HandoverCreateIn", "HandoverUpdateIn",
    "SectionOut", "FindingOut", "FindingReviewIn", "ApprovalOut",
    "HandoverOut", "HandoverDetailOut", "HandoverActionIn", "ImpactAnalysis",
    "ReviewAction",
]
