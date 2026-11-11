"""Knowledge item / relationship / review / graph schemas."""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import Field

from app.domain.enums import (
    AccessScope,
    EvidenceStatus,
    KnowledgeType,
    RelationshipType,
    ReviewAction,
    ReviewState,
)
from app.schemas.common import ApiModel, EvidenceRef


class KnowledgeItemOut(ApiModel):
    id: UUID
    project_id: UUID
    type: KnowledgeType
    title: str
    description: str = ""
    reasoning: str | None = None
    attributes: dict = {}
    evidence_status: EvidenceStatus
    review_state: ReviewState
    access_scope: AccessScope
    subject_user_id: UUID | None = None
    source_document_id: UUID | None = None
    source_document_name: str | None = None
    is_sample: bool = False
    reviewed_by: UUID | None = None
    reviewed_at: datetime | None = None
    corrected_text: str | None = None
    created_at: datetime | None = None
    evidence: list[EvidenceRef] = []


class KnowledgeListOut(ApiModel):
    items: list[KnowledgeItemOut]
    total: int = 0
    counts_by_type: dict[str, int] = {}
    counts_by_evidence: dict[str, int] = {}
    pending_review: int = 0


class ReviewIn(ApiModel):
    action: ReviewAction
    note: str | None = Field(default=None, max_length=2000)
    corrected_text: str | None = Field(default=None, max_length=4000)


class EdgeOut(ApiModel):
    id: UUID
    src_item_id: UUID
    dst_item_id: UUID
    rel_type: RelationshipType
    label: str | None = None
    evidence_status: EvidenceStatus
    is_sample: bool = False


class GraphNode(ApiModel):
    id: UUID
    type: KnowledgeType
    title: str
    evidence_status: EvidenceStatus
    review_state: ReviewState
    access_scope: AccessScope
    is_sample: bool = False
    subject_user_id: UUID | None = None
    group: int = 0  # layout hint


class GraphOut(ApiModel):
    nodes: list[GraphNode]
    edges: list[EdgeOut]
    truncated: bool = False
    node_count: int = 0
    edge_count: int = 0


class EvidenceOut(ApiModel):
    id: UUID
    item_id: UUID
    document_id: UUID
    document_name: str | None = None
    quote: str
    page_number: int | None = None
    section: str | None = None
    confidence: str | None = None


class KnowledgeItemCreateIn(ApiModel):
    type: KnowledgeType
    title: str = Field(min_length=1, max_length=400)
    description: str = Field(default="", max_length=4000)
    reasoning: str | None = Field(default=None, max_length=4000)
    attributes: dict = Field(default_factory=dict)
    evidence_status: EvidenceStatus = Field(default=EvidenceStatus.SUPPORTED)
    access_scope: AccessScope = Field(default=AccessScope.PROJECT)
    subject_user_id: UUID | None = None


__all__ = [
    "KnowledgeItemOut", "KnowledgeListOut", "ReviewIn", "EdgeOut",
    "GraphNode", "GraphOut", "EvidenceOut", "KnowledgeItemCreateIn",
]
