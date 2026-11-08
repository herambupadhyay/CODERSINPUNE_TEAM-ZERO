"""Shared domain enums (used by models, schemas and tests)."""
from __future__ import annotations

from app.db.types import StrEnum


class WorkspaceRole(StrEnum):
    OWNER = "owner"
    LEAD = "lead"
    MEMBER = "member"
    SUCCESSOR = "successor"


class ProjectRole(StrEnum):
    HEAD = "head"
    LEAD = "lead"
    MEMBER = "member"
    SUCCESSOR = "successor"


class MemberStatus(StrEnum):
    ACTIVE = "active"
    INVITED = "invited"
    DEACTIVATED = "deactivated"


class DocumentStatus(StrEnum):
    UPLOADED = "uploaded"
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    NEEDS_REVIEW = "needs_review"


class DocumentKind(StrEnum):
    PDF = "pdf"
    DOCX = "docx"
    TXT = "txt"
    MARKDOWN = "markdown"
    CSV = "csv"


class AccessScope(StrEnum):
    PROJECT = "project"        # visible to all project members
    RESTRICTED = "restricted"  # only explicitly granted users (+ workspace owner)


class KnowledgeType(StrEnum):
    DECISION = "decision"
    TASK = "task"
    RISK = "risk"
    DEPENDENCY = "dependency"
    PERSON = "person"
    GAP = "gap"
    QUESTION = "question"
    CONTACT = "contact"


class EvidenceStatus(StrEnum):
    """How well a claim is supported by authorised sources."""
    SUPPORTED = "supported"
    INFERRED = "inferred"
    CONFLICTING = "conflicting"
    MISSING = "missing"


class ReviewState(StrEnum):
    PENDING = "pending"
    VERIFIED = "verified"
    REJECTED = "rejected"
    CORRECTED = "corrected"


class RelationshipType(StrEnum):
    OWNS = "owns"
    ASSIGNED_TO = "assigned_to"
    DEPENDS_ON = "depends_on"
    BLOCKS = "blocks"
    DECIDED_BY = "decided_by"
    SUPPORTS = "supports"
    SUPERSEDES = "supersedes"
    MENTIONED_IN = "mentioned_in"
    RESOLVED_BY = "resolved_by"
    RELATED_TO = "related_to"


class ReviewAction(StrEnum):
    VERIFY = "verify"
    REJECT = "reject"
    CORRECT = "correct"
    COMMENT = "comment"
    RESTORE = "restore"


class HandoverStatus(StrEnum):
    DRAFT = "draft"
    PROCESSING = "processing"
    NEEDS_REVIEW = "needs_review"
    CHANGES_REQUESTED = "changes_requested"
    APPROVED = "approved"
    SHARED = "shared"
    ARCHIVED = "archived"


class FindingReviewState(StrEnum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    EDITED = "edited"


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class ActorType(StrEnum):
    USER = "user"
    SYSTEM = "system"


__all__ = [n for n in dir() if n.isupper()]  # enum names only
