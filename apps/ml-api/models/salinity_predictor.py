"""
Salinity Intrusion Predictor — Agri-SHIELD
==========================================
HistGradientBoosting regressors (one per horizon: now, +7, +30, +90 days) that
predict root-zone soil salinity (ECe, dS/m) from observable drivers:

- distance to coast (Natural Earth), elevation, district exposure prior
- SoilGrids clay content, tidal range at the nearest sea cell (Marine API)
- 30/90-day ERA5 rainfall, 30-day ET0 and water deficit
- GloFAS 30-day discharge ratio and trend (upstream freshwater push-back)
- astronomical spring–neap index today and in 7 days, season

Targets are log-transformed (salinity errors are multiplicative). The training
target is semi-synthetic but driven by real observations — see
``scripts/train-models/build_dataset.py`` for the full, honest description.

Also provides the FAO/Maas–Hoffman style crop damage curve and crop/mitigation
recommendations used by the API.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

from core.features import SAL_FEATURES, SAL_HORIZONS

logger = logging.getLogger(__name__)

# EC tolerance thresholds (dS/m) — FAO data, mirrored from packages/types CROP_EC_THRESHOLDS
CROP_EC_THRESHOLDS: dict[str, dict[str, float]] = {
    "rice": {"sensitive": 3.0, "moderate": 6.0, "tolerant": 10.0},
    "wheat": {"sensitive": 6.0, "moderate": 9.0, "tolerant": 13.0},
    "sugarcane": {"sensitive": 1.7, "moderate": 3.4, "tolerant": 7.0},
    "coconut": {"sensitive": 5.0, "moderate": 8.0, "tolerant": 12.0},
    "maize": {"sensitive": 1.8, "moderate": 3.6, "tolerant": 5.0},
    "jute": {"sensitive": 2.0, "moderate": 4.0, "tolerant": 8.0},
    "vegetables": {"sensitive": 1.5, "moderate": 3.0, "tolerant": 5.0},
    "sorghum": {"sensitive": 4.0, "moderate": 7.0, "tolerant": 11.0},
    "barley": {"sensitive": 8.0, "moderate": 12.0, "tolerant": 18.0},
    "potato": {"sensitive": 1.7, "moderate": 3.4, "tolerant": 5.9},
    "onion": {"sensitive": 1.2, "moderate": 2.4, "tolerant": 4.0},
    "cotton": {"sensitive": 7.7, "moderate": 12.0, "tolerant": 17.0},
    "tobacco": {"sensitive": 1.5, "moderate": 3.0, "tolerant": 6.0},
    "banana": {"sensitive": 1.0, "moderate": 2.0, "tolerant": 4.5},
    "mango": {"sensitive": 1.5, "moderate": 3.0, "tolerant": 5.5},
}
CROP_TYPES = tuple(CROP_EC_THRESHOLDS)

# Display names for salt-tolerant options recommended in place of a sensitive crop
SALT_TOLERANT_RICE = {
    "BD": "salt-tolerant rice (BRRI dhan 67 / BINA dhan 10)",
    "VN": "salt-tolerant rice (OM-series, e.g. OM5451)",
    "IN": "salt-tolerant rice (CSR / Luna series, ICAR-NRRI)",
    "PH": "salt-tolerant rice (NSIC 'Salinas' lines)",
    "ID": "tidal-swamp rice (Inpara series)",
}


def salinity_class(ec: float) -> str:
    """Spec §5.2 classes: Safe (<2) / Sensitive (2–4) / Moderate (4–8) / Severe (>8) dS/m."""
    if ec < 2:
        return "safe"
    if ec < 4:
        return "sensitive"
    if ec < 8:
        return "moderate"
    return "severe"


def crop_damage_curve(crop: str, ec: np.ndarray | float) -> np.ndarray:
    """
    Probability of economically significant yield damage at root-zone EC.

    Piecewise curve consistent with the web fallback: rises slowly to 0.15 at the
    crop's sensitive threshold (Maas–Hoffman yield threshold), then linearly to
    0.97 at the tolerant limit.
    """
    t = CROP_EC_THRESHOLDS.get(crop, CROP_EC_THRESHOLDS["rice"])
    ec = np.asarray(ec, dtype=float)
    below = np.clip(ec, 0, None) / t["sensitive"] * 0.15
    mid = 0.15 + (ec - t["sensitive"]) / (t["tolerant"] - t["sensitive"]) * 0.82
    return np.where(ec <= t["sensitive"], below, np.where(ec >= t["tolerant"], 0.97, mid))


def crop_damage_probability(crop: str, ec_mean: float, log_sigma: float = 0.25, n: int = 4000, seed: int = 0) -> float:
    """Expected damage probability integrating over predictive EC uncertainty (log-normal)."""
    rng = np.random.default_rng(seed)
    z = rng.standard_normal(n)
    samples = ec_mean * np.exp(log_sigma * z - 0.5 * log_sigma**2)
    return float(np.round(np.mean(crop_damage_curve(crop, samples)), 3))


def recommend_crops(ec: float, current_crop: str, country: str = "BD", k: int = 4) -> list[str]:
    """
    Crops whose FAO yield threshold sits comfortably (≥ 0.5 dS/m) above the predicted EC.
    Low EC keeps the farmer's crop plus common delta alternatives; higher EC ranks by tolerance.
    """
    fits = lambda c: CROP_EC_THRESHOLDS[c]["sensitive"] - ec >= 0.5  # noqa: E731
    if ec < 2.0:
        common = ["rice", "vegetables", "jute", "maize", "potato", "onion", "sugarcane", "banana"]
        out = [current_crop] if current_crop in CROP_EC_THRESHOLDS and fits(current_crop) else []
        out += [c for c in common if c != current_crop and fits(c)]
        return out[:k]
    out: list[str] = [current_crop] if current_crop in CROP_EC_THRESHOLDS and fits(current_crop) else []
    if 3.0 <= ec <= 8.0 and current_crop in ("rice", "vegetables", "jute", "sugarcane", "maize"):
        out.append(SALT_TOLERANT_RICE.get(country, SALT_TOLERANT_RICE["BD"]))
    # closest adequate margin first (e.g. sorghum before barley at 3 dS/m), then the most tolerant as fallback
    out += sorted((c for c in CROP_EC_THRESHOLDS if c not in out and fits(c)), key=lambda c: CROP_EC_THRESHOLDS[c]["sensitive"])
    out += sorted((c for c in CROP_EC_THRESHOLDS if c not in out), key=lambda c: -CROP_EC_THRESHOLDS[c]["tolerant"])
    return out[:k]


def mitigation_actions(ec_now: float, ec_future: float, rain_30d: Optional[float], coastal: bool, crop: str) -> list[str]:
    """Prioritised snake_case mitigation actions (contract: string list)."""
    acts: list[str] = []
    t = CROP_EC_THRESHOLDS.get(crop, CROP_EC_THRESHOLDS["rice"])
    rising = ec_future > ec_now * 1.1
    if ec_future >= t["sensitive"] or ec_future >= 4:
        acts.append("freshwater_flush")
    if coastal and (ec_future >= 2 or rising):
        acts.append("close_sluice_gates_at_high_tide")
    if ec_future >= 4:
        acts.append("gypsum_application")
    if ec_future >= 2:
        acts.append("test_canal_water_ec_before_irrigating")
    if ec_future >= t["sensitive"] and crop == "rice":
        acts.append("switch_to_salt_tolerant_variety")
    if rain_30d is not None and rain_30d < 60 and ec_future >= 2:
        acts.append("store_rainwater_or_pond_water")
    if ec_future >= 2:
        acts.append("mulch_to_reduce_evaporation")
    if ec_future >= 8:
        acts.append("avoid_alternate_wetting_drying_keep_soil_moist")
    if rising and ec_future >= 3:
        acts.append("advance_harvest_before_peak_salinity")
    if not acts:
        acts.append("monitor_ec_weekly")
    return acts


@dataclass
class SalinityModel:
    version: str
    regressors: dict = field(default_factory=dict)  # horizon -> regressor (log1p target)
    log_sigma: dict = field(default_factory=dict)  # horizon -> residual std in log space
    class_precision: dict = field(default_factory=dict)  # predicted class -> P(true class == predicted), 30d
    site_stats: dict = field(default_factory=dict)
    site_static: dict = field(default_factory=dict)
    metrics: dict = field(default_factory=dict)
    trained_at: str = ""

    def predict(self, X: pd.DataFrame) -> dict[int, np.ndarray]:
        Z = X[SAL_FEATURES].to_numpy(dtype=float)
        return {h: np.clip(np.expm1(m.predict(Z)), 0.05, 60.0) for h, m in self.regressors.items()}

    def to_metrics_row(self) -> dict:
        m = self.metrics.get("test", {}).get("h30", {})
        return {
            "name": "salinity-histgbm (EC 0/7/30/90 d)",
            "version": self.version,
            "rmse": m.get("rmse"),
            "r2": m.get("r2"),
            "trained_at": self.trained_at,
            "drift_psi": self.metrics.get("drift_psi"),
            "samples": self.metrics.get("samples", {}).get("total"),
        }


def train_salinity_model(data, version: str, seed: int = 42) -> SalinityModel:
    t0 = time.time()
    X, Y = data.X, data.y
    model = SalinityModel(version=version)
    metrics: dict = {"test": {}, "val": {}}
    for h in SAL_HORIZONS:
        col = f"ec_h{h}"
        ok = Y[col].notna()
        tr = ok & (X["split"] == "train")
        va = ok & (X["split"] == "val")
        te = ok & (X["split"] == "test")
        reg = HistGradientBoostingRegressor(
            max_iter=220, learning_rate=0.08, max_leaf_nodes=31, min_samples_leaf=30,
            l2_regularization=0.5, random_state=seed + h,
        )
        reg.fit(X.loc[tr, SAL_FEATURES].to_numpy(dtype=float), np.log1p(Y.loc[tr, col].to_numpy(dtype=float)))
        model.regressors[h] = reg
        for name, mask in (("val", va), ("test", te)):
            if mask.sum() == 0:
                continue
            yt = Y.loc[mask, col].to_numpy(dtype=float)
            yp = np.expm1(reg.predict(X.loc[mask, SAL_FEATURES].to_numpy(dtype=float)))
            rel = np.abs(yp - yt) / np.maximum(yt, 0.5)
            metrics[name][f"h{h}"] = {
                "rmse": round(float(np.sqrt(mean_squared_error(yt, yp))), 4),
                "mae": round(float(mean_absolute_error(yt, yp)), 4),
                "r2": round(float(r2_score(yt, yp)), 4),
                "within_10pct": round(float(np.mean(rel <= 0.10)), 4),
                "within_20pct": round(float(np.mean(rel <= 0.20)), 4),
                "class_accuracy": round(float(np.mean([salinity_class(a) == salinity_class(b) for a, b in zip(yt, yp)])), 4),
                "n": int(mask.sum()),
            }
            if name == "val":
                model.log_sigma[h] = float(np.std(np.log1p(yp) - np.log1p(yt)))
            if name == "test" and h == 30:
                pc, tc = [salinity_class(v) for v in yp], [salinity_class(v) for v in yt]
                for cls in ("safe", "sensitive", "moderate", "severe"):
                    idx = [i for i, c in enumerate(pc) if c == cls]
                    if idx:
                        model.class_precision[cls] = round(float(np.mean([tc[i] == cls for i in idx])), 3)
                tr_pred = np.expm1(reg.predict(X.loc[tr, SAL_FEATURES].to_numpy(dtype=float)))
                from models.flood_predictor import _psi

                metrics["drift_psi"] = round(_psi(np.log1p(tr_pred), np.log1p(yp)), 4)
    metrics["samples"] = {
        "train": int((X["split"] == "train").sum()),
        "val": int((X["split"] == "val").sum()),
        "test": int((X["split"] == "test").sum()),
        "total": int(len(X)),
    }
    metrics["class_precision_30d"] = model.class_precision
    metrics["train_seconds"] = round(time.time() - t0, 1)
    model.metrics = metrics
    model.site_stats = {k: v.to_dict() for k, v in data.stats.items()}
    model.site_static = data.static
    model.trained_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    logger.info("salinity model %s trained in %.1fs — test RMSE30=%.3f R2=%.3f", version, time.time() - t0,
                metrics["test"].get("h30", {}).get("rmse", float("nan")), metrics["test"].get("h30", {}).get("r2", float("nan")))
    return model
