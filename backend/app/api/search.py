"""Semantic search endpoint over evidence chunks."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.deps import ProjectContext, get_db, project_context
from app.schemas.assistant import SearchHit, SearchOut
from app.services.rag import retrieve

router = APIRouter()


@router.get("/{project_id}/search", response_model=SearchOut)
async def search_documents(
    q: str = "",
    limit: int = 8,
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> SearchOut:
    query = q.strip()
    if not query:
        raise ValueError("Enter a search query.")
    hits = await retrieve(
        db,
        project_id=ctx.project.id,
        user=ctx.user,
        role=ctx.role,
        query=query,
        top_k=limit,
    )
    return SearchOut(
        query=query,
        hits=[
            SearchHit(
                chunk_id=hit.chunk_id,
                document_id=hit.document_id,
                document_name=hit.document_name,
                text=hit.text,
                page_number=hit.page_number,
                section=hit.section,
                score=round(hit.score, 4),
                access_scope=hit.access_scope,
            )
            for hit in hits
        ],
        total=len(hits),
        demo_mode=get_settings().demo_sample_mode,
    )


__all__ = ["router"]
