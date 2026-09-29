"""
Training data access — Agri-SHIELD
==================================
Loads the committed, compact datasets produced by
``scripts/train-models/build_dataset.py`` and turns them into model-ready
feature/label matrices with a strictly time-based split.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

from core.features import (
    SAL_HORIZONS,
    SiteStats,
    build_flood_frame,
    build_salinity_frame,
    compute_site_stats,
    flood_labels,
)

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
FLOOD_CSV = DATA_DIR / "flood_dataset.csv.gz"
SAL_CSV = DATA_DIR / "salinity_dataset.csv.gz"
SITES_JSON = DATA_DIR / "sites.json"

VAL_START = pd.Timestamp("2023-01-01")
DEFAULT_CLAY_PCT = 35.0
TEST_START = pd.Timestamp("2024-01-01")


def datasets_available() -> bool:
    return FLOOD_CSV.exists() and SAL_CSV.exists() and SITES_JSON.exists()


def load_sites() -> dict[str, dict]:
    meta = json.loads(SITES_JSON.read_text(encoding="utf-8"))
    return meta["sites"]


def load_meta() -> dict:
    meta = json.loads(SITES_JSON.read_text(encoding="utf-8"))
    meta.pop("sites", None)
    return meta


def load_panel(extra: Optional[pd.DataFrame] = None) -> pd.DataFrame:
    """Daily ERA5 + GloFAS panel (optionally with newer rows appended by a retrain refresh)."""
    df = pd.read_csv(FLOOD_CSV, parse_dates=["date"])
    if extra is not None and len(extra):
        df = pd.concat([df, extra], ignore_index=True).drop_duplicates(["site", "date"], keep="last")
    return df.sort_values(["site", "date"]).reset_index(drop=True)


def site_daily(panel: pd.DataFrame, site_id: str) -> pd.DataFrame:
    return panel[panel.site == site_id].set_index("date")[["precip_mm", "soil_moisture", "et0_mm", "discharge_m3s"]].sort_index()


def split_of(dates: pd.Series) -> np.ndarray:
    return np.where(dates >= TEST_START, "test", np.where(dates >= VAL_START, "val", "train"))


@dataclass
class FloodData:
    X: pd.DataFrame  # all feature columns (GBM + sequence), plus 'site', 'date', 'split'
    y: pd.DataFrame  # y1, y2, y3, depth3, event_now
    stats: dict[str, SiteStats]
    static: dict[str, dict]


def build_flood_data(panel: pd.DataFrame, sites: dict[str, dict]) -> FloodData:
    feats, labels, stats, statics = [], [], {}, {}
    for sid, site in sites.items():
        daily = site_daily(panel, sid)
        if daily.empty:
            continue
        st = compute_site_stats(daily[daily.index < VAL_START])
        static = {
            "elevation_m": site.get("elevation_m"),
            "coast_km": site.get("coast_km"),
            "flood_prior": site.get("flood_exposure", 0.55),
            "lat": site.get("lat"),
        }
        f = build_flood_frame(daily, st, static)
        y = flood_labels(daily, st, float(site.get("elevation_m") or 5.0))
        f["site"], f["date"] = sid, f.index
        feats.append(f)
        labels.append(y)
        stats[sid], statics[sid] = st, static
    X = pd.concat(feats).reset_index(drop=True)
    y = pd.concat(labels).reset_index(drop=True)
    ok = y[["y1", "y2", "y3"]].notna().all(axis=1) & X["rain_f72"].notna()
    X, y = X[ok].reset_index(drop=True), y[ok].reset_index(drop=True)
    X["split"] = split_of(X["date"])
    return FloodData(X=X, y=y, stats=stats, static=statics)


@dataclass
class SalinityData:
    X: pd.DataFrame
    y: pd.DataFrame  # ec_h0, ec_h7, ec_h30, ec_h90
    stats: dict[str, SiteStats]
    static: dict[str, dict]


def build_salinity_data(panel: pd.DataFrame, sites: dict[str, dict], seed: int = 7) -> SalinityData:
    ec = pd.read_csv(SAL_CSV, parse_dates=["date"])
    rng = np.random.default_rng(seed)
    feats, targets, stats, statics = [], [], {}, {}
    for sid, site in sites.items():
        daily = site_daily(panel, sid)
        e = ec[ec.site == sid].set_index("date")["ec_dsm"].sort_index()
        if daily.empty or e.empty:
            continue
        st = compute_site_stats(daily[daily.index < VAL_START])
        sea = site.get("sea")
        static = {
            "coast_km": site.get("coast_km"),
            "elevation_m": site.get("elevation_m"),
            "salinity_prior": site.get("salinity_exposure"),
            # SoilGrids returns no value for some delta pixels: impute a typical delta clay content
            "clay_pct": site.get("clay_pct") if site.get("clay_pct") is not None else DEFAULT_CLAY_PCT,
            # No sea cell within reach = inland, no tidal influence
            "tidal_range_m": sea.get("tidal_range_m") if sea else 0.0,
            "lat": site.get("lat"),
        }
        f = build_salinity_frame(daily, st, static)
        # Live SoilGrids / Marine calls can fail: teach the model to cope with missing values.
        f.loc[rng.random(len(f)) < 0.15, "clay_pct"] = np.nan
        f.loc[rng.random(len(f)) < 0.10, "tidal_range_m"] = np.nan
        e = e.reindex(f.index)
        t = pd.DataFrame({f"ec_h{h}": e.shift(-h) for h in SAL_HORIZONS}, index=f.index)
        f["site"], f["date"] = sid, f.index
        feats.append(f)
        targets.append(t)
        stats[sid], statics[sid] = st, static
    X = pd.concat(feats).reset_index(drop=True)
    y = pd.concat(targets).reset_index(drop=True)
    X["split"] = split_of(X["date"])
    return SalinityData(X=X, y=y, stats=stats, static=statics)
