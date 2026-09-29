"""
ML Inference Orchestration — Agri-SHIELD
========================================
Joins live features (``services/live_data.py``) with the trained models
(``models/registry.py``) and shapes responses to the web contract
(``apps/web/server/ml-client.ts``). While models are still training, or if a
model is unavailable, predictions come from the domain-formula engines so the
API never returns placeholders.
"""
from __future__ import annotations

import asyncio
import logging
import math
from typing import Optional

import numpy as np
import pandas as pd

from core.features import (
    SiteStats,
    build_flood_frame,
    build_salinity_frame,
    compute_site_stats,
)
from core.geo import COUNTRY_NAMES, coast_distance_km, exposure_prior, nearest_district
from models.registry import registry
from models.salinity_predictor import (
    CROP_EC_THRESHOLDS,
    crop_damage_probability,
    mitigation_actions,
    recommend_crops,
    salinity_class,
)
from services import live_data as live

logger = logging.getLogger(__name__)


def flood_risk_level(p72: float) -> str:
    """Same thresholds as the web's riskLevel(score = p72·100)."""
    s = p72 * 100
    if s >= 80:
        return "critical"
    if s >= 60:
        return "high"
    if s >= 35:
        return "medium"
    return "low"


def _round(v: float, n: int = 3) -> float:
    return float(round(float(v), n))


def _hourly_curve(hourly: list[tuple[str, float]], p: np.ndarray, currently_flooding: bool) -> list[dict]:
    """
    Cumulative probability that flooding has begun by each hour. Hazard increments
    between the 24/48/72 h model outputs are distributed within each day in
    proportion to forecast rain (50 %) and elapsed time (50 %).
    """
    if not hourly:
        return []
    p0 = float(p[0]) if currently_flooding else float(p[0]) * 0.3
    anchors = [p0, float(p[0]), float(p[1]), float(p[2])]
    out = []
    for day in range(3):
        block = hourly[day * 24 : (day + 1) * 24]
        if not block:
            break
        rain = np.array([r for _, r in block])
        cum_r = np.cumsum(rain) / rain.sum() if rain.sum() > 0 else np.linspace(1 / len(block), 1, len(block))
        cum_t = np.arange(1, len(block) + 1) / 24.0
        w = 0.5 * cum_r + 0.5 * cum_t
        lo, hi = anchors[day], max(anchors[day + 1], anchors[day])
        for (t, r), wi in zip(block, w):
            out.append({"time": t, "precip_mm": _round(r, 2), "probability": _round(lo + (hi - lo) * wi, 3)})
    return out


# ─── Flood ─────────────────────────────────────────────────────────────────


async def predict_flood(lat: float, lon: float, forecast_days: int = 3) -> dict:
    site_id, site_dist = live.resolve_site(lat, lon)
    near, near_km = nearest_district(lat, lon)
    model = registry.flood
    site_stats = None
    if model is not None:
        site_stats = model.site_stats.get(site_id) if site_id else None

    fc, elev, disch, tides = await asyncio.gather(
        live.get_forecast(lat, lon),
        live.get_elevation(lat, lon),
        live.get_discharge(lat, lon, site_id, site_stats),
        live.get_tides(lat, lon, site_id),
    )
    degraded: list[str] = []
    sources = []
    if fc is None:
        degraded.append("forecast")
    else:
        sources.append("Open-Meteo Forecast (rain, soil moisture)")
    if disch.get("series") is None:
        degraded.append("river_discharge")
    else:
        sources.append(f"Copernicus GloFAS v4 via Open-Meteo Flood API ({disch['source']})")
    if elev is None:
        degraded.append("elevation")
    if tides is None:
        degraded.append("sea_level")
    else:
        sources.append("Open-Meteo Marine sea level")

    coast_km = coast_distance_km(lat, lon)
    flood_prior, _, prior_src = exposure_prior(lat, lon, coast_km)
    hourly = live.hourly_next_72h(fc) if fc else []

    if model is None or fc is None:
        return await _flood_formula(lat, lon, fc, hourly, elev, coast_km, disch, flood_prior, tides, degraded, sources)

    daily, today = live.forecast_daily_frame(fc)
    # Discharge climatology: known site → training stats; otherwise cell climatology,
    # with the rainfall extreme borrowed from the nearest district (same climate zone).
    stats: Optional[SiteStats] = disch.get("stats")
    near_stats = model.site_stats.get(near.id)
    if stats is None:
        q = disch.get("series")
        if q is not None and q.notna().sum() > 30:
            stats = compute_site_stats(pd.DataFrame({"discharge_m3s": q, "precip_mm": daily["precip_mm"].reindex(q.index).fillna(0)}))
            degraded.append("discharge_climatology_short")
        else:
            stats = SiteStats(**near_stats)
    if not np.isfinite(stats.rain3_p99):
        stats = SiteStats(**{**stats.to_dict(), "rain3_p99": near_stats["rain3_p99"]})

    q = disch.get("series")
    daily["discharge_m3s"] = q.reindex(daily.index) if q is not None else np.nan
    static = {"elevation_m": elev if elev is not None else (model.site_static.get(near.id, {}).get("elevation_m") or 5.0),
              "coast_km": coast_km, "flood_prior": flood_prior, "lat": lat}
    frame = build_flood_frame(daily, stats, static)
    if today not in frame.index:
        today = frame.index[min(len(frame) - 4, len(frame) - 1)]
    row = frame.loc[[today]].copy()
    row["_inv_p99"] = 1.0 / stats.rain3_p99

    res = await asyncio.to_thread(model.predict_with_uncertainty, row, 40, int(abs(lat * 1000 + lon * 7)) % 10_000)
    p = res["p"]
    registry.record_live_score(float(p[2]))
    contrib = await asyncio.to_thread(model.attribute, row, 5)
    factors = [name for name, c in contrib if c >= 0.02]
    if tides and tides.get("spring_tide") and (coast_km or 999) < 30 and p[2] >= 0.3:
        factors.append("spring_tide")
    if not factors:
        factors = ["seasonal_baseline"]

    r = row.iloc[0]
    return {
        "probability_24h": _round(p[0]),
        "probability_48h": _round(p[1]),
        "probability_72h": _round(p[2]),
        "estimated_depth_m": _round(res["depth_m"], 2),
        "confidence_interval": [_round(res["p72_ci"][0]), _round(res["p72_ci"][1])],
        "contributing_factors": factors[:5],
        "risk_level": flood_risk_level(float(p[2])),
        "model_version": f"flood-ens-{model.version}",
        "hourly": _hourly_curve(hourly, p, bool(r["above_p95_now"] > 0)),
        # diagnostics (additive, ignored by the web contract)
        "factor_contributions": {n: _round(c, 3) for n, c in contrib},
        "features": {
            "rain_next_24h_mm": _round(r["rain_f24"], 1),
            "rain_next_72h_mm": _round(r["rain_f72"], 1),
            "rain_past_7d_mm": _round(r["rain_7d"], 1),
            "soil_moisture": _round(r["sm_now"], 3),
            "discharge_ratio_p95": _round(r["q_ratio_p95"], 3),
            "elevation_m": _round(static["elevation_m"], 1),
            "coast_distance_km": _round(coast_km or 0, 1),
            "flood_exposure_prior": _round(flood_prior, 2),
        },
        "site": {"matched_district": site_id, "nearest_district": near.id, "distance_km": _round(near_km, 1), "prior": prior_src},
        "data_sources": sources,
        "degraded_inputs": degraded,
        "engine": "ml",
    }


async def _flood_formula(lat, lon, fc, hourly, elev, coast_km, disch, flood_prior, tides, degraded, sources) -> dict:
    """Formula path (models not ready / forecast down) — mirrors the web scoreFlood() so ranges stay consistent."""
    rain = [0.0, 0.0, 0.0]
    soil = 0.3
    if hourly:
        pr = [r for _, r in hourly]
        rain = [sum(pr[:24]), sum(pr[:48]), sum(pr[:72])]
    if fc:
        daily, today = live.forecast_daily_frame(fc)
        if today in daily.index and not math.isnan(daily.loc[today, "soil_moisture"]):
            soil = float(daily.loc[today, "soil_moisture"])
    ratio = None
    q = disch.get("series")
    if q is not None and q.notna().sum() > 10:
        v = q.dropna()
        base = v.iloc[:-7].mean() if len(v) > 14 else v.mean()
        ratio = float(v.iloc[-7:].max() / base) if base > 0 else None

    sig = lambda x: 1 / (1 + math.exp(-x))  # noqa: E731
    rain_f = lambda mm, pivot: sig((mm - pivot) / (pivot * 0.45))  # noqa: E731
    soil_f = min(1, max(0, (soil - 0.15) / 0.3))
    dis_f = min(1, max(0, ((ratio or 1) - 0.8) / 1.2))
    elev_f = 0.5 if elev is None else min(1, max(0, 1 - elev / 15))
    static_f = 0.7 * flood_prior + 0.3 * elev_f
    comb = lambda rr: min(1, max(0, 0.34 * static_f + 0.3 * rr + 0.14 * soil_f + 0.22 * dis_f))  # noqa: E731
    p24 = comb(rain_f(rain[0], 45))
    p48 = max(p24, comb(rain_f(rain[1], 70)))
    p72 = max(p48, comb(rain_f(rain[2], 90)))
    factors = []
    if rain[2] > 80:
        factors.append("above_avg_rainfall_72h")
    if soil_f > 0.6:
        factors.append("high_soil_saturation")
    if (ratio or 1) > 1.4:
        factors.append("river_discharge_above_normal")
    if flood_prior > 0.7:
        factors.append("low_lying_floodplain")
    if elev_f > 0.7:
        factors.append("low_elevation")
    p = np.array([p24, p48, p72])
    return {
        "probability_24h": _round(p24),
        "probability_48h": _round(p48),
        "probability_72h": _round(p72),
        "estimated_depth_m": _round(max(0, (p72 - 0.35) * 1.6 + rain[2] / 1000 * elev_f), 2),
        "confidence_interval": [_round(max(0, p72 - 0.15)), _round(min(1, p72 + 0.1))],
        "contributing_factors": factors or ["seasonal_baseline"],
        "risk_level": flood_risk_level(p72),
        "model_version": "formula-v1.2.0",
        "hourly": _hourly_curve(hourly, p, False),
        "data_sources": sources,
        "degraded_inputs": degraded + (["model_warming_up"] if registry.flood is None else []),
        "engine": "formula",
    }


# ─── Salinity ──────────────────────────────────────────────────────────────


def _horizon_key(days: int) -> int:
    return min((7, 30, 90), key=lambda h: abs(h - days))


async def predict_salinity(lat: float, lon: float, crop: str, horizon_days: int = 30) -> dict:
    site_id, _ = live.resolve_site(lat, lon)
    near, near_km = nearest_district(lat, lon)
    model = registry.salinity
    site_stats = model.site_stats.get(site_id) if (model is not None and site_id) else None

    fc, elev, disch, tides, clay = await asyncio.gather(
        live.get_forecast(lat, lon),
        live.get_elevation(lat, lon),
        live.get_discharge(lat, lon, site_id, site_stats),
        live.get_tides(lat, lon, site_id),
        live.get_clay(lat, lon, site_id),
    )
    degraded = [n for n, v in (("forecast", fc), ("elevation", elev), ("sea_level", tides), ("soil_clay", clay)) if v is None]
    if disch.get("series") is None:
        degraded.append("river_discharge")
    coast_km = coast_distance_km(lat, lon)
    _, sal_prior, prior_src = exposure_prior(lat, lon, coast_km)
    country = near.country
    coastal = (coast_km or 999) < 60
    h = _horizon_key(horizon_days)

    if model is None or fc is None:
        return _salinity_formula(lat, crop, fc, tides, sal_prior, country, coastal, h, degraded)

    daily, today = live.forecast_daily_frame(fc)
    stats: Optional[SiteStats] = disch.get("stats") or SiteStats(**model.site_stats[near.id])
    q = disch.get("series")
    daily["discharge_m3s"] = q.reindex(daily.index) if q is not None else np.nan
    daily = daily[daily.index <= today]
    static = {
        "coast_km": coast_km, "elevation_m": elev, "salinity_prior": sal_prior, "clay_pct": clay,
        "tidal_range_m": (tides or {}).get("tidal_range_m"), "lat": lat,
    }
    frame = build_salinity_frame(daily, stats, static)
    row = frame.iloc[[-1]]
    preds = await asyncio.to_thread(model.predict, row)
    ec = {k: float(v[0]) for k, v in preds.items()}
    ec_h = ec[h]
    cls = salinity_class(ec_h)
    sigma = model.log_sigma.get(h, 0.25) + 0.05 * len(degraded)
    conf = model.class_precision.get(cls, 0.7) * (1 - 0.06 * len(degraded))
    rain30 = float(row["rain_30d"].iloc[0])
    return {
        "ec_current": _round(ec[0], 2),
        "ec_predicted_7d": _round(ec[7], 2),
        "ec_predicted_30d": _round(ec[30], 2),
        "risk_level": cls,
        "crop_damage_probability": crop_damage_probability(crop, ec_h, sigma),
        "recommended_crops": recommend_crops(ec_h, crop, country),
        "mitigation_actions": mitigation_actions(ec[0], ec_h, rain30, coastal, crop),
        "confidence": _round(min(0.95, max(0.35, conf)), 2),
        "model_version": f"salinity-hgb-{model.version}",
        # diagnostics
        "ec_predicted_90d": _round(ec[90], 2),
        "horizon_days": h,
        "crop_thresholds": CROP_EC_THRESHOLDS.get(crop, CROP_EC_THRESHOLDS["rice"]),
        "features": {
            "coast_distance_km": _round(coast_km or 0, 1),
            "rain_30d_mm": _round(rain30, 1),
            "rain_90d_mm": _round(row["rain_90d"].iloc[0], 1),
            "discharge_30d_ratio": _round(row["q30_ratio"].iloc[0], 3),
            "tidal_range_m": (tides or {}).get("tidal_range_m"),
            "spring_neap_index": _round(row["spring_index"].iloc[0], 2),
            "clay_pct": clay,
            "salinity_exposure_prior": _round(sal_prior, 2),
        },
        "site": {"matched_district": site_id, "nearest_district": near.id, "distance_km": _round(near_km, 1), "prior": prior_src, "country": COUNTRY_NAMES.get(country, country)},
        "degraded_inputs": degraded,
        "engine": "ml",
    }


def _salinity_formula(lat, crop, fc, tides, sal_prior, country, coastal, h, degraded) -> dict:
    """Mirror of the web scoreSalinity() for the warm-up window."""
    from datetime import date

    month = date.today().month
    m = ((month + 5) % 12) + 1 if lat < 0 else month
    season = [0.75, 0.9, 1.0, 1.0, 0.9, 0.6, 0.45, 0.4, 0.42, 0.5, 0.6, 0.7][m - 1]
    rain30 = 150.0
    if fc:
        daily, today = live.forecast_daily_frame(fc)
        rain30 = float(daily[daily.index <= today]["precip_mm"].tail(30).sum())
    dilution = min(1, max(0, rain30 / 400))
    tide = 0 if not tides or tides.get("max_high_water_72h_m") is None else min(1, max(0, (tides["max_high_water_72h_m"] + 0.5) / 2))
    ec = 0.4 + sal_prior * 9 * season * (1 - 0.45 * dilution) * (1 + 0.25 * tide)
    ec30 = ec * (1 + 0.35 * (0.3 if season < 0.6 else 1) * sal_prior)
    ec7 = ec + (ec30 - ec) * 0.3
    ec_h = {7: ec7, 30: ec30, 90: ec30}[h]
    return {
        "ec_current": _round(ec, 2),
        "ec_predicted_7d": _round(ec7, 2),
        "ec_predicted_30d": _round(ec30, 2),
        "risk_level": salinity_class(ec_h),
        "crop_damage_probability": crop_damage_probability(crop, ec_h, 0.35),
        "recommended_crops": recommend_crops(ec_h, crop, country),
        "mitigation_actions": mitigation_actions(ec, ec_h, rain30, coastal, crop),
        "confidence": 0.62,
        "model_version": "formula-v1.2.0",
        "degraded_inputs": degraded + (["model_warming_up"] if registry.salinity is None else []),
        "engine": "formula",
    }
