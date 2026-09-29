"""
Feature engineering — Agri-SHIELD
=================================
One implementation shared by training (historical ERA5 + GloFAS panel) and live
inference (Open-Meteo forecast + GloFAS forecast), so the model sees identically
constructed inputs in both settings.

Daily frame convention
----------------------
A per-site daily ``DataFrame`` indexed by date with columns
``precip_mm, soil_moisture, et0_mm, discharge_m3s``. For the prediction day ``t``
the frame must also contain the next 3 days of rainfall — observed (reanalysis)
during training, forecast during inference.

Flood labels (training only)
----------------------------
A day ``t`` is labelled positive for horizon k ∈ {1, 2, 3} days if within
``t+1 … t+k`` either
  * GloFAS river discharge exceeds the site's 95th percentile (riverine flood), or
  * the 3-day rainfall total exceeds the site's 99th percentile (pluvial waterlogging).
Percentiles come from the training years only (no leakage into the test period).
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Optional

import numpy as np
import pandas as pd

SYNODIC_DAYS = 29.530588853
REF_NEW_MOON = pd.Timestamp("2000-01-06 18:14")
PAST_DAYS = 7
FORECAST_DAYS = 3


@dataclass
class SiteStats:
    """Hydro-climatological statistics of a site's river cell and rainfall."""

    q_p95: float
    q_median: float
    q_flashiness: float  # P95 / median discharge
    flood_events_per_year: float
    rain3_p99: float

    def to_dict(self) -> dict:
        return asdict(self)


def compute_site_stats(daily: pd.DataFrame) -> SiteStats:
    """Discharge / rainfall climatology from a (training-period) daily frame."""
    q = daily["discharge_m3s"].astype(float).dropna().clip(lower=0)
    rain3 = daily["precip_mm"].fillna(0).rolling(3, min_periods=1).sum()
    p95 = float(max(q.quantile(0.95), 1e-3)) if len(q) else 1.0
    med = float(max(q.median(), 1e-3)) if len(q) else 1.0
    above = (q > p95).astype(int)
    # Decluster: an event starts when exceedance begins after ≥ 7 days below threshold
    starts = 0
    gap = 999
    for v in above.to_numpy():
        if v:
            if gap >= 7:
                starts += 1
            gap = 0
        else:
            gap += 1
    years = max(len(q) / 365.25, 1.0)
    return SiteStats(
        q_p95=p95,
        q_median=med,
        q_flashiness=float(p95 / med),
        flood_events_per_year=float(starts / years),
        rain3_p99=float(max(rain3.quantile(0.99), 20.0)),
    )


def spring_neap_index(dates) -> np.ndarray:
    """Astronomical spring–neap index: +1 near new/full moon (spring tides), −1 at neaps."""
    idx = pd.DatetimeIndex(dates)
    days = (idx - REF_NEW_MOON).total_seconds() / 86400.0 - 1.5
    phase = (np.asarray(days) % SYNODIC_DAYS) / SYNODIC_DAYS
    return np.cos(4 * np.pi * phase)


def _season(idx: pd.DatetimeIndex) -> tuple[np.ndarray, np.ndarray]:
    doy = idx.dayofyear.to_numpy()
    ang = 2 * np.pi * doy / 365.25
    return np.sin(ang), np.cos(ang)


# ─── Flood ─────────────────────────────────────────────────────────────────

FLOOD_GBM_FEATURES = [
    "elevation_m", "coast_km", "flood_prior", "q_flashiness", "flood_events_per_year", "lat",
    "season_sin", "season_cos",
    "rain_1d", "rain_3d", "rain_7d", "rain_14d", "rain_30d", "rain_max1d_7d",
    "rain_f24", "rain_f48", "rain_f72", "rain_f72_vs_p99",
    "sm_now", "sm_mean_7d", "sm_delta_3d",
    "q_ratio_p95", "q_ratio_median", "q_log_trend_3d", "q_max7_ratio_p95", "above_p95_now",
]

# Groups for occlusion-based attribution → contract factor names
FLOOD_FACTOR_GROUPS = {
    "above_avg_rainfall_72h": ["rain_f24", "rain_f48", "rain_f72", "rain_f72_vs_p99"],
    "wet_antecedent_7d": ["rain_1d", "rain_3d", "rain_7d", "rain_14d", "rain_30d", "rain_max1d_7d"],
    "high_soil_saturation": ["sm_now", "sm_mean_7d", "sm_delta_3d"],
    "river_discharge_above_normal": ["q_ratio_p95", "q_ratio_median", "q_max7_ratio_p95", "above_p95_now"],
    "rising_river_trend": ["q_log_trend_3d"],
    "low_lying_floodplain": ["elevation_m", "flood_prior"],
    "coastal_proximity": ["coast_km"],
    "flashy_catchment_history": ["q_flashiness", "flood_events_per_year"],
    "monsoon_season_peak": ["season_sin", "season_cos"],
}


def build_flood_frame(daily: pd.DataFrame, stats: SiteStats, static: dict) -> pd.DataFrame:
    """
    Compute GBM features and sequence channels for every day of ``daily``.

    ``static`` keys: elevation_m, coast_km, flood_prior, lat.
    Rows whose look-ahead rainfall is unavailable get NaN in the forecast features.
    """
    d = daily.sort_index()
    rain = d["precip_mm"].astype(float).fillna(0.0)
    sm = d["soil_moisture"].astype(float).ffill().bfill().fillna(0.3)
    q = d["discharge_m3s"].astype(float).ffill().bfill().fillna(stats.q_median).clip(lower=1e-4)

    f = pd.DataFrame(index=d.index)
    f["elevation_m"] = float(static.get("elevation_m") or 5.0)
    f["coast_km"] = float(static.get("coast_km") or 50.0)
    f["flood_prior"] = float(static.get("flood_prior", 0.55))
    f["q_flashiness"] = stats.q_flashiness
    f["flood_events_per_year"] = stats.flood_events_per_year
    f["lat"] = float(static.get("lat", 15.0))
    s, c = _season(d.index)
    f["season_sin"], f["season_cos"] = s, c

    f["rain_1d"] = rain
    f["rain_3d"] = rain.rolling(3, min_periods=1).sum()
    f["rain_7d"] = rain.rolling(7, min_periods=1).sum()
    f["rain_14d"] = rain.rolling(14, min_periods=1).sum()
    f["rain_30d"] = rain.rolling(30, min_periods=1).sum()
    f["rain_max1d_7d"] = rain.rolling(7, min_periods=1).max()
    fut = [rain.shift(-k) for k in range(1, FORECAST_DAYS + 1)]
    f["rain_f24"] = fut[0]
    f["rain_f48"] = fut[0] + fut[1]
    f["rain_f72"] = fut[0] + fut[1] + fut[2]
    f["rain_f72_vs_p99"] = f["rain_f72"] / stats.rain3_p99

    f["sm_now"] = sm
    f["sm_mean_7d"] = sm.rolling(7, min_periods=1).mean()
    f["sm_delta_3d"] = sm - sm.shift(3).bfill()

    f["q_ratio_p95"] = q / stats.q_p95
    f["q_ratio_median"] = q / stats.q_median
    f["q_log_trend_3d"] = np.log(q) - np.log(q.shift(3).bfill())
    f["q_max7_ratio_p95"] = q.rolling(7, min_periods=1).max() / stats.q_p95
    f["above_p95_now"] = (q > stats.q_p95).astype(float)

    # Sequence channels for the temporal network (past 7 days + 3 forecast days)
    for k in range(PAST_DAYS):
        lag = PAST_DAYS - 1 - k
        f[f"seq_rain_{k}"] = np.log1p(rain.shift(lag).bfill())
        f[f"seq_sm_{k}"] = sm.shift(lag).bfill()
        f[f"seq_q_{k}"] = np.log(q.shift(lag).bfill() / stats.q_p95)
    for k in range(FORECAST_DAYS):
        f[f"seq_rainf_{k}"] = np.log1p(fut[k])
    return f


SEQ_FEATURES = (
    [f"seq_rain_{k}" for k in range(PAST_DAYS)]
    + [f"seq_sm_{k}" for k in range(PAST_DAYS)]
    + [f"seq_q_{k}" for k in range(PAST_DAYS)]
    + [f"seq_rainf_{k}" for k in range(FORECAST_DAYS)]
    + ["elevation_m", "coast_km", "flood_prior", "q_flashiness", "lat", "season_sin", "season_cos"]
)

RAIN_FORECAST_COLUMNS = ["rain_f24", "rain_f48", "rain_f72", "rain_f72_vs_p99"] + [f"seq_rainf_{k}" for k in range(FORECAST_DAYS)]


def depth_proxy(q_ratio_p95: np.ndarray, rain_3d: np.ndarray, elevation_m: float) -> np.ndarray:
    """
    Physically-derived flood depth proxy (m).

    Riverine: overbank stage from a wide-channel Manning rating (h ∝ Q^0.6) with
    ~1.5 m of floodplain inundation per unit of relative stage above bankfull (≈P95).
    Pluvial: 3-day rainfall beyond ~90 mm of infiltration + drainage capacity, ponding
    concentrated ×4 on low-lying land.
    """
    riverine = 1.5 * np.clip(np.power(np.clip(q_ratio_p95, 0, None), 0.6) - 1.0, 0, None)
    lowland = 1.0 / (1.0 + max(elevation_m, 0.0) / 8.0)
    pluvial = np.clip(rain_3d - 90.0, 0, None) / 1000.0 * 4.0 * lowland
    return np.clip(riverine + pluvial, 0.0, 3.0)


def flood_labels(daily: pd.DataFrame, stats: SiteStats, elevation_m: float) -> pd.DataFrame:
    """Binary labels y1/y2/y3 and depth target for each day (NaN where look-ahead is missing)."""
    d = daily.sort_index()
    q = d["discharge_m3s"].astype(float)
    rain = d["precip_mm"].astype(float).fillna(0.0)
    rain3 = rain.rolling(3, min_periods=1).sum()
    event = ((q > stats.q_p95) | (rain3 > stats.rain3_p99)).astype(float)
    event[q.isna()] = np.nan
    depth = pd.Series(depth_proxy((q / stats.q_p95).to_numpy(), rain3.to_numpy(), elevation_m), index=d.index)
    out = pd.DataFrame(index=d.index)
    shifted = [event.shift(-k) for k in range(1, FORECAST_DAYS + 1)]
    out["y1"] = shifted[0]
    out["y2"] = pd.concat(shifted[:2], axis=1).max(axis=1, skipna=False)
    out["y3"] = pd.concat(shifted, axis=1).max(axis=1, skipna=False)
    out["depth3"] = pd.concat([depth.shift(-k) for k in range(1, FORECAST_DAYS + 1)], axis=1).max(axis=1, skipna=False)
    out["event_now"] = event
    return out


# ─── Salinity ──────────────────────────────────────────────────────────────

SAL_FEATURES = [
    "coast_km", "elevation_m", "salinity_prior", "clay_pct", "tidal_range_m", "lat",
    "season_sin", "season_cos",
    "rain_30d", "rain_90d", "et0_30d", "water_deficit_30d",
    "q30_ratio", "q7_vs_q30", "spring_index", "spring_index_7d",
]
SAL_HORIZONS = (0, 7, 30, 90)


def build_salinity_frame(daily: pd.DataFrame, stats: SiteStats, static: dict) -> pd.DataFrame:
    """Salinity features for each day; ``static`` keys: coast_km, elevation_m, salinity_prior, clay_pct, tidal_range_m, lat."""
    d = daily.sort_index()
    rain = d["precip_mm"].astype(float).fillna(0.0)
    et0 = d["et0_mm"].astype(float).fillna(4.0)
    q = d["discharge_m3s"].astype(float).ffill().bfill().fillna(stats.q_median).clip(lower=1e-4)
    f = pd.DataFrame(index=d.index)
    for k in ("coast_km", "elevation_m", "salinity_prior", "tidal_range_m", "lat"):
        v = static.get(k)
        f[k] = np.nan if v is None else float(v)
    clay = static.get("clay_pct")
    f["clay_pct"] = np.nan if clay is None else float(clay)
    s, c = _season(d.index)
    f["season_sin"], f["season_cos"] = s, c
    f["rain_30d"] = rain.rolling(30, min_periods=1).sum()
    f["rain_90d"] = rain.rolling(90, min_periods=1).sum()
    f["et0_30d"] = et0.rolling(30, min_periods=1).sum()
    f["water_deficit_30d"] = f["et0_30d"] - f["rain_30d"]
    q30 = q.rolling(30, min_periods=5).mean()
    f["q30_ratio"] = (q30 / stats.q_median).bfill()
    f["q7_vs_q30"] = (q.rolling(7, min_periods=3).mean() / q30).bfill()
    f["spring_index"] = spring_neap_index(d.index)
    f["spring_index_7d"] = spring_neap_index(d.index + pd.Timedelta(days=7))
    return f


def static_lookup(static: dict, key: str, default: Optional[float] = None) -> Optional[float]:
    v = static.get(key)
    return default if v is None else float(v)
