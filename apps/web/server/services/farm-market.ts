/**
 * Market analysis for a farm from WFP food-price data (see server/live/market-prices.ts):
 * nearest markets with distance, local vs. regional monthly trend, month-of-year
 * seasonality and a clearly-labelled "sell now or store?" heuristic. Pure functions.
 */
import { haversineKm } from "../data/farmer-geometry";
import { COMMODITY_GROUPS, type WfpCountryData } from "../live/market-prices";

export interface MarketPoint {
  month: string; // YYYY-MM
  local: number | null;
  regional: number | null;
}

export interface NearbyMarket {
  id: string;
  name: string;
  admin: string;
  distanceKm: number;
  price: number;
  month: string;
  lat: number;
  lon: number;
}

export type SellAdvice = "sell" | "store" | "wait_short";

export interface CommodityAnalysis {
  key: string;
  label: string;
  commodity: string;
  unit: string;
  pricetype: string;
  currency: string;
  latest: { price: number; month: string; market: string; distanceKm: number } | null;
  regionalLatest: number | null;
  change3mPct: number | null;
  change12mPct: number | null;
  trendPctPerMonth: number | null;
  series: MarketPoint[];
  nearby: NearbyMarket[];
  seasonality: { month: number; index: number }[] | null;
  advice: { kind: SellAdvice; untilMonth: number | null; expectedGainPct: number | null; reasons: string[] };
  forCrops: string[];
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** monthly storage cost: weight loss, pests and interest (FAO post-harvest rules of thumb ~1–2 %/month) */
export const STORAGE_COST_PCT_PER_MONTH = 1.5;

const addMonths = (ym: string, n: number) => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

/** Month-of-year price index (1.00 = typical) from ≥ 24 monthly values, de-trended by a centred 12-month mean. */
export function seasonalIndex(monthly: { month: string; value: number }[]): { month: number; index: number }[] | null {
  const sorted = [...monthly].sort((a, b) => a.month.localeCompare(b.month));
  if (sorted.length < 24) return null;
  const byMonth = new Map(sorted.map((m) => [m.month, m.value]));
  const ratios: number[][] = Array.from({ length: 12 }, () => []);
  for (const m of sorted) {
    const window: number[] = [];
    for (let k = -6; k <= 5; k++) {
      const v = byMonth.get(addMonths(m.month, k));
      if (v != null) window.push(v);
    }
    if (window.length < 9) continue;
    const base = avg(window)!;
    ratios[Number(m.month.slice(5, 7)) - 1]!.push(m.value / base);
  }
  if (ratios.filter((r) => r.length).length < 10) return null;
  const idx = ratios.map((r, i) => ({ month: i + 1, index: r.length ? avg(r)! : 1 }));
  const mean = avg(idx.map((x) => x.index))!;
  return idx.map((x) => ({ month: x.month, index: r2(x.index / mean) }));
}

/** Sell-or-store heuristic from seasonality + recent trend (NOT a price forecast). */
export function sellOrStore(opts: { seasonality: { month: number; index: number }[] | null; currentMonth: number; trendPctPerMonth: number | null; storable: boolean }): CommodityAnalysis["advice"] {
  const reasons: string[] = [];
  if (!opts.storable) return { kind: "sell", untilMonth: null, expectedGainPct: null, reasons: ["This produce does not store well — sell fresh at the nearest good market."] };
  let best: { month: number; gain: number } | null = null;
  if (opts.seasonality) {
    const cur = opts.seasonality.find((s) => s.month === opts.currentMonth)?.index ?? 1;
    for (let k = 1; k <= 4; k++) {
      const m = ((opts.currentMonth - 1 + k) % 12) + 1;
      const idx = opts.seasonality.find((s) => s.month === m)?.index ?? 1;
      const gain = (idx / cur - 1) * 100 - STORAGE_COST_PCT_PER_MONTH * k;
      if (!best || gain > best.gain) best = { month: m, gain };
    }
    const peak = [...opts.seasonality].sort((a, b) => b.index - a.index)[0]!;
    const low = [...opts.seasonality].sort((a, b) => a.index - b.index)[0]!;
    reasons.push(`Prices are usually highest in ${MONTHS[peak.month - 1]} (${Math.round((peak.index - 1) * 100)}% above average) and lowest in ${MONTHS[low.month - 1]} (${Math.round((1 - low.index) * 100)}% below).`);
  } else reasons.push("Not enough price history here to know the seasonal pattern.");
  const tr = opts.trendPctPerMonth;
  if (tr != null) reasons.push(`Over the last 3 months prices moved ${tr >= 0 ? "up" : "down"} ${Math.abs(r1(tr))}% per month.`);
  if (best && best.gain >= 3) {
    reasons.push(`Storing until ${MONTHS[best.month - 1]} has historically paid about ${r1(best.gain)}% more after ${STORAGE_COST_PCT_PER_MONTH}%/month storage losses and interest.`);
    return { kind: "store", untilMonth: best.month, expectedGainPct: r1(best.gain), reasons };
  }
  if (tr != null && tr >= 2 && (best?.gain ?? 0) > 0) {
    reasons.push("Prices are rising — waiting 2–4 weeks may help if you have dry, safe storage.");
    return { kind: "wait_short", untilMonth: best?.month ?? null, expectedGainPct: best ? r1(best.gain) : null, reasons };
  }
  reasons.push("Storing is unlikely to beat storage losses — selling now is reasonable.");
  return { kind: "sell", untilMonth: null, expectedGainPct: best ? r1(best.gain) : null, reasons };
}

const STORABLE = new Set(["rice", "wheat", "maize", "onion", "potato", "lentils", "sugar", "coconut"]);

export function analyseMarkets(data: WfpCountryData, farm: { lat: number; lon: number }, crops: string[], today = new Date()): CommodityAnalysis[] {
  const out: CommodityAnalysis[] = [];
  if (!data.lastDate) return out;
  const lastMonth = data.lastDate.slice(0, 7);
  const recentFrom = addMonths(lastMonth, -12);
  const chartFrom = addMonths(lastMonth, -35);
  const dist = new Map(Object.values(data.markets).map((m) => [m.id, haversineKm(farm.lat, farm.lon, m.lat, m.lon)]));
  const wantGroups = new Set<string>(["rice"]);
  for (const c of crops) for (const g of COMMODITY_GROUPS) if (g.crops.includes(c)) wantGroups.add(g.key);
  // staples every farm household trades
  ["lentils", "onion", "potato"].forEach((g) => wantGroups.add(g));

  for (const g of COMMODITY_GROUPS) {
    if (!wantGroups.has(g.key)) continue;
    // choose the series with the most recent observations in the 5 nearest markets carrying it
    const cands = data.series.map((s, i) => ({ s, i })).filter(({ s }) => s.group === g.key);
    let pick: { i: number; score: number; nearest: string[] } | null = null;
    for (const { s, i } of cands) {
      const mkts = new Set<string>();
      for (const o of data.obs) if (o[2] === i && o[0] >= recentFrom) mkts.add(o[1]);
      const nearest = [...mkts].sort((a, b) => dist.get(a)! - dist.get(b)!).slice(0, 5);
      if (!nearest.length) continue;
      const nset = new Set(nearest);
      let n = 0;
      for (const o of data.obs) if (o[2] === i && o[0] >= recentFrom && nset.has(o[1])) n++;
      // prefer staples measured per KG and wholesale (closer to farm-gate) when coverage is similar
      const d0 = dist.get(nearest[0]!)!;
      const score = n * (s.pricetype === "Wholesale" ? 1.15 : 1) * (/kg/i.test(s.unit) ? 1.1 : 1) / (1 + d0 / 150);
      if (!pick || score > pick.score) pick = { i, score, nearest };
    }
    if (!pick) continue;
    const def = data.series[pick.i]!;
    const mine = data.obs.filter((o) => o[2] === pick!.i);
    // latest price per market
    const lastBy = new Map<string, { price: number; month: string }>();
    for (const o of mine) {
      const cur = lastBy.get(o[1]);
      if (!cur || o[0] > cur.month) lastBy.set(o[1], { price: o[3], month: o[0] });
    }
    const nearby: NearbyMarket[] = [...lastBy.entries()]
      .filter(([, v]) => v.month >= addMonths(lastMonth, -18))
      .map(([id, v]) => {
        const m = data.markets[id]!;
        return { id, name: m.name, admin: [...new Set([m.admin2, m.admin1].filter(Boolean))].join(", "), distanceKm: Math.round(dist.get(id)!), price: r2(v.price), month: v.month, lat: m.lat, lon: m.lon };
      })
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 6);
    const localId = pick.nearest[0]!;
    const regionIds = new Set(pick.nearest);
    const monthly = new Map<string, { local: number[]; region: number[] }>();
    for (const o of mine) {
      if (!regionIds.has(o[1])) continue;
      const e = monthly.get(o[0]) ?? { local: [], region: [] };
      e.region.push(o[3]);
      if (o[1] === localId) e.local.push(o[3]);
      monthly.set(o[0], e);
    }
    const allMonths = [...monthly.keys()].sort();
    const regional = allMonths.map((m) => ({ month: m, value: avg(monthly.get(m)!.region)! }));
    const series: MarketPoint[] = allMonths
      .filter((m) => m >= chartFrom)
      .map((m) => ({ month: m, local: monthly.get(m)!.local.length ? r2(avg(monthly.get(m)!.local)!) : null, regional: r2(avg(monthly.get(m)!.region)!) }));
    const regAt = (m: string) => regional.find((x) => x.month === m)?.value ?? null;
    const lastReg = regional[regional.length - 1];
    const chg = (months: number) => {
      if (!lastReg) return null;
      const past = regAt(addMonths(lastReg.month, -months));
      return past ? r1((lastReg.value / past - 1) * 100) : null;
    };
    // trend: least-squares slope over the last 4 regional points, as % of mean per month
    const tail = regional.slice(-4);
    let trend: number | null = null;
    if (tail.length >= 3) {
      const xs = tail.map((_, i) => i);
      const mx = avg(xs)!;
      const my = avg(tail.map((t) => t.value))!;
      const slope = xs.reduce((s, x, i) => s + (x - mx) * (tail[i]!.value - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
      trend = r1((slope / my) * 100);
    }
    const season = seasonalIndex(regional);
    const localLast = lastBy.get(localId);
    out.push({
      key: g.key,
      label: g.label,
      commodity: def.commodity,
      unit: def.unit,
      pricetype: def.pricetype,
      currency: def.currency,
      latest: localLast ? { price: r2(localLast.price), month: localLast.month, market: data.markets[localId]!.name, distanceKm: Math.round(dist.get(localId)!) } : null,
      regionalLatest: lastReg ? r2(lastReg.value) : null,
      change3mPct: chg(3),
      change12mPct: chg(12),
      trendPctPerMonth: trend,
      series,
      nearby,
      seasonality: season,
      advice: sellOrStore({ seasonality: season, currentMonth: today.getUTCMonth() + 1, trendPctPerMonth: trend, storable: STORABLE.has(g.key) }),
      forCrops: g.crops.filter((c) => crops.includes(c)),
    });
  }
  // farmer's own crops first
  return out.sort((a, b) => b.forCrops.length - a.forCrops.length || (a.key === "rice" ? -1 : b.key === "rice" ? 1 : 0));
}

/** Evaluate a price alert against the latest price (on read — WFP updates monthly). */
export function alertHit(direction: "above" | "below", target: number, price: number | null | undefined): boolean {
  if (price == null) return false;
  return direction === "above" ? price >= target : price <= target;
}
