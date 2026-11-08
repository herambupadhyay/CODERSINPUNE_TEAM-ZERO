"""Import all models so Base.metadata is complete (needed by Alembic & create_all)."""
from app.db.base import Base
from app.db.models.ai import (
    AuditEvent,
    Conversation,
    Message,
    MessageCitation,
)
from app.db.models.documents import (
    Document,
    DocumentProcessingJob,
    EvidenceChunk,
    document_grants,
)
from app.db.models.handover import (
    Handover,
    HandoverApproval,
    HandoverFinding,
    HandoverSection,
    HandoverShare,
)
from app.db.models.identity import (
    Invitation,
    Project,
    ProjectMember,
    Session,
    User,
    Workspace,
    WorkspaceMember,
)
from app.db.models.knowledge import (
    KnowledgeEvidence,
    KnowledgeItem,
    KnowledgeRelationship,
    ReviewRecord,
)

__all__ = [
    "Base",
    "User",
    "Session",
    "Workspace",
    "WorkspaceMember",
    "Project",
    "ProjectMember",
    "Invitation",
    "Document",
    "DocumentProcessingJob",
    "EvidenceChunk",
    "document_grants",
    "KnowledgeItem",
    "KnowledgeEvidence",
    "KnowledgeRelationship",
    "ReviewRecord",
    "Handover",
    "HandoverSection",
    "HandoverFinding",
    "HandoverApproval",
    "HandoverShare",
    "Conversation",
    "Message",
    "MessageCitation",
    "AuditEvent",
]
