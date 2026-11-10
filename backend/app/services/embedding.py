"""Embeddings client — NVIDIA NIM (nemotron-3-embed-1b, 2048 dims)."""
from __future__ import annotations

import asyncio
import logging
from typing import Sequence

import httpx

from app.core.config import get_settings

log = logging.getLogger("projectpulse.embed")
print("EMBEDDING.PY MODULE LOADED - v4 BATCHED", flush=True)

MODEL_NAME = "nvidia/nemotron-3-embed-1b"  # 2048 dims


def _headers() -> dict[str, str]:
    s = get_settings()
    return {
        "Authorization": f"Bearer {s.llm_api_key}",
        "Content-Type": "application/json",
    }


def _encode_batch(texts: list[str]) -> list[list[float]]:
    s = get_settings()
    items = [t if t and t.strip() else " " for t in texts]
    if not items:
        return []
    # NVIDIA embeddings API accepts an array of inputs in one call — batch all
    # chunks together instead of one HTTP request per chunk.
    resp = httpx.post(
        f"{s.llm_base_url}/embeddings",
        headers=_headers(),
        json={"model": MODEL_NAME, "input": items},
        timeout=s.llm_timeout_seconds,
    )
    if resp.status_code >= 400:
        raise RuntimeError(
            f"NVIDIA embeddings HTTP {resp.status_code}: {resp.text[:300]}"
        )
    data = resp.json()
    vectors = [entry["embedding"] for entry in data["data"]]
    if len(vectors) != len(items):
        raise RuntimeError(
            f"NVIDIA embeddings returned {len(vectors)} vectors for {len(items)} inputs"
        )
    return vectors


async def embed_texts(texts: Sequence[str]) -> list[list[float]]:
    """Embed a batch of texts. Returns one vector per input, in order."""
    if not texts:
        return []
    import asyncio as _asyncio

    return await _asyncio.to_thread(_encode_batch, list(texts))


async def embed_query(text: str) -> list[float]:
    import asyncio as _asyncio

    result = await _asyncio.to_thread(_encode_batch, [text])
    return result[0]


def embed_texts_sync(texts: Sequence[str]) -> list[list[float]]:
    return _encode_batch(list(texts))
