"""Demo routes: status, one-click seed and reset of the Northwind demo workspace."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import CurrentSession, current_user, get_db
from app.services import audit
from app.services.seed import demo_status, reset_demo, seed_demo

router = APIRouter()


class DemoResetIn(BaseModel):
    workspace_id: str | None = None


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
