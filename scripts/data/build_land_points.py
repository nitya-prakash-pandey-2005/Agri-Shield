"""
Agri-SHIELD — land-validated point pools + verified facility locations
======================================================================
Author: Nitya Prakash Pandey

Writes
  real/land-points.json   per district: 24 "farm sites" (a homestead + 5 plot
                          points 250–900 m away), every point validated as
                          dry land inside the real admin boundary.
  real/facilities.json    real approximate coordinates of the 20 supply-chain
                          facilities (ports, mills, warehouses), each checked
                          against OpenStreetMap Nominatim.

A candidate point is accepted only when ALL of these hold:
  1. inside the district's real boundary ring from real/district-boundaries.json
     (geoBoundaries gbOpen, built by build_district_boundaries.py — run that
     first) and within 0.4° of the district centroid used by the app;
  2. elevation from the Terrarium DEM tiles (AWS Open Data "elevation-tiles-prod",
     SRTM-based over the study area, zoom 12 ≈ 38 m) > 0 m (the sea is ≤ 0,
     bathymetry is negative) and < 120 m (keeps plots on the lowland farming
     plain rather than hills). The Open-Meteo Elevation API (Copernicus GLO-90)
     was the first choice but ~10k candidate points exhaust its free hourly
     quota, which the ML service shares;
  3. JRC Global Surface Water occurrence (1984–2021, tiles2021, zoom 12,
     ≈ 38 m pixels) < 15 % at the pixel and < 50 % in the 3×3 neighbourhood
     (≈ ±40 m) — rejects rivers, canals, ponds, aquaculture and the sea.
     The tile's alpha channel encodes occurrence (0-255 ≙ 0-100 %).

Candidates come from a Halton sequence (deterministic); the seed then picks
from the pool with its own PRNG, so the demo world stays reproducible.

Usage (from repo root):  python scripts/data/build_land_points.py
"""
from __future__ import annotations

import io
import json
import math
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import numpy as np
import requests
from matplotlib.path import Path as MplPath
from PIL import Image

from common import CACHE, DISTRICTS, REAL, UA, get_json, log, write_json

JRC = "https://storage.googleapis.com/global-surface-water/tiles2021/occurrence/{z}/{x}/{y}.png"
# Tilezen/Mapzen "Terrarium" elevation tiles (AWS Open Data Registry; SRTM/GMTED/ETOPO composite).
# Used instead of the Open-Meteo Elevation API because validating ~10k candidate points exhausts
# Open-Meteo's free hourly quota (shared with the ML service); same tile grid as the JRC mask.
DEM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
ZOOM = 12
SITES_PER_DISTRICT = 24
FIELDS_PER_SITE = 5
MAX_RADIUS_DEG = 0.4

# name, district id, approximate real location (lat, lon), Nominatim query used to verify it
FACILITIES = [
    ("Chattogram Port Terminal", "bd-barisal", 22.3113, 91.8003, "Chittagong Port, Chattogram, Bangladesh"),
    ("Mongla Port", "bd-khulna", 22.4880, 89.5960, "Mongla Port, Bagerhat, Bangladesh"),
    ("Barisal Rice Mill Cluster", "bd-barisal", 22.7210, 90.3480, "Barisal city"),
    ("Khulna Jute Processing Hub", "bd-khulna", 22.8620, 89.5390, "Khalishpur, Khulna, Bangladesh"),
    ("Satkhira Cold Storage", "bd-satkhira", 22.7160, 89.0780, "Satkhira, Bangladesh"),
    ("Sylhet Grain Depot", "bd-sylhet", 24.8990, 91.8560, "Sylhet City Corporation"),
    ("Cần Thơ Rice Export Warehouse", "vn-cantho", 10.1110, 105.7130, "Khu công nghiệp Trà Nóc, Cần Thơ, Vietnam"),
    ("Cái Mép Port", "vn-bentre", 10.5370, 107.0300, "Cai Mep International Terminal"),
    ("An Giang Milling Complex", "vn-angiang", 10.3880, 105.4200, "Long Xuyên, An Giang, Vietnam"),
    ("Sóc Trăng Sugar Refinery", "vn-soctrang", 9.6190, 105.9620, "Sóc Trăng city, Vietnam"),
    ("Manila North Harbor", "ph-bulacan", 14.6090, 120.9600, "Manila North Harbor, Tondo, Manila, Philippines"),
    ("Nueva Ecija NFA Warehouse", "ph-nuevaecija", 15.4870, 120.9670, "Cabanatuan, Nueva Ecija, Philippines"),
    ("Pampanga Sugar Central", "ph-pampanga", 15.0280, 120.6930, "City of San Fernando, Pampanga, Philippines"),
    ("Paradip Port", "in-jagatsinghpur", 20.2640, 86.6720, "Paradip Port, Odisha, India"),
    ("Kendrapara FCI Godown", "in-kendrapara", 20.4990, 86.4200, "Kendrapara, Kendrapara, Odisha"),
    ("Balasore Agro Processing Park", "in-balasore", 21.4930, 86.9260, "Balasore, Odisha, India"),
    ("Tanjung Emas Port", "id-semarang", -6.9480, 110.4190, "Pelabuhan Tanjung Emas, Semarang, Indonesia"),
    ("Demak Bulog Warehouse", "id-demak", -6.8930, 110.6390, "Demak, Jawa Tengah, Indonesia"),
    ("Indramayu Rice Mill", "id-indramayu", -6.3280, 108.3230, "Indramayu, Kabupaten Indramayu"),
    ("Jakarta Wholesale Market (Cipinang)", "id-indramayu", -6.2135, 106.8810, "Pasar Induk Beras Cipinang, Jakarta, Indonesia"),
]


def halton(i: int, b: int) -> float:
    f, r = 1.0, 0.0
    while i > 0:
        f /= b
        r += f * (i % b)
        i //= b
    return r


def rings_of(geom) -> list[np.ndarray]:
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    return [np.array(p[0]) for p in polys]


def load_units() -> dict[str, list[MplPath]]:
    """District rings from real/district-boundaries.json (run build_district_boundaries.py first)."""
    data = json.loads((REAL / "district-boundaries.json").read_text(encoding="utf-8"))["districts"]
    out: dict[str, list[MplPath]] = {}
    for d in DISTRICTS:
        out[d["id"]] = [MplPath(np.asarray(data[d["id"]]["ring"], dtype=float))]
        log(f"  {d['id']}: {data[d['id']]['units']}")
    return out


_dem: dict[tuple[int, int], np.ndarray | None] = {}


def _fetch_dem(xy: tuple[int, int]) -> None:
    path = CACHE / f"dem_{ZOOM}_{xy[0]}_{xy[1]}.png"
    if not path.exists():
        for k in range(4):
            try:
                r = requests.get(DEM.format(z=ZOOM, x=xy[0], y=xy[1]), headers=UA, timeout=60)
                r.raise_for_status()
                path.write_bytes(r.content)
                break
            except Exception:  # noqa: BLE001
                time.sleep(2 * (k + 1))
    raw = path.read_bytes() if path.exists() else b""
    if not raw:
        _dem[xy] = None
        return
    a = np.array(Image.open(io.BytesIO(raw)).convert("RGB")).astype(float)
    _dem[xy] = a[:, :, 0] * 256.0 + a[:, :, 1] + a[:, :, 2] / 256.0 - 32768.0  # Terrarium encoding


def elevations(points: list[tuple[float, float]]) -> list[float]:
    """Elevation (m) from Terrarium DEM tiles at zoom 12 (≈ 38 m px; SRTM-based over S/SE Asia)."""
    need = {(int(x), int(y)) for x, y in (_tile_xy(la, lo) for la, lo in points)}
    todo = [t for t in need if t not in _dem]
    with ThreadPoolExecutor(8) as ex:
        list(ex.map(_fetch_dem, todo))
    out = []
    for la, lo in points:
        x, y = _tile_xy(la, lo)
        t = _dem.get((int(x), int(y)))
        out.append(-999.0 if t is None else float(t[int((y % 1) * 256), int((x % 1) * 256)]))
    return out


_tiles: dict[tuple[int, int], np.ndarray | None] = {}


def _tile_xy(lat: float, lon: float) -> tuple[float, float]:
    n = 2 ** ZOOM
    x = (lon + 180.0) / 360.0 * n
    y = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n
    return x, y


def _fetch_tile(xy: tuple[int, int]) -> None:
    path = CACHE / f"jrc_{ZOOM}_{xy[0]}_{xy[1]}.png"
    if not path.exists():
        for k in range(4):
            try:
                r = requests.get(JRC.format(z=ZOOM, x=xy[0], y=xy[1]), headers=UA, timeout=60)
                if r.status_code == 404:
                    path.write_bytes(b"")
                    break
                r.raise_for_status()
                path.write_bytes(r.content)
                break
            except Exception:  # noqa: BLE001
                time.sleep(2 * (k + 1))
    raw = path.read_bytes() if path.exists() else b""
    _tiles[xy] = np.array(Image.open(io.BytesIO(raw)).convert("RGBA"))[:, :, 3].astype(float) / 2.55 if raw else None


def water_occurrence(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    need = set()
    for lat, lon in points:
        x, y = _tile_xy(lat, lon)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                need.add((int(x + dx / 256), int(y + dy / 256)))
    todo = [t for t in need if t not in _tiles]
    with ThreadPoolExecutor(8) as ex:
        list(ex.map(_fetch_tile, todo))
    out = []
    for lat, lon in points:
        x, y = _tile_xy(lat, lon)
        px, py = int(x * 256), int(y * 256)
        vals = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                gx, gy = px + dx, py + dy
                t = _tiles.get((gx // 256, gy // 256))
                vals.append(0.0 if t is None else float(t[gy % 256, gx % 256]))
        out.append((vals[4], max(vals)))
    return out


def check(points: list[tuple[float, float]]) -> list[tuple[bool, float]]:
    """(accepted, elevation_m) per point."""
    elev = elevations(points)
    occ = water_occurrence(points)
    return [((0.0 < e < 120.0) and c < 15.0 and n < 50.0, e) for e, (c, n) in zip(elev, occ)]


def valid(points: list[tuple[float, float]]) -> list[bool]:
    return [ok for ok, _ in check(points)]


def offset(lat: float, lon: float, dist_m: float, bearing: float) -> tuple[float, float]:
    dlat = dist_m * math.cos(bearing) / 111_320.0
    dlon = dist_m * math.sin(bearing) / (111_320.0 * math.cos(math.radians(lat)))
    return round(lat + dlat, 5), round(lon + dlon, 5)


def build_pool(d: dict, paths: list[MplPath]) -> list[list]:
    verts = np.vstack([p.vertices for p in paths])
    lo_lon, lo_lat = verts.min(axis=0)
    hi_lon, hi_lat = verts.max(axis=0)
    lo_lat, hi_lat = max(lo_lat, d["lat"] - MAX_RADIUS_DEG), min(hi_lat, d["lat"] + MAX_RADIUS_DEG)
    lo_lon, hi_lon = max(lo_lon, d["lon"] - MAX_RADIUS_DEG), min(hi_lon, d["lon"] + MAX_RADIUS_DEG)
    inside = lambda la, lo: any(p.contains_point((lo, la)) for p in paths) and math.hypot(la - d["lat"], lo - d["lon"]) <= MAX_RADIUS_DEG  # noqa: E731
    sites: list[list] = []
    i = 1
    while len(sites) < SITES_PER_DISTRICT and i < 4000:
        centres = []
        while len(centres) < 60 and i < 4000:
            la = lo_lat + halton(i, 2) * (hi_lat - lo_lat)
            lo = lo_lon + halton(i, 3) * (hi_lon - lo_lon)
            i += 1
            if inside(la, lo):
                centres.append((round(la, 5), round(lo, 5)))
        ok = check(centres)
        centres = [(c[0], c[1], e) for c, (v, e) in zip(centres, ok) if v]
        # 8 candidate plot points per homestead, keep the first 5 valid ones
        cands = []
        for k, (la, lo, _) in enumerate(centres):
            for j in range(8):
                ang = 2 * math.pi * halton(k * 8 + j + 1, 5)
                dist = 250 + 650 * halton(k * 8 + j + 1, 7)
                cands.append(offset(la, lo, dist, ang))
        okc = check(cands) if cands else []
        for k, c in enumerate(centres):
            plots = [(p, e) for p, (v, e) in zip(cands[k * 8:(k + 1) * 8], okc[k * 8:(k + 1) * 8]) if v and inside(*p)][:FIELDS_PER_SITE]
            if len(plots) == FIELDS_PER_SITE and len(sites) < SITES_PER_DISTRICT:
                sites.append([c[0], c[1], round(c[2]), [[p[0], p[1], round(e)] for p, e in plots]])
    if len(sites) < SITES_PER_DISTRICT:
        raise RuntimeError(f"{d['id']}: only {len(sites)} valid sites")
    return sites


def facilities() -> list[dict]:
    out = []
    for name, did, lat, lon, q in FACILITIES:
        res = get_json("https://nominatim.openstreetmap.org/search", {"q": q, "format": "json", "limit": 1}, pause=1.1)
        nlat, nlon = (float(res[0]["lat"]), float(res[0]["lon"])) if res else (None, None)
        km = None if nlat is None else round(math.hypot((nlat - lat) * 111.3, (nlon - lon) * 111.3 * math.cos(math.radians(lat))), 1)
        out.append({"name": name, "districtId": did, "lat": lat, "lon": lon, "osmQuery": q, "osmLat": nlat, "osmLon": nlon, "offsetKm": km})
        log(f"  {name}: OSM offset {km} km")
    ok = valid([(f["lat"], f["lon"]) for f in out])
    for f, v in zip(out, ok):
        if not v:
            # Waterfront sites (ports, riverside mills): snap the pin to the nearest dry-land pixel
            snapped = snap_to_land(f["lat"], f["lon"])
            if snapped:
                f["snappedM"] = snapped[2]
                f["lat"], f["lon"] = snapped[0], snapped[1]
                v = True
        f["landCheck"] = v
    return out


def snap_to_land(lat: float, lon: float, max_m: float = 1500, step_m: float = 30) -> tuple[float, float, int] | None:
    """Nearest point (on a 30 m grid, ≤ 1.5 km away) that passes every land check."""
    cands = []
    n = int(max_m // step_m)
    for i in range(-n, n + 1):
        for j in range(-n, n + 1):
            d = math.hypot(i, j) * step_m
            if 0 < d <= max_m:
                la, lo = offset(lat, lon, d, math.atan2(j, i))
                cands.append((d, la, lo))
    cands.sort()
    for k in range(0, len(cands), 400):
        chunk = cands[k:k + 400]
        for (d, la, lo), v in zip(chunk, valid([(c[1], c[2]) for c in chunk])):
            if v:
                return la, lo, int(round(d))
    return None


def main() -> None:
    units = load_units()
    pools = {}
    for d in DISTRICTS:
        pools[d["id"]] = build_pool(d, units[d["id"]])
        log(f"  {d['id']}: {len(pools[d['id']])} sites")
    meta = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "checks": "geoBoundaries admin polygon; Terrarium DEM (SRTM-based) elevation 0–120 m; JRC GSW occurrence <15 % (pixel) and <50 % (3×3, z12)"}
    write_json("land-points.json", {**meta, "format": "[homeLat, homeLon, homeElevM, [[plotLat, plotLon, plotElevM] ×5]]", "districts": pools})
    write_json("facilities.json", {**meta, "facilities": facilities()})


if __name__ == "__main__":
    main()
