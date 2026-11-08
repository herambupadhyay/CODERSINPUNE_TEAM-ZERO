"""Shared pytest fixtures — runs everything against the TEST database.

DATABASE_URL is forced *before* the app (and its cached Settings) is imported.
The test database schema is managed by alembic (already migrated).
"""
from __future__ import annotations

import os
import uuid

os.environ["DATABASE_URL"] = (
    "postgresql+psycopg://projectpulse:projectpulse_dev_pw@127.0.0.1:5432/projectpulse_test"
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.security import hash_password  # noqa: E402
from app.db.base import utcnow  # noqa: E402
from app.db.models import User, Workspace  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture()
def owner(client: TestClient):
    """A signed-up owner with their own workspace; yields (client, session_dict)."""
    email = f"smoke_owner_{uuid.uuid4().hex[:10]}@example.com"
    r = client.post(
        "/api/auth/signup",
        json={"email": email, "name": "Smoke Owner", "password": "SmokeTest!2026"},
    )
    assert r.status_code == 200, r.text
    session = r.json()
    yield client, session, email
    client.post("/api/auth/logout")


@pytest.fixture()
def outsider():
    """A second, INDEPENDENT client authenticated as a non-member user.

    (Its own TestClient — reusing the owner's client would clobber the
    session cookie for both.)
    """
    client = TestClient(app)
    email = f"smoke_out_{uuid.uuid4().hex[:10]}@example.com"
    r = client.post(
        "/api/auth/signup",
        json={"email": email, "name": "Smoke Outsider", "password": "SmokeTest!2026"},
    )
    assert r.status_code == 200, r.text
    yield client, r.json(), email
    client.post("/api/auth/logout")


def purge_user(email: str) -> None:
    """Delete a smoke-test user: owned workspaces first (owner FK is RESTRICT)."""
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email.lower()).one_or_none()
        if user is None:
            return
        owned = db.query(Workspace).filter(Workspace.owner_id == user.id).all()
        for ws in owned:
            db.delete(ws)
        # Workspace and User share a plain FK column with no relationship between
        # the mappers, so the unit-of-work won't order these deletes for us.
        # Flush the workspace deletions first, then remove the user.
        if owned:
            db.flush()
        db.delete(user)
        db.commit()
    finally:
        db.close()


@pytest.fixture()
def cleanup():
    """Collect emails to purge after the test."""
    emails: list[str] = []
    yield emails
    for email in emails:
        purge_user(email)
