"""Semantic retrieval over evidence chunks: permission-filtered pgvector search."""
from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Document, EvidenceChunk, Project, User
from app.domain.enums import ProjectRole
from app.services.embedding import embed_query
from app.services.permissions import NotFoundError, visible_chunk_ids


@dataclass
class RetrievedChunk:
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    document_name: str
    text: str
    page_number: int | None
    section: str | None
    score: float
    access_scope: str


async def retrieve(
    db: Session,
    *,
    project_id: uuid.UUID,
    user: User,
    role: ProjectRole,
    query: str,
    top_k: int = 8,
) -> list[RetrievedChunk]:
    """Top-k cosine neighbours of ``query`` among chunks the user may read."""
    project = db.get(Project, project_id)
    if project is None:
        raise NotFoundError()

    vector = await embed_query(query)
    distance = EvidenceChunk.embedding.cosine_distance(vector)
    stmt = (
        select(
            EvidenceChunk.id,
            EvidenceChunk.document_id,
            EvidenceChunk.text,
            EvidenceChunk.page_number,
            EvidenceChunk.section,
            EvidenceChunk.access_scope,
            Document.original_name.label("document_name"),
            distance.label("distance"),
        )
        .join(Document, Document.id == EvidenceChunk.document_id)
        .where(
            EvidenceChunk.project_id == project_id,
            EvidenceChunk.embedding.isnot(None),
            EvidenceChunk.id.in_(visible_chunk_ids(db, user, project, role)),
        )
        .order_by(distance)
        .limit(max(1, min(int(top_k), 50)))
    )
    rows = db.execute(stmt).all()
    # --- Per-document diversity: never let one document crowd out the rest ---
    # Group rows by document, keep only the top 3 per document, then re-sort by
    # distance and trim to top_k overall.
    by_doc: dict[uuid.UUID, list] = {}
    for row in rows:
        by_doc.setdefault(row.document_id, []).append(row)
    diverse_rows: list = []
    for doc_rows in by_doc.values():
        doc_rows.sort(key=lambda r: r.distance)
        diverse_rows.extend(doc_rows[:3])
    diverse_rows.sort(key=lambda r: r.distance)
    rows = diverse_rows[: max(1, min(int(top_k), 50))]
    return [
        RetrievedChunk(
            chunk_id=row.id,
            document_id=row.document_id,
            document_name=row.document_name,
            text=row.text,
            page_number=row.page_number,
            section=row.section,
            score=max(0.0, min(1.0, 1.0 - float(row.distance))),
            access_scope=row.access_scope,
        )
        for row in rows
    ]


__all__ = ["RetrievedChunk", "retrieve"]
