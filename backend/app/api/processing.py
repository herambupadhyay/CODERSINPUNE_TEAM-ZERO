"""Processing job endpoints + the document ingestion worker."""
from __future__ import annotations

import logging
import time
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.deps import ProjectContext, get_db, project_context
from app.db.base import utcnow
from app.db.models import Document, DocumentProcessingJob, EvidenceChunk
from app.db.session import SessionLocal
from app.domain.enums import DocumentStatus, JobStatus
from app.schemas.document import JobOut
from app.services import audit
from app.services.chunker import chunk_text
from app.services.embedding import embed_texts
from app.services.extraction import extract_from_document
from app.services.permissions import (
    NotFoundError,
    PermissionError_,
    can_manage_project,
    can_upload,
)
from app.services.parsers import parse_file

log = logging.getLogger("projectpulse.processing")

router = APIRouter()


def reset_job(job: DocumentProcessingJob) -> None:
    """Return a job to the queue without losing its attempt history."""
    job.status = JobStatus.QUEUED
    job.stage = "queued"
    job.error_message = None
    job.started_at = None
    job.finished_at = None


@router.get("/{project_id}/processing/jobs", response_model=list[JobOut])
def list_jobs(
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> list[JobOut]:
    rows = db.execute(
        select(DocumentProcessingJob)
        .join(Document, Document.id == DocumentProcessingJob.document_id)
        .where(Document.project_id == ctx.project.id)
        .order_by(DocumentProcessingJob.created_at.desc())
        .limit(50)
    ).scalars()
    return [JobOut.model_validate(job) for job in rows]


@router.post("/{project_id}/processing/jobs/{job_id}/retry", response_model=JobOut)
def retry_job(
    job_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> JobOut:
    if not (can_upload(ctx.role) or can_manage_project(ctx.role)):
        raise PermissionError_("You don't have permission to reprocess documents.")
    job = db.scalar(
        select(DocumentProcessingJob)
        .join(Document, Document.id == DocumentProcessingJob.document_id)
        .where(
            DocumentProcessingJob.id == job_id,
            Document.project_id == ctx.project.id,
        )
    )
    if job is None:
        raise NotFoundError("Job not found.")
    reset_job(job)
    document = job.document
    document.status = DocumentStatus.QUEUED
    document.error_message = None
    audit.record(
        db, action=audit.A.DOCUMENT_PROCESS, actor_id=ctx.user.id,
        workspace_id=ctx.project.workspace_id, project_id=ctx.project.id,
        target_type="document", target_id=document.id,
        summary=f"Reprocessing '{document.original_name}'",
        meta={"trigger": "retry", "job_id": str(job.id)},
    )
    db.commit()
    background_tasks.add_task(process_document_job, str(document.id))
    return JobOut.model_validate(job)


async def process_document_job(document_id: str) -> None:
    """Parse -> chunk -> embed -> extract one document (runs after the response)."""
    try:
        document_pk = uuid.UUID(document_id)
    except ValueError:
        log.error("Invalid document id passed to worker: %r", document_id)
        return

    db = SessionLocal()
    started = time.perf_counter()
    try:
        job = db.scalar(
            select(DocumentProcessingJob).where(
                DocumentProcessingJob.document_id == document_pk
            )
        )
        document = db.get(Document, document_pk)
        if job is None or document is None:
            return

        job.attempts += 1
        job.status = JobStatus.RUNNING
        job.started_at = utcnow()
        job.error_message = None
        document.status = DocumentStatus.PROCESSING
        document.error_message = None
        job.stage = "parsing"
        db.commit()

        settings = get_settings()
        try:
            parsed = parse_file(settings.storage_path / document.storage_path, document.kind)
        except Exception as exc:
            job.stage = "failed"
            job.status = JobStatus.FAILED
            job.finished_at = utcnow()
            job.error_message = f"Failed to parse '{document.original_name}': {str(exc)[:200]}"
            document.status = DocumentStatus.FAILED
            document.error_message = job.error_message
            db.commit()
            log.exception("PDF parse failed for document %s", document.id)
            return
        document.page_count = parsed.page_count
        document.char_count = parsed.char_count
        job.stage = "chunking"
        db.commit()

        drafts = chunk_text(parsed)
        db.execute(delete(EvidenceChunk).where(EvidenceChunk.document_id == document.id))
        for draft in drafts:
            db.add(
                EvidenceChunk(
                    id=uuid.uuid4(),
                    project_id=document.project_id,
                    document_id=document.id,
                    seq=draft.seq,
                    text=draft.text,
                    page_number=draft.page_number,
                    section=draft.section,
                    char_start=draft.char_start,
                    char_end=draft.char_end,
                    source_type="document",
                    access_scope=document.access_scope,
                    meta={"filename": document.original_name},
                    embedding=None,
                    created_at=utcnow(),
                    updated_at=utcnow(),
                )
            )
        document.chunk_count = len(drafts)
        job.stage = "embedding"
        db.commit()

        chunks = list(
            db.scalars(
                select(EvidenceChunk)
                .where(EvidenceChunk.document_id == document.id)
                .order_by(EvidenceChunk.seq)
            ).all()
        )
        vectors = await embed_texts([chunk.text for chunk in chunks]) if chunks else []
        for chunk, vector in zip(chunks, vectors, strict=True):
            chunk.embedding = vector
        job.stage = "extracting"
        db.commit()

        stats = await extract_from_document(db, document)
        document.extracted_count = stats.items_created
        job.stats = {
            "pages": parsed.page_count,
            "chunks": len(chunks),
            "embedded": len(vectors),
            "items": stats.items_created,
            "relationships": stats.relationships_created,
            "evidences": stats.evidences_created,
            "ms": int((time.perf_counter() - started) * 1000),
            "extraction_skipped": stats.skipped,
            "extraction_reason": stats.reason,
        }
        if stats.skipped:
            document.error_message = f"Extraction skipped: {stats.reason[:200]}"
        else:
            document.error_message = None
        job.stage = "completed"
        job.status = JobStatus.COMPLETED
        job.finished_at = utcnow()
        job.error_message = None
        document.status = DocumentStatus.COMPLETED
        document.processed_at = utcnow()
        document.error_message = None
        db.commit()
        log.info(
            "Processed document %s in %sms (%s chunks, %s items)",
            document.id, job.stats["ms"], len(chunks), stats.items_created,
        )
    except Exception as exc:
        log.exception("Document processing failed for %s", document_id)
        try:
            db.rollback()
            job = db.scalar(
                select(DocumentProcessingJob).where(
                    DocumentProcessingJob.document_id == document_pk
                )
            )
            document = db.get(Document, document_pk)
            message = str(exc)[:2000]
            if job is not None:
                job.status = JobStatus.FAILED
                job.error_message = message
                job.finished_at = utcnow()
            if document is not None:
                document.status = DocumentStatus.FAILED
                document.error_message = message
            db.commit()
        except Exception:  # noqa: BLE001 — best-effort failure bookkeeping
            db.rollback()
            log.exception("Could not record processing failure for %s", document_id)
    finally:
        db.close()


__all__ = ["router", "process_document_job", "reset_job"]
