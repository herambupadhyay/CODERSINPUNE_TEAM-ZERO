"""ProjectPulse FastAPI application."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.errors import register_handlers
from app.core.config import get_settings
from app.db.session import engine
from app.schemas.common import HealthOut

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("projectpulse")

API_PREFIX = "/api"


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    log.info(
        "ProjectPulse API starting — db=%s ai=%s demo_sample=%s embed_dim=%s",
        settings.database_url.split("@")[-1],
        settings.ai_configured,
        settings.demo_sample_mode,
        settings.embed_dim,
    )
    yield
    engine.dispose()
    log.info("ProjectPulse API stopped.")


app = FastAPI(
    title="ProjectPulse API",
    description="ProjectPulse API — authority-aware knowledge reconstruction.",
    version="1.0.0",
    lifespan=lifespan,
)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_handlers(app)


@app.exception_handler(Exception)
async def all_exception_handler(request, exc):
    """Last-resort handler: never return a raw 500 to the client."""
    log.exception("Unhandled error: %s", exc)
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=500,
        content={"error": "internal_error", "detail": "The server encountered an error. Please try again in a moment."},
    )


@app.get(f"{API_PREFIX}/health", response_model=HealthOut, tags=["meta"])
def health() -> HealthOut:
    db_status = "unknown"
    pgvector = False
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            db_status = "ok"
            pgvector = bool(
                conn.execute(
                    text(
                        "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='vector')"
                    )
                ).scalar()
            )
    except Exception:  # noqa: BLE001 — health must never 500
        db_status = "unavailable"
    return HealthOut(
        status="ok" if db_status == "ok" else "degraded",
        database=db_status,
        pgvector=pgvector,
        ai_configured=settings.ai_configured,
        demo_mode=settings.demo_sample_mode,
        embed_dim=settings.embed_dim,
    )


# --- routers (imported here to keep module import order simple) --------------
from app.api import (  # noqa: E402
    activity,
    assistant,
    authority,
    auth,
    code,
    demo,
    documents,
    handover,
    knowledge,
    processing,
    projects,
    search,
    workspaces,
)

app.include_router(auth.router, prefix=f"{API_PREFIX}/auth", tags=["auth"])
app.include_router(workspaces.router, prefix=f"{API_PREFIX}/workspaces", tags=["workspaces"])
app.include_router(projects.router, prefix=f"{API_PREFIX}/projects", tags=["projects"])
app.include_router(documents.router, prefix=f"{API_PREFIX}/projects", tags=["documents"])
app.include_router(code.router, prefix=f"{API_PREFIX}/projects", tags=["code"])
app.include_router(processing.router, prefix=f"{API_PREFIX}/projects", tags=["processing"])
app.include_router(knowledge.router, prefix=f"{API_PREFIX}/projects", tags=["knowledge"])
app.include_router(authority.router, prefix=f"{API_PREFIX}/projects", tags=["authority"])
app.include_router(handover.router, prefix=f"{API_PREFIX}/projects", tags=["handover"])
app.include_router(assistant.router, prefix=f"{API_PREFIX}/projects", tags=["assistant"])
app.include_router(search.router, prefix=f"{API_PREFIX}/projects", tags=["search"])
app.include_router(activity.router, prefix=f"{API_PREFIX}", tags=["activity"])
app.include_router(demo.router, prefix=f"{API_PREFIX}/demo", tags=["demo"])
