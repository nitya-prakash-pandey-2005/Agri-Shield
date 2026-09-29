"""
Agri-SHIELD — training dataset builder
======================================
Author: Nitya Prakash Pandey

Pulls real, key-less open data for the 22 demo districts and writes the compact
datasets that the ML service trains on:

  apps/ml-api/data/coastline_asia.npz     Natural Earth 1:10m coastline vertices (public domain), S/SE Asia
  apps/ml-api/data/sites.json             per-district static data (elevation, coast distance,
                                          GloFAS river cell, sea-level cell + tidal range, clay %)
  apps/ml-api/data/flood_dataset.csv.gz   daily panel: ERA5 rainfall / soil moisture / temperature / ET0
                                          + GloFAS v4 river discharge (Open-Meteo Archive + Flood APIs)
  apps/ml-api/data/salinity_dataset.csv.gz daily root-zone soil EC (ECe, dS/m) — SEMI-SYNTHETIC, see below

Data sources (all free, no key):
  - Open-Meteo Historical Weather API (ERA5 / ERA5-Land reanalysis, Copernicus C3S) — CC BY 4.0
  - Open-Meteo Flood API (Copernicus GloFAS v4 reanalysis, 5 km)                      — CC BY 4.0
  - Open-Meteo Marine API (sea_level_height_msl, tides + surge)                        — CC BY 4.0
  - Open-Meteo Elevation API (Copernicus GLO-90 DEM)                                  — CC BY 4.0
  - ISRIC SoilGrids 2.0 (clay content 0–5 cm)                                         — CC BY 4.0
  - Natural Earth 1:10m coastline                                                     — public domain

Salinity ground truth
---------------------
There is no open, daily, multi-country soil-salinity archive. The salinity target is
therefore *semi-synthetic but physically driven by real observations*:

  1. Salt-intrusion length follows a Savenije-type power law of the real GloFAS
     30-day discharge ratio:  L = L0 * (Q30/Qmedian)^-0.6
  2. Channel water EC decays exponentially inland: ECw = EC_sea * exp(-x / L),
     modulated by the astronomical spring–neap cycle scaled with the real tidal
     range measured by the Marine API at the district's sea cell.
  3. Root-zone ECe integrates ECw through dry-season canal irrigation (reliance rises
     as real ERA5 30-day rainfall falls), relaxes slowly, and is leached by real daily
     rainfall with a clay-dependent leaching depth (real SoilGrids clay).
  4. Each district's long-run dry-season 95th-percentile ECe is calibrated to published
     ranges (e.g. SRDI: 8–16 dS/m in Satkhira/Khulna polders in Mar–May; Mekong coastal
     provinces 4–12+ dS/m in severe years; Odisha and Java north coast 3–9 dS/m;
     inland Sylhet / An Giang / Nueva Ecija / Tarlac < 1.5 dS/m), then site-year and
     day-to-day log-normal noise is added.

So which years are saline, when the season starts and how fast it flushes are driven
by real hydro-meteorology; the absolute level per district is a calibrated prior.

Usage (from repo root):
  python scripts/train-models/build_dataset.py                # everything, resumable
  python scripts/train-models/build_dataset.py --assemble-only
Raw API responses are cached in apps/ml-api/data/raw/ (git-ignored) so reruns are free.

Open-Meteo free tier: 600 calls/min, 5 000/h, 10 000/day, where a request counts
n_locations * max(1, days/14) * max(1, variables/10) calls. A 7-year daily series is
~183 calls per location, so the full build costs ~9 000 calls; the builder paces itself
and sleeps through hourly limits.
"""
from __future__ import annotations

import argparse
import gzip
import io
import json
import logging
import math
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
ML_API = ROOT / "apps" / "ml-api"
sys.path.insert(0, str(ML_API))

from core.geo import DISTRICTS, District, haversine_km  # noqa: E402

DATA = ML_API / "data"
RAW = DATA / "raw"
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("build_dataset")

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
FLOOD_URL = "https://flood-api.open-meteo.com/v1/flood"
MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"
ELEVATION_URL = "https://api.open-meteo.com/v1/elevation"
SOILGRIDS_URL = "https://rest.isric.org/soilgrids/v2.0/properties/query"
NE_COAST_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_coastline.geojson"

ERA5_DAILY = ["precipitation_sum", "soil_moisture_0_to_7cm_mean", "temperature_2m_mean", "et0_fao_evapotranspiration"]
BBOX = (60.0, 135.0, -15.0, 35.0)  # lon_min, lon_max, lat_min, lat_max
UA = {"User-Agent": "Agri-SHIELD dataset builder (research, non-commercial)"}


class QuotaExhausted(RuntimeError):
    """Raised when the daily Open-Meteo quota is exhausted."""


# ─── Rate-limited HTTP ─────────────────────────────────────────────────────


class Pacer:
    """Keeps weighted Open-Meteo usage under ~500 calls/minute."""

    def __init__(self, per_minute: float = 500.0):
        self.per_minute = per_minute
        self.events: list[tuple[float, float]] = []
        self.total = 0.0

    def wait(self, weight: float) -> None:
        while True:
            now = time.time()
            self.events = [(t, w) for t, w in self.events if now - t < 60]
            used = sum(w for _, w in self.events)
            if used + weight <= self.per_minute or not self.events:
                self.events.append((now, weight))
                self.total += weight
                return
            time.sleep(max(1.0, 60 - (now - self.events[0][0]) + 0.5))


PACER = Pacer()


def om_weight(n_locations: int, n_days: int, n_vars: int) -> float:
    return n_locations * max(1.0, n_days / 14.0) * max(1.0, n_vars / 10.0)


def om_get(client: httpx.Client, url: str, params: dict, weight: float, retries: int = 16):
    """GET with Open-Meteo quota handling (minutely/hourly waits, daily abort)."""
    for attempt in range(retries):
        PACER.wait(weight)
        try:
            r = client.get(url, params=params, timeout=120.0)
        except httpx.HTTPError as e:
            log.warning("network error %s (attempt %d) — retrying in 20 s", e, attempt + 1)
            time.sleep(20)
            continue
        if r.status_code == 429 or (r.status_code == 400 and "limit" in r.text.lower()):
            reason = r.text.lower()
            if "daily" in reason:
                raise QuotaExhausted(r.text)
            wait = 300 if "hourly" in reason else 65
            log.warning("rate limited (%s) — sleeping %d s", r.text[:120], wait)
            time.sleep(wait)
            continue
        if r.status_code >= 500:
            time.sleep(15 * (attempt + 1))
            continue
        r.raise_for_status()
        return r.json()
    raise RuntimeError(f"giving up on {url}")


OFFLINE = False


def cached(name: str, fn):
    """Cache a JSON-able API result under data/raw/<name>.json.gz."""
    RAW.mkdir(parents=True, exist_ok=True)
    path = RAW / f"{name}.json.gz"
    if path.exists():
        with gzip.open(path, "rt", encoding="utf-8") as f:
            return json.load(f)
    if OFFLINE:
        raise FileNotFoundError(f"--assemble-only: raw response {path.name} is not cached")
    data = fn()
    with gzip.open(path, "wt", encoding="utf-8") as f:
        json.dump(data, f)
    return data


# ─── Coastline ─────────────────────────────────────────────────────────────


def build_coastline(client: httpx.Client) -> None:
    out = DATA / "coastline_asia.npz"
    if out.exists():
        return
    log.info("Downloading Natural Earth 1:10m coastline …")
    r = client.get(NE_COAST_URL, timeout=180.0, follow_redirects=True)
    r.raise_for_status()
    gj = r.json()
    lo0, lo1, la0, la1 = BBOX
    pts: list[tuple[float, float]] = []

    def add_line(coords):
        # Densify so consecutive vertices are ≤ ~1.5 km apart.
        for (x0, y0), (x1, y1) in zip(coords[:-1], coords[1:]):
            if not (lo0 <= x0 <= lo1 and la0 <= y0 <= la1):
                continue
            n = max(1, int(math.hypot(x1 - x0, y1 - y0) / 0.0135))
            for k in range(n):
                t = k / n
                pts.append((y0 + (y1 - y0) * t, x0 + (x1 - x0) * t))

    for feat in gj["features"]:
        g = feat["geometry"]
        if g["type"] == "LineString":
            add_line(g["coordinates"])
        elif g["type"] == "MultiLineString":
            for line in g["coordinates"]:
                add_line(line)
    arr = np.array(pts, dtype=np.float64)
    # Deduplicate on a ~1 km grid.
    key = np.round(arr / 0.01).astype(np.int64)
    _, idx = np.unique(key, axis=0, return_index=True)
    arr = arr[np.sort(idx)]
    np.savez_compressed(out, lat=arr[:, 0].astype(np.float32), lon=arr[:, 1].astype(np.float32))
    log.info("coastline: %d vertices → %s (%.0f KB)", len(arr), out.name, out.stat().st_size / 1024)


# ─── Static site data ──────────────────────────────────────────────────────


def fetch_elevation(client: httpx.Client) -> dict[str, float]:
    def go():
        params = {
            "latitude": ",".join(f"{d.lat:.4f}" for d in DISTRICTS),
            "longitude": ",".join(f"{d.lon:.4f}" for d in DISTRICTS),
        }
        return om_get(client, ELEVATION_URL, params, weight=len(DISTRICTS))

    data = cached("elevation", go)
    return {d.id: float(e) for d, e in zip(DISTRICTS, data["elevation"])}


def glofas_cell_search(client: httpx.Client, d: District) -> dict:
    """Pick the GloFAS cell with the largest mean monsoon discharge among 5 candidates.

    The Flood API snaps to the nearest 0.05° cell, which in a delta can be a minor
    creek; the dominant river cell next to the district better represents the
    riverine flood hazard the district is exposed to.
    """
    offs = [(0.0, 0.0), (0.05, 0.0), (-0.05, 0.0), (0.0, 0.05), (0.0, -0.05)]
    wet = ("2024-07-15", "2024-08-28") if d.lat > 0 else ("2024-01-10", "2024-02-23")

    def go():
        params = {
            "latitude": ",".join(f"{d.lat + a:.4f}" for a, _ in offs),
            "longitude": ",".join(f"{d.lon + b:.4f}" for _, b in offs),
            "daily": "river_discharge",
            "start_date": wet[0],
            "end_date": wet[1],
        }
        return om_get(client, FLOOD_URL, params, weight=om_weight(len(offs), 45, 1))

    data = cached(f"glofas_cells_{d.id}", go)
    best = None
    for loc in data:
        q = [v for v in loc["daily"]["river_discharge"] if v is not None]
        mean_q = float(np.mean(q)) if q else -1.0
        cand = {"lat": loc["latitude"], "lon": loc["longitude"], "mean_q_wet": round(mean_q, 2)}
        if best is None or mean_q > best["mean_q_wet"]:
            best = cand
    return best


def find_sea_cell(client: httpx.Client, d: District) -> dict | None:
    """Locate the nearest Marine-API cell with sea-level data and measure its tidal range."""
    from core.geo import nearest_coast_point

    cp = nearest_coast_point(d.lat, d.lon)
    if cp is None:
        return None
    clat, clon = cp
    vlat, vlon = clat - d.lat, clon - d.lon
    norm = math.hypot(vlat, vlon) or 1.0
    ulat, ulon = vlat / norm, vlon / norm
    cands = []
    for k in (0.08, 0.16, 0.3, 0.5):
        for rot in (0, 35, -35, 70, -70):
            a = math.radians(rot)
            rl = ulat * math.cos(a) - ulon * math.sin(a)
            ro = ulat * math.sin(a) + ulon * math.cos(a)
            cands.append((round(clat + rl * k, 3), round(clon + ro * k, 3)))

    def probe():
        for i in range(0, len(cands), 10):
            chunk = cands[i : i + 10]
            params = {
                "latitude": ",".join(str(c[0]) for c in chunk),
                "longitude": ",".join(str(c[1]) for c in chunk),
                "hourly": "sea_level_height_msl",
                "start_date": "2025-03-01",
                "end_date": "2025-03-01",
            }
            res = om_get(client, MARINE_URL, params, weight=len(chunk))
            res = res if isinstance(res, list) else [res]
            for loc in res:
                vals = loc["hourly"]["sea_level_height_msl"]
                if sum(v is not None for v in vals) >= 20:
                    return {"lat": loc["latitude"], "lon": loc["longitude"]}
        return {}

    cell = cached(f"seacell_{d.id}", probe)
    if not cell:
        return None
    key = f"marine_{cell['lat']:.3f}_{cell['lon']:.3f}".replace("-", "m")

    def year():
        params = {
            "latitude": cell["lat"],
            "longitude": cell["lon"],
            "hourly": "sea_level_height_msl",
            "start_date": "2025-01-01",
            "end_date": "2025-12-31",
        }
        return om_get(client, MARINE_URL, params, weight=om_weight(1, 365, 1))

    series = cached(key, year)
    s = pd.Series(series["hourly"]["sea_level_height_msl"], index=pd.to_datetime(series["hourly"]["time"]), dtype="float64")
    daily = s.resample("D").agg(["max", "min"]).dropna()
    rng = (daily["max"] - daily["min"])
    return {
        "lat": cell["lat"],
        "lon": cell["lon"],
        "distance_km": round(haversine_km(d.lat, d.lon, cell["lat"], cell["lon"]), 1),
        "tidal_range_m": round(float(rng.mean()), 3),
        "spring_range_m": round(float(rng.quantile(0.9)), 3),
        "mean_high_water_m": round(float(daily["max"].mean()), 3),
    }


def fetch_clay(client: httpx.Client, d: District) -> float | None:
    def go():
        try:
            r = client.get(
                SOILGRIDS_URL,
                params={"lon": d.lon, "lat": d.lat, "property": "clay", "depth": "0-5cm", "value": "mean"},
                timeout=25.0,
            )
            r.raise_for_status()
            layer = r.json()["properties"]["layers"][0]
            v = layer["depths"][0]["values"]["mean"]
            return {"clay_pct": None if v is None else v / 10.0}
        except Exception as e:  # SoilGrids is frequently overloaded — tolerate it
            log.warning("SoilGrids failed for %s: %s", d.id, e)
            return {"clay_pct": None, "_failed": True}

    path = RAW / f"clay_{d.id}.json.gz"
    try:
        res = cached(f"clay_{d.id}", go)
    except FileNotFoundError:  # --assemble-only without a cached SoilGrids response
        return None
    if res.get("_failed"):
        path.unlink(missing_ok=True)  # retry on next run
    time.sleep(1.0)
    return res.get("clay_pct")


# ─── Time series ───────────────────────────────────────────────────────────


def fetch_era5(client: httpx.Client, d: District, start: str, end: str) -> pd.DataFrame:
    n_days = (date.fromisoformat(end) - date.fromisoformat(start)).days + 1

    def go():
        params = {
            "latitude": d.lat,
            "longitude": d.lon,
            "start_date": start,
            "end_date": end,
            "daily": ",".join(ERA5_DAILY),
            "timezone": "GMT",
        }
        return om_get(client, ARCHIVE_URL, params, weight=om_weight(1, n_days, len(ERA5_DAILY)))

    data = cached(f"era5_{d.id}_{start}_{end}", go)
    df = pd.DataFrame(data["daily"])
    df["time"] = pd.to_datetime(df["time"])
    return df.set_index("time")


def fetch_glofas(client: httpx.Client, d: District, cell: dict, start: str, end: str) -> pd.Series:
    n_days = (date.fromisoformat(end) - date.fromisoformat(start)).days + 1

    def go():
        params = {
            "latitude": cell["lat"],
            "longitude": cell["lon"],
            "daily": "river_discharge",
            "start_date": start,
            "end_date": end,
        }
        return om_get(client, FLOOD_URL, params, weight=om_weight(1, n_days, 1))

    data = cached(f"glofas_{d.id}_{start}_{end}", go)
    return pd.Series(data["daily"]["river_discharge"], index=pd.to_datetime(data["daily"]["time"]), dtype="float64")


# ─── Semi-synthetic salinity target ────────────────────────────────────────

SYNODIC_DAYS = 29.530588853
REF_NEW_MOON = datetime(2000, 1, 6, 18, 14)


def spring_neap_index(dates: pd.DatetimeIndex) -> np.ndarray:
    """+1 at spring tides (new/full moon, ~1.5-day lag), −1 at neap tides."""
    days = (dates - pd.Timestamp(REF_NEW_MOON)).total_seconds() / 86400.0 - 1.5
    phase = (np.asarray(days) % SYNODIC_DAYS) / SYNODIC_DAYS
    return np.cos(4 * np.pi * phase)


def target_peak_ec(s: float) -> float:
    """Calibrated long-run dry-season P95 root-zone ECe (dS/m) from salinity exposure."""
    return 0.6 + 15.0 * s**2


def generate_ec(panel: pd.DataFrame, d: District, site: dict, rng: np.random.Generator) -> pd.DataFrame:
    """Physically-driven semi-synthetic root-zone ECe series for one district (see module doc)."""
    q = panel["discharge_m3s"].interpolate(limit_direction="both").clip(lower=1e-3)
    qmed = float(q.median())
    q30 = (q.rolling(30, min_periods=10).mean() / qmed).bfill().clip(0.08, 20.0).to_numpy()
    rain = panel["precip_mm"].fillna(0).to_numpy()
    rain30 = pd.Series(rain).rolling(30, min_periods=1).sum().to_numpy()
    et0 = panel["et0_mm"].fillna(4.0).to_numpy()
    s = d.salinity_exposure
    tide_range = (site.get("sea") or {}).get("tidal_range_m") or 1.5
    spring = spring_neap_index(panel.index)

    L0 = 6.0 + 14.0 * s  # km at median discharge
    L = L0 * q30 ** -0.6
    tide = 1.0 + 0.12 * spring * min(tide_range, 4.0) / 2.0
    ecw = 45.0 * np.exp(-d.coast_distance_km / L) * tide  # dS/m in the tidal channel
    reliance = 1.0 / (1.0 + np.exp(-(60.0 - rain30) / 20.0))  # canal irrigation reliance
    clay = site.get("clay_pct") or 35.0
    r0 = 120.0 * (1.0 + clay / 60.0)
    base = 0.3 + 0.6 * s

    ece = np.empty(len(rain))
    cur = base
    for i in range(len(rain)):
        target = base + 1.4 * ecw[i] * reliance[i]
        k = 1 / 18.0 if target > cur else 1 / 60.0
        cur += (target - cur) * k
        cur += 0.004 * max(0.0, et0[i] - rain[i]) * (cur - base)  # evaporative concentration
        cur -= (cur - base) * (1.0 - math.exp(-rain[i] / r0))  # rainfall leaching
        cur = max(cur, base * 0.8)
        ece[i] = cur

    excess = ece - base
    years = panel.index.year
    p95 = np.mean([np.quantile(excess[years == y], 0.95) for y in np.unique(years)])
    peak = target_peak_ec(s)
    scale = (peak - base) / p95 if p95 > 1e-3 else 0.0
    # Soft ceiling: cropped paddy soils rarely exceed ~1.6x their typical dry-season peak
    ceiling = 1.6 * max(peak - base, 0.05)
    truth = base + ceiling * np.tanh(excess * min(scale, 5000.0) / ceiling)

    # Site-year random effect + AR(1) daily variability (log-normal, multiplicative)
    year_eff = {y: rng.normal(0, 0.12) for y in np.unique(years)}
    ar = np.zeros(len(truth))
    for i in range(1, len(ar)):
        ar[i] = 0.9 * ar[i - 1] + rng.normal(0, 0.035)
    truth = truth * np.exp(np.array([year_eff[y] for y in years]) + ar)
    observed = truth * np.exp(rng.normal(0, 0.05, len(truth)))
    return pd.DataFrame({"date": panel.index, "site": d.id, "ec_dsm": np.round(observed, 3), "ec_water_dsm": np.round(ecw, 3)})


def _previous_calls() -> float:
    try:
        return float(json.loads((DATA / "sites.json").read_text(encoding="utf-8")).get("open_meteo_calls_used") or 0.0)
    except Exception:
        return 0.0


# ─── Main ──────────────────────────────────────────────────────────────────


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--start", default="2019-01-01")
    ap.add_argument("--end", default="2025-12-31")
    ap.add_argument("--assemble-only", action="store_true", help="only use cached raw responses")
    args = ap.parse_args()
    global OFFLINE
    OFFLINE = args.assemble_only
    DATA.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)

    with httpx.Client(headers=UA) as client:
        build_coastline(client)
        from core.geo import coast_distance_km

        elev = fetch_elevation(client)
        sites: dict[str, dict] = {}
        for d in DISTRICTS:
            cell = glofas_cell_search(client, d)
            sea = find_sea_cell(client, d)
            clay = fetch_clay(client, d)
            sites[d.id] = {
                "id": d.id,
                "name": d.name,
                "country": d.country,
                "lat": d.lat,
                "lon": d.lon,
                "elevation_m": elev.get(d.id),
                "coast_km": round(coast_distance_km(d.lat, d.lon), 2),
                "coast_km_reference": d.coast_distance_km,
                "flood_exposure": d.flood_exposure,
                "salinity_exposure": d.salinity_exposure,
                "glofas_cell": cell,
                "sea": sea,
                "clay_pct": clay,
            }
            log.info("site %-16s elev=%s coast=%.1fkm cell=%s sea=%s clay=%s", d.id, elev.get(d.id), sites[d.id]["coast_km"], cell, sea and sea["tidal_range_m"], clay)

        frames = []
        for d in DISTRICTS:
            try:
                era = fetch_era5(client, d, args.start, args.end)
                q = fetch_glofas(client, d, sites[d.id]["glofas_cell"], args.start, args.end)
            except QuotaExhausted as e:
                log.error("Daily quota exhausted at %s: %s — rerun tomorrow; cached parts are kept.", d.id, e)
                raise SystemExit(2)
            df = pd.DataFrame(
                {
                    "precip_mm": era["precipitation_sum"],
                    "soil_moisture": era["soil_moisture_0_to_7cm_mean"],
                    "temp_c": era["temperature_2m_mean"],
                    "et0_mm": era["et0_fao_evapotranspiration"],
                }
            )
            df["discharge_m3s"] = q.reindex(df.index)
            df["site"] = d.id
            frames.append(df)
            log.info("%s: %d days, rain %.0f mm/yr, Q median %.1f m3/s", d.id, len(df), df.precip_mm.sum() / (len(df) / 365.25), df.discharge_m3s.median())

    panel = pd.concat(frames)
    panel.index.name = "date"
    out = panel.reset_index()[["date", "site", "precip_mm", "soil_moisture", "temp_c", "et0_mm", "discharge_m3s"]]
    out["date"] = out["date"].dt.strftime("%Y-%m-%d")
    out = out.round({"precip_mm": 2, "soil_moisture": 3, "temp_c": 1, "et0_mm": 2, "discharge_m3s": 3})
    buf = io.StringIO()
    out.to_csv(buf, index=False)
    with gzip.open(DATA / "flood_dataset.csv.gz", "wt", encoding="utf-8", compresslevel=9) as f:
        f.write(buf.getvalue())

    rng = np.random.default_rng(20260929)
    ec_frames = []
    for d in DISTRICTS:
        p = panel[panel.site == d.id]
        ec_frames.append(generate_ec(p, d, sites[d.id], rng))
    ec = pd.concat(ec_frames)
    ec["date"] = pd.to_datetime(ec["date"]).dt.strftime("%Y-%m-%d")
    buf = io.StringIO()
    ec.to_csv(buf, index=False)
    with gzip.open(DATA / "salinity_dataset.csv.gz", "wt", encoding="utf-8", compresslevel=9) as f:
        f.write(buf.getvalue())

    meta = {
        "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "period": [args.start, args.end],
        "sources": {
            "weather": "Open-Meteo Historical Weather API (ERA5/ERA5-Land, Copernicus C3S), CC BY 4.0",
            "discharge": "Open-Meteo Flood API (Copernicus GloFAS v4 reanalysis), CC BY 4.0",
            "sea_level": "Open-Meteo Marine API sea_level_height_msl (2025), CC BY 4.0",
            "elevation": "Open-Meteo Elevation API (Copernicus GLO-90), CC BY 4.0",
            "soil": "ISRIC SoilGrids 2.0 clay 0-5 cm, CC BY 4.0",
            "coastline": "Natural Earth 1:10m coastline, public domain",
        },
        # calls spent fetching the (now cached) raw responses, carried across re-assembly runs
        "open_meteo_calls_used": round(PACER.total + _previous_calls(), 1),
        "sites": sites,
    }
    (DATA / "sites.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    log.info(
        "done: flood_dataset %d rows (%.0f KB), salinity_dataset %d rows (%.0f KB), ~%.0f Open-Meteo calls",
        len(out),
        (DATA / "flood_dataset.csv.gz").stat().st_size / 1024,
        len(ec),
        (DATA / "salinity_dataset.csv.gz").stat().st_size / 1024,
        PACER.total,
    )


if __name__ == "__main__":
    main()
