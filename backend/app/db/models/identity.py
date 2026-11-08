"""Identity & tenancy models: users, sessions, workspaces, projects, membership."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, Timestamped, UUIDPk
from app.domain.enums import MemberStatus, ProjectRole, WorkspaceRole


class User(UUIDPk, Timestamped, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(512))
    title: Mapped[str | None] = mapped_column(String(120), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    sessions: Mapped[list["Session"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )


class Session(UUIDPk, Base):
    __tablename__ = "sessions"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(back_populates="sessions")


class Workspace(UUIDPk, Timestamped, Base):
    __tablename__ = "workspaces"

    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    slug: Mapped[str] = mapped_column(String(140), unique=True, index=True)

    members: Mapped[list["WorkspaceMember"]] = relationship(
        back_populates="workspace", cascade="all, delete-orphan", passive_deletes=True
    )
    projects: Mapped[list["Project"]] = relationship(
        back_populates="workspace", cascade="all, delete-orphan", passive_deletes=True
    )


class WorkspaceMember(UUIDPk, Timestamped, Base):
    __tablename__ = "workspace_members"
    __table_args__ = (
        UniqueConstraint("workspace_id", "user_id", name="uq_ws_member"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(40), default=WorkspaceRole.MEMBER)
    status: Mapped[str] = mapped_column(String(40), default=MemberStatus.ACTIVE)

    workspace: Mapped[Workspace] = relationship(back_populates="members")
    user: Mapped[User] = relationship()


class Project(UUIDPk, Timestamped, Base):
    __tablename__ = "projects"
    __table_args__ = (Index("ix_projects_workspace_archived", "workspace_id", "archived"),)

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(140))
    description: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    tags: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    workspace: Mapped[Workspace] = relationship(back_populates="projects")
    members: Mapped[list["ProjectMember"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", passive_deletes=True
    )


class ProjectMember(UUIDPk, Timestamped, Base):
    __tablename__ = "project_members"
    __table_args__ = (
        UniqueConstraint("project_id", "user_id", name="uq_project_member"),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(40), default=ProjectRole.MEMBER)
    status: Mapped[str] = mapped_column(String(40), default=MemberStatus.ACTIVE)
    # responsibility label, e.g. "Backend Developer"
    responsibility: Mapped[str | None] = mapped_column(String(140), nullable=True)

    project: Mapped[Project] = relationship(back_populates="members")
    user: Mapped[User] = relationship()


class Invitation(UUIDPk, Timestamped, Base):
    __tablename__ = "invitations"

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    email: Mapped[str] = mapped_column(String(255), index=True)
    role: Mapped[str] = mapped_column(String(40), default=WorkspaceRole.MEMBER)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    invited_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    accepted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
