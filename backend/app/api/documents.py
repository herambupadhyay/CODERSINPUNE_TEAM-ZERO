"""Document routes: upload, listing, scope/grants management, chunks, jobs."""
from __future__ import annotations

import hashlib
import logging
import uuid
from pathlib import Path

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    UploadFile,
)
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.api.processing import process_document_job, reset_job
from app.core.config import get_settings
from app.core.deps import ProjectContext, get_db, project_context
from app.db.base import utcnow
from app.db.models import (
    Document,
    DocumentProcessingJob,
    EvidenceChunk,
    User,
    document_grants,
)
from app.domain.enums import AccessScope, DocumentKind, DocumentStatus, JobStatus
from app.schemas.common import OkResponse, Page
from app.schemas.document import (
    ChunkOut,
    DocumentGrantIn,
    DocumentGrantOut,
    DocumentOut,
    JobOut,
    UploadResult,
)
from app.services import audit
from app.services.permissions import (
    NotFoundError,
    PermissionError_,
    can_manage_project,
    can_upload,
    get_project_member,
    visible_documents,
)

log = logging.getLogger("projectpulse.documents")

router = APIRouter()

_EXTENSION_KINDS = {
    ".pdf": DocumentKind.PDF,
    ".docx": DocumentKind.DOCX,
    ".txt": DocumentKind.TXT,
    ".md": DocumentKind.MARKDOWN,
    ".markdown": DocumentKind.MARKDOWN,
    ".csv": DocumentKind.CSV,
}


class DocumentScopeIn(BaseModel):
    access_scope: str


def _load_document(db: Session, ctx: ProjectContext, doc_id: uuid.UUID) -> Document:
    """Fetch a document the caller may actually see, or 404."""
    document = db.get(Document, doc_id)
    if document is None or document.project_id != ctx.project.id:
        raise NotFoundError("Document not found.")
    visible = db.scalar(
        visible_documents(db, ctx.user, ctx.project, ctx.role).where(
            Document.id == document.id
        )
    )
    if visible is None:
        raise NotFoundError("Document not found.")
    return document


def _document_outs(db: Session, documents: list[Document]) -> list[DocumentOut]:
    if not documents:
        return []
    names = dict(
        db.execute(
            select(User.id, User.name).where(
                User.id.in_([document.uploaded_by for document in documents])
            )
        ).all()
    )
    outputs = []
    for document in documents:
        out = DocumentOut.model_validate(document)
        out.uploaded_by_name = names.get(document.uploaded_by)
        outputs.append(out)
    return outputs


def _require_scope(value: str) -> AccessScope:
    try:
        return AccessScope(value)
    except ValueError as exc:
        raise ValueError("Scope must be 'project' or 'restricted'.") from exc


@router.get("/{project_id}/documents", response_model=list[DocumentOut])
def list_documents(
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> list[DocumentOut]:
    stmt = visible_documents(db, ctx.user, ctx.project, ctx.role).order_by(
        Document.created_at.desc()
    )
    return _document_outs(db, list(db.scalars(stmt).unique().all()))


@router.post("/{project_id}/documents", response_model=UploadResult)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    access_scope: str = Form("project"),
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> UploadResult:
    if not can_upload(ctx.role):
        raise PermissionError_("You don't have permission to upload documents.")
    scope = _require_scope(access_scope)

    original = Path((file.filename or "").replace("\\", "/")).name
    extension = Path(original).suffix.lower()
    kind = _EXTENSION_KINDS.get(extension)
    if kind is None:
        raise ValueError(
            "That file type isn't supported — upload PDF, DOCX, TXT, MD or CSV."
        )

    settings = get_settings()
    data = await file.read()
    size = len(data)
    if size > settings.max_upload_mb * 1024 * 1024:
        raise ValueError(f"That file is too large — the limit is {settings.max_upload_mb} MB.")
    if size == 0:
        raise ValueError("That file is empty.")

    content_hash = hashlib.sha256(data).hexdigest()
    existing = db.scalar(
        select(Document).where(
            Document.project_id == ctx.project.id,
            Document.content_hash == content_hash,
        )
    )
    if existing is not None:
        return UploadResult(
            document=_document_outs(db, [existing])[0],
            duplicate=True,
            warnings=[f"Already uploaded as '{existing.original_name}'."],
        )

    filename = f"{uuid.uuid4().hex}{extension}"
    project_dir = settings.storage_path / str(ctx.project.id)
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / filename).write_bytes(data)

    now = utcnow()
    document = Document(
        id=uuid.uuid4(),
        project_id=ctx.project.id,
        uploaded_by=ctx.user.id,
        filename=filename,
        original_name=original[:255],
        kind=kind.value,
        size_bytes=size,
        content_hash=content_hash,
        storage_path=f"{ctx.project.id}/{filename}",
        mime_type=file.content_type[:120] if file.content_type else None,
        status=DocumentStatus.QUEUED,
        access_scope=scope.value,
        chunk_count=0,
        extracted_count=0,
        created_at=now,
        updated_at=now,
    )
    job = DocumentProcessingJob(
        id=uuid.uuid4(),
        document_id=document.id,
        status=JobStatus.QUEUED,
        stage="queued",
        attempts=0,
        error_message=None,
        stats={},
        created_at=now,
    )
    db.add(document)
    db.add(job)
    audit.record(
        db, action=audit.A.DOCUMENT_UPLOAD, actor_id=ctx.user.id,
        workspace_id=ctx.project.workspace_id, project_id=ctx.project.id,
        target_type="document", target_id=document.id,
        summary=f"Uploaded '{document.original_name}'",
        meta={"kind": kind.value, "size_bytes": size, "access_scope": scope.value},
    )
    db.commit()

    background_tasks.add_task(process_document_job, str(document.id))
    return UploadResult(
        document=_document_outs(db, [document])[0],
        job=JobOut.model_validate(job),
        duplicate=False,
        warnings=[],
    )


@router.get("/{project_id}/documents/{doc_id}", response_model=DocumentOut)
def get_document(
    doc_id: uuid.UUID,
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> DocumentOut:
    document = _load_document(db, ctx, doc_id)
    return _document_outs(db, [document])[0]


@router.delete("/{project_id}/documents/{doc_id}", response_model=OkResponse)
def delete_document(
    doc_id: uuid.UUID,
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> OkResponse:
    document = _load_document(db, ctx, doc_id)
    if document.uploaded_by != ctx.user.id and not can_manage_project(ctx.role):
        raise PermissionError_("Only the uploader or a project lead can delete this document.")

    try:
        (get_settings().storage_path / document.storage_path).unlink(missing_ok=True)
    except OSError:
        log.warning("Could not remove stored file for document %s", document.id)

    name = document.original_name
    db.delete(document)
    audit.record(
        db, action=audit.A.DOCUMENT_DELETE, actor_id=ctx.user.id,
        workspace_id=ctx.project.workspace_id, project_id=ctx.project.id,
        target_type="document", target_id=doc_id,
        summary=f"Deleted '{name}'",
    )
    db.commit()
    return OkResponse(ok=True, message="Document deleted.")


@router.patch("/{project_id}/documents/{doc_id}", response_model=DocumentOut)
def update_document_scope(
    doc_id: uuid.UUID,
    payload: DocumentScopeIn,
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> DocumentOut:
    if not can_manage_project(ctx.role):
        raise PermissionError_("Only a project head or lead can change document access.")
    document = _load_document(db, ctx, doc_id)
    scope = _require_scope(payload.access_scope)
    previous = document.access_scope
    if previous != scope.value:
        document.access_scope = scope.value
        db.execute(
            update(EvidenceChunk)
            .where(EvidenceChunk.document_id == document.id)
            .values(access_scope=scope.value)
        )
        audit.record(
            db, action=audit.A.DOCUMENT_SCOPE, actor_id=ctx.user.id,
            workspace_id=ctx.project.workspace_id, project_id=ctx.project.id,
            target_type="document", target_id=document.id,
            summary=f"Scope of '{document.original_name}' changed",
            meta={"from": previous, "to": scope.value},
        )
        db.commit()
    return _document_outs(db, [document])[0]


@router.get("/{project_id}/documents/{doc_id}/chunks", response_model=Page[ChunkOut])
def list_chunks(
    doc_id: uuid.UUID,
    limit: int = 100,
    offset: int = 0,
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> Page[ChunkOut]:
    document = _load_document(db, ctx, doc_id)
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    total = db.scalar(
        select(func.count(EvidenceChunk.id)).where(
            EvidenceChunk.document_id == document.id
        )
    ) or 0
    rows = db.scalars(
        select(EvidenceChunk)
        .where(EvidenceChunk.document_id == document.id)
        .order_by(EvidenceChunk.seq)
        .offset(offset)
        .limit(limit)
    ).all()
    items = [
        ChunkOut(
            id=chunk.id,
            document_id=chunk.document_id,
            seq=chunk.seq,
            text=chunk.text,
            page_number=chunk.page_number,
            section=chunk.section,
            source_type=chunk.source_type,
            access_scope=chunk.access_scope,
            score=None,
            document_name=document.original_name,
        )
        for chunk in rows
    ]
    return Page[ChunkOut](items=items, total=total, limit=limit, offset=offset)


@router.get("/{project_id}/documents/{doc_id}/job", response_model=JobOut | None)
def get_document_job(
    doc_id: uuid.UUID,
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> JobOut | None:
    document = _load_document(db, ctx, doc_id)
    job = db.scalar(
        select(DocumentProcessingJob).where(
            DocumentProcessingJob.document_id == document.id
        )
    )
    return JobOut.model_validate(job) if job is not None else None


@router.post("/{project_id}/documents/{doc_id}/reprocess", response_model=JobOut)
def reprocess_document(
    doc_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> JobOut:
    if not (can_upload(ctx.role) or can_manage_project(ctx.role)):
        raise PermissionError_("You don't have permission to reprocess documents.")
    document = _load_document(db, ctx, doc_id)

    job = db.scalar(
        select(DocumentProcessingJob).where(
            DocumentProcessingJob.document_id == document.id
        )
    )
    if job is None:
        job = DocumentProcessingJob(
            id=uuid.uuid4(),
            document_id=document.id,
            status=JobStatus.QUEUED,
            stage="queued",
            attempts=0,
            error_message=None,
            stats={},
            created_at=utcnow(),
        )
        db.add(job)
    else:
        reset_job(job)
    document.status = DocumentStatus.QUEUED
    document.error_message = None
    audit.record(
        db, action=audit.A.DOCUMENT_PROCESS, actor_id=ctx.user.id,
        workspace_id=ctx.project.workspace_id, project_id=ctx.project.id,
        target_type="document", target_id=document.id,
        summary=f"Reprocessing '{document.original_name}'",
        meta={"trigger": "reprocess", "job_id": str(job.id)},
    )
    db.commit()
    background_tasks.add_task(process_document_job, str(document.id))
    return JobOut.model_validate(job)


@router.get("/{project_id}/documents/{doc_id}/grants", response_model=list[DocumentGrantOut])
def list_grants(
    doc_id: uuid.UUID,
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> list[DocumentGrantOut]:
    if not can_manage_project(ctx.role):
        raise PermissionError_("Only a project head or lead can manage document access.")
    document = _load_document(db, ctx, doc_id)
    # document_grants is a Core table: paired with an entity it would expand
    # flat into one wide row, so project the exact columns with unique labels
    rows = db.execute(
        select(
            document_grants.c.document_id,
            document_grants.c.user_id,
            document_grants.c.granted_by,
            User.name.label("user_name"),
            User.email.label("user_email"),
        )
        .join(User, User.id == document_grants.c.user_id)
        .where(document_grants.c.document_id == document.id)
        .order_by(document_grants.c.created_at)
    ).all()
    return [
        DocumentGrantOut(
            document_id=row.document_id,
            user_id=row.user_id,
            name=row.user_name,
            email=row.user_email,
            granted_by=row.granted_by,
        )
        for row in rows
    ]


@router.post(
    "/{project_id}/documents/{doc_id}/grants", response_model=DocumentGrantOut
)
def create_grant(
    doc_id: uuid.UUID,
    payload: DocumentGrantIn,
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> DocumentGrantOut:
    if not can_manage_project(ctx.role):
        raise PermissionError_("Only a project head or lead can manage document access.")
    document = _load_document(db, ctx, doc_id)
    if document.access_scope != AccessScope.RESTRICTED:
        raise ValueError("Grants apply to restricted documents.")
    if get_project_member(db, payload.user_id, ctx.project.id) is None:
        raise NotFoundError("No such project member.")

    existing = db.scalar(
        select(document_grants).where(
            document_grants.c.document_id == document.id,
            document_grants.c.user_id == payload.user_id,
        )
    )
    granted_by = existing.granted_by if existing is not None else None
    if existing is None:
        db.execute(
            document_grants.insert().values(
                document_id=document.id,
                user_id=payload.user_id,
                granted_by=ctx.user.id,
            )
        )
        granted_by = ctx.user.id
        audit.record(
            db, action=audit.A.DOCUMENT_GRANT, actor_id=ctx.user.id,
            workspace_id=ctx.project.workspace_id, project_id=ctx.project.id,
            target_type="document", target_id=document.id,
            summary=f"Granted access to '{document.original_name}'",
            meta={"user_id": str(payload.user_id)},
        )
        db.commit()

    user = db.get(User, payload.user_id)
    return DocumentGrantOut(
        document_id=document.id,
        user_id=payload.user_id,
        name=user.name if user else "",
        email=user.email if user else "",
        granted_by=granted_by,
    )


@router.delete(
    "/{project_id}/documents/{doc_id}/grants/{user_id}", response_model=OkResponse
)
def revoke_grant(
    doc_id: uuid.UUID,
    user_id: uuid.UUID,
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> OkResponse:
    if not can_manage_project(ctx.role):
        raise PermissionError_("Only a project head or lead can manage document access.")
    document = _load_document(db, ctx, doc_id)
    existing = db.scalar(
        select(document_grants).where(
            document_grants.c.document_id == document.id,
            document_grants.c.user_id == user_id,
        )
    )
    if existing is None:
        raise NotFoundError("No such grant.")
    db.execute(
        document_grants.delete().where(
            document_grants.c.document_id == document.id,
            document_grants.c.user_id == user_id,
        )
    )
    audit.record(
        db, action=audit.A.DOCUMENT_REVOKE, actor_id=ctx.user.id,
        workspace_id=ctx.project.workspace_id, project_id=ctx.project.id,
        target_type="document", target_id=document.id,
        summary=f"Revoked access to '{document.original_name}'",
        meta={"user_id": str(user_id)},
    )
    db.commit()
    return OkResponse(ok=True, message="Access revoked.")
