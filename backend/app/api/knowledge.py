"""Knowledge routes: faceted listing, evidence, human review workflow."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.deps import ProjectContext, get_db, project_context
from app.db.base import utcnow
from app.db.models import (
    Document,
    EvidenceChunk,
    KnowledgeEvidence,
    KnowledgeItem,
    KnowledgeRelationship,
    ReviewRecord,
)
from app.domain.enums import (
    AccessScope,
    EvidenceStatus,
    KnowledgeType,
    ReviewAction,
    ReviewState,
)
from app.schemas.common import EvidenceRef, OkResponse
from app.schemas.knowledge import (
    EdgeOut,
    EvidenceOut,
    GraphNode,
    GraphOut,
    KnowledgeItemOut,
    KnowledgeListOut,
    ReviewIn,
)
from app.services import audit
from app.services.permissions import (
    NotFoundError,
    PermissionError_,
    can_review,
    visible_knowledge,
)

router = APIRouter()

# Facet name -> column it filters on, and the enum that validates its value.
_FACET_COLUMNS: dict = {
    "type": KnowledgeItem.type,
    "review_state": KnowledgeItem.review_state,
    "evidence_status": KnowledgeItem.evidence_status,
    "access_scope": KnowledgeItem.access_scope,
}
_FACET_ENUMS = {
    "type": KnowledgeType,
    "review_state": ReviewState,
    "evidence_status": EvidenceStatus,
    "access_scope": AccessScope,
}


def _facets(
    type_: str | None,
    review_state: str | None,
    evidence_status: str | None,
    access_scope: str | None,
) -> dict[str, str | None]:
    """Validate facet values against their enums (empty string = no filter)."""
    raw = {
        "type": type_,
        "review_state": review_state,
        "evidence_status": evidence_status,
        "access_scope": access_scope,
    }
    validated: dict[str, str | None] = {}
    for name, value in raw.items():
        if not value:
            validated[name] = None
            continue
        try:
            _FACET_ENUMS[name](value)
        except ValueError:
            raise ValueError(f"Unknown filter: {value}") from None
        validated[name] = value
    return validated


def _escape_like(term: str) -> str:
    # Literal % and _ in user input must not act as wildcards.
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _criteria(
    facets: dict[str, str | None], q: str | None, exclude: str | None = None
) -> list:
    """WHERE fragments for the given facets, skipping `exclude` (facet counts)."""
    crit: list = []
    for name, value in facets.items():
        if value is None or name == exclude:
            continue
        crit.append(_FACET_COLUMNS[name] == value)
    if q:
        pattern = f"%{_escape_like(q)}%"
        crit.append(
            or_(
                KnowledgeItem.title.ilike(pattern, escape="\\"),
                KnowledgeItem.description.ilike(pattern, escape="\\"),
            )
        )
    return crit


def _count(db: Session, stmt) -> int:
    return db.scalar(select(func.count()).select_from(stmt.subquery())) or 0


def _group_counts(db: Session, base, crit: list, column, enum_cls) -> dict[str, int]:
    # Rebuild the statement around KnowledgeItem: SQLAlchemy 2.1 dropped
    # Select.with_entities, so the visibility whereclause is reused directly.
    stmt = (
        select(column, func.count())
        .select_from(KnowledgeItem)
        .where(base.whereclause, *crit)
        .group_by(column)
    )
    counts = {member.value: 0 for member in enum_cls}
    counts.update({key: value for key, value in db.execute(stmt).all()})
    return counts


def _evidence_refs(db: Session, items: list[KnowledgeItem]) -> dict[uuid.UUID, list[EvidenceRef]]:
    """Evidence pointers for a batch of items (one query, grouped in Python)."""
    if not items:
        return {}
    titles = {item.id: item.title for item in items}
    rows = db.execute(
        select(KnowledgeEvidence, EvidenceChunk, Document)
        .join(EvidenceChunk, EvidenceChunk.id == KnowledgeEvidence.chunk_id)
        .join(Document, Document.id == KnowledgeEvidence.document_id)
        .where(KnowledgeEvidence.item_id.in_(list(titles)))
        .order_by(EvidenceChunk.seq)
    ).all()
    refs: dict[uuid.UUID, list[EvidenceRef]] = {}
    for ev, chunk, doc in rows:
        refs.setdefault(ev.item_id, []).append(
            EvidenceRef(
                document_id=ev.document_id,
                document_name=doc.original_name,
                chunk_id=ev.chunk_id,
                quote=ev.quote,
                # evidence rows may omit provenance; the chunk carries it
                page_number=ev.page_number if ev.page_number is not None else chunk.page_number,
                section=ev.section or chunk.section,
                label=titles[ev.item_id][:80],
            )
        )
    return refs


def _item_out(db: Session, item: KnowledgeItem) -> KnowledgeItemOut:
    out = KnowledgeItemOut.model_validate(item)
    out.evidence = _evidence_refs(db, [item]).get(item.id, [])
    if item.source_document_id is not None:
        out.source_document_name = db.scalar(
            select(Document.original_name).where(Document.id == item.source_document_id)
        )
    return out


def _require_item(db: Session, ctx: ProjectContext, item_id: uuid.UUID) -> KnowledgeItem:
    """Item inside THIS project AND visible to the caller — otherwise 404 (never 403)."""
    item = db.scalar(
        visible_knowledge(db, ctx.user, ctx.project, ctx.role).where(
            KnowledgeItem.id == item_id
        )
    )
    if item is None:
        raise NotFoundError("Knowledge item not found.")
    return item


@router.get("/{project_id}/knowledge", response_model=KnowledgeListOut)
def list_knowledge(
    type_: str | None = Query(default=None, alias="type", description="Knowledge type facet"),
    review_state: str | None = Query(default=None, description="Review state facet"),
    evidence_status: str | None = Query(default=None, description="Evidence status facet"),
    access_scope: str | None = Query(default=None, description="Access scope facet"),
    q: str | None = Query(default=None, description="Free-text search on title + description"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> KnowledgeListOut:
    facets = _facets(type_, review_state, evidence_status, access_scope)
    base = visible_knowledge(db, ctx.user, ctx.project, ctx.role)
    crit = _criteria(facets, q)

    items = db.scalars(
        base.where(*crit)
        .order_by(KnowledgeItem.created_at.desc(), KnowledgeItem.title.asc())
        .limit(limit)
        .offset(offset)
    ).all()

    total = _count(db, base.where(*crit))
    # Faceted counting: each facet's counts ignore its own filter so the UI can
    # show what the other options would return.
    counts_by_type = _group_counts(
        db, base, _criteria(facets, q, exclude="type"), KnowledgeItem.type, KnowledgeType
    )
    counts_by_evidence = _group_counts(
        db,
        base,
        _criteria(facets, q, exclude="evidence_status"),
        KnowledgeItem.evidence_status,
        EvidenceStatus,
    )
    pending_review = _count(
        db,
        base.where(*_criteria(facets, q, exclude="review_state")).where(
            KnowledgeItem.review_state == ReviewState.PENDING
        ),
    )

    refs = _evidence_refs(db, list(items))
    source_ids = {i.source_document_id for i in items if i.source_document_id}
    source_names: dict[uuid.UUID, str] = {}
    if source_ids:
        source_names = dict(
            db.execute(
                select(Document.id, Document.original_name).where(Document.id.in_(source_ids))
            ).all()
        )

    outs: list[KnowledgeItemOut] = []
    for item in items:
        out = KnowledgeItemOut.model_validate(item)
        out.evidence = refs.get(item.id, [])
        out.source_document_name = source_names.get(item.source_document_id)
        outs.append(out)

    return KnowledgeListOut(
        items=outs,
        total=total,
        counts_by_type=counts_by_type,
        counts_by_evidence=counts_by_evidence,
        pending_review=pending_review,
    )


@router.get("/{project_id}/knowledge/{item_id}", response_model=KnowledgeItemOut)
def get_knowledge_item(
    item_id: uuid.UUID,
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> KnowledgeItemOut:
    return _item_out(db, _require_item(db, ctx, item_id))


@router.post("/{project_id}/knowledge/{item_id}/review", response_model=KnowledgeItemOut)
def review_knowledge_item(
    item_id: uuid.UUID,
    payload: ReviewIn,
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> KnowledgeItemOut:
    item = _require_item(db, ctx, item_id)
    action = payload.action

    if action != ReviewAction.COMMENT and not can_review(ctx.role):
        raise PermissionError_("Only a project head or lead can review findings.")

    previous = {
        "review_state": item.review_state,
        "evidence_status": item.evidence_status,
        "corrected_text": item.corrected_text,
    }

    if action == ReviewAction.VERIFY:
        item.review_state = ReviewState.VERIFIED
    elif action == ReviewAction.REJECT:
        item.review_state = ReviewState.REJECTED
    elif action == ReviewAction.CORRECT:
        text = (payload.corrected_text or "").strip()
        if not text:
            raise ValueError("Provide the corrected text.")
        item.corrected_text = text
        item.review_state = ReviewState.CORRECTED
    elif action == ReviewAction.RESTORE:
        # corrected_text is kept as history; restore only reopens the review
        item.review_state = ReviewState.PENDING

    if action != ReviewAction.COMMENT:
        item.reviewed_by = ctx.user.id
        item.reviewed_at = utcnow()

    db.add(
        ReviewRecord(
            id=uuid.uuid4(),
            item_id=item.id,
            reviewer_id=ctx.user.id,
            action=str(action),
            note=payload.note,
            previous_state=previous,
            created_at=utcnow(),
        )
    )
    audit.record(
        db,
        action=audit.A.KNOWLEDGE_REVIEW,
        actor_id=ctx.user.id,
        project_id=ctx.project.id,
        workspace_id=ctx.project.workspace_id,
        target_type="knowledge_item",
        target_id=item.id,
        summary=f"{action}: {item.title[:80]}",
        meta={
            "action": str(action),
            "previous": previous,
            "new": {
                "review_state": item.review_state,
                "evidence_status": item.evidence_status,
                "corrected_text": item.corrected_text,
            },
        },
    )
    db.commit()
    db.refresh(item)
    return _item_out(db, item)


@router.get("/{project_id}/knowledge/{item_id}/evidence", response_model=list[EvidenceOut])
def list_item_evidence(
    item_id: uuid.UUID,
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> list[EvidenceOut]:
    item = _require_item(db, ctx, item_id)
    rows = db.execute(
        select(KnowledgeEvidence, Document)
        .join(Document, Document.id == KnowledgeEvidence.document_id)
        .where(KnowledgeEvidence.item_id == item.id)
        .order_by(KnowledgeEvidence.id)
    ).all()
    return [
        EvidenceOut(
            id=ev.id,
            item_id=ev.item_id,
            document_id=ev.document_id,
            document_name=doc.original_name,
            quote=ev.quote,
            page_number=ev.page_number,
            section=ev.section,
            confidence=ev.confidence,
        )
        for ev, doc in rows
    ]


@router.delete("/{project_id}/knowledge/{item_id}", response_model=OkResponse)
def delete_knowledge_item(
    item_id: uuid.UUID,
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> OkResponse:
    # existence/visibility first: a foreign project's id must 404, never 403
    item = _require_item(db, ctx, item_id)
    if not can_review(ctx.role):
        raise PermissionError_("Only a project head or lead can delete findings.")

    item_pk, title = item.id, item.title
    db.delete(item)  # ORM cascades evidences + review records
    audit.record(
        db,
        action=audit.A.KNOWLEDGE_REVIEW,
        actor_id=ctx.user.id,
        project_id=ctx.project.id,
        workspace_id=ctx.project.workspace_id,
        target_type="knowledge_item",
        target_id=item_pk,
        summary=f"delete: {title[:80]}",
        meta={"action": "delete"},
    )
    db.commit()
    return OkResponse(message="Knowledge item deleted.")


_GRAPH_NODE_CAP = 400

# Stable column order for the frontend's layered layout (group = type ordinal).
_GRAPH_TYPE_ORDER = [
    KnowledgeType.PERSON,
    KnowledgeType.DECISION,
    KnowledgeType.TASK,
    KnowledgeType.DEPENDENCY,
    KnowledgeType.RISK,
    KnowledgeType.CONTACT,
    KnowledgeType.QUESTION,
    KnowledgeType.GAP,
]


@router.get("/{project_id}/graph", response_model=GraphOut)
def get_knowledge_graph(
    ctx: ProjectContext = Depends(project_context),
    db: Session = Depends(get_db),
) -> GraphOut:
    """Nodes + edges the caller is authorised to see (scope filter first)."""
    total = _count(db, visible_knowledge(db, ctx.user, ctx.project, ctx.role))
    items = db.scalars(
        visible_knowledge(db, ctx.user, ctx.project, ctx.role)
        .order_by(KnowledgeItem.type, KnowledgeItem.title)
        .limit(_GRAPH_NODE_CAP)
    ).all()
    visible_ids = {item.id for item in items}

    group_of = {t: i for i, t in enumerate(_GRAPH_TYPE_ORDER)}
    nodes = [
        GraphNode(
            id=item.id,
            type=KnowledgeType(item.type),
            title=item.title,
            evidence_status=EvidenceStatus(item.evidence_status),
            review_state=ReviewState(item.review_state),
            access_scope=AccessScope(item.access_scope),
            is_sample=item.is_sample,
            subject_user_id=item.subject_user_id,
            group=group_of.get(KnowledgeType(item.type), len(_GRAPH_TYPE_ORDER)),
        )
        for item in items
    ]

    edges: list[EdgeOut] = []
    if visible_ids:
        rows = db.scalars(
            select(KnowledgeRelationship).where(
                KnowledgeRelationship.project_id == ctx.project.id,
                KnowledgeRelationship.src_item_id.in_(visible_ids),
                KnowledgeRelationship.dst_item_id.in_(visible_ids),
            )
        ).all()
        edges = [
            EdgeOut(
                id=edge.id,
                src_item_id=edge.src_item_id,
                dst_item_id=edge.dst_item_id,
                rel_type=edge.rel_type,
                label=edge.label,
                evidence_status=edge.evidence_status,
                is_sample=edge.is_sample,
            )
            for edge in rows
        ]

    return GraphOut(
        nodes=nodes,
        edges=edges,
        truncated=total > len(nodes),
        node_count=len(nodes),
        edge_count=len(edges),
    )
