"""Supply-chain Monte Carlo: damage calibration, interval ordering, determinism, monotonicity."""
import numpy as np
import pytest

from models.supply_chain_impact import damage_fraction, run_scenario


def test_rice_damage_calibration():
    """Spec §5.4: rice flooded 5 days at 0.8 m → ~80 % loss."""
    assert damage_fraction("rice", np.array(0.8), np.array(5.0)) == pytest.approx(0.80, abs=0.03)
    assert damage_fraction("rice", np.array(0.2), np.array(1.0)) < 0.15
    assert damage_fraction("jute", np.array(0.8), np.array(5.0)) < damage_fraction("rice", np.array(0.8), np.array(5.0))
    assert damage_fraction("vegetables", np.array(0.3), np.array(2.0)) > damage_fraction("rice", np.array(0.3), np.array(2.0))


def test_confidence_intervals_ordered():
    r = run_scenario("rice", ["bd-barisal", "bd-khulna", "bd-patuakhali"], 4, 7, 3000, seed=11)
    lo, hi = r["volume_loss_ci"]
    assert lo <= r["volume_loss_tonnes"] <= hi
    lo, hi = r["loss_usd_ci"]
    assert lo <= r["estimated_loss_usd"] <= hi
    assert 0 <= r["disruption_probability"] <= 1
    assert len(r["histogram"]) == 20 and sum(b["count"] for b in r["histogram"]) == 3000
    assert [b["bucket"] for b in r["histogram"]] == sorted(b["bucket"] for b in r["histogram"])
    assert r["recovery_days"] > 0 and r["affected_nodes"]


def test_seeded_runs_are_reproducible():
    a = run_scenario("rice", ["vn-bentre"], 3, 5, 1000, seed=5)
    b = run_scenario("rice", ["vn-bentre"], 3, 5, 1000, seed=5)
    assert a == b


def test_higher_intensity_more_loss():
    losses = [run_scenario("rice", ["bd-barisal", "bd-sylhet"], i, 7, 4000, seed=3)["expected_loss_fraction"] for i in (1, 3, 5)]
    assert losses[0] < losses[1] < losses[2]


def test_custom_nodes_and_volume():
    r = run_scenario(
        "vegetables", ["ph-pampanga"], 3, 4, 1500, baseline_volume_tonnes=10_000, base_price_usd=500,
        nodes=[{"id": "wh-1", "flood_risk": 0.9, "capacity_tonnes": 2000}, {"id": "wh-2", "flood_risk": 0.1, "capacity_tonnes": 2000}], seed=2,
    )
    ids = [n["id"] for n in r["affected_nodes"]]
    assert ids[0] == "wh-1"  # riskier node is impacted more
    assert r["baseline_volume_tonnes"] == 10_000 and r["base_price_usd_per_tonne"] == 500
