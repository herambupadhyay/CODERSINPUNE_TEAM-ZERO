"""Activity feed: read-only view over the audit trail (project or workspace scope)."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import CurrentSession, current_user, get_db
from app.db.models import AuditEvent, User
from app.schemas.assistant import ActivityOut
from app.services.permissions import require_project, require_workspace

router = APIRouter()


@router.get("/activity", response_model=list[ActivityOut])
def list_activity(
    project_id: uuid.UUID | None = None,
    workspace_id: uuid.UUID | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    ctx: CurrentSession = Depends(current_user),
    db: Session = Depends(get_db),
) -> list[ActivityOut]:
    if project_id is not None:
        # 404 unless the caller is a member — existence is never leaked
        require_project(db, ctx.user, project_id)
        scope = AuditEvent.project_id == project_id
    elif workspace_id is not None:
        require_workspace(db, ctx.user, workspace_id)
        # project events carry workspace_id too, so the column filter is enough
        scope = AuditEvent.workspace_id == workspace_id
    else:
        raise ValueError("Provide project_id or workspace_id.")

    rows = db.execute(
        select(AuditEvent, User.name)
        .join(User, User.id == AuditEvent.actor_id, isouter=True)  # actor may be system/removed
        .where(scope)
        .order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return [
        ActivityOut(
            id=event.id,
            action=event.action,
            actor_id=event.actor_id,
            actor_name=name,
            actor_type=event.actor_type,
            target_type=event.target_type,
            target_id=event.target_id,
            summary=event.summary,
            meta=event.meta,
            created_at=event.created_at,
        )
        for event, name in rows
    ]
