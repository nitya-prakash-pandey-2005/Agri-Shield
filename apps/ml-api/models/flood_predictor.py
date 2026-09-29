"""
Flood Risk Predictor — Agri-SHIELD
==================================
Ensemble of two learners trained on 22 districts × 7 years of real ERA5 reanalysis
and GloFAS v4 river discharge (see ``core/features.py`` for labels):

1. **temporal-MLP** — a multilabel feed-forward network (scikit-learn
   ``MLPClassifier``) over the 10-day sequence (7 past days of rainfall, soil
   moisture and discharge anomaly + 3 forecast days of rainfall) and site statics.
   It is a sequence model by input design, not a recurrent LSTM.
2. **HistGradientBoosting** — one classifier per horizon (24/48/72 h) on
   aggregate/static features (rolling rain sums, discharge ratios, elevation,
   coast distance, flood history, season).

Both learners are bootstrap ensembles (block bootstrap over site-months). The
blend weight per horizon is chosen on the 2023 validation year by log-loss.
Uncertainty is Monte Carlo: forecast rainfall is perturbed log-normally
(σ = 0.35, a typical 1–3 day QPF error) and members are sampled, giving a
predictive distribution for the 72 h probability → 90 % interval.

A HistGradientBoosting regression head predicts a physically-derived flood
depth proxy (Manning overbank stage + pluvial ponding) for the next 72 h.

Rows in training use *observed* next-3-day rainfall as a stand-in for the
forecast (perfect-prognosis), with the same log-normal perturbation applied,
so the model is trained on realistic forecast noise.
"""
from __future__ import annotations

import logging
import time
import warnings
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.exceptions import ConvergenceWarning
from sklearn.metrics import brier_score_loss, f1_score, log_loss, mean_squared_error, r2_score, roc_auc_score
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from core.features import (
    FLOOD_FACTOR_GROUPS,
    FLOOD_GBM_FEATURES,
    FORECAST_DAYS,
    SEQ_FEATURES,
    SiteStats,
)

logger = logging.getLogger(__name__)

HORIZONS = ("y1", "y2", "y3")
HORIZON_HOURS = {"y1": 24, "y2": 48, "y3": 72}
QPF_SIGMA = 0.35


def perturb_forecast(X: pd.DataFrame, rng: np.random.Generator, sigma: float = QPF_SIGMA) -> pd.DataFrame:
    """Apply multiplicative log-normal error to every forecast-rain column consistently."""
    X = X.copy()
    fut = np.column_stack([np.expm1(X[f"seq_rainf_{k}"].to_numpy(dtype=float)) for k in range(FORECAST_DAYS)])
    ratio = np.where(X["rain_f72"].to_numpy() > 0, X["rain_f72_vs_p99"].to_numpy() / np.maximum(X["rain_f72"].to_numpy(), 1e-9), np.nan)
    mult = np.exp(rng.normal(-0.5 * sigma**2, sigma, fut.shape))
    fut = np.clip(fut * mult, 0, None)
    for k in range(FORECAST_DAYS):
        X[f"seq_rainf_{k}"] = np.log1p(fut[:, k])
    X["rain_f24"] = fut[:, 0]
    X["rain_f48"] = fut[:, 0] + fut[:, 1]
    X["rain_f72"] = fut.sum(axis=1)
    fallback = X.get("_inv_p99")
    if fallback is not None:
        ratio = np.where(np.isnan(ratio), fallback.to_numpy(), ratio)
    X["rain_f72_vs_p99"] = X["rain_f72"].to_numpy() * np.nan_to_num(ratio, nan=1 / 150.0)
    return X


def _block_bootstrap(sites: np.ndarray, months: np.ndarray, rng: np.random.Generator, frac: float = 1.0) -> np.ndarray:
    """Resample (site, month) blocks with replacement — preserves temporal autocorrelation.
    ``frac`` < 1 draws a smaller bag (sub-bagging) to keep training fast."""
    keys = pd.factorize(pd.Series(sites).astype(str) + "|" + pd.Series(months).astype(str))[0]
    n_blocks = keys.max() + 1
    chosen = rng.integers(0, n_blocks, max(1, int(n_blocks * frac)))
    counts = np.bincount(chosen, minlength=n_blocks)
    return np.repeat(np.arange(len(keys)), counts[keys])


def _psi(expected: np.ndarray, actual: np.ndarray, bins: int = 10) -> float:
    """Population Stability Index between two score distributions."""
    edges = np.unique(np.quantile(expected, np.linspace(0, 1, bins + 1)))
    if len(edges) < 3:
        return 0.0
    e = np.histogram(np.clip(expected, edges[0], edges[-1]), edges)[0] / len(expected)
    a = np.histogram(np.clip(actual, edges[0], edges[-1]), edges)[0] / max(len(actual), 1)
    e, a = np.clip(e, 1e-4, None), np.clip(a, 1e-4, None)
    return float(np.sum((a - e) * np.log(a / e)))


@dataclass
class FloodModel:
    version: str
    mlp_members: list = field(default_factory=list)
    gbm_members: dict = field(default_factory=dict)  # horizon -> [clf]
    depth_head: Optional[HistGradientBoostingRegressor] = None
    weights: dict = field(default_factory=dict)  # horizon -> weight of MLP
    site_stats: dict = field(default_factory=dict)  # site -> SiteStats dict
    site_static: dict = field(default_factory=dict)
    feature_medians: dict = field(default_factory=dict)
    reference_scores: Optional[np.ndarray] = None  # test-period p72 distribution for drift
    metrics: dict = field(default_factory=dict)
    trained_at: str = ""

    # ── inference ──────────────────────────────────────────────────────────

    def _mlp_proba(self, X: pd.DataFrame, member: int | None = None) -> np.ndarray:
        """(n, 3) multilabel probabilities from one or all MLP members."""
        Z = X[SEQ_FEATURES].to_numpy(dtype=float)
        mems = self.mlp_members if member is None else [self.mlp_members[member]]
        out = np.mean([np.column_stack([p[:, 1] for p in _as_list(m.predict_proba(Z))]) for m in mems], axis=0)
        return out

    def _gbm_proba(self, X: pd.DataFrame, member: int | None = None) -> np.ndarray:
        Z = X[FLOOD_GBM_FEATURES].to_numpy(dtype=float)
        cols = []
        for h in HORIZONS:
            mems = self.gbm_members[h] if member is None else [self.gbm_members[h][member % len(self.gbm_members[h])]]
            cols.append(np.mean([m.predict_proba(Z)[:, 1] for m in mems], axis=0))
        return np.column_stack(cols)

    def blend(self, p_mlp: np.ndarray, p_gbm: np.ndarray) -> np.ndarray:
        w = np.array([self.weights.get(h, 0.5) for h in HORIZONS])
        p = w * p_mlp + (1 - w) * p_gbm
        # Longer windows can only accumulate risk.
        return np.maximum.accumulate(np.clip(p, 0.01, 0.99), axis=1)

    def predict_proba(self, X: pd.DataFrame) -> np.ndarray:
        """Point estimate (n, 3) for 24/48/72 h."""
        return self.blend(self._mlp_proba(X), self._gbm_proba(X))

    def predict_depth(self, X: pd.DataFrame) -> np.ndarray:
        return np.clip(self.depth_head.predict(X[FLOOD_GBM_FEATURES].to_numpy(dtype=float)), 0.0, 3.0)

    def predict_with_uncertainty(self, X1: pd.DataFrame, n_mc: int = 40, seed: int = 0) -> dict:
        """Monte Carlo over forecast-rain error × ensemble members for a single row."""
        rng = np.random.default_rng(seed)
        point = self.predict_proba(X1)[0]
        Xs = pd.concat([X1] * n_mc, ignore_index=True)
        Xs = perturb_forecast(Xs, rng)
        n_m, n_g = len(self.mlp_members), max(len(v) for v in self.gbm_members.values())
        pm = np.stack([self._mlp_proba(Xs, i) for i in range(n_m)])  # (n_m, n_mc, 3)
        pg = np.stack([self._gbm_proba(Xs, j) for j in range(n_g)])  # (n_g, n_mc, 3)
        draws = self.blend(pm[rng.integers(0, n_m, n_mc), np.arange(n_mc)], pg[rng.integers(0, n_g, n_mc), np.arange(n_mc)])
        lo, hi = np.quantile(draws[:, 2], [0.05, 0.95])
        # Floor the interval width at the typical held-out calibration error (~±0.02–0.03)
        lo, hi = max(0.0, min(lo, point[2] - 0.02)), min(1.0, max(hi, point[2] + 0.03))
        depth = float(self.predict_depth(X1)[0])
        return {
            "p": point,
            "p72_ci": (float(min(lo, point[2])), float(max(hi, point[2]))),
            "p72_std": float(draws[:, 2].std()),
            "depth_m": depth,
        }

    def attribute(self, X1: pd.DataFrame, top: int = 4) -> list[tuple[str, float]]:
        """Occlusion attribution on the 72 h GBM: contribution of each feature group vs. climatological medians."""
        base = float(self._gbm_proba(X1)[0, 2])
        rows = []
        for name, cols in FLOOD_FACTOR_GROUPS.items():
            Xo = X1.copy()
            for c in cols:
                Xo[c] = self.feature_medians.get(c, Xo[c].iloc[0])
            rows.append(Xo)
        occl = self._gbm_proba(pd.concat(rows, ignore_index=True))[:, 2]
        contrib = [(name, base - float(o)) for name, o in zip(FLOOD_FACTOR_GROUPS, occl)]
        contrib.sort(key=lambda t: -t[1])
        return contrib[:top]

    def to_metrics_row(self) -> dict:
        m = self.metrics
        return {
            "name": "flood-ensemble (temporal-MLP + HistGBM)",
            "version": self.version,
            "auc": m.get("test", {}).get("y3", {}).get("auc"),
            "f1": m.get("test", {}).get("y3", {}).get("f1"),
            "brier": m.get("test", {}).get("y3", {}).get("brier"),
            "rmse": m.get("depth", {}).get("rmse"),
            "r2": m.get("depth", {}).get("r2"),
            "trained_at": self.trained_at,
            "drift_psi": m.get("drift_psi"),
            "samples": m.get("samples", {}).get("total"),
        }


def _as_list(p):
    return p if isinstance(p, list) else [np.column_stack([1 - p[:, k], p[:, k]]) for k in range(p.shape[1])]


def _cls_metrics(y: np.ndarray, p: np.ndarray) -> dict:
    out = {"brier": round(float(brier_score_loss(y, p)), 4), "f1": round(float(f1_score(y, p >= 0.5, zero_division=0)), 4), "positive_rate": round(float(y.mean()), 4)}
    out["auc"] = round(float(roc_auc_score(y, p)), 4) if 0 < y.sum() < len(y) else None
    return out


def train_flood_model(data, version: str, n_gbm: int = 3, n_mlp: int = 2, seed: int = 42) -> FloodModel:
    """Train, tune blend weights on validation, evaluate on the held-out test years."""
    t0 = time.time()
    rng = np.random.default_rng(seed)
    X, y = data.X.copy(), data.y
    inv = {sid: 1.0 / st.rain3_p99 for sid, st in data.stats.items()}
    X["_inv_p99"] = X["site"].map(inv)
    X = perturb_forecast(X, rng)  # realistic forecast error on every split
    tr, va, te = (X["split"] == s for s in ("train", "val", "test"))
    months = X["date"].dt.to_period("M").astype(str).to_numpy()
    sites = X["site"].to_numpy()
    Ytr = y.loc[tr, list(HORIZONS)].to_numpy(dtype=int)

    model = FloodModel(version=version)
    # ── HistGradientBoosting members per horizon
    Zg = X[FLOOD_GBM_FEATURES].to_numpy(dtype=float)
    tr_idx = np.flatnonzero(tr)
    for h_i, h in enumerate(HORIZONS):
        model.gbm_members[h] = []
        for j in range(n_gbm):
            b = tr_idx[_block_bootstrap(sites[tr_idx], months[tr_idx], rng, frac=0.6)] if j else tr_idx
            clf = HistGradientBoostingClassifier(
                max_iter=180, learning_rate=0.08, max_leaf_nodes=31, min_samples_leaf=40,
                l2_regularization=1.0, random_state=seed + 10 * h_i + j,
            )
            clf.fit(Zg[b], Ytr[np.searchsorted(tr_idx, b), h_i])
            model.gbm_members[h].append(clf)
    t_gbm = time.time() - t0

    # ── temporal-MLP members (multilabel)
    Zs = X[SEQ_FEATURES].to_numpy(dtype=float)
    for j in range(n_mlp):
        b = tr_idx[_block_bootstrap(sites[tr_idx], months[tr_idx], rng, frac=0.7)] if j else tr_idx
        mlp = make_pipeline(
            StandardScaler(),
            MLPClassifier(
                hidden_layer_sizes=(64, 32), alpha=1e-3, batch_size=512, learning_rate_init=2e-3,
                max_iter=35, early_stopping=True, validation_fraction=0.1, n_iter_no_change=5,
                random_state=seed + 100 + j,
            ),
        )
        with warnings.catch_warnings():  # capped epochs by design (early stopping / time budget)
            warnings.simplefilter("ignore", ConvergenceWarning)
            mlp.fit(Zs[b], Ytr[np.searchsorted(tr_idx, b)])
        model.mlp_members.append(mlp)
    t_mlp = time.time() - t0 - t_gbm

    # ── Blend weights on validation (log-loss grid search)
    pm_va, pg_va = model._mlp_proba(X[va]), model._gbm_proba(X[va])
    for h_i, h in enumerate(HORIZONS):
        yv = y.loc[va, h].to_numpy(dtype=int)
        best = min(
            (log_loss(yv, np.clip(w * pm_va[:, h_i] + (1 - w) * pg_va[:, h_i], 1e-4, 1 - 1e-4), labels=[0, 1]), w)
            for w in np.linspace(0, 1, 11)
        )
        model.weights[h] = round(float(best[1]), 2)

    # ── Depth regression head
    depth = HistGradientBoostingRegressor(max_iter=180, learning_rate=0.08, max_leaf_nodes=31, min_samples_leaf=40, random_state=seed)
    depth.fit(Zg[tr_idx], y.loc[tr, "depth3"].to_numpy(dtype=float))
    model.depth_head = depth

    # ── Held-out test evaluation (2024–2025)
    metrics: dict = {"test": {}, "val": {}, "components_test": {}, "baselines_test": {}}
    p_te = model.predict_proba(X[te])
    pm_te, pg_te = model._mlp_proba(X[te]), model._gbm_proba(X[te])
    p_va = model.predict_proba(X[va])
    persistence = X.loc[te, "above_p95_now"].to_numpy()
    for h_i, h in enumerate(HORIZONS):
        yt = y.loc[te, h].to_numpy(dtype=int)
        metrics["test"][h] = _cls_metrics(yt, p_te[:, h_i])
        metrics["val"][h] = _cls_metrics(y.loc[va, h].to_numpy(dtype=int), p_va[:, h_i])
        metrics["components_test"][h] = {
            "temporal_mlp_auc": round(float(roc_auc_score(yt, pm_te[:, h_i])), 4),
            "hist_gbm_auc": round(float(roc_auc_score(yt, pg_te[:, h_i])), 4),
        }
        metrics["baselines_test"][h] = {"persistence_auc": round(float(roc_auc_score(yt, persistence)), 4)}
    # Onset skill: days not currently in flood (the hard, decision-relevant case)
    onset = te & (y["event_now"] == 0)
    yo = y.loc[onset, "y3"].to_numpy(dtype=int)
    po = model.predict_proba(X[onset])[:, 2]
    metrics["onset_test_y3"] = _cls_metrics(yo, po)
    d_true = y.loc[te, "depth3"].to_numpy(dtype=float)
    d_pred = model.predict_depth(X[te])
    metrics["depth"] = {
        "rmse": round(float(np.sqrt(mean_squared_error(d_true, d_pred))), 4),
        "r2": round(float(r2_score(d_true, d_pred)), 4),
    }
    p_tr = model.predict_proba(X[tr].sample(min(int(tr.sum()), 8000), random_state=seed))[:, 2]
    metrics["drift_psi"] = round(_psi(p_tr, p_te[:, 2]), 4)
    metrics["weights_mlp"] = model.weights
    metrics["samples"] = {"train": int(tr.sum()), "val": int(va.sum()), "test": int(te.sum()), "total": int(len(X))}
    metrics["split"] = {"train": "2019-01-01..2022-12-31", "val": "2023", "test": "2024-01-01..2025-12-31"}
    metrics["train_seconds"] = {"gbm": round(t_gbm, 1), "mlp": round(t_mlp, 1), "total": round(time.time() - t0, 1)}

    model.metrics = metrics
    model.reference_scores = p_te[:, 2].astype(np.float32)
    model.site_stats = {k: v.to_dict() for k, v in data.stats.items()}
    model.site_static = data.static
    model.feature_medians = {c: float(X.loc[tr, c].median()) for c in FLOOD_GBM_FEATURES}
    model.trained_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    logger.info(
        "flood model %s trained in %.1fs — test AUC72=%.3f F1=%.3f Brier=%.4f (onset AUC=%s)",
        version, time.time() - t0, metrics["test"]["y3"]["auc"], metrics["test"]["y3"]["f1"],
        metrics["test"]["y3"]["brier"], metrics["onset_test_y3"]["auc"],
    )
    return model


def site_stats_from_dict(d: dict) -> SiteStats:
    return SiteStats(**d)
