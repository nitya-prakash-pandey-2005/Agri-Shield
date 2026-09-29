"""
Live feature service — Agri-SHIELD
==================================
Fetches the live inputs the trained models need, from free key-less APIs, with
short timeouts, in-memory TTL caching and graceful degradation:

- Open-Meteo Forecast  — past 92 days + next 4 days: daily rain / ET0, hourly rain and
                         0–7 cm soil moisture (drives flood and salinity features)
- Open-Meteo Flood     — GloFAS v4 river discharge (past 92 days + 4-day forecast) at the
                         district's dominant river cell; unknown points get a 5-cell search
                         and a 2-year climatology (disk-cached)
- Open-Meteo Marine    — sea_level_height_msl at the nearest sea cell (tidal range, spring tides)
- Open-Meteo Elevation — Copernicus GLO-90 DEM
- ISRIC SoilGrids 2.0  — clay content 0–5 cm

Every function returns ``None`` (never raises) when its source is unavailable; callers
record the gap in ``degraded`` and the models handle missing values.
"""
from __future__ import annotations

import asyncio
import logging
import math
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from typing import Any, Optional

import httpx
import numpy as np
import pandas as pd

from config import settings
from core.cache import disk_get, disk_set, live_cache
from core.features import SiteStats, compute_site_stats
from core.geo import haversine_km, nearest_coast_point, nearest_district

logger = logging.getLogger(__name__)

SITE_MATCH_KM = 30.0
_client: Optional[httpx.AsyncClient] = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(settings.live_timeout_s, connect=5.0),
            headers={"User-Agent": "Agri-SHIELD-ML/2.0"},
            limits=httpx.Limits(max_connections=20),
        )
    return _client


async def close_http() -> None:
    if _client is not None and not _client.is_closed:
        await _client.aclose()


async def _get_json(url: str, params: dict, timeout: Optional[float] = None) -> Optional[Any]:
    try:
        r = await _http().get(url, params=params, timeout=timeout or settings.live_timeout_s)
        if r.status_code != 200:
            logger.warning("GET %s → HTTP %s: %s", url, r.status_code, r.text[:160])
            return None
        return r.json()
    except Exception as e:
        logger.warning("GET %s failed: %s", url, e)
        return None


@lru_cache(maxsize=1)
def _sites() -> dict[str, dict]:
    try:
        from models.data import load_sites

        return load_sites()
    except Exception as e:
        logger.warning("sites.json unavailable: %s", e)
        return {}


def resolve_site(lat: float, lon: float) -> tuple[Optional[str], float]:
    """Nearest demo district id if within SITE_MATCH_KM, else None."""
    d, dist = nearest_district(lat, lon)
    return (d.id if dist <= SITE_MATCH_KM else None), dist


# ─── Forecast ──────────────────────────────────────────────────────────────


async def get_forecast(lat: float, lon: float) -> Optional[dict]:
    key = f"fc:{lat:.3f},{lon:.3f}"

    async def fetch():
        return await _get_json(
            f"{settings.open_meteo_base_url}/forecast",
            {
                "latitude": round(lat, 4),
                "longitude": round(lon, 4),
                "hourly": "precipitation,soil_moisture_0_to_7cm",
                "daily": "precipitation_sum,et0_fao_evapotranspiration",
                "past_days": 92,
                "forecast_days": 4,
                "timezone": "auto",
            },
        )

    return await live_cache.get_or_fetch(key, 1800, fetch)


def local_now(fc: dict) -> datetime:
    """Current wall-clock time in the forecast's local timezone (naive)."""
    off = int(fc.get("utc_offset_seconds", 0) or 0)
    return datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(seconds=off)


def forecast_daily_frame(fc: dict) -> tuple[pd.DataFrame, pd.Timestamp]:
    """Daily frame (precip_mm, soil_moisture, et0_mm) and the local 'today' timestamp."""
    daily = fc["daily"]
    idx = pd.to_datetime(daily["time"])
    df = pd.DataFrame(
        {
            "precip_mm": pd.to_numeric(pd.Series(daily["precipitation_sum"], index=idx), errors="coerce"),
            "et0_mm": pd.to_numeric(pd.Series(daily.get("et0_fao_evapotranspiration"), index=idx), errors="coerce"),
        }
    )
    h = fc.get("hourly", {})
    if h.get("soil_moisture_0_to_7cm"):
        sm = pd.Series(pd.to_numeric(pd.Series(h["soil_moisture_0_to_7cm"]), errors="coerce").to_numpy(), index=pd.to_datetime(h["time"]))
        df["soil_moisture"] = sm.resample("D").mean().reindex(idx)
    else:
        df["soil_moisture"] = np.nan
    today = pd.Timestamp(local_now(fc).date())
    return df, today


def hourly_next_72h(fc: dict) -> list[tuple[str, float]]:
    h = fc.get("hourly", {})
    times, pr = h.get("time", []), h.get("precipitation", [])
    now = local_now(fc).replace(minute=0, second=0, microsecond=0)
    stamp = now.strftime("%Y-%m-%dT%H:%M")
    i0 = next((i for i, t in enumerate(times) if t >= stamp), max(len(times) - 72, 0))
    out = [(times[i], float(pr[i] or 0.0)) for i in range(i0, min(i0 + 72, len(times)))]
    return out


# ─── River discharge (GloFAS) ──────────────────────────────────────────────


async def _discharge_series(cell: dict) -> Optional[pd.Series]:
    key = f"q:{cell['lat']:.3f},{cell['lon']:.3f}"

    async def fetch():
        return await _get_json(
            settings.open_meteo_flood_url,
            {"latitude": cell["lat"], "longitude": cell["lon"], "daily": "river_discharge", "past_days": 92, "forecast_days": 4},
        )

    data = await live_cache.get_or_fetch(key, 3 * 3600, fetch)
    if not data or "daily" not in data:
        return None
    return pd.Series(pd.to_numeric(pd.Series(data["daily"]["river_discharge"]), errors="coerce").to_numpy(), index=pd.to_datetime(data["daily"]["time"]))


async def _cell_search(lat: float, lon: float) -> Optional[dict]:
    name = f"cell_{lat:.2f}_{lon:.2f}".replace("-", "m")
    hit = disk_get(name, 30 * 86400)
    if hit:
        return hit
    offs = [(0.0, 0.0), (0.05, 0.0), (-0.05, 0.0), (0.0, 0.05), (0.0, -0.05)]
    data = await _get_json(
        settings.open_meteo_flood_url,
        {
            "latitude": ",".join(f"{lat + a:.4f}" for a, _ in offs),
            "longitude": ",".join(f"{lon + b:.4f}" for _, b in offs),
            "daily": "river_discharge",
            "past_days": 31,
            "forecast_days": 1,
        },
    )
    if not data:
        return None
    best = None
    for loc in data if isinstance(data, list) else [data]:
        q = [v for v in loc["daily"]["river_discharge"] if v is not None]
        mq = float(np.mean(q)) if q else -1.0
        if best is None or mq > best["mean_q"]:
            best = {"lat": loc["latitude"], "lon": loc["longitude"], "mean_q": mq}
    disk_set(name, best)
    return best


async def _cell_climatology(cell: dict) -> Optional[dict]:
    name = f"clim_{cell['lat']:.3f}_{cell['lon']:.3f}".replace("-", "m")
    hit = disk_get(name, 30 * 86400)
    if hit:
        return hit
    end = date.today() - timedelta(days=10)
    start = end - timedelta(days=730)
    data = await _get_json(
        settings.open_meteo_flood_url,
        {"latitude": cell["lat"], "longitude": cell["lon"], "daily": "river_discharge", "start_date": start.isoformat(), "end_date": end.isoformat()},
        timeout=15.0,
    )
    if not data:
        return None
    q = pd.Series(data["daily"]["river_discharge"], dtype="float64")
    st = compute_site_stats(pd.DataFrame({"discharge_m3s": q, "precip_mm": np.zeros(len(q))}))
    out = st.to_dict()
    out["rain3_p99"] = float("nan")  # filled from rainfall climatology by caller
    disk_set(name, out)
    return out


async def get_discharge(lat: float, lon: float, site_id: Optional[str], site_stats: Optional[dict]) -> dict:
    """{'series': Series|None, 'stats': SiteStats|None, 'cell': dict|None, 'source': str}"""
    if site_id and site_id in _sites() and site_stats:
        cell = _sites()[site_id]["glofas_cell"]
        series = await _discharge_series(cell)
        return {"series": series, "stats": SiteStats(**site_stats), "cell": cell, "source": f"glofas-cell-of:{site_id}"}
    cell = await _cell_search(lat, lon)
    if not cell:
        return {"series": None, "stats": None, "cell": None, "source": "unavailable"}
    series, clim = await asyncio.gather(_discharge_series(cell), _cell_climatology(cell))
    stats = None
    if clim:
        stats = SiteStats(**{k: clim[k] for k in ("q_p95", "q_median", "q_flashiness", "flood_events_per_year", "rain3_p99")})
    return {"series": series, "stats": stats, "cell": cell, "source": "glofas-cell-search"}


# ─── Elevation, marine, soil ───────────────────────────────────────────────


async def get_elevation(lat: float, lon: float) -> Optional[float]:
    key = f"elev:{lat:.3f},{lon:.3f}"

    async def fetch():
        data = await _get_json(f"{settings.open_meteo_base_url}/elevation", {"latitude": lat, "longitude": lon})
        try:
            return float(data["elevation"][0])
        except Exception:
            return None

    return await live_cache.get_or_fetch(key, 30 * 86400, fetch)


async def _find_sea_cell(lat: float, lon: float) -> Optional[dict]:
    """Sea-level cell near the point: dict, {} when inland/no sea cell, None when the API failed."""
    name = f"sea_{lat:.2f}_{lon:.2f}".replace("-", "m")
    hit = disk_get(name, 90 * 86400)
    if hit is not None:
        return hit  # {} = inland (no sea cell within reach)
    cp = nearest_coast_point(lat, lon)
    if cp is None or haversine_km(lat, lon, *cp) > 150:
        disk_set(name, {})
        return {}
    clat, clon = cp
    vlat, vlon = clat - lat, clon - lon
    norm = math.hypot(vlat, vlon) or 1.0
    ulat, ulon = vlat / norm, vlon / norm
    cands = []
    for k in (0.08, 0.16, 0.3):
        for rot in (0, 35, -35, 70, -70):
            a = math.radians(rot)
            cands.append((round(clat + (ulat * math.cos(a) - ulon * math.sin(a)) * k, 3), round(clon + (ulat * math.sin(a) + ulon * math.cos(a)) * k, 3)))
    data = await _get_json(
        settings.open_meteo_marine_url,
        {
            "latitude": ",".join(str(c[0]) for c in cands),
            "longitude": ",".join(str(c[1]) for c in cands),
            "hourly": "sea_level_height_msl",
            "past_days": 1,
            "forecast_days": 1,
        },
    )
    cell = None
    for loc in (data if isinstance(data, list) else [data]) if data else []:
        vals = loc.get("hourly", {}).get("sea_level_height_msl", [])
        if sum(v is not None for v in vals) >= 20:
            cell = {"lat": loc["latitude"], "lon": loc["longitude"]}
            break
    if data is None:
        return None  # marine API unavailable — unknown, not inland
    disk_set(name, cell or {})
    return cell or {}


async def get_tides(lat: float, lon: float, site_id: Optional[str]) -> Optional[dict]:
    """Tidal range (mean daily, past 14 d), next-72h max high water and a spring-tide flag."""
    inland = {"cell": None, "tidal_range_m": 0.0, "upcoming_range_m": 0.0, "max_high_water_72h_m": None, "spring_tide": False, "inland": True}
    if site_id and site_id in _sites():
        sea = _sites()[site_id].get("sea")
        if not sea:
            return inland
        cell = {"lat": sea["lat"], "lon": sea["lon"]}
    else:
        cell = await _find_sea_cell(lat, lon)
        if cell == {}:
            return inland
    if not cell:
        return None
    key = f"tide:{cell['lat']:.3f},{cell['lon']:.3f}"

    async def fetch():
        return await _get_json(
            settings.open_meteo_marine_url,
            {"latitude": cell["lat"], "longitude": cell["lon"], "hourly": "sea_level_height_msl", "past_days": 14, "forecast_days": 3, "timezone": "auto"},
        )

    data = await live_cache.get_or_fetch(key, 3 * 3600, fetch)
    if not data:
        return None
    s = pd.Series(pd.to_numeric(pd.Series(data["hourly"]["sea_level_height_msl"]), errors="coerce").to_numpy(), index=pd.to_datetime(data["hourly"]["time"])).dropna()
    if len(s) < 48:
        return None
    now = pd.Timestamp(local_now(data))
    past, fut = s[s.index <= now], s[s.index > now]
    daily = past.resample("D").agg(["max", "min"]).dropna()
    rng = daily["max"] - daily["min"]
    mean_range = float(rng.mean()) if len(rng) else None
    fut_daily = (fut.resample("D").max() - fut.resample("D").min()).dropna()
    upcoming = float(fut_daily.max()) if len(fut_daily) else None
    return {
        "cell": cell,
        "tidal_range_m": round(mean_range, 3) if mean_range is not None else None,
        "upcoming_range_m": round(upcoming, 3) if upcoming is not None else None,
        "max_high_water_72h_m": round(float(fut.max()), 3) if len(fut) else None,
        "spring_tide": bool(upcoming is not None and mean_range and upcoming > 1.12 * mean_range),
    }


async def get_clay(lat: float, lon: float, site_id: Optional[str]) -> Optional[float]:
    if site_id and site_id in _sites():
        from models.data import DEFAULT_CLAY_PCT

        v = _sites()[site_id].get("clay_pct")
        return float(v) if v is not None else DEFAULT_CLAY_PCT  # same imputation as training
    name = f"clay_{lat:.2f}_{lon:.2f}".replace("-", "m")
    hit = disk_get(name, 180 * 86400)
    if hit is not None:
        return hit.get("clay_pct")
    data = await _get_json(
        f"{settings.soilgrids_base_url}/properties/query",
        {"lon": lon, "lat": lat, "property": "clay", "depth": "0-5cm", "value": "mean"},
        timeout=6.0,
    )
    if not data:
        return None
    try:
        v = data["properties"]["layers"][0]["depths"][0]["values"]["mean"]
        clay = None if v is None else v / 10.0
    except Exception:
        clay = None
    disk_set(name, {"clay_pct": clay})
    return clay
