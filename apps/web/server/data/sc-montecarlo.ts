/**
 * TypeScript Monte Carlo engine for supply-chain disruption scenarios.
 *
 * Mirrors the Python service contract (POST /api/ml/supply-chain/scenario)
 * and is used whenever that service is unreachable. Deterministic for a
 * given input (seeded mulberry32), so the same scenario always reproduces.
 *
 * Per simulation:
 *   common shock   S  ~ LogNormal(0, 0.22)          (event-wide severity)
 *   region hit     H_r ~ Bernoulli(p_r)              p_r from intensity + live flood risk
 *   flood depth    D_r ~ LogNormal(ln(μ_r), 0.35)    μ_r = 0.17 m × category × (0.55 + exposure)
 *   duration       T_r ~ duration × LogNormal(0, 0.2)
 *   inundated area A_r = (0.08 + 0.07·category) × (0.5 + exposure) × Beta(3, 5)/E[Beta]
 *   crop loss      L_r = A_r × floodCropLoss(D_r, T_r, sensitivity) × Beta(5, 3)/E[Beta]
 *   USD loss       = L × standing × sourcing share × price + logistics delay + inventory damage
 *   node outage    O_n = H × min(1, (T + 4·D) / 21) × (0.5 + flood_risk/200) × Beta(4, 4)·2
 *   price impact   ΔP = flexibility × shortfall share × LogNormal(0, 0.3)
 *   recovery       R  = T + 7·D + 3.5·(category-1) + backlog(O) + Gamma noise
 */
import { floodCropLoss, clamp01 } from "../risk/scoring";
import { mulberry32, type Rng } from "./prng";

export interface MCRegion {
  id: string;
  floodRisk: number; // 0-100 live
  floodExposure: number; // 0-1
  salinityRisk: number;
  standingTonnes: number;
}

export interface MCNode {
  id: string;
  districtId: string;
  flood_risk: number;
  capacity_tonnes: number;
  weekly_tonnes: number;
  inventory_tonnes: number;
}

export interface MCInput {
  commodity: string;
  floodSensitivity: number;
  priceUsd: number;
  flexibility: number;
  marketSupplyTonnes: number;
  /** share of the regional crop that the organisation's network sources (0-1) */
  sourcingShare: number;
  regions: MCRegion[];
  nodes: MCNode[];
  intensity: number; // 1-5
  durationDays: number;
  simulations: number;
  delayUsdPerTWeek: number;
  seed: number;
}

export interface MCOutput {
  disruption_probability: number;
  volume_loss_tonnes: number;
  volume_loss_ci: [number, number];
  estimated_loss_usd: number;
  loss_usd_ci: [number, number];
  price_impact_pct: number;
  recovery_days: number;
  histogram: { bucket: number; count: number }[];
  affected_nodes: { id: string; impact_pct: number }[];
  // extended statistics (TS engine)
  mean_loss_usd: number;
  p90_loss_usd: number;
  p95_loss_usd: number;
  price_ci: [number, number];
  recovery_ci: [number, number];
  region_loss: { id: string; loss_pct: number; hit_probability: number; volume_loss_tonnes: number }[];
  components: { crop_usd: number; logistics_usd: number; inventory_usd: number };
  mean_depth_m: number;
  network_volume_loss_tonnes: number;
}

// ─── Distributions ─────────────────────────────────────────────────────────

function normal(rng: Rng): number {
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const lognormal = (rng: Rng, mu: number, sigma: number) => Math.exp(mu + sigma * normal(rng));

/** Marsaglia–Tsang gamma sampler. */
function gamma(rng: Rng, shape: number): number {
  if (shape < 1) return gamma(rng, shape + 1) * Math.pow(rng(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do {
      x = normal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
const beta = (rng: Rng, a: number, b: number) => {
  const x = gamma(rng, a);
  return x / (x + gamma(rng, b));
};

const quantile = (sorted: number[], q: number) => {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
};

// ─── Engine ───────────────────────────────────────────────────────────────

export function runMonteCarlo(inp: MCInput): MCOutput {
  const rng = mulberry32(inp.seed);
  const n = Math.max(100, Math.min(20000, Math.round(inp.simulations)));
  const cat = Math.max(1, Math.min(5, inp.intensity));
  const baseline = inp.regions.reduce((s, r) => s + r.standingTonnes, 0);
  const nodesByDistrict = new Map<string, MCNode[]>();
  for (const nd of inp.nodes) nodesByDistrict.set(nd.districtId, [...(nodesByDistrict.get(nd.districtId) ?? []), nd]);

  const losses: number[] = [];
  const volumes: number[] = [];
  const prices: number[] = [];
  const recoveries: number[] = [];
  const nodeImpactSum = new Map<string, number>();
  const regionLossSum = new Map<string, number>();
  const regionHits = new Map<string, number>();
  const regionVol = new Map<string, number>();
  let cropSum = 0,
    logSum = 0,
    invSum = 0,
    depthSum = 0,
    depthN = 0,
    disrupted = 0;

  const EBETA53 = 5 / 8;
  const EBETA35 = 3 / 8;

  for (let s = 0; s < n; s++) {
    const shock = lognormal(rng, 0, 0.22);
    let vol = 0;
    let logistics = 0;
    let inventory = 0;
    let maxDepth = 0;
    let maxDur = 0;
    let maxOutage = 0;

    for (const r of inp.regions) {
      const pHit = clamp01(0.28 + 0.11 * cat + 0.32 * (r.floodRisk / 100));
      const hit = rng() < pHit;
      if (!hit) continue;
      regionHits.set(r.id, (regionHits.get(r.id) ?? 0) + 1);
      const mu = Math.log(0.17 * cat * (0.55 + r.floodExposure));
      const depth = Math.min(3.5, lognormal(rng, mu, 0.35) * shock);
      const dur = inp.durationDays * lognormal(rng, 0, 0.2);
      depthSum += depth;
      depthN++;
      maxDepth = Math.max(maxDepth, depth);
      maxDur = Math.max(maxDur, dur);
      const inundated = clamp01((0.08 + 0.07 * cat) * (0.5 + r.floodExposure) * (beta(rng, 3, 5) / EBETA35));
      const loss = clamp01(inundated * floodCropLoss(depth, dur, inp.floodSensitivity) * (beta(rng, 5, 3) / EBETA53));
      const v = r.standingTonnes * loss;
      vol += v;
      regionLossSum.set(r.id, (regionLossSum.get(r.id) ?? 0) + loss);
      regionVol.set(r.id, (regionVol.get(r.id) ?? 0) + v);

      for (const nd of nodesByDistrict.get(r.id) ?? []) {
        const outage = clamp01(Math.min(1, (dur + 4 * depth) / 21) * (0.5 + nd.flood_risk / 200) * beta(rng, 4, 4) * 2);
        nodeImpactSum.set(nd.id, (nodeImpactSum.get(nd.id) ?? 0) + outage);
        maxOutage = Math.max(maxOutage, outage);
        const outageWeeks = (outage * (dur + 4 * depth)) / 7;
        logistics += nd.weekly_tonnes * outageWeeks * inp.delayUsdPerTWeek;
        inventory += nd.inventory_tonnes * inp.priceUsd * clamp01(0.05 * depth * outage) ;
      }
    }

    const crop = vol * inp.sourcingShare * inp.priceUsd;
    const total = crop + logistics + inventory;
    cropSum += crop;
    logSum += logistics;
    invSum += inventory;
    losses.push(total);
    volumes.push(vol);
    if (baseline > 0 && vol / baseline > 0.05) disrupted++;
    const shortfall = inp.marketSupplyTonnes > 0 ? vol / inp.marketSupplyTonnes : 0;
    prices.push(inp.flexibility * shortfall * 100 * lognormal(rng, 0, 0.3));
    const backlog = maxOutage * 10;
    recoveries.push(maxDur + 7 * maxDepth + 3.5 * (cat - 1) + backlog + gamma(rng, 2) * 1.5);
  }

  const sl = [...losses].sort((a, b) => a - b);
  const sv = [...volumes].sort((a, b) => a - b);
  const sp = [...prices].sort((a, b) => a - b);
  const sr = [...recoveries].sort((a, b) => a - b);

  // 30-bucket histogram over [0, P99.5]
  const top = Math.max(1, quantile(sl, 0.995));
  const B = 30;
  const width = top / B;
  const hist = Array.from({ length: B }, (_, i) => ({ bucket: Math.round(i * width), count: 0 }));
  for (const l of losses) hist[Math.min(B - 1, Math.floor(l / width))]!.count++;

  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);

  return {
    disruption_probability: Math.round((disrupted / n) * 1000) / 1000,
    volume_loss_tonnes: Math.round(quantile(sv, 0.5)),
    volume_loss_ci: [Math.round(quantile(sv, 0.05)), Math.round(quantile(sv, 0.95))],
    estimated_loss_usd: Math.round(quantile(sl, 0.5)),
    loss_usd_ci: [Math.round(quantile(sl, 0.05)), Math.round(quantile(sl, 0.95))],
    price_impact_pct: Math.round(quantile(sp, 0.5) * 10) / 10,
    recovery_days: Math.round(quantile(sr, 0.5)),
    histogram: hist,
    affected_nodes: [...nodeImpactSum.entries()]
      .map(([id, sum]) => ({ id, impact_pct: Math.round((sum / n) * 1000) / 10 }))
      .sort((a, b) => b.impact_pct - a.impact_pct),
    mean_loss_usd: Math.round(mean(losses)),
    p90_loss_usd: Math.round(quantile(sl, 0.9)),
    p95_loss_usd: Math.round(quantile(sl, 0.95)),
    price_ci: [Math.round(quantile(sp, 0.05) * 10) / 10, Math.round(quantile(sp, 0.95) * 10) / 10],
    recovery_ci: [Math.round(quantile(sr, 0.05)), Math.round(quantile(sr, 0.95))],
    region_loss: inp.regions.map((r) => ({
      id: r.id,
      loss_pct: Math.round(((regionLossSum.get(r.id) ?? 0) / n) * 1000) / 10,
      hit_probability: Math.round(((regionHits.get(r.id) ?? 0) / n) * 100) / 100,
      volume_loss_tonnes: Math.round((regionVol.get(r.id) ?? 0) / n),
    })),
    components: { crop_usd: Math.round(cropSum / n), logistics_usd: Math.round(logSum / n), inventory_usd: Math.round(invSum / n) },
    mean_depth_m: depthN ? Math.round((depthSum / depthN) * 100) / 100 : 0,
    network_volume_loss_tonnes: Math.round(quantile(sv, 0.5) * inp.sourcingShare),
  };
}
