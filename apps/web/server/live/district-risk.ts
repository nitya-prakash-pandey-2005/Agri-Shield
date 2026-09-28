/**
 * Live risk overlay: pulls Open-Meteo forecast, GloFAS river discharge and
 * marine sea level for all 22 districts in 3 batched HTTP calls, scores them,
 * and writes the results onto the store. Throttled to once per 20 minutes.
 * If any feed fails the seeded values remain — the UI never breaks.
 */
import { getStore, riskLevelFromScore, type DistrictRecord } from "../data/store";
import { scoreFlood, scoreSalinity } from "../risk/scoring";
import { getForecast, getRiverDischarge, getSeaLevel } from "./open-meteo";

const g = globalThis as unknown as { __agriRiskRefresh?: { at: number; running: Promise<void> | null } };
const state = (g.__agriRiskRefresh ??= { at: 0, running: null });
const INTERVAL = 20 * 60_000;

const sum = (a: (number | null | undefined)[]) => a.reduce<number>((s, v) => s + (v ?? 0), 0);

function nowIndex(times: string[]): number {
  const now = Date.now();
  const i = times.findIndex((t) => new Date(t).getTime() > now);
  return i < 0 ? times.length - 1 : Math.max(0, i - 1);
}

async function refresh(): Promise<void> {
  const store = getStore();
  const pts = store.districts.map((d) => ({ lat: d.lat, lon: d.lon }));
  const [fc, fl, sea] = await Promise.allSettled([getForecast(pts, 4), getRiverDischarge(pts, 7), getSeaLevel(pts.map((p) => ({ lat: p.lat - 0.25, lon: p.lon })))]);
  if (fc.status !== "fulfilled") return; // keep seeded values

  store.districts.forEach((d: DistrictRecord, idx) => {
    const f = fc.value[idx];
    if (!f) return;
    const i0 = nowIndex(f.hourly.time);
    const p = f.hourly.precipitation;
    const rain24 = sum(p.slice(i0, i0 + 24));
    const rain48 = sum(p.slice(i0, i0 + 48));
    const rain72 = sum(p.slice(i0, i0 + 72));
    const soil = f.hourly.soil_moisture_0_to_7cm[i0] ?? 0.3;

    let dischargeRatio: number | null = null;
    if (fl.status === "fulfilled") {
      const daily = fl.value[idx]?.daily;
      if (daily) {
        const today = new Date().toISOString().slice(0, 10);
        const ti = Math.max(0, daily.time.indexOf(today));
        const hist = daily.river_discharge.slice(0, ti).filter((v): v is number => v != null && v > 0);
        const fut = daily.river_discharge.slice(ti, ti + 4).filter((v): v is number => v != null);
        if (hist.length > 5 && fut.length) {
          const mean = hist.reduce((s, v) => s + v, 0) / hist.length;
          const peak = Math.max(...fut);
          dischargeRatio = mean > 0 ? peak / mean : null;
          d.riverDischargeM3s = Math.round(peak);
          d.riverDischargeMeanM3s = Math.round(mean);
        }
      }
    }

    let seaLevel: number | null = null;
    if (sea.status === "fulfilled") {
      const h = sea.value[idx]?.hourly.sea_level_height_msl.filter((v): v is number => v != null);
      if (h?.length) seaLevel = Math.max(...h.slice(0, 24));
    }

    // Scenario injection (drills/demos) — applied on top of live observations, weighted by exposure
    const sc = store.scenario;
    const k = sc.intensity;
    let [r24, r48, r72, soilM, disR, month, past30] = [rain24, rain48, rain72, soil, dischargeRatio, new Date().getMonth() + 1, sum(f.daily.precipitation_sum.slice(0, 1)) * 30];
    if (sc.mode === "monsoon_surge" || sc.mode === "cyclone_landfall") {
      const w = d.floodExposure * k * (sc.mode === "cyclone_landfall" ? (d.coastDistanceKm < 40 ? 1.3 : 0.6) : 1);
      r24 += 70 * w; r48 += 130 * w; r72 += 190 * w;
      soilM = Math.max(soilM, 0.3 + 0.18 * w);
      disR = (disR ?? 1) + 1.6 * w;
    }
    if (sc.mode === "dry_season_salinity") { month = d.lat < 0 ? 10 : 4; past30 = 5; }
    if (sc.mode === "cyclone_landfall" && d.coastDistanceKm < 40) seaLevel = (seaLevel ?? 0.5) + 1.2 * k;

    const flood = scoreFlood({ rain24hMm: r24, rain48hMm: r48, rain72hMm: r72, soilMoisture: soilM, dischargeRatio: disR, exposure: d.floodExposure, elevationM: f.elevation });
    const sal = scoreSalinity({ exposure: d.salinityExposure, month, rain30dMm: past30, seaLevelM: seaLevel, latitude: d.lat });

    d.floodProb24h = flood.p24;
    d.floodProb48h = flood.p48;
    d.floodProb72h = flood.p72;
    d.floodRisk = flood.score;
    d.rainfall72hMm = Math.round(r72 * 10) / 10;
    d.ecCurrent = sal.ecCurrent;
    d.ecPredicted30d = sal.ecPredicted30d;
    d.salinityRisk = sal.score;
    d.seaLevelAnomalyM = seaLevel == null ? null : Math.round(seaLevel * 100) / 100;
    d.riskLevel = riskLevelFromScore(Math.max(d.floodRisk, d.salinityRisk * 0.9));
    d.liveSource = "open-meteo";
    d.lastUpdated = new Date();
  });

  // Propagate district deltas to fields and supply nodes (keeps relative variation)
  for (const field of store.fields) {
    const farmer = store.farmers.find((f) => f.id === field.farmerId);
    const d = store.districts.find((x) => x.id === farmer?.districtId);
    if (!d) continue;
    const jitter = ((field.id.charCodeAt(field.id.length - 1) % 17) - 8) as number;
    field.floodRisk = Math.max(3, Math.min(98, d.floodRisk + jitter));
    field.salinityRisk = Math.max(2, Math.min(98, d.salinityRisk + jitter));
    field.soilEc = Math.max(0.3, Math.round((d.ecCurrent + jitter / 20) * 10) / 10);
  }
  for (const node of store.nodes) {
    const d = store.districts.find((x) => x.id === node.districtId);
    if (!d) continue;
    node.floodRisk = Math.min(98, d.floodRisk + (node.type === "port" ? 4 : 0));
    node.salinityRisk = d.salinityRisk;
    node.riskScore = Math.round(node.floodRisk * 0.65 + node.salinityRisk * 0.35);
  }
}

/** Force the next ensureLiveRisk() call to refresh (e.g. after a scenario change). */
export function invalidateLiveRisk() {
  state.at = 0;
}

/** Non-blocking: kicks off a refresh if stale and returns immediately. */
export function ensureLiveRisk(): void {
  if (Date.now() - state.at < INTERVAL || state.running) return;
  state.at = Date.now();
  state.running = refresh()
    .catch((e) => console.warn("[live-risk] refresh failed, using seeded values:", (e as Error).message))
    .finally(() => (state.running = null));
}

/** Blocking variant (first request / cron): waits up to `maxWaitMs`. */
export async function ensureLiveRiskAwait(maxWaitMs = 6000): Promise<void> {
  ensureLiveRisk();
  if (state.running) await Promise.race([state.running, new Promise((r) => setTimeout(r, maxWaitMs))]);
}

export function liveRiskStatus() {
  return { lastRefresh: state.at ? new Date(state.at) : null, refreshing: !!state.running };
}
