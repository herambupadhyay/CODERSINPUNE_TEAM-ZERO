"""SQLAlchemy declarative base and shared column helpers."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.db.types import IntEnum, StrEnum  # noqa: F401  (re-exported for models)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class UUIDPk:
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )


class Timestamped:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        default=utcnow,
        onupdate=utcnow,
    )


def jsonb() -> Mapped[dict]:
    return mapped_column(JSONB, nullable=False, default=dict)


__all__ = [
    "Base",
    "UUIDPk",
    "Timestamped",
    "utcnow",
    "JSONB",
    "UUID",
    "String",
    "DateTime",
    "Mapped",
    "mapped_column",
    "IntEnum",
    "StrEnum",
]
