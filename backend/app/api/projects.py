"""Project routes: CRUD, members, counts."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import (
    CurrentSession,
    ProjectContext,
    WorkspaceContext,
    current_user,
    get_db,
    project_context,
    workspace_context,
)
from app.db.base import utcnow
from app.db.models import (
    Document,
    Handover,
    KnowledgeItem,
    Project,
    ProjectMember,
    User,
    WorkspaceMember,
)
from app.domain.enums import (
    HandoverStatus,
    KnowledgeType,
    MemberStatus,
    ProjectRole,
    ReviewState,
    WorkspaceRole,
)
from app.schemas.common import Counts
from app.schemas.project import (
    ProjectCreateIn,
    ProjectMemberAddIn,
    ProjectMemberOut,
    ProjectMemberUpdateIn,
    ProjectOut,
    ProjectUpdateIn,
)
from app.services import audit
from app.services.permissions import (
    NotFoundError,
    PermissionError_,
    can_manage_authority,
    can_manage_members,
    can_manage_project,
    effective_project_role,
)

router = APIRouter()


def _counts(db: Session, project_id: uuid.UUID) -> Counts:
    documents = db.scalar(
        select(func.count(Document.id)).where(Document.project_id == project_id)
    ) or 0
    chunks = db.scalar(
        select(func.sum(Document.chunk_count)).where(Document.project_id == project_id)
    ) or 0
    knowledge = db.scalar(
        select(func.count(KnowledgeItem.id)).where(KnowledgeItem.project_id == project_id)
    ) or 0
    pending = db.scalar(
        select(func.count(KnowledgeItem.id)).where(
            KnowledgeItem.project_id == project_id,
            KnowledgeItem.review_state == ReviewState.PENDING,
        )
    ) or 0
    handovers = db.scalar(
        select(func.count(Handover.id)).where(
            Handover.project_id == project_id,
            Handover.status.notin_([HandoverStatus.ARCHIVED]),
        )
    ) or 0
    open_tasks = db.scalar(
        select(func.count(KnowledgeItem.id)).where(
            KnowledgeItem.project_id == project_id,
            KnowledgeItem.type == KnowledgeType.TASK,
            KnowledgeItem.review_state != ReviewState.REJECTED,
        )
    ) or 0
    gaps = db.scalar(
        select(func.count(KnowledgeItem.id)).where(
            KnowledgeItem.project_id == project_id,
            KnowledgeItem.type == KnowledgeType.GAP,
        )
    ) or 0
    members = db.scalar(
        select(func.count(ProjectMember.id)).where(
            ProjectMember.project_id == project_id,
            ProjectMember.status == MemberStatus.ACTIVE,
        )
    ) or 0
    return Counts(
        documents=documents, chunks=int(chunks or 0), knowledge=knowledge,
        pending_review=pending, handovers=handovers, open_tasks=open_tasks,
        gaps=gaps, members=members,
    )


def _project_out(db: Session, project: Project, my_role: ProjectRole | None) -> ProjectOut:
    out = ProjectOut.model_validate(project)
    out.counts = _counts(db, project.id)
    out.my_role = my_role
    return out


@router.get("", response_model=list[ProjectOut])
def list_projects(
    workspace_id: uuid.UUID,
    ctx: CurrentSession = Depends(current_user),
    db: Session = Depends(get_db),
) -> list[ProjectOut]:
    """Projects the caller can actually see (membership-enforced)."""
    ws_member = db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == ctx.user.id,
            WorkspaceMember.status == MemberStatus.ACTIVE,
        )
    )
    if ws_member is None:
        raise NotFoundError()
    is_owner = ws_member.role == WorkspaceRole.OWNER

    if is_owner:
        rows = db.scalars(
            select(Project)
            .where(Project.workspace_id == workspace_id, Project.archived.is_(False))
            .order_by(Project.created_at)
        ).all()
        return [_project_out(db, p, ProjectRole.HEAD) for p in rows]

    rows = db.execute(
        select(Project, ProjectMember.role)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .where(
            Project.workspace_id == workspace_id,
            Project.archived.is_(False),
            ProjectMember.user_id == ctx.user.id,
            ProjectMember.status == MemberStatus.ACTIVE,
        )
        .order_by(Project.created_at)
    ).all()
    return [_project_out(db, p, ProjectRole(role)) for p, role in rows]


@router.post("", response_model=ProjectOut)
def create_project(
    payload: ProjectCreateIn,
    ctx: WorkspaceContext = Depends(workspace_context),
    db: Session = Depends(get_db),
) -> ProjectOut:
    if ctx.role not in {WorkspaceRole.OWNER, WorkspaceRole.LEAD}:
        raise PermissionError_("Only the workspace owner or a lead can create projects.")
    project = Project(
        id=uuid.uuid4(),
        workspace_id=ctx.workspace.id,
        name=payload.name,
        description=payload.description,
        owner_id=ctx.user.id,
        archived=False,
        tags=payload.tags,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(project)
    db.flush()
    # creator becomes project head member
    db.add(
        ProjectMember(
            id=uuid.uuid4(), project_id=project.id, user_id=ctx.user.id,
            role=ProjectRole.HEAD, status=MemberStatus.ACTIVE,
            responsibility="Project head", created_at=utcnow(), updated_at=utcnow(),
        )
    )
    audit.record(
        db, action=audit.A.PROJECT_CREATE, actor_id=ctx.user.id,
        workspace_id=ctx.workspace.id, project_id=project.id,
        target_type="project", target_id=project.id,
        summary=f"Project '{project.name}' created",
    )
    db.commit()
    return _project_out(db, project, ProjectRole.HEAD)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> ProjectOut:
    return _project_out(db, ctx.project, ctx.role)


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(
    payload: ProjectUpdateIn,
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> ProjectOut:
    if not can_manage_project(ctx.role):
        raise PermissionError_("Only a project head or lead can edit this project.")
    project = ctx.project
    changed: dict = {}
    if payload.name is not None and payload.name != project.name:
        changed["name"] = {"from": project.name, "to": payload.name}
        project.name = payload.name
    if payload.description is not None:
        project.description = payload.description
    if payload.tags is not None:
        project.tags = payload.tags
    if payload.archived is not None:
        project.archived = payload.archived
    if changed:
        audit.record(
            db, action=audit.A.PROJECT_UPDATE, actor_id=ctx.user.id,
            workspace_id=project.workspace_id, project_id=project.id,
            target_type="project", target_id=project.id,
            summary="Project updated", meta=changed,
        )
    db.commit()
    return _project_out(db, project, ctx.role)


# --- project members -------------------------------------------------------

@router.get("/{project_id}/members", response_model=list[ProjectMemberOut])
def list_project_members(
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> list[ProjectMemberOut]:
    rows = db.execute(
        select(ProjectMember, User)
        .join(User, User.id == ProjectMember.user_id)
        .where(
            ProjectMember.project_id == ctx.project.id,
            ProjectMember.status == MemberStatus.ACTIVE,
        )
        .order_by(ProjectMember.created_at)
    ).all()
    return [
        ProjectMemberOut(
            id=m.id, project_id=m.project_id, user_id=m.user_id,
            role=ProjectRole(m.role), status=MemberStatus(m.status),
            responsibility=m.responsibility,
            name=u.name, email=u.email, title=u.title,
        )
        for m, u in rows
    ]


@router.post("/{project_id}/members", response_model=ProjectMemberOut)
def add_project_member(
    payload: ProjectMemberAddIn,
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> ProjectMemberOut:
    if not can_manage_members(ctx.role):
        raise PermissionError_("Only a project head or lead can add members.")
    if payload.role == ProjectRole.HEAD and ctx.role != ProjectRole.HEAD:
        raise PermissionError_("Only a project head can appoint another head.")

    user = db.scalar(select(User).where(func.lower(User.email) == payload.email.lower()))
    if user is None:
        raise NotFoundError("No account with that email. Send a workspace invitation first.")
    ws_member = db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == ctx.project.workspace_id,
            WorkspaceMember.user_id == user.id,
            WorkspaceMember.status == MemberStatus.ACTIVE,
        )
    )
    if ws_member is None:
        raise PermissionError_("That person must be a workspace member first.")

    existing = db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == ctx.project.id,
            ProjectMember.user_id == user.id,
        )
    )
    if existing is not None:
        existing.role = payload.role
        existing.status = MemberStatus.ACTIVE
        existing.responsibility = payload.responsibility
        member = existing
    else:
        member = ProjectMember(
            id=uuid.uuid4(), project_id=ctx.project.id, user_id=user.id,
            role=payload.role, status=MemberStatus.ACTIVE,
            responsibility=payload.responsibility,
            created_at=utcnow(), updated_at=utcnow(),
        )
        db.add(member)
    audit.record(
        db, action=audit.A.PROJECT_MEMBER_ADD, actor_id=ctx.user.id,
        workspace_id=ctx.project.workspace_id, project_id=ctx.project.id,
        target_type="user", target_id=user.id,
        summary=f"{user.name} added as {payload.role.value}",
        meta={"role": payload.role.value, "responsibility": payload.responsibility},
    )
    db.commit()
    return ProjectMemberOut(
        id=member.id, project_id=member.project_id, user_id=member.user_id,
        role=ProjectRole(member.role), status=MemberStatus(member.status),
        responsibility=member.responsibility,
        name=user.name, email=user.email, title=user.title,
    )


@router.patch("/{project_id}/members/{user_id}", response_model=ProjectMemberOut)
def update_project_member(
    user_id: uuid.UUID,
    payload: ProjectMemberUpdateIn,
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> ProjectMemberOut:
    if not can_manage_authority(ctx.role):
        raise PermissionError_("Only the project head can change roles or responsibilities.")
    member = db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == ctx.project.id,
            ProjectMember.user_id == user_id,
        )
    )
    if member is None:
        raise NotFoundError()
    if (
        ProjectRole(member.role) == ProjectRole.HEAD
        and ctx.role != ProjectRole.HEAD
        and payload.role is not None
        and payload.role != ProjectRole.HEAD
    ):
        raise PermissionError_("Only a project head can change another head's role.")
    if payload.role is not None:
        member.role = payload.role.value
    if payload.responsibility is not None:
        member.responsibility = payload.responsibility
    if payload.status is not None:
        if user_id == ctx.user.id and payload.status != MemberStatus.ACTIVE:
            raise PermissionError_("You cannot deactivate your own membership.")
        member.status = payload.status.value
    audit.record(
        db, action=audit.A.PROJECT_MEMBER_UPDATE, actor_id=ctx.user.id,
        workspace_id=ctx.project.workspace_id, project_id=ctx.project.id,
        target_type="user", target_id=user_id,
        summary="Member updated",
        meta={k: v for k, v in payload.model_dump(exclude_none=True).items() if v is not None},
    )
    db.commit()
    user = db.get(User, user_id)
    return ProjectMemberOut(
        id=member.id, project_id=member.project_id, user_id=member.user_id,
        role=ProjectRole(member.role), status=MemberStatus(member.status),
        responsibility=member.responsibility,
        name=user.name if user else "", email=user.email if user else "",
        title=user.title if user else None,
    )
