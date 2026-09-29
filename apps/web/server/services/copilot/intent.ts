/**
 * Deterministic Copilot planner (the default when no LLM key is configured).
 *
 *   extractEntities(question, lexicon) → places, asset references, hazards,
 *                                        time windows, limits, thresholds,
 *                                        countries, asset types, crops, tags…
 *   routeQuestion(question, lexicon)   → intent + the tool calls to run
 *
 * Pure functions (no store / network) so they are cheap to unit-test.
 */
import type { AssetType } from "@agri-shield/types";
import { findTerm } from "./glossary";
import type { Hazard, ToolCall } from "./types";

export interface Lexicon {
  /** District / province names the platform monitors (any script). */
  districts: string[];
  /** Asset names in the caller's workspace (optional, enables name matching). */
  assetNames?: string[];
}

export interface Threshold {
  op: ">" | ">=" | "<" | "<=";
  value: number;
  unit: "%" | "mm" | "dS/m" | "score" | "km";
}

export interface Entities {
  places: string[];
  assets: string[];
  hazard: Hazard | null;
  hazards: Hazard[];
  hours: number | null;
  days: number | null;
  limit: number | null;
  threshold: Threshold | null;
  level: "critical" | "high" | "medium" | "low" | null;
  countries: string[];
  assetTypes: AssetType[];
  crops: string[];
  tags: string[];
  term: string | null;
  radiusKm: number | null;
  portfolioScoped: boolean;
  area: string | null;
}

export type IntentName =
  | "explain"
  | "compare"
  | "asset_detail"
  | "forecast"
  | "insurance"
  | "finance"
  | "anticipatory"
  | "alerts"
  | "hazards_near"
  | "top_risk"
  | "portfolio_summary"
  | "location"
  | "help";

export interface RoutedPlan {
  intent: IntentName;
  calls: ToolCall[];
  entities: Entities;
}

// ─── Vocabulary ───────────────────────────────────────────────────────────

export const COUNTRY_ALIASES: Record<string, string> = {
  bangladesh: "Bangladesh",
  bangladeshi: "Bangladesh",
  india: "India",
  indian: "India",
  odisha: "India",
  vietnam: "Vietnam",
  "viet nam": "Vietnam",
  vietnamese: "Vietnam",
  philippines: "Philippines",
  philippine: "Philippines",
  filipino: "Philippines",
  indonesia: "Indonesia",
  indonesian: "Indonesia",
  "sri lanka": "Sri Lanka",
};

const HAZARD_WORDS: [RegExp, Hazard][] = [
  [/\b(flood(s|ed|ing)?|inundat\w*|waterlog\w*|river (level|flow)s?|discharge)\b/i, "flood"],
  [/\b(salin\w*|salt\w*|saline|ec\b|brackish|seawater|sea water)/i, "salinity"],
  [/\b(drought\w*|dry spell|dryness|water deficit|water stress|arid)\b/i, "drought"],
  [/\b(heat\w*|hot|temperatures? stress|scorching)\b/i, "heat"],
  [/\b(composite|overall|combined|climate risk)\b/i, "composite"],
];

const TYPE_WORDS: [RegExp, AssetType[]][] = [
  [/\b(plots?|units?|polic(y|ies)|insured)\b/i, ["insured_plot"]],
  [/\b(loans?|borrowers?|credits?)\b/i, ["loan"]],
  [/\b(member farms?|farms?)\b/i, ["farm"]],
  [/\b(communit(y|ies)|villages?|households?)\b/i, ["community"]],
  [/\b(warehouses?|godowns?)\b/i, ["warehouse"]],
  [/\b(ports?)\b/i, ["port"]],
  [/\b(processing plants?|mills?|processors?)\b/i, ["processing_plant"]],
  [/\b(facilit(y|ies)|sites?)\b/i, ["warehouse", "processing_plant", "port", "retail_outlet"]],
];

const CROPS = ["rice", "paddy", "jute", "sugarcane", "coconut", "vegetables", "maize", "onion", "mango", "wheat", "shrimp"];
const TAGS = ["coastal", "inland", "parametric", "indemnity", "sme", "smallholder", "organic", "conventional", "salinity-hotspot", "flood-plain", "crop-loan", "equipment", "working-capital"];

const PORTFOLIO_WORDS =
  /\b(my|our|we|us|portfolio|book|assets?|plots?|units?|polic(y|ies)|loans?|borrowers?|farms?|members?|communit(y|ies)|facilit(y|ies)|warehouses?|ports?|sites?|clients?|exposure|insured|workspace|districts|provinces)\b/i;

const RANK_WORDS =
  /\b(top|riskiest|most (at[- ]risk|exposed|vulnerable|affected)|highest|worst|rank\w*|which|list|show( me)?|at[- ]risk|exceed\w*|above|over|greater than|more than|critical|high[- ]risk)\b/i;

/** Words that end (or invalidate) a captured place phrase. */
const STOP = new Set(
  (
    "the a an my our your their this that these those next coming following last past today tonight tomorrow week weekend month year years " +
    "days day hours hour hrs hr h d terms general total all any each every some portfolio book assets asset plots plot units unit policies policy loans loan farms farm " +
    "members member communities community facilities facility sites site region area areas country place places location locations " +
    "flood floods flooding salinity salt drought heat risk risks rain rainfall weather forecast temperature exposure hazard hazards score scores " +
    "and or with vs versus compared than to from over above below under between during within by on per is are be was were will would should could " +
    "for in at near of around about across into onto inside " +
    "me us it its please now currently right case order detail details more less much many how what which why when where who " +
    CROPS.join(" ") + " " + TAGS.join(" ")
  ).split(/\s+/)
);

export const stripDiacritics = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D");

const norm = (s: string) => stripDiacritics(s).toLowerCase();

function containsWord(haystack: string, needle: string) {
  const h = ` ${norm(haystack).replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  const n = norm(needle).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return n.length > 1 && h.includes(` ${n} `);
}

/** Capture up to 4 place-like tokens from the start of `text`. */
function capturePlace(text: string): string | null {
  const tokens = text.trim().split(/\s+/);
  const out: string[] = [];
  for (let i = 0; i < tokens.length && out.length < 4; i++) {
    const raw = tokens[i]!;
    const hadComma = /,$/.test(raw);
    const tok = raw.replace(/^[("'“]+|[)"'”,:;?.!]+$/g, "");
    if (!tok) break;
    const low = norm(tok);
    if (STOP.has(low) || /^\d/.test(tok) || /^[-–]/.test(tok)) break;
    if (/^[\p{L}][\p{L}\p{M}'’.-]*$/u.test(tok) === false) break;
    out.push(tok);
    if (/[?.!;:]$/.test(raw)) break;
    if (hadComma) {
      const next = tokens[i + 1]?.replace(/[?.!,;:]+$/g, "");
      const next2 = next && tokens[i + 2] ? `${next} ${tokens[i + 2]!.replace(/[?.!,;:]+$/g, "")}` : null;
      if (next && (COUNTRY_ALIASES[norm(next)] || (next2 && COUNTRY_ALIASES[norm(next2)]))) {
        out[out.length - 1] = `${tok},`;
        continue;
      }
      break;
    }
  }
  const s = out.join(" ").trim();
  return s.length >= 2 ? s : null;
}

function capturePlaceBackwards(text: string): string | null {
  const tokens = text.trim().split(/\s+/);
  const out: string[] = [];
  for (let i = tokens.length - 1; i >= 0 && out.length < 3; i--) {
    const tok = tokens[i]!.replace(/^[("'“,]+|[)"'”,:;?.!]+$/g, "");
    if (!tok || STOP.has(norm(tok)) || !/^[\p{L}][\p{L}\p{M}'’.-]*$/u.test(tok)) break;
    out.unshift(tok);
  }
  const s = out.join(" ").trim();
  return s.length >= 2 ? s : null;
}

const uniq = <T,>(a: T[]) => Array.from(new Set(a));
/** Drop duplicates and places contained in a longer captured place ("Satkhira" ⊂ "Satkhira, Bangladesh"). */
const dedupePlaces = (places: string[]) => {
  const keys = places.map((p) => norm(p).replace(/[^\p{L}\p{N}]+/gu, " ").trim());
  return places.filter((_, i) => {
    const k = keys[i]!;
    if (keys.indexOf(k) !== i) return false;
    return !keys.some((o, j) => j !== i && o.length > k.length && ` ${o} `.includes(` ${k} `));
  });
};

function comparePlaces(q: string): string[] {
  const split = (s: string) =>
    s
      .split(/\s*(?:,|;|&|\band\b|\bvs\.?|\bversus\b|\bwith\b|\bto\b|\bor\b)\s*/i)
      .map((x) => capturePlace(x))
      .filter((x): x is string => !!x);
  let m = q.match(/\bcompare\s+(?:the\s+)?(?:(?:flood|salinity|drought|heat|climate|overall)\s+)?(?:risks?\s+)?(?:(?:in|of|for|between)\s+)?(.+)$/i);
  if (m) return split(m[1]!);
  m = q.match(/(?:riskier|safer|worse|better|more exposed|more at risk|higher risk|lower risk)\b[^,:]*[,:]?\s*(.+?)\s+or\s+(.+)$/i);
  if (m) return [capturePlace(m[1]!.replace(/^(between|in)\s+/i, "")), capturePlace(m[2]!)].filter((x): x is string => !!x);
  m = q.match(/^(.*?)\s+(?:vs\.?|versus)\s+(.+)$/i);
  if (m) {
    const left = capturePlaceBackwards(m[1]!);
    const rest = split(m[2]!);
    return [left, ...rest].filter((x): x is string => !!x);
  }
  return [];
}

// ─── Entity extraction ────────────────────────────────────────────────────

export function extractEntities(question: string, lex: Lexicon): Entities {
  const q = question.trim().replace(/\s+/g, " ");
  const low = norm(q);

  // Hazards
  const hazards = uniq(HAZARD_WORDS.filter(([re]) => re.test(q)).map(([, h]) => h));
  const specific = hazards.filter((h) => h !== "composite");
  const hazard: Hazard | null = specific[0] ?? (hazards.includes("composite") ? "composite" : null);

  // Time window
  let hours: number | null = null;
  let days: number | null = null;
  const mh = low.match(/(\d{1,3})\s*(?:-?\s*)(h|hr|hrs|hour|hours)\b/);
  const md = low.match(/(\d{1,2})\s*(?:-?\s*)(d|day|days)\b/);
  if (mh) hours = Number(mh[1]);
  if (md) days = Number(md[1]);
  if (/\btomorrow\b/.test(low)) days ??= 2;
  if (/\b(today|tonight)\b/.test(low)) hours ??= 24;
  if (/\b(next|this|coming) week\b|\bweek ahead\b|\bweekly\b/.test(low)) days ??= 7;
  if (/\bweekend\b/.test(low)) days ??= 3;
  if (/\b(two|2) weeks?\b|\bfortnight\b/.test(low)) days = 14;
  if (hours && !days) days = Math.max(1, Math.ceil(hours / 24));

  // Limit ("top 5", "5 riskiest", "ten highest")
  const WORDNUM: Record<string, number> = { three: 3, five: 5, ten: 10, twenty: 20, fifteen: 15, seven: 7 };
  let limit: number | null = null;
  const ml = low.match(/\btop\s+(\d{1,3}|three|five|seven|ten|fifteen|twenty)\b/) ?? low.match(/\b(\d{1,3}|three|five|seven|ten|fifteen|twenty)\s+(?:most|riskiest|highest|worst|largest|biggest)\b/);
  if (ml) limit = Number(ml[1]) || WORDNUM[ml[1]!] || null;
  if (limit != null) limit = Math.min(50, Math.max(1, limit));

  // Thresholds ("above 60%", "> 120 mm", "over 3 dS/m", "at least 70")
  let threshold: Threshold | null = null;
  const mt = low.match(/(>=|<=|>|<|\babove\b|\bover\b|\bexceed(?:s|ing)?\b|\bgreater than\b|\bmore than\b|\bat least\b|\bbelow\b|\bunder\b|\bless than\b|\bat most\b)\s*(\d+(?:\.\d+)?)\s*(%|percent|mm|ds\/m|dsm|ds m|km|kilometers|kilometres)?/);
  if (mt) {
    const w = mt[1]!;
    const op: Threshold["op"] = w === ">=" || w.includes("least") ? ">=" : w === "<=" || w.includes("most") ? "<=" : w === "<" || /below|under|less/.test(w) ? "<" : ">";
    const u = mt[3] ?? "";
    const unit: Threshold["unit"] = u.startsWith("%") || u.startsWith("percent") ? "%" : u === "mm" ? "mm" : u.startsWith("ds") ? "dS/m" : u.startsWith("k") ? "km" : "score";
    threshold = { op, value: Number(mt[2]), unit };
  }
  let radiusKm: number | null = null;
  const mr = low.match(/\b(?:within|in a|radius(?: of)?)\s*(\d{1,4})\s*(?:km|kilomet(?:er|re)s?)\b/) ?? low.match(/(\d{1,4})\s*(?:km|kilomet(?:er|re)s?)\s+(?:radius|of|around|from)/);
  if (mr) radiusKm = Number(mr[1]);
  if (threshold?.unit === "km") {
    radiusKm ??= threshold.value;
    threshold = null;
  }

  // Risk level
  const level = /\bcritical\b/.test(low) ? "critical" : /\bhigh[- ]risk\b|\bhigh or critical\b|\bhigh\b(?= (flood|salinity|drought|heat|composite|climate)? ?risk)/.test(low) ? "high" : /\bmedium[- ]risk\b|\bmoderate\b/.test(low) ? "medium" : /\blow[- ]risk\b|\bsafest\b/.test(low) ? "low" : null;

  // Countries
  const countries = uniq(Object.entries(COUNTRY_ALIASES).filter(([k]) => containsWord(q, k)).map(([, v]) => v));

  // Asset types / crops / tags
  const assetTypes = uniq(TYPE_WORDS.filter(([re]) => re.test(q)).flatMap(([, t]) => t));
  const crops = uniq(CROPS.filter((c) => new RegExp(`\\b${c}\\b`, "i").test(q)).map((c) => (c === "paddy" ? "rice" : c)));
  const tags = TAGS.filter((t) => new RegExp(`\\b${t.replace("-", "[- ]")}\\b`, "i").test(q));

  // Asset references
  const assets: string[] = [];
  for (const m of q.matchAll(/\bast_[a-z0-9]{3,}\b/gi)) assets.push(m[0]!.toLowerCase());
  for (const m of q.matchAll(/\b(?:DMA|MRCB|MFPC|DRF)(?:-[A-Z0-9]+){1,3}\b/gi)) assets.push(m[0]!.toUpperCase());
  for (const m of q.matchAll(/\b(plot|unit|loan|member farm|farm|community|union|ward)\s*(?:no\.?|number|#)?\s*(\d{1,4})\b/gi)) {
    assets.push(`${m[1]!.toLowerCase()} ${Number(m[2])}`);
  }
  for (const name of lex.assetNames ?? []) {
    if (name.length >= 6 && containsWord(q, name) && !assets.some((a) => norm(name).includes(norm(a)))) assets.push(name);
  }

  // Places
  const places: string[] = [];
  const cmp = comparePlaces(q);
  places.push(...cmp);
  for (const m of q.matchAll(/\b(?:in|for|at|near|around|of|about|across)\s+([^?!;]+)/gi)) {
    const p = capturePlace(m[1]!);
    if (p) places.push(p);
  }
  for (const m of q.matchAll(/\b(?:assess|check|analy[sz]e|evaluate|is|how risky is|how safe is|visit)\s+(\p{Lu}[\p{L}\p{M}'’.-]*(?:,?\s+\p{Lu}[\p{L}\p{M}'’.-]*){0,3})/gu)) {
    const p = capturePlace(m[1]!);
    if (p) places.push(p);
  }
  // Monitored district names anywhere in the sentence
  for (const d of lex.districts) if (containsWord(q, d)) places.push(d);
  let cleaned = dedupePlaces(places)
    // an asset reference is not a place
    .filter((p) => !assets.some((a) => norm(a).includes(norm(p)) || norm(p).includes(norm(a))))
    .filter((p) => !TYPE_WORDS.some(([re]) => re.test(p) && p.split(" ").length === 1));
  // Keep compare order when present
  if (cmp.length >= 2) cleaned = uniq([...cmp, ...cleaned]);

  const portfolioScoped = PORTFOLIO_WORDS.test(q) && !/\b(any|a) (place|location|coordinate)\b/i.test(q);
  const termEntry = findTerm(q);

  // Area filter (portfolio questions): a monitored district / free place name that isn't a country
  const area = portfolioScoped ? (cleaned.find((p) => !COUNTRY_ALIASES[norm(p)]) ?? null) : null;

  return {
    places: cleaned,
    assets: uniq(assets),
    hazard,
    hazards,
    hours,
    days,
    limit,
    threshold,
    level,
    countries,
    assetTypes,
    crops,
    tags,
    term: termEntry?.key ?? null,
    radiusKm,
    portfolioScoped,
    area,
  };
}

// ─── Intent routing ───────────────────────────────────────────────────────

const RE = {
  explainStrong: /\b(define|definition|explain|meaning of|what does .+ (mean|stand for)|stands? for|how (is|do you|does agri-shield) (calculate|compute|measure)\w*|how are .+ (calculated|computed))\b/i,
  explainWhatIs: /^\s*(what(?:'s| is| are)|what's)\s+(an?\s+|the\s+)?([\p{L}\p{N}₀ /-]{2,40})\s*\??\s*$/iu,
  compare: /\b(compare|comparison|vs\.?|versus|riskier|safer|more exposed|which is worse|which is better)\b/i,
  forecast: /\b(forecast|weather|rain\w*|precip\w*|temperature|will it|outlook|next \d+ (days|hours)|tomorrow|this week|next week|storm coming)\b/i,
  insurance: /\b(premium\w*|sum insured|polic(y|ies)|claims?|loss ratio|payouts?|parametric|trigger|underwrit\w*|insur\w*|reinsur\w*|basis risk)\b/i,
  finance: /\b(loans?|borrowers?|credit|past[- ]due|dpd|npl|non-performing|collateral|outstanding|rating|default|lending|repay\w*|arrears)\b/i,
  financeMetric: /\b(past[- ]due|dpd|npl|non-performing|collateral|outstanding|ratings?|default\w*|arrears|repay\w*|interest|tenor|principal|loan book|credit (risk|exposure|quality))\b/i,
  insuranceMetric: /\b(premium\w*|sum insured|claims?|loss ratio|payouts?|parametric|trigger|underwrit\w*|reinsur\w*|basis risk)\b/i,
  riskWords: /\b(risk\w*|exposed|vulnerable|safe\w*|threat\w*|danger\w*|affected)\b/i,
  anticipatory: /\b(households?|communit(y|ies)|cash|anticipatory|beneficiar\w*|population|people|evacuat\w*|shelters?|early action|pre-?position\w*)\b/i,
  alerts: /\b(alerts?|rules?|notifications?|warnings?|triggered|fired|what happened|inbox)\b/i,
  hazardsNear: /\b(cyclones?|typhoons?|hurricanes?|earthquakes?|events?|gdacs|eonet|disasters?|hazards? (near|around|close)|storms?|wildfires?|volcano\w*)\b/i,
  summary: /\b(portfolio|summary|summari[sz]e|overview|exposure|how many|total|status|how (are|is) (we|my|our|the)|dashboard|brief\w*|snapshot|health)\b/i,
  location: /\b(risk|risky|safe|exposed|assess\w*|flood\w*|salin\w*|drought|heat|climate|vulnerab\w*|conditions?)\b/i,
};

export function routeQuestion(question: string, lex: Lexicon): RoutedPlan {
  const q = question.trim();
  const e = extractEntities(q, lex);
  const calls: ToolCall[] = [];
  const done = (intent: IntentName): RoutedPlan => ({ intent, calls, entities: e });
  const filters = () => {
    const f: Record<string, unknown> = {};
    if (e.countries.length) f.country = e.countries[0];
    if (e.assetTypes.length) f.types = e.assetTypes;
    if (e.crops.length) f.crop = e.crops[0];
    if (e.tags.length) f.tag = e.tags[0];
    if (e.area) f.area = e.area;
    return f;
  };
  const days = e.days ?? 7;

  // 1. Glossary questions
  const whatIs = q.match(RE.explainWhatIs);
  const whatIsTerm = whatIs ? findTerm(whatIs[3]!) : null;
  const explicitExplain = RE.explainStrong.test(q) && e.term && !(e.places.length && !/\bmean|stand|defin/i.test(q));
  if (e.term && (explicitExplain || (whatIsTerm && whatIsTerm.key === e.term && !e.places.length))) {
    calls.push({ tool: "explain_metric", args: { term: e.term } });
    return done("explain");
  }

  // 2. Compare places
  if (RE.compare.test(q) && e.places.length >= 2) {
    calls.push({ tool: "compare_places", args: { places: e.places.slice(0, 4), ...(e.hazard ? { hazard: e.hazard } : {}) } });
    return done("compare");
  }

  // 3. Specific asset
  if (e.assets.length) {
    if (RE.forecast.test(q)) {
      calls.push({ tool: "forecast", args: { asset: e.assets[0], days } });
      return done("forecast");
    }
    calls.push({ tool: "asset_detail", args: { asset: e.assets[0] } });
    return done("asset_detail");
  }

  const ranked = RANK_WORDS.test(q) || e.limit != null || e.threshold != null || e.level != null;
  const place = e.places.find((p) => !(e.portfolioScoped && COUNTRY_ALIASES[norm(p)]));

  // 4. Hazard events near assets / a place
  if (RE.hazardsNear.test(q) && !RE.insuranceMetric.test(q)) {
    if (place && !e.portfolioScoped) {
      calls.push({ tool: "assess_location", args: { place, focus: "hazards" } });
      return done("location");
    }
    calls.push({ tool: "hazards_near_assets", args: { radiusKm: e.radiusKm ?? 300 } });
    return done("hazards_near");
  }

  // 5. Industry modules
  const rankedRisk = ranked && e.portfolioScoped && (RE.riskWords.test(q) || !!e.hazard);
  if (RE.insurance.test(q) && !(/\b(rules?|alerts?)\b/i.test(q) && !/\btrigger\b/i.test(q)) && !(rankedRisk && !RE.insuranceMetric.test(q))) {
    calls.push({ tool: "insurance_stats", args: { ...(e.countries[0] ? { country: e.countries[0] } : {}) } });
    return done("insurance");
  }
  if (RE.finance.test(q) && (RE.financeMetric.test(q) || !rankedRisk)) {
    calls.push({ tool: "finance_stats", args: { ...(e.countries[0] ? { country: e.countries[0] } : {}) } });
    return done("finance");
  }
  if (RE.anticipatory.test(q) && !(ranked && e.hazard && !/\b(households?|people|population|cash)\b/i.test(q))) {
    calls.push({ tool: "anticipatory_stats", args: {} });
    return done("anticipatory");
  }

  // 6. Alerts & rules
  if (RE.alerts.test(q)) {
    calls.push({ tool: "alerts_and_rules", args: {} });
    return done("alerts");
  }

  // 7. Forecast for a place (or the portfolio's home region)
  if (RE.forecast.test(q) && !(e.portfolioScoped && ranked)) {
    calls.push({ tool: "forecast", args: { ...(place ? { place } : {}), days } });
    return done("forecast");
  }

  // 8. Ranked / filtered assets
  if (e.portfolioScoped && ranked) {
    const args: Record<string, unknown> = { hazard: e.hazard ?? "composite", limit: e.limit ?? 10, ...filters() };
    if (e.threshold) args.threshold = e.threshold;
    if (e.level) args.level = e.level;
    calls.push({ tool: "top_risk_assets", args });
    if (RE.summary.test(q) && /\b(summary|overview|and)\b/i.test(q)) calls.unshift({ tool: "portfolio_summary", args: filters() });
    return done("top_risk");
  }

  // 9. Portfolio summary
  if (e.portfolioScoped || RE.summary.test(q)) {
    calls.push({ tool: "portfolio_summary", args: { ...filters(), ...(e.hazard && e.hazard !== "composite" ? { hazard: e.hazard } : {}) } });
    return done("portfolio_summary");
  }

  // 10. Any place on Earth
  if (place) {
    calls.push({ tool: "assess_location", args: { place, ...(e.hazard ? { focus: e.hazard } : {}) } });
    return done("location");
  }
  if (e.term) {
    calls.push({ tool: "explain_metric", args: { term: e.term } });
    return done("explain");
  }
  if (ranked && RE.location.test(q)) {
    calls.push({ tool: "top_risk_assets", args: { hazard: e.hazard ?? "composite", limit: e.limit ?? 10 } });
    return done("top_risk");
  }
  return done("help");
}

export { norm as normalizeText };
