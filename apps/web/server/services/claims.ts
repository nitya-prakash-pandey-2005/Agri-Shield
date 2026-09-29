/**
 * Claims validation — builds an evidence pack from real observations for a
 * claimed loss (location + loss date + peril) and scores how consistent the
 * claim is with the weather/hydrology/vegetation record.
 *
 * Evidence (all free, no keys):
 *  • ERA5 rainfall (1/3/5/30/60-day totals around the date) and its percentile vs
 *    the same calendar window in every year since 1991
 *  • GloFAS v4 discharge around the date and its percentile vs the full record
 *  • ERA5 Tmax, wind gusts, water balance, dry-spell length
 *  • MODIS MOD13Q1 NDVI before vs after (ORNL DAAC, optional)
 *  • NASA GIBS / Worldview observed-flood layer link for the date
 *
 * Each signal gives a 0–1 "support" value; the peril-specific weighted mean is the
 * consistency score (0–100): ≥ 65 consistent · 40–64 partially consistent · < 40 not supported.
 */
import { audit, getStore, nextId } from "../data/store";
import { getDailyHistory, getNdviSeries, getRecentForecastMany, gridKey, mergeHistoryAndForecast, type NdviSample } from "../live/history";
import { clamp, percentileRank } from "./risk-math";
import { restore, track } from "../persist";

export type ClaimPeril = "flood" | "excess_rain" | "drought" | "heat" | "cyclone";

export const CLAIM_PERILS: { value: ClaimPeril; label: string }[] = [
  { value: "flood", label: "Flood / inundation" },
  { value: "excess_rain", label: "Excess rain / waterlogging" },
  { value: "cyclone", label: "Cyclone / storm wind" },
  { value: "drought", label: "Drought / dry spell" },
  { value: "heat", label: "Heat stress" },
];

export interface EvidenceItem {
  key: string;
  label: string;
  value: string;
  detail: string;
  /** 0–1 how strongly this supports the claimed peril; null = not available */
  support: number | null;
  weight: number;
  source: string;
}

export interface ClaimValidation {
  id: string;
  workspaceId: string;
  createdAt: string;
  createdBy: string;
  input: { lat: number; lon: number; assetId: string | null; assetName: string | null; lossDate: string; peril: ClaimPeril; claimedUsd: number | null; notes: string };
  score: number;
  verdict: "consistent" | "partially_consistent" | "not_supported";
  summary: string;
  evidence: EvidenceItem[];
  rainSeries: { date: string; rain: number | null; tmax: number | null; discharge: number | null }[];
  ndvi: NdviSample[];
  ndviChangePct: number | null;
  floodLayerUrl: string;
  worldviewUrl: string;
  dataNotes: string[];
}

// ─── Pure helpers ────────────────────────────────────────────────────────

/** Sum of a[i0..i1] ignoring nulls, null if all missing. */
export function windowSum(a: (number | null)[], i0: number, i1: number): number | null {
  let s = 0;
  let n = 0;
  for (let i = Math.max(0, i0); i <= Math.min(a.length - 1, i1); i++) {
    if (a[i] != null) {
      s += a[i]!;
      n++;
    }
  }
  return n ? s : null;
}

export function windowMax(a: (number | null)[], i0: number, i1: number): number | null {
  let m: number | null = null;
  for (let i = Math.max(0, i0); i <= Math.min(a.length - 1, i1); i++) if (a[i] != null) m = m == null ? a[i]! : Math.max(m, a[i]!);
  return m;
}

/**
 * Climatology of an N-day window statistic for the same calendar period in every
 * year: for each year, evaluate `stat` over windows ending within ±`spread` days of
 * the loss day-of-year and keep the per-year max (so "wettest 5 days around this
 * time of year" is compared like with like).
 */
export function calendarClimatology(time: string[], lossIdx: number, stat: (end: number) => number | null, spread = 15): number[] {
  const md = time[lossIdx]!.slice(5);
  const lossYear = Number(time[lossIdx]!.slice(0, 4));
  const out: number[] = [];
  for (let i = 0; i < time.length; i++) {
    if (time[i]!.slice(5) !== md || Number(time[i]!.slice(0, 4)) === lossYear) continue;
    let best: number | null = null;
    for (let k = i - spread; k <= i + spread; k++) {
      if (k < 0 || k >= time.length) continue;
      const v = stat(k);
      if (v != null) best = best == null ? v : Math.max(best, v);
    }
    if (best != null) out.push(best);
  }
  return out;
}

export function longestDryRun(a: (number | null)[], i0: number, i1: number, mm = 1): number {
  let run = 0;
  let best = 0;
  for (let i = Math.max(0, i0); i <= Math.min(a.length - 1, i1); i++) {
    run = (a[i] ?? 0) < mm ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** Weighted mean of available supports → 0-100 and verdict. */
export function consistencyScore(items: { support: number | null; weight: number }[]) {
  const avail = items.filter((i) => i.support != null && i.weight > 0);
  const w = avail.reduce((t, i) => t + i.weight, 0);
  const score = w ? Math.round((avail.reduce((t, i) => t + i.support! * i.weight, 0) / w) * 100) : 0;
  const verdict: ClaimValidation["verdict"] = score >= 65 ? "consistent" : score >= 40 ? "partially_consistent" : "not_supported";
  return { score, verdict };
}

/** NDVI change after vs before the loss date (%, negative = vegetation loss). */
export function ndviChange(samples: NdviSample[], lossDate: string): { before: number | null; after: number | null; changePct: number | null } {
  const before = samples.filter((s) => s.date < lossDate).slice(-2);
  const after = samples.filter((s) => s.date >= lossDate).slice(0, 2);
  const avg = (a: NdviSample[]) => (a.length ? a.reduce((t, s) => t + s.ndvi, 0) / a.length : null);
  const b = avg(before);
  const a = avg(after);
  return { before: b, after: a, changePct: b != null && a != null && b > 0.05 ? Math.round(((a - b) / b) * 1000) / 10 : null };
}

const r1 = (v: number | null) => (v == null ? "—" : (Math.round(v * 10) / 10).toLocaleString("en-US"));
const pctTxt = (p: number) => `P${Math.round(p)}`;

// ─── Orchestration ────────────────────────────────────────────────────────

const g = globalThis as unknown as { __agriClaims?: ClaimValidation[] };
const CLAIMS_VERSION = 1;
track("claims", CLAIMS_VERSION, () => g.__agriClaims);
const claimsStore = () => (g.__agriClaims ??= restore<ClaimValidation[]>("claims", CLAIMS_VERSION, Array.isArray) ?? []);

export function listClaims(workspaceId: string) {
  return claimsStore()
    .filter((c) => c.workspaceId === workspaceId)
    .slice(0, 50);
}

export async function validateClaim(
  workspaceId: string,
  user: { id: string; name: string },
  input: { lat: number; lon: number; assetId?: string | null; lossDate: string; peril: ClaimPeril; claimedUsd?: number | null; notes?: string }
): Promise<ClaimValidation> {
  const asset = input.assetId ? getStore().assets.find((a) => a.id === input.assetId && a.workspaceId === workspaceId) : undefined;
  const lat = asset?.lat ?? input.lat;
  const lon = asset?.lon ?? input.lon;
  const h = await getDailyHistory({ lat, lon });
  if (!h) throw new Error("Historical weather record is unavailable for this location right now — try again in a minute.");
  const recent = (await getRecentForecastMany([{ lat, lon }]).catch(() => new Map())).get(gridKey({ lat, lon }));
  const m = mergeHistoryAndForecast(h, recent);
  const notes: string[] = [];
  const li = m.time.indexOf(input.lossDate);
  if (li < 0) throw new Error(`Loss date ${input.lossDate} is outside the available record (1991 → yesterday).`);
  if (li > m.lastObsIdx) notes.push("Loss date is within the last few days — values after the latest analysis are forecast, not observations.");
  if (li > h.time.length - 1) notes.push("ERA5 lags ~5 days; the most recent days use the Open-Meteo analysis feed.");

  const { rain, tmax, et0, gust, discharge, time } = m;
  const ev: EvidenceItem[] = [];
  const peril = input.peril;
  const add = (e: EvidenceItem) => ev.push(e);
  const ERA5 = "ERA5 via Open-Meteo";

  // Rainfall around the date (window ending up to 2 days after the loss date)
  const sum5 = (end: number) => windowSum(rain, end - 4, end);
  const sum3 = (end: number) => windowSum(rain, end - 2, end);
  const sum1 = (end: number) => (rain[end] ?? null);
  const best = (f: (e: number) => number | null, a: number, b: number) => {
    let v: number | null = null;
    for (let e = a; e <= b; e++) {
      const x = f(e);
      if (x != null) v = v == null ? x : Math.max(v, x);
    }
    return v;
  };
  const r5 = best(sum5, li - 2, li + 2);
  const r3 = best(sum3, li - 2, li + 2);
  const r1d = best(sum1, li - 3, li + 1);
  const clim5 = calendarClimatology(time, li, sum5, 2);
  const clim1 = calendarClimatology(time, li, sum1, 3);
  const p5 = r5 == null ? NaN : percentileRank(r5, clim5);
  const p1 = r1d == null ? NaN : percentileRank(r1d, clim1);
  const wet = peril === "flood" || peril === "excess_rain" || peril === "cyclone";
  add({
    key: "rain5",
    label: "Wettest 5 days around loss date",
    value: `${r1(r5)} mm`,
    detail: Number.isFinite(p5) ? `${pctTxt(p5)} of the same calendar window in ${clim5.length} other years` : "no climatology",
    support: !wet || !Number.isFinite(p5) ? (peril === "drought" && Number.isFinite(p5) ? clamp((50 - p5) / 40) : null) : clamp((p5 - 70) / 25) * 0.6 + clamp(((r5 ?? 0) - 80) / 170) * 0.4,
    weight: peril === "excess_rain" ? 0.35 : peril === "flood" ? 0.3 : peril === "cyclone" ? 0.2 : 0,
    source: ERA5,
  });
  add({
    key: "rain1",
    label: "Heaviest single day (±3 d)",
    value: `${r1(r1d)} mm`,
    detail: Number.isFinite(p1) ? `${pctTxt(p1)} vs the same week in other years` : "—",
    support: wet && Number.isFinite(p1) ? clamp((p1 - 75) / 22) : null,
    weight: peril === "excess_rain" ? 0.2 : peril === "cyclone" ? 0.1 : peril === "flood" ? 0.1 : 0,
    source: ERA5,
  });
  const ante = windowSum(rain, li - 30, li - 1);
  const climAnte = calendarClimatology(time, li, (e) => windowSum(rain, e - 30, e - 1), 0);
  const pAnte = ante == null ? NaN : percentileRank(ante, climAnte);
  add({
    key: "antecedent",
    label: "Rain in the 30 days before",
    value: `${r1(ante)} mm`,
    detail: Number.isFinite(pAnte) ? `${pctTxt(pAnte)} — ${pAnte > 66 ? "soils likely saturated" : pAnte < 33 ? "dry antecedent conditions" : "near normal"}` : "—",
    support: Number.isFinite(pAnte) ? (wet ? clamp((pAnte - 40) / 50) : peril === "drought" ? clamp((60 - pAnte) / 50) : null) : null,
    weight: peril === "flood" ? 0.1 : peril === "drought" ? 0.2 : 0,
    source: ERA5,
  });

  // River discharge
  if (discharge && discharge.some((v) => v != null && v > 0)) {
    const dmax = windowMax(discharge, li - 5, li + 3);
    const allDis = discharge.filter((v): v is number => v != null);
    const pd = dmax == null ? NaN : percentileRank(dmax, allDis);
    const med = allDis.length ? [...allDis].sort((a, b) => a - b)[Math.floor(allDis.length / 2)]! : 0;
    add({
      key: "discharge",
      label: "Peak river discharge (−5/+3 d)",
      value: `${r1(dmax)} m³/s`,
      detail: Number.isFinite(pd) ? `${pctTxt(pd)} of all days since 1991 · ${med > 0 && dmax != null ? `${(dmax / med).toFixed(1)}× median flow` : ""}` : "—",
      support: Number.isFinite(pd) ? (peril === "flood" ? clamp((pd - 85) / 13) : peril === "cyclone" || peril === "excess_rain" ? clamp((pd - 85) / 13) : peril === "drought" ? clamp((30 - pd) / 30) : null) : null,
      weight: peril === "flood" ? 0.35 : peril === "cyclone" ? 0.1 : peril === "excess_rain" ? 0.1 : peril === "drought" ? 0.1 : 0,
      source: "GloFAS v4 (Copernicus EMS)",
    });
  } else {
    add({ key: "discharge", label: "Peak river discharge", value: "n/a", detail: "No GloFAS river cell with flow at this point (small catchment / coastal cell)", support: null, weight: 0, source: "GloFAS v4" });
    if (peril === "flood") notes.push("No river-discharge signal at this location; flood evidence relies on rainfall and satellite layers.");
  }

  // Wind (cyclone)
  const gmax = windowMax(gust, li - 2, li + 1);
  const climG = calendarClimatology(time, li, (e) => gust[e] ?? null, 3);
  const pg = gmax == null ? NaN : percentileRank(gmax, climG);
  add({
    key: "gust",
    label: "Max wind gust (−2/+1 d)",
    value: `${r1(gmax)} km/h`,
    detail: Number.isFinite(pg) ? `${pctTxt(pg)} for this time of year${(gmax ?? 0) >= 62 ? " · gale force or stronger" : ""}` : "—",
    support: peril === "cyclone" && gmax != null ? clamp((gmax - 45) / 45) * 0.6 + (Number.isFinite(pg) ? clamp((pg - 80) / 18) * 0.4 : 0) : null,
    weight: peril === "cyclone" ? 0.45 : 0,
    source: ERA5,
  });

  // Drought signals
  const wb60 = (() => {
    let s = 0;
    let n = 0;
    for (let i = li - 60; i <= li; i++) {
      if (i < 0 || rain[i] == null || et0[i] == null) continue;
      s += rain[i]! - et0[i]!;
      n++;
    }
    return n ? s : null;
  })();
  const climWb = calendarClimatology(
    time,
    li,
    (e) => {
      let s = 0;
      let n = 0;
      for (let i = e - 60; i <= e; i++) if (i >= 0 && rain[i] != null && et0[i] != null) (s += rain[i]! - et0[i]!), n++;
      return n > 50 ? -s : null; // max of deficit
    },
    0
  ).map((v) => -v);
  const pwb = wb60 == null ? NaN : percentileRank(wb60, climWb);
  const dry = longestDryRun(rain, li - 60, li);
  add({
    key: "waterbalance",
    label: "60-day water balance (rain − ET0)",
    value: `${r1(wb60)} mm`,
    detail: Number.isFinite(pwb) ? `${pctTxt(pwb)} (lower = drier) · longest dry spell ${dry} days` : `longest dry spell ${dry} days`,
    support: peril === "drought" && Number.isFinite(pwb) ? clamp((35 - pwb) / 30) * 0.7 + clamp((dry - 10) / 20) * 0.3 : null,
    weight: peril === "drought" ? 0.45 : 0,
    source: ERA5,
  });

  // Heat
  const tpk = windowMax(tmax, li - 7, li);
  const climT = calendarClimatology(time, li, (e) => tmax[e] ?? null, 7);
  const pt = tpk == null ? NaN : percentileRank(tpk, climT);
  let hot = 0;
  for (let i = li - 14; i <= li; i++) if ((tmax[i] ?? 0) >= 35) hot++;
  add({
    key: "tmax",
    label: "Peak Tmax (week before)",
    value: `${r1(tpk)} °C`,
    detail: `${Number.isFinite(pt) ? `${pctTxt(pt)} for the season · ` : ""}${hot} day(s) ≥ 35 °C in the 2 weeks before`,
    support: peril === "heat" && tpk != null ? clamp((tpk - 34) / 6) * 0.5 + (Number.isFinite(pt) ? clamp((pt - 75) / 23) * 0.3 : 0) + clamp(hot / 7) * 0.2 : null,
    weight: peril === "heat" ? 0.7 : 0,
    source: ERA5,
  });

  // NDVI (optional)
  let ndvi: NdviSample[] = [];
  let ndviPct: number | null = null;
  try {
    const d0 = new Date(Date.parse(input.lossDate) - 50 * 86_400_000);
    const d1 = new Date(Math.min(Date.now(), Date.parse(input.lossDate) + 45 * 86_400_000));
    ndvi = await getNdviSeries({ lat, lon }, d0, d1);
    const ch = ndviChange(ndvi, input.lossDate);
    ndviPct = ch.changePct;
    add({
      key: "ndvi",
      label: "Vegetation (MODIS NDVI) change",
      value: ch.changePct == null ? "insufficient scenes" : `${ch.changePct > 0 ? "+" : ""}${ch.changePct}%`,
      detail: ch.before != null && ch.after != null ? `NDVI ${ch.before.toFixed(2)} before → ${ch.after.toFixed(2)} after (250 m, 16-day composite)` : "Cloud cover or date too recent for a 16-day composite",
      support: ch.changePct == null ? null : clamp(-ch.changePct / 25),
      weight: 0.2,
      source: "NASA MODIS MOD13Q1 via ORNL DAAC",
    });
  } catch {
    add({ key: "ndvi", label: "Vegetation (MODIS NDVI) change", value: "unavailable", detail: "ORNL MODIS service did not respond — score uses weather & river evidence only", support: null, weight: 0.2, source: "NASA MODIS MOD13Q1 via ORNL DAAC" });
  }

  const { score, verdict } = consistencyScore(ev);
  const main = ev.filter((e) => e.support != null && e.weight > 0).sort((a, b) => b.weight * (b.support ?? 0) - a.weight * (a.support ?? 0));
  const perilLabel = CLAIM_PERILS.find((p) => p.value === peril)!.label.toLowerCase();
  const summary =
    verdict === "consistent"
      ? `The record supports a ${perilLabel} loss around ${input.lossDate}: ${main.slice(0, 2).map((e) => `${e.label.toLowerCase()} ${e.value} (${e.detail.split(" ·")[0]})`).join("; ")}.`
      : verdict === "partially_consistent"
        ? `Some evidence of ${perilLabel} around ${input.lossDate}, but not conclusive — ${main[0] ? `${main[0].label.toLowerCase()} ${main[0].value}` : "limited signals"}. Recommend a field visit or photo evidence.`
        : `Observed conditions around ${input.lossDate} do not indicate ${perilLabel} at this location (${main[0] ? `${main[0].label.toLowerCase()} ${main[0].value}, ${main[0].detail.split(" ·")[0]}` : "no signal"}). Escalate for investigation before settlement.`;

  const d = input.lossDate;
  const dd = 0.6;
  const rec: ClaimValidation = {
    id: nextId("clm"),
    workspaceId,
    createdAt: new Date().toISOString(),
    createdBy: user.name,
    input: { lat, lon, assetId: asset?.id ?? null, assetName: asset?.name ?? null, lossDate: d, peril, claimedUsd: input.claimedUsd ?? null, notes: input.notes ?? "" },
    score,
    verdict,
    summary,
    evidence: ev,
    rainSeries: time.slice(Math.max(0, li - 30), li + 21).map((t, k) => {
      const i = Math.max(0, li - 30) + k;
      return { date: t, rain: rain[i] ?? null, tmax: tmax[i] ?? null, discharge: discharge?.[i] ?? null };
    }),
    ndvi,
    ndviChangePct: ndviPct,
    floodLayerUrl: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Combined_Flood_2-Day/default/${d}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png`,
    worldviewUrl: `https://worldview.earthdata.nasa.gov/?v=${(lon - dd).toFixed(2)},${(lat - dd).toFixed(2)},${(lon + dd).toFixed(2)},${(lat + dd).toFixed(2)}&l=MODIS_Combined_Flood_2-Day,MODIS_Terra_CorrectedReflectance_TrueColor&t=${d}-T06:00:00Z`,
    dataNotes: notes,
  };
  claimsStore().unshift(rec);
  if (claimsStore().length > 300) claimsStore().length = 300;
  audit({ userId: user.id, userName: user.name, action: "validate", entity: "claim", entityId: rec.id, details: `${peril} on ${d} → ${verdict} (${score})` });
  return rec;
}
