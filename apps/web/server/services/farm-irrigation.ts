/**
 * FAO-56 irrigation scheduling (Allen et al., 1998, FAO Irrigation & Drainage Paper 56).
 *
 *  · ETc = Kc × ET0 — single crop coefficient, Kc curve from Table 12 (Kc ini/mid/end)
 *    and stage lengths from Table 11 (scaled to the field's actual season length).
 *  · Upland crops: root-zone depletion balance (eq. 85)
 *        Dr,i = Dr,i-1 − Pe,i − I,i + Ks·ETc,i      0 ≤ Dr ≤ TAW
 *    TAW = 1000 (θFC − θWP) Zr (eq. 82), RAW = p·TAW (eq. 83), Ks from eq. 84.
 *    Irrigate when Dr reaches RAW; apply Dr (refill to field capacity).
 *  · Paddy rice: ponded-water balance with Alternate Wetting & Drying (AWD, IRRI):
 *    keep 3–5 cm for 2 weeks after transplanting and around flowering, otherwise let
 *    the water fall to 15 cm below the soil surface, then re-flood to 5 cm. Drain
 *    ~14 days before harvest.
 *  · Effective rainfall (daily): < 5 mm is lost to interception/evaporation; 80 % of the
 *    rest is effective (FAO/USDA rule of thumb). Forecast rain is weighted by its
 *    probability so a 30 % chance of rain doesn't cancel an irrigation.
 *
 * Pure functions — no I/O — so they are unit-tested and reusable offline.
 */

export type IrrCrop = "rice" | "jute" | "wheat" | "maize" | "sugarcane" | "vegetables" | "onion" | "coconut" | "mango" | "other";

export interface KcSpec {
  ini: number;
  mid: number;
  end: number;
  /** stage lengths in days (FAO-56 Table 11): initial, development, mid-season, late */
  stages: [number, number, number, number];
  /** maximum effective root depth (m) and depletion fraction p (Table 22) */
  zrMax: number;
  p: number;
  perennial?: boolean;
  source: string;
}

export const KC_TABLE: Record<IrrCrop, KcSpec> = {
  rice: { ini: 1.05, mid: 1.2, end: 0.75, stages: [30, 30, 60, 30], zrMax: 0.5, p: 0.2, source: "FAO-56 Tables 11/12 (rice, Asia)" },
  jute: { ini: 0.5, mid: 1.15, end: 0.8, stages: [25, 35, 45, 15], zrMax: 0.8, p: 0.5, source: "FAO-56 method; jute Kc from BJRI/ICAR field studies" },
  wheat: { ini: 0.3, mid: 1.15, end: 0.3, stages: [15, 25, 50, 30], zrMax: 1.2, p: 0.55, source: "FAO-56 Tables 11/12 (spring wheat)" },
  maize: { ini: 0.3, mid: 1.2, end: 0.5, stages: [20, 35, 40, 30], zrMax: 1.0, p: 0.55, source: "FAO-56 Tables 11/12 (grain maize)" },
  sugarcane: { ini: 0.4, mid: 1.25, end: 0.75, stages: [35, 60, 190, 120], zrMax: 1.2, p: 0.65, source: "FAO-56 Tables 11/12 (sugarcane, virgin)" },
  vegetables: { ini: 0.7, mid: 1.05, end: 0.95, stages: [20, 30, 30, 15], zrMax: 0.5, p: 0.35, source: "FAO-56 Tables 11/12 (small vegetables)" },
  onion: { ini: 0.7, mid: 1.05, end: 0.75, stages: [15, 25, 70, 40], zrMax: 0.4, p: 0.3, source: "FAO-56 Tables 11/12 (dry onion)" },
  coconut: { ini: 1.0, mid: 1.0, end: 1.0, stages: [0, 0, 365, 0], zrMax: 1.0, p: 0.65, perennial: true, source: "FAO-56 Table 12 (coconut palm)" },
  mango: { ini: 0.75, mid: 0.75, end: 0.75, stages: [0, 0, 365, 0], zrMax: 1.2, p: 0.6, perennial: true, source: "FAO-56 method; mango Kc from FAO Crop Water Information" },
  other: { ini: 0.5, mid: 1.1, end: 0.7, stages: [20, 30, 40, 20], zrMax: 0.8, p: 0.5, source: "FAO-56 generic field crop" },
};

export const toIrrCrop = (c: string): IrrCrop => (c in KC_TABLE ? (c as IrrCrop) : c === "potato" || c === "banana" ? "vegetables" : "other");

/** Available water θFC − θWP (m³/m³) and field capacity by soil type (FAO-56 Table 19, mid-range). */
export const SOIL_WATER: Record<string, { fc: number; wp: number; percolation: number; sy: number }> = {
  sandy: { fc: 0.12, wp: 0.04, percolation: 8, sy: 0.25 },
  loam: { fc: 0.3, wp: 0.15, percolation: 4, sy: 0.3 },
  silt: { fc: 0.33, wp: 0.16, percolation: 3, sy: 0.32 },
  clay: { fc: 0.4, wp: 0.24, percolation: 2, sy: 0.35 },
  peat: { fc: 0.55, wp: 0.3, percolation: 3, sy: 0.4 },
  chalky: { fc: 0.25, wp: 0.15, percolation: 6, sy: 0.25 },
};
const soilOf = (s: string) => SOIL_WATER[s] ?? SOIL_WATER.loam!;

export type Stage = "initial" | "development" | "mid" | "late" | "harvest" | "fallow";

/** Scale FAO stage lengths to the field's actual season length. */
export function stageLengths(crop: IrrCrop, seasonDays: number): [number, number, number, number] {
  const k = KC_TABLE[crop];
  const total = k.stages.reduce((a, b) => a + b, 0);
  if (k.perennial || seasonDays <= 0) return k.stages;
  const f = seasonDays / total;
  const s = k.stages.map((x) => Math.round(x * f)) as [number, number, number, number];
  s[3] = Math.max(1, seasonDays - s[0] - s[1] - s[2]);
  return s;
}

/** Kc on a given day after planting (FAO-56 fig. 25 piece-wise curve). */
export function kcOn(crop: IrrCrop, dap: number, seasonDays: number): { kc: number; stage: Stage } {
  const k = KC_TABLE[crop];
  if (k.perennial) return { kc: k.mid, stage: "mid" };
  if (dap < 0) return { kc: 0, stage: "fallow" };
  const [a, b, c, d] = stageLengths(crop, seasonDays);
  if (dap <= a) return { kc: k.ini, stage: "initial" };
  if (dap <= a + b) return { kc: k.ini + ((dap - a) / Math.max(1, b)) * (k.mid - k.ini), stage: "development" };
  if (dap <= a + b + c) return { kc: k.mid, stage: "mid" };
  if (dap <= a + b + c + d) return { kc: k.mid + ((dap - a - b - c) / Math.max(1, d)) * (k.end - k.mid), stage: "late" };
  return { kc: k.end, stage: "harvest" };
}

/** Root depth grows from 0.25 m at planting to Zr,max at the start of mid-season. */
export function rootDepth(crop: IrrCrop, dap: number, seasonDays: number): number {
  const k = KC_TABLE[crop];
  if (k.perennial) return k.zrMax;
  const [a, b] = stageLengths(crop, seasonDays);
  const zmin = Math.min(0.25, k.zrMax);
  const f = Math.max(0, Math.min(1, dap / Math.max(1, a + b)));
  return zmin + f * (k.zrMax - zmin);
}

/** Daily effective rainfall (mm). `prob` (0-100) weights forecast rain; omit for observed rain. */
export function effectiveRain(p: number, prob?: number | null): number {
  const w = prob == null ? 1 : Math.max(0, Math.min(1, prob / 100));
  const pe = p < 5 ? 0 : 0.8 * p;
  return pe * w;
}

export interface DayWeather {
  date: string; // YYYY-MM-DD
  et0: number | null;
  rainMm: number;
  rainProb: number | null;
  forecast: boolean;
}

export interface IrrigationLog {
  date: string;
  mm: number;
}

export interface PlanInput {
  crop: string;
  soil: string;
  irrigationType: string;
  plantingDate: string; // YYYY-MM-DD
  harvestDate: string; // YYYY-MM-DD
  areaHa: number;
  today: string; // YYYY-MM-DD (farm local)
  days: DayWeather[]; // chronological; past + forecast
  logs: IrrigationLog[];
  /** relative depletion (0 = field capacity, 1 = wilting point) at the first day, e.g. from model soil moisture */
  initialDepletionFrac?: number | null;
  /** internal: do not extrapolate beyond the forecast */
  noExtrapolate?: boolean;
}

export type DayAction = "irrigate" | "none" | "rain_covers" | "drain" | "keep_flooded" | "stop";

export interface PlanDay {
  date: string;
  forecast: boolean;
  et0: number;
  kc: number;
  etc: number;
  rainMm: number;
  rainProb: number | null;
  effRain: number;
  irrigationMm: number; // logged (past) or recommended (future)
  /** upland: root-zone depletion Dr (mm). paddy: water level (mm, + = ponded, − = below surface) */
  level: number;
  threshold: number; // RAW (upland) or AWD trigger (paddy)
  capacity: number; // TAW (upland) or target ponding (paddy)
  action: DayAction;
  stage: Stage;
}

export interface IrrigationPlan {
  mode: "upland" | "paddy";
  crop: IrrCrop;
  stage: Stage;
  dap: number;
  kcToday: number;
  et0Today: number | null;
  etcToday: number | null;
  taw: number | null;
  raw: number | null;
  rootDepthM: number | null;
  days: PlanDay[];
  /** headline for the farmer */
  next: { kind: "irrigate"; date: string; mm: number; m3: number; pumpHours: number } | { kind: "rain"; date: string | null; rainMm: number } | { kind: "none" } | { kind: "drain"; date: string } | { kind: "stop" };
  /** AWD guidance for rice */
  awd: { phase: "establishment" | "awd" | "flowering" | "drain" | "none"; waterLevelMm: number; triggerMm: number; refillMm: number; safe: boolean } | null;
  totals: { etcPast7: number; rainPast7: number; irrigationPast7: number; etcNext7: number; rainNext7: number; irrigationNext7: number };
  rainfed: boolean;
  /** when nothing is due within the forecast: an estimate assuming no rain and recent ET0 (up to 21 days ahead) */
  beyond: { kind: "irrigate"; date: string; mm: number } | { kind: "drain"; date: string } | null;
  source: string;
}

const PUMP_LPS = 8; // typical 2-inch centrifugal / shallow tube-well discharge (L/s)
const r1 = (v: number) => Math.round(v * 10) / 10;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** m³ of water for `mm` over `areaHa` (1 mm on 1 ha = 10 m³) and pump hours at 8 L/s. */
export function waterVolume(mm: number, areaHa: number) {
  const m3 = mm * areaHa * 10;
  return { m3: Math.round(m3), pumpHours: r1(m3 / ((PUMP_LPS * 3600) / 1000)) };
}

export function planIrrigation(input: PlanInput): IrrigationPlan {
  const crop = toIrrCrop(input.crop);
  const spec = KC_TABLE[crop];
  const soil = soilOf(input.soil);
  const season = Math.max(30, daysBetween(input.plantingDate, input.harvestDate));
  const paddy = crop === "rice";
  const rainfed = input.irrigationType === "rainfed";
  const logBy = new Map<string, number>();
  for (const l of input.logs) logBy.set(l.date, (logBy.get(l.date) ?? 0) + l.mm);

  const out: PlanDay[] = [];
  let lastEt0 = 4;

  if (!paddy) {
    // ── Upland root-zone balance ──
    const aw = soil.fc - soil.wp;
    let dr: number | null = null;
    for (const d of input.days) {
      const dap = daysBetween(input.plantingDate, d.date);
      const { kc, stage } = kcOn(crop, dap, season);
      const zr = rootDepth(crop, dap, season);
      const taw = 1000 * aw * zr;
      const raw = spec.p * taw;
      if (dr == null) dr = Math.max(0, Math.min(1, input.initialDepletionFrac ?? 0.4)) * taw;
      dr = Math.min(dr, taw);
      const et0 = d.et0 ?? lastEt0;
      lastEt0 = et0;
      const etc = kc * et0;
      const ks = dr > raw ? Math.max(0, (taw - dr) / Math.max(1e-6, taw - raw)) : 1;
      const pe = effectiveRain(d.rainMm, d.forecast ? d.rainProb : null);
      const isFuture = d.forecast && d.date >= input.today;
      let irr = isFuture ? 0 : logBy.get(d.date) ?? 0;
      let action: DayAction = "none";
      let next = dr - pe - irr + ks * etc;
      if (isFuture && stage !== "harvest" && stage !== "fallow" && next > raw) {
        // Irrigate today to refill the root zone to field capacity (net requirement)
        irr = Math.round(Math.max(0, next));
        next = next - irr;
        action = "irrigate";
      } else if (isFuture && pe > 0 && dr > raw * 0.6) action = "rain_covers";
      if (stage === "late" && crop === "onion") action = action === "irrigate" ? "irrigate" : "none";
      dr = Math.max(0, Math.min(taw, next));
      out.push({ date: d.date, forecast: d.forecast, et0: r1(et0), kc: Math.round(kc * 100) / 100, etc: r1(etc * ks), rainMm: r1(d.rainMm), rainProb: d.rainProb, effRain: r1(pe), irrigationMm: r1(irr), level: r1(dr), threshold: r1(raw), capacity: r1(taw), action, stage });
    }
  } else {
    // ── Paddy ponded-water balance with AWD ──
    const bund = 150; // mm — excess above bund height spills out
    const refill = 50; // re-flood to 5 cm
    const trigger = -150; // irrigate when water is 15 cm below the surface
    const hold = 30; // keep ≥ 3 cm during establishment / flowering
    let h: number = Math.round(50 - Math.max(0, Math.min(1, input.initialDepletionFrac ?? 0.2)) * 150);
    for (const d of input.days) {
      const dap = daysBetween(input.plantingDate, d.date);
      const { kc, stage } = kcOn(crop, dap, season);
      const toHarvest = daysBetween(d.date, input.harvestDate);
      const et0 = d.et0 ?? lastEt0;
      lastEt0 = et0;
      const etc = kc * et0;
      const perc: number = h > 0 ? soil.percolation : soil.percolation * 0.3;
      // bunded paddies capture nearly all rain (no canopy interception rule)
      const rain = d.forecast ? d.rainMm * Math.max(0, Math.min(1, (d.rainProb ?? 100) / 100)) : d.rainMm;
      const phase = toHarvest <= 14 ? "drain" : dap <= 14 ? "establishment" : isFlowering(dap, season) ? "flowering" : "awd";
      const isFuture = d.forecast && d.date >= input.today;
      let irr = isFuture ? 0 : logBy.get(d.date) ?? 0;
      const loss: number = etc + perc;
      const step = (level: number, gain: number): number => {
        // water above the surface moves 1:1; below the surface the table moves 1/Sy per mm
        let lv = level;
        let net: number = gain - loss;
        if (lv > 0) {
          const above: number = lv + net;
          if (above >= 0) return Math.min(bund, above);
          net = above; // remaining deficit after the pond empties
          lv = 0;
        }
        return Math.max(-400, lv + net / soil.sy);
      };
      let next: number = step(h, rain + irr);
      let action: DayAction = phase === "drain" ? "drain" : phase === "flowering" || phase === "establishment" ? "keep_flooded" : "none";
      if (isFuture && phase !== "drain" && stage !== "harvest") {
        const thr = phase === "awd" ? trigger : hold;
        if (next < thr) {
          const deficit = next < 0 ? -next * soil.sy : 0;
          irr = Math.round(refill - Math.max(0, next) + deficit);
          next = step(h, rain + irr);
          action = "irrigate";
        } else if (rain >= 5 && phase === "awd") action = "rain_covers";
      }
      h = next;
      out.push({ date: d.date, forecast: d.forecast, et0: r1(et0), kc: Math.round(kc * 100) / 100, etc: r1(etc), rainMm: r1(d.rainMm), rainProb: d.rainProb, effRain: r1(rain), irrigationMm: r1(irr), level: Math.round(h), threshold: phase === "awd" ? trigger : hold, capacity: refill, action, stage });
    }
  }

  const todayRow = out.find((d) => d.date === input.today) ?? out.find((d) => d.forecast) ?? out[out.length - 1];
  const dapToday = daysBetween(input.plantingDate, input.today);
  const { kc: kcToday, stage } = kcOn(crop, dapToday, season);
  const future = out.filter((d) => d.forecast && d.date >= input.today);
  const past = out.filter((d) => d.date < input.today).slice(-7);
  const firstIrr = future.find((d) => d.action === "irrigate");
  const sumK = (a: PlanDay[], k: "etc" | "rainMm" | "irrigationMm") => r1(a.reduce((s, d) => s + d[k], 0));

  let next: IrrigationPlan["next"];
  const awdPhase = paddy ? (daysBetween(input.today, input.harvestDate) <= 14 ? "drain" : dapToday <= 14 ? "establishment" : isFlowering(dapToday, season) ? "flowering" : "awd") : null;
  if (stage === "harvest" || stage === "fallow") next = { kind: "stop" };
  else if (awdPhase === "drain") next = { kind: "drain", date: input.today };
  else if (firstIrr) next = { kind: "irrigate", date: firstIrr.date, mm: Math.round(firstIrr.irrigationMm), ...waterVolume(firstIrr.irrigationMm, input.areaHa) };
  else {
    const wet = future.filter((d) => d.rainMm >= 5 && (d.rainProb ?? 100) >= 50);
    next = wet.length ? { kind: "rain", date: wet[0]!.date, rainMm: r1(wet.reduce((s, d) => s + d.rainMm, 0)) } : { kind: "none" };
  }

  const zr = paddy ? null : rootDepth(crop, dapToday, season);
  const taw = paddy || zr == null ? null : r1(1000 * (soil.fc - soil.wp) * zr);
  return {
    mode: paddy ? "paddy" : "upland",
    crop,
    stage,
    dap: dapToday,
    kcToday: Math.round(kcToday * 100) / 100,
    et0Today: todayRow ? todayRow.et0 : null,
    etcToday: todayRow ? todayRow.etc : null,
    taw,
    raw: taw == null ? null : r1(taw * spec.p),
    rootDepthM: zr == null ? null : Math.round(zr * 100) / 100,
    days: out,
    next,
    awd: paddy
      ? { phase: awdPhase as "establishment" | "awd" | "flowering" | "drain", waterLevelMm: todayRow?.level ?? 0, triggerMm: -150, refillMm: 50, safe: awdPhase === "awd" }
      : null,
    totals: {
      etcPast7: sumK(past, "etc"),
      rainPast7: sumK(past, "rainMm"),
      irrigationPast7: sumK(past, "irrigationMm"),
      etcNext7: sumK(future.slice(0, 7), "etc"),
      rainNext7: sumK(future.slice(0, 7), "rainMm"),
      irrigationNext7: sumK(future.slice(0, 7), "irrigationMm"),
    },
    rainfed,
    beyond: next.kind === "rain" || next.kind === "none" ? extrapolate(input, future) : null,
    source: spec.source,
  };
}

/** Continue the balance past the forecast with no rain and the mean ET0 of the last 3 forecast days. */
function extrapolate(input: PlanInput, future: PlanDay[]): IrrigationPlan["beyond"] {
  if (input.noExtrapolate || !future.length) return null;
  const tail = future.slice(-3);
  const et0 = tail.reduce((s, d) => s + d.et0, 0) / tail.length;
  const last = input.days[input.days.length - 1]!.date;
  const extra: DayWeather[] = Array.from({ length: 21 }, (_, i) => ({ date: new Date(Date.parse(`${last}T00:00:00Z`) + (i + 1) * 86_400_000).toISOString().slice(0, 10), et0, rainMm: 0, rainProb: null, forecast: true }));
  const p = planIrrigation({ ...input, days: [...input.days, ...extra], noExtrapolate: true });
  for (const d of p.days) {
    if (d.date <= last) continue;
    if (d.action === "irrigate") return { kind: "irrigate", date: d.date, mm: Math.round(d.irrigationMm) };
    if (d.action === "drain") return { kind: "drain", date: d.date };
    if (d.stage === "harvest") return null;
  }
  return null;
}

/** Flowering ≈ the first 3 weeks of mid-season (heading → anthesis), ±7 days. */
export function isFlowering(dap: number, seasonDays: number): boolean {
  const [a, b, c] = stageLengths("rice", seasonDays);
  const start = a + b + Math.round(c * 0.35) - 7;
  const end = a + b + Math.round(c * 0.35) + 14;
  return dap >= start && dap <= end;
}

/** Relative depletion (0-1) from model volumetric soil moisture for a soil type. */
export function depletionFromMoisture(theta: number | null | undefined, soil: string): number | null {
  if (theta == null || !Number.isFinite(theta)) return null;
  const s = soilOf(soil);
  return Math.max(0, Math.min(1, (s.fc - theta) / (s.fc - s.wp)));
}
