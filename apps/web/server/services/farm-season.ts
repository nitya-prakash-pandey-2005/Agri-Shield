/**
 * Planting & season planner.
 *
 *  · Crop calendars by country & crop — main-field planting windows and field
 *    duration, from FAO GIEWS country crop calendars, IRRI Rice Knowledge Bank and the
 *    national institutes (BRRI/BARI/BJRI Bangladesh, ICAR India, PhilRice, CLRRI Vietnam,
 *    Balitbangtan Indonesia). Dates are typical ranges for the delta regions we serve.
 *  · Open-Meteo seasonal forecast (ECMWF SEAS5-based, monthly mean + anomaly vs. the
 *    model climatology) for the next 6 months.
 *  · `pickSowingWindow` combines both into a "best sowing window" with plain reasons.
 *  · Stress-tolerant variety catalogue (submergence / salinity / drought / heat / blast).
 */
import { cached, fetchJson } from "../live/http";

export type Md = [number, number]; // [month 1-12, day]

export interface SeasonWindow {
  id: string;
  name: string;
  sowFrom: Md;
  sowTo: Md;
  /** days from main-field planting (transplanting / sowing) to harvest */
  fieldDays: number;
  water: "rainfed" | "irrigated" | "either";
  /** perennial tree crops: first harvest after N years */
  perennialYears?: number;
  note: string;
}

type Calendar = Record<string, SeasonWindow[]>;

const PERENNIAL = (from: Md, to: Md, years: number, note: string): SeasonWindow[] => [{ id: "planting", name: "Planting", sowFrom: from, sowTo: to, fieldDays: 0, water: "rainfed", perennialYears: years, note }];

export const CALENDARS: Record<string, { source: string; crops: Calendar }> = {
  BD: {
    source: "BRRI / BARI / BJRI crop calendars · FAO GIEWS (Bangladesh)",
    crops: {
      rice: [
        { id: "aus", name: "Aus", sowFrom: [4, 1], sowTo: [5, 15], fieldDays: 100, water: "either", note: "Pre-monsoon crop; direct-seeded or transplanted." },
        { id: "aman", name: "T. Aman", sowFrom: [7, 1], sowTo: [8, 31], fieldDays: 115, water: "rainfed", note: "Monsoon crop, transplanted after 25–30 day seedlings." },
        { id: "boro", name: "Boro", sowFrom: [12, 15], sowTo: [2, 10], fieldDays: 135, water: "irrigated", note: "Dry-season irrigated crop; salinity rises Feb–Apr in the coastal belt." },
      ],
      jute: [{ id: "kharif1", name: "Kharif-1", sowFrom: [3, 15], sowTo: [5, 15], fieldDays: 120, water: "rainfed", note: "Tossa jute; needs ~ 50 mm pre-monsoon rain to sow." }],
      wheat: [{ id: "rabi", name: "Rabi", sowFrom: [11, 15], sowTo: [12, 15], fieldDays: 110, water: "irrigated", note: "Late sowing pushes grain filling into March heat." }],
      maize: [
        { id: "rabi", name: "Rabi", sowFrom: [11, 1], sowTo: [12, 15], fieldDays: 140, water: "irrigated", note: "Main hybrid-maize season." },
        { id: "kharif1", name: "Kharif-1", sowFrom: [2, 15], sowTo: [3, 31], fieldDays: 110, water: "either", note: "Summer maize; harvest before peak monsoon." },
      ],
      onion: [{ id: "rabi", name: "Rabi", sowFrom: [11, 15], sowTo: [12, 31], fieldDays: 110, water: "irrigated", note: "Transplant 40–45 day seedlings." }],
      potato: [{ id: "rabi", name: "Rabi", sowFrom: [11, 1], sowTo: [12, 10], fieldDays: 95, water: "irrigated", note: "Cool-season crop; late blight risk in foggy spells." }],
      vegetables: [
        { id: "winter", name: "Winter (Rabi)", sowFrom: [10, 1], sowTo: [11, 30], fieldDays: 80, water: "irrigated", note: "Most profitable vegetable season." },
        { id: "summer", name: "Summer (Kharif)", sowFrom: [3, 1], sowTo: [4, 30], fieldDays: 75, water: "either", note: "Use raised beds against waterlogging." },
      ],
      sugarcane: [
        { id: "autumn", name: "Autumn planting", sowFrom: [10, 15], sowTo: [11, 30], fieldDays: 330, water: "either", note: "Highest yields." },
        { id: "spring", name: "Spring planting", sowFrom: [2, 1], sowTo: [3, 15], fieldDays: 300, water: "either", note: "" },
      ],
      coconut: PERENNIAL([6, 1], [8, 31], 5, "Plant seedlings at monsoon onset; dwarf types bear in 3–4 years."),
      mango: PERENNIAL([6, 1], [8, 31], 4, "Plant grafts at monsoon onset; first fruit in 3–5 years."),
    },
  },
  VN: {
    source: "CLRRI / MARD Mekong Delta cropping calendar · FAO GIEWS (Viet Nam)",
    crops: {
      rice: [
        { id: "dx", name: "Đông Xuân (Winter–Spring)", sowFrom: [11, 15], sowTo: [12, 31], fieldDays: 100, water: "irrigated", note: "Highest-yield season; salinity intrusion peaks Feb–Apr." },
        { id: "ht", name: "Hè Thu (Summer–Autumn)", sowFrom: [4, 15], sowTo: [5, 31], fieldDays: 95, water: "either", note: "Sow after first rains flush salt." },
        { id: "td", name: "Thu Đông (Autumn–Winter)", sowFrom: [8, 1], sowTo: [9, 15], fieldDays: 95, water: "either", note: "Only inside flood-protected dykes." },
      ],
      maize: [{ id: "dry", name: "Dry season", sowFrom: [12, 1], sowTo: [1, 31], fieldDays: 100, water: "irrigated", note: "" }],
      vegetables: [{ id: "dry", name: "Dry season", sowFrom: [11, 1], sowTo: [1, 31], fieldDays: 75, water: "irrigated", note: "" }],
      onion: [{ id: "dry", name: "Dry season (shallot)", sowFrom: [11, 1], sowTo: [12, 31], fieldDays: 75, water: "irrigated", note: "" }],
      sugarcane: [{ id: "main", name: "Main planting", sowFrom: [4, 1], sowTo: [5, 31], fieldDays: 330, water: "either", note: "" }],
      coconut: PERENNIAL([5, 1], [7, 31], 4, "Plant at rainy-season onset; dwarf types bear in ~3 years."),
      mango: PERENNIAL([5, 1], [7, 31], 3, "Plant grafts at rainy-season onset."),
    },
  },
  PH: {
    source: "PhilRice / DA-BAR cropping calendar · FAO GIEWS (Philippines)",
    crops: {
      rice: [
        { id: "wet", name: "Wet season", sowFrom: [6, 1], sowTo: [7, 31], fieldDays: 110, water: "rainfed", note: "Typhoon season Aug–Oct: prefer submergence-tolerant varieties in low fields." },
        { id: "dry", name: "Dry season", sowFrom: [11, 15], sowTo: [1, 15], fieldDays: 110, water: "irrigated", note: "Higher yields with irrigation." },
      ],
      maize: [
        { id: "wet", name: "Wet season", sowFrom: [5, 1], sowTo: [6, 30], fieldDays: 110, water: "rainfed", note: "" },
        { id: "dry", name: "Dry season", sowFrom: [10, 15], sowTo: [12, 15], fieldDays: 110, water: "either", note: "" },
      ],
      onion: [{ id: "dry", name: "Dry season", sowFrom: [11, 1], sowTo: [1, 15], fieldDays: 100, water: "irrigated", note: "Nueva Ecija onion belt timing." }],
      vegetables: [{ id: "dry", name: "Dry season", sowFrom: [10, 1], sowTo: [1, 31], fieldDays: 80, water: "irrigated", note: "" }],
      sugarcane: [{ id: "main", name: "Main planting", sowFrom: [10, 1], sowTo: [12, 31], fieldDays: 330, water: "either", note: "" }],
      coconut: PERENNIAL([6, 1], [8, 31], 5, "Plant at wet-season onset."),
      mango: PERENNIAL([6, 1], [8, 31], 4, "Plant grafts at wet-season onset; flowering is induced Oct–Jan."),
    },
  },
  IN: {
    source: "ICAR / State Agriculture Dept. (Odisha, West Bengal) crop calendars · FAO GIEWS (India)",
    crops: {
      rice: [
        { id: "kharif", name: "Kharif", sowFrom: [6, 20], sowTo: [8, 15], fieldDays: 120, water: "rainfed", note: "Transplant after monsoon onset." },
        { id: "rabi", name: "Rabi (Boro)", sowFrom: [12, 15], sowTo: [1, 31], fieldDays: 125, water: "irrigated", note: "" },
      ],
      wheat: [{ id: "rabi", name: "Rabi", sowFrom: [11, 10], sowTo: [12, 10], fieldDays: 115, water: "irrigated", note: "Sow by mid-November to escape terminal heat." }],
      jute: [{ id: "pre", name: "Pre-kharif", sowFrom: [3, 15], sowTo: [5, 15], fieldDays: 120, water: "rainfed", note: "" }],
      maize: [
        { id: "kharif", name: "Kharif", sowFrom: [6, 1], sowTo: [7, 15], fieldDays: 100, water: "rainfed", note: "" },
        { id: "rabi", name: "Rabi", sowFrom: [10, 15], sowTo: [11, 30], fieldDays: 130, water: "irrigated", note: "" },
      ],
      onion: [{ id: "rabi", name: "Rabi", sowFrom: [12, 1], sowTo: [1, 15], fieldDays: 110, water: "irrigated", note: "" }],
      potato: [{ id: "rabi", name: "Rabi", sowFrom: [10, 25], sowTo: [11, 30], fieldDays: 95, water: "irrigated", note: "" }],
      vegetables: [{ id: "rabi", name: "Rabi", sowFrom: [10, 1], sowTo: [11, 30], fieldDays: 80, water: "irrigated", note: "" }],
      sugarcane: [{ id: "spring", name: "Spring planting", sowFrom: [1, 15], sowTo: [3, 15], fieldDays: 330, water: "irrigated", note: "" }],
      coconut: PERENNIAL([6, 1], [8, 31], 5, "Plant at monsoon onset."),
      mango: PERENNIAL([6, 15], [8, 31], 4, "Plant grafts at monsoon onset."),
    },
  },
  ID: {
    source: "Balitbangtan / Kementan cropping calendar (KATAM) · FAO GIEWS (Indonesia)",
    crops: {
      rice: [
        { id: "mt1", name: "MT-1 (Rendeng, wet)", sowFrom: [10, 15], sowTo: [12, 31], fieldDays: 110, water: "either", note: "Plant when cumulative rain passes ~ 150 mm." },
        { id: "mt2", name: "MT-2 (Gadu, dry)", sowFrom: [3, 1], sowTo: [4, 30], fieldDays: 110, water: "irrigated", note: "" },
      ],
      maize: [
        { id: "wet", name: "Wet season", sowFrom: [10, 15], sowTo: [12, 15], fieldDays: 100, water: "rainfed", note: "" },
        { id: "dry", name: "Dry season", sowFrom: [2, 15], sowTo: [4, 15], fieldDays: 100, water: "either", note: "" },
      ],
      onion: [{ id: "dry", name: "Dry season (bawang merah)", sowFrom: [4, 1], sowTo: [7, 31], fieldDays: 65, water: "irrigated", note: "" }],
      vegetables: [{ id: "dry", name: "Dry season", sowFrom: [4, 1], sowTo: [6, 30], fieldDays: 75, water: "irrigated", note: "" }],
      sugarcane: [{ id: "main", name: "Main planting", sowFrom: [5, 1], sowTo: [7, 31], fieldDays: 330, water: "either", note: "" }],
      coconut: PERENNIAL([11, 1], [1, 31], 5, "Plant at rainy-season onset."),
      mango: PERENNIAL([11, 1], [1, 31], 4, "Plant grafts at rainy-season onset."),
    },
  },
};

// ─── Stress-tolerant varieties ────────────────────────────────────────────

export type Tolerance = "submergence" | "salinity" | "drought" | "heat" | "blast" | "short_duration" | "high_yield";

export interface Variety {
  name: string;
  crop: string;
  countries: string[];
  seasons: string[]; // season ids it suits ("*" = any)
  tolerances: Tolerance[];
  durationDays: number; // seed to harvest
  note: string;
  source: string;
}

export const VARIETIES: Variety[] = [
  { name: "BRRI dhan 51", crop: "rice", countries: ["BD"], seasons: ["aman"], tolerances: ["submergence"], durationDays: 145, note: "Sub1 variety — survives 10–15 days under water.", source: "BRRI" },
  { name: "BRRI dhan 52", crop: "rice", countries: ["BD"], seasons: ["aman"], tolerances: ["submergence", "high_yield"], durationDays: 150, note: "Sub1 variety — survives up to 2 weeks of flash flooding; ~5 t/ha.", source: "BRRI" },
  { name: "BRRI dhan 79", crop: "rice", countries: ["BD"], seasons: ["aman"], tolerances: ["submergence"], durationDays: 135, note: "Sub1, shorter duration than BRRI dhan 52.", source: "BRRI" },
  { name: "Swarna-Sub1", crop: "rice", countries: ["BD", "IN"], seasons: ["aman", "kharif"], tolerances: ["submergence", "high_yield"], durationDays: 145, note: "Swarna with SUB1 gene — survives 14 days of complete submergence.", source: "IRRI / ICAR-NRRI" },
  { name: "BRRI dhan 71", crop: "rice", countries: ["BD"], seasons: ["aman"], tolerances: ["drought", "short_duration"], durationDays: 115, note: "Drought-tolerant Aman variety for late-monsoon dry spells.", source: "BRRI" },
  { name: "BINA dhan 7", crop: "rice", countries: ["BD"], seasons: ["aman"], tolerances: ["short_duration"], durationDays: 115, note: "Short duration — frees land for an early Rabi crop.", source: "BINA" },
  { name: "BRRI dhan 48", crop: "rice", countries: ["BD"], seasons: ["aus"], tolerances: ["short_duration", "high_yield"], durationDays: 110, note: "Popular Aus variety; harvest before the Aman season.", source: "BRRI" },
  { name: "BRRI dhan 67", crop: "rice", countries: ["BD"], seasons: ["boro"], tolerances: ["salinity"], durationDays: 145, note: "Salt-tolerant Boro variety (tolerates 8 dS/m at vegetative stage).", source: "BRRI" },
  { name: "BRRI dhan 47", crop: "rice", countries: ["BD"], seasons: ["boro"], tolerances: ["salinity"], durationDays: 152, note: "Salt-tolerant Boro variety for the coastal belt.", source: "BRRI" },
  { name: "BINA dhan 10", crop: "rice", countries: ["BD"], seasons: ["boro"], tolerances: ["salinity", "high_yield"], durationDays: 130, note: "Salt-tolerant Boro variety (up to ~12 dS/m at seedling stage).", source: "BINA" },
  { name: "BRRI dhan 89", crop: "rice", countries: ["BD"], seasons: ["boro"], tolerances: ["high_yield"], durationDays: 155, note: "High-yield Boro variety for non-saline land.", source: "BRRI" },
  { name: "OM 5451", crop: "rice", countries: ["VN"], seasons: ["dx", "ht", "td"], tolerances: ["short_duration", "salinity"], durationDays: 95, note: "Short-duration Mekong variety with moderate salt tolerance; fits 3 crops a year.", source: "CLRRI" },
  { name: "ST25", crop: "rice", countries: ["VN"], seasons: ["dx", "ht"], tolerances: ["salinity"], durationDays: 100, note: "Fragrant rice with moderate salinity tolerance (Sóc Trăng).", source: "Sóc Trăng DARD" },
  { name: "NSIC Rc194 (Submarino 1)", crop: "rice", countries: ["PH"], seasons: ["wet"], tolerances: ["submergence"], durationDays: 112, note: "Survives up to 2 weeks of complete submergence.", source: "PhilRice / IRRI" },
  { name: "NSIC Rc182 (Salinas 1)", crop: "rice", countries: ["PH"], seasons: ["wet", "dry"], tolerances: ["salinity"], durationDays: 110, note: "Salt-tolerant for coastal fields.", source: "PhilRice" },
  { name: "NSIC Rc192 (Sahod Ulan 1)", crop: "rice", countries: ["PH"], seasons: ["wet"], tolerances: ["drought"], durationDays: 108, note: "Drought-tolerant for rainfed lowlands.", source: "PhilRice / IRRI" },
  { name: "NSIC Rc222 (Tubigan 18)", crop: "rice", countries: ["PH"], seasons: ["wet", "dry"], tolerances: ["high_yield"], durationDays: 114, note: "High-yield irrigated variety.", source: "PhilRice" },
  { name: "Sahbhagi Dhan", crop: "rice", countries: ["IN"], seasons: ["kharif"], tolerances: ["drought", "short_duration"], durationDays: 105, note: "Drought-tolerant for rainfed uplands and shallow lowlands.", source: "ICAR / IRRI" },
  { name: "CR Dhan 405 (Luna Sampad)", crop: "rice", countries: ["IN"], seasons: ["kharif", "rabi"], tolerances: ["salinity"], durationDays: 130, note: "Salt-tolerant variety for coastal Odisha and West Bengal.", source: "ICAR-NRRI" },
  { name: "Inpari 30 Ciherang Sub1", crop: "rice", countries: ["ID"], seasons: ["mt1", "mt2"], tolerances: ["submergence", "high_yield"], durationDays: 111, note: "Ciherang with SUB1 — survives ~ 2 weeks under water.", source: "Balitbangtan" },
  { name: "Inpari 34 Salin Agritan", crop: "rice", countries: ["ID"], seasons: ["mt1", "mt2"], tolerances: ["salinity"], durationDays: 102, note: "Salt-tolerant at seedling stage (~ 12 dS/m).", source: "Balitbangtan" },
  { name: "BARI Gom 33", crop: "wheat", countries: ["BD"], seasons: ["rabi"], tolerances: ["blast", "heat"], durationDays: 110, note: "Resistant to wheat blast; zinc-enriched grain.", source: "BWMRI / BARI" },
  { name: "BARI Gom 30", crop: "wheat", countries: ["BD"], seasons: ["rabi"], tolerances: ["heat"], durationDays: 105, note: "Heat tolerant — suits late sowing.", source: "BARI" },
  { name: "HD 3086", crop: "wheat", countries: ["IN"], seasons: ["rabi"], tolerances: ["high_yield"], durationDays: 145, note: "High-yield timely-sown wheat.", source: "ICAR-IARI" },
  { name: "BJRI Tossa Pat 8 (Robi-1)", crop: "jute", countries: ["BD"], seasons: ["kharif1"], tolerances: ["high_yield"], durationDays: 120, note: "High-fibre tossa jute.", source: "BJRI" },
  { name: "BARI Piaz-1", crop: "onion", countries: ["BD"], seasons: ["rabi"], tolerances: [], durationDays: 110, note: "Standard Rabi onion.", source: "BARI" },
];

export function suggestVarieties(opts: { crop: string; country: string; seasonId?: string | null; floodRisk: number; salinityRisk: number; soilEc: number; droughtSignal: boolean; heatSignal: boolean }) {
  const want = new Map<Tolerance, number>();
  if (opts.floodRisk >= 45) want.set("submergence", opts.floodRisk);
  if (opts.salinityRisk >= 45 || opts.soilEc >= 4) want.set("salinity", Math.max(opts.salinityRisk, opts.soilEc * 12));
  if (opts.droughtSignal) want.set("drought", 55);
  if (opts.heatSignal) want.set("heat", 55);
  if (opts.crop === "wheat" && opts.country === "BD") want.set("blast", 60);
  const list = VARIETIES.filter((v) => v.crop === opts.crop && v.countries.includes(opts.country) && (!opts.seasonId || v.seasons.includes(opts.seasonId) || v.seasons.includes("*")));
  return list
    .map((v) => {
      const matched = v.tolerances.filter((t) => want.has(t));
      const score = matched.reduce((s, t) => s + (want.get(t) ?? 0), 0) + (v.tolerances.includes("high_yield") ? 10 : 0);
      return { ...v, matched, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

// ─── Seasonal outlook ─────────────────────────────────────────────────────

export interface OutlookMonth {
  month: string; // YYYY-MM
  rainMm: number | null;
  rainNormalMm: number | null;
  rainAnomalyMm: number | null;
  rainAnomalyPct: number | null;
  tempC: number | null;
  tempAnomalyC: number | null;
}

export function getSeasonalOutlook(lat: number, lon: number): Promise<{ months: OutlookMonth[]; source: string }> {
  return cached(`seasonal:${lat.toFixed(1)},${lon.toFixed(1)}`, 12 * 3600_000, async () => {
    const r = await fetchJson<{ monthly: { time: string[]; temperature_2m_mean: (number | null)[]; temperature_2m_anomaly: (number | null)[]; precipitation_mean: (number | null)[]; precipitation_anomaly: (number | null)[] } }>(
      `https://seasonal-api.open-meteo.com/v1/seasonal?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&monthly=temperature_2m_mean,temperature_2m_anomaly,precipitation_mean,precipitation_anomaly`,
      15000
    );
    const m = r.monthly;
    return { months: m.time.map((t, i) => outlookMonth(t.slice(0, 7), m.precipitation_mean[i] ?? null, m.precipitation_anomaly[i] ?? null, m.temperature_2m_mean[i] ?? null, m.temperature_2m_anomaly[i] ?? null)), source: "Open-Meteo Seasonal (ECMWF SEAS5)" };
  });
}

export function outlookMonth(month: string, rain: number | null, rainAnom: number | null, temp: number | null, tempAnom: number | null): OutlookMonth {
  const normal = rain != null && rainAnom != null ? rain - rainAnom : null;
  const r1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);
  return {
    month,
    rainMm: r1(rain),
    rainNormalMm: r1(normal),
    rainAnomalyMm: r1(rainAnom),
    // % anomalies are meaningless for bone-dry months — only report above 20 mm normal
    rainAnomalyPct: normal != null && normal >= 20 && rainAnom != null ? Math.round((rainAnom / normal) * 100) : null,
    tempC: r1(temp),
    tempAnomalyC: r1(tempAnom),
  };
}

// ─── Sowing window ────────────────────────────────────────────────────────

export interface WindowReason {
  code: "open_now" | "upcoming" | "rain_deficit" | "rain_surplus" | "heat_flowering" | "normal" | "no_outlook" | "salinity_dry" | "flood_prone";
  text: string;
  tone: "good" | "warn" | "info";
}

export interface SowingPlan {
  season: SeasonWindow;
  windowFrom: string;
  windowTo: string;
  bestFrom: string;
  bestTo: string;
  harvestFrom: string | null;
  harvestTo: string | null;
  score: number;
  reasons: WindowReason[];
  status: "open" | "upcoming";
  daysUntil: number;
}

const DAYMS = 86_400_000;
const isoD = (d: Date) => d.toISOString().slice(0, 10);
const ym = (d: Date) => d.toISOString().slice(0, 7);
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (key: string) => `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

/** Next occurrence of a (possibly year-wrapping) window that has not ended yet. */
export function nextOccurrence(from: Md, to: Md, today: Date): { start: Date; end: Date } {
  const y = today.getUTCFullYear();
  for (const yy of [y - 1, y, y + 1]) {
    const start = new Date(Date.UTC(yy, from[0] - 1, from[1]));
    const endYear = to[0] < from[0] || (to[0] === from[0] && to[1] < from[1]) ? yy + 1 : yy;
    const end = new Date(Date.UTC(endYear, to[0] - 1, to[1]));
    if (end.getTime() >= today.getTime()) return { start, end };
  }
  const start = new Date(Date.UTC(y + 1, from[0] - 1, from[1]));
  return { start, end: new Date(start.getTime() + 60 * DAYMS) };
}

export function pickSowingWindow(opts: {
  crop: string;
  country: string;
  today: Date;
  outlook: OutlookMonth[];
  floodRisk: number;
  salinityRisk: number;
  irrigated: boolean;
  horizonDays?: number;
}): { plans: SowingPlan[]; best: SowingPlan | null; source: string } {
  const cal = CALENDARS[opts.country] ?? CALENDARS.BD!;
  const seasons = cal.crops[opts.crop] ?? [];
  const byMonth = new Map(opts.outlook.map((m) => [m.month, m]));
  const horizon = opts.horizonDays ?? 240;
  const plans: SowingPlan[] = [];
  for (const s of seasons) {
    const { start, end } = nextOccurrence(s.sowFrom, s.sowTo, opts.today);
    const effStart = start.getTime() < opts.today.getTime() ? opts.today : start;
    const daysUntil = Math.max(0, Math.round((effStart.getTime() - opts.today.getTime()) / DAYMS));
    if (daysUntil > horizon) continue;
    const reasons: WindowReason[] = [];
    let score = 70;
    const len = Math.max(1, Math.round((end.getTime() - effStart.getTime()) / DAYMS));
    // default: the first 60 % of the window (early planting avoids end-of-season stress)
    let bestA = 0;
    let bestB = 0.6;
    const estMonth = byMonth.get(ym(new Date(effStart.getTime() + 15 * DAYMS)));
    const flowerMonth = s.fieldDays ? byMonth.get(ym(new Date(effStart.getTime() + Math.round(s.fieldDays * 0.65) * DAYMS))) : undefined;
    const rainfedish = s.water !== "irrigated" && !opts.irrigated;
    reasons.push(start.getTime() <= opts.today.getTime() ? { code: "open_now", text: `The ${s.name} planting window is open now (until ${isoD(end)}).`, tone: "good" } : { code: "upcoming", text: `The ${s.name} planting window opens in ${daysUntil} days.`, tone: "info" });
    if (!estMonth) {
      reasons.push({ code: "no_outlook", text: "Seasonal forecast does not reach this window yet — plan with the normal calendar.", tone: "info" });
    } else {
      const pct = estMonth.rainAnomalyPct;
      if (pct != null && pct <= -20 && rainfedish) {
        score -= 20;
        bestA = 0.35;
        bestB = 0.9;
        reasons.push({ code: "rain_deficit", text: `Forecast rain in ${monthName(estMonth.month)} is ${Math.abs(pct)}% below normal (${estMonth.rainMm} mm vs ${estMonth.rainNormalMm} mm). Wait for soaking rain or plan irrigation before planting.`, tone: "warn" });
      } else if (pct != null && pct >= 25) {
        score -= opts.floodRisk >= 50 ? 15 : 5;
        reasons.push({ code: "rain_surplus", text: `Forecast rain in ${monthName(estMonth.month)} is ${pct}% above normal — ${opts.floodRisk >= 50 ? "your fields are flood-prone: use a submergence-tolerant variety and a raised seedbed" : "keep drains open"}.`, tone: "warn" });
      } else if (pct == null && estMonth.rainNormalMm != null && estMonth.rainNormalMm < 20) {
        reasons.push({ code: "normal", text: `${monthName(estMonth.month)} is normally dry here (about ${Math.round(estMonth.rainNormalMm)} mm of rain)${s.water === "rainfed" ? " — only plant if you can irrigate" : " — make sure your irrigation water is ready before transplanting"}.`, tone: s.water === "rainfed" ? "warn" : "info" });
      } else if (pct != null) {
        score += 10;
        reasons.push({ code: "normal", text: `Rain in ${monthName(estMonth.month)} looks near normal (${pct >= 0 ? "+" : ""}${pct}%).`, tone: "good" });
      }
      if (flowerMonth && flowerMonth.tempAnomalyC != null && flowerMonth.tempAnomalyC >= 1 && flowerMonth.tempC != null && flowerMonth.tempC >= 26) {
        score -= 10;
        bestA = 0;
        bestB = Math.min(bestB, 0.4);
        reasons.push({ code: "heat_flowering", text: `${monthName(flowerMonth.month)} (flowering) is forecast ${flowerMonth.tempAnomalyC} °C warmer than normal — plant early in the window so flowering avoids the heat.`, tone: "warn" });
      }
    }
    if (opts.salinityRisk >= 50 && s.water === "irrigated" && (opts.country === "BD" || opts.country === "VN" || opts.country === "IN")) {
      score -= 5;
      bestA = 0;
      bestB = Math.min(bestB, 0.5);
      reasons.push({ code: "salinity_dry", text: "Salinity rises through the dry season here — plant early and use a salt-tolerant variety; irrigate only with water below 2 dS/m.", tone: "warn" });
    }
    if (opts.floodRisk >= 60 && s.water === "rainfed") reasons.push({ code: "flood_prone", text: "Your fields flood often — raise the seedbed and keep spare seedlings for gap-filling.", tone: "info" });
    const bestFrom = new Date(effStart.getTime() + Math.round(len * bestA) * DAYMS);
    const bestTo = new Date(effStart.getTime() + Math.max(Math.round(len * bestB), 3) * DAYMS);
    plans.push({
      season: s,
      windowFrom: isoD(start),
      windowTo: isoD(end),
      bestFrom: isoD(bestFrom),
      bestTo: isoD(bestTo.getTime() > end.getTime() ? end : bestTo),
      harvestFrom: s.fieldDays ? isoD(new Date(bestFrom.getTime() + s.fieldDays * DAYMS)) : null,
      harvestTo: s.fieldDays ? isoD(new Date(Math.min(bestTo.getTime(), end.getTime()) + s.fieldDays * DAYMS)) : null,
      score: Math.max(5, Math.min(99, score - Math.round(daysUntil / 20))),
      reasons,
      status: start.getTime() <= opts.today.getTime() ? "open" : "upcoming",
      daysUntil,
    });
  }
  plans.sort((a, b) => a.daysUntil - b.daysUntil);
  const best = [...plans].sort((a, b) => b.score - a.score)[0] ?? null;
  return { plans, best, source: cal.source };
}
