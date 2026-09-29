"""
Model Registry — Agri-SHIELD
============================
Owns the deployed flood and salinity models:

- loads ``model_weights/{flood,salinity}.joblib`` on startup;
- if they are missing, trains from the committed datasets in a background thread
  (the API serves formula-based predictions until the models are ready);
- persists real held-out metrics to ``model_weights/metrics.json`` (committed);
- implements the spec §6 MODEL_RETRAIN job: train a candidate (optionally on
  freshly appended Open-Meteo data), evaluate candidate *and* deployed model on
  the same held-out test set, promote only if the candidate is better, archive
  the previous version.
"""
from __future__ import annotations

import json
import logging
import shutil
import threading
import time
from collections import deque
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import mean_squared_error, roc_auc_score

from config import settings

logger = logging.getLogger(__name__)

APP_DIR = Path(__file__).resolve().parent.parent
SUPPLY_CHAIN_VERSION = "v1.2.0"
SUPPLY_CHAIN_CALIBRATED = "2026-09-29T00:00:00Z"


def weights_dir() -> Path:
    p = Path(settings.model_weights_dir)
    return p if p.is_absolute() else (APP_DIR / p).resolve()


def _bump(version: Optional[str], default: str) -> str:
    """v2.1.0 → v2.2.0"""
    if not version:
        return default
    try:
        major, minor, _ = version.lstrip("v").split(".")[:3]
        return f"v{major}.{int(minor) + 1}.0"
    except Exception:
        return default


class ModelRegistry:
    def __init__(self) -> None:
        self.flood = None
        self.salinity = None
        self.status = "initialising"
        self.error: Optional[str] = None
        self.started = time.monotonic()
        self._train_lock = threading.Lock()
        self.live_scores: deque = deque(maxlen=2000)
        self.last_retrain: Optional[dict] = None

    # ── lifecycle ──────────────────────────────────────────────────────────

    @property
    def ready(self) -> bool:
        return self.flood is not None and self.salinity is not None

    def models_loaded(self) -> list[str]:
        return [n for n, m in (("flood", self.flood), ("salinity", self.salinity)) if m is not None] + ["supply-chain-mc"]

    def load(self) -> bool:
        wd = weights_dir()
        try:
            f, s = wd / "flood.joblib", wd / "salinity.joblib"
            if f.exists() and s.exists():
                self.flood = joblib.load(f)
                self.salinity = joblib.load(s)
                self.status = "ready"
                logger.info("Loaded models flood=%s salinity=%s from %s", self.flood.version, self.salinity.version, wd)
                return True
        except Exception as e:  # incompatible pickle (e.g. sklearn upgrade) → retrain
            logger.warning("Could not load model weights (%s) — will retrain", e)
        self.status = "fallback"
        return False

    def start_background_training(self) -> bool:
        from models.data import datasets_available

        if not datasets_available():
            self.status = "fallback"
            self.error = "datasets missing — run scripts/train-models/build_dataset.py"
            logger.warning(self.error)
            return False
        t = threading.Thread(target=self._train_and_deploy, name="model-training", daemon=True)
        t.start()
        return True

    def _train_and_deploy(self) -> None:
        with self._train_lock:
            self.status = "training"
            try:
                flood, sal = self.train_candidates()
                self._save(flood, sal)
                self.flood, self.salinity = flood, sal
                self.status = "ready"
                self.error = None
            except Exception as e:
                logger.exception("Background training failed")
                self.status = "fallback"
                self.error = str(e)

    # ── training ───────────────────────────────────────────────────────────

    def train_candidates(self, panel_extra: Optional[pd.DataFrame] = None, seed: int = 42, flood_version: Optional[str] = None, sal_version: Optional[str] = None):
        from models.data import build_flood_data, build_salinity_data, load_panel, load_sites
        from models.flood_predictor import train_flood_model
        from models.salinity_predictor import train_salinity_model

        t0 = time.time()
        panel = load_panel(panel_extra)
        sites = load_sites()
        cur = self._read_metrics().get("deployed", {})
        fv = flood_version or _bump(cur.get("flood", {}).get("version"), "v2.1.0")
        sv = sal_version or _bump(cur.get("salinity", {}).get("version"), "v1.5.0")
        if flood_version is None and self.flood is None and not cur:
            fv, sv = "v2.1.0", "v1.5.0"
        from threadpoolctl import threadpool_limits

        # Cap OpenMP threads: HistGradientBoosting oversubscribes on many-core laptops.
        with threadpool_limits(limits=4):
            fd = build_flood_data(panel, sites)
            flood = train_flood_model(fd, version=fv, seed=seed)
            sd = build_salinity_data(panel, sites, seed=seed)
            sal = train_salinity_model(sd, version=sv, seed=seed)
        logger.info("Candidate models trained in %.1fs", time.time() - t0)
        self._last_data = (fd, sd)
        return flood, sal

    def _save(self, flood, sal, archive_previous: bool = False) -> None:
        wd = weights_dir()
        wd.mkdir(parents=True, exist_ok=True)
        if archive_previous:
            for name, m, new in (("flood", self.flood, flood), ("salinity", self.salinity, sal)):
                src = wd / f"{name}.joblib"
                if new is not None and m is not None and src.exists():  # archive only what gets replaced
                    dst = wd / "archive" / name / m.version
                    dst.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src, dst / f"{name}.joblib")
        if flood is not None:
            joblib.dump(flood, wd / "flood.joblib", compress=3)
        if sal is not None:
            joblib.dump(sal, wd / "salinity.joblib", compress=3)
        metrics = self._read_metrics()
        dep = metrics.setdefault("deployed", {})
        if flood is not None:
            dep["flood"] = {**flood.to_metrics_row(), "details": flood.metrics}
        if sal is not None:
            dep["salinity"] = {**sal.to_metrics_row(), "details": sal.metrics}
        try:
            from models.data import load_meta

            meta = load_meta()
            metrics["dataset"] = {k: meta.get(k) for k in ("built_at", "period", "sources", "open_meteo_calls_used")}
        except Exception:
            pass
        self._write_metrics(metrics)

    def _read_metrics(self) -> dict:
        p = weights_dir() / "metrics.json"
        try:
            return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
        except Exception:
            return {}

    def _write_metrics(self, metrics: dict) -> None:
        p = weights_dir() / "metrics.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(metrics, indent=2, default=_json_default), encoding="utf-8")

    # ── metrics ────────────────────────────────────────────────────────────

    def record_live_score(self, p72: float) -> None:
        self.live_scores.append(float(p72))

    def metrics_payload(self) -> dict:
        from models.flood_predictor import _psi

        rows = []
        persisted = self._read_metrics().get("deployed", {})
        if self.flood is not None:
            row = self.flood.to_metrics_row()
            if len(self.live_scores) >= 50 and self.flood.reference_scores is not None:
                row["drift_psi"] = round(_psi(np.asarray(self.flood.reference_scores), np.asarray(self.live_scores)), 4)
                row["drift_basis"] = f"live-vs-test ({len(self.live_scores)} live predictions)"
            else:
                row["drift_basis"] = "test-vs-train score distribution"
            row["details"] = self.flood.metrics
            rows.append(row)
        elif "flood" in persisted:
            rows.append({**persisted["flood"], "status": self.status})
        if self.salinity is not None:
            rows.append({**self.salinity.to_metrics_row(), "details": self.salinity.metrics})
        elif "salinity" in persisted:
            rows.append({**persisted["salinity"], "status": self.status})
        rows.append({"name": "supply-chain-impact (Monte Carlo)", "version": SUPPLY_CHAIN_VERSION, "trained_at": SUPPLY_CHAIN_CALIBRATED})
        return {"models": rows, "status": self.status, "last_retrain": self.last_retrain}

    # ── MODEL_RETRAIN (spec §6) ────────────────────────────────────────────

    def retrain(self, refresh_data: bool = False, seed: Optional[int] = None, force: bool = False) -> dict:
        if not self._train_lock.acquire(blocking=False):
            return {"decision": "skipped", "reason": "training already in progress"}
        try:
            t0 = time.time()
            extra, refresh_info = (None, None)
            if refresh_data:
                extra, refresh_info = fetch_recent_panel()
            seed = int(seed if seed is not None else (int(time.time()) % 10_000))
            flood_c, sal_c = self.train_candidates(panel_extra=extra, seed=seed)
            fd, sd = self._last_data
            decision: dict = {"seed": seed, "refresh": refresh_info, "flood": {}, "salinity": {}}

            # Flood: AUC (72 h) of candidate vs deployed on the SAME held-out rows
            te = fd.X["split"] == "test"
            y3 = fd.y.loc[te, "y3"].to_numpy(dtype=int)
            Xte = fd.X[te].copy()
            Xte["_inv_p99"] = Xte["site"].map({k: 1.0 / v.rain3_p99 for k, v in fd.stats.items()})
            auc_c = float(roc_auc_score(y3, flood_c.predict_proba(Xte)[:, 2]))
            auc_d = float(roc_auc_score(y3, self.flood.predict_proba(Xte)[:, 2])) if self.flood is not None else None
            promote_f = force or auc_d is None or auc_c > auc_d + 1e-4
            decision["flood"] = {
                "candidate_version": flood_c.version, "candidate_auc": round(auc_c, 4),
                "deployed_version": getattr(self.flood, "version", None), "deployed_auc": None if auc_d is None else round(auc_d, 4),
                "promoted": bool(promote_f),
            }

            # Salinity: RMSE (30 d) on the same held-out rows — lower is better
            ok = (sd.X["split"] == "test") & sd.y["ec_h30"].notna()
            yt = sd.y.loc[ok, "ec_h30"].to_numpy(dtype=float)
            rmse_c = float(np.sqrt(mean_squared_error(yt, sal_c.predict(sd.X[ok])[30])))
            rmse_d = float(np.sqrt(mean_squared_error(yt, self.salinity.predict(sd.X[ok])[30]))) if self.salinity is not None else None
            promote_s = force or rmse_d is None or rmse_c < rmse_d - 1e-4
            decision["salinity"] = {
                "candidate_version": sal_c.version, "candidate_rmse": round(rmse_c, 4),
                "deployed_version": getattr(self.salinity, "version", None), "deployed_rmse": None if rmse_d is None else round(rmse_d, 4),
                "promoted": bool(promote_s),
            }

            self._save(flood_c if promote_f else None, sal_c if promote_s else None, archive_previous=True)
            if promote_f:
                self.flood = flood_c
            if promote_s:
                self.salinity = sal_c
            self.status = "ready" if self.ready else self.status
            decision["decision"] = "promoted" if (promote_f or promote_s) else "kept_deployed"
            decision["duration_s"] = round(time.time() - t0, 1)
            decision["at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            metrics = self._read_metrics()
            metrics.setdefault("history", []).append(decision)
            metrics["history"] = metrics["history"][-50:]
            self._write_metrics(metrics)
            self.last_retrain = decision
            return decision
        finally:
            self._train_lock.release()


def fetch_recent_panel() -> tuple[Optional[pd.DataFrame], dict]:
    """
    Append ERA5 + GloFAS days newer than the committed dataset (up to 7 days ago)
    for all demo districts — the "collect new labeled data" step of MODEL_RETRAIN.
    """
    import httpx

    from models.data import load_panel, load_sites

    panel = load_panel()
    last = panel["date"].max().date()
    start, end = last + timedelta(days=1), date.today() - timedelta(days=7)
    if end <= start:
        return None, {"new_days": 0}
    frames = []
    with httpx.Client(timeout=60.0) as client:
        for sid, site in load_sites().items():
            era = client.get(
                "https://archive-api.open-meteo.com/v1/archive",
                params={"latitude": site["lat"], "longitude": site["lon"], "start_date": start.isoformat(), "end_date": end.isoformat(),
                        "daily": "precipitation_sum,soil_moisture_0_to_7cm_mean,temperature_2m_mean,et0_fao_evapotranspiration", "timezone": "GMT"},
            )
            fl = client.get(
                settings.open_meteo_flood_url,
                params={"latitude": site["glofas_cell"]["lat"], "longitude": site["glofas_cell"]["lon"], "daily": "river_discharge",
                        "start_date": start.isoformat(), "end_date": end.isoformat()},
            )
            if era.status_code != 200 or fl.status_code != 200:
                logger.warning("refresh failed for %s (%s/%s)", sid, era.status_code, fl.status_code)
                continue
            e, q = era.json()["daily"], fl.json()["daily"]
            df = pd.DataFrame({
                "date": pd.to_datetime(e["time"]), "site": sid, "precip_mm": e["precipitation_sum"],
                "soil_moisture": e["soil_moisture_0_to_7cm_mean"], "temp_c": e["temperature_2m_mean"], "et0_mm": e["et0_fao_evapotranspiration"],
            })
            df["discharge_m3s"] = pd.Series(q["river_discharge"], index=pd.to_datetime(q["time"])).reindex(df["date"]).to_numpy()
            frames.append(df)
            time.sleep(0.5)
    if not frames:
        return None, {"new_days": 0, "error": "all refresh requests failed"}
    extra = pd.concat(frames, ignore_index=True)
    return extra, {"new_days": int((end - start).days + 1), "from": start.isoformat(), "to": end.isoformat(), "rows": int(len(extra))}


def _json_default(o):
    if isinstance(o, (np.floating, np.integer)):
        return o.item()
    if isinstance(o, np.ndarray):
        return o.tolist()
    return str(o)


registry = ModelRegistry()
