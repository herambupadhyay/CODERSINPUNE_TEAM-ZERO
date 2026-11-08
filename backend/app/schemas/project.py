"""Project + project membership schemas."""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import Field

from app.domain.enums import MemberStatus, ProjectRole
from app.schemas.common import ApiModel, Counts


class ProjectCreateIn(ApiModel):
    name: str = Field(min_length=1, max_length=140)
    description: str | None = Field(default=None, max_length=1000)
    tags: list[str] = []


class ProjectUpdateIn(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=140)
    description: str | None = Field(default=None, max_length=1000)
    tags: list[str] | None = None
    archived: bool | None = None


class ProjectOut(ApiModel):
    id: UUID
    workspace_id: UUID
    name: str
    description: str | None = None
    tags: list[str] = []
    archived: bool = False
    created_at: datetime | None = None
    counts: Counts = Counts()
    # caller's effective role on this project
    my_role: ProjectRole | None = None


class ProjectMemberAddIn(ApiModel):
    email: str = Field(max_length=255)
    role: ProjectRole = ProjectRole.MEMBER
    responsibility: str | None = Field(default=None, max_length=140)


class ProjectMemberOut(ApiModel):
    id: UUID
    project_id: UUID
    user_id: UUID
    role: ProjectRole
    status: MemberStatus
    responsibility: str | None = None
    name: str = ""
    email: str = ""
    title: str | None = None


class ProjectMemberUpdateIn(ApiModel):
    role: ProjectRole | None = None
    responsibility: str | None = Field(default=None, max_length=140)
    status: MemberStatus | None = None


__all__ = [
    "ProjectCreateIn", "ProjectUpdateIn", "ProjectOut",
    "ProjectMemberAddIn", "ProjectMemberOut", "ProjectMemberUpdateIn",
]
