"""
Geography — Agri-SHIELD
=======================
The 22 demo districts (real district centroids, mirrored from
``apps/web/server/data/geography.ts``) plus geodesic helpers:

- ``haversine_km``          great-circle distance
- ``nearest_district``      closest demo district to an arbitrary point
- ``coast_distance_km``     distance to the Natural Earth 1:10m coastline
                            (public domain), pre-extracted for South/Southeast Asia
                            into ``data/coastline_asia.npz`` by the dataset builder.

Exposure factors are literature-calibrated priors per basin (0–1) and are only
used as a *prior* feature when a query point is close to a known district.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
COASTLINE_FILE = DATA_DIR / "coastline_asia.npz"
EARTH_RADIUS_KM = 6371.0088


@dataclass(frozen=True)
class District:
    id: str
    name: str
    country: str
    lat: float
    lon: float
    population: int
    flood_exposure: float
    salinity_exposure: float
    coast_distance_km: float
    river_name: str
    primary_crops: tuple[str, ...] = field(default_factory=tuple)


DISTRICTS: tuple[District, ...] = (
    # Bangladesh — Ganges–Brahmaputra–Meghna delta
    District("bd-barisal", "Barisal", "BD", 22.7011, 90.3637, 2_324_310, 0.78, 0.52, 62, "Kirtankhola", ("rice", "jute")),
    District("bd-khulna", "Khulna", "BD", 22.8456, 89.5403, 2_318_527, 0.84, 0.88, 38, "Rupsha", ("rice", "vegetables")),
    District("bd-satkhira", "Satkhira", "BD", 22.7185, 89.0705, 1_985_959, 0.72, 0.93, 22, "Betna", ("rice", "vegetables")),
    District("bd-patuakhali", "Patuakhali", "BD", 22.3596, 90.3299, 1_535_854, 0.86, 0.81, 18, "Lohalia", ("rice", "coconut")),
    District("bd-sylhet", "Sylhet", "BD", 24.8949, 91.8687, 3_434_188, 0.69, 0.05, 310, "Surma", ("rice",)),
    # Vietnam — Mekong Delta
    District("vn-cantho", "Cần Thơ", "VN", 10.0452, 105.7469, 1_235_171, 0.64, 0.55, 75, "Hậu (Bassac)", ("rice", "vegetables")),
    District("vn-bentre", "Bến Tre", "VN", 10.2434, 106.3756, 1_288_463, 0.58, 0.94, 25, "Hàm Luông", ("coconut", "rice")),
    District("vn-soctrang", "Sóc Trăng", "VN", 9.6025, 105.9739, 1_199_653, 0.55, 0.86, 30, "Mỹ Thanh", ("rice", "sugarcane")),
    District("vn-camau", "Cà Mau", "VN", 9.1769, 105.1524, 1_194_476, 0.61, 0.91, 15, "Gành Hào", ("rice",)),
    District("vn-angiang", "An Giang", "VN", 10.5216, 105.1259, 1_908_352, 0.81, 0.18, 140, "Tiền (Mekong)", ("rice",)),
    # Philippines — Central Luzon / Pampanga basin
    District("ph-pampanga", "Pampanga", "PH", 15.0794, 120.62, 2_437_709, 0.82, 0.34, 20, "Pampanga", ("rice", "sugarcane")),
    District("ph-bulacan", "Bulacan", "PH", 14.7943, 120.8799, 3_708_890, 0.77, 0.41, 12, "Angat", ("rice", "vegetables")),
    District("ph-nuevaecija", "Nueva Ecija", "PH", 15.5784, 121.1113, 2_310_134, 0.59, 0.04, 95, "Pampanga (upper)", ("rice", "onion")),
    District("ph-tarlac", "Tarlac", "PH", 15.4755, 120.5963, 1_503_456, 0.52, 0.03, 70, "Tarlac", ("rice", "sugarcane", "maize")),
    # India — Odisha coast / Mahanadi delta
    District("in-kendrapara", "Kendrapara", "IN", 20.5, 86.4167, 1_440_361, 0.83, 0.77, 20, "Brahmani", ("rice", "jute")),
    District("in-jagatsinghpur", "Jagatsinghpur", "IN", 20.2549, 86.1706, 1_136_971, 0.79, 0.72, 18, "Mahanadi", ("rice", "coconut")),
    District("in-balasore", "Balasore", "IN", 21.4942, 86.9317, 2_320_529, 0.71, 0.58, 16, "Budhabalanga", ("rice", "vegetables")),
    District("in-puri", "Puri", "IN", 19.8135, 85.8312, 1_698_730, 0.66, 0.63, 8, "Kushabhadra", ("rice", "coconut")),
    # Indonesia — Java north coast (Pantura)
    District("id-demak", "Demak", "ID", -6.8943, 110.6387, 1_203_956, 0.85, 0.79, 10, "Tuntang", ("rice", "vegetables")),
    District("id-pekalongan", "Pekalongan", "ID", -6.8898, 109.6746, 968_821, 0.8, 0.74, 6, "Kupang", ("rice",)),
    District("id-indramayu", "Indramayu", "ID", -6.3373, 108.3258, 1_834_434, 0.68, 0.61, 14, "Cimanuk", ("rice", "mango")),
    District("id-semarang", "Semarang", "ID", -6.9932, 110.4203, 1_653_524, 0.74, 0.66, 5, "Garang", ("rice", "vegetables")),
)

DISTRICT_BY_ID: dict[str, District] = {d.id: d for d in DISTRICTS}

COUNTRY_NAMES = {
    "BD": "Bangladesh",
    "VN": "Vietnam",
    "PH": "Philippines",
    "IN": "India",
    "ID": "Indonesia",
}


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in km."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


def nearest_district(lat: float, lon: float) -> tuple[District, float]:
    """Return the closest demo district and its distance in km."""
    best = min(DISTRICTS, key=lambda d: haversine_km(lat, lon, d.lat, d.lon))
    return best, haversine_km(lat, lon, best.lat, best.lon)


def _to_xyz(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    la, lo = np.radians(lat), np.radians(lon)
    return np.column_stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)])


@lru_cache(maxsize=1)
def _coast_tree():
    """KD-tree over coastline vertices on the unit sphere (lazy, cached)."""
    from scipy.spatial import cKDTree

    if not COASTLINE_FILE.exists():
        logger.warning("Coastline file %s missing — coast distance falls back to district prior", COASTLINE_FILE)
        return None, None
    arr = np.load(COASTLINE_FILE)
    lat, lon = arr["lat"].astype(np.float64), arr["lon"].astype(np.float64)
    return cKDTree(_to_xyz(lat, lon)), np.column_stack([lat, lon])


def coast_distance_km(lat: float, lon: float) -> Optional[float]:
    """Distance to the nearest Natural Earth coastline vertex (km), or None if unavailable."""
    tree, pts = _coast_tree()
    if tree is None:
        d, dist = nearest_district(lat, lon)
        return float(d.coast_distance_km + dist * 0.5)
    chord, _ = tree.query(_to_xyz(np.array([lat]), np.array([lon]))[0])
    return float(2 * EARTH_RADIUS_KM * math.asin(min(1.0, chord / 2)))


def nearest_coast_point(lat: float, lon: float) -> Optional[tuple[float, float]]:
    """Nearest coastline vertex (lat, lon) — used to locate a sea-level grid cell."""
    tree, pts = _coast_tree()
    if tree is None:
        return None
    _, idx = tree.query(_to_xyz(np.array([lat]), np.array([lon]))[0])
    return float(pts[idx][0]), float(pts[idx][1])


def exposure_prior(lat: float, lon: float, coast_km: Optional[float]) -> tuple[float, float, str]:
    """
    Static exposure prior (flood, salinity, provenance) for an arbitrary point.

    Within 35 km of a demo district its literature-calibrated factors are used
    (blended with distance); otherwise salinity exposure decays with coast
    distance and flood exposure takes a neutral delta prior.
    """
    d, dist = nearest_district(lat, lon)
    ck = coast_km if coast_km is not None else d.coast_distance_km
    generic_sal = float(1.0 / (1.0 + math.exp((ck - 45.0) / 18.0)))
    generic_flood = 0.55
    if dist <= 35.0:
        w = 1.0 - dist / 70.0
        return (
            w * d.flood_exposure + (1 - w) * generic_flood,
            w * d.salinity_exposure + (1 - w) * generic_sal,
            f"district-prior:{d.id}",
        )
    return generic_flood, generic_sal, "coast-distance-prior"
