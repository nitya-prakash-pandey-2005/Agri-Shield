/**
 * Farm finance: season ledger summaries, fertiliser dose → cost calculator and the
 * weather-index insurance offer derived from the insurer's live book.
 *
 * Nutrient targets (kg/ha of N, P, K, S, Zn) are mid-range values for medium-fertility
 * soils from the BARC Fertilizer Recommendation Guide 2018 (Bangladesh) and ICAR
 * package-of-practice guides; product nutrient contents are standard (urea 46 % N,
 * TSP 20 % P, MoP 50 % K, gypsum 18 % S, zinc sulphate monohydrate 36 % Zn).
 * Default prices are typical 2024-25 farmer prices (subsidised where applicable) and
 * are editable in the UI because they vary by market.
 */
import type { LedgerEntryRecord } from "../data/farmer-tools-store";

export const NUTRIENT_TARGETS: Record<string, { n: number; p: number; k: number; s: number; zn: number; note: string }> = {
  rice: { n: 80, p: 12, k: 35, s: 9, zn: 1.5, note: "Monsoon (Aman/Kharif) HYV rice; dry-season (Boro) rice needs ~60% more N and K." },
  wheat: { n: 110, p: 25, k: 45, s: 15, zn: 0, note: "Irrigated wheat." },
  maize: { n: 220, p: 45, k: 90, s: 30, zn: 3, note: "Hybrid maize, dry season." },
  jute: { n: 85, p: 6, k: 28, s: 10, zn: 0, note: "Tossa jute." },
  onion: { n: 110, p: 32, k: 75, s: 25, zn: 0, note: "Rabi onion." },
  potato: { n: 130, p: 25, k: 110, s: 15, zn: 0, note: "Rabi potato." },
  vegetables: { n: 100, p: 30, k: 60, s: 15, zn: 0, note: "Generic vegetables — check crop-specific guides." },
  sugarcane: { n: 150, p: 45, k: 100, s: 30, zn: 2, note: "Plant cane, whole season." },
  coconut: { n: 120, p: 35, k: 250, s: 0, zn: 0, note: "Bearing palms (≈ 175 palms/ha)." },
  mango: { n: 100, p: 25, k: 100, s: 0, zn: 0, note: "Bearing orchard (≈ 100 trees/ha)." },
};

export const PRODUCTS = [
  { id: "urea", nutrient: "n", content: 0.46 },
  { id: "tsp", nutrient: "p", content: 0.2 },
  { id: "mop", nutrient: "k", content: 0.5 },
  { id: "gypsum", nutrient: "s", content: 0.18 },
  { id: "znso4", nutrient: "zn", content: 0.36 },
] as const;
export type ProductId = (typeof PRODUCTS)[number]["id"];

/** Local-currency price per kg. */
export const DEFAULT_PRICES: Record<string, Record<ProductId, number>> = {
  BD: { urea: 27, tsp: 27, mop: 20, gypsum: 15, znso4: 180 },
  IN: { urea: 6, tsp: 25, mop: 34, gypsum: 5, znso4: 60 },
  VN: { urea: 11000, tsp: 5000, mop: 10000, gypsum: 3000, znso4: 40000 },
  PH: { urea: 30, tsp: 34, mop: 36, gypsum: 12, znso4: 120 },
  ID: { urea: 2250, tsp: 2400, mop: 12000, gypsum: 2000, znso4: 30000 },
};

export function fertiliserPlan(crop: string, areaHa: number, prices: Partial<Record<ProductId, number>>, country = "BD") {
  const t = NUTRIENT_TARGETS[crop] ?? NUTRIENT_TARGETS.vegetables!;
  const base = DEFAULT_PRICES[country] ?? DEFAULT_PRICES.BD!;
  const lines = PRODUCTS.map((p) => {
    const nutrientKgHa = t[p.nutrient];
    const kgHa = nutrientKgHa > 0 ? nutrientKgHa / p.content : 0;
    const kg = kgHa * areaHa;
    const price = prices[p.id] ?? base[p.id];
    return { product: p.id, nutrientKgHa, kgPerHa: Math.round(kgHa), kg: Math.round(kg * 10) / 10, bags50: Math.round((kg / 50) * 10) / 10, pricePerKg: price, cost: Math.round(kg * price) };
  }).filter((l) => l.kgPerHa > 0);
  return { crop, areaHa, targets: t, lines, total: lines.reduce((s, l) => s + l.cost, 0), perHa: areaHa > 0 ? Math.round(lines.reduce((s, l) => s + l.cost, 0) / areaHa) : 0 };
}

export function ledgerSummary(entries: LedgerEntryRecord[], fields: { id: string; name: string; areaHa: number; cropType: string }[]) {
  const seasons = [...new Set(entries.map((e) => e.season))];
  const bySeason = seasons
    .map((season) => {
      const rows = entries.filter((e) => e.season === season);
      const income = rows.filter((r) => r.kind === "income").reduce((s, r) => s + r.amount, 0);
      const expense = rows.filter((r) => r.kind === "expense").reduce((s, r) => s + r.amount, 0);
      const byCategory: Record<string, number> = {};
      for (const r of rows) if (r.kind === "expense") byCategory[r.category] = (byCategory[r.category] ?? 0) + r.amount;
      const perField = fields
        .map((f) => {
          const fr = rows.filter((r) => r.fieldId === f.id);
          if (!fr.length) return null;
          const inc = fr.filter((r) => r.kind === "income").reduce((s, r) => s + r.amount, 0);
          const exp = fr.filter((r) => r.kind === "expense").reduce((s, r) => s + r.amount, 0);
          return { fieldId: f.id, name: f.name, crop: f.cropType, areaHa: f.areaHa, income: inc, expense: exp, profit: inc - exp, profitPerHa: f.areaHa ? Math.round((inc - exp) / f.areaHa) : null };
        })
        .filter((x): x is NonNullable<typeof x> => !!x);
      const last = rows.reduce((m, r) => (r.date > m ? r.date : m), "");
      return { season, income, expense, profit: income - expense, byCategory, perField, entries: rows.length, lastDate: last };
    })
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate));
  return { seasons: bySeason };
}

/** Name the current season for a crop from the planting month (used for new ledger rows). */
export function seasonLabel(country: string, crop: string, plantingDate: Date): string {
  const m = plantingDate.getUTCMonth() + 1;
  const y = plantingDate.getUTCFullYear();
  if (country === "BD") {
    if (crop === "rice") return m >= 6 && m <= 9 ? `Aman ${y}` : m >= 3 && m <= 5 ? `Aus ${y}` : `Boro ${m >= 10 ? y + 1 : y}`;
    return m >= 3 && m <= 6 ? `Kharif-1 ${y}` : m >= 7 && m <= 9 ? `Kharif-2 ${y}` : `Rabi ${m >= 10 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`}`;
  }
  if (country === "IN") return m >= 6 && m <= 10 ? `Kharif ${y}` : m >= 3 && m <= 5 ? `Zaid ${y}` : `Rabi ${m >= 11 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`}`;
  if (country === "VN" && crop === "rice") return m >= 11 || m <= 1 ? `Đông Xuân ${m >= 11 ? y + 1 : y}` : m <= 6 ? `Hè Thu ${y}` : `Thu Đông ${y}`;
  if (country === "PH" || country === "ID") return m >= 5 && m <= 10 ? `Wet season ${y}` : `Dry season ${m >= 11 ? y + 1 : y}`;
  return `${y}`;
}

// ─── Insurance offer (from the insurer's live book in store.assets) ───────

export interface InsuranceBook {
  workspaceId: string;
  insurer: string;
  product: string;
  policies: number;
  policiesInDistrict: number;
  premiumRate: number; // fraction of sum insured (district average when available)
  bookPremiumRate: number;
  sumInsuredPerHaUsd: Record<string, number>;
  season: string | null;
}

export function insuranceBook(
  assets: { workspaceId: string; type: string; crop: string | null; areaHa: number | null; valueUsd: number; districtId: string | null; status: string; meta: Record<string, string | number | boolean | null> }[],
  workspaceId: string,
  insurer: string,
  districtId: string
): InsuranceBook | null {
  const book = assets.filter((a) => a.workspaceId === workspaceId && a.type === "insured_plot" && a.status === "active" && String(a.meta.product ?? "").startsWith("Weather"));
  if (!book.length) return null;
  const prem = book.reduce((s, a) => s + Number(a.meta.premiumUsd ?? 0), 0);
  const val = book.reduce((s, a) => s + a.valueUsd, 0);
  const perHa: Record<string, { v: number; ha: number }> = {};
  for (const a of book) {
    if (!a.crop || !a.areaHa) continue;
    const e = (perHa[a.crop] ??= { v: 0, ha: 0 });
    e.v += a.valueUsd;
    e.ha += a.areaHa;
  }
  // Rates are priced by exposure: prefer the insurer's average rate in the farmer's own district
  const local = book.filter((a) => a.districtId === districtId);
  const lp = local.reduce((s, a) => s + Number(a.meta.premiumUsd ?? 0), 0);
  const lv = local.reduce((s, a) => s + a.valueUsd, 0);
  const bookRate = val ? prem / val : 0.045;
  return {
    workspaceId,
    insurer,
    product: String(book[0]!.meta.product),
    policies: book.length,
    policiesInDistrict: book.filter((a) => a.districtId === districtId).length,
    premiumRate: Math.round((lv ? lp / lv : bookRate) * 1000) / 1000,
    bookPremiumRate: Math.round(bookRate * 1000) / 1000,
    sumInsuredPerHaUsd: Object.fromEntries(Object.entries(perHa).map(([k, e]) => [k, Math.round(e.v / e.ha)])),
    season: (book[0]!.meta.season as string) ?? null,
  };
}
