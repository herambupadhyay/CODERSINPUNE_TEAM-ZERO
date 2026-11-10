"""Read-only code browser for the project tree demo.

Serves a whitelisted, secret-free snapshot of the ProjectPulse repository that
ships with this app, so the demo project has a real codebase to explore. Every
route is gated by project membership; content is read-only and size-capped.
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, Query

from app.core.config import BACKEND_ROOT
from app.core.deps import ProjectContext, project_context
from app.schemas.code import CodeFileOut, CodeTreeFile, CodeTreeOut
from app.services.permissions import NotFoundError

router = APIRouter()

REPO_ROOT = BACKEND_ROOT.parent.resolve()
MAX_FILE_BYTES = 256_000
MAX_TREE_FILES = 4_000

SKIP_DIRS = {
    ".git",
    ".idea",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    ".vscode",
    "__pycache__",
    "dist",
    "node_modules",
    "storage",
    "test-output",
}

TEXT_SUFFIXES = {
    ".cjs",
    ".css",
    ".csv",
    ".example",
    ".html",
    ".ini",
    ".js",
    ".json",
    ".jsx",
    ".md",
    ".mjs",
    ".py",
    ".sh",
    ".svg",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".yaml",
    ".yml",
}

EXACT_FILES = {".gitignore", ".oxlintrc.json", "Dockerfile", "Makefile", "LICENSE"}

LANGUAGES = {
    ".cjs": "JavaScript",
    ".css": "CSS",
    ".csv": "CSV",
    ".example": "Config",
    ".html": "HTML",
    ".ini": "INI",
    ".js": "JavaScript",
    ".json": "JSON",
    ".jsx": "JavaScript React",
    ".md": "Markdown",
    ".mjs": "JavaScript",
    ".py": "Python",
    ".sh": "Shell",
    ".svg": "SVG",
    ".toml": "TOML",
    ".ts": "TypeScript",
    ".tsx": "TypeScript React",
    ".txt": "Text",
    ".yaml": "YAML",
    ".yml": "YAML",
}


def _is_allowed_file(path: Path) -> bool:
    name = path.name
    if name == ".env" or (name.startswith(".env.") and name != ".env.example"):
        return False
    if name.endswith(".log") or name.endswith(".pyc") or name.endswith(".pyo"):
        return False
    if name in EXACT_FILES:
        return True
    return path.suffix.lower() in TEXT_SUFFIXES


def _walk_files() -> tuple[list[CodeTreeFile], bool]:
    files: list[CodeTreeFile] = []
    truncated = False
    for dirpath, dirnames, filenames in os.walk(REPO_ROOT):
        dirnames[:] = sorted(
            d for d in dirnames if d.lower() not in SKIP_DIRS and not d.startswith(".")
        )
        for filename in sorted(filenames):
            if filename.startswith("tmp_"):
                continue
            candidate = Path(dirpath) / filename
            if not _is_allowed_file(candidate):
                continue
            try:
                size = candidate.stat().st_size
            except OSError:
                continue
            if len(files) >= MAX_TREE_FILES:
                truncated = True
                break
            files.append(
                CodeTreeFile(path=candidate.relative_to(REPO_ROOT).as_posix(), size=size)
            )
        if truncated:
            break
    return files, truncated


def _resolve(path: str) -> Path:
    relative = Path(path)
    if relative.is_absolute() or ".." in relative.parts:
        raise NotFoundError("File not found.")
    candidate = (REPO_ROOT / relative).resolve()
    if candidate == REPO_ROOT or not candidate.is_relative_to(REPO_ROOT):
        raise NotFoundError("File not found.")
    if not candidate.is_file() or not _is_allowed_file(candidate):
        raise NotFoundError("File not found.")
    return candidate


@router.get("/{project_id}/code", response_model=CodeTreeOut)
def get_code_tree(
    project_id: uuid.UUID,
    ctx: ProjectContext = Depends(project_context),
) -> CodeTreeOut:
    """List the read-only demo codebase for project members."""
    del project_id, ctx  # membership is the access check
    files, truncated = _walk_files()
    return CodeTreeOut(root=REPO_ROOT.name, files=files, truncated=truncated)


@router.get("/{project_id}/code/file", response_model=CodeFileOut)
def get_code_file(
    project_id: uuid.UUID,
    path: str = Query(min_length=1, max_length=400),
    ctx: ProjectContext = Depends(project_context),
) -> CodeFileOut:
    """Read one whitelisted text file from the demo codebase."""
    del project_id, ctx  # membership is the access check
    candidate = _resolve(path)
    size = candidate.stat().st_size
    truncated = size > MAX_FILE_BYTES
    if truncated:
        with candidate.open("rb") as handle:
            raw = handle.read(MAX_FILE_BYTES)
    else:
        raw = candidate.read_bytes()
    relative = candidate.relative_to(REPO_ROOT).as_posix()
    return CodeFileOut(
        path=relative,
        name=candidate.name,
        language=LANGUAGES.get(candidate.suffix.lower(), "Text"),
        size=size,
        content=raw.decode("utf-8", errors="replace"),
        truncated=truncated,
    )


__all__ = ["router"]
