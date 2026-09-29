/**
 * Anticipatory Action (AA) — forecast-based financing for NGOs and governments.
 *
 *  Trigger protocol   metric (Agri-SHIELD 72 h flood probability · 5-day forecast rain ·
 *                     GloFAS peak flow vs normal), Readiness and Activation thresholds,
 *                     minimum number of communities, lead time, early actions, budget,
 *                     pre-arranged cash transfer and pre-positioned stock.
 *  Live status        per community (Monitoring / Readiness / Activation met) and per
 *                     protocol (Monitoring / Readiness / Activated) from the current forecast.
 *  Backtest           replays the trigger on 1995 → last full year with ERA5 + GloFAS
 *                     reanalysis used as a perfect forecast; compares activations with
 *                     observed flood events (GloFAS ≥ 1-in-5-year flow, or 3-day rain ≥ its
 *                     1-in-5-year value where there is no river signal) → hits, false alarms,
 *                     missed events, lead time.
 *  Workflow           activate → assign teams → record disbursements → post-event review,
 *                     with an audit trail and workspace notifications.
 */
import type { AssetRecord } from "../data/store";
import { audit, getStore, nextId } from "../data/store";
import { getHistoryBatch, getRecentForecastMany, gridKey, type DailyHistory, type HistoryPoint } from "../live/history";
import { scoreFlood } from "../risk/scoring";
import { ensureAssessments } from "./credit-risk";
import { exposurePriors } from "./location-risk";
import { refPoint } from "./parametric";
import { clamp, quantile } from "./risk-math";
import { notifyWorkspace } from "./workspace-notifications";
import { restore, track } from "../persist";

export type AaMetric = "flood_prob_72h" | "rain_5d_mm" | "discharge_ratio";

export const AA_METRICS: Record<AaMetric, { label: string; unit: string; explain: string; source: string }> = {
  flood_prob_72h: { label: "Flood probability (next 72 h)", unit: "%", explain: "Agri-SHIELD flood model: chance of flooding in the next 3 days from forecast rain, soil wetness, river flow and terrain.", source: "Agri-SHIELD flood model · Open-Meteo · GloFAS" },
  rain_5d_mm: { label: "Forecast rain, next 5 days", unit: "mm", explain: "Total rainfall forecast for the next five days at the community.", source: "Open-Meteo forecast" },
  discharge_ratio: { label: "River peak vs normal flow (next 5 days)", unit: "× normal", explain: "Highest forecast river flow in the next five days divided by the river's normal (median) flow since 1991.", source: "GloFAS v4 (Copernicus EMS)" },
};

export interface AaAction {
  id: string;
  name: string;
  owner: string;
  costUsd: number;
  hoursBeforeImpact: number;
}

export interface AaStockItem {
  item: string;
  perHousehold: number;
  unitCostUsd: number;
}

export interface AaProtocol {
  id: string;
  workspaceId: string;
  name: string;
  hazard: "flood" | "cyclone" | "heavy_rain";
  metric: AaMetric;
  readiness: number;
  activation: number;
  minCommunities: number;
  leadTimeDays: number;
  scopeTags: string[];
  actions: AaAction[];
  budgetUsd: number;
  cashPerHouseholdUsd: number;
  coveragePct: number;
  deliveryFeePct: number;
  stock: AaStockItem[];
  status: "active" | "draft" | "archived";
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
}

export type ActivationStatus = "activated" | "teams_assigned" | "disbursing" | "completed" | "reviewed" | "cancelled";

export interface AaActivation {
  id: string;
  workspaceId: string;
  protocolId: string;
  protocolName: string;
  status: ActivationStatus;
  trigger: "manual" | "forecast";
  reason: string;
  communityIds: string[];
  plannedUsd: number;
  teams: { id: string; name: string; lead: string; contact: string; communityIds: string[] }[];
  disbursements: { id: string; communityId: string; communityName: string; households: number; amountUsd: number; channel: string; at: Date; by: string }[];
  review: { at: Date; by: string; eventOccurred: boolean; outcome: string; lessons: string; householdsReached: number } | null;
  trail: { at: Date; by: string; action: string; detail: string }[];
  createdAt: Date;
  createdBy: string;
}

// ─── Pure maths ───────────────────────────────────────────────────────────

/** Pre-arranged cash transfer + pre-positioned stock envelope. */
export function cashPlan(input: { households: number[]; coveragePct: number; cashPerHouseholdUsd: number; deliveryFeePct: number; stock: AaStockItem[]; budgetUsd: number }) {
  const targeted = input.households.map((h) => Math.round(h * clamp(input.coveragePct / 100)));
  const hh = targeted.reduce((a, b) => a + b, 0);
  const cash = hh * input.cashPerHouseholdUsd;
  const fees = cash * (input.deliveryFeePct / 100);
  const stockPerHh = input.stock.reduce((t, s) => t + s.perHousehold * s.unitCostUsd, 0);
  const stock = hh * stockPerHh;
  const total = cash + fees + stock;
  const perHh = input.cashPerHouseholdUsd * (1 + input.deliveryFeePct / 100) + stockPerHh;
  const affordableHh = perHh > 0 ? Math.floor(input.budgetUsd / perHh) : 0;
  return {
    householdsTargeted: hh,
    perCommunity: targeted,
    cashUsd: Math.round(cash),
    feesUsd: Math.round(fees),
    stockUsd: Math.round(stock),
    totalUsd: Math.round(total),
    perHouseholdUsd: Math.round(perHh * 100) / 100,
    budgetUsd: input.budgetUsd,
    fundingGapUsd: Math.max(0, Math.round(total - input.budgetUsd)),
    affordableHouseholds: affordableHh,
    coverageOfTargetPct: hh ? Math.min(100, Math.round((affordableHh / hh) * 1000) / 10) : 0,
    stockLines: input.stock.map((s) => ({ ...s, quantity: Math.round(s.perHousehold * hh), costUsd: Math.round(s.perHousehold * s.unitCostUsd * hh) })),
  };
}

export type AaLevel = "monitoring" | "readiness" | "activation";
export const levelFor = (v: number | null, p: Pick<AaProtocol, "readiness" | "activation">): AaLevel => (v == null ? "monitoring" : v >= p.activation ? "activation" : v >= p.readiness ? "readiness" : "monitoring");

/** Group consecutive true days (gap ≤ `gap` days) into episodes → start indices. */
export function episodes(flags: boolean[], gap = 7): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (let i = 0; i < flags.length; i++) {
    if (!flags[i]) continue;
    const last = out[out.length - 1];
    if (last && i - last.end <= gap) last.end = i;
    else out.push({ start: i, end: i });
  }
  return out;
}

/**
 * Verify activation episodes against observed events.
 *  hit         = an activation episode was active at some point between
 *                (event start − leadTime − 3 d) and the event start
 *  missed      = event without such an activation
 *  false alarm = activation episode with no event starting from its first day
 *                until leadTime + 5 d after its last day
 */
export function verifyTrigger(act: { start: number; end?: number }[], ev: { start: number }[], leadTimeDays: number) {
  const hits: { event: number; activation: number; leadDays: number }[] = [];
  const missed: number[] = [];
  for (const e of ev) {
    const w0 = e.start - leadTimeDays - 3;
    const a = act.filter((x) => x.start <= e.start && (x.end ?? x.start) >= w0).sort((x, y) => x.start - y.start)[0];
    if (a) {
      const first = Math.max(a.start, w0);
      hits.push({ event: e.start, activation: first, leadDays: e.start - first });
    } else missed.push(e.start);
  }
  const falseAlarms = act.filter((a) => !ev.some((e) => e.start >= a.start && e.start <= (a.end ?? a.start) + leadTimeDays + 5)).map((a) => a.start);
  return { hits, missed, falseAlarms };
}

/** Hindcast of the daily trigger metric from reanalysis (perfect-forecast assumption). */
export function hindcastMetric(metric: AaMetric, h: DailyHistory, exposure: number): (number | null)[] {
  const n = h.time.length;
  const r = h.rain;
  const out = new Array<number | null>(n).fill(null);
  if (metric === "rain_5d_mm") {
    for (let i = 0; i + 4 < n; i++) {
      let s = 0;
      for (let k = 0; k < 5; k++) s += r[i + k] ?? 0;
      out[i] = s;
    }
    return out;
  }
  const dis = h.discharge;
  if (metric === "discharge_ratio") {
    if (!dis) return out;
    const med = quantile(dis.filter((v): v is number => v != null && v > 0), 0.5);
    if (!(med > 0)) return out;
    for (let i = 0; i + 4 < n; i++) {
      let m = 0;
      for (let k = 0; k < 5; k++) m = Math.max(m, dis[i + k] ?? 0);
      out[i] = m / med;
    }
    return out;
  }
  // flood_prob_72h — the live flood score driven with observed rain/flow
  for (let i = 7; i + 2 < n; i++) {
    const r24 = r[i] ?? 0;
    const r48 = r24 + (r[i + 1] ?? 0);
    const r72 = r48 + (r[i + 2] ?? 0);
    let ante = 0;
    for (let k = 1; k <= 7; k++) ante += r[i - k] ?? 0;
    const soil = 0.15 + Math.min(0.3, (ante / 150) * 0.3);
    let ratio: number | null = null;
    if (dis) {
      let mean30 = 0;
      let c = 0;
      for (let k = 1; k <= 30 && i - k >= 0; k++) if (dis[i - k] != null) (mean30 += dis[i - k]!), c++;
      const peak = Math.max(dis[i] ?? 0, dis[i + 1] ?? 0, dis[i + 2] ?? 0);
      ratio = c && mean30 > 0 ? peak / (mean30 / c) : null;
    }
    out[i] = scoreFlood({ rain24hMm: r24, rain48hMm: r48, rain72hMm: r72, soilMoisture: soil, dischargeRatio: ratio, exposure, elevationM: h.elevationM }).score;
  }
  return out;
}

/** Observed damaging-flood days: GloFAS ≥ 1-in-5-year flow (P80 of annual maxima), else 3-day rain ≥ its 1-in-5-year value. */
export function observedEventDays(h: DailyHistory): { flags: boolean[]; rule: string } {
  const n = h.time.length;
  const annMax = (vals: (number | null)[]) => {
    const m = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const y = h.time[i]!.slice(0, 4);
      m.set(y, Math.max(m.get(y) ?? 0, vals[i] ?? 0));
    }
    return [...m.values()];
  };
  const dis = h.discharge;
  if (dis && Math.max(...dis.map((v) => v ?? 0)) > 5) {
    const q5 = quantile(annMax(dis), 0.8);
    return { flags: dis.map((v) => v != null && v >= q5), rule: `GloFAS river flow ≥ 1-in-5-year flood level (${Math.round(q5).toLocaleString("en-US")} m³/s)` };
  }
  const r3 = h.rain.map((_, i) => (i >= 2 ? (h.rain[i] ?? 0) + (h.rain[i - 1] ?? 0) + (h.rain[i - 2] ?? 0) : null));
  const q5 = quantile(annMax(r3), 0.8);
  return { flags: r3.map((v) => v != null && v >= q5), rule: `3-day rain ≥ 1-in-5-year value (${Math.round(q5)} mm)` };
}

// ─── Stores ───────────────────────────────────────────────────────────────

const g = globalThis as unknown as { __agriAa?: { protocols: AaProtocol[]; activations: AaActivation[] } };
const AA_VERSION = 1;
track("anticipatory", AA_VERSION, () => g.__agriAa);
function aa() {
  if (!g.__agriAa) {
    const saved = restore<{ protocols: AaProtocol[]; activations: AaActivation[] }>("anticipatory", AA_VERSION, (v) => {
      const x = v as { protocols?: unknown; activations?: unknown };
      return Array.isArray(x.protocols) && Array.isArray(x.activations);
    });
    if (saved) g.__agriAa = saved;
  }
  if (!g.__agriAa) {
    const now = new Date();
    g.__agriAa = {
      protocols: [
        {
          id: "aap_monsoon_flood",
          workspaceId: "org-ngo-brac",
          name: "Monsoon riverine flood — early cash",
          hazard: "flood",
          metric: "flood_prob_72h",
          readiness: 50,
          activation: 70,
          minCommunities: 3,
          leadTimeDays: 3,
          scopeTags: [],
          actions: [
            { id: "a1", name: "Alert volunteers & union disaster committees", owner: "Field coordinator", costUsd: 1500, hoursBeforeImpact: 72 },
            { id: "a2", name: "Send early-warning SMS & voice messages", owner: "Comms officer", costUsd: 800, hoursBeforeImpact: 72 },
            { id: "a3", name: "Disburse unconditional mobile-money transfer", owner: "Cash & voucher lead", costUsd: 0, hoursBeforeImpact: 48 },
            { id: "a4", name: "Move livestock & seed stock to raised plinths", owner: "Livelihoods officer", costUsd: 6000, hoursBeforeImpact: 36 },
            { id: "a5", name: "Pre-position water-purification tablets & ORS", owner: "WASH lead", costUsd: 0, hoursBeforeImpact: 24 },
          ],
          budgetUsd: 1_200_000,
          cashPerHouseholdUsd: 85,
          coveragePct: 40,
          deliveryFeePct: 1.5,
          stock: [
            { item: "Water-purification tablets (strip)", perHousehold: 2, unitCostUsd: 1.2 },
            { item: "ORS sachets", perHousehold: 6, unitCostUsd: 0.15 },
            { item: "Tarpaulin", perHousehold: 0.5, unitCostUsd: 9 },
          ],
          status: "active",
          createdAt: new Date(now.getTime() - 60 * 86_400_000),
          createdBy: "user-ngo-demo",
          updatedAt: new Date(now.getTime() - 5 * 86_400_000),
        },
      ],
      activations: [],
    };
  }
  return g.__agriAa;
}

export const listProtocols = (ws: string) => aa().protocols.filter((p) => p.workspaceId === ws && p.status !== "archived");
export const getProtocol = (ws: string, id: string) => aa().protocols.find((p) => p.id === id && p.workspaceId === ws) ?? null;
export const listActivations = (ws: string) => aa().activations.filter((a) => a.workspaceId === ws);

export function saveProtocol(ws: string, user: { id: string; name: string }, input: Omit<AaProtocol, "id" | "workspaceId" | "createdAt" | "createdBy" | "updatedAt"> & { id?: string }) {
  const now = new Date();
  const ex = input.id ? getProtocol(ws, input.id) : null;
  if (ex) {
    Object.assign(ex, { ...input, id: ex.id, workspaceId: ws, updatedAt: now });
    audit({ userId: user.id, userName: user.name, action: "update", entity: "aa_protocol", entityId: ex.id, details: `Updated ${ex.name}` });
    return ex;
  }
  const p: AaProtocol = { ...input, id: nextId("aap"), workspaceId: ws, createdAt: now, createdBy: user.id, updatedAt: now };
  aa().protocols.push(p);
  audit({ userId: user.id, userName: user.name, action: "create", entity: "aa_protocol", entityId: p.id, details: `Created ${p.name}` });
  return p;
}

export function archiveProtocol(ws: string, id: string, user: { id: string; name: string }) {
  const p = getProtocol(ws, id);
  if (!p) return null;
  p.status = "archived";
  audit({ userId: user.id, userName: user.name, action: "archive", entity: "aa_protocol", entityId: id, details: `Archived ${p.name}` });
  return p;
}

export function scopedCommunities(p: AaProtocol): AssetRecord[] {
  return getStore().assets.filter((a) => a.workspaceId === p.workspaceId && a.status === "active" && a.type === "community" && (!p.scopeTags.length || p.scopeTags.some((t) => a.tags.includes(t))));
}

// ─── Live status ──────────────────────────────────────────────────────────

export async function liveStatus(ws: string) {
  const protos = listProtocols(ws);
  const all = getStore().assets.filter((a) => a.workspaceId === ws && a.status === "active" && a.type === "community");
  await ensureAssessments(all);
  const needFc = protos.some((p) => p.metric !== "flood_prob_72h");
  const cells = new Map<string, HistoryPoint>();
  for (const a of all) cells.set(gridKey(refPoint(a)), refPoint(a));
  const needDis = protos.some((p) => p.metric === "discharge_ratio");
  const [recent, hist] = await Promise.all([
    needFc ? getRecentForecastMany(all.map((a) => ({ lat: a.lat, lon: a.lon }))) : Promise.resolve(new Map()),
    needDis ? getHistoryBatch([...cells.values()], { mode: "partial", budgetMs: 8000 }).then((b) => b.map) : Promise.resolve(new Map<string, DailyHistory>()),
  ]);
  const medianFlow = new Map<string, number>();
  for (const [k, h] of hist) {
    if (!h.discharge) continue;
    const med = quantile(h.discharge.filter((v): v is number => v != null && v > 0), 0.5);
    if (med > 0) medianFlow.set(k, med);
  }
  const metricValue = (p: AaProtocol, a: AssetRecord): number | null => {
    if (p.metric === "flood_prob_72h") return a.lastAssessment?.floodRisk ?? null;
    const f = recent.get(gridKey(a));
    if (!f) return null;
    if (p.metric === "rain_5d_mm") {
      let s = 0;
      for (let k = 0; k < 5; k++) s += f.rain[f.todayIdx + k] ?? 0;
      return Math.round(s * 10) / 10;
    }
    const d = f.discharge;
    const med = medianFlow.get(gridKey(refPoint(a)));
    if (!d || !med) return null;
    let m = 0;
    for (let k = 0; k < 5; k++) m = Math.max(m, d.values[d.todayIdx + k] ?? 0);
    return Math.round((m / med) * 100) / 100;
  };
  const acts = listActivations(ws);
  return protos.map((p) => {
    const comms = scopedCommunities(p).map((a) => {
      const v = metricValue(p, a);
      return {
        id: a.id,
        name: a.name,
        lat: a.lat,
        lon: a.lon,
        households: Number(a.meta.households ?? 0),
        tags: a.tags,
        value: v,
        level: levelFor(v, p),
        composite: a.lastAssessment?.composite ?? null,
        drivers: a.lastAssessment?.drivers ?? [],
      };
    });
    const nAct = comms.filter((c) => c.level === "activation").length;
    const nReady = comms.filter((c) => c.level !== "monitoring").length;
    const open = acts.find((x) => x.protocolId === p.id && !["reviewed", "cancelled", "completed"].includes(x.status));
    const status: "monitoring" | "readiness" | "activated" = open ? "activated" : nAct >= p.minCommunities ? "activated" : nReady > 0 ? "readiness" : "monitoring";
    const plan = cashPlan({ households: comms.filter((c) => c.level === "activation").map((c) => c.households), coveragePct: p.coveragePct, cashPerHouseholdUsd: p.cashPerHouseholdUsd, deliveryFeePct: p.deliveryFeePct, stock: p.stock, budgetUsd: p.budgetUsd });
    return {
      protocol: p,
      metricMeta: AA_METRICS[p.metric],
      status,
      triggerMet: nAct >= p.minCommunities,
      openActivationId: open?.id ?? null,
      communitiesAtActivation: nAct,
      communitiesAtReadiness: nReady,
      communities: comms.sort((a, b) => (b.value ?? -1) - (a.value ?? -1)),
      activationPlan: plan,
      maxValue: Math.max(0, ...comms.map((c) => c.value ?? 0)),
    };
  });
}

// ─── Backtest ─────────────────────────────────────────────────────────────

export async function backtestProtocol(p: Pick<AaProtocol, "metric" | "readiness" | "activation" | "minCommunities" | "leadTimeDays" | "scopeTags" | "workspaceId">, startYear = 1995) {
  const comms = scopedCommunities(p as AaProtocol);
  const cells = new Map<string, { pt: HistoryPoint; n: number; exposure: number }>();
  for (const a of comms) {
    const c = refPoint(a);
    const k = gridKey(c);
    const e = cells.get(k) ?? { pt: c, n: 0, exposure: exposurePriors(c.lat, c.lon).flood };
    e.n++;
    cells.set(k, e);
  }
  const batch = await getHistoryBatch([...cells.values()].map((c) => c.pt), { mode: "partial", budgetMs: 25_000 });
  const hist = batch.map;
  const usable = [...cells.entries()].filter(([k]) => hist.has(k));
  if (!usable.length) throw new Error("Historical record unavailable for these communities — try again shortly.");
  const ref = hist.get(usable[0]![0])!;
  let last = ref.rain.length - 1;
  while (last > 0 && ref.rain[last] == null) last--;
  const lastYear = Number(ref.time[last]!.slice(0, 4)) - 1;
  const i0 = ref.time.indexOf(`${startYear}-01-01`);
  const i1 = ref.time.indexOf(`${lastYear}-12-31`);
  const N = i1 - i0 + 1;
  const actCount = new Array<number>(N).fill(0);
  const readyCount = new Array<number>(N).fill(0);
  const evCount = new Array<number>(N).fill(0);
  let rule = "";
  for (const [k, c] of usable) {
    const h = hist.get(k)!;
    const m = hindcastMetric(p.metric, h, c.exposure);
    const ev = observedEventDays(h);
    rule ||= ev.rule;
    for (let d = 0; d < N; d++) {
      const v = m[i0 + d];
      if (v != null && v >= p.activation) actCount[d]! += c.n;
      if (v != null && v >= p.readiness) readyCount[d]! += c.n;
      if (ev.flags[i0 + d]) evCount[d]! += c.n;
    }
  }
  const total = usable.reduce((t, [, c]) => t + c.n, 0);
  const need = Math.min(p.minCommunities, total);
  const act = episodes(actCount.map((v) => v >= need));
  const evs = episodes(evCount.map((v) => v >= need), 15);
  const ready = episodes(readyCount.map((v) => v >= 1));
  const ver = verifyTrigger(act, evs, p.leadTimeDays);
  const yearOf = (d: number) => Number(ref.time[i0 + d]!.slice(0, 4));
  const years = Array.from({ length: lastYear - startYear + 1 }, (_, k) => startYear + k).map((y) => ({
    year: y,
    activations: act.filter((a) => yearOf(a.start) === y).length,
    events: evs.filter((e) => yearOf(e.start) === y).length,
    hits: ver.hits.filter((h) => yearOf(h.event) === y).length,
    missed: ver.missed.filter((m) => yearOf(m) === y).length,
    falseAlarms: ver.falseAlarms.filter((f) => yearOf(f) === y).length,
    readinessEpisodes: ready.filter((r) => yearOf(r.start) === y).length,
  }));
  const hitRate = evs.length ? (ver.hits.length / evs.length) * 100 : null;
  const far = act.length ? (ver.falseAlarms.length / act.length) * 100 : null;
  const lead = ver.hits.length ? ver.hits.reduce((t, h) => t + h.leadDays, 0) / ver.hits.length : null;
  return {
    startYear,
    endYear: lastYear,
    communities: total,
    cells: usable.length,
    pending: batch.pending,
    providers: batch.providers,
    eventRule: `${rule} at ≥ ${need} communities`,
    metricRule: `${AA_METRICS[p.metric].label} ≥ ${p.activation} ${AA_METRICS[p.metric].unit} at ≥ ${need} communities (hindcast from ERA5/GloFAS as a perfect forecast)`,
    totals: {
      activations: act.length,
      events: evs.length,
      hits: ver.hits.length,
      missed: ver.missed.length,
      falseAlarms: ver.falseAlarms.length,
      hitRatePct: hitRate == null ? null : Math.round(hitRate),
      falseAlarmRatioPct: far == null ? null : Math.round(far),
      meanLeadDays: lead == null ? null : Math.round(lead * 10) / 10,
      activationsPerYear: Math.round((act.length / years.length) * 100) / 100,
      readinessPerYear: Math.round((ready.length / years.length) * 100) / 100,
    },
    years,
    recent: [
      ...ver.hits.map((h) => ({ date: ref.time[i0 + h.activation]!, kind: "hit" as const, detail: `Activated ${h.leadDays} day(s) before the flood peak began (${ref.time[i0 + h.event]})` })),
      ...ver.missed.map((m) => ({ date: ref.time[i0 + m]!, kind: "missed" as const, detail: "Flood event with no activation beforehand" })),
      ...ver.falseAlarms.map((f) => ({ date: ref.time[i0 + f]!, kind: "false_alarm" as const, detail: "Activation not followed by a flood event" })),
    ]
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 25),
  };
}

// ─── Activation workflow ──────────────────────────────────────────────────

const STATUS_FLOW: Record<ActivationStatus, ActivationStatus[]> = {
  activated: ["teams_assigned", "cancelled"],
  teams_assigned: ["disbursing", "cancelled"],
  disbursing: ["completed"],
  completed: ["reviewed"],
  reviewed: [],
  cancelled: [],
};
export const canTransition = (from: ActivationStatus, to: ActivationStatus) => STATUS_FLOW[from].includes(to);

function note(a: AaActivation, by: string, action: string, detail: string) {
  a.trail.push({ at: new Date(), by, action, detail });
}

function notify(ws: string, title: string, body: string, severity: "info" | "success" | "warning" | "critical") {
  try {
    notifyWorkspace({ workspaceId: ws, kind: "alert", title, body, href: "/app/anticipatory", severity, email: false });
  } catch {
    /* notifications best-effort */
  }
}

export function activate(ws: string, user: { id: string; name: string }, input: { protocolId: string; communityIds: string[]; reason: string; trigger: "manual" | "forecast" }) {
  const p = getProtocol(ws, input.protocolId);
  if (!p) throw new Error("Protocol not found");
  const open = listActivations(ws).find((x) => x.protocolId === p.id && !["reviewed", "cancelled", "completed"].includes(x.status));
  if (open) throw new Error("This protocol already has an open activation — close or cancel it first.");
  const comms = scopedCommunities(p).filter((c) => input.communityIds.includes(c.id));
  if (!comms.length) throw new Error("Select at least one community to activate.");
  const plan = cashPlan({ households: comms.map((c) => Number(c.meta.households ?? 0)), coveragePct: p.coveragePct, cashPerHouseholdUsd: p.cashPerHouseholdUsd, deliveryFeePct: p.deliveryFeePct, stock: p.stock, budgetUsd: p.budgetUsd });
  const a: AaActivation = {
    id: nextId("aac"),
    workspaceId: ws,
    protocolId: p.id,
    protocolName: p.name,
    status: "activated",
    trigger: input.trigger,
    reason: input.reason,
    communityIds: comms.map((c) => c.id),
    plannedUsd: plan.totalUsd,
    teams: [],
    disbursements: [],
    review: null,
    trail: [],
    createdAt: new Date(),
    createdBy: user.name,
  };
  note(a, user.name, "Activated", `${comms.length} communities · ${plan.householdsTargeted.toLocaleString("en-US")} households · planned $${plan.totalUsd.toLocaleString("en-US")} — ${input.reason}`);
  aa().activations.unshift(a);
  audit({ userId: user.id, userName: user.name, action: "activate", entity: "aa_activation", entityId: a.id, details: `${p.name}: ${comms.length} communities` });
  notify(ws, `Anticipatory action ACTIVATED — ${p.name}`, `${comms.length} communities, ${plan.householdsTargeted.toLocaleString("en-US")} households targeted. ${input.reason}`, "critical");
  return a;
}

function getAct(ws: string, id: string) {
  const a = listActivations(ws).find((x) => x.id === id);
  if (!a) throw new Error("Activation not found");
  return a;
}

export function assignTeams(ws: string, user: { id: string; name: string }, id: string, teams: { name: string; lead: string; contact: string; communityIds: string[] }[]) {
  const a = getAct(ws, id);
  if (a.status !== "activated" && a.status !== "teams_assigned") throw new Error(`Cannot assign teams while ${a.status.replace("_", " ")}`);
  a.teams = teams.map((t) => ({ ...t, id: nextId("team"), communityIds: t.communityIds.filter((c) => a.communityIds.includes(c)) }));
  a.status = "teams_assigned";
  note(a, user.name, "Teams assigned", a.teams.map((t) => `${t.name} (${t.lead}, ${t.communityIds.length} communities)`).join("; "));
  audit({ userId: user.id, userName: user.name, action: "assign_teams", entity: "aa_activation", entityId: a.id, details: `${a.teams.length} teams` });
  notify(ws, "Field teams assigned", `${a.teams.length} team(s) deployed for ${a.protocolName}.`, "info");
  return a;
}

export function recordDisbursement(ws: string, user: { id: string; name: string }, id: string, d: { communityId: string; households: number; amountUsd: number; channel: string }) {
  const a = getAct(ws, id);
  if (!["teams_assigned", "disbursing"].includes(a.status)) throw new Error("Assign field teams before recording disbursements.");
  if (!a.communityIds.includes(d.communityId)) throw new Error("Community is not part of this activation.");
  const c = getStore().assets.find((x) => x.id === d.communityId);
  a.disbursements.push({ id: nextId("dsb"), communityId: d.communityId, communityName: c?.name ?? d.communityId, households: d.households, amountUsd: d.amountUsd, channel: d.channel, at: new Date(), by: user.name });
  a.status = "disbursing";
  note(a, user.name, "Disbursement recorded", `${c?.name ?? d.communityId}: ${d.households} households · $${d.amountUsd.toLocaleString("en-US")} via ${d.channel}`);
  audit({ userId: user.id, userName: user.name, action: "disburse", entity: "aa_activation", entityId: a.id, details: `$${d.amountUsd} to ${d.households} households` });
  return a;
}

export function transition(ws: string, user: { id: string; name: string }, id: string, to: "completed" | "cancelled", reason: string) {
  const a = getAct(ws, id);
  if (!canTransition(a.status, to)) throw new Error(`Cannot move from ${a.status} to ${to}`);
  a.status = to;
  note(a, user.name, to === "completed" ? "Operations completed" : "Cancelled", reason);
  audit({ userId: user.id, userName: user.name, action: to, entity: "aa_activation", entityId: a.id, details: reason });
  if (to === "completed") notify(ws, "Anticipatory action completed", `${a.protocolName}: $${a.disbursements.reduce((t, x) => t + x.amountUsd, 0).toLocaleString("en-US")} disbursed to ${a.disbursements.reduce((t, x) => t + x.households, 0).toLocaleString("en-US")} households. Post-event review due.`, "success");
  return a;
}

export function review(ws: string, user: { id: string; name: string }, id: string, r: { eventOccurred: boolean; outcome: string; lessons: string }) {
  const a = getAct(ws, id);
  if (a.status !== "completed") throw new Error("Complete the operation before the post-event review.");
  a.review = { ...r, at: new Date(), by: user.name, householdsReached: a.disbursements.reduce((t, x) => t + x.households, 0) };
  a.status = "reviewed";
  note(a, user.name, "Post-event review", `${r.eventOccurred ? "Event materialised" : "Event did not materialise (false alarm)"} — ${r.outcome}`);
  audit({ userId: user.id, userName: user.name, action: "review", entity: "aa_activation", entityId: a.id, details: r.outcome });
  return a;
}
