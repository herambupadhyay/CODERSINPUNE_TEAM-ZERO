"""Demo routes: status, accounts, quickstart, one-click seed and reset."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import CurrentSession, current_user, get_db
from app.core.security import hash_password
from app.db.base import utcnow
from app.db.models import User, Workspace, WorkspaceMember
from app.services import audit
from app.services.seed import (
    DEMO_OWNER_EMAIL,
    DEMO_PASSWORD,
    WORKSPACE_NAME,
    demo_accounts,
    demo_status,
    reset_demo,
    seed_demo,
)

router = APIRouter()

DEMO_EMAILS = {
    DEMO_OWNER_EMAIL,
    "alex@northwind.dev",
    "sarah@northwind.dev",
    "daniel@northwind.dev",
    "maya@northwind.dev",
}


class DemoResetIn(BaseModel):
    workspace_id: str | None = None


class DemoQuickstartIn(BaseModel):
    email: str


@router.get("/accounts")
def get_demo_accounts(db: Session = Depends(get_db)) -> dict:
    """Public demo directory for the login/signup screens (no auth)."""
    return demo_accounts(db)


@router.post("/quickstart")
async def post_demo_quickstart(
    payload: DemoQuickstartIn,
    response: Response,
    db: Session = Depends(get_db),
) -> dict:
    """One-click demo access: seed on demand, then open a session.

    Restricted to the fixed, publicly documented demo accounts — equivalent to
    logging in with the published demo password, but resilient on a fresh DB.
    """
    email = payload.email.strip().lower()
    if email not in DEMO_EMAILS:
        raise ValueError("That account is not part of the demo.")

    owner = db.scalar(select(User).where(func.lower(User.email) == DEMO_OWNER_EMAIL))
    if owner is None:
        owner = User(
            id=uuid.uuid4(),
            email=DEMO_OWNER_EMAIL,
            name="Demo Owner",
            password_hash=hash_password(DEMO_PASSWORD),
            title="Workspace owner",
            is_active=True,
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        db.add(owner)
        db.commit()

    await seed_demo(db, owner)

    user = db.scalar(select(User).where(func.lower(User.email) == email))
    if user is None or not user.is_active:
        raise ValueError("That demo account is unavailable.")

    from app.api.auth import _open_session, _session_out

    _open_session(db, response, user)
    out = _session_out(db, user).model_dump(mode="json")
    demo_workspace = db.scalar(
        select(Workspace)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(
            Workspace.name == WORKSPACE_NAME,
            WorkspaceMember.user_id == user.id,
        )
        .order_by(Workspace.created_at)
    )
    if demo_workspace is not None:
        out["primary_workspace_id"] = str(demo_workspace.id)
    out["seeded"] = True
    return out


@router.get("/status")
def get_demo_status(
    ctx: CurrentSession = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    return demo_status(db, ctx.user)


@router.post("/seed")
async def post_demo_seed(
    ctx: CurrentSession = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    result = await seed_demo(db, ctx.user)
    if result.get("already"):
        workspace_id = (
            uuid.UUID(result["workspace_id"]) if result.get("workspace_id") else None
        )
        audit.record(
            db,
            action=audit.A.DEMO_SEED,
            actor_id=ctx.user.id,
            actor_type="system",
            workspace_id=workspace_id,
            target_type="workspace",
            target_id=result.get("workspace_id"),
            summary="Demo seed re-applied",
            meta={"already": True, "counts": result.get("counts", {})},
        )
        db.commit()
    return result


@router.post("/reset")
async def post_demo_reset(
    payload: DemoResetIn,
    ctx: CurrentSession = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    if not payload.workspace_id:
        raise ValueError("Only the demo workspace can be reset.")
    try:
        workspace_id = uuid.UUID(payload.workspace_id)
    except ValueError:
        raise ValueError("Only the demo workspace can be reset.") from None
    return await reset_demo(db, ctx.user, workspace_id)
