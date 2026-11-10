"""Handover lifecycle routes: create, generate, review, share, export."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.deps import ProjectContext, get_db, project_context
from app.db.base import utcnow
from app.db.models import (
    Document,
    Handover,
    HandoverApproval,
    HandoverFinding,
    HandoverSection,
    HandoverShare,
    ProjectMember,
    User,
)
from app.domain.enums import (
    FindingReviewState,
    HandoverStatus,
    MemberStatus,
    WorkspaceRole,
)
from app.schemas.common import OkResponse
from app.schemas.handover import (
    HANDOVER_CATEGORIES,
    ApprovalOut,
    FindingOut,
    FindingReviewIn,
    HandoverActionIn,
    HandoverCreateIn,
    HandoverDetailOut,
    HandoverOut,
    HandoverUpdateIn,
    ImpactAnalysis,
)
from app.services import audit
from app.services.handover_gen import compute_impact, generate_handover
from app.services.permissions import (
    NotFoundError,
    PermissionError_,
    can_approve_handover,
    can_initiate_handover,
    can_review,
    can_view_handover,
    get_project_member,
    handover_share_ids,
)

router = APIRouter()

_EDIT_STATUSES = {HandoverStatus.DRAFT, HandoverStatus.CHANGES_REQUESTED}
_REVIEW_FINDING_STATUSES = {
    HandoverStatus.DRAFT,
    HandoverStatus.NEEDS_REVIEW,
    HandoverStatus.CHANGES_REQUESTED,
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _reviewer(ctx: ProjectContext) -> bool:
    return can_review(ctx.role) or ctx.ws_role == WorkspaceRole.OWNER


def _can_edit(ctx: ProjectContext, h: Handover) -> bool:
    return _reviewer(ctx) and h.status in _EDIT_STATUSES


def _can_dict(ctx: ProjectContext, h: Handover) -> dict:
    reviewer = _reviewer(ctx)
    edit_ok = reviewer and h.status in _EDIT_STATUSES
    approver = can_approve_handover(ctx.role) or ctx.ws_role == WorkspaceRole.OWNER
    is_head = ctx.role.value == "head"
    is_owner = ctx.ws_role == WorkspaceRole.OWNER
    return {
        "generate": edit_ok,
        "edit": edit_ok,
        "submit": edit_ok,
        "approve": approver and h.status == HandoverStatus.NEEDS_REVIEW,
        "request_changes": reviewer and h.status == HandoverStatus.NEEDS_REVIEW,
        "share": approver and h.status == HandoverStatus.APPROVED,
        "archive": approver,
        "review_findings": reviewer and h.status in _REVIEW_FINDING_STATUSES,
        "delete": is_head or is_owner,
        "export": True,
    }


def _load_handover(db: Session, ctx: ProjectContext, handover_id: uuid.UUID) -> Handover:
    """Load a handover of THIS project; invisible -> 404 (never 403)."""
    h = db.get(Handover, handover_id)
    if h is None or h.project_id != ctx.project.id:
        raise NotFoundError("Handover not found.")
    if not can_view_handover(
        ctx.user, h, ctx.role, ctx.ws_role, handover_share_ids(db, h.id)
    ):
        raise NotFoundError("Handover not found.")
    return h


def _names(db: Session, user_ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not user_ids:
        return {}
    rows = db.execute(select(User.id, User.name).where(User.id.in_(user_ids))).all()
    return {r[0]: r[1] for r in rows}


def _counts(db: Session, handover_ids: list[uuid.UUID]) -> tuple[dict, dict]:
    if not handover_ids:
        return {}, {}
    sec = dict(
        db.execute(
            select(HandoverSection.handover_id, func.count(HandoverSection.id))
            .where(HandoverSection.handover_id.in_(handover_ids))
            .group_by(HandoverSection.handover_id)
        ).all()
    )
    find = dict(
        db.execute(
            select(HandoverFinding.handover_id, func.count(HandoverFinding.id))
            .where(HandoverFinding.handover_id.in_(handover_ids))
            .group_by(HandoverFinding.handover_id)
        ).all()
    )
    return sec, find


def _out(
    db: Session, h: Handover,
    names: dict[uuid.UUID, str],
    sec_count: int, find_count: int,
) -> HandoverOut:
    out = HandoverOut.model_validate(h)
    out.departing_name = names.get(h.departing_user_id)
    out.successor_name = names.get(h.successor_user_id) if h.successor_user_id else None
    out.section_count = sec_count
    out.finding_count = find_count
    return out


def _detail(db: Session, ctx: ProjectContext, h: Handover) -> HandoverDetailOut:
    names = _names(db, {h.departing_user_id} | ({h.successor_user_id} if h.successor_user_id else set()))
    sec_counts, find_counts = _counts(db, [h.id])
    base = _out(db, h, names, int(sec_counts.get(h.id, 0)), int(find_counts.get(h.id, 0)))

    sections = db.scalars(
        select(HandoverSection)
        .where(HandoverSection.handover_id == h.id)
        .order_by(HandoverSection.position)
    ).all()
    findings = db.scalars(
        select(HandoverFinding)
        .where(HandoverFinding.handover_id == h.id)
        .order_by(HandoverFinding.section_key, HandoverFinding.position)
    ).all()
    approval_rows = db.execute(
        select(HandoverApproval, User.name)
        .outerjoin(User, User.id == HandoverApproval.actor_id)
        .where(HandoverApproval.handover_id == h.id)
        .order_by(HandoverApproval.created_at.asc())
    ).all()

    return HandoverDetailOut(
        **base.model_dump(),
        sections=[_sec_out(s) for s in sections],
        findings=[_finding_out(f) for f in findings],
        approvals=[
            ApprovalOut(
                id=a.id,
                actor_id=a.actor_id,
                actor_name=name,
                action=a.action,
                note=a.note,
                created_at=a.created_at,
            )
            for a, name in approval_rows
        ],
        can=_can_dict(ctx, h),
    )


def _sec_out(s: HandoverSection) -> dict:
    return {
        "id": s.id,
        "key": s.key,
        "title": s.title,
        "body": s.body,
        "position": s.position,
        "meta": s.meta or {},
    }


def _finding_out(f: HandoverFinding) -> FindingOut:
    return FindingOut.model_validate(f)


def _validate_categories(categories: list[str]) -> list[str]:
    unknown = [c for c in categories if c not in HANDOVER_CATEGORIES]
    if unknown:
        raise ValueError(
            f"Unknown categories: {', '.join(unknown)}. "
            f"Valid categories: {', '.join(HANDOVER_CATEGORIES)}."
        )
    # de-dupe, preserve order
    seen: set[str] = set()
    ordered: list[str] = []
    for c in categories:
        if c not in seen:
            seen.add(c)
            ordered.append(c)
    return ordered


def _require_active_member(db: Session, project_id: uuid.UUID, user_id: uuid.UUID, label: str) -> ProjectMember:
    member = get_project_member(db, user_id, project_id)
    if member is None:
        raise ValueError(f"The {label} must be an active member of this project.")
    return member


def _append_approval(
    db: Session, h: Handover, actor_id: uuid.UUID | None, action: str, note: str | None
) -> None:
    db.add(
        HandoverApproval(
            id=uuid.uuid4(),
            handover_id=h.id,
            actor_id=actor_id,
            action=action,
            note=note,
            created_at=utcnow(),
        )
    )


# ---------------------------------------------------------------------------
# Routes — /impact MUST be declared before /{handover_id}
# ---------------------------------------------------------------------------

@router.get("/{project_id}/handovers", response_model=list[HandoverOut])
def list_handovers(
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> list[HandoverOut]:
    rows = db.scalars(
        select(Handover)
        .where(Handover.project_id == ctx.project.id)
        .order_by(Handover.updated_at.desc())
    ).all()
    if not rows:
        return []

    # batch shares + counts + names
    share_rows = db.execute(
        select(HandoverShare.handover_id, HandoverShare.recipient_user_id)
        .join(Handover, Handover.id == HandoverShare.handover_id)
        .where(Handover.project_id == ctx.project.id)
    ).all()
    shares: dict[uuid.UUID, set[uuid.UUID]] = {}
    for hid, uid in share_rows:
        shares.setdefault(hid, set()).add(uid)

    sec_counts, find_counts = _counts(db, [r.id for r in rows])
    user_ids: set[uuid.UUID] = set()
    for r in rows:
        user_ids.add(r.departing_user_id)
        if r.successor_user_id:
            user_ids.add(r.successor_user_id)
    names = _names(db, user_ids)

    out: list[HandoverOut] = []
    for h in rows:
        if not can_view_handover(
            ctx.user, h, ctx.role, ctx.ws_role, shares.get(h.id, set())
        ):
            continue
        out.append(
            _out(
                db, h, names,
                int(sec_counts.get(h.id, 0)),
                int(find_counts.get(h.id, 0)),
            )
        )
    return out


@router.post("/{project_id}/handovers", response_model=HandoverDetailOut)
def create_handover(
    payload: HandoverCreateIn,
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> HandoverDetailOut:
    if not can_initiate_handover(ctx.role):
        raise PermissionError_("Only a project head or lead can start a handover.")

    _require_active_member(db, ctx.project.id, payload.departing_user_id, "departing person")
    if payload.successor_user_id is not None:
        if payload.successor_user_id == payload.departing_user_id:
            raise ValueError("The successor must be different from the departing person.")
        _require_active_member(db, ctx.project.id, payload.successor_user_id, "successor")

    categories = _validate_categories(payload.categories)

    h = Handover(
        id=uuid.uuid4(),
        project_id=ctx.project.id,
        created_by=ctx.user.id,
        departing_user_id=payload.departing_user_id,
        successor_user_id=payload.successor_user_id,
        role_transferred=payload.role_transferred,
        title=payload.title,
        status=HandoverStatus.DRAFT,
        version=1,
        scope={"categories": categories},
        impact={},
        generation_meta={},
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(h)
    db.flush()

    audit.record(
        db,
        action=audit.A.HANDOVER_CREATE,
        actor_id=ctx.user.id,
        project_id=ctx.project.id,
        workspace_id=ctx.project.workspace_id,
        target_type="handover",
        target_id=h.id,
        summary=f"Handover created: {h.title[:80]}",
        meta={"categories": categories, "departing": str(payload.departing_user_id)},
    )
    db.commit()
    return _detail(db, ctx, h)


@router.get("/{project_id}/handovers/impact", response_model=ImpactAnalysis)
def handover_impact(
    departing_user_id: uuid.UUID = Query(...),
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> ImpactAnalysis:
    _require_active_member(db, ctx.project.id, departing_user_id, "departing person")
    data = compute_impact(db, ctx.project, departing_user_id)
    return ImpactAnalysis(**data)


@router.get("/{project_id}/handovers/{handover_id}", response_model=HandoverDetailOut)
def get_handover(
    handover_id: uuid.UUID,
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> HandoverDetailOut:
    return _detail(db, ctx, _load_handover(db, ctx, handover_id))


@router.patch("/{project_id}/handovers/{handover_id}", response_model=HandoverDetailOut)
def update_handover(
    handover_id: uuid.UUID,
    payload: HandoverUpdateIn,
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> HandoverDetailOut:
    h = _load_handover(db, ctx, handover_id)
    data = payload.model_dump(exclude_unset=True)
    allowed = _can_dict(ctx, h)
    creator_draft = h.created_by == ctx.user.id and h.status == HandoverStatus.DRAFT
    if not (allowed["edit"] or creator_draft):
        raise PermissionError_("Only a project head or lead can edit this handover.")

    changed: dict = {}
    if "title" in data and data["title"] is not None:
        h.title = data["title"]
        changed["title"] = True
    if "role_transferred" in data and data["role_transferred"] is not None:
        h.role_transferred = data["role_transferred"]
        changed["role_transferred"] = True
    if "successor_user_id" in data:
        sid = data["successor_user_id"]
        if sid is not None:
            if sid == h.departing_user_id:
                raise ValueError("The successor must be different from the departing person.")
            _require_active_member(db, ctx.project.id, sid, "successor")
        h.successor_user_id = sid
        changed["successor_user_id"] = str(sid) if sid else None
    if "scope" in data and data["scope"] is not None:
        scope = data["scope"]
        if isinstance(scope, dict) and "categories" in scope:
            scope = dict(scope)
            scope["categories"] = _validate_categories(list(scope["categories"] or []))
        h.scope = scope
        changed["scope"] = True

    audit.record(
        db,
        action=audit.A.HANDOVER_CREATE,
        actor_id=ctx.user.id,
        project_id=ctx.project.id,
        workspace_id=ctx.project.workspace_id,
        target_type="handover",
        target_id=h.id,
        summary=f"Handover updated: {h.title[:80]}",
        meta={"edit": sorted(changed)},
    )
    db.commit()
    return _detail(db, ctx, h)


@router.post("/{project_id}/handovers/{handover_id}/generate", response_model=HandoverDetailOut)
async def generate(
    handover_id: uuid.UUID,
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> HandoverDetailOut:
    h = _load_handover(db, ctx, handover_id)
    if not _can_dict(ctx, h)["generate"]:
        raise PermissionError_(
            "Only a project head or lead can generate a handover draft."
        )

    stats = await generate_handover(db, handover=h, project=ctx.project, actor=ctx.user)

    audit.record(
        db,
        action=audit.A.HANDOVER_GENERATE,
        actor_id=ctx.user.id,
        project_id=ctx.project.id,
        workspace_id=ctx.project.workspace_id,
        target_type="handover",
        target_id=h.id,
        summary=f"Handover generated: {h.title[:80]}",
        meta=stats,
    )
    db.commit()
    return _detail(db, ctx, h)


# Local request model: frozen HandoverActionIn carries note/recipient only;
# the action discriminator arrives in the JSON body (frontend contract).
class _ActionIn(HandoverActionIn):
    action: str


@router.post("/{project_id}/handovers/{handover_id}/actions", response_model=HandoverDetailOut)
def handover_action(
    handover_id: uuid.UUID,
    payload: _ActionIn,
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> HandoverDetailOut:
    h = _load_handover(db, ctx, handover_id)
    action = (payload.action or "").strip().lower()
    note = (payload.note or "").strip() or None
    approver = can_approve_handover(ctx.role) or ctx.ws_role == WorkspaceRole.OWNER
    reviewer = _reviewer(ctx)

    def _status_error(msg: str) -> ValueError:
        return ValueError(msg)

    if action == "submit":
        if not can_initiate_handover(ctx.role):
            raise PermissionError_("Only a project head or lead can submit a handover.")
        if h.status not in _EDIT_STATUSES:
            raise _status_error(
                "Only a draft or changes-requested handover can be submitted."
            )
        h.status = HandoverStatus.NEEDS_REVIEW
        _append_approval(db, h, ctx.user.id, "submitted", note)
        audit.record(
            db, action=audit.A.HANDOVER_SUBMIT, actor_id=ctx.user.id,
            project_id=ctx.project.id, workspace_id=ctx.project.workspace_id,
            target_type="handover", target_id=h.id,
            summary=f"Submitted for review: {h.title[:80]}", meta={},
        )
    elif action == "approve":
        if not approver:
            raise PermissionError_("Only a project head can approve this handover.")
        if h.status != HandoverStatus.NEEDS_REVIEW:
            raise _status_error("Only a handover awaiting review can be approved.")
        h.status = HandoverStatus.APPROVED
        h.approved_by = ctx.user.id
        h.approved_at = utcnow()
        _append_approval(db, h, ctx.user.id, "approved", note)
        audit.record(
            db, action=audit.A.HANDOVER_APPROVE, actor_id=ctx.user.id,
            project_id=ctx.project.id, workspace_id=ctx.project.workspace_id,
            target_type="handover", target_id=h.id,
            summary=f"Approved: {h.title[:80]}", meta={},
        )
    elif action == "request_changes":
        if not reviewer:
            raise PermissionError_("Only a project head or lead can request changes.")
        if h.status != HandoverStatus.NEEDS_REVIEW:
            raise _status_error(
                "Only a handover awaiting review can be sent back for changes."
            )
        if not note:
            raise ValueError("Add a note explaining what needs changing.")
        h.status = HandoverStatus.CHANGES_REQUESTED
        _append_approval(db, h, ctx.user.id, "changes_requested", note)
        audit.record(
            db, action=audit.A.HANDOVER_CHANGES, actor_id=ctx.user.id,
            project_id=ctx.project.id, workspace_id=ctx.project.workspace_id,
            target_type="handover", target_id=h.id,
            summary=f"Changes requested: {h.title[:80]}", meta={"note": note[:200]},
        )
    elif action == "share":
        if not approver:
            raise PermissionError_("Only a project head can share this handover.")
        if h.status != HandoverStatus.APPROVED:
            raise _status_error("Only an approved handover can be shared.")
        if payload.recipient_user_id is None:
            raise ValueError("Choose who to share with.")
        recipient = get_project_member(
            db, payload.recipient_user_id, ctx.project.id
        )
        if recipient is None:
            raise ValueError("The recipient must be an active member of this project.")
        if payload.recipient_user_id == h.departing_user_id:
            raise ValueError("Share with someone other than the departing person.")
        db.add(
            HandoverShare(
                id=uuid.uuid4(),
                handover_id=h.id,
                recipient_user_id=payload.recipient_user_id,
                shared_by=ctx.user.id,
                note=note,
                created_at=utcnow(),
            )
        )
        h.status = HandoverStatus.SHARED
        h.shared_at = utcnow()
        _append_approval(db, h, ctx.user.id, "shared", note)
        audit.record(
            db, action=audit.A.HANDOVER_SHARE, actor_id=ctx.user.id,
            project_id=ctx.project.id, workspace_id=ctx.project.workspace_id,
            target_type="handover", target_id=h.id,
            summary=f"Shared: {h.title[:80]}",
            meta={"recipient": str(payload.recipient_user_id)},
        )
    elif action == "archive":
        if not approver:
            raise PermissionError_("Only a project head can archive this handover.")
        if h.status == HandoverStatus.ARCHIVED:
            raise _status_error("This handover is already archived.")
        h.status = HandoverStatus.ARCHIVED
        _append_approval(db, h, ctx.user.id, "archived", note)
        audit.record(
            db, action=audit.A.HANDOVER_ARCHIVE, actor_id=ctx.user.id,
            project_id=ctx.project.id, workspace_id=ctx.project.workspace_id,
            target_type="handover", target_id=h.id,
            summary=f"Archived: {h.title[:80]}", meta={},
        )
    else:
        raise ValueError(
            f"Unknown action '{action}'. Use submit, approve, request_changes, share or archive."
        )

    db.commit()
    return _detail(db, ctx, h)


@router.post(
    "/{project_id}/handovers/{handover_id}/findings/{finding_id}/review",
    response_model=FindingOut,
)
def review_finding(
    handover_id: uuid.UUID,
    finding_id: uuid.UUID,
    payload: FindingReviewIn,
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> FindingOut:
    h = db.get(Handover, handover_id)
    if h is None or h.project_id != ctx.project.id:
        raise NotFoundError("Handover not found.")

    # permission before visibility: reviewers get 403, strangers 404 later
    if not can_review(ctx.role) or h.status not in _REVIEW_FINDING_STATUSES:
        raise PermissionError_(
            "Only a project head or lead can review findings at this stage."
        )
    if not can_view_handover(
        ctx.user, h, ctx.role, ctx.ws_role, handover_share_ids(db, h.id)
    ):
        raise NotFoundError("Handover not found.")

    finding = db.scalar(
        select(HandoverFinding).where(
            HandoverFinding.id == finding_id,
            HandoverFinding.handover_id == h.id,
        )
    )
    if finding is None:
        raise NotFoundError("Finding not found.")

    action = payload.action
    if action == "accept":
        finding.review_state = FindingReviewState.ACCEPTED
    elif action == "reject":
        finding.review_state = FindingReviewState.REJECTED
    elif action == "edit":
        content = (payload.content or "").strip()
        if not content:
            raise ValueError("Provide the replacement content for the finding.")
        finding.content = content
        finding.review_state = FindingReviewState.EDITED
    else:
        raise ValueError("Unknown review action. Use accept, reject or edit.")

    if payload.note:
        finding.reviewer_note = payload.note

    audit.record(
        db,
        action=audit.A.HANDOVER_FINDING_REVIEW,
        actor_id=ctx.user.id,
        project_id=ctx.project.id,
        workspace_id=ctx.project.workspace_id,
        target_type="handover_finding",
        target_id=finding.id,
        summary=f"{action}: {finding.label[:80]}",
        meta={"finding": str(finding.id), "action": action},
    )
    db.commit()
    db.refresh(finding)
    return _finding_out(finding)


# ---------------------------------------------------------------------------
# Markdown export
# ---------------------------------------------------------------------------

def _ev_get(ev, key, default=None):
    if isinstance(ev, dict):
        return ev.get(key, default)
    return getattr(ev, key, default)


def _build_markdown(db: Session, h: Handover) -> str:
    names = _names(db, {h.departing_user_id} | ({h.successor_user_id} if h.successor_user_id else set()))
    departing = names.get(h.departing_user_id, str(h.departing_user_id))
    successor = names.get(h.successor_user_id, "—") if h.successor_user_id else "—"

    sections = db.scalars(
        select(HandoverSection)
        .where(HandoverSection.handover_id == h.id)
        .order_by(HandoverSection.position)
    ).all()
    findings = db.scalars(
        select(HandoverFinding)
        .where(HandoverFinding.handover_id == h.id)
        .order_by(HandoverFinding.section_key, HandoverFinding.position)
    ).all()
    approvals = db.execute(
        select(HandoverApproval, User.name)
        .outerjoin(User, User.id == HandoverApproval.actor_id)
        .where(HandoverApproval.handover_id == h.id)
        .order_by(HandoverApproval.created_at.asc())
    ).all()

    approved = h.approved_at.isoformat() if h.approved_at else "—"
    shared = h.shared_at.isoformat() if h.shared_at else "—"

    lines: list[str] = [
        f"# {h.title}",
        "",
        "| Field | Value |",
        "| --- | --- |",
        f"| Status | {h.status} |",
        f"| Version | {h.version} |",
        f"| Departing | {departing} |",
        f"| Successor | {successor} |",
        f"| Role transferred | {h.role_transferred} |",
        f"| Approved | {approved} |",
        f"| Shared | {shared} |",
        "",
    ]
    if h.summary:
        lines += ["## Summary", "", h.summary.strip(), ""]

    by_section: dict[str, list[HandoverFinding]] = {}
    for f in findings:
        by_section.setdefault(f.section_key, []).append(f)

    for s in sections:
        lines += [f"## {s.title}", ""]
        if s.body and s.body.strip():
            lines += [s.body.strip(), ""]
        for f in by_section.get(s.key, []):
            status = str(f.evidence_status).upper()
            lines.append(f"- **[{status}]** {f.label} — {f.content}")
            for ev in (f.evidence or []):
                quote = (_ev_get(ev, "quote") or "").strip()
                if not quote:
                    continue
                doc = _ev_get(ev, "document_name") or "source"
                page = _ev_get(ev, "page_number")
                loc = f", p.{page}" if page is not None else ""
                lines.append(f"  > {quote} — {doc}{loc}")
        lines.append("")

    if approvals:
        lines += ["## Approvals", ""]
        for a, actor_name in approvals:
            when = a.created_at.isoformat() if a.created_at else ""
            who = actor_name or "system"
            note_part = f" — {a.note}" if a.note else ""
            lines.append(f"- **{a.action}** by {who} at {when}{note_part}")
        lines.append("")

    return "\n".join(lines)


@router.get("/{project_id}/handovers/{handover_id}/markdown")
def export_markdown(
    handover_id: uuid.UUID,
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> Response:
    h = _load_handover(db, ctx, handover_id)
    md = _build_markdown(db, h)
    return Response(
        content=md,
        media_type="text/markdown",
        headers={
            "Content-Disposition": f'attachment; filename="handover-{h.id}.md"'
        },
    )


@router.delete("/{project_id}/handovers/{handover_id}", response_model=OkResponse)
def delete_handover(
    handover_id: uuid.UUID,
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> OkResponse:
    """Permanently delete a handover and all its sections, findings, shares, and approvals."""
    h = _load_handover(db, ctx, handover_id)
    # Only project head or workspace owner can delete
    is_head = ctx.role.value == "head"
    is_owner = ctx.ws_role == WorkspaceRole.OWNER
    if not (is_head or is_owner):
        raise PermissionError_("Only the project head or workspace owner can delete a handover.")

    title = h.title
    # Cascade delete related rows manually (FKs may not have ON DELETE CASCADE)
    db.execute(
        delete(HandoverShare).where(HandoverShare.handover_id == h.id)
    )
    db.execute(
        delete(HandoverFinding).where(HandoverFinding.handover_id == h.id)
    )
    db.execute(
        delete(HandoverSection).where(HandoverSection.handover_id == h.id)
    )
    db.execute(
        delete(HandoverApproval).where(HandoverApproval.handover_id == h.id)
    )
    db.delete(h)

    audit.record(
        db,
        action=audit.A.HANDOVER_DELETE,
        actor_id=ctx.user.id,
        project_id=ctx.project.id,
        workspace_id=ctx.project.workspace_id,
        target_type="handover",
        target_id=handover_id,
        summary=f"Deleted handover: {title[:80]}",
        meta={},
    )
    db.commit()
    return OkResponse(ok=True)


__all__ = ["router"]
