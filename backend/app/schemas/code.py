"""Read-only code browser schemas for the project tree."""
from __future__ import annotations

from app.schemas.common import ApiModel


class CodeTreeFile(ApiModel):
    path: str
    size: int


class CodeTreeOut(ApiModel):
    root: str
    files: list[CodeTreeFile]
    truncated: bool = False


class CodeFileOut(ApiModel):
    path: str
    name: str
    language: str
    size: int
    content: str
    truncated: bool = False


__all__ = ["CodeTreeFile", "CodeTreeOut", "CodeFileOut"]
