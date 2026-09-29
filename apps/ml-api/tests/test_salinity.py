"""Salinity regressors, FAO crop-damage curve and recommendation logic."""
import numpy as np
import pandas as pd
import pytest

from core.features import SiteStats, build_salinity_frame
from models.salinity_predictor import (
    CROP_EC_THRESHOLDS,
    crop_damage_curve,
    crop_damage_probability,
    mitigation_actions,
    recommend_crops,
    salinity_class,
)


def _predict(sal, site: str, end: str, rain_per_day: float, q_ratio: float) -> dict:
    st = SiteStats(**sal.site_stats[site])
    static = dict(sal.site_static[site])
    idx = pd.date_range(end=end, periods=120)
    daily = pd.DataFrame(
        {"precip_mm": rain_per_day, "et0_mm": 4.5, "soil_moisture": 0.2, "discharge_m3s": q_ratio * st.q_median},
        index=idx,
    )
    row = build_salinity_frame(daily, st, static).iloc[[-1]]
    return {h: float(v[0]) for h, v in sal.predict(row).items()}


def test_severe_coastal_dry_season_in_expected_band(models):
    """Satkhira polder, early April, no rain for months, low river flow → severe (published 8–16 dS/m)."""
    _, sal = models
    ec = _predict(sal, "bd-satkhira", "2025-04-05", rain_per_day=0.3, q_ratio=0.35)
    assert 5.0 <= ec[0] <= 20.0, ec
    assert 5.0 <= ec[30] <= 20.0, ec
    assert salinity_class(ec[0]) in ("moderate", "severe")


def test_inland_district_stays_safe(models):
    _, sal = models
    ec = _predict(sal, "bd-sylhet", "2025-04-05", rain_per_day=0.5, q_ratio=0.4)
    assert ec[0] < 2.0 and ec[30] < 2.0, ec


def test_wet_season_lower_than_dry_season(models):
    _, sal = models
    dry = _predict(sal, "vn-bentre", "2025-04-01", rain_per_day=0.2, q_ratio=0.3)
    wet = _predict(sal, "vn-bentre", "2025-09-15", rain_per_day=12.0, q_ratio=3.0)
    assert wet[0] < dry[0]


def test_heldout_intrusion_events_accuracy(models):
    """Spec §14: known intrusion events → EC close to observed. Held-out 2024–2025 peak-season rows at severe sites."""
    from models.data import build_salinity_data, datasets_available, load_panel, load_sites

    if not datasets_available():
        pytest.skip("datasets missing")
    _, sal = models
    sd = build_salinity_data(load_panel(), load_sites())
    m = (sd.X["split"] == "test") & sd.X["date"].dt.month.isin([3, 4]) & sd.X["site"].isin(["bd-satkhira", "bd-khulna", "vn-bentre", "vn-camau", "vn-soctrang"])
    y = sd.y.loc[m, "ec_h0"].to_numpy()
    p = sal.predict(sd.X[m])[0]
    ape = np.abs(p - y) / y
    assert np.median(ape) < 0.20, f"median APE {np.median(ape):.3f}"
    assert np.mean([salinity_class(a) == salinity_class(b) for a, b in zip(p, y)]) > 0.6


@pytest.mark.parametrize("crop", list(CROP_EC_THRESHOLDS))
def test_crop_damage_monotonic_in_ec(crop):
    ec = np.linspace(0, 25, 200)
    d = crop_damage_curve(crop, ec)
    assert np.all(np.diff(d) >= -1e-12)
    assert 0 <= d.min() and d.max() <= 1
    probs = [crop_damage_probability(crop, e, 0.25) for e in (0.5, 2, 4, 8, 16)]
    assert probs == sorted(probs)


def test_damage_curve_anchor_points():
    t = CROP_EC_THRESHOLDS["rice"]
    assert crop_damage_curve("rice", t["sensitive"]) == pytest.approx(0.15)
    assert crop_damage_curve("rice", t["tolerant"]) == pytest.approx(0.97)


def test_salinity_classes():
    assert [salinity_class(v) for v in (1.0, 2.5, 5.0, 9.0)] == ["safe", "sensitive", "moderate", "severe"]


def test_recommendations_and_mitigation():
    assert recommend_crops(0.8, "rice")[0] == "rice"
    high = recommend_crops(6.0, "rice", "BD")
    assert any("salt-tolerant" in c for c in high) and "onion" not in high
    acts = mitigation_actions(4.0, 7.0, 10.0, True, "rice")
    for a in ("freshwater_flush", "gypsum_application", "close_sluice_gates_at_high_tide"):
        assert a in acts
    assert mitigation_actions(0.5, 0.6, 300.0, False, "rice") == ["monitor_ec_weekly"]
