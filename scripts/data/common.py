"""
Shared helpers for the reference-data builders in ``scripts/data``.

Every builder writes compact JSON into ``apps/web/server/data/real/`` (committed,
loaded synchronously by the web app's seed) and caches raw API responses in
``scripts/data/.cache/`` (git-ignored) so re-runs are cheap and offline-friendly.

Author: Nitya Prakash Pandey
"""
from __future__ import annotations

import gzip
import hashlib
import json
import sys
import time
from datetime import date
from pathlib import Path
from typing import Any

import requests

ROOT = Path(__file__).resolve().parents[2]
REAL = ROOT / "apps" / "web" / "server" / "data" / "real"
CACHE = Path(__file__).resolve().parent / ".cache"
ML_DATA = ROOT / "apps" / "ml-api" / "data"
UA = {"User-Agent": "Agri-SHIELD-data-builder/1.0 (reference datasets; contact: maintainer)"}

REAL.mkdir(parents=True, exist_ok=True)
CACHE.mkdir(parents=True, exist_ok=True)

# The 22 demo districts (mirrors apps/web/server/data/geography.ts — ids, centroids, exposure priors).
DISTRICTS: list[dict[str, Any]] = [
    {"id": "bd-barisal", "name": "Barisal", "country": "BD", "lat": 22.7011, "lon": 90.3637, "flood": 0.78, "sal": 0.52, "coast_km": 62},
    {"id": "bd-khulna", "name": "Khulna", "country": "BD", "lat": 22.8456, "lon": 89.5403, "flood": 0.84, "sal": 0.88, "coast_km": 38},
    {"id": "bd-satkhira", "name": "Satkhira", "country": "BD", "lat": 22.7185, "lon": 89.0705, "flood": 0.72, "sal": 0.93, "coast_km": 22},
    {"id": "bd-patuakhali", "name": "Patuakhali", "country": "BD", "lat": 22.3596, "lon": 90.3299, "flood": 0.86, "sal": 0.81, "coast_km": 18},
    {"id": "bd-sylhet", "name": "Sylhet", "country": "BD", "lat": 24.8949, "lon": 91.8687, "flood": 0.69, "sal": 0.05, "coast_km": 310},
    {"id": "vn-cantho", "name": "Cần Thơ", "country": "VN", "lat": 10.0452, "lon": 105.7469, "flood": 0.64, "sal": 0.55, "coast_km": 75},
    {"id": "vn-bentre", "name": "Bến Tre", "country": "VN", "lat": 10.2434, "lon": 106.3756, "flood": 0.58, "sal": 0.94, "coast_km": 25},
    {"id": "vn-soctrang", "name": "Sóc Trăng", "country": "VN", "lat": 9.6025, "lon": 105.9739, "flood": 0.55, "sal": 0.86, "coast_km": 30},
    {"id": "vn-camau", "name": "Cà Mau", "country": "VN", "lat": 9.1769, "lon": 105.1524, "flood": 0.61, "sal": 0.91, "coast_km": 15},
    {"id": "vn-angiang", "name": "An Giang", "country": "VN", "lat": 10.5216, "lon": 105.1259, "flood": 0.81, "sal": 0.18, "coast_km": 140},
    {"id": "ph-pampanga", "name": "Pampanga", "country": "PH", "lat": 15.0794, "lon": 120.62, "flood": 0.82, "sal": 0.34, "coast_km": 20},
    {"id": "ph-bulacan", "name": "Bulacan", "country": "PH", "lat": 14.7943, "lon": 120.8799, "flood": 0.77, "sal": 0.41, "coast_km": 12},
    {"id": "ph-nuevaecija", "name": "Nueva Ecija", "country": "PH", "lat": 15.5784, "lon": 121.1113, "flood": 0.59, "sal": 0.04, "coast_km": 95},
    {"id": "ph-tarlac", "name": "Tarlac", "country": "PH", "lat": 15.4755, "lon": 120.5963, "flood": 0.52, "sal": 0.03, "coast_km": 70},
    {"id": "in-kendrapara", "name": "Kendrapara", "country": "IN", "lat": 20.5, "lon": 86.4167, "flood": 0.83, "sal": 0.77, "coast_km": 20},
    {"id": "in-jagatsinghpur", "name": "Jagatsinghpur", "country": "IN", "lat": 20.2549, "lon": 86.1706, "flood": 0.79, "sal": 0.72, "coast_km": 18},
    {"id": "in-balasore", "name": "Balasore", "country": "IN", "lat": 21.4942, "lon": 86.9317, "flood": 0.71, "sal": 0.58, "coast_km": 16},
    {"id": "in-puri", "name": "Puri", "country": "IN", "lat": 19.8135, "lon": 85.8312, "flood": 0.66, "sal": 0.63, "coast_km": 8},
    {"id": "id-demak", "name": "Demak", "country": "ID", "lat": -6.8943, "lon": 110.6387, "flood": 0.85, "sal": 0.79, "coast_km": 10},
    {"id": "id-pekalongan", "name": "Pekalongan", "country": "ID", "lat": -6.8898, "lon": 109.6746, "flood": 0.8, "sal": 0.74, "coast_km": 6},
    {"id": "id-indramayu", "name": "Indramayu", "country": "ID", "lat": -6.3373, "lon": 108.3258, "flood": 0.68, "sal": 0.61, "coast_km": 14},
    {"id": "id-semarang", "name": "Semarang", "country": "ID", "lat": -6.9932, "lon": 110.4203, "flood": 0.74, "sal": 0.66, "coast_km": 5},
]


def log(*a: Any) -> None:
    print(*a, file=sys.stderr, flush=True)


def _key(url: str, params: dict | None) -> str:
    raw = url + "?" + json.dumps(params or {}, sort_keys=True)
    return hashlib.sha1(raw.encode()).hexdigest()[:16]


def get_json(url: str, params: dict | None = None, *, cache: bool = True, timeout: int = 120, pause: float = 0.0, tries: int = 4) -> Any:
    """GET JSON with an on-disk cache (gzip) and polite retries."""
    path = CACHE / f"{_key(url, params)}.json.gz"
    if cache and path.exists():
        return json.loads(gzip.decompress(path.read_bytes()))
    last: Exception | None = None
    for i in range(tries):
        try:
            r = requests.get(url, params=params, headers=UA, timeout=timeout)
            if r.status_code == 429:
                time.sleep(20 * (i + 1))
                continue
            r.raise_for_status()
            data = r.json()
            if cache:
                path.write_bytes(gzip.compress(json.dumps(data).encode()))
            if pause:
                time.sleep(pause)
            return data
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"GET failed {url}: {last}")


def get_bytes(url: str, name: str, *, timeout: int = 300, refresh: bool = False) -> Path:
    """Download a file once into the cache and return its path."""
    path = CACHE / name
    if path.exists() and not refresh:
        return path
    r = requests.get(url, headers=UA, timeout=timeout)
    r.raise_for_status()
    path.write_bytes(r.content)
    return path


def write_json(name: str, obj: Any) -> Path:
    """Compact, deterministic JSON (sorted keys off to keep semantic order; no whitespace)."""
    path = REAL / name
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size / 1024:.1f} KB)")
    return path


def today() -> str:
    return date.today().isoformat()
