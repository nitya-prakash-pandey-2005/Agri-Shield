/**
 * Climate-adjusted credit risk for agricultural loan books.
 *
 *  Baseline PD   ← internal rating (annual, through-the-cycle):
 *                  A 1.0% · BBB 2.5% · BB 5.0% · B 10% · CCC 20%
 *                  Delinquency overlay: DPD 1–29 ×1.5 · DPD 30–89 ×2.5 (Stage 2) · DPD ≥ 90 → default (Stage 3)
 *  Hazard freq.  ← ERA5 + GloFAS reanalysis at the loan's 0.25° cell (1995 → last full year):
 *                  flood    = share of years with max 5-day rain ≥ max(250 mm, local 1-in-5 level) OR peak river flow ≥ 2× its median annual peak,
 *                             scaled by floodplain exposure (0.5 + 0.5·exposure)
 *                  drought  = share of years with annual rain < 75 % of the long-term median
 *                  salinity = coastal salinity exposure × share of years whose Dec–Apr rain < 50 % of median (low flushing)
 *                  heat     = share of years with hot days (Tmax ≥ 35 °C) ≥ max(10, 2 × the local median count)
 *                  current quarter: an active live hazard (score ≥ 40) lifts p toward the live score with 15 % weight
 *  Climate PD    = 1 − (1 − PD_base) · Π_h (1 − p_h · s_crop,h · k_h · m_segment)
 *                  k (extra default probability in a severe hazard year): flood 8 %, drought 6 %, salinity 6 %, heat 3 %
 *                  (the internal rating already reflects normal-year climate; only severe years add risk)
 *                  m_segment: smallholder 1.0, SME 0.7 (more diversified income)
 *  LGD           ← collateral: land-use certificate 35 %, machinery 50 %, group guarantee 55 %, none 70 %
 *                  + climate haircut on land in flood-prone (+5 pp) or salinising (+5 pp) cells
 *  EAD           = outstanding balance
 *  EL (12 m)     = PD · LGD · EAD;  lifetime EL uses PD_life = 1 − (1 − PD)^(remaining months / 12)
 */
import type { CropType } from "@agri-shield/types";
import { getStore, type AssetRecord } from "../data/store";
import { getHistoryBatch, gridKey, type DailyHistory, type HistoryPoint } from "../live/history";
import { assessMany, exposurePriors } from "./location-risk";
import { refPoint } from "./parametric";
import { clamp, mean, normCdf, normInv, quantile } from "./risk-math";

export type Hazard = "flood" | "drought" | "salinity" | "heat";
export const HAZARDS: Hazard[] = ["flood", "drought", "salinity", "heat"];

export const RATING_PD: Record<string, number> = { A: 0.01, BBB: 0.025, BB: 0.05, B: 0.1, CCC: 0.2 };
export const RATING_ORDER = ["A", "BBB", "BB", "B", "CCC", "D"] as const;
export type Rating = (typeof RATING_ORDER)[number];
/** Upper PD bound of each band (used to map a climate-adjusted PD back to a rating). */
export const RATING_BANDS: [Rating, number][] = [
  ["A", 0.015],
  ["BBB", 0.035],
  ["BB", 0.075],
  ["B", 0.15],
  ["CCC", 0.3],
  ["D", 1],
];

export const LGD_BY_COLLATERAL: Record<string, number> = { "Land-use certificate": 0.35, Machinery: 0.5, "Group guarantee": 0.55, None: 0.7 };
export const K_EVENT: Record<Hazard, number> = { flood: 0.08, drought: 0.06, salinity: 0.06, heat: 0.03 };

export const CROP_SENSITIVITY: Record<string, Record<Hazard, number>> = {
  rice: { flood: 1.0, drought: 0.8, salinity: 1.0, heat: 0.6 },
  vegetables: { flood: 0.9, drought: 0.9, salinity: 0.8, heat: 0.7 },
  maize: { flood: 0.8, drought: 0.9, salinity: 0.7, heat: 0.8 },
  onion: { flood: 0.9, drought: 0.7, salinity: 0.8, heat: 0.6 },
  wheat: { flood: 0.6, drought: 0.8, salinity: 0.7, heat: 0.9 },
  jute: { flood: 0.6, drought: 0.7, salinity: 0.6, heat: 0.4 },
  sugarcane: { flood: 0.5, drought: 0.7, salinity: 0.6, heat: 0.3 },
  coconut: { flood: 0.3, drought: 0.5, salinity: 0.5, heat: 0.3 },
  mango: { flood: 0.3, drought: 0.5, salinity: 0.4, heat: 0.5 },
};
const DEFAULT_SENS: Record<Hazard, number> = { flood: 0.7, drought: 0.7, salinity: 0.7, heat: 0.5 };
export const sensitivity = (crop: CropType | string | null) => (crop && CROP_SENSITIVITY[crop]) || DEFAULT_SENS;

export function ratingFromPd(pd: number): Rating {
  for (const [r, ub] of RATING_BANDS) if (pd <= ub) return r;
  return "D";
}
export const notchesBetween = (a: Rating, b: Rating) => RATING_ORDER.indexOf(b) - RATING_ORDER.indexOf(a);

export function baselinePd(rating: string, dpd: number): { pd: number; stage: 1 | 2 | 3 } {
  const base = RATING_PD[rating] ?? 0.05;
  if (dpd >= 90) return { pd: 1, stage: 3 };
  if (dpd >= 30) return { pd: Math.min(0.5, base * 2.5), stage: 2 };
  if (dpd > 0) return { pd: Math.min(0.5, base * 1.5), stage: 1 };
  return { pd: base, stage: 1 };
}

export interface HazardFreq {
  flood: number;
  drought: number;
  salinity: number;
  heat: number;
  years: number;
  /** evidence strings for plain-language drivers */
  evidence: Record<Hazard, string>;
}

/** Annual frequency of damaging hazard years from a daily reanalysis history (pure). */
export function hazardFrequencies(h: DailyHistory, exposure: { flood: number; salinity: number }, startYear = 1995): HazardFreq {
  const lastYear = Number((h.time[h.time.length - 1] ?? "2000").slice(0, 4)) - 1; // last complete year
  const byYear = new Map<number, { rain: number; n: number; rx5: number; dis: number; hot: number; dryRain: number }>();
  const q: number[] = [];
  for (let i = 0; i < h.time.length; i++) {
    const y = Number(h.time[i]!.slice(0, 4));
    const m = Number(h.time[i]!.slice(5, 7));
    if (y < startYear || y > lastYear) continue;
    const e = byYear.get(y) ?? { rain: 0, n: 0, rx5: 0, dis: 0, hot: 0, dryRain: 0 };
    const r = h.rain[i] ?? 0;
    e.rain += r;
    e.n++;
    q.push(r);
    if (q.length > 5) q.shift();
    e.rx5 = Math.max(e.rx5, q.reduce((a, b) => a + b, 0));
    e.dis = Math.max(e.dis, h.discharge?.[i] ?? 0);
    if ((h.tmax[i] ?? 0) >= 35) e.hot++;
    if (m <= 4) e.dryRain += r;
    byYear.set(y, e);
  }
  // Dec rain belongs to the following dry season
  for (let i = 0; i < h.time.length; i++) {
    const y = Number(h.time[i]!.slice(0, 4));
    if (h.time[i]!.slice(5, 7) === "12" && byYear.has(y + 1)) byYear.get(y + 1)!.dryRain += h.rain[i] ?? 0;
  }
  const ys = [...byYear.entries()].filter(([, e]) => e.n > 330).map(([y, e]) => ({ y, ...e }));
  const n = ys.length || 1;
  const medRain = quantile(ys.map((e) => e.rain), 0.5);
  const medDis = quantile(ys.map((e) => e.dis), 0.5);
  const medDry = quantile(ys.map((e) => e.dryRain), 0.5);
  const disUsable = medDis > 5;
  const medHot = quantile(ys.map((e) => e.hot), 0.5);
  // severe = above an absolute damage floor AND in the locally worst ~1-in-5 seasons
  const rx5Thr = Math.max(250, quantile(ys.map((e) => e.rx5), 0.8));
  const floodYears = ys.filter((e) => e.rx5 >= rx5Thr || (disUsable && e.dis >= 2 * medDis));
  const droughtYears = ys.filter((e) => e.rain < 0.75 * medRain);
  const lowFlushYears = ys.filter((e) => e.dryRain < 0.5 * medDry);
  const heatYears = ys.filter((e) => e.hot >= Math.max(10, 2 * medHot));
  const floodRaw = floodYears.length / n;
  const flood = clamp(floodRaw * (0.5 + 0.5 * exposure.flood));
  const salinity = exposure.salinity > 0.2 ? clamp(exposure.salinity * Math.max(0.05, lowFlushYears.length / n)) : 0;
  const list = (a: { y: number }[]) => (a.length ? a.slice(-4).map((e) => e.y).join(", ") : "none");
  return {
    flood,
    drought: droughtYears.length / n,
    salinity,
    heat: heatYears.length / n,
    years: ys.length,
    evidence: {
      flood: `${floodYears.length} of ${ys.length} years had a severe flood signal (5-day rain ≥ ${Math.round(rx5Thr)} mm${disUsable ? " or river peak ≥ 2× normal" : ""}; latest ${list(floodYears)})`,
      drought: `${droughtYears.length} of ${ys.length} years had < 75 % of normal rainfall (latest ${list(droughtYears)})`,
      salinity: exposure.salinity > 0.2 ? `coastal salinity exposure ${(exposure.salinity * 100).toFixed(0)} %; ${lowFlushYears.length} low-flushing dry seasons (latest ${list(lowFlushYears)})` : "inland — no salinity exposure",
      heat: `${heatYears.length} of ${ys.length} years had ≥ ${Math.max(10, Math.round(2 * medHot))} days above 35 °C (twice the local norm)`,
    },
  };
}

/** Climate-adjusted annual PD. `p` = annual hazard probabilities, `severity` multiplies k (stress tests). */
export function climatePd(pdBase: number, p: Record<Hazard, number>, sens: Record<Hazard, number>, segment: "smallholder" | "sme", severity: Partial<Record<Hazard, number>> = {}): number {
  if (pdBase >= 1) return 1;
  const m = segment === "sme" ? 0.7 : 1;
  let surv = 1 - pdBase;
  for (const hz of HAZARDS) surv *= 1 - clamp(p[hz] * sens[hz] * K_EVENT[hz] * m * (severity[hz] ?? 1));
  return clamp(1 - surv);
}

export function lgdFor(collateral: string, p: Record<Hazard, number>, extraPp = 0): number {
  const base = LGD_BY_COLLATERAL[collateral] ?? 0.6;
  let adj = 0;
  if (collateral === "Land-use certificate") {
    if (p.flood >= 0.25) adj += 0.05;
    if (p.salinity >= 0.2) adj += 0.05;
  } else if (collateral === "Machinery" && p.flood >= 0.25) adj += 0.03;
  return clamp(base + adj + extraPp, 0, 0.95);
}

/** Basel II/III IRB capital requirement K for "other retail" exposures (per unit EAD). */
export function irbRetailK(pd: number, lgd: number): number {
  if (pd >= 1) return 0; // defaulted — covered by specific provisions
  const p = Math.max(0.0003, pd);
  const w = (1 - Math.exp(-35 * p)) / (1 - Math.exp(-35));
  const R = 0.03 * w + 0.16 * (1 - w);
  const k = lgd * (normCdf((normInv(p) + Math.sqrt(R) * normInv(0.999)) / Math.sqrt(1 - R)) - p);
  return Math.max(0, k);
}

export const lifetimePd = (pd: number, months: number) => (pd >= 1 ? 1 : 1 - Math.pow(1 - pd, Math.max(1, months) / 12));

// ─── Loan assessment ──────────────────────────────────────────────────────

export interface LoanRisk {
  id: string;
  name: string;
  ref: string | null;
  lat: number;
  lon: number;
  crop: string | null;
  region: string;
  province: string;
  country: string;
  segment: "smallholder" | "sme";
  collateral: string;
  principalUsd: number;
  eadUsd: number;
  tenorMonths: number;
  remainingMonths: number;
  dpd: number;
  stage: 1 | 2 | 3;
  ratingBase: Rating;
  ratingClimate: Rating;
  notches: number;
  pdBase: number;
  pdClimate: number;
  lgdBase: number;
  lgd: number;
  elBaseUsd: number;
  elUsd: number;
  elUpliftUsd: number;
  lifetimeElUsd: number;
  hazardProb: Record<Hazard, number>;
  hazardContribPp: Record<Hazard, number>;
  live: { flood: number; salinity: number; drought: number; heat: number; composite: number; drivers: string[] } | null;
  activeHazard: string | null;
  drivers: string[];
  dataSource: "reanalysis" | "district-prior";
}

export interface LoanContext {
  freq: HazardFreq | null;
  exposure: { flood: number; salinity: number };
}

export function assessLoan(a: AssetRecord, ctx: LoanContext, region: string, province: string): LoanRisk {
  const meta = a.meta;
  const rating = String(meta.internalRating ?? "BB");
  const dpd = Number(meta.daysPastDue ?? 0);
  const principal = Number(meta.principalUsd ?? a.valueUsd);
  const tenor = Number(meta.tenorMonths ?? 12);
  const segment: "smallholder" | "sme" = a.tags.includes("sme") || principal > 10000 ? "sme" : "smallholder";
  const collateral = String(meta.collateral ?? "None");
  const { pd: pdBase, stage } = baselinePd(rating, dpd);
  const sens = sensitivity(a.crop);
  // historical frequencies (or district-prior fallback when history is unavailable)
  const hist: Record<Hazard, number> = ctx.freq
    ? { flood: ctx.freq.flood, drought: ctx.freq.drought, salinity: ctx.freq.salinity, heat: ctx.freq.heat }
    : { flood: 0.1 + 0.3 * ctx.exposure.flood, drought: 0.15, salinity: ctx.exposure.salinity > 0.2 ? 0.3 * ctx.exposure.salinity : 0, heat: 0.1 };
  const la = a.lastAssessment;
  const live = la ? { flood: la.floodRisk / 100, salinity: la.salinityRisk / 100, drought: la.droughtRisk / 100, heat: la.heatRisk / 100 } : null;
  // an active live hazard (score ≥ 40) lifts the current quarter toward the live score (15 % weight)
  const p: Record<Hazard, number> = { ...hist };
  if (live) for (const hz of HAZARDS) if (live[hz] >= 0.4) p[hz] = clamp(hist[hz] + 0.15 * Math.max(0, live[hz] - hist[hz]));
  const pdC = climatePd(pdBase, p, sens, segment);
  const contrib = {} as Record<Hazard, number>;
  for (const hz of HAZARDS) {
    const without = climatePd(pdBase, { ...p, [hz]: 0 }, sens, segment);
    contrib[hz] = Math.round((pdC - without) * 10000) / 100; // pp
  }
  const lgdBase = LGD_BY_COLLATERAL[collateral] ?? 0.6;
  const lgd = lgdFor(collateral, p);
  const ead = a.valueUsd;
  const remaining = Math.max(1, Math.round(tenor * clamp(ead / Math.max(1, principal), 0.05, 1)));
  const rb = RATING_ORDER.includes(rating as Rating) ? (rating as Rating) : ratingFromPd(pdBase);
  const ratingBase = stage === 3 ? "D" : dpd >= 30 ? ratingFromPd(pdBase) : rb;
  const ratingClimate = stage === 3 ? "D" : ratingFromPd(pdC);
  const elBase = pdBase * lgdBase * ead;
  const el = pdC * lgd * ead;
  const activeHazard = la
    ? la.floodRisk >= 50
      ? `Flood ${la.floodRisk}% (72 h)`
      : la.salinityRisk >= 60
        ? `Salinity ${la.salinityRisk}/100`
        : la.composite >= 60
          ? `Composite ${la.composite}/100`
          : la.droughtRisk >= 60
            ? `Drought ${la.droughtRisk}/100`
            : null
    : null;
  // plain-language drivers
  const cropName = a.crop ?? "farm";
  const drivers: string[] = [];
  const ranked = HAZARDS.map((hz) => [hz, contrib[hz]] as const)
    .filter(([, v]) => v >= 0.05)
    .sort((x, y) => y[1] - x[1]);
  for (const [hz, pp] of ranked.slice(0, 3)) {
    const ev = ctx.freq?.evidence[hz] ?? `district prior (${Math.round(hist[hz] * 100)} % a year)`;
    drivers.push(`${hz[0]!.toUpperCase()}${hz.slice(1)}: ${ev} → +${pp.toFixed(2)} pp PD for a ${cropName} ${segment === "sme" ? "business" : "smallholder"} (crop sensitivity ${Math.round(sens[hz] * 100)} %).`);
  }
  if (lgd > lgdBase) drivers.push(`Collateral (${collateral.toLowerCase()}) sits in a ${p.flood >= 0.25 ? "flood-prone" : "salinising"} area — recovery value haircut +${Math.round((lgd - lgdBase) * 100)} pp LGD.`);
  if (activeHazard) drivers.push(`Live forecast: ${activeHazard} — near-term repayment stress likely.`);
  if (dpd > 0) drivers.push(`${dpd} days past due — ${stage === 3 ? "in default (Stage 3)" : stage === 2 ? "significant increase in credit risk (Stage 2)" : "early arrears"}.`);
  if (!drivers.length) drivers.push("No material climate driver — historical hazard frequencies are low for this location and crop.");
  return {
    id: a.id,
    name: a.name,
    ref: a.externalRef,
    lat: a.lat,
    lon: a.lon,
    crop: a.crop,
    region,
    province,
    country: a.country,
    segment,
    collateral,
    principalUsd: principal,
    eadUsd: ead,
    tenorMonths: tenor,
    remainingMonths: remaining,
    dpd,
    stage,
    ratingBase,
    ratingClimate,
    notches: notchesBetween(ratingBase, ratingClimate),
    pdBase,
    pdClimate: pdC,
    lgdBase,
    lgd,
    elBaseUsd: elBase,
    elUsd: el,
    elUpliftUsd: el - elBase,
    lifetimeElUsd: lifetimePd(pdC, remaining) * lgd * ead,
    hazardProb: p,
    hazardContribPp: contrib,
    live: la ? { flood: la.floodRisk, salinity: la.salinityRisk, drought: la.droughtRisk, heat: la.heatRisk, composite: la.composite, drivers: la.drivers } : null,
    activeHazard,
    drivers,
    dataSource: ctx.freq ? "reanalysis" : "district-prior",
  };
}

// ─── Book orchestration ───────────────────────────────────────────────────

/** Fill missing lastAssessment via the batched location engine (same shape the portfolio job writes). */
export async function ensureAssessments(assets: AssetRecord[]) {
  const missing = assets.filter((a) => !a.lastAssessment);
  if (!missing.length) return;
  try {
    const res = await assessMany(missing.map((a) => ({ id: a.id, lat: a.lat, lon: a.lon, crop: a.crop })));
    const now = new Date();
    for (const a of missing) {
      const q = res.get(a.id);
      if (!q) continue;
      a.lastAssessment = { at: now, floodRisk: q.floodRisk, salinityRisk: q.salinityRisk, droughtRisk: q.droughtRisk, heatRisk: q.heatRisk, composite: q.composite, level: q.level === "critical" ? "critical" : q.level, drivers: q.drivers, source: q.source };
    }
  } catch {
    /* live scoring optional — PD falls back to historical frequencies only */
  }
}

const gc = globalThis as unknown as { __agriCredit?: Map<string, { at: number; v: Promise<CreditBook>; ttl: number }> };
const creditCache = (gc.__agriCredit ??= new Map());

export interface CreditBook {
  generatedAt: string;
  loans: LoanRisk[];
  freqByCell: Map<string, HazardFreq>;
  cells: HistoryPoint[];
  /** reference locations still downloading - results use district priors meanwhile */
  pending: number;
  providers: string[];
}

export async function creditBook(workspaceId: string, force = false): Promise<CreditBook> {
  const hit = creditCache.get(workspaceId);
  if (!force && hit && Date.now() - hit.at < hit.ttl) return hit.v;
  const v = (async () => {
    const s = getStore();
    const loans = s.assets.filter((a) => a.workspaceId === workspaceId && a.status === "active" && a.type === "loan");
    await ensureAssessments(loans);
    const cells = new Map<string, HistoryPoint>();
    for (const a of loans) cells.set(gridKey(refPoint(a)), refPoint(a));
    const batch = await getHistoryBatch([...cells.values()], { mode: "partial", budgetMs: 25_000 });
    const hist = batch.map;
    const freqByCell = new Map<string, HazardFreq>();
    const dist = new Map(s.districts.map((d) => [d.id, d]));
    const out: LoanRisk[] = [];
    for (const a of loans) {
      const k = gridKey(refPoint(a));
      const pri = exposurePriors(a.lat, a.lon);
      const exposure = { flood: pri.flood, salinity: pri.salinity };
      let freq = freqByCell.get(k) ?? null;
      const h = hist.get(k);
      if (!freq && h) {
        freq = hazardFrequencies(h, exposure);
        freqByCell.set(k, freq);
      }
      const d = a.districtId ? dist.get(a.districtId) : undefined;
      out.push(assessLoan(a, { freq, exposure }, d?.name ?? a.country, d?.name ?? "—"));
    }
    return { generatedAt: new Date().toISOString(), loans: out, freqByCell, cells: [...cells.values()], pending: batch.pending, providers: batch.providers };
  })().catch((e) => {
    creditCache.delete(workspaceId);
    throw e;
  });
  const entry = { at: Date.now(), v, ttl: 30 * 60_000 };
  creditCache.set(workspaceId, entry);
  void v.then((r) => r.pending > 0 && (entry.ttl = 10_000)).catch(() => undefined);
  return v;
}

export function creditCacheBust(workspaceId: string) {
  creditCache.delete(workspaceId);
}

export function portfolioSummary(loans: LoanRisk[]) {
  const ead = loans.reduce((t, l) => t + l.eadUsd, 0);
  const el = loans.reduce((t, l) => t + l.elUsd, 0);
  const elBase = loans.reduce((t, l) => t + l.elBaseUsd, 0);
  const wavg = (f: (l: LoanRisk) => number) => (ead ? loans.reduce((t, l) => t + f(l) * l.eadUsd, 0) / ead : 0);
  const byRating = RATING_ORDER.map((r) => ({
    rating: r,
    baseCount: loans.filter((l) => l.ratingBase === r).length,
    climateCount: loans.filter((l) => l.ratingClimate === r).length,
    baseEadUsd: loans.filter((l) => l.ratingBase === r).reduce((t, l) => t + l.eadUsd, 0),
    climateEadUsd: loans.filter((l) => l.ratingClimate === r).reduce((t, l) => t + l.eadUsd, 0),
  }));
  const group = (key: (l: LoanRisk) => string) => {
    const m = new Map<string, LoanRisk[]>();
    for (const l of loans) m.set(key(l), [...(m.get(key(l)) ?? []), l]);
    return [...m.entries()]
      .map(([k, ls]) => ({
        key: k,
        loans: ls.length,
        eadUsd: ls.reduce((t, l) => t + l.eadUsd, 0),
        elUsd: ls.reduce((t, l) => t + l.elUsd, 0),
        elBaseUsd: ls.reduce((t, l) => t + l.elBaseUsd, 0),
        pdClimatePct: (ls.reduce((t, l) => t + l.pdClimate * l.eadUsd, 0) / Math.max(1, ls.reduce((t, l) => t + l.eadUsd, 0))) * 100,
      }))
      .sort((a, b) => b.eadUsd - a.eadUsd);
  };
  const byCrop = group((l) => l.crop ?? "other");
  const byRegion = group((l) => `${l.region} (${l.country === "Vietnam" ? "VN" : l.country === "Philippines" ? "PH" : l.country})`);
  const crops = byCrop.map((c) => c.key);
  const heat = byRegion.map((r) => ({
    region: r.key,
    cells: crops.map((c) => {
      const ls = loans.filter((l) => `${l.region} (${l.country === "Vietnam" ? "VN" : l.country === "Philippines" ? "PH" : l.country})` === r.key && (l.crop ?? "other") === c);
      const e = ls.reduce((t, l) => t + l.eadUsd, 0);
      return { crop: c, eadUsd: e, elUsd: ls.reduce((t, l) => t + l.elUsd, 0), upliftPct: e ? (ls.reduce((t, l) => t + l.elUpliftUsd, 0) / Math.max(1, ls.reduce((t, l) => t + l.elBaseUsd, 0))) * 100 : 0, loans: ls.length };
    }),
  }));
  const hazardShare = HAZARDS.map((hz) => ({ hazard: hz, pp: wavg((l) => l.hazardContribPp[hz]) }));
  return {
    loans: loans.length,
    eadUsd: ead,
    elUsd: el,
    elBaseUsd: elBase,
    elUpliftUsd: el - elBase,
    elUpliftPct: elBase ? ((el - elBase) / elBase) * 100 : 0,
    lifetimeElUsd: loans.reduce((t, l) => t + l.lifetimeElUsd, 0),
    pdBasePct: wavg((l) => l.pdBase) * 100,
    pdClimatePct: wavg((l) => l.pdClimate) * 100,
    lgdPct: wavg((l) => l.lgd) * 100,
    downgraded: loans.filter((l) => l.notches > 0).length,
    downgradedEadUsd: loans.filter((l) => l.notches > 0).reduce((t, l) => t + l.eadUsd, 0),
    stage2: loans.filter((l) => l.stage === 2).length,
    stage3: loans.filter((l) => l.stage === 3).length,
    byRating,
    byCrop,
    byRegion,
    heatmap: { crops, rows: heat },
    hazardShare,
    avgHazardProb: Object.fromEntries(HAZARDS.map((hz) => [hz, mean(loans.map((l) => l.hazardProb[hz]))])) as Record<Hazard, number>,
  };
}
