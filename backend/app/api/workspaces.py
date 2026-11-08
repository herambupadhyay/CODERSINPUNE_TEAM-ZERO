"""Workspace routes: list/create, members, role changes, invitations."""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import (
    CurrentSession,
    WorkspaceContext,
    current_user,
    get_db,
    workspace_context,
)
from app.db.base import utcnow
from app.db.models import (
    Invitation,
    Project,
    ProjectMember,
    User,
    Workspace,
    WorkspaceMember,
)
from app.domain.enums import MemberStatus, WorkspaceRole
from app.schemas.common import OkResponse
from app.schemas.workspace import (
    InvitationOut,
    InviteIn,
    MemberRoleChangeIn,
    WorkspaceCreateIn,
    WorkspaceMemberOut,
    WorkspaceOut,
)
from app.services import audit
from app.services.permissions import (
    NotFoundError,
    PermissionError_,
    can_manage_members,
    can_reset_demo,
)

router = APIRouter()

INVITE_TTL_DAYS = 14


def _slugify(db: Session, name: str) -> str:
    base = "".join(c.lower() if c.isalnum() else "-" for c in name.strip())
    while "--" in base:
        base = base.replace("--", "-")
    base = base.strip("-") or "workspace"
    slug = base
    n = 2
    while db.scalar(select(Workspace.id).where(Workspace.slug == slug)) is not None:
        slug = f"{base}-{n}"
        n += 1
    return slug


def _workspace_out(db: Session, ws: Workspace) -> WorkspaceOut:
    member_count = db.scalar(
        select(func.count(WorkspaceMember.id)).where(
            WorkspaceMember.workspace_id == ws.id,
            WorkspaceMember.status == MemberStatus.ACTIVE,
        )
    ) or 0
    project_count = db.scalar(
        select(func.count(Project.id)).where(
            Project.workspace_id == ws.id, Project.archived.is_(False)
        )
    ) or 0
    out = WorkspaceOut.model_validate(ws)
    out.member_count = member_count
    out.project_count = project_count
    return out


@router.get("", response_model=list[WorkspaceOut])
def list_workspaces(
    ctx: CurrentSession = Depends(current_user),
    db: Session = Depends(get_db),
) -> list[WorkspaceOut]:
    rows = db.execute(
        select(Workspace, WorkspaceMember)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(
            WorkspaceMember.user_id == ctx.user.id,
            WorkspaceMember.status == MemberStatus.ACTIVE,
        )
        .order_by(Workspace.created_at)
    ).all()
    return [_workspace_out(db, ws) for ws, _m in rows]


@router.post("", response_model=WorkspaceOut)
def create_workspace(
    payload: WorkspaceCreateIn,
    ctx: CurrentSession = Depends(current_user),
    db: Session = Depends(get_db),
) -> WorkspaceOut:
    ws = Workspace(
        id=uuid.uuid4(),
        name=payload.name,
        description=payload.description,
        owner_id=ctx.user.id,
        slug=_slugify(db, payload.name),
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(ws)
    db.flush()
    db.add(
        WorkspaceMember(
            id=uuid.uuid4(), workspace_id=ws.id, user_id=ctx.user.id,
            role=WorkspaceRole.OWNER, status=MemberStatus.ACTIVE,
            created_at=utcnow(), updated_at=utcnow(),
        )
    )
    audit.record(
        db, action=audit.A.WORKSPACE_CREATE, actor_id=ctx.user.id,
        workspace_id=ws.id, target_type="workspace", target_id=ws.id,
        summary=f"Workspace '{ws.name}' created",
    )
    db.commit()
    return _workspace_out(db, ws)


@router.get("/{workspace_id}", response_model=WorkspaceOut)
def get_workspace(
    ctx: WorkspaceContext = Depends(workspace_context),
    db: Session = Depends(get_db),
) -> WorkspaceOut:
    return _workspace_out(db, ctx.workspace)


@router.get("/{workspace_id}/members", response_model=list[WorkspaceMemberOut])
def list_members(
    ctx: WorkspaceContext = Depends(workspace_context),
    db: Session = Depends(get_db),
) -> list[WorkspaceMemberOut]:
    rows = db.execute(
        select(WorkspaceMember, User)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(
            WorkspaceMember.workspace_id == ctx.workspace.id,
            WorkspaceMember.status == MemberStatus.ACTIVE,
        )
        .order_by(WorkspaceMember.created_at)
    ).all()
    out: list[WorkspaceMemberOut] = []
    for member, user in rows:
        item = WorkspaceMemberOut(
            id=member.id, user_id=member.user_id,
            workspace_id=member.workspace_id, role=WorkspaceRole(member.role),
            status=MemberStatus(member.status),
            name=user.name, email=user.email, title=user.title,
        )
        out.append(item)
    return out


@router.patch("/{workspace_id}/members/{user_id}", response_model=WorkspaceMemberOut)
def change_member_role(
    user_id: uuid.UUID,
    payload: MemberRoleChangeIn,
    ctx: WorkspaceContext = Depends(workspace_context),
    db: Session = Depends(get_db),
) -> WorkspaceMemberOut:
    if not can_manage_members(ctx.role):
        raise PermissionError_("Only the workspace owner or a lead can change roles.")
    if user_id == ctx.workspace.owner_id and payload.role != WorkspaceRole.OWNER:
        raise PermissionError_("The workspace owner's role cannot be downgraded here.")

    member = db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == ctx.workspace.id,
            WorkspaceMember.user_id == user_id,
        )
    )
    if member is None:
        raise NotFoundError()
    previous = str(member.role)
    member.role = payload.role.value
    audit.record(
        db, action=audit.A.WORKSPACE_MEMBER_ROLE, actor_id=ctx.user.id,
        workspace_id=ctx.workspace.id, target_type="workspace_member",
        target_id=member.id,
        summary=f"Role changed to '{payload.role.value}'",
        meta={"previous": previous, "new": payload.role.value},
    )
    db.commit()
    user = db.get(User, user_id)
    return WorkspaceMemberOut(
        id=member.id, user_id=member.user_id, workspace_id=member.workspace_id,
        role=WorkspaceRole(member.role), status=MemberStatus(member.status),
        name=user.name if user else "", email=user.email if user else "",
        title=user.title if user else None,
    )


@router.post("/{workspace_id}/invitations", response_model=InvitationOut)
def invite_member(
    payload: InviteIn,
    ctx: WorkspaceContext = Depends(workspace_context),
    db: Session = Depends(get_db),
) -> InvitationOut:
    if not can_manage_members(ctx.role):
        raise PermissionError_("Only the workspace owner or a lead can invite members.")

    email = payload.email.lower()
    existing_user = db.scalar(select(User).where(func.lower(User.email) == email))
    if existing_user is not None:
        already = db.scalar(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == ctx.workspace.id,
                WorkspaceMember.user_id == existing_user.id,
            )
        )
        if already is not None:
            raise PermissionError_("That person is already in this workspace.")
        # add immediately — account exists
        db.add(
            WorkspaceMember(
                id=uuid.uuid4(), workspace_id=ctx.workspace.id,
                user_id=existing_user.id, role=payload.role,
                status=MemberStatus.ACTIVE,
                created_at=utcnow(), updated_at=utcnow(),
            )
        )
        audit.record(
            db, action=audit.A.WORKSPACE_MEMBER_ADD, actor_id=ctx.user.id,
            workspace_id=ctx.workspace.id, target_type="user",
            target_id=existing_user.id,
            summary=f"{existing_user.name} added to the workspace",
            meta={"role": payload.role.value},
        )
        db.commit()
        return InvitationOut(
            id=uuid.uuid4(), email=existing_user.email, role=payload.role,
            token="", expires_at=datetime.now(timezone.utc),
            accepted_at=datetime.now(timezone.utc),
        )

    invite = Invitation(
        id=uuid.uuid4(),
        workspace_id=ctx.workspace.id,
        email=email,
        role=payload.role,
        token=secrets.token_urlsafe(24),
        invited_by=ctx.user.id,
        accepted_at=None,
        expires_at=datetime.now(timezone.utc) + timedelta(days=INVITE_TTL_DAYS),
    )
    db.add(invite)
    audit.record(
        db, action=audit.A.WORKSPACE_MEMBER_ADD, actor_id=ctx.user.id,
        workspace_id=ctx.workspace.id, target_type="invitation",
        target_id=invite.id, summary=f"Invited {email}",
        meta={"role": payload.role.value},
    )
    db.commit()
    return InvitationOut.model_validate(invite)


@router.post("/invitations/accept", response_model=WorkspaceMemberOut)
def accept_invitation(
    token: str,
    ctx: CurrentSession = Depends(current_user),
    db: Session = Depends(get_db),
) -> WorkspaceMemberOut:
    invite = db.scalar(select(Invitation).where(Invitation.token == token))
    if invite is None or invite.accepted_at is not None:
        raise NotFoundError("Invitation not found.")
    if invite.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        raise PermissionError_("That invitation has expired.")
    if invite.email.lower() != ctx.user.email.lower():
        raise PermissionError_("This invitation was issued to a different email address.")

    existing = db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == invite.workspace_id,
            WorkspaceMember.user_id == ctx.user.id,
        )
    )
    if existing is None:
        existing = WorkspaceMember(
            id=uuid.uuid4(), workspace_id=invite.workspace_id,
            user_id=ctx.user.id, role=invite.role, status=MemberStatus.ACTIVE,
            created_at=utcnow(), updated_at=utcnow(),
        )
        db.add(existing)
    invite.accepted_at = datetime.now(timezone.utc)
    db.commit()
    return WorkspaceMemberOut(
        id=existing.id, user_id=existing.user_id, workspace_id=existing.workspace_id,
        role=WorkspaceRole(existing.role), status=MemberStatus(existing.status),
        name=ctx.user.name, email=ctx.user.email, title=ctx.user.title,
    )


@router.get("/{workspace_id}/invitations", response_model=list[InvitationOut])
def list_invitations(
    ctx: WorkspaceContext = Depends(workspace_context),
    db: Session = Depends(get_db),
) -> list[InvitationOut]:
    if not can_manage_members(ctx.role):
        raise PermissionError_("Only owners and leads can view invitations.")
    rows = db.scalars(
        select(Invitation)
        .where(
            Invitation.workspace_id == ctx.workspace.id,
            Invitation.accepted_at.is_(None),
        )
        .order_by(Invitation.created_at.desc())
    ).all()
    return [InvitationOut.model_validate(r) for r in rows]
