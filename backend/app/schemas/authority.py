"""Authority Intelligence schemas: roles, scopes, capability matrix."""
from __future__ import annotations

from uuid import UUID

from pydantic import Field

from app.domain.enums import AccessScope, ProjectRole, WorkspaceRole
from app.schemas.common import ApiModel


class CapabilityMatrixRow(ApiModel):
    """One capability and which roles may perform it (shown in the UI)."""

    key: str
    label: str
    description: str = ""
    roles: list[str] = []  # project roles allowed
    workspace_owner_allowed: bool = True


class RoleCard(ApiModel):
    role: ProjectRole
    label: str
    summary: str
    capabilities: list[str] = []
    limitations: list[str] = []


class ScopeCard(ApiModel):
    scope: AccessScope
    label: str
    description: str
    visible_to: list[str] = []


class AuthorityMemberOut(ApiModel):
    user_id: UUID
    name: str
    email: str
    ws_role: WorkspaceRole | None = None
    project_role: ProjectRole | None = None
    responsibility: str | None = None
    is_workspace_owner: bool = False
    document_grants: int = 0


class AuthorityOverview(ApiModel):
    members: list[AuthorityMemberOut]
    capabilities: list[CapabilityMatrixRow]
    roles: list[RoleCard]
    scopes: list[ScopeCard]
    audit_enabled: bool = True


class DelegationRequest(ApiModel):
    """Change a project member's role (audited)."""

    role: ProjectRole
    responsibility: str | None = Field(default=None, max_length=140)


__all__ = [
    "CapabilityMatrixRow", "RoleCard", "ScopeCard", "AuthorityMemberOut",
    "AuthorityOverview", "DelegationRequest",
]
