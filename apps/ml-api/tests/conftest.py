"""
Shared pytest fixtures — Agri-SHIELD ML API.

Tests run fully offline: live-data functions are monkeypatched with synthetic
Open-Meteo-shaped payloads, and LLM/translation providers are disabled.
Models come from ``model_weights/`` when present, otherwise a compact ensemble
is trained from the committed dataset once per session.
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

APP_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP_DIR))

from config import settings  # noqa: E402

settings.train_on_startup = False
settings.openai_api_key = settings.groq_api_key = settings.ollama_base_url = ""
settings.deepl_api_key = ""
settings.ml_api_key = ""


@pytest.fixture(scope="session")
def models():
    """(flood_model, salinity_model) — deployed weights or a compact session-trained ensemble."""
    import joblib

    from models.registry import registry, weights_dir

    wd = weights_dir()
    if (wd / "flood.joblib").exists() and (wd / "salinity.joblib").exists():
        flood, sal = joblib.load(wd / "flood.joblib"), joblib.load(wd / "salinity.joblib")
    else:
        from models.data import build_flood_data, build_salinity_data, datasets_available, load_panel, load_sites
        from models.flood_predictor import train_flood_model
        from models.salinity_predictor import train_salinity_model

        if not datasets_available():
            pytest.skip("datasets missing — run scripts/train-models/build_dataset.py")
        panel, sites = load_panel(), load_sites()
        flood = train_flood_model(build_flood_data(panel, sites), version="v0.0-test", n_gbm=1, n_mlp=1)
        sal = train_salinity_model(build_salinity_data(panel, sites), version="v0.0-test")
    registry.flood, registry.salinity, registry.status = flood, sal, "ready"
    return flood, sal


def make_forecast(past_rain: list[float], future_rain: list[float], soil: float = 0.3, utc_offset_s: int = 21600) -> dict:
    """Synthetic Open-Meteo forecast payload: len(past_rain) days before today + today + future days."""
    offset = timedelta(seconds=utc_offset_s)
    today = (datetime.now(timezone.utc).replace(tzinfo=None) + offset).date()
    days = [today - timedelta(days=len(past_rain) - i) for i in range(len(past_rain))] + [today + timedelta(days=i) for i in range(len(future_rain))]
    rain = list(past_rain) + list(future_rain)
    hourly_t, hourly_p, hourly_sm = [], [], []
    for d, r in zip(days, rain):
        for h in range(24):
            hourly_t.append(f"{d.isoformat()}T{h:02d}:00")
            hourly_p.append(round(r / 24.0, 3))
            hourly_sm.append(soil)
    return {
        "utc_offset_seconds": utc_offset_s,
        "daily": {"time": [d.isoformat() for d in days], "precipitation_sum": rain, "et0_fao_evapotranspiration": [4.0] * len(days)},
        "hourly": {"time": hourly_t, "precipitation": hourly_p, "soil_moisture_0_to_7cm": hourly_sm},
    }


def discharge_series(n_past: int, n_future: int, level: float) -> pd.Series:
    today = pd.Timestamp(datetime.now(timezone.utc).date())
    idx = pd.date_range(today - pd.Timedelta(days=n_past), today + pd.Timedelta(days=n_future - 1))
    return pd.Series(np.full(len(idx), level), index=idx)


@pytest.fixture
def offline_live(monkeypatch, models):
    """Patch every live-data call; returns a dict the test can mutate to change the scenario."""
    from core.features import SiteStats
    from services import live_data

    scenario = {"past": [2.0] * 92, "future": [1.0, 1.0, 1.0, 1.0], "soil": 0.28, "q_level": None, "tidal": 1.8}
    flood_model, _ = models

    async def fake_forecast(lat, lon):
        return make_forecast(scenario["past"], scenario["future"], scenario["soil"])

    async def fake_discharge(lat, lon, site_id, site_stats):
        sid = site_id or "bd-barisal"
        st = SiteStats(**flood_model.site_stats[sid])
        level = scenario["q_level"] if scenario["q_level"] is not None else st.q_median
        return {"series": discharge_series(92, 4, level), "stats": st, "cell": None, "source": "test"}

    async def fake_elevation(lat, lon):
        return 4.0

    async def fake_tides(lat, lon, site_id):
        return {"cell": None, "tidal_range_m": scenario["tidal"], "upcoming_range_m": scenario["tidal"], "max_high_water_72h_m": 1.2, "spring_tide": False}

    async def fake_clay(lat, lon, site_id):
        return 38.0

    monkeypatch.setattr(live_data, "get_forecast", fake_forecast)
    monkeypatch.setattr(live_data, "get_discharge", fake_discharge)
    monkeypatch.setattr(live_data, "get_elevation", fake_elevation)
    monkeypatch.setattr(live_data, "get_tides", fake_tides)
    monkeypatch.setattr(live_data, "get_clay", fake_clay)
    return scenario


@pytest.fixture
def client(models, offline_live):
    from fastapi.testclient import TestClient

    from main import app

    with TestClient(app) as c:
        yield c
