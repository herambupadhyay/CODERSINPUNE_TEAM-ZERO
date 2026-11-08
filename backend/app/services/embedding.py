"""Embeddings client — NVIDIA nemotron-3-embed-1b (2048 dims)."""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Sequence

import httpx

from app.core.config import get_settings

log = logging.getLogger("projectpulse.embed")

BATCH_SIZE = 32


def _headers() -> dict[str, str]:
    s = get_settings()
    return {"Authorization": f"Bearer {s.llm_api_key}", "Content-Type": "application/json"}


async def embed_texts(texts: Sequence[str]) -> list[list[float]]:
    """Embed a batch of texts. Returns one vector per input, in order."""
    s = get_settings()
    items = [t if t and t.strip() else " " for t in texts]
    if not items:
        return []
    if s.demo_sample_mode:
        # deterministic pseudo-vectors (demo only; never presented as live AI)
        return [_pseudo_vector(t, s.embed_dim) for t in items]

    vectors: list[list[float]] = []
    for start in range(0, len(items), BATCH_SIZE):
        batch = items[start : start + BATCH_SIZE]
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{s.llm_base_url}/embeddings",
                headers=_headers(),
                json={"model": s.embed_model, "input": batch, "input_type": "passage"},
            )
            resp.raise_for_status()
            data = resp.json()
        rows = sorted(data.get("data") or [], key=lambda r: r.get("index", 0))
        if len(rows) != len(batch):
            raise RuntimeError(f"Embedding API returned {len(rows)} vectors for {len(batch)} inputs.")
        vectors.extend([r["embedding"] for r in rows])
    return vectors


async def embed_query(text: str) -> list[float]:
    s = get_settings()
    if s.demo_sample_mode:
        return _pseudo_vector(text, s.embed_dim)
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{s.llm_base_url}/embeddings",
            headers=_headers(),
            json={"model": s.embed_model, "input": [text], "input_type": "query"},
        )
        resp.raise_for_status()
        data = resp.json()
    return data["data"][0]["embedding"]


def embed_texts_sync(texts: Sequence[str]) -> list[list[float]]:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        pass
    else:
        raise RuntimeError("embed_texts_sync called inside an event loop; await embed_texts instead.")
    return asyncio.run(embed_texts(texts))


def _pseudo_vector(text: str, dim: int) -> list[float]:
    """Stable hash-based unit vector for demo mode (similarity still meaningful-ish)."""
    import hashlib
    import math

    digest = hashlib.sha256(text.encode("utf-8")).digest()
    out: list[float] = []
    seed = digest
    while len(out) < dim:
        for b in seed:
            out.append((b / 255.0) * 2.0 - 1.0)
            if len(out) >= dim:
                break
        seed = hashlib.sha256(seed).digest()
    norm = math.sqrt(sum(v * v for v in out)) or 1.0
    return [v / norm for v in out]
