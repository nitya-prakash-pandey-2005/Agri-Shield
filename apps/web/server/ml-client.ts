/**
 * Client for the FastAPI ML service (apps/ml-api).
 * Every call has a local fallback so the web app keeps working end-to-end
 * even when the Python service isn't running (e.g. on Vercel preview).
 *
 * Contract (snake_case on the wire, mirrors spec §5):
 *   POST /api/ml/flood-risk          { lat, lon, forecast_days }
 *   POST /api/ml/salinity-risk       { lat, lon, crop_type, prediction_horizon_days }
 *   POST /api/ml/advisor             { question, farmer_context, language, history }
 *   POST /api/ml/supply-chain/scenario { commodity, region_ids, intensity, duration_days, simulations }
 *   GET  /api/ml/metrics
 */
import type { CropType, RiskLevel } from "@agri-shield/types";
import { fetchJson, cached } from "./live/http";
import { getForecast, getRiverDischarge, getElevation } from "./live/open-meteo";
import { cropDamageProbability, riskLevel, salinityClass, scoreFlood, scoreSalinity } from "./risk/scoring";

export const ML_API_URL = process.env.ML_API_URL ?? process.env.NEXT_PUBLIC_ML_API_URL ?? "http://localhost:8000";

async function ml<T>(path: string, body?: unknown, timeoutMs = 9000): Promise<T> {
  return fetchJson<T>(`${ML_API_URL}${path}`, timeoutMs, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", ...(process.env.ML_API_KEY ? { "X-API-Key": process.env.ML_API_KEY } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function mlHealth(): Promise<{ up: boolean; latencyMs: number | null; version?: string }> {
  const t = Date.now();
  try {
    const r = await fetchJson<{ version?: string }>(`${ML_API_URL}/health/`, 2500);
    return { up: true, latencyMs: Date.now() - t, version: r.version };
  } catch {
    return { up: false, latencyMs: null };
  }
}

// ─── Flood ────────────────────────────────────────────────────────────────

export interface FloodRisk {
  probability_24h: number;
  probability_48h: number;
  probability_72h: number;
  estimated_depth_m: number;
  confidence_interval: [number, number];
  contributing_factors: string[];
  risk_level: RiskLevel;
  model_version: string;
  hourly?: { time: string; precip_mm: number; probability: number }[];
  source: "ml-api" | "web-fallback";
}

export async function getFloodRisk(lat: number, lon: number, exposure = 0.6): Promise<FloodRisk> {
  try {
    const r = await ml<Omit<FloodRisk, "source">>("/api/ml/flood-risk", { lat, lon, forecast_days: 3 });
    return { ...r, source: "ml-api" };
  } catch {
    return cached(`fb-flood:${lat.toFixed(2)},${lon.toFixed(2)}`, 15 * 60_000, () => floodFallback(lat, lon, exposure));
  }
}

async function floodFallback(lat: number, lon: number, exposure: number): Promise<FloodRisk> {
  const [fc, fl, el] = await Promise.allSettled([getForecast([{ lat, lon }], 4), getRiverDischarge([{ lat, lon }]), getElevation([{ lat, lon }])]);
  let rain = [0, 0, 0];
  let soil = 0.3;
  let hourly: FloodRisk["hourly"] = [];
  if (fc.status === "fulfilled" && fc.value[0]) {
    const h = fc.value[0].hourly;
    const now = Date.now();
    const i0 = Math.max(0, h.time.findIndex((t) => new Date(t).getTime() > now) - 1);
    const p = h.precipitation;
    const s = (n: number) => p.slice(i0, i0 + n).reduce((a, b) => a + (b ?? 0), 0);
    rain = [s(24), s(48), s(72)];
    soil = h.soil_moisture_0_to_7cm[i0] ?? 0.3;
    let cum = 0;
    hourly = h.time.slice(i0, i0 + 72).map((t, k) => {
      cum += p[i0 + k] ?? 0;
      const r = scoreFlood({ rain24hMm: cum, rain48hMm: cum, rain72hMm: cum, soilMoisture: soil, dischargeRatio: null, exposure });
      return { time: t, precip_mm: p[i0 + k] ?? 0, probability: r.p24 };
    });
  }
  let ratio: number | null = null;
  if (fl.status === "fulfilled") {
    const d = fl.value[0]?.daily.river_discharge.filter((v): v is number => v != null) ?? [];
    if (d.length > 10) {
      const mean = d.slice(0, -7).reduce((a, b) => a + b, 0) / Math.max(1, d.length - 7);
      ratio = mean > 0 ? Math.max(...d.slice(-7)) / mean : null;
    }
  }
  const elev = el.status === "fulfilled" ? el.value[0] ?? null : null;
  const r = scoreFlood({ rain24hMm: rain[0]!, rain48hMm: rain[1]!, rain72hMm: rain[2]!, soilMoisture: soil, dischargeRatio: ratio, exposure, elevationM: elev });
  return {
    probability_24h: r.p24,
    probability_48h: r.p48,
    probability_72h: r.p72,
    estimated_depth_m: r.depthM,
    confidence_interval: [Math.max(0, r.p72 - 0.12), Math.min(1, r.p72 + 0.08)],
    contributing_factors: r.factors,
    risk_level: riskLevel(r.score),
    model_version: "web-formula-v1.2",
    hourly,
    source: "web-fallback",
  };
}

// ─── Salinity ─────────────────────────────────────────────────────────────

export interface SalinityRisk {
  ec_current: number;
  ec_predicted_7d: number;
  ec_predicted_30d: number;
  risk_level: string;
  crop_damage_probability: number;
  recommended_crops: string[];
  mitigation_actions: string[];
  confidence: number;
  model_version: string;
  source: "ml-api" | "web-fallback";
}

export async function getSalinityRisk(lat: number, lon: number, crop: CropType = "rice", exposure = 0.6): Promise<SalinityRisk> {
  try {
    const r = await ml<Omit<SalinityRisk, "source">>("/api/ml/salinity-risk", { lat, lon, crop_type: crop, prediction_horizon_days: 30 });
    return { ...r, source: "ml-api" };
  } catch {
    const s = scoreSalinity({ exposure, month: new Date().getMonth() + 1, rain30dMm: 150, seaLevelM: null, latitude: lat });
    const cls = salinityClass(s.ecPredicted30d);
    return {
      ec_current: s.ecCurrent,
      ec_predicted_7d: s.ecPredicted7d,
      ec_predicted_30d: s.ecPredicted30d,
      risk_level: cls,
      crop_damage_probability: cropDamageProbability(crop, s.ecPredicted30d),
      recommended_crops: s.ecPredicted30d > 4 ? ["barley", "sorghum", "BRRI dhan 67 (salt-tolerant rice)", "cotton"] : ["rice", "jute", "vegetables"],
      mitigation_actions: s.ecPredicted30d > 3 ? ["freshwater_flush", "gypsum_application", "close_sluice_gates_at_high_tide"] : ["monitor_ec_weekly"],
      confidence: 0.71,
      model_version: "web-formula-v1.2",
      source: "web-fallback",
    };
  }
}

// ─── AI Advisor ───────────────────────────────────────────────────────────

export interface AdvisorAnswer {
  answer: string;
  actions: { id: string; label: string; description: string; urgency: string }[];
  sources: { title: string; snippet: string }[];
  confidence: number;
  language: string;
  provider: string;
}

export interface AdvisorContext {
  name: string;
  crops: string[];
  area_ha: number;
  district: string;
  country: string;
  flood_probability: number;
  salinity_ec: number;
  forecast_summary: string;
  soil_type?: string;
}

export async function askAdvisor(question: string, ctx: AdvisorContext, language = "en", history: { role: string; content: string }[] = []): Promise<AdvisorAnswer> {
  try {
    return await ml<AdvisorAnswer>("/api/ml/advisor", { question, farmer_context: ctx, language, history: history.slice(-8) }, 45000);
  } catch {
    const flood = Math.round(ctx.flood_probability * 100);
    return {
      answer:
        `Based on your fields in **${ctx.district}** (72-hour flood probability **${flood}%**, soil EC **${ctx.salinity_ec} dS/m**) and the forecast (${ctx.forecast_summary}):\n\n` +
        (flood > 55
          ? "1. Harvest any crop that is ≥80% mature before the rain peaks.\n2. Open bunds and clear drainage outlets toward the nearest canal.\n3. Move seed, fertiliser and equipment to raised ground."
          : "1. Conditions are manageable — continue your normal schedule.\n2. Keep drainage outlets clear in case rainfall intensifies.\n3. Check the app again this evening for an updated forecast.") +
        (ctx.salinity_ec > 3 ? "\n4. EC is above the rice threshold (3 dS/m): flush with freshwater and consider gypsum at 2 t/ha." : ""),
      actions: [
        { id: "drain", label: "Clear drainage channels", description: "Open field outlets before rainfall peaks", urgency: flood > 55 ? "urgent" : "medium" },
        { id: "officer", label: "Contact extension officer", description: "Request pump or seed support", urgency: "medium" },
        { id: "insurance", label: "Apply for crop insurance", description: "Protect this season's income", urgency: "low" },
      ],
      sources: [{ title: "FAO — Rice crop management in flood-prone areas", snippet: "Drain fields within 72h of submergence to limit yield loss." }],
      confidence: 0.62,
      language,
      provider: "web-fallback",
    };
  }
}

// ─── Supply chain scenario ────────────────────────────────────────────────

export interface ScenarioResult {
  disruption_probability: number;
  volume_loss_tonnes: number;
  volume_loss_ci: [number, number];
  estimated_loss_usd: number;
  loss_usd_ci: [number, number];
  price_impact_pct: number;
  recovery_days: number;
  histogram: { bucket: number; count: number }[];
  affected_nodes: { id: string; impact_pct: number }[];
  source: "ml-api" | "web-fallback";
}

export async function runScenarioRemote(body: Record<string, unknown>): Promise<Omit<ScenarioResult, "source"> | null> {
  try {
    return await ml<Omit<ScenarioResult, "source">>("/api/ml/supply-chain/scenario", body, 20000);
  } catch {
    return null;
  }
}

export interface ModelMetrics {
  models: { name: string; version: string; auc?: number; f1?: number; brier?: number; rmse?: number; r2?: number; trained_at: string; drift_psi?: number; samples?: number }[];
  source: "ml-api" | "web-fallback";
}

export async function getModelMetrics(): Promise<ModelMetrics> {
  try {
    const r = await ml<Omit<ModelMetrics, "source">>("/api/ml/metrics", undefined, 4000);
    return { ...r, source: "ml-api" };
  } catch {
    return {
      source: "web-fallback",
      // Reference values from the last committed training run (apps/ml-api/model_weights/metrics.json)
      models: [
        { name: "flood-ensemble (temporal-MLP + HistGBM)", version: "v2.2.0", auc: 0.969, f1: 0.756, brier: 0.036, rmse: 0.108, r2: 0.549, trained_at: "2026-09-29T00:14:09Z", drift_psi: 0.012, samples: 56188 },
        { name: "salinity-histgbm (EC 0/7/30/90 d)", version: "v1.6.0", rmse: 1.027, r2: 0.869, trained_at: "2026-09-29T00:14:23Z", drift_psi: 0.011, samples: 56254 },
        { name: "supply-chain-impact (Monte Carlo)", version: "v1.2.0", trained_at: "2026-09-29T00:00:00Z" },
      ],
    };
  }
}
