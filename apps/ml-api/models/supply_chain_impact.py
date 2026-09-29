"""
Supply Chain Impact Forecaster — Agri-SHIELD
============================================
Vectorised Monte Carlo (numpy) of a flood scenario propagating through
producer regions → logistics nodes → market (spec §5.4):

1. **Hazard** — per simulation and region: flood occurrence (Gaussian copula,
   correlation 0.7 within a country / 0.25 across countries), depth
   (log-normal, median rising with intensity and district exposure), duration
   (gamma around the requested duration) and flooded share of production area (beta).
2. **Commodity damage functions** — ``loss = Lmax·(1 − exp(−k·depth^α·days^β))``
   calibrated so that rice flooded 5 days at 0.8 m loses ≈ 80 % (IRRI
   submergence studies); wheat/maize/vegetables are more sensitive, jute and
   sugarcane more tolerant, coconut palms mostly survive inundation.
3. **Logistics** — each warehouse/processor node is disrupted with a probability
   set by its flood risk and the scenario intensity; stock trapped for the
   flood duration spoils at a commodity-specific daily rate.
4. **Market** — price impact from the regional supply shock via a constant
   demand-elasticity model plus commodity price volatility (order-of-magnitude
   calibration against World Bank Pink Sheet monthly volatility).
5. **Recovery** — flood duration + logistics restoration + a re-planting lag
   that scales with the crop cycle when losses exceed 30 %.

Outputs are distributions: probability of disruption, volume and USD loss with
90 % intervals, price impact, recovery time, a 20-bucket loss histogram and
per-node impact.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np
from scipy.stats import norm

from core.geo import DISTRICT_BY_ID

VERSION = "v1.2.0"


@dataclass(frozen=True)
class Commodity:
    k: float  # damage rate
    alpha: float  # depth exponent
    beta: float  # duration exponent
    lmax: float  # max loss fraction
    spoil_per_day: float  # post-harvest spoilage of trapped stock
    elasticity: float  # |price elasticity of demand|
    volatility: float  # monthly price volatility (σ)
    cycle_days: int  # crop cycle for re-planting lag
    price_usd_t: float  # default farm-gate/wholesale price
    region_volume_t: float  # default seasonal volume per district (≈2 M population)


COMMODITIES: dict[str, Commodity] = {
    "rice": Commodity(0.461, 1.0, 1.0, 0.95, 0.004, 0.25, 0.06, 110, 420, 150_000),
    "wheat": Commodity(0.90, 0.8, 1.0, 0.95, 0.003, 0.30, 0.07, 120, 260, 60_000),
    "maize": Commodity(0.80, 0.8, 1.0, 0.95, 0.004, 0.35, 0.07, 100, 230, 60_000),
    "jute": Commodity(0.18, 1.2, 0.9, 0.85, 0.002, 0.60, 0.08, 120, 750, 40_000),
    "sugarcane": Commodity(0.12, 1.0, 1.0, 0.80, 0.010, 0.45, 0.05, 330, 40, 200_000),
    "vegetables": Commodity(1.30, 0.7, 0.9, 0.98, 0.060, 0.50, 0.15, 60, 350, 50_000),
    "coconut": Commodity(0.05, 1.0, 1.0, 0.50, 0.010, 0.55, 0.08, 365, 250, 30_000),
    "potato": Commodity(1.20, 0.8, 0.9, 0.97, 0.015, 0.40, 0.12, 90, 220, 50_000),
    "onion": Commodity(1.10, 0.8, 0.9, 0.97, 0.012, 0.35, 0.18, 110, 380, 30_000),
    "fish": Commodity(0.35, 1.0, 0.8, 0.70, 0.080, 0.50, 0.10, 150, 1800, 20_000),
}


def damage_fraction(commodity: str, depth_m: np.ndarray, days: np.ndarray) -> np.ndarray:
    c = COMMODITIES.get(commodity, COMMODITIES["rice"])
    d = np.clip(depth_m, 0, None)
    t = np.clip(days, 0, None)
    return c.lmax * (1.0 - np.exp(-c.k * d**c.alpha * t**c.beta))


def _region_meta(rid: str) -> dict:
    d = DISTRICT_BY_ID.get(rid)
    if d is None:
        return {"id": rid, "country": "XX", "flood_exposure": 0.6, "population": 2_000_000, "name": rid}
    return {"id": rid, "country": d.country, "flood_exposure": d.flood_exposure, "population": d.population, "name": d.name}


def run_scenario(
    commodity: str,
    region_ids: list[str],
    intensity: int,
    duration_days: float,
    simulations: int = 2000,
    baseline_volume_tonnes: Optional[float] = None,
    base_price_usd: Optional[float] = None,
    nodes: Optional[list[dict]] = None,
    seed: Optional[int] = None,
) -> dict:
    rng = np.random.default_rng(seed)
    c = COMMODITIES.get(commodity, COMMODITIES["rice"])
    regions = [_region_meta(r) for r in (region_ids or ["bd-barisal"])]
    R, S = len(regions), int(simulations)
    expo = np.array([r["flood_exposure"] for r in regions])
    pop = np.array([r["population"] for r in regions], dtype=float)

    # Production volume per region (population used as a production-size proxy)
    default_vol = c.region_volume_t * pop / 2e6
    if baseline_volume_tonnes:
        vol = baseline_volume_tonnes * pop / pop.sum()
    else:
        vol = default_vol
    total_vol = float(vol.sum())
    price = float(base_price_usd or c.price_usd_t)

    # ── Correlated hazard occurrence (Gaussian copula)
    countries = [r["country"] for r in regions]
    corr = np.array([[1.0 if i == j else (0.7 if countries[i] == countries[j] else 0.25) for j in range(R)] for i in range(R)])
    L = np.linalg.cholesky(corr + 1e-9 * np.eye(R))
    z = rng.standard_normal((S, R)) @ L.T
    p_hit = np.clip(0.25 + 0.12 * intensity * (0.6 + 0.8 * expo), 0.05, 0.97)
    hit = norm.cdf(z) < p_hit

    # ── Severity: depth, duration, flooded area share
    depth_med = 0.18 * intensity * (0.7 + 0.6 * expo)
    common = rng.standard_normal((S, 1))
    depth = depth_med * np.exp(0.45 * (0.6 * common + 0.8 * rng.standard_normal((S, R))))
    shape = 4.0
    dur = rng.gamma(shape, max(duration_days, 0.5) * (0.7 + 0.4 * expo) / shape, (S, R))
    area_mean = np.clip(0.08 + 0.1 * intensity * expo, 0.05, 0.85)
    conc = 8.0
    area = rng.beta(area_mean * conc, (1 - area_mean) * conc, (S, R))

    crop_loss = damage_fraction(commodity, depth, dur) * area * hit  # share of region volume lost
    region_loss_t = crop_loss * vol

    # ── Logistics nodes
    if nodes:
        node_ids = [n["id"] for n in nodes]
        risk = np.array([float(n.get("flood_risk", 0.5)) for n in nodes])
        cap = np.array([float(n.get("capacity_tonnes") or total_vol / max(len(nodes), 1)) for n in nodes])
    else:
        node_ids = [f"{r['id']}-warehouse" for r in regions]
        risk = np.clip(expo * 0.8, 0, 1)
        cap = vol * 0.25  # ~quarter of seasonal volume held in regional storage
    N = len(node_ids)
    zn = 0.6 * common + 0.8 * rng.standard_normal((S, N))
    p_node = np.clip(risk * (0.45 + 0.11 * intensity), 0.0, 0.98)
    node_down = norm.cdf(zn) < p_node
    node_days = rng.gamma(shape, max(duration_days, 0.5) / shape, (S, N)) * node_down
    trapped = cap * np.minimum(1.0, node_days / 30.0)
    spoiled = trapped * np.minimum(1.0, c.spoil_per_day * node_days)

    vol_loss = region_loss_t.sum(axis=1) + spoiled.sum(axis=1)
    loss_frac = vol_loss / max(total_vol, 1e-9)
    loss_usd = vol_loss * price

    # ── Market price impact
    market_share = min(0.5, 0.035 * R)
    price_pct = np.clip(market_share * loss_frac / c.elasticity * 100.0, 0, 80.0)
    price_pct = price_pct + rng.normal(0, c.volatility * 100 * np.sqrt(max(duration_days, 1) / 30.0) * 0.5, S)
    price_pct = np.clip(price_pct, -10.0, 90.0)

    # ── Recovery
    replant = np.where(loss_frac > 0.3, 0.35 * c.cycle_days, np.where(loss_frac > 0.1, 0.15 * c.cycle_days, 0.0))
    logistics = np.where(node_down.any(axis=1), 7 + 3 * intensity, 2 + intensity)
    recovery = dur.max(axis=1) * hit.any(axis=1) + logistics + replant

    disrupted = (loss_frac > 0.05) | node_down.any(axis=1)

    # ── Summaries
    edges = np.linspace(0, max(float(vol_loss.max()), 1.0), 21)
    counts, _ = np.histogram(vol_loss, bins=edges)
    q = lambda a, p: float(np.quantile(a, p))  # noqa: E731
    if nodes:
        node_impact = (spoiled + trapped * 0.5) / np.maximum(cap, 1e-9)
    else:
        node_impact = crop_loss  # per-region production loss share
    affected = sorted(
        ({"id": node_ids[j], "impact_pct": round(float(node_impact[:, j].mean() * 100), 1)} for j in range(N)),
        key=lambda x: -x["impact_pct"],
    )
    region_detail = [
        {
            "id": regions[i]["id"],
            "name": regions[i]["name"],
            "hit_probability": round(float(hit[:, i].mean()), 3),
            "mean_depth_m_if_hit": round(float(depth[hit[:, i], i].mean()) if hit[:, i].any() else 0.0, 2),
            "expected_loss_pct": round(float(crop_loss[:, i].mean() * 100), 1),
            "volume_tonnes": round(float(vol[i]), 0),
        }
        for i in range(R)
    ]
    return {
        "disruption_probability": round(float(disrupted.mean()), 3),
        "volume_loss_tonnes": round(float(vol_loss.mean()), 1),
        "volume_loss_ci": [round(q(vol_loss, 0.05), 1), round(q(vol_loss, 0.95), 1)],
        "estimated_loss_usd": round(float(loss_usd.mean()), 0),
        "loss_usd_ci": [round(q(loss_usd, 0.05), 0), round(q(loss_usd, 0.95), 0)],
        "price_impact_pct": round(float(np.median(price_pct)), 2),
        "recovery_days": int(round(float(np.median(recovery)))),
        "histogram": [{"bucket": round(float(edges[i]), 1), "count": int(counts[i])} for i in range(20)],
        "affected_nodes": affected,
        # extra diagnostics (not required by the web contract)
        "expected_loss_fraction": round(float(loss_frac.mean()), 4),
        "value_at_risk_95_usd": round(q(loss_usd, 0.95), 0),
        "price_impact_ci": [round(q(price_pct, 0.05), 2), round(q(price_pct, 0.95), 2)],
        "baseline_volume_tonnes": round(total_vol, 0),
        "base_price_usd_per_tonne": price,
        "regions": region_detail,
        "simulations": S,
        "model_version": f"supply-chain-mc-{VERSION}",
    }
