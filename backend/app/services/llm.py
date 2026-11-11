"""OpenAI-compatible chat client with fallback + demo mode.

Contract used by extraction, assistant and handover generation:
    result = await chat(messages, json_mode=True)
    result.content   -> assistant text (never reasoning_content)
    result.model     -> model that actually answered
    result.demo_mode -> True when a canned response was produced (no key)
"""
from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.core.config import get_settings

log = logging.getLogger("projectpulse.llm")


@dataclass
class LLMResult:
    content: str
    model: str
    demo_mode: bool = False
    usage: dict = field(default_factory=dict)
    attempts: int = 0


class LLMError(RuntimeError):
    pass


def _headers() -> dict[str, str]:
    s = get_settings()
    return {
        "Authorization": f"Bearer {s.llm_api_key}",
        "Content-Type": "application/json",
    }


def _payload(
    messages: list[dict[str, str]],
    *,
    json_mode: bool,
    temperature: float,
    max_tokens: int,
    model: str,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    return body


def _extract_content(data: dict[str, Any]) -> str:
    """NVIDIA may return reasoning_content; only `content` is the answer."""
    choice = (data.get("choices") or [{}])[0]
    message = choice.get("message") or {}
    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        reasoning = message.get("reasoning_content")
        if isinstance(reasoning, str) and reasoning.strip():
            return reasoning.strip()
        raise LLMError("Empty completion from model.")
    return content


async def chat(
    messages: list[dict[str, str]],
    *,
    json_mode: bool = False,
    temperature: float = 0.2,
    max_tokens: int = 2048,
    model: str | None = None,
) -> LLMResult:
    s = get_settings()
    if s.demo_sample_mode:
        return LLMResult(content=_demo_response(messages, json_mode=json_mode),
                         model="demo", demo_mode=True)

    primary = model or s.llm_model
    fallback = s.llm_fallback_model
    last_error: Exception | None = None

    # candidate order: primary, primary (json retry with more room), fallback
    plan: list[str] = [primary]
    if json_mode:
        plan.append(primary)
    if fallback and fallback != primary:
        plan.append(fallback)

    for attempt, candidate in enumerate(plan, start=1):
        if not candidate:
            continue
        # on the JSON retry, give the model double the budget
        budget = max_tokens * (2 if (json_mode and attempt == 2) else 1)
        try:
            async with httpx.AsyncClient(timeout=s.llm_timeout_seconds) as client:
                resp = await client.post(
                    f"{s.llm_base_url}/chat/completions",
                    headers=_headers(),
                    json=_payload(
                        messages, json_mode=json_mode, temperature=temperature,
                        max_tokens=budget, model=candidate,
                    ),
                )
                if resp.status_code >= 400:
                    raise LLMError(
                        f"{candidate} -> HTTP {resp.status_code}: "
                        f"{(resp.text or resp.reason_phrase or '')[:300]}"
                    )
                data = resp.json()
                content = _extract_content(data)
                if json_mode:
                    _validate_json(content)
                return LLMResult(
                    content=content,
                    model=candidate,
                    usage=data.get("usage") or {},
                    attempts=attempt,
                )
        except (httpx.HTTPError, LLMError, json.JSONDecodeError) as exc:
            last_error = exc
            log.warning("LLM attempt %s failed (%s): %s", attempt, candidate, exc)
            await asyncio.sleep(0.4)

    raise LLMError(f"LLM unavailable: {last_error}")


def _validate_json(content: str) -> dict:
    text = content.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise LLMError(f"Model returned invalid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise LLMError("Model returned JSON that is not an object.")
    return parsed


async def chat_json(
    messages: list[dict[str, str]],
    *,
    temperature: float = 0.1,
    max_tokens: int = 4096,
) -> dict:
    """Chat that guarantees a parsed JSON object back."""
    result = await chat(
        messages, json_mode=True, temperature=temperature, max_tokens=max_tokens
    )
    return _validate_json(result.content)


def _demo_response(messages: list[dict[str, str]], *, json_mode: bool) -> str:
    """Deterministic canned output so the app works with no provider key.

    The user message conventionally carries the instructions; we return a
    well-formed object matching the most common call shape (extraction).
    """
    if json_mode:
        return json.dumps(
            {
                "demo": True,
                "note": "Sample mode: connect an LLM key for live extraction.",
                "items": [],
            }
        )
    return (
        "Sample mode is on, so I can't reach a live model. "
        "Add LLM_API_KEY to .env to enable full answers. "
        "Everything else — documents, evidence, permissions — is real."
    )


def chat_sync(
    messages: list[dict[str, str]],
    *,
    json_mode: bool = False,
    temperature: float = 0.2,
    max_tokens: int = 2048,
) -> LLMResult:
    """Blocking variant for scripts (seed/migrations) that run outside asyncio."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    if loop is not None and loop.is_running():
        raise LLMError("chat_sync called from a running event loop; use `await chat(...)`.")
    return asyncio.run(
        chat(messages, json_mode=json_mode, temperature=temperature, max_tokens=max_tokens)
    )
