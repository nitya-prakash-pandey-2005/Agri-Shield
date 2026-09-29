"""
Translation — Agri-SHIELD advisor
=================================
DeepL when ``DEEPL_API_KEY`` is set and the language is supported, otherwise the
free MyMemory API (no key; ≤ 500 bytes per request, so text is chunked at
≤ 480 characters on line/sentence boundaries). Markdown structure (headings,
list markers, bold) is preserved by translating each line's text separately.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Optional

import httpx

from config import settings

logger = logging.getLogger(__name__)

MYMEMORY_URL = "https://api.mymemory.translated.net/get"
MYMEMORY_LANG = {"fil": "tl"}  # MyMemory uses ISO 639-1 'tl' for Filipino/Tagalog
DEEPL_LANG = {"id": "ID", "vi": "VI", "hi": "HI", "bn": "BN"}  # tried first when keyed; falls back on error
LANG_NAMES = {"en": "English", "hi": "Hindi", "bn": "Bengali", "vi": "Vietnamese", "fil": "Filipino", "id": "Indonesian", "ta": "Tamil", "si": "Sinhala"}
_PREFIX = re.compile(r"^(\s*(?:#{1,6}\s+|[-*]\s+|\d+[.)]\s+)?)(.*)$")


def _chunks(text: str, limit: int = 480) -> list[str]:
    if len(text) <= limit:
        return [text]
    parts, cur = [], ""
    for sent in re.split(r"(?<=[.!?;:])\s+", text):
        while len(sent) > limit:  # pathological long sentence: split on spaces
            cut = sent.rfind(" ", 0, limit)
            cut = cut if cut > 0 else limit
            parts.append(sent[:cut])
            sent = sent[cut:].lstrip()
        if len(cur) + len(sent) + 1 > limit and cur:
            parts.append(cur)
            cur = sent
        else:
            cur = f"{cur} {sent}".strip()
    if cur:
        parts.append(cur)
    return parts


async def _mymemory(client: httpx.AsyncClient, text: str, lang: str, sem: asyncio.Semaphore) -> Optional[str]:
    params = {"q": text, "langpair": f"en|{MYMEMORY_LANG.get(lang, lang)}"}
    if settings.mymemory_email:
        params["de"] = settings.mymemory_email
    async with sem:
        r = await client.get(MYMEMORY_URL, params=params)
    if r.status_code != 200:
        return None
    data = r.json()
    if str(data.get("responseStatus")) != "200":
        logger.warning("MyMemory: %s", data.get("responseDetails"))
        return None
    out = (data.get("responseData") or {}).get("translatedText")
    if not out or "MYMEMORY WARNING" in out.upper():
        raise RuntimeError("MyMemory quota exhausted")
    return out


async def _deepl(texts: list[str], lang: str) -> Optional[list[str]]:
    target = DEEPL_LANG.get(lang)
    if not settings.deepl_api_key or not target:
        return None
    host = "api-free.deepl.com" if settings.deepl_api_key.endswith(":fx") else "api.deepl.com"
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.post(
            f"https://{host}/v2/translate",
            headers={"Authorization": f"DeepL-Auth-Key {settings.deepl_api_key}"},
            json={"text": texts, "source_lang": "EN", "target_lang": target, "tag_handling": "html"},
        )
    if r.status_code != 200:
        logger.warning("DeepL HTTP %s: %s", r.status_code, r.text[:160])
        return None
    return [t["text"] for t in r.json()["translations"]]


def _protect(s: str) -> str:
    return re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)


def _restore(s: str) -> str:
    s = re.sub(r"<\s*b\s*>\s*(.+?)\s*<\s*/\s*b\s*>", r"**\1**", s, flags=re.I)
    return s.replace("&#39;", "'").replace("&quot;", '"').replace("&amp;", "&")


async def translate_texts(texts: list[str], lang: str) -> tuple[list[str], str]:
    """Translate a list of markdown strings; returns (texts, engine). Untranslatable input is returned unchanged."""
    if lang in ("en", "", None):
        return texts, "none"
    # Split every text into (prefix, body) lines so markdown markers survive.
    lines: list[tuple[int, str, str]] = []
    for ti, t in enumerate(texts):
        for line in t.split("\n"):
            m = _PREFIX.match(line)
            lines.append((ti, m.group(1), m.group(2)))
    bodies = [_protect(b) for _, _, b in lines]
    translated: Optional[list[str]] = None
    engine = "none"
    try:
        nonempty = [b for b in bodies if b.strip()]
        res = await _deepl(nonempty, lang) if nonempty else []
        if res is not None:
            it = iter(res)
            translated = [next(it) if b.strip() else b for b in bodies]
            engine = "deepl"
    except Exception as e:
        logger.warning("DeepL failed: %s", e)
    if translated is None:
        sem = asyncio.Semaphore(4)
        async with httpx.AsyncClient(timeout=15.0) as client:
            async def one(body: str) -> str:
                if not body.strip() or not re.search(r"[A-Za-z]{2,}", body):
                    return body
                pieces = await asyncio.gather(*[_mymemory(client, c, lang, sem) for c in _chunks(body)], return_exceptions=True)
                if any(p is None or isinstance(p, Exception) for p in pieces):
                    raise RuntimeError("mymemory chunk failed")
                return " ".join(pieces)  # type: ignore[arg-type]

            async def packed(idx: list[int]) -> None:
                """Translate several short lines in one request (newline-joined) to save the free quota."""
                joined = "\n".join(bodies[i] for i in idx)
                res = await _mymemory(client, joined, lang, sem)
                parts = res.split("\n") if res else []
                if len(parts) == len(idx):
                    for i, t in zip(idx, parts):
                        translated[i] = t.strip()
                else:  # line structure not preserved — translate these lines individually
                    for i in idx:
                        translated[i] = await one(bodies[i])

            translated = list(bodies)
            try:
                groups, cur, size = [], [], 0
                for i, b in enumerate(bodies):
                    if not b.strip() or not re.search(r"[A-Za-z]{2,}", b):
                        continue
                    if len(b) > 480:
                        groups.append([i])
                        continue
                    if size + len(b) + 1 > 480 and cur:
                        groups.append(cur)
                        cur, size = [], 0
                    cur.append(i)
                    size += len(b) + 1
                if cur:
                    groups.append(cur)
                singles = [g[0] for g in groups if len(g) == 1 and len(bodies[g[0]]) > 480]
                long_res = await asyncio.gather(*[one(bodies[i]) for i in singles])
                for i, t in zip(singles, long_res):
                    translated[i] = t
                await asyncio.gather(*[packed(g) for g in groups if not (len(g) == 1 and len(bodies[g[0]]) > 480)])
                engine = "mymemory"
            except Exception as e:
                logger.warning("MyMemory translation failed: %s", e)
                return texts, "failed"
    out: list[list[str]] = [[] for _ in texts]
    for (ti, prefix, _), tr in zip(lines, translated):
        out[ti].append(prefix + _restore(tr))
    return ["\n".join(x) for x in out], engine
