"""
LLM provider chain — Agri-SHIELD advisor
========================================
Tried in order; the first configured provider that answers wins:

1. OpenAI Chat Completions  (OPENAI_API_KEY)
2. Groq (OpenAI-compatible, free tier; GROQ_API_KEY)
3. Ollama local open-source model (OLLAMA_BASE_URL)

If none is configured or all fail, the advisor uses the local grounded composer
(``rag/composer.py``), which is not an LLM and reports provider ``local-grounded``.
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx

from config import settings

logger = logging.getLogger(__name__)

Message = dict  # {"role": "user"|"assistant", "content": str}


async def _openai_compatible(url: str, key: str, model: str, system: str, messages: list[Message]) -> Optional[str]:
    body = {
        "model": model,
        "messages": [{"role": "system", "content": system}] + messages,
        "temperature": 0.3,
        "max_tokens": 900,
    }
    async with httpx.AsyncClient(timeout=settings.llm_timeout_s) as client:
        r = await client.post(url, headers={"Authorization": f"Bearer {key}"}, json=body)
    if r.status_code != 200:
        logger.warning("%s HTTP %s: %s", url, r.status_code, r.text[:200])
        return None
    try:
        return r.json()["choices"][0]["message"]["content"].strip() or None
    except (KeyError, IndexError, TypeError):
        return None


async def _ollama(system: str, messages: list[Message]) -> Optional[str]:
    body = {
        "model": settings.ollama_model,
        "messages": [{"role": "system", "content": system}] + messages,
        "stream": False,
        "options": {"temperature": 0.3},
    }
    async with httpx.AsyncClient(timeout=max(settings.llm_timeout_s, 60.0)) as client:
        r = await client.post(f"{settings.ollama_base_url.rstrip('/')}/api/chat", json=body)
    if r.status_code != 200:
        logger.warning("Ollama HTTP %s: %s", r.status_code, r.text[:200])
        return None
    return (r.json().get("message", {}).get("content") or "").strip() or None


def configured_providers() -> list[str]:
    out = []
    if settings.openai_api_key:
        out.append("openai")
    if settings.groq_api_key:
        out.append("groq")
    if settings.ollama_base_url:
        out.append("ollama")
    return out


async def generate(system: str, messages: list[Message]) -> tuple[Optional[str], Optional[str]]:
    """Return (text, provider label) from the first provider that succeeds, else (None, None)."""
    for name in configured_providers():
        try:
            if name == "openai":
                text = await _openai_compatible("https://api.openai.com/v1/chat/completions", settings.openai_api_key, settings.openai_model, system, messages)
                label = f"openai:{settings.openai_model}"
            elif name == "groq":
                text = await _openai_compatible("https://api.groq.com/openai/v1/chat/completions", settings.groq_api_key, settings.groq_model, system, messages)
                label = f"groq:{settings.groq_model}"
            else:
                text = await _ollama(system, messages)
                label = f"ollama:{settings.ollama_model}"
            if text:
                return text, label
        except Exception as e:
            logger.warning("LLM provider %s failed: %s", name, e)
    return None, None
