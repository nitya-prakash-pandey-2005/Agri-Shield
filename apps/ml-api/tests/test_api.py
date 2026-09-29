"""HTTP contract tests (FastAPI TestClient, network mocked) against apps/web/server/ml-client.ts."""
import pytest

FLOOD_KEYS = {"probability_24h", "probability_48h", "probability_72h", "estimated_depth_m", "confidence_interval", "contributing_factors", "risk_level", "model_version", "hourly"}
SAL_KEYS = {"ec_current", "ec_predicted_7d", "ec_predicted_30d", "risk_level", "crop_damage_probability", "recommended_crops", "mitigation_actions", "confidence", "model_version"}
SCEN_KEYS = {"disruption_probability", "volume_loss_tonnes", "volume_loss_ci", "estimated_loss_usd", "loss_usd_ci", "price_impact_pct", "recovery_days", "histogram", "affected_nodes"}


# ── validation ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "path,body",
    [
        ("/api/ml/flood-risk", {"lat": 123.0, "lon": 90.0, "forecast_days": 3}),
        ("/api/ml/flood-risk", {"lat": 22.7, "lon": 190.0}),
        ("/api/ml/flood-risk", {"lon": 90.0}),
        ("/api/ml/salinity-risk", {"lat": -95, "lon": 90, "crop_type": "rice"}),
        ("/api/ml/salinity-risk", {"lat": 22.7, "lon": 90, "crop_type": "durian"}),
        ("/api/ml/salinity-risk", {"lat": 22.7, "lon": 90, "prediction_horizon_days": 400}),
        ("/api/ml/advisor", {"question": "", "farmer_context": {}}),
        ("/api/ml/advisor", {"question": "hello there", "farmer_context": {}, "language": "fr"}),
        ("/api/ml/supply-chain/scenario", {"commodity": "rice", "region_ids": ["bd-barisal"], "intensity": 6, "duration_days": 5}),
        ("/api/ml/supply-chain/scenario", {"commodity": "gold", "region_ids": ["bd-barisal"], "intensity": 3, "duration_days": 5}),
        ("/api/ml/supply-chain/scenario", {"commodity": "rice", "region_ids": [], "intensity": 3, "duration_days": 5}),
    ],
)
def test_invalid_input_returns_422(client, path, body):
    r = client.post(path, json=body)
    assert r.status_code == 422, r.text
    assert r.json()["error"] == "validation_error" and r.json()["detail"]


# ── health ──────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("path", ["/health", "/health/"])
def test_health(client, path):
    r = client.get(path)
    assert r.status_code == 200
    body = r.json()
    assert {"status", "version", "models_loaded", "uptime_s"} <= set(body)
    assert "flood" in body["models_loaded"] and "salinity" in body["models_loaded"]


# ── flood ───────────────────────────────────────────────────────────────────


def test_flood_contract_wet_vs_dry(client, offline_live, models):
    flood, _ = models
    from core.features import SiteStats

    p95 = SiteStats(**flood.site_stats["bd-barisal"]).q_p95
    offline_live.update(past=[45.0] * 92, future=[60.0, 120.0, 110.0, 80.0], soil=0.5, q_level=2.0 * p95)
    wet = client.post("/api/ml/flood-risk", json={"lat": 22.70, "lon": 90.36, "forecast_days": 3})
    assert wet.status_code == 200, wet.text
    w = wet.json()
    assert FLOOD_KEYS <= set(w)
    assert len(w["hourly"]) == 72 and {"time", "precip_mm", "probability"} <= set(w["hourly"][0])
    assert w["probability_24h"] <= w["probability_48h"] <= w["probability_72h"]
    lo, hi = w["confidence_interval"]
    assert lo <= w["probability_72h"] <= hi
    assert w["risk_level"] in ("high", "critical") and w["probability_72h"] > 0.6
    assert w["model_version"].startswith("flood-ens-")

    offline_live.update(past=[0.0] * 92, future=[0.0] * 4, soil=0.12, q_level=0.1 * p95)
    d = client.post("/api/ml/flood-risk", json={"lat": 22.70, "lon": 90.36}).json()
    assert d["probability_72h"] < w["probability_72h"] and d["probability_72h"] < 0.3
    assert d["risk_level"] == "low"


def test_flood_formula_fallback_when_model_missing(client, offline_live, monkeypatch):
    from models.registry import registry

    monkeypatch.setattr(registry, "flood", None)
    r = client.post("/api/ml/flood-risk", json={"lat": 10.24, "lon": 106.38})
    assert r.status_code == 200
    body = r.json()
    assert FLOOD_KEYS <= set(body) and body["model_version"].startswith("formula")


# ── salinity ────────────────────────────────────────────────────────────────


def test_salinity_contract(client, offline_live):
    offline_live.update(past=[0.2] * 92, future=[0.0] * 4, q_level=None)
    r = client.post("/api/ml/salinity-risk", json={"lat": 22.72, "lon": 89.07, "crop_type": "rice", "prediction_horizon_days": 30})
    assert r.status_code == 200, r.text
    b = r.json()
    assert SAL_KEYS <= set(b)
    assert b["risk_level"] in ("safe", "sensitive", "moderate", "severe")
    assert 0 <= b["crop_damage_probability"] <= 1 and 0 < b["confidence"] <= 1
    assert b["recommended_crops"] and b["mitigation_actions"]


# ── advisor ─────────────────────────────────────────────────────────────────


def test_advisor_contract(client):
    body = {
        "question": "Heavy rain is forecast, should I harvest my rice now?",
        "farmer_context": {"name": "Rahim", "crops": ["rice"], "area_ha": 1.2, "district": "Barisal", "country": "Bangladesh",
                           "flood_probability": 0.78, "salinity_ec": 3.4, "forecast_summary": "120 mm in 72 h"},
        "language": "en",
        "history": [],
    }
    r = client.post("/api/ml/advisor", json=body)
    assert r.status_code == 200, r.text
    b = r.json()
    assert {"answer", "actions", "sources", "confidence", "language", "provider"} <= set(b)
    assert b["provider"] == "local-grounded"
    assert all({"id", "label", "description", "urgency"} <= set(a) for a in b["actions"])
    assert all({"title", "snippet"} <= set(s) for s in b["sources"])


# ── supply chain ────────────────────────────────────────────────────────────


def test_scenario_contract(client):
    r = client.post("/api/ml/supply-chain/scenario", json={"commodity": "rice", "region_ids": ["bd-barisal", "bd-khulna"], "intensity": 4, "duration_days": 5, "simulations": 2000})
    assert r.status_code == 200, r.text
    b = r.json()
    assert SCEN_KEYS <= set(b)
    assert len(b["histogram"]) == 20
    assert b["volume_loss_ci"][0] <= b["volume_loss_tonnes"] <= b["volume_loss_ci"][1]


# ── metrics & retrain ───────────────────────────────────────────────────────


def test_metrics(client):
    r = client.get("/api/ml/metrics")
    assert r.status_code == 200
    rows = r.json()["models"]
    names = [m["name"] for m in rows]
    assert any("flood" in n for n in names) and any("salinity" in n for n in names) and any("supply" in n for n in names)
    flood = next(m for m in rows if "flood" in m["name"])
    assert {"version", "auc", "f1", "brier", "trained_at", "samples"} <= set(flood)
    sal = next(m for m in rows if "salinity" in m["name"])
    assert sal["rmse"] is not None and sal["r2"] is not None


def test_retrain_requires_api_key(client, monkeypatch):
    from config import settings

    monkeypatch.setattr(settings, "ml_api_key", "s3cret")
    assert client.post("/api/ml/retrain", json={}).status_code == 401
    assert client.post("/api/ml/retrain", json={}, headers={"X-API-Key": "wrong"}).status_code == 401


def test_retrain_promotion_logic(client, monkeypatch):
    """Candidate is compared with the deployed model; the decision is returned (training stubbed for speed)."""
    from models.registry import registry

    calls = {}

    def fake_retrain(refresh_data=False, seed=None, force=False):
        calls["args"] = (refresh_data, seed, force)
        return {"decision": "kept_deployed", "flood": {"promoted": False}, "salinity": {"promoted": False}}

    monkeypatch.setattr(registry, "retrain", fake_retrain)
    r = client.post("/api/ml/retrain", json={"seed": 7})
    assert r.status_code == 200 and r.json()["decision"] == "kept_deployed"
    assert calls["args"] == (False, 7, False)
