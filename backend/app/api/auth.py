"""Auth routes: signup, login, logout, session."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.deps import CurrentSession, current_user, get_db
from app.core.security import (
    hash_password,
    needs_rehash,
    new_session_token,
    verify_password,
)
from app.db.base import utcnow
from app.db.models import User, Workspace, WorkspaceMember
from app.db.models import Session as SessionRow
from app.domain.enums import MemberStatus, WorkspaceRole
from app.schemas.auth import LoginIn, SessionOut, SignupIn, UserOut
from app.services import audit
from app.services.permissions import PermissionError_

router = APIRouter()


def _unique_slug(db: Session, name: str) -> str:
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


def _set_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=settings.session_ttl_hours * 3600,
        httponly=True,
        samesite="lax",
        secure=False,  # local http; set True behind TLS in production
        path="/",
    )


def _open_session(
    db: Session, response: Response, user: User, user_agent: str | None = None
) -> None:
    token, token_hash = new_session_token()
    db.add(
        SessionRow(
            id=uuid.uuid4(),
            user_id=user.id,
            token_hash=token_hash,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=72),
            user_agent=(user_agent or "")[:255] or None,
            created_at=utcnow(),
        )
    )
    db.commit()
    _set_cookie(response, token)


def _session_out(db: Session, user: User) -> SessionOut:
    rows = db.execute(
        select(WorkspaceMember, Workspace)
        .join(Workspace, Workspace.id == WorkspaceMember.workspace_id)
        .where(
            WorkspaceMember.user_id == user.id,
            WorkspaceMember.status == MemberStatus.ACTIVE,
        )
        .order_by(Workspace.created_at)
    ).all()
    workspaces = [
        {
            "id": str(ws.id),
            "name": ws.name,
            "slug": ws.slug,
            "role": str(member.role),
        }
        for member, ws in rows
    ]
    return SessionOut(
        user=UserOut.model_validate(user),
        primary_workspace_id=rows[0][1].id if rows else None,
        workspaces=workspaces,
    )


@router.post("/signup", response_model=SessionOut)
def signup(payload: SignupIn, response: Response, db: Session = Depends(get_db)) -> SessionOut:
    """Create an account, a personal workspace for it, and start a session."""
    existing = db.scalar(
        select(User).where(func.lower(User.email) == payload.email.lower())
    )
    if existing is not None:
        raise PermissionError_("An account with that email already exists.")

    user = User(
        id=uuid.uuid4(),
        email=payload.email.lower(),
        name=payload.name,
        password_hash=hash_password(payload.password),
        title=payload.title,
        is_active=True,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(user)
    db.flush()

    ws_name = (payload.workspace_name or f"{payload.name.split()[0]}'s workspace").strip()
    workspace = Workspace(
        id=uuid.uuid4(),
        name=ws_name,
        description=None,
        owner_id=user.id,
        slug=_unique_slug(db, ws_name),
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(workspace)
    db.flush()
    db.add(
        WorkspaceMember(
            id=uuid.uuid4(),
            workspace_id=workspace.id,
            user_id=user.id,
            role=WorkspaceRole.OWNER,
            status=MemberStatus.ACTIVE,
            created_at=utcnow(),
            updated_at=utcnow(),
        )
    )
    audit.record(
        db, action=audit.A.WORKSPACE_CREATE, actor_id=user.id,
        workspace_id=workspace.id, target_type="workspace",
        target_id=workspace.id, summary=f"Workspace '{ws_name}' created",
    )
    audit.record(
        db, action=audit.A.SIGNUP, actor_id=user.id, workspace_id=workspace.id,
        target_type="user", target_id=user.id, summary=f"{user.name} signed up",
    )
    db.flush()

    _open_session(db, response, user)
    return _session_out(db, user)


@router.post("/login", response_model=SessionOut)
def login(payload: LoginIn, response: Response, db: Session = Depends(get_db)) -> SessionOut:
    user = db.scalar(select(User).where(func.lower(User.email) == payload.email.lower()))
    if user is None or not user.is_active or not verify_password(
        user.password_hash, payload.password
    ):
        raise PermissionError_("Email or password is incorrect.")
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(payload.password)

    audit.record(
        db, action=audit.A.LOGIN, actor_id=user.id,
        target_type="user", target_id=user.id, summary=f"{user.name} signed in",
    )
    _open_session(db, response, user)
    return _session_out(db, user)


@router.post("/logout")
def logout(
    response: Response,
    ctx: CurrentSession = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    row = db.get(SessionRow, ctx.session_row.id)
    if row is not None:
        db.delete(row)
    audit.record(
        db, action=audit.A.LOGOUT, actor_id=ctx.user.id,
        target_type="user", target_id=ctx.user.id, summary=f"{ctx.user.name} signed out",
    )
    db.commit()
    response.delete_cookie(key=get_settings().session_cookie_name, path="/")
    return {"ok": True}


@router.get("/me", response_model=SessionOut)
def me(
    ctx: CurrentSession = Depends(current_user),
    db: Session = Depends(get_db),
) -> SessionOut:
    return _session_out(db, ctx.user)
