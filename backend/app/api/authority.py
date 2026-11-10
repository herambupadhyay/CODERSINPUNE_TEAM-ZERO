"""Authority Intelligence routes: capability matrix, roles, scopes, /me.

Read-only: membership changes live on /api/projects/{id}/members (audited there).
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import ProjectContext, get_db, project_context
from app.db.models import Document, ProjectMember, User, Workspace, WorkspaceMember
from app.db.models.documents import document_grants
from app.domain.enums import AccessScope, MemberStatus, ProjectRole, WorkspaceRole
from app.schemas.authority import (
    AuthorityAccessOut,
    AuthorityDocumentAccess,
    AuthorityGrantOut,
    AuthorityMemberOut,
    AuthorityOverview,
    CapabilityMatrixRow,
    CapabilityUpdateIn,
    RoleCard,
    ScopeCard,
)
from app.services.permissions import PermissionError_, can_manage_authority

router = APIRouter()

# Custom capability overrides per project: {project_id: {cap_key: {role: enabled}}}
# Head can override which roles have which capabilities. Stored in memory.
_custom_capabilities: dict[uuid.UUID, dict[str, dict[str, bool]]] = {}


def _effective_roles(cap: CapabilityMatrixRow, project_id: uuid.UUID) -> list[str]:
    """Return the effective role list for a capability, applying custom overrides."""
    overrides = _custom_capabilities.get(project_id, {}).get(cap.key)
    if not overrides:
        return cap.roles
    result = list(cap.roles)
    for role, enabled in overrides.items():
        if enabled and role not in result:
            result.append(role)
        elif not enabled and role in result:
            result.remove(role)
    return result

_P = ProjectRole  # shorthand; role strings below always come from enum values


def _roles(*roles: ProjectRole) -> list[str]:
    return [role.value for role in roles]


# --- capability matrix (single source of truth for the UI + /me) ------------
CAPABILITIES: list[CapabilityMatrixRow] = [
    CapabilityMatrixRow(
        key="view_documents",
        label="View documents",
        description="Read project-scoped documents; restricted ones need an explicit grant.",
        roles=_roles(_P.HEAD, _P.LEAD, _P.MEMBER, _P.SUCCESSOR),
    ),
    CapabilityMatrixRow(
        key="upload_documents",
        label="Upload documents",
        description="Upload and process new source documents for the project.",
        roles=_roles(_P.HEAD, _P.LEAD, _P.MEMBER),
    ),
    CapabilityMatrixRow(
        key="set_access_scope",
        label="Set access scope",
        description="Move a document between project and restricted scope.",
        roles=_roles(_P.HEAD),
    ),
    CapabilityMatrixRow(
        key="grant_restricted_access",
        label="Grant restricted access",
        description="Grant or revoke a person's access to a restricted document.",
        roles=_roles(_P.HEAD),
    ),
    CapabilityMatrixRow(
        key="review_findings",
        label="Review findings",
        description="Verify or reject knowledge findings.",
        roles=_roles(_P.HEAD, _P.LEAD),
    ),
    CapabilityMatrixRow(
        key="correct_knowledge",
        label="Correct knowledge",
        description="Replace a finding's text and mark it corrected.",
        roles=_roles(_P.HEAD, _P.LEAD),
    ),
    CapabilityMatrixRow(
        key="delete_knowledge",
        label="Delete knowledge",
        description="Remove a knowledge item from the graph.",
        roles=_roles(_P.HEAD, _P.LEAD),
    ),
    CapabilityMatrixRow(
        key="initiate_handover",
        label="Initiate handover",
        description="Start a handover and generate its draft.",
        roles=_roles(_P.HEAD, _P.LEAD),
    ),
    CapabilityMatrixRow(
        key="approve_handover",
        label="Approve handover",
        description="Approve a handover once its findings are resolved.",
        roles=_roles(_P.HEAD),
    ),
    CapabilityMatrixRow(
        key="share_handover",
        label="Share handover",
        description="Share an approved handover with its recipient.",
        roles=_roles(_P.HEAD),
    ),
    CapabilityMatrixRow(
        key="review_handover_findings",
        label="Review handover findings",
        description="Accept, reject or edit findings raised on a handover.",
        roles=_roles(_P.HEAD, _P.LEAD),
    ),
    CapabilityMatrixRow(
        key="manage_members",
        label="Manage members",
        description="Add members and change project roles.",
        roles=_roles(_P.HEAD, _P.LEAD),
    ),
    CapabilityMatrixRow(
        key="manage_authority",
        label="Edit authority",
        description=(
            "Change roles, responsibilities and document access for any member. "
            "Only the project head can do this."
        ),
        roles=_roles(_P.HEAD),
    ),
    CapabilityMatrixRow(
        key="ask_assistant",
        label="Ask the assistant",
        description="Ask questions grounded in the project's authorised sources.",
        roles=_roles(_P.HEAD, _P.LEAD, _P.MEMBER, _P.SUCCESSOR),
    ),
    CapabilityMatrixRow(
        key="semantic_search",
        label="Semantic search",
        description="Search across the evidence the caller is allowed to read.",
        roles=_roles(_P.HEAD, _P.LEAD, _P.MEMBER, _P.SUCCESSOR),
    ),
    CapabilityMatrixRow(
        key="view_activity",
        label="View activity",
        description="Read the project activity and audit feed.",
        roles=_roles(_P.HEAD, _P.LEAD),
    ),
    CapabilityMatrixRow(
        key="reset_demo",
        label="Reset demo data",
        description="Restore the workspace's demo data to its seeded baseline.",
        roles=[],
        workspace_owner_allowed=True,  # workspace-owner-only capability
    ),
]

_ROLE_LABELS = {
    ProjectRole.HEAD: "Head",
    ProjectRole.LEAD: "Lead",
    ProjectRole.MEMBER: "Member",
    ProjectRole.SUCCESSOR: "Successor",
}

_ROLE_SUMMARIES = {
    ProjectRole.HEAD: (
        "Owns the project: reviews findings, sets scopes, approves and shares "
        "handovers, and manages membership."
    ),
    ProjectRole.LEAD: (
        "Trusted contributor who reviews findings and prepares handovers, but "
        "cannot approve or share them."
    ),
    ProjectRole.MEMBER: (
        "Contributes documents and asks the assistant; reviews and approvals "
        "stay with leads and heads."
    ),
    ProjectRole.SUCCESSOR: (
        "Incoming owner preparing to take over: reads approved material and asks "
        "questions, with no write access."
    ),
}

_ROLE_LIMITATIONS = {
    ProjectRole.HEAD: ["Workspace-level settings still belong to the workspace owner."],
    ProjectRole.LEAD: [
        "Cannot approve or share handovers — only the head can.",
        "Cannot change roles, responsibilities or document access — only the head can.",
        "Workspace-level settings still belong to the workspace owner.",
    ],
    ProjectRole.MEMBER: [
        "Restricted documents require an explicit grant.",
        "Cannot review, correct or delete findings.",
        "Cannot approve or share handovers.",
    ],
    ProjectRole.SUCCESSOR: [
        "Cannot upload documents or approve handovers.",
        "Sees only approved/shared handovers.",
        "Restricted documents require an explicit grant.",
    ],
}

_SCOPES: list[ScopeCard] = [
    ScopeCard(
        scope=AccessScope.PROJECT,
        label="Project scope",
        description="Readable by everyone actively assigned to the project.",
        visible_to=["All active project members"],
    ),
    ScopeCard(
        scope=AccessScope.RESTRICTED,
        label="Restricted scope",
        description="Hidden from general membership; access is granted explicitly.",
        visible_to=["Workspace owner", "Project head", "Users with an explicit document grant"],
    ),
]

_ROLE_RANK = {
    ProjectRole.HEAD: 0,
    ProjectRole.LEAD: 1,
    ProjectRole.MEMBER: 2,
    ProjectRole.SUCCESSOR: 3,
}


def _role_cards(project_id: uuid.UUID) -> list[RoleCard]:
    return [
        RoleCard(
            role=role,
            label=_ROLE_LABELS[role],
            summary=_ROLE_SUMMARIES[role],
            capabilities=[c.key for c in CAPABILITIES if role.value in _effective_roles(c, project_id)],
            limitations=list(_ROLE_LIMITATIONS[role]),
        )
        for role in (ProjectRole.HEAD, ProjectRole.LEAD, ProjectRole.MEMBER, ProjectRole.SUCCESSOR)
    ]


def _is_workspace_owner(user_id: uuid.UUID, ws_role: WorkspaceRole | None, ws: Workspace | None) -> bool:
    return ws_role == WorkspaceRole.OWNER or (ws is not None and ws.owner_id == user_id)


def _members(db: Session, ctx: ProjectContext) -> list[AuthorityMemberOut]:
    rows = db.execute(
        select(ProjectMember, User)
        .join(User, User.id == ProjectMember.user_id)
        .where(
            ProjectMember.project_id == ctx.project.id,
            ProjectMember.status == MemberStatus.ACTIVE,
        )
    ).all()
    ws = db.get(Workspace, ctx.project.workspace_id)
    ws_members = {
        m.user_id: m
        for m in db.scalars(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == ctx.project.workspace_id,
                WorkspaceMember.status == MemberStatus.ACTIVE,
            )
        ).all()
    }
    grant_counts: dict[uuid.UUID, int] = dict(
        db.execute(
            select(document_grants.c.user_id, func.count())
            .join(Document, Document.id == document_grants.c.document_id)
            .where(Document.project_id == ctx.project.id)
            .group_by(document_grants.c.user_id)
        ).all()
    )

    out: list[AuthorityMemberOut] = []
    listed: set[uuid.UUID] = set()
    for member, user in rows:
        listed.add(user.id)
        ws_member = ws_members.get(user.id)
        ws_role = WorkspaceRole(ws_member.role) if ws_member else None
        out.append(
            AuthorityMemberOut(
                user_id=user.id,
                name=user.name,
                email=user.email,
                ws_role=ws_role,
                project_role=ProjectRole(member.role),
                responsibility=member.responsibility,
                is_workspace_owner=_is_workspace_owner(user.id, ws_role, ws),
                document_grants=int(grant_counts.get(user.id, 0)),
            )
        )

    # Workspace owners are auto-heads on every project but may lack a membership row.
    if ctx.role == ProjectRole.HEAD and ctx.user.id not in listed:
        out.append(
            AuthorityMemberOut(
                user_id=ctx.user.id,
                name=ctx.user.name,
                email=ctx.user.email,
                ws_role=ctx.ws_role,
                project_role=ProjectRole.HEAD,
                responsibility="Workspace owner",
                is_workspace_owner=True,
                document_grants=int(grant_counts.get(ctx.user.id, 0)),
            )
        )

    out.sort(key=lambda m: (_ROLE_RANK[m.project_role], m.name.lower()))
    return out


def _caller_is_workspace_owner(ctx: ProjectContext, db: Session) -> bool:
    ws = db.get(Workspace, ctx.project.workspace_id)
    return _is_workspace_owner(ctx.user.id, ctx.ws_role, ws)


@router.get("/{project_id}/authority", response_model=AuthorityOverview)
def authority_overview(
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> AuthorityOverview:
    # Apply custom overrides to the capabilities list before returning.
    effective_caps = []
    for cap in CAPABILITIES:
        effective = CapabilityMatrixRow.model_validate(cap)
        effective.roles = _effective_roles(cap, ctx.project.id)
        effective_caps.append(effective)
    return AuthorityOverview(
        members=_members(db, ctx),
        capabilities=effective_caps,
        roles=_role_cards(ctx.project.id),
        scopes=list(_SCOPES),
        audit_enabled=True,
    )


@router.get("/{project_id}/authority/access", response_model=AuthorityAccessOut)
def authority_access(
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> AuthorityAccessOut:
    """Restricted documents and who is explicitly granted access (head only)."""
    if not can_manage_authority(ctx.role):
        raise PermissionError_("Only the project head can manage document access.")

    documents = db.scalars(
        select(Document)
        .where(
            Document.project_id == ctx.project.id,
            Document.access_scope == AccessScope.RESTRICTED,
        )
        .order_by(Document.original_name)
    ).all()

    grants_by_doc: dict[uuid.UUID, list[AuthorityGrantOut]] = {doc.id: [] for doc in documents}
    if documents:
        rows = db.execute(
            select(
                document_grants.c.document_id,
                document_grants.c.user_id,
                document_grants.c.granted_by,
                User.name,
                User.email,
            )
            .join(User, User.id == document_grants.c.user_id)
            .where(document_grants.c.document_id.in_(list(grants_by_doc)))
            .order_by(User.name)
        ).all()
        for row in rows:
            grants_by_doc[row.document_id].append(
                AuthorityGrantOut(
                    user_id=row.user_id,
                    name=row.name,
                    email=row.email,
                    granted_by=row.granted_by,
                )
            )

    return AuthorityAccessOut(
        documents=[
            AuthorityDocumentAccess(
                document_id=doc.id,
                name=doc.original_name,
                kind=doc.kind,
                status=doc.status,
                grants=grants_by_doc.get(doc.id, []),
            )
            for doc in documents
        ]
    )


@router.get("/{project_id}/authority/me")
def authority_me(
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> dict:
    """Per-caller capability flags — the frontend disables buttons from this."""
    is_owner = _caller_is_workspace_owner(ctx, db)
    can = {
        cap.key: (ctx.role.value in _effective_roles(cap, ctx.project.id))
        or (cap.workspace_owner_allowed and is_owner)
        for cap in CAPABILITIES
    }
    return {
        "project_role": str(ctx.role),
        "workspace_role": str(ctx.ws_role),
        "is_workspace_owner": is_owner,
        "can": can,
        "limitations": list(_ROLE_LIMITATIONS[ctx.role]),
    }


@router.patch("/{project_id}/authority/capabilities")
def update_capability(
    project_id: uuid.UUID,
    payload: CapabilityUpdateIn,
    ctx: ProjectContext = Depends(project_context),
) -> dict:
    """Toggle one capability on/off for one project role. Head only."""
    if not can_manage_authority(ctx.role):
        raise PermissionError_("Only the project head can edit authority capabilities.")
    # Validate the capability key exists.
    cap_keys = {c.key for c in CAPABILITIES}
    if payload.key not in cap_keys:
        raise ValueError(f"Unknown capability key: {payload.key}")
    project_overrides = _custom_capabilities.setdefault(project_id, {})
    role_overrides = project_overrides.setdefault(payload.key, {})
    role_overrides[payload.role.value] = payload.enabled
    # Clean up empty overrides.
    if not role_overrides:
        project_overrides.pop(payload.key, None)
    if not project_overrides:
        _custom_capabilities.pop(project_id, None)
    return {
        "key": payload.key,
        "role": payload.role.value,
        "enabled": payload.enabled,
        "effective_roles": _effective_roles(
            next(c for c in CAPABILITIES if c.key == payload.key), project_id
        ),
    }
