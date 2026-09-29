"""
Caching helpers — Agri-SHIELD
=============================
- ``TTLCache``: in-memory async cache with per-key TTL and request coalescing
  (concurrent callers for the same key share one upstream request).
- ``disk_cache``: tiny JSON file cache for slow-changing data (river-cell
  climatology, sea cells, soil) under ``data/cache/`` (git-ignored).
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

logger = logging.getLogger(__name__)

CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "cache"


class TTLCache:
    def __init__(self, max_items: int = 2048):
        self._data: dict[str, tuple[float, Any]] = {}
        self._inflight: dict[str, asyncio.Future] = {}
        self.max_items = max_items
        self.hits = 0
        self.misses = 0

    def get(self, key: str) -> Optional[Any]:
        item = self._data.get(key)
        if item and item[0] > time.monotonic():
            self.hits += 1
            return item[1]
        return None

    def set(self, key: str, value: Any, ttl_s: float) -> None:
        if len(self._data) >= self.max_items:
            now = time.monotonic()
            for k in [k for k, (exp, _) in self._data.items() if exp <= now][: self.max_items // 4] or list(self._data)[:1]:
                self._data.pop(k, None)
        self._data[key] = (time.monotonic() + ttl_s, value)

    async def get_or_fetch(self, key: str, ttl_s: float, fetch: Callable[[], Awaitable[Any]]) -> Any:
        hit = self.get(key)
        if hit is not None:
            return hit
        if key in self._inflight:
            return await asyncio.shield(self._inflight[key])
        self.misses += 1
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._inflight[key] = fut
        try:
            value = await fetch()
            if value is not None:
                self.set(key, value, ttl_s)
            fut.set_result(value)
            return value
        except BaseException as e:
            fut.set_exception(e)
            fut.exception()  # mark retrieved
            raise
        finally:
            self._inflight.pop(key, None)

    def clear(self) -> None:
        self._data.clear()


def disk_get(name: str, max_age_s: float) -> Optional[Any]:
    path = CACHE_DIR / f"{name}.json"
    try:
        if path.exists() and time.time() - path.stat().st_mtime < max_age_s:
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:  # corrupt cache entry — ignore
        logger.debug("disk cache read failed for %s: %s", name, e)
    return None


def disk_set(name: str, value: Any) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        (CACHE_DIR / f"{name}.json").write_text(json.dumps(value), encoding="utf-8")
    except Exception as e:
        logger.debug("disk cache write failed for %s: %s", name, e)


live_cache = TTLCache()
