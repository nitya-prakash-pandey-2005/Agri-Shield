/**
 * WFP food prices (World Food Programme VAM, published on HDX, CC BY-IGO).
 *
 *  1. resolve the country's CSV via the CKAN API
 *       https://data.humdata.org/api/3/action/package_show?id=wfp-food-prices-for-<country>
 *  2. stream the CSV (5–50 MB) line by line — never held in memory whole — keeping only
 *     farm-relevant commodities from the last ~3.5 years
 *  3. cache the compact result 24 h in memory and on disk (os.tmpdir) so restarts and
 *     brief outages still serve the last good data
 *
 * Also: USD FX rates (open.er-api.com) for converting insurance sums.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cached, fetchJson, OFFLINE } from "./http";

export const HDX_SLUG: Record<string, string> = { BD: "bangladesh", VN: "viet-nam", PH: "philippines", IN: "india", ID: "indonesia", LK: "sri-lanka", MM: "myanmar", KH: "cambodia", NP: "nepal", PK: "pakistan" };

/** Commodity groups a smallholder in our deltas grows or trades. */
export const COMMODITY_GROUPS: { key: string; crops: string[]; match: RegExp; label: string }[] = [
  { key: "rice", crops: ["rice"], match: /^rice\b/i, label: "Rice" },
  { key: "wheat", crops: ["wheat"], match: /^wheat\b/i, label: "Wheat" },
  { key: "maize", crops: ["maize"], match: /^maize\b/i, label: "Maize" },
  { key: "onion", crops: ["onion"], match: /^onions?\b|^shallots?\b/i, label: "Onions" },
  { key: "potato", crops: ["potato"], match: /^potato(es)?\b/i, label: "Potatoes" },
  { key: "lentils", crops: [], match: /^lentils\b/i, label: "Lentils" },
  { key: "vegetables", crops: ["vegetables"], match: /^(eggplants?|tomatoes|cabbage|gourd|snake gourd|pumpkin|cucumber|chili \(green\)|spinach)/i, label: "Vegetables" },
  { key: "banana", crops: ["banana"], match: /^bananas?\b/i, label: "Bananas" },
  { key: "mango", crops: ["mango"], match: /^mangoes?\b/i, label: "Mangoes" },
  { key: "coconut", crops: ["coconut"], match: /^coconuts?\b/i, label: "Coconut" },
  { key: "sugar", crops: ["sugarcane"], match: /^sugar\b/i, label: "Sugar (retail)" },
];

export interface WfpMarket {
  id: string;
  name: string;
  admin1: string;
  admin2: string;
  lat: number;
  lon: number;
}

/** one monthly observation: [YYYY-MM, marketId, seriesIndex, price] */
export type WfpObs = [string, string, number, number];

export interface WfpSeriesDef {
  group: string;
  commodity: string;
  unit: string;
  pricetype: string;
  currency: string;
}

export interface WfpCountryData {
  country: string;
  slug: string;
  csvUrl: string;
  fetchedAt: string;
  lastDate: string | null; // YYYY-MM-DD
  firstDate: string | null;
  markets: Record<string, WfpMarket>;
  series: WfpSeriesDef[];
  obs: WfpObs[];
  rowsScanned: number;
  source: string;
}

const DAY = 86_400_000;
const TTL = 24 * 3600_000;

/** Minimal RFC-4180 line splitter (quoted fields with commas / doubled quotes). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** Stateful row filter — feed it lines, then call `result()`. Exposed for tests. */
export function createWfpAccumulator(country: string, slug: string, csvUrl: string, sinceIso: string) {
  let header: string[] | null = null;
  const col: Record<string, number> = {};
  const markets: Record<string, WfpMarket> = {};
  const series: WfpSeriesDef[] = [];
  const seriesIdx = new Map<string, number>();
  const obs: WfpObs[] = [];
  let rows = 0;
  let lastDate: string | null = null;
  let firstDate: string | null = null;
  return {
    line(raw: string) {
      const line = raw.replace(/\r$/, "");
      if (!line) return;
      if (!header) {
        header = splitCsvLine(line).map((h) => h.trim().toLowerCase());
        header.forEach((h, i) => (col[h] = i));
        return;
      }
      if (line.startsWith("#")) return; // HXL hashtag row
      rows++;
      // cheap date pre-filter before full parse
      const date = line.slice(0, 10);
      if (date < sinceIso || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      const f = splitCsvLine(line);
      const commodity = f[col.commodity!] ?? "";
      const group = COMMODITY_GROUPS.find((g) => g.match.test(commodity));
      if (!group) return;
      const latS = (f[col.latitude!] ?? "").trim();
      const lonS = (f[col.longitude!] ?? "").trim();
      if (!latS || !lonS) return; // national / regional averages have no coordinates
      const lat = Number(latS);
      const lon = Number(lonS);
      const marketId = f[col.market_id!] ?? f[col.market!] ?? "";
      const price = Number(f[col.price!]);
      if (!marketId || !Number.isFinite(lat) || !Number.isFinite(lon) || !(price > 0)) return; // skips national averages (no coordinates)
      if (!markets[marketId]) markets[marketId] = { id: marketId, name: f[col.market!] ?? marketId, admin1: f[col.admin1!] ?? "", admin2: f[col.admin2!] ?? "", lat, lon };
      const def: WfpSeriesDef = { group: group.key, commodity, unit: f[col.unit!] ?? "", pricetype: f[col.pricetype!] ?? "", currency: f[col.currency!] ?? "" };
      const k = `${def.commodity}|${def.unit}|${def.pricetype}|${def.currency}`;
      let si = seriesIdx.get(k);
      if (si == null) {
        si = series.length;
        series.push(def);
        seriesIdx.set(k, si);
      }
      obs.push([date.slice(0, 7), marketId, si, price]);
      if (!lastDate || date > lastDate) lastDate = date;
      if (!firstDate || date < firstDate) firstDate = date;
    },
    result(): WfpCountryData {
      return { country, slug, csvUrl, fetchedAt: new Date().toISOString(), lastDate, firstDate, markets, series, obs, rowsScanned: rows, source: "WFP VAM food prices via HDX (CC BY-IGO)" };
    },
  };
}

async function resolveCsvUrl(slug: string): Promise<string> {
  const r = await fetchJson<{ result: { resources: { name: string; format: string; url: string }[] } }>(`https://data.humdata.org/api/3/action/package_show?id=wfp-food-prices-for-${slug}`, 15000);
  const res = r.result.resources.find((x) => /csv/i.test(x.format) && /food prices/i.test(x.name) && !/markets/i.test(x.name)) ?? r.result.resources.find((x) => /csv/i.test(x.format) && /wfp_food_prices/i.test(x.url));
  if (!res) throw new Error(`no WFP CSV resource for ${slug}`);
  return res.url;
}

async function streamCsv(url: string, onLine: (l: string) => void, timeoutMs = 150_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Agri-SHIELD/1.0 (farm market prices)" }, cache: "no-store", redirect: "follow" });
    if (!res.ok || !res.body) throw new Error(`${res.status} fetching WFP CSV`);
    const reader = res.body.getReader();
    const dec = new TextDecoder("utf-8");
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        onLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        nl = buf.indexOf("\n");
      }
    }
    buf += dec.decode();
    if (buf) onLine(buf);
  } finally {
    clearTimeout(timer);
  }
}

const diskPath = (cc: string) => join(tmpdir(), "agri-shield", `wfp-${cc.toLowerCase()}.json`);

async function readDisk(cc: string): Promise<WfpCountryData | null> {
  try {
    return JSON.parse(await readFile(diskPath(cc), "utf-8")) as WfpCountryData;
  } catch {
    return null;
  }
}

async function writeDisk(cc: string, d: WfpCountryData) {
  try {
    await mkdir(join(tmpdir(), "agri-shield"), { recursive: true });
    await writeFile(diskPath(cc), JSON.stringify(d));
  } catch {
    /* best effort */
  }
}

async function loadCountry(cc: string): Promise<WfpCountryData> {
  const slug = HDX_SLUG[cc];
  if (!slug) throw new Error(`no WFP dataset mapped for ${cc}`);
  const disk = await readDisk(cc);
  if (disk && Date.now() - Date.parse(disk.fetchedAt) < TTL) return disk;
  if (OFFLINE) {
    if (disk) return disk;
    throw new Error("offline mode");
  }
  try {
    const url = await resolveCsvUrl(slug);
    const since = new Date(Date.now() - Math.round(3.6 * 365) * DAY).toISOString().slice(0, 10);
    const acc = createWfpAccumulator(cc, slug, url, since);
    await streamCsv(url, (l) => acc.line(l));
    const data = acc.result();
    if (!data.obs.length && disk) return disk;
    void writeDisk(cc, data);
    return data;
  } catch (e) {
    if (disk) return disk; // stale-while-error
    throw e;
  }
}

/** Parsed WFP data for a country (24 h cache, memory + disk). */
export function getWfpPrices(countryCode: string): Promise<WfpCountryData> {
  return cached(`wfp:${countryCode}`, TTL, () => loadCountry(countryCode));
}

/** Kick off a load without waiting (first visit to a big country file). */
const pending = new Map<string, Promise<WfpCountryData>>();
export function warmWfp(countryCode: string): Promise<WfpCountryData> {
  let p = pending.get(countryCode);
  if (!p) {
    p = getWfpPrices(countryCode)
      .then((d) => {
        loaded.set(countryCode, d);
        return d;
      })
      .finally(() => pending.delete(countryCode));
    pending.set(countryCode, p);
  }
  return p;
}

/** Non-blocking: the parsed data if it is already loaded, else start loading and return null. */
const loaded = new Map<string, WfpCountryData>();
export function peekWfp(countryCode: string): WfpCountryData | null {
  const hit = loaded.get(countryCode);
  if (hit && Date.now() - Date.parse(hit.fetchedAt) < TTL * 2) return hit;
  void warmWfp(countryCode).catch(() => {});
  return hit ?? null;
}

/** USD → local currency (open.er-api.com, free, daily). */
export function getUsdRate(currency: string): Promise<number | null> {
  return cached(`fx:usd`, 12 * 3600_000, () => fetchJson<{ rates: Record<string, number> }>("https://open.er-api.com/v6/latest/USD", 8000))
    .then((r) => r.rates[currency] ?? null)
    .catch(() => null);
}
