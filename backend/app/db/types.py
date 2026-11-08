"""Enum helpers.

Domain enums are stored as short strings (readable in SQL, portable across
databases, simple in Alembic). Validation happens in Pydantic schemas where
the enums are re-used directly.
"""
from __future__ import annotations

from enum import StrEnum as _StrEnum
from enum import IntEnum as _IntEnum

from sqlalchemy import String


class StrEnum(_StrEnum):
    """Base for string-backed domain enums."""

    @classmethod
    def db_type(cls):  # pragma: no cover - helper for raw SQL
        return String(40)


class IntEnum(_IntEnum):
    """Base for int-backed domain enums (rarely used)."""


__all__ = ["StrEnum", "IntEnum"]
