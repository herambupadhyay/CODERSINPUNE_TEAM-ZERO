"""Paragraph-aware chunking with exact character provenance.

Chunks are contiguous slices of ``ParsedDoc.text``: every chunk satisfies
``text == source[char_start:char_end]`` and the union of chunk ranges covers
the whole source, so evidence quotes can always be located back in the file.
"""
from __future__ import annotations

import re
from bisect import bisect_right
from dataclasses import dataclass

from app.services.parsers import ParsedDoc

TARGET_MIN = 700
TARGET_MAX = 1000
HARD_MAX = 1400
OVERLAP = 120

_MD_HEADING = re.compile(r"^#{1,6}\s+(?P<title>.+)$")
_NUMBERED = re.compile(r"^(?:\d{1,2}(?:\.\d{1,2})+|\d{1,2}\.)\s+")
_SENTENCE_END = re.compile(r'[.!?]["\')\]]?(?=\s|$)')
_BLANK_RUN = re.compile(r"\n{2,}")


@dataclass
class ChunkDraft:
    seq: int
    text: str
    page_number: int | None
    section: str | None
    char_start: int
    char_end: int


def _title_case(words: list[str]) -> bool:
    cased = [w for w in words if any(c.isalpha() for c in w)]
    return bool(cased) and all(
        w[0].isupper() for w in cased if w[0].isalpha()
    )


def _section_title(line: str) -> str | None:
    """Detect a heading line (markdown / numbered / ALL-CAPS / short Title Case)."""
    s = line.strip()
    if not s or len(s) >= 70 or s.endswith((".", ",", ";", ":", "!", "?")):
        return None
    md = _MD_HEADING.match(s)
    if md:
        return md.group("title").strip()[:255]
    words = s.split()
    numbered = _NUMBERED.match(s)
    if numbered:
        rest = s[numbered.end():]
        if 1 <= len(words) <= 12 and rest[:1].isupper():
            return s[:255]
        return None
    letters = [c for c in s if c.isalpha()]
    if letters and all(c.isupper() for c in letters):
        return s[:255]
    if "," not in s and 1 <= len(words) <= 8 and s[0].isupper() and _title_case(words):
        return s[:255]
    return None


def _headings(text: str) -> list[tuple[int, str]]:
    found: list[tuple[int, str]] = []
    offset = 0
    for line in text.split("\n"):
        title = _section_title(line)
        if title:
            found.append((offset, title))
        offset += len(line) + 1
    return found


def _unit_starts(text: str) -> list[int]:
    """Offsets where units may begin: after each blank-line separator."""
    starts = [0]
    for match in _BLANK_RUN.finditer(text):
        pos = match.end()
        if pos >= len(text) or not text[starts[-1]:pos].strip():
            continue  # leading whitespace stays glued to the following content
        starts.append(pos)
    return starts


def _whitespace_cut(text: str, start: int, end: int) -> int:
    limit = min(end, start + TARGET_MAX)
    window = text[start:limit]
    cut = max(window.rfind(" "), window.rfind("\n"))
    return start + cut + 1 if cut > 0 else limit


def _sentence_cuts(text: str, start: int, end: int) -> list[int]:
    cuts: list[int] = []
    for match in _SENTENCE_END.finditer(text, start, end):
        pos = match.end()
        while pos < end and text[pos] in " \t\r":
            pos += 1
        while pos < end and text[pos] == "\n":
            pos += 1
        if pos > start:
            cuts.append(pos)
    return cuts


def _split_oversized(text: str, start: int, end: int) -> list[tuple[int, int]]:
    """Break a single unit longer than HARD_MAX at sentence boundaries."""
    cuts = _sentence_cuts(text, start, end)
    pieces: list[tuple[int, int]] = []
    prev = start
    for cut in cuts + [end]:
        if cut <= prev:
            continue
        while cut - prev > HARD_MAX:
            forced = _whitespace_cut(text, prev, cut)
            if forced <= prev:
                forced = min(prev + TARGET_MAX, cut)
            pieces.append((prev, forced))
            prev = forced
        if cut - prev >= TARGET_MIN or cut == end:
            pieces.append((prev, cut))
            prev = cut
    return pieces


def _build_units(text: str) -> list[tuple[int, int]]:
    starts = _unit_starts(text)
    bounds = starts + [len(text)]
    units: list[tuple[int, int]] = []
    for i in range(len(bounds) - 1):
        lo, hi = bounds[i], bounds[i + 1]
        if hi <= lo:
            continue
        if hi - lo > HARD_MAX:
            units.extend(_split_oversized(text, lo, hi))
        else:
            units.append((lo, hi))
    return units


def _chunk_end(units: list[tuple[int, int]], starts: list[int], start: int) -> int:
    """Pick the end of the chunk beginning at ``start`` (paragraph merge rules)."""
    idx = max(bisect_right(starts, start) - 1, 0)
    end = units[idx][1]
    j = idx
    while j + 1 < len(units):
        candidate = units[j + 1][1]
        span = candidate - start
        if span <= TARGET_MAX:
            end = candidate
            j += 1
            continue
        # next unit overflows the target window: stop once we reached the
        # target band, or when taking it would exceed the hard size limit
        if end - start >= TARGET_MIN or span > HARD_MAX:
            break
        end = candidate
        j += 1
    return end


def _page_spans(parsed: ParsedDoc) -> list[tuple[int, int, int | None]]:
    spans: list[tuple[int, int, int | None]] = []
    pos = 0
    for page_number, page_text in parsed.page_texts:
        spans.append((pos, pos + len(page_text), page_number))
        pos += len(page_text) + 2  # page_texts are joined with "\n\n"
    return spans


def _page_for(spans: list[tuple[int, int, int | None]], start: int, end: int) -> int | None:
    best: int | None = None
    best_overlap = 0
    for lo, hi, page in spans:
        overlap = min(end, hi) - max(start, lo)
        if overlap > best_overlap:
            best_overlap = overlap
            best = page
    return best


def chunk_text(parsed: ParsedDoc) -> list[ChunkDraft]:
    """Split parsed text into overlapping, paragraph-aware chunks."""
    text = parsed.text
    if not text or not text.strip():
        return []

    units = _build_units(text)
    starts = [unit[0] for unit in units]
    headings = _headings(text)
    heading_offsets = [offset for offset, _ in headings]
    spans = _page_spans(parsed)

    chunks: list[ChunkDraft] = []
    pos = 0
    seq = 0
    while pos < len(text):
        end = _chunk_end(units, starts, pos)
        if end <= pos:
            end = min(pos + 1, len(text))
        has_content = bool(text[pos:end].strip())
        if has_content:
            section_idx = bisect_right(heading_offsets, pos) - 1
            chunks.append(
                ChunkDraft(
                    seq=seq,
                    text=text[pos:end],
                    page_number=_page_for(spans, pos, end),
                    section=headings[section_idx][1] if section_idx >= 0 else None,
                    char_start=pos,
                    char_end=end,
                )
            )
            seq += 1
        if end >= len(text):
            break
        if has_content:
            pos = end - OVERLAP if end - OVERLAP > pos else end
        else:
            pos = end
    return chunks


__all__ = ["ChunkDraft", "chunk_text"]
