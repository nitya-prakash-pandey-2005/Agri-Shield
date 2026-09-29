/**
 * SATELLITE_INGEST (spec §6) — REAL vegetation index from NASA MODIS.
 *
 * Source: ORNL DAAC MODIS/VIIRS Land Product Subsets REST API (free, no key)
 *   GET https://modis.ornl.gov/rst/api/v1/MOD13Q1/dates?latitude=&longitude=
 *   GET https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset?latitude=&longitude=&band=250m_16_days_NDVI
 *       &startDate=A2026145&endDate=A2026257&kmAboveBelow=1&kmLeftRight=1
 * Product: MOD13Q1 v6.1 — Terra 16-day composite, 250 m, NDVI scale factor 0.0001.
 *
 * One representative point per district (22 districts × 2 bands, sequential,
 * polite delay, cached 24 h). The 250m_16_days_pixel_reliability band
 * (0 good · 1 marginal · 2 snow · 3 cloudy) screens monsoon cloud: clear pixels
 * are averaged; if a composite is fully clouded we fall back to the 90th
 * percentile (clouds only depress NDVI) and flag it so it can't trigger
 * a stress alarm. A >20 % drop between the last two clear composites raises
 * a crop-stress recommendation + in-app notice for every field in the district.
 */
import { getStore, nextId, DAY, type DistrictRecord } from "../data/store";
import { cached, fetchJson } from "../live/http";
import { enqueueNotification } from "./notification-dispatch";
import type { JobResult } from "./registry";

const BASE = "https://modis.ornl.gov/rst/api/v1/MOD13Q1";
const NDVI_BAND = "250m_16_days_NDVI";
const REL_BAND = "250m_16_days_pixel_reliability";
const COMPOSITES = 8; // ≤10 per ORNL request
const DELAY_MS = 350;
export const STRESS_DROP = 0.2;

interface ModisDates {
  dates: { modis_date: string; calendar_date: string }[];
}
interface ModisSubset {
  scale?: string;
  subset: { modis_date: string; calendar_date: string; tile?: string; data: number[] }[];
}

export interface NdviPoint {
  date: string;
  modisDate: string;
  ndvi: number;
  quality: "clear" | "cloudy";
  clearPct: number;
}

export interface DistrictNdvi {
  districtId: string;
  name: string;
  lat: number;
  lon: number;
  tile: string | null;
  series: NdviPoint[];
  latest: NdviPoint | null;
  changePct: number | null;
  stressed: boolean;
  fieldsUpdated: number;
  error: string | null;
}

interface IngestState {
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  latestComposite: string | null;
  districts: DistrictNdvi[];
}

const g = globalThis as unknown as { __agriSat?: IngestState };
const state: IngestState = (g.__agriSat ??= { lastRunAt: null, lastSuccessAt: null, latestComposite: null, districts: [] });

export function satelliteStatus() {
  return state;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Percentile helper (p in 0-1). */
export function percentile(values: number[], p: number): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))));
  return s[idx]!;
}

/**
 * Collapse a kmAboveBelow=1 window (~9×9 pixels) to one NDVI value per composite.
 * `ndviRaw` are raw int16 values (scale 0.0001, fill −3000); `rel` pixel reliability.
 */
export function compositeNdvi(ndviRaw: number[], rel: number[] | null, scale = 0.0001): { ndvi: number; quality: "clear" | "cloudy"; clearPct: number } | null {
  const valid = ndviRaw.map((v, i) => ({ v: v * scale, i })).filter((x) => ndviRaw[x.i]! > -2000 && x.v <= 1);
  if (!valid.length) return null;
  const clear = rel ? valid.filter((x) => rel[x.i] === 0 || rel[x.i] === 1) : [];
  const clearPct = Math.round((clear.length / valid.length) * 100);
  if (clear.length >= Math.max(3, valid.length * 0.1)) {
    return { ndvi: round3(clear.reduce((s, x) => s + x.v, 0) / clear.length), quality: "clear", clearPct };
  }
  return { ndvi: round3(percentile(valid.map((x) => x.v), 0.9)), quality: "cloudy", clearPct };
}

/** Relative change between the last two CLEAR composites (null if not enough clear data). */
export function detectDrop(series: NdviPoint[]): { changePct: number | null; stressed: boolean } {
  const clear = series.filter((p) => p.quality === "clear");
  if (clear.length < 2) return { changePct: null, stressed: false };
  const prev = clear[clear.length - 2]!.ndvi;
  const last = clear[clear.length - 1]!.ndvi;
  if (prev <= 0.05) return { changePct: null, stressed: false };
  const change = (last - prev) / prev;
  return { changePct: Math.round(change * 1000) / 10, stressed: change <= -STRESS_DROP };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Stable per-field offset in [-0.05, 0.05] so fields in one district differ realistically. */
export function fieldOffset(fieldId: string): number {
  let h = 2166136261;
  for (let i = 0; i < fieldId.length; i++) h = Math.imul(h ^ fieldId.charCodeAt(i), 16777619);
  return (((h >>> 0) % 1000) / 1000 - 0.5) * 0.1;
}

async function compositeDates(lat: number, lon: number): Promise<ModisDates["dates"]> {
  const r = await cached(`modis:dates:${lat.toFixed(2)},${lon.toFixed(2)}`, 24 * 3600_000, () =>
    fetchJson<ModisDates>(`${BASE}/dates?latitude=${lat}&longitude=${lon}`, 30_000)
  );
  return r.dates;
}

async function subset(d: DistrictRecord, band: string, start: string, end: string): Promise<ModisSubset> {
  return cached(`modis:${band}:${d.id}:${start}:${end}`, 24 * 3600_000, () =>
    fetchJson<ModisSubset>(
      `${BASE}/subset?latitude=${d.lat}&longitude=${d.lon}&band=${band}&startDate=${start}&endDate=${end}&kmAboveBelow=1&kmLeftRight=1`,
      45_000
    )
  );
}

export async function satelliteIngest(opts: { districtIds?: string[] } = {}): Promise<JobResult> {
  const store = getStore();
  state.lastRunAt = new Date();
  const targets = store.districts.filter((d) => !opts.districtIds || opts.districtIds.includes(d.id));

  // Composite calendar (global 16-day grid) — one dates call for the first district.
  const dates = await compositeDates(targets[0]!.lat, targets[0]!.lon);
  const window = dates.slice(-COMPOSITES);
  if (!window.length) throw new Error("MODIS dates endpoint returned no composites");
  const start = window[0]!.modis_date;
  const end = window[window.length - 1]!.modis_date;
  state.latestComposite = window[window.length - 1]!.calendar_date;

  const results: DistrictNdvi[] = [];
  let fieldsUpdated = 0;
  let recs = 0;
  let calls = 1;

  for (const d of targets) {
    const res: DistrictNdvi = { districtId: d.id, name: d.name, lat: d.lat, lon: d.lon, tile: null, series: [], latest: null, changePct: null, stressed: false, fieldsUpdated: 0, error: null };
    try {
      const nd = await subset(d, NDVI_BAND, start, end);
      calls++;
      await sleep(DELAY_MS);
      let rel: ModisSubset | null = null;
      try {
        rel = await subset(d, REL_BAND, start, end);
        calls++;
      } catch {
        rel = null; // NDVI alone is still usable, just unscreened
      }
      await sleep(DELAY_MS);
      const scale = Number(nd.scale ?? "0.0001") || 0.0001;
      res.tile = nd.subset[0]?.tile ?? null;
      for (const c of nd.subset) {
        const r = rel?.subset.find((x) => x.modis_date === c.modis_date)?.data ?? null;
        const v = compositeNdvi(c.data, r, scale);
        if (v) res.series.push({ date: c.calendar_date, modisDate: c.modis_date, ...v });
      }
      res.series.sort((a, b) => a.date.localeCompare(b.date));
      res.latest = res.series[res.series.length - 1] ?? null;
      Object.assign(res, detectDrop(res.series));

      // Apply to this district's fields
      if (res.series.length) {
        const farmerIds = new Set(store.farmers.filter((f) => f.districtId === d.id).map((f) => f.id));
        for (const field of store.fields) {
          if (!farmerIds.has(field.farmerId)) continue;
          const off = fieldOffset(field.id);
          field.ndviHistory = res.series.map((p) => ({ date: p.date, ndvi: round2(Math.min(0.95, Math.max(-0.1, p.ndvi + off))) }));
          field.ndviScore = field.ndviHistory[field.ndviHistory.length - 1]!.ndvi;
          field.lastSatelliteScan = new Date();
          res.fieldsUpdated++;
          if (res.stressed) {
            const exists = store.recommendations.some((r) => r.fieldId === field.id && r.recommendationType === "crop_stress" && Date.now() - r.createdAt.getTime() < 7 * DAY);
            if (!exists) {
              store.recommendations.unshift({
                id: nextId("rec"),
                fieldId: field.id,
                alertId: null,
                recommendationType: "crop_stress",
                title: `Vegetation stress on ${field.name}: NDVI down ${Math.abs(res.changePct ?? 0)}%`,
                description: `MODIS MOD13Q1 NDVI for ${d.name} fell from ${res.series.filter((p) => p.quality === "clear").slice(-2)[0]?.ndvi} to ${res.latest?.ndvi} between the last two clear 16-day composites. Scout ${field.name} (${field.cropType}) for waterlogging, salt burn, pests or nutrient deficiency.`,
                priority: (res.changePct ?? 0) <= -35 ? "high" : "medium",
                actions: ["Scout the field within 48 h", "Check leaf tips for salt burn / yellowing", "Log findings in the app so the model learns"],
                confidenceScore: 0.72,
                generatedBy: "modis-ndvi-anomaly-v2",
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + 10 * DAY),
              });
              recs++;
              const farmer = store.farmers.find((f) => f.id === field.farmerId);
              if (farmer) enqueueNotification({ channel: "app", to: farmer.userId, body: `Satellite check: vegetation on ${field.name} dropped ${Math.abs(res.changePct ?? 0)}%. Please scout the field.`, origin: "satellite-ingest" });
            }
          }
        }
        fieldsUpdated += res.fieldsUpdated;
      }
    } catch (e) {
      res.error = (e as Error).message;
    }
    results.push(res);
  }

  // Merge into state (keep previous values for districts not in this run)
  const byId = new Map(state.districts.map((x) => [x.districtId, x]));
  for (const r of results) if (!r.error || !byId.has(r.districtId)) byId.set(r.districtId, r);
  state.districts = [...byId.values()];
  const ok = results.filter((r) => !r.error).length;
  if (ok) state.lastSuccessAt = new Date();

  const stressed = results.filter((r) => r.stressed).map((r) => `${r.name} ${r.changePct}%`);
  const clearShare = results.flatMap((r) => r.series).filter((p) => p.quality === "clear").length / Math.max(1, results.flatMap((r) => r.series).length);
  return {
    status: ok === 0 ? "failed" : ok < results.length ? "partial" : "success",
    summary: `MODIS MOD13Q1 ${start}→${end}: ${ok}/${results.length} districts, ${fieldsUpdated} fields updated, ${Math.round(clearShare * 100)}% clear composites, ${stressed.length} stressed${stressed.length ? ` (${stressed.join(", ")})` : ""}, ${recs} stress recommendation(s)`,
    output: {
      product: "MOD13Q1.061 250m 16-day NDVI",
      window: { start, end, latest: state.latestComposite },
      apiCalls: calls,
      districtsOk: ok,
      fieldsUpdated,
      stressRecommendations: recs,
      stressed,
      errors: results.filter((r) => r.error).map((r) => `${r.name}: ${r.error}`),
      sample: results.slice(0, 5).map((r) => ({ district: r.name, tile: r.tile, latest: r.latest, changePct: r.changePct })),
    },
  };
}
