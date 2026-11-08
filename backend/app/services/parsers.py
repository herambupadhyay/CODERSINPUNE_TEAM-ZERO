"""File parsers: produce plain text plus per-page provenance for ingestion."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import fitz
from docx import Document as DocxDocument

SUPPORTED_KINDS = ("pdf", "docx", "txt", "markdown", "csv")
_UNSUPPORTED = "That file type isn't supported — upload PDF, DOCX, TXT, MD or CSV."


@dataclass
class ParsedDoc:
    text: str
    page_texts: list[tuple[int | None, str]]
    page_count: int
    char_count: int


def _normalize(raw: str) -> str:
    return raw.replace("\r\n", "\n").replace("\r", "\n")


def _plain_doc(raw: str) -> ParsedDoc:
    text = _normalize(raw)
    return ParsedDoc(text=text, page_texts=[(None, text)], page_count=1, char_count=len(text))


def parse_file(path: Path, kind: str) -> ParsedDoc:
    """Parse a stored upload into plain text.

    PDFs keep one entry per page (1-based page numbers); every other kind is
    a single logical page whose number is None. Raises FileNotFoundError for
    missing files and ValueError for unknown kinds.
    """
    if kind not in SUPPORTED_KINDS:
        raise ValueError(_UNSUPPORTED)
    if not path.is_file():
        raise FileNotFoundError(f"Could not find the stored upload: {path.name}")

    if kind in ("txt", "markdown", "csv"):
        return _plain_doc(path.read_bytes().decode("utf-8", errors="replace"))

    if kind == "docx":
        document = DocxDocument(str(path))
        return _plain_doc("\n".join(paragraph.text for paragraph in document.paragraphs))

    document = fitz.open(path)
    try:
        pages = [
            (index, _normalize(page.get_text("text")))
            for index, page in enumerate(document, start=1)
        ]
    finally:
        document.close()
    text = "\n\n".join(body for _, body in pages)
    return ParsedDoc(text=text, page_texts=pages, page_count=len(pages), char_count=len(text))


__all__ = ["ParsedDoc", "parse_file", "SUPPORTED_KINDS"]
