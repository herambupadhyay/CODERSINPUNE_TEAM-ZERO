"""Workspace / membership / invitation schemas."""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import EmailStr, Field

from app.domain.enums import MemberStatus, WorkspaceRole
from app.schemas.common import ApiModel


class WorkspaceCreateIn(ApiModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)


class WorkspaceOut(ApiModel):
    id: UUID
    name: str
    description: str | None = None
    slug: str
    owner_id: UUID
    member_count: int = 0
    project_count: int = 0
    created_at: datetime | None = None


class WorkspaceMemberOut(ApiModel):
    id: UUID
    user_id: UUID
    workspace_id: UUID
    role: WorkspaceRole
    status: MemberStatus
    name: str = ""
    email: str = ""
    title: str | None = None


class MemberRoleChangeIn(ApiModel):
    role: WorkspaceRole


class InviteIn(ApiModel):
    email: EmailStr
    role: WorkspaceRole = WorkspaceRole.MEMBER


class InvitationOut(ApiModel):
    id: UUID
    email: EmailStr
    role: WorkspaceRole
    token: str
    expires_at: datetime
    accepted_at: datetime | None = None


__all__ = [
    "WorkspaceCreateIn", "WorkspaceOut", "WorkspaceMemberOut",
    "MemberRoleChangeIn", "InviteIn", "InvitationOut",
]
