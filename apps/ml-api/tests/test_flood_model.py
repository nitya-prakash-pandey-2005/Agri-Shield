"""Flood ensemble behaviour on synthetic known-wet / known-dry inputs."""
import numpy as np
import pandas as pd
import pytest

from core.features import SiteStats, build_flood_frame, depth_proxy


def _row(flood_model, site: str, rain_past: float, rain_future: float, soil: float, q_mult_p95: float, rising: bool, month: int = 7):
    st = SiteStats(**flood_model.site_stats[site])
    static = flood_model.site_static[site]
    idx = pd.date_range(f"2025-{month:02d}-01", periods=40)
    t = idx[-4]
    rain = np.where(idx <= t, rain_past, rain_future)
    q_now = q_mult_p95 * st.q_p95
    q = np.linspace(q_now * (0.6 if rising else 1.0), q_now, len(idx))
    daily = pd.DataFrame({"precip_mm": rain, "soil_moisture": soil, "et0_mm": 4.0, "discharge_m3s": q}, index=idx)
    frame = build_flood_frame(daily, st, static)
    row = frame.loc[[t]].copy()
    row["_inv_p99"] = 1.0 / st.rain3_p99
    return row


@pytest.mark.parametrize("site", ["bd-sylhet", "bd-barisal", "vn-angiang"])
def test_known_wet_input_high_probability(models, site):
    flood, _ = models
    row = _row(flood, site, rain_past=70.0, rain_future=110.0, soil=0.5, q_mult_p95=1.8, rising=True)
    p = flood.predict_proba(row)[0]
    assert p[2] > 0.8, f"wet scenario p72={p[2]:.3f}"


@pytest.mark.parametrize("site", ["bd-sylhet", "bd-barisal", "vn-angiang"])
def test_known_dry_input_low_probability(models, site):
    flood, _ = models
    row = _row(flood, site, rain_past=0.0, rain_future=0.0, soil=0.15, q_mult_p95=0.15, rising=False, month=2)
    p = flood.predict_proba(row)[0]
    assert p[2] < 0.3, f"dry scenario p72={p[2]:.3f}"


def test_probabilities_monotonic_and_interval_contains_point(models):
    flood, _ = models
    row = _row(flood, "bd-barisal", rain_past=25.0, rain_future=45.0, soil=0.38, q_mult_p95=0.9, rising=True)
    res = flood.predict_with_uncertainty(row, n_mc=30, seed=1)
    p = res["p"]
    assert p[0] <= p[1] <= p[2]
    lo, hi = res["p72_ci"]
    assert 0.0 <= lo <= p[2] <= hi <= 1.0


def test_depth_head_wetter_is_deeper(models):
    flood, _ = models
    wet = _row(flood, "bd-sylhet", 70.0, 110.0, 0.5, 2.0, True)
    dry = _row(flood, "bd-sylhet", 0.0, 0.0, 0.15, 0.2, False, month=2)
    assert flood.predict_depth(wet)[0] > flood.predict_depth(dry)[0]


def test_depth_proxy_physics():
    d = depth_proxy(np.array([0.5, 1.0, 2.0, 4.0]), np.array([0.0, 0.0, 0.0, 0.0]), 5.0)
    assert d[0] == 0 and d[1] == 0 and 0 < d[2] < d[3] <= 3.0


def test_attribution_names_rain_and_river_for_wet_case(models):
    flood, _ = models
    row = _row(flood, "bd-sylhet", 70.0, 110.0, 0.5, 1.8, True)
    names = [n for n, c in flood.attribute(row, top=4) if c > 0]
    assert {"river_discharge_above_normal", "above_avg_rainfall_72h", "wet_antecedent_7d"} & set(names)


def test_heldout_metrics_recorded(models):
    flood, _ = models
    m = flood.metrics["test"]["y3"]
    assert m["auc"] is not None and m["auc"] > 0.8
    assert 0 <= m["brier"] < 0.2
