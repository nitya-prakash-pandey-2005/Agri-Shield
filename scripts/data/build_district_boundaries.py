"""
Agri-SHIELD — real district boundaries
======================================
Author: Nitya Prakash Pandey

Writes ``apps/web/server/data/real/district-boundaries.json``: one simplified
outer ring per demo district (GeoJSON order [lon, lat], 5-decimal coordinates,
~60-150 vertices), used by the seed as ``districts[].geometry`` (a GeoJSON
Polygon) instead of a synthetic blob. Run this BEFORE build_land_points.py —
the land-point pool is sampled inside these exact rings.

Source: geoBoundaries gbOpen (www.geoboundaries.org), release 6
  BGD ADM2 (districts)          CC BY 3.0 IGO  (BBS / OCHA ROAP)
  VNM ADM1 (provinces, 2008)    Public domain  (pre-July-2025 provinces; full-resolution file)
  PHL ADM2 (provinces)          CC BY 3.0 IGO  (PSA / NAMRIA / OCHA)
  IND ADM2 (districts)          ODbL 1.0
  IDN ADM2 (regencies/cities)   CC BY 3.0 IGO  (BPS / OCHA)

Unit selection: the admin unit containing the app's district centroid; for
Pekalongan the regency and the enclosed city are merged (the app's population
figure is the regency's), Semarang is the city (Kota Semarang, whose population
the app uses).

Geometry:
  * single-part units → the polygon's outer ring (largest part if a unit has
    negligible extra parts, i.e. the largest part holds ≥ 97 % of the area);
  * multi-part units (Bangladesh coastal districts: chars and islands split by
    tidal channels) and merged units → rasterised on a ~250 m grid, a 1.5 km
    morphological closing joins islands across channels, holes are filled and
    the largest connected footprint is traced back to a ring (the result stays a
    single GeoJSON Polygon, which every consumer expects);
  * Douglas–Peucker simplification, tolerance found by bisection so each ring
    has 60–150 vertices; counter-clockwise exterior (RFC 7946).

Usage (from repo root):  python scripts/data/build_district_boundaries.py
"""
from __future__ import annotations

from datetime import datetime, timezone

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.path import Path as MplPath  # noqa: E402
from scipy import ndimage  # noqa: E402

from common import DISTRICTS, get_json, log, write_json  # noqa: E402

GB_API = "https://www.geoboundaries.org/api/current/gbOpen/{iso}/{adm}/"
LEVEL = {"BD": ("BGD", "ADM2"), "VN": ("VNM", "ADM1"), "PH": ("PHL", "ADM2"), "IN": ("IND", "ADM2"), "ID": ("IDN", "ADM2")}
FULL_RES = {"VNM"}  # the simplified VNM file has only ~70 vertices per province
MERGE = {"id-pekalongan": ["pekalongan"]}
GRID_DEG = 0.00225  # ≈ 250 m
CLOSE_KM = 1.5
TARGET = (60, 150)


def parts_of(geom) -> list[np.ndarray]:
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    return [np.asarray(p[0], dtype=float) for p in polys]


def ring_area(r: np.ndarray) -> float:
    x, y = r[:, 0], r[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))  # >0 = clockwise in lon/lat


def dp(points: np.ndarray, eps: float) -> np.ndarray:
    """Iterative Douglas–Peucker on an open polyline."""
    keep = np.zeros(len(points), dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        p, q = points[a], points[b]
        seg = q - p
        n = np.hypot(*seg)
        rel = points[a + 1:b] - p
        d = np.abs(seg[0] * rel[:, 1] - seg[1] * rel[:, 0]) / n if n > 0 else np.hypot(rel[:, 0], rel[:, 1])
        k = int(np.argmax(d))
        if d[k] > eps:
            keep[a + 1 + k] = True
            stack += [(a, a + 1 + k), (a + 1 + k, b)]
    return points[keep]


def simplify_ring(ring: np.ndarray) -> np.ndarray:
    ring = ring[:-1] if np.allclose(ring[0], ring[-1]) else ring
    # split the closed ring at its two farthest-apart vertices so DP keeps the overall shape
    i0 = 0
    i1 = int(np.argmax(np.hypot(*(ring - ring[i0]).T)))
    a, b = np.vstack([ring[i0:i1 + 1]]), np.vstack([ring[i1:], ring[:1]])
    lo, hi = 1e-6, 0.2
    best = None
    for _ in range(40):
        eps = (lo + hi) / 2
        s = np.vstack([dp(a, eps)[:-1], dp(b, eps)[:-1]])
        if len(s) > TARGET[1]:
            lo = eps
        elif len(s) < TARGET[0]:
            hi = eps
        else:
            best = s
            if len(s) <= (TARGET[0] + TARGET[1]) // 2 + 20:
                break
            lo = eps
    if best is None:
        best = s  # type: ignore[possibly-undefined]
    out = np.round(best, 5)
    if ring_area(np.vstack([out, out[:1]])) > 0:  # make exterior counter-clockwise
        out = out[::-1]
    return np.vstack([out, out[:1]])


def raster_footprint(parts: list[np.ndarray], lat0: float) -> np.ndarray:
    allp = np.vstack(parts)
    pad = 0.05
    x0, y0 = allp.min(axis=0) - pad
    x1, y1 = allp.max(axis=0) + pad
    nx, ny = int((x1 - x0) / GRID_DEG) + 1, int((y1 - y0) / GRID_DEG) + 1
    xs = x0 + np.arange(nx) * GRID_DEG
    ys = y0 + np.arange(ny) * GRID_DEG
    gx, gy = np.meshgrid(xs, ys)
    pts = np.column_stack([gx.ravel(), gy.ravel()])
    mask = np.zeros(len(pts), dtype=bool)
    for p in parts:
        mask |= MplPath(p).contains_points(pts)
    mask = mask.reshape(ny, nx)
    r = max(1, int(round(CLOSE_KM / (GRID_DEG * 111.32))))
    yy, xx = np.ogrid[-r:r + 1, -r:r + 1]
    disk = xx * xx + yy * yy <= r * r
    mask = ndimage.binary_closing(np.pad(mask, r + 1), structure=disk)[r + 1:-(r + 1), r + 1:-(r + 1)]
    mask = ndimage.binary_fill_holes(mask)
    lab, n = ndimage.label(mask)
    if n > 1:
        sizes = ndimage.sum(mask, lab, range(1, n + 1))
        mask = lab == (1 + int(np.argmax(sizes)))
    fig = plt.figure()
    cs = plt.contour(xs, ys, mask.astype(float), levels=[0.5])
    segs = cs.allsegs[0]
    plt.close(fig)
    ring = max(segs, key=len)
    return np.vstack([ring, ring[:1]])


def main() -> None:
    cache: dict[str, tuple[dict, dict]] = {}
    out = {}
    for d in DISTRICTS:
        iso, adm = LEVEL[d["country"]]
        key = f"{iso}-{adm}"
        if key not in cache:
            meta = get_json(GB_API.format(iso=iso, adm=adm))
            url = meta["gjDownloadURL"] if iso in FULL_RES else meta["simplifiedGeometryGeoJSON"]
            cache[key] = (meta, get_json(url, timeout=600))
        meta, gj = cache[key]
        chosen = []
        for f in gj["features"]:
            parts = parts_of(f["geometry"])
            name = str(f["properties"].get("shapeName", "")).lower()
            inside = any(MplPath(p).contains_point((d["lon"], d["lat"])) for p in parts)
            if inside or any(x in name for x in MERGE.get(d["id"], [])):
                chosen.append((f["properties"].get("shapeName"), parts))
        if not chosen:
            raise RuntimeError(f"no admin unit contains {d['id']}")
        parts = [p for _, ps in chosen for p in ps]
        areas = sorted((abs(ring_area(p)) for p in parts), reverse=True)
        if len(chosen) == 1 and areas[0] / sum(areas) >= 0.97:
            ring = max(parts, key=lambda p: abs(ring_area(p)))
            method = "outer ring"
        else:
            ring = raster_footprint(parts, d["lat"])
            method = f"raster union + {CLOSE_KM} km closing"
        simple = simplify_ring(ring)
        a_km2 = abs(ring_area(simple)) * 111.32 ** 2 * np.cos(np.radians(d["lat"]))
        out[d["id"]] = {
            "units": [c[0] for c in chosen],
            "source": f"geoBoundaries gbOpen {iso} {adm} ({meta['boundaryLicense']})",
            "method": method,
            "areaKm2": round(float(a_km2)),
            "ring": [[float(x), float(y)] for x, y in simple],
        }
        log(f"  {d['id']}: {out[d['id']]['units']} {method} → {len(simple) - 1} vertices, {a_km2:,.0f} km²")
    write_json("district-boundaries.json", {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "source": "geoBoundaries gbOpen (Runfola et al. 2020, PLoS ONE 15(4): e0231866), www.geoboundaries.org",
        "format": "ring = GeoJSON outer ring [lon, lat], counter-clockwise, closed",
        "districts": out,
    })


if __name__ == "__main__":
    main()
