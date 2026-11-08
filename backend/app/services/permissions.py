"""Authority Intelligence — server-side permission evaluation.

Every protected read/write goes through this module. The Knowledge Graph is
NEVER used as an access-control mechanism: visibility of knowledge derives
from explicit membership + scope rules evaluated *before* retrieval.
"""
from __future__ import annotations

import uuid

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.db.models import (
    Document,
    EvidenceChunk,
    Handover,
    KnowledgeItem,
    Project,
    ProjectMember,
    User,
    Workspace,
    WorkspaceMember,
)
from app.domain.enums import (
    AccessScope,
    HandoverStatus,
    MemberStatus,
    ProjectRole,
    WorkspaceRole,
)

# Roles that may review/verify findings, edit scopes, initiate handovers
REVIEW_ROLES = {WorkspaceRole.OWNER, ProjectRole.HEAD, ProjectRole.LEAD}
# Roles that may approve & share handovers
APPROVAL_ROLES = {WorkspaceRole.OWNER, ProjectRole.HEAD}
# Roles that may upload documents / manage project content
CONTRIBUTOR_ROLES = {WorkspaceRole.OWNER, ProjectRole.HEAD, ProjectRole.LEAD, ProjectRole.MEMBER}


class PermissionError_(Exception):
    """Raised when a user lacks authority for an action."""

    def __init__(self, detail: str = "You do not have permission to do that."):
        self.detail = detail
        super().__init__(detail)


class NotFoundError(Exception):
    """Raised instead of 404 vs 403 leaks — resources the user cannot see simply don't exist."""

    def __init__(self, detail: str = "Resource not found."):
        self.detail = detail
        super().__init__(detail)


# ---------------------------------------------------------------------------
# Membership resolution
# ---------------------------------------------------------------------------

def get_workspace_member(
    db: Session, user_id: uuid.UUID, workspace_id: uuid.UUID
) -> WorkspaceMember | None:
    return db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id,
            WorkspaceMember.status == MemberStatus.ACTIVE,
        )
    )


def get_project_member(
    db: Session, user_id: uuid.UUID, project_id: uuid.UUID
) -> ProjectMember | None:
    return db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
            ProjectMember.status == MemberStatus.ACTIVE,
        )
    )


def effective_project_role(
    db: Session, user: User, project: Project
) -> ProjectRole | None:
    """Resolve the caller's effective role on a project.

    Rules (explicit, no graph-proximity inheritance):
    - Workspace owner ⇒ HEAD on every project in the workspace.
    - Active project membership ⇒ its role (HEAD / LEAD / MEMBER / SUCCESSOR).
    - Otherwise ⇒ None (no access), even if the user is a workspace member.
    """
    ws_member = get_workspace_member(db, user.id, project.workspace_id)
    if ws_member is None:
        return None
    if ws_member.role == WorkspaceRole.OWNER:
        return ProjectRole.HEAD

    proj_member = get_project_member(db, user.id, project.id)
    if proj_member is None:
        return None
    return ProjectRole(proj_member.role)


def require_project(db: Session, user: User, project_id: uuid.UUID) -> tuple[Project, ProjectRole]:
    project = db.get(Project, project_id)
    if project is None or project.archived:
        raise NotFoundError()
    role = effective_project_role(db, user, project)
    if role is None:
        # hide existence from non-members
        raise NotFoundError()
    return project, role


def require_workspace(db: Session, user: User, workspace_id: uuid.UUID) -> tuple[Workspace, WorkspaceRole]:
    ws = db.get(Workspace, workspace_id)
    member = None if ws is None else get_workspace_member(db, user.id, workspace_id)
    if ws is None or member is None:
        raise NotFoundError()
    return ws, WorkspaceRole(member.role)


# ---------------------------------------------------------------------------
# Action permissions
# ---------------------------------------------------------------------------

def can_manage_project(role: ProjectRole | WorkspaceRole | None) -> bool:
    return role in {ProjectRole.HEAD, ProjectRole.LEAD, WorkspaceRole.OWNER}


def can_manage_members(role: ProjectRole | WorkspaceRole | None) -> bool:
    return role in {ProjectRole.HEAD, ProjectRole.LEAD, WorkspaceRole.OWNER}


def can_review(role: ProjectRole | WorkspaceRole | None) -> bool:
    """Review/verify/correct knowledge findings."""
    return role in REVIEW_ROLES


def can_upload(role: ProjectRole | WorkspaceRole | None) -> bool:
    return role in CONTRIBUTOR_ROLES or role == WorkspaceRole.OWNER


def can_approve_handover(role: ProjectRole | WorkspaceRole | None) -> bool:
    return role in APPROVAL_ROLES


def can_initiate_handover(role: ProjectRole | WorkspaceRole | None) -> bool:
    return role in REVIEW_ROLES


def can_reset_demo(role: ProjectRole | WorkspaceRole | None) -> bool:
    return role == WorkspaceRole.OWNER


# ---------------------------------------------------------------------------
# Scope-filtered visibility (evaluated BEFORE retrieval)
# ---------------------------------------------------------------------------

def visible_documents(db: Session, user: User, project: Project, role: ProjectRole) -> Select:
    """Documents the user may read: project-scoped, or restricted-but-granted.

    Restricted documents are visible to: workspace owner, project head, or a
    user holding an explicit grant row. Leads/Members/Successors never see
    restricted material implicitly.
    """
    stmt = select(Document).where(Document.project_id == project.id)
    if role == ProjectRole.HEAD:
        return stmt  # heads see everything in their project (incl. restricted)
    # explicit grants via association table defined on the model registry
    from app.db.models.documents import document_grants  # local import avoids cycles

    granted = select(document_grants.c.document_id).where(
        document_grants.c.user_id == user.id
    )
    return stmt.where(
        (Document.access_scope == AccessScope.PROJECT) | Document.id.in_(granted)
    )


def visible_chunk_ids(db: Session, user: User, project: Project, role: ProjectRole) -> Select:
    """IDs of evidence chunks the user may retrieve (pre-retrieval filter)."""
    from app.db.models.documents import document_grants

    stmt = select(EvidenceChunk.id).where(EvidenceChunk.project_id == project.id)
    if role == ProjectRole.HEAD:
        return stmt
    granted = select(document_grants.c.document_id).where(
        document_grants.c.user_id == user.id
    )
    return stmt.where(
        (EvidenceChunk.access_scope == AccessScope.PROJECT)
        | EvidenceChunk.document_id.in_(granted)
    )


def visible_knowledge(db: Session, user: User, project: Project, role: ProjectRole) -> Select:
    """Knowledge items the user may read.

    Project-scoped items are visible to all project members. Restricted items
    (extracted from restricted sources) require a grant on at least one of
    their source documents — or head/owner authority.
    """
    stmt = select(KnowledgeItem).where(KnowledgeItem.project_id == project.id)
    if role == ProjectRole.HEAD:
        return stmt

    from app.db.models.documents import document_grants
    from app.db.models.knowledge import KnowledgeEvidence

    granted_docs = select(document_grants.c.document_id).where(
        document_grants.c.user_id == user.id
    )
    item_with_granted_evidence = (
        select(KnowledgeEvidence.item_id)
        .where(KnowledgeEvidence.document_id.in_(granted_docs))
    )
    stmt = stmt.where(
        (KnowledgeItem.access_scope == AccessScope.PROJECT)
        | KnowledgeItem.id.in_(item_with_granted_evidence)
    )
    return stmt


# ---------------------------------------------------------------------------
# Handover visibility
# ---------------------------------------------------------------------------

def can_view_handover(user: User, handover: Handover, role: ProjectRole | None,
                      ws_role: WorkspaceRole | None, share_ids: set[uuid.UUID]) -> bool:
    """Who may read a handover.

    - Drafts/processing/needs_review/changes_requested: creator, project head,
      project lead (reviewers), workspace owner.
    - Approved/ shared: the above + the designated successor + any user the
      handover was explicitly shared with.
    - Successors NEVER see handovers where they are not the recipient.
    """
    reviewer = role in REVIEW_ROLES or ws_role == WorkspaceRole.OWNER
    if handover.status in {
        HandoverStatus.DRAFT,
        HandoverStatus.PROCESSING,
        HandoverStatus.NEEDS_REVIEW,
        HandoverStatus.CHANGES_REQUESTED,
    }:
        if handover.created_by == user.id:
            return True
        return reviewer
    # approved / shared / archived
    if handover.created_by == user.id or reviewer:
        return True
    if handover.successor_user_id == user.id:
        return True
    return user.id in share_ids


def handover_share_ids(db: Session, handover_id: uuid.UUID) -> set[uuid.UUID]:
    from app.db.models import HandoverShare

    rows = db.scalars(
        select(HandoverShare.recipient_user_id).where(
            HandoverShare.handover_id == handover_id
        )
    ).all()
    return set(rows)
