"""Audit trail — every meaningful action is recorded and queryable."""
from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.db.models import AuditEvent
from app.domain.enums import ActorType
from app.db.base import utcnow


def record(
    db: Session,
    *,
    action: str,
    actor_id: uuid.UUID | None = None,
    workspace_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    target_type: str | None = None,
    target_id: uuid.UUID | str | None = None,
    summary: str | None = None,
    meta: dict | None = None,
    actor_type: str = ActorType.USER,
    commit: bool = False,
) -> AuditEvent:
    event = AuditEvent(
        workspace_id=workspace_id,
        project_id=project_id,
        actor_id=actor_id,
        actor_type=actor_type,
        action=action,
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else None,
        summary=summary,
        meta=meta or {},
        created_at=utcnow(),
    )
    db.add(event)
    if commit:
        db.commit()
        db.refresh(event)
    return event


# Canonical action names (kept stable for the activity feed UI)
class A:
    SIGNUP = "auth.signup"
    LOGIN = "auth.login"
    LOGOUT = "auth.logout"
    WORKSPACE_CREATE = "workspace.create"
    WORKSPACE_MEMBER_ADD = "workspace.member.add"
    WORKSPACE_MEMBER_ROLE = "workspace.member.role"
    PROJECT_CREATE = "project.create"
    PROJECT_UPDATE = "project.update"
    PROJECT_MEMBER_ADD = "project.member.add"
    PROJECT_MEMBER_UPDATE = "project.member.update"
    DOCUMENT_UPLOAD = "document.upload"
    DOCUMENT_DELETE = "document.delete"
    DOCUMENT_SCOPE = "document.scope"
    DOCUMENT_GRANT = "document.grant"
    DOCUMENT_REVOKE = "document.revoke"
    DOCUMENT_PROCESS = "document.process"
    KNOWLEDGE_REVIEW = "knowledge.review"
    HANDOVER_CREATE = "handover.create"
    HANDOVER_GENERATE = "handover.generate"
    HANDOVER_SUBMIT = "handover.submit"
    HANDOVER_APPROVE = "handover.approve"
    HANDOVER_CHANGES = "handover.request_changes"
    HANDOVER_SHARE = "handover.share"
    HANDOVER_ARCHIVE = "handover.archive"
    HANDOVER_DELETE = "handover.delete"
    HANDOVER_FINDING_REVIEW = "handover.finding.review"
    ASSISTANT_MESSAGE = "assistant.message"
    DEMO_SEED = "demo.seed"
    DEMO_RESET = "demo.reset"


__all__ = ["record", "A"]
