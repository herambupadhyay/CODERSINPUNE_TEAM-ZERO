"""Smoke suite: auth, tenancy, permission isolation, knowledge, graph, health.

These tests run against the real PostgreSQL test database with the real
application — no mocks. They guard the product's core promise: data never
leaks across workspaces or to non-members (404, never 403, for outsiders).
"""
from __future__ import annotations

import uuid

from app.core.security import hash_password
from app.db.base import utcnow
from app.db.models import (
    KnowledgeItem,
    KnowledgeRelationship,
    Project,
    ProjectMember,
    User,
    WorkspaceMember,
)
from app.db.session import SessionLocal
from app.domain.enums import (
    EvidenceStatus,
    KnowledgeType,
    MemberStatus,
    ProjectRole,
    ReviewState,
    WorkspaceRole,
)


# ---------------------------------------------------------------------------
# Meta / health
# ---------------------------------------------------------------------------

def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["database"] == "ok"
    assert body["pgvector"] is True


# ---------------------------------------------------------------------------
# Auth lifecycle
# ---------------------------------------------------------------------------

def test_signup_me_logout(owner, cleanup):
    client, session, email = owner
    cleanup.append(email)
    assert session["user"]["email"] == email
    assert session["primary_workspace_id"]

    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["workspaces"][0]["role"] == "owner"

    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/auth/me").status_code == 401


def test_login_rejects_wrong_password(owner, cleanup):
    client, session, email = owner
    cleanup.append(email)
    client.post("/api/auth/logout")

    bad = client.post("/api/auth/login", json={"email": email, "password": "wrong-password"})
    assert bad.status_code == 403
    assert bad.json()["error"] == "permission_denied"

    good = client.post("/api/auth/login", json={"email": email, "password": "SmokeTest!2026"})
    assert good.status_code == 200


def test_requires_auth_for_protected_routes(client):
    assert client.get("/api/workspaces").status_code == 401
    assert client.get("/api/projects", params={"workspace_id": uuid.uuid4()}).status_code == 401


# ---------------------------------------------------------------------------
# Tenancy + project lifecycle
# ---------------------------------------------------------------------------

def _create_project(client, session, name="Smoke Project"):
    ws = session["primary_workspace_id"]
    r = client.post(
        "/api/projects",
        params={"workspace_id": ws},
        json={"name": name, "description": "created by smoke test", "tags": ["smoke"]},
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_project_create_and_counts(owner, cleanup):
    client, session, email = owner
    cleanup.append(email)
    project = _create_project(client, session)
    assert project["my_role"] == "head"
    assert project["counts"]["members"] == 1

    fetched = client.get(f"/api/projects/{project['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["name"] == "Smoke Project"


def test_outsider_cannot_see_project(owner, outsider, cleanup):
    client, session, email = owner
    out_client, out_session, out_email = outsider
    cleanup.extend([email, out_email])
    project = _create_project(client, session)

    # not a member: the project must not exist for them (404, never 403)
    assert out_client.get(f"/api/projects/{project['id']}").status_code == 404
    assert out_client.get(f"/api/projects/{project['id']}/members").status_code == 404
    assert out_client.get(f"/api/projects/{project['id']}/knowledge").status_code == 404
    assert out_client.get(f"/api/projects/{project['id']}/graph").status_code == 404

    # and the owner's workspace is invisible too
    assert out_client.get(f"/api/workspaces/{session['primary_workspace_id']}").status_code == 404


def test_non_members_are_not_listed_in_projects(owner, outsider, cleanup):
    client, session, email = owner
    out_client, _s, out_email = outsider
    cleanup.extend([email, out_email])
    _create_project(client, session)

    # outsider's own workspace has no projects
    r = out_client.get("/api/projects", params={"workspace_id": out_session_ws(out_client)})
    assert r.status_code == 200
    assert r.json() == []


def out_session_ws(client) -> str:
    me = client.get("/api/auth/me").json()
    return me["primary_workspace_id"]


# ---------------------------------------------------------------------------
# Knowledge + review permissions + graph
# ---------------------------------------------------------------------------

def _seed_knowledge(project_id: str, owner_email: str) -> tuple[str, str]:
    """Insert one knowledge item + relationship directly (bypasses LLM)."""
    db = SessionLocal()
    try:
        project = db.get(Project, uuid.UUID(project_id))
        owner = db.query(User).filter(User.email == owner_email.lower()).one()
        item = KnowledgeItem(
            id=uuid.uuid4(),
            project_id=project.id,
            type=KnowledgeType.TASK,
            title="Rotate settlement certificates",
            description="Certificates rotate quarterly; owner documented in runbook.",
            attributes={"owner": "Smoke Owner", "status": "open"},
            evidence_status=EvidenceStatus.SUPPORTED,
            review_state=ReviewState.PENDING,
            is_sample=False,
            source_document_id=None,
            extraction_run="smoke",
            created_at=utcnow(),
        )
        gap = KnowledgeItem(
            id=uuid.uuid4(),
            project_id=project.id,
            type=KnowledgeType.GAP,
            title="Vendor renewal date undocumented",
            description="No source states the vendor contract renewal date.",
            attributes={},
            evidence_status=EvidenceStatus.MISSING,
            review_state=ReviewState.PENDING,
            is_sample=False,
            extraction_run="smoke",
            created_at=utcnow(),
        )
        edge = KnowledgeRelationship(
            id=uuid.uuid4(),
            project_id=project.id,
            src_item_id=item.id,
            dst_item_id=gap.id,
            rel_type="related_to",
            evidence_status=EvidenceStatus.SUPPORTED,
        )
        db.add_all([item, gap, edge])
        db.commit()
        return str(item.id), str(gap.id)
    finally:
        db.close()


def test_knowledge_list_review_and_graph(owner, outsider, cleanup):
    client, session, email = owner
    out_client, _s, out_email = outsider
    cleanup.extend([email, out_email])
    project = _create_project(client, session)
    item_id, gap_id = _seed_knowledge(project["id"], email)

    # list: both items visible to the head, faceted counts filled
    r = client.get(f"/api/projects/{project['id']}/knowledge")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 2
    assert body["counts_by_type"]["task"] == 1
    assert body["counts_by_evidence"]["missing"] == 1
    assert body["pending_review"] == 2

    # verify as head -> verified + audited
    r = client.post(
        f"/api/projects/{project['id']}/knowledge/{item_id}/review",
        json={"action": "verify", "note": "checked against runbook"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["review_state"] == "verified"

    # outsider gets 404 (existence hidden), never a 403
    assert out_client.get(
        f"/api/projects/{project['id']}/knowledge/{item_id}"
    ).status_code == 404

    # graph: 2 nodes, 1 edge, layout groups populated
    g = client.get(f"/api/projects/{project['id']}/graph")
    assert g.status_code == 200, g.text
    graph = g.json()
    assert graph["node_count"] == 2
    assert graph["edge_count"] == 1
    assert graph["truncated"] is False
    assert {n["type"] for n in graph["nodes"]} == {"task", "gap"}
    assert all(isinstance(n["group"], int) for n in graph["nodes"])

    # outsider graph for a project they can't see -> 404
    assert out_client.get(f"/api/projects/{project['id']}/graph").status_code == 404


def test_member_cannot_review(owner, cleanup):
    """A project member lacks review authority — 403 inside their own project."""
    client, session, email = owner
    cleanup.append(email)
    project = _create_project(client, session)
    item_id, _gap = _seed_knowledge(project["id"], email)

    # create a second user, add them as project MEMBER (member = no review rights)
    member_email = f"smoke_member_{uuid.uuid4().hex[:8]}@example.com"
    cleanup.append(member_email)
    db = SessionLocal()
    try:
        member = User(
            id=uuid.uuid4(),
            email=member_email,
            name="Smoke Member",
            password_hash=hash_password("SmokeTest!2026"),
            is_active=True,
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        db.add(member)
        db.flush()
        db.add(
            WorkspaceMember(
                id=uuid.uuid4(),
                workspace_id=uuid.UUID(session["primary_workspace_id"]),
                user_id=member.id,
                role=WorkspaceRole.MEMBER,
                status=MemberStatus.ACTIVE,
                created_at=utcnow(),
                updated_at=utcnow(),
            )
        )
        db.add(
            ProjectMember(
                id=uuid.uuid4(),
                project_id=uuid.UUID(project["id"]),
                user_id=member.id,
                role=ProjectRole.MEMBER,
                status=MemberStatus.ACTIVE,
                created_at=utcnow(),
                updated_at=utcnow(),
            )
        )
        db.commit()
    finally:
        db.close()

    from fastapi.testclient import TestClient

    from app.main import app as main_app

    member_client = TestClient(main_app)
    assert member_client.post(
        "/api/auth/login", json={"email": member_email, "password": "SmokeTest!2026"}
    ).status_code == 200

    # member CAN read knowledge
    assert member_client.get(
        f"/api/projects/{project['id']}/knowledge"
    ).status_code == 200

    # member CANNOT verify
    r = member_client.post(
        f"/api/projects/{project['id']}/knowledge/{item_id}/review",
        json={"action": "verify"},
    )
    assert r.status_code == 403
    assert "head or lead" in r.json()["detail"]

    # member CAN upload (contribution is a member right) — the upload succeeds
    # end-to-end: parse -> chunk -> embed -> extract
    r = member_client.post(
        f"/api/projects/{project['id']}/documents",
        files={"file": ("note.md", b"# harmless note for extraction", "text/markdown")},
        data={"access_scope": "project"},
    )
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# Authority surface
# ---------------------------------------------------------------------------

def test_authority_overview(owner, cleanup):
    client, session, email = owner
    cleanup.append(email)
    project = _create_project(client, session)

    r = client.get(f"/api/projects/{project['id']}/authority")
    assert r.status_code == 200
    overview = r.json()
    assert len(overview["roles"]) == 4
    assert len(overview["scopes"]) == 2
    assert any(c["key"] == "approve_handover" for c in overview["capabilities"])
    assert any(m["project_role"] == "head" for m in overview["members"])

    me = client.get(f"/api/projects/{project['id']}/authority/me").json()
    assert me["project_role"] == "head"
    assert me["can"]["approve_handover"] is True
    assert me["can"]["upload_documents"] is True
