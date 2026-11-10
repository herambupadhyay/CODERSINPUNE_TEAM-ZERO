"""Embeddings client — local sentence-transformers (all-MiniLM-L6-v2, 384 dims)."""
from __future__ import annotations

import logging
from functools import lru_cache
from typing import Sequence

from sentence_transformers import SentenceTransformer

from app.core.config import get_settings

log = logging.getLogger("projectpulse.embed")

BATCH_SIZE = 32
MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"  # 384 dims, fast, good quality


@lru_cache(maxsize=1)
def _get_model() -> SentenceTransformer:
    """Lazy-load the model once per process."""
    log.info("Loading embedding model: %s", MODEL_NAME)
    return SentenceTransformer(MODEL_NAME)


def _encode_batch(texts: list[str]) -> list[list[float]]:
    model = _get_model()
    # sentence-transformers returns numpy arrays; convert to list[list[float]]
    return model.encode(texts, batch_size=32, convert_to_numpy=True, normalize_embeddings=True).tolist()


async def embed_texts(texts: Sequence[str]) -> list[list[float]]:
    """Embed a batch of texts. Returns one vector per input, in order."""
    items = [t if t and t.strip() else " " for t in texts]
    if not items:
        return []
    # Run encoding in thread pool to avoid blocking event loop
    import asyncio
    return await asyncio.to_thread(_encode_batch, list(items))


async def embed_query(text: str) -> list[float]:
    import asyncio
    return await asyncio.to_thread(_encode_batch, [text])  # returns list[list[float]]


def embed_texts_sync(texts: Sequence[str]) -> list[list[float]]:
    return _encode_batch(list(texts))
