"""FastAPI dependencies: session auth, project context, error mapping."""
from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import datetime, timezone

from fastapi import Depends, Request
from fastapi.security.utils import get_authorization_scheme_param
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import hash_token
from app.db.models import Project, Session as SessionRow, User, Workspace
from app.db.session import get_db
from app.domain.enums import ProjectRole, WorkspaceRole
from app.services.permissions import (
    NotFoundError,
    PermissionError_,
    get_workspace_member,
    require_project,
    require_workspace,
)

__all__ = [
    "get_db",
    "current_user",
    "CurrentSession",
    "project_context",
    "ProjectContext",
    "WorkspaceContext",
    "workspace_context",
    "SessionCookie",
]


class SessionCookie:
    """Reads and validates the httpOnly session cookie."""

    def __init__(self, db: Session, request: Request):
        self.db = db
        self.request = request
        settings = get_settings()
        self.cookie_name = settings.session_cookie_name

    @property
    def raw_token(self) -> str | None:
        return self.request.cookies.get(self.cookie_name)

    def issue(self, response, token: str) -> None:
        settings = get_settings()
        response.set_cookie(
            key=self.cookie_name,
            value=token,
            max_age=settings.session_ttl_hours * 3600,
            httponly=True,
            samesite="lax",
            secure=False,  # local http dev; set true behind TLS in production
            path="/",
        )

    def clear(self, response) -> None:
        response.delete_cookie(key=self.cookie_name, path="/")


class CurrentSession:
    """Validated session context for the caller."""

    def __init__(self, user: User, session_row: SessionRow):
        self.user = user
        self.session_row = session_row


def current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> CurrentSession:
    """Resolve the authenticated user or raise 401.

    Supports the httpOnly cookie (primary) and `Authorization: Bearer` (tests/tools).
    """
    settings = get_settings()
    token: str | None = request.cookies.get(settings.session_cookie_name)
    if not token:
        auth = request.headers.get("Authorization", "")
        scheme, value = get_authorization_scheme_param(auth)
        if scheme.lower() == "bearer" and value:
            token = value
    if not token:
        raise PermissionError_("Not authenticated.")  # mapped to 401 by handler

    token_hash = hash_token(token)
    row = db.scalar(
        select(SessionRow).where(SessionRow.token_hash == token_hash)
    )
    if row is None:
        raise PermissionError_("Not authenticated.")
    expires = row.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        raise PermissionError_("Session expired.")
    user = db.get(User, row.user_id)
    if user is None or not user.is_active:
        raise PermissionError_("Account is inactive.")
    return CurrentSession(user=user, session_row=row)


class ProjectContext:
    """Caller + project + effective roles (all permission decisions use this)."""

    def __init__(self, user: User, project: Project, role: ProjectRole,
                 ws_role: WorkspaceRole, session: CurrentSession):
        self.user = user
        self.project = project
        self.role = role
        self.ws_role = ws_role
        self.session = session


def project_context(
    project_id: uuid.UUID,
    ctx: CurrentSession = Depends(current_user),
    db: Session = Depends(get_db),
) -> ProjectContext:
    project, role = require_project(db, ctx.user, project_id)
    ws_member = get_workspace_member(db, ctx.user.id, project.workspace_id)
    ws_role = WorkspaceRole(ws_member.role) if ws_member else WorkspaceRole.MEMBER
    return ProjectContext(
        user=ctx.user, project=project, role=role, ws_role=ws_role, session=ctx
    )


class WorkspaceContext:
    def __init__(self, user: User, workspace: Workspace, role: WorkspaceRole,
                 session: CurrentSession):
        self.user = user
        self.workspace = workspace
        self.role = role
        self.session = session


def workspace_context(
    workspace_id: uuid.UUID,
    ctx: CurrentSession = Depends(current_user),
    db: Session = Depends(get_db),
) -> WorkspaceContext:
    ws, role = require_workspace(db, ctx.user, workspace_id)
    return WorkspaceContext(user=ctx.user, workspace=ws, role=role, session=ctx)
