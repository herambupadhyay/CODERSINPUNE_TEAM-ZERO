"""Embeddings client — local fastembed (BAAI/bge-small-en-v1.5, 384 dims)."""
from __future__ import annotations

import logging
from functools import lru_cache
from typing import Sequence

from fastembed import TextEmbedding

from app.core.config import get_settings

log = logging.getLogger("projectpulse.embed")

MODEL_NAME = "BAAI/bge-small-en-v1.5"  # 384 dims, fast, good quality


@lru_cache(maxsize=1)
def _get_model() -> TextEmbedding:
    """Lazy-load the model once per process."""
    log.info("Loading embedding model: %s", MODEL_NAME)
    return TextEmbedding(model_name=MODEL_NAME)


def _encode_batch(texts: list[str]) -> list[list[float]]:
    model = _get_model()
    # fastembed returns generator of numpy arrays
    return [vec.tolist() for vec in model.embed(texts)]


async def embed_texts(texts: Sequence[str]) -> list[list[float]]:
    """Embed a batch of texts. Returns one vector per input, in order."""
    items = [t if t and t.strip() else " " for t in texts]
    if not items:
        return []
    import asyncio
    return await asyncio.to_thread(_encode_batch, list(items))


async def embed_query(text: str) -> list[float]:
    import asyncio
    return await asyncio.to_thread(_encode_batch, [text])


def embed_texts_sync(texts: Sequence[str]) -> list[list[float]]:
    return _encode_batch(list(texts))
