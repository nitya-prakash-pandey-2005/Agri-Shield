/**
 * Portfolio import / export — pure parsing & serialisation (unit-tested in
 * tests/portfolio-io.test.ts). No I/O: geocoding and persistence happen in
 * services/portfolio.ts.
 *
 *  parseImport(text)      → auto-detects CSV (comma / semicolon / tab, quoted
 *                           fields, BOM, decimal commas) or GeoJSON (Point,
 *                           Polygon/MultiPolygon → centroid + area), maps columns
 *                           by alias, validates every row, flags duplicates
 *  assetsToCsv / assetsToGeoJson → exports with the latest risk scores
 *  CSV_TEMPLATE           → downloadable template with example rows
 */
import type { AssetType, CropType } from "@agri-shield/types";

export const ASSET_TYPES: AssetType[] = ["farm", "field", "warehouse", "processing_plant", "port", "retail_outlet", "insured_plot", "loan", "community", "office"];
export const CROP_TYPES: CropType[] = ["rice", "wheat", "maize", "sugarcane", "jute", "coconut", "vegetables", "sorghum", "barley", "potato", "onion", "cotton", "tobacco", "banana", "mango"];

export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  farm: "Farm",
  field: "Field",
  warehouse: "Warehouse",
  processing_plant: "Processing plant",
  port: "Port",
  retail_outlet: "Retail outlet",
  insured_plot: "Insured unit",
  loan: "Agri loan",
  community: "Community",
  office: "Office",
};

export type ImportField = "lat" | "lon" | "coords" | "name" | "value" | "crop" | "type" | "ref" | "tags" | "address" | "area" | "country";

/** Normalised header → field. Headers are lower-cased and stripped of non-alphanumerics before lookup. */
const ALIASES: Record<ImportField, string[]> = {
  lat: ["lat", "latitude", "y", "latdd", "latdeg", "gpslat", "gpslatitude"],
  lon: ["lon", "lng", "long", "longitude", "x", "londd", "londeg", "gpslon", "gpslng", "gpslongitude"],
  coords: ["coords", "coordinates", "latlon", "latlng", "location_coords", "gps", "point"],
  name: ["name", "assetname", "asset", "site", "sitename", "title", "label", "plotname", "farmname", "facility"],
  value: ["value", "valueusd", "exposure", "exposureusd", "suminsured", "suminsuredusd", "amount", "amountusd", "outstanding", "outstandingusd", "loanamount", "loanoutstanding", "insuredvalue", "tiv"],
  crop: ["crop", "croptype", "commodity", "primarycrop"],
  type: ["type", "assettype", "category", "kind"],
  ref: ["ref", "reference", "externalref", "externalid", "id", "policy", "policyno", "policynumber", "loanid", "loanno", "accountno", "code", "sitecode"],
  tags: ["tags", "tag", "labels", "group", "groups", "segment"],
  address: ["address", "location", "place", "village", "town", "city", "fulladdress"],
  area: ["area", "areaha", "hectares", "ha", "size", "sizeha"],
  country: ["country", "countryname", "nation"],
};

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
const LOOKUP = new Map<string, ImportField>();
for (const [f, list] of Object.entries(ALIASES) as [ImportField, string[]][]) for (const a of list) LOOKUP.set(norm(a), f);

export function detectField(header: string): ImportField | null {
  return LOOKUP.get(norm(header)) ?? null;
}

export interface DraftAsset {
  name: string;
  type: AssetType;
  lat: number | null;
  lon: number | null;
  address: string | null;
  country: string | null;
  valueUsd: number;
  crop: CropType | null;
  externalRef: string | null;
  tags: string[];
  areaHa: number | null;
  meta: Record<string, string | number | boolean | null>;
}

export interface ParsedRow {
  /** 1-based data row number (header excluded) or feature index + 1 */
  row: number;
  asset: DraftAsset;
  errors: string[];
  warnings: string[];
  /** coordinates missing but an address is present → geocode on commit */
  needsGeocode: boolean;
}

export interface ParseResult {
  format: "csv" | "geojson";
  delimiter: string | null;
  headers: string[];
  mapping: Record<string, ImportField | null>;
  rows: ParsedRow[];
  validCount: number;
  errorCount: number;
  geocodeCount: number;
  fatal: string | null;
}

export const MAX_IMPORT_ROWS = 5000;

// ─── CSV ──────────────────────────────────────────────────────────────────

export function sniffDelimiter(firstLine: string): string {
  const counts = [",", ";", "\t", "|"].map((d) => {
    let n = 0;
    let q = false;
    for (const ch of firstLine) {
      if (ch === '"') q = !q;
      else if (!q && ch === d) n++;
    }
    return [d, n] as const;
  });
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![1] > 0 ? counts[0]![0] : ",";
}

/** RFC-4180 CSV → string[][] (handles quotes, escaped quotes, CRLF, newlines in quotes). */
export function parseCsv(text: string, delimiter?: string): { rows: string[][]; delimiter: string } {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const d = delimiter ?? sniffDelimiter(firstLine);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (q) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field.trim() === "") {
      field = "";
      q = true;
    } else if (ch === d) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return { rows: rows.filter((r) => r.some((c) => c.trim() !== "")), delimiter: d };
}

// ─── Value coercion ───────────────────────────────────────────────────────

/** "22,5" → 22.5 (decimal comma), "  89.1° " → 89.1, "22°30'N" → 22.5 */
export function parseCoord(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = raw.trim();
  if (!s) return null;
  const dms = s.match(/^(-?\d+(?:\.\d+)?)\s*[°º]\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*)?(?:(\d+(?:\.\d+)?)\s*["″]\s*)?([NSEW])?$/i);
  if (dms) {
    let v = Math.abs(Number(dms[1])) + Number(dms[2] ?? 0) / 60 + Number(dms[3] ?? 0) / 3600;
    if (dms[1]!.startsWith("-") || /[SW]/i.test(dms[4] ?? "")) v = -v;
    return v;
  }
  const hemi = s.match(/^(-?\d+(?:[.,]\d+)?)\s*([NSEW])$/i);
  if (hemi) {
    const v = Number(hemi[1]!.replace(",", "."));
    return /[SW]/i.test(hemi[2]!) ? -Math.abs(v) : v;
  }
  if (/^-?\d+,\d+$/.test(s)) s = s.replace(",", ".");
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/** "$1,200" → 1200, "1.2k" → 1200, "3.5M" → 3500000, "1 250,50" → 1250.5 */
export function parseMoney(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = raw.trim().replace(/^(usd|us\$|\$|€|£|৳|₫|₹|rp|php|₱)\s*/i, "").replace(/\s*(usd)$/i, "");
  if (!s) return null;
  const mult = /k$/i.test(s) ? 1e3 : /m$/i.test(s) ? 1e6 : /b$/i.test(s) ? 1e9 : 1;
  if (mult !== 1) s = s.slice(0, -1);
  s = s.replace(/\s/g, "");
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", "."); // 1.250.000,50
  else if (/^-?\d+,\d{1,2}$/.test(s)) s = s.replace(",", "."); // 1250,50
  else s = s.replace(/,/g, ""); // 1,250,000.50
  const v = Number(s);
  return Number.isFinite(v) ? v * mult : null;
}

export function parseAssetType(raw: string | null | undefined): AssetType | null {
  if (!raw) return null;
  const s = norm(raw);
  const direct = ASSET_TYPES.find((t) => norm(t) === s);
  if (direct) return direct;
  const map: Record<string, AssetType> = { plot: "insured_plot", policy: "insured_plot", insuredplot: "insured_plot", insurance: "insured_plot", credit: "loan", agriloan: "loan", mortgage: "loan", processor: "processing_plant", plant: "processing_plant", mill: "processing_plant", factory: "processing_plant", store: "retail_outlet", shop: "retail_outlet", retailer: "retail_outlet", retail: "retail_outlet", depot: "warehouse", silo: "warehouse", godown: "warehouse", village: "community", union: "community", ward: "community", household: "community", orchard: "farm", paddy: "field", parcel: "field", terminal: "port", jetty: "port", branch: "office", hq: "office" };
  return map[s] ?? null;
}

export function parseCrop(raw: string | null | undefined): CropType | null {
  if (!raw) return null;
  const s = norm(raw);
  const direct = CROP_TYPES.find((c) => c === s || `${c}s` === s);
  if (direct) return direct;
  const map: Record<string, CropType> = { paddy: "rice", aman: "rice", boro: "rice", aus: "rice", corn: "maize", cane: "sugarcane", veg: "vegetables", vegetable: "vegetables", tomato: "vegetables", potatoes: "potato", onions: "onion", bananas: "banana", mangoes: "mango", coconuts: "coconut" };
  return map[s] ?? null;
}

export function splitTags(raw: string | string[] | null | undefined): string[] {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : raw.split(/[;|,]/);
  return [...new Set(list.map((t) => String(t).trim().toLowerCase().replace(/\s+/g, "-")).filter((t) => t && t.length <= 40))].slice(0, 12);
}

// ─── Row validation (shared by CSV + GeoJSON) ─────────────────────────────

interface RawRecord {
  get(f: ImportField): string | null;
  extras: Record<string, string>;
  geometry?: { lat: number; lon: number; areaHa: number | null } | null;
}

function buildRow(rowNo: number, rec: RawRecord, defaults: { type: AssetType }): ParsedRow {
  const errors: string[] = [];
  const warnings: string[] = [];
  let lat = rec.geometry?.lat ?? parseCoord(rec.get("lat"));
  let lon = rec.geometry?.lon ?? parseCoord(rec.get("lon"));
  const coordsRaw = rec.get("coords");
  if ((lat == null || lon == null) && coordsRaw) {
    const m = coordsRaw.replace(/[()[\]]/g, "").split(/[\s,;]+/).filter(Boolean);
    if (m.length >= 2) {
      lat = parseCoord(m[0]!);
      lon = parseCoord(m[1]!);
    }
  }
  const latRaw = rec.get("lat");
  const lonRaw = rec.get("lon");
  if (latRaw && lat == null) errors.push(`Latitude "${latRaw}" is not a number`);
  if (lonRaw && lon == null) errors.push(`Longitude "${lonRaw}" is not a number`);
  if (lat != null && lon != null) {
    if (Math.abs(lat) > 90 && Math.abs(lon) <= 90 && Math.abs(lat) <= 180) {
      [lat, lon] = [lon, lat];
      warnings.push("Latitude/longitude looked swapped — corrected");
    }
    if (Math.abs(lat) > 90) errors.push(`Latitude ${lat} is outside −90…90`);
    if (Math.abs(lon) > 180) errors.push(`Longitude ${lon} is outside −180…180`);
    if (lat === 0 && lon === 0) errors.push("Coordinates are 0,0 (\"Null Island\") — probably a missing value");
    lat = Math.round(lat * 1e6) / 1e6;
    lon = Math.round(lon * 1e6) / 1e6;
  }
  const address = rec.get("address")?.trim() || null;
  const hasCoords = lat != null && lon != null;
  const needsGeocode = !hasCoords && !!address && !errors.length;
  if (!hasCoords && !address && !errors.length) errors.push("No coordinates and no address — add lat/lon or an address to geocode");

  const ref = rec.get("ref")?.trim() || null;
  let name = rec.get("name")?.trim() || "";
  if (!name) {
    name = ref ?? address?.split(",")[0]?.trim() ?? `Asset ${rowNo}`;
    warnings.push(`No name — using "${name}"`);
  }
  if (name.length > 120) {
    name = name.slice(0, 120);
    warnings.push("Name truncated to 120 characters");
  }

  const valueRaw = rec.get("value");
  let valueUsd = parseMoney(valueRaw);
  if (valueRaw && valueUsd == null) errors.push(`Value "${valueRaw}" is not a number`);
  else if (valueUsd != null && valueUsd < 0) errors.push("Value cannot be negative");
  if (valueUsd == null) {
    if (!valueRaw) warnings.push("No value — exposure set to 0 USD (value-at-risk will ignore it)");
    valueUsd = 0;
  }

  const typeRaw = rec.get("type");
  let type = parseAssetType(typeRaw);
  if (!type) {
    if (typeRaw) warnings.push(`Unknown type "${typeRaw}" — using ${ASSET_TYPE_LABEL[defaults.type].toLowerCase()}`);
    type = defaults.type;
  }
  const cropRaw = rec.get("crop");
  const crop = parseCrop(cropRaw);
  if (cropRaw && !crop) warnings.push(`Unknown crop "${cropRaw}" — left blank`);

  const areaRaw = rec.get("area");
  let areaHa = rec.geometry?.areaHa ?? parseCoord(areaRaw);
  if (areaRaw && areaHa == null) warnings.push(`Area "${areaRaw}" ignored (not a number)`);
  if (areaHa != null && (areaHa <= 0 || areaHa > 1e6)) {
    warnings.push(`Area ${areaHa} ha ignored (out of range)`);
    areaHa = null;
  }

  const meta: DraftAsset["meta"] = {};
  for (const [k, v] of Object.entries(rec.extras).slice(0, 20)) if (v !== "") meta[k.slice(0, 40)] = v.length > 200 ? v.slice(0, 200) : v;

  return {
    row: rowNo,
    asset: {
      name,
      type,
      lat: hasCoords ? lat : null,
      lon: hasCoords ? lon : null,
      address,
      country: rec.get("country")?.trim() || null,
      valueUsd: Math.round(valueUsd * 100) / 100,
      crop,
      externalRef: ref,
      tags: splitTags(rec.get("tags")),
      areaHa: areaHa == null ? null : Math.round(areaHa * 100) / 100,
      meta,
    },
    errors,
    warnings,
    needsGeocode,
  };
}

function flagDuplicates(rows: ParsedRow[]) {
  const byRef = new Map<string, number>();
  const byPos = new Map<string, number>();
  for (const r of rows) {
    if (r.errors.length) continue;
    const a = r.asset;
    if (a.externalRef) {
      const k = a.externalRef.toLowerCase();
      const prev = byRef.get(k);
      if (prev) r.errors.push(`Duplicate reference "${a.externalRef}" (same as row ${prev})`);
      else byRef.set(k, r.row);
    }
    if (a.lat != null && a.lon != null) {
      const k = `${a.name.toLowerCase()}|${a.lat.toFixed(4)}|${a.lon.toFixed(4)}`;
      const prev = byPos.get(k);
      if (prev && !r.errors.length) r.errors.push(`Duplicate of row ${prev} (same name and location)`);
      else if (!prev) byPos.set(k, r.row);
    }
  }
}

function finish(res: Omit<ParseResult, "validCount" | "errorCount" | "geocodeCount">): ParseResult {
  flagDuplicates(res.rows);
  return {
    ...res,
    validCount: res.rows.filter((r) => !r.errors.length).length,
    errorCount: res.rows.filter((r) => r.errors.length).length,
    geocodeCount: res.rows.filter((r) => !r.errors.length && r.needsGeocode).length,
  };
}

export function parseCsvImport(text: string, defaults: { type: AssetType }): ParseResult {
  const { rows, delimiter } = parseCsv(text);
  const empty = { format: "csv" as const, delimiter, headers: [], mapping: {}, rows: [] };
  if (!rows.length) return finish({ ...empty, fatal: "The file is empty." });
  const headers = rows[0]!.map((h) => h.trim());
  const mapping: Record<string, ImportField | null> = {};
  const used = new Set<ImportField>();
  for (const h of headers) {
    const f = detectField(h);
    mapping[h] = f && !used.has(f) ? f : null;
    if (f) used.add(f);
  }
  const hasLoc = (used.has("lat") && used.has("lon")) || used.has("coords") || used.has("address");
  if (!hasLoc) return finish({ ...empty, headers, mapping, fatal: `Could not find location columns. Expected lat + lon (or latitude/longitude, lng), a "coordinates" column, or an "address" column. Found: ${headers.join(", ")}` });
  const data = rows.slice(1);
  if (data.length > MAX_IMPORT_ROWS) return finish({ ...empty, headers, mapping, fatal: `Too many rows (${data.length}). Split the file into batches of ${MAX_IMPORT_ROWS}.` });
  const idx = new Map<ImportField, number>();
  headers.forEach((h, i) => mapping[h] && idx.set(mapping[h]!, i));
  const parsed = data.map((cells, i) => {
    const extras: Record<string, string> = {};
    headers.forEach((h, k) => {
      if (!mapping[h] && h) extras[h] = (cells[k] ?? "").trim();
    });
    return buildRow(i + 1, { get: (f) => (idx.has(f) ? (cells[idx.get(f)!] ?? "").trim() || null : null), extras }, defaults);
  });
  return finish({ format: "csv", delimiter, headers, mapping, rows: parsed, fatal: null });
}

// ─── GeoJSON ──────────────────────────────────────────────────────────────

type Pos = number[];
interface Geom {
  type: string;
  coordinates?: unknown;
  geometries?: Geom[];
}

/** Planar-on-sphere ring area (m²) — accurate enough for field/plot sizes. */
export function ringAreaM2(ring: Pos[]): number {
  if (ring.length < 3) return 0;
  const R = 6378137;
  let total = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lon1, lat1] = ring[i]!;
    const [lon2, lat2] = ring[(i + 1) % ring.length]!;
    total += (((lon2! - lon1!) * Math.PI) / 180) * (2 + Math.sin((lat1! * Math.PI) / 180) + Math.sin((lat2! * Math.PI) / 180));
  }
  return Math.abs((total * R * R) / 2);
}

export function geometryCentroid(g: Geom | null | undefined): { lat: number; lon: number; areaHa: number | null } | null {
  if (!g) return null;
  const avg = (pts: Pos[]) => {
    const v = pts.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (!v.length) return null;
    return { lon: v.reduce((s, p) => s + p[0]!, 0) / v.length, lat: v.reduce((s, p) => s + p[1]!, 0) / v.length };
  };
  switch (g.type) {
    case "Point": {
      const c = g.coordinates as Pos;
      return Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]) ? { lon: c[0]!, lat: c[1]!, areaHa: null } : null;
    }
    case "MultiPoint":
    case "LineString": {
      const c = avg(g.coordinates as Pos[]);
      return c ? { ...c, areaHa: null } : null;
    }
    case "Polygon": {
      const rings = g.coordinates as Pos[][];
      const outer = rings?.[0];
      if (!outer?.length) return null;
      const pts = outer.length > 1 && outer[0]![0] === outer[outer.length - 1]![0] && outer[0]![1] === outer[outer.length - 1]![1] ? outer.slice(0, -1) : outer;
      const c = avg(pts);
      const holes = rings.slice(1).reduce((s, r) => s + ringAreaM2(r), 0);
      return c ? { ...c, areaHa: Math.round(((ringAreaM2(outer) - holes) / 10_000) * 100) / 100 } : null;
    }
    case "MultiPolygon": {
      const polys = (g.coordinates as Pos[][][]) ?? [];
      const parts = polys.map((p) => geometryCentroid({ type: "Polygon", coordinates: p })).filter((x): x is NonNullable<typeof x> => !!x);
      if (!parts.length) return null;
      const w = parts.map((p) => p.areaHa ?? 0);
      const W = w.reduce((a, b) => a + b, 0) || parts.length;
      return {
        lat: parts.reduce((s, p, i) => s + p.lat * (w[i] || (W === parts.length ? 1 : 0)), 0) / W,
        lon: parts.reduce((s, p, i) => s + p.lon * (w[i] || (W === parts.length ? 1 : 0)), 0) / W,
        areaHa: Math.round(w.reduce((a, b) => a + b, 0) * 100) / 100,
      };
    }
    case "GeometryCollection":
      return geometryCentroid(g.geometries?.[0]);
    default:
      return null;
  }
}

export function parseGeoJsonImport(text: string, defaults: { type: AssetType }): ParseResult {
  const empty = { format: "geojson" as const, delimiter: null, headers: [], mapping: {}, rows: [] };
  let doc: { type?: string; features?: unknown[]; geometry?: Geom; properties?: Record<string, unknown>; coordinates?: unknown };
  try {
    doc = JSON.parse(text.replace(/^﻿/, ""));
  } catch (e) {
    return finish({ ...empty, fatal: `Invalid JSON: ${(e as Error).message}` });
  }
  const features: { geometry?: Geom | null; properties?: Record<string, unknown> | null }[] =
    doc?.type === "FeatureCollection" && Array.isArray(doc.features)
      ? (doc.features as { geometry?: Geom; properties?: Record<string, unknown> }[])
      : doc?.type === "Feature"
        ? [doc as { geometry?: Geom; properties?: Record<string, unknown> }]
        : doc?.type && doc.coordinates
          ? [{ geometry: doc as Geom, properties: {} }]
          : [];
  if (!features.length) return finish({ ...empty, fatal: "No GeoJSON features found (expected a FeatureCollection, Feature or geometry)." });
  if (features.length > MAX_IMPORT_ROWS) return finish({ ...empty, fatal: `Too many features (${features.length}). Split into batches of ${MAX_IMPORT_ROWS}.` });
  const headerSet = new Set<string>();
  for (const f of features.slice(0, 200)) for (const k of Object.keys(f?.properties ?? {})) headerSet.add(k);
  const headers = [...headerSet];
  const mapping: Record<string, ImportField | null> = {};
  const used = new Set<ImportField>();
  for (const h of headers) {
    const fld = detectField(h);
    mapping[h] = fld && !used.has(fld) ? fld : null;
    if (fld) used.add(fld);
  }
  const rows = features.map((f, i) => {
    const props = f?.properties ?? {};
    const str = (v: unknown) => (v == null ? null : Array.isArray(v) ? v.join(";") : String(v).trim() || null);
    const byField = new Map<ImportField, string | null>();
    const extras: Record<string, string> = {};
    for (const [k, v] of Object.entries(props)) {
      const fld = k in mapping ? mapping[k]! : detectField(k);
      if (fld && !byField.has(fld)) byField.set(fld, str(v));
      else if (!fld && v != null && typeof v !== "object") extras[k] = String(v);
    }
    const geometry = geometryCentroid(f?.geometry ?? null);
    const row = buildRow(i + 1, { get: (fld) => byField.get(fld) ?? null, extras, geometry }, defaults);
    if (f?.geometry && !geometry) row.errors.push(`Unsupported or empty geometry (${f.geometry.type ?? "unknown"})`);
    return row;
  });
  return finish({ format: "geojson", delimiter: null, headers, mapping, rows, fatal: null });
}

export function detectFormat(text: string): "csv" | "geojson" {
  const t = text.replace(/^﻿/, "").trimStart();
  return t.startsWith("{") || t.startsWith("[") ? "geojson" : "csv";
}

export function parseImport(text: string, opts: { format?: "csv" | "geojson" | "auto"; defaultType?: AssetType } = {}): ParseResult {
  const format = !opts.format || opts.format === "auto" ? detectFormat(text) : opts.format;
  const defaults = { type: opts.defaultType ?? "farm" };
  return format === "geojson" ? parseGeoJsonImport(text, defaults) : parseCsvImport(text, defaults);
}

// ─── Export ───────────────────────────────────────────────────────────────

export interface ExportAsset {
  id: string;
  name: string;
  type: string;
  externalRef: string | null;
  lat: number;
  lon: number;
  address: string | null;
  country: string;
  crop: string | null;
  areaHa: number | null;
  valueUsd: number;
  tags: string[];
  composite: number;
  level: string;
  floodRisk: number;
  salinityRisk: number;
  droughtRisk: number;
  heatRisk: number;
  valueAtRiskUsd: number;
  change7d: number | null;
  assessedAt: string | null;
  scoreSource: string;
}

export function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.join(";") : typeof v === "object" ? JSON.stringify(v) : String(v);
  // Neutralise spreadsheet formula injection (but keep negative numbers)
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const EXPORT_COLUMNS: (keyof ExportAsset)[] = ["id", "name", "type", "externalRef", "lat", "lon", "address", "country", "crop", "areaHa", "valueUsd", "tags", "composite", "level", "floodRisk", "salinityRisk", "droughtRisk", "heatRisk", "valueAtRiskUsd", "change7d", "assessedAt", "scoreSource"];

export function assetsToCsv(rows: ExportAsset[]): string {
  return [EXPORT_COLUMNS.join(","), ...rows.map((r) => EXPORT_COLUMNS.map((c) => csvCell(r[c])).join(","))].join("\n");
}

export function assetsToGeoJson(rows: ExportAsset[], meta: Record<string, unknown> = {}) {
  return {
    type: "FeatureCollection" as const,
    metadata: { generator: "Agri-SHIELD", generatedAt: new Date().toISOString(), count: rows.length, ...meta },
    features: rows.map(({ lat, lon, ...props }) => ({ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [lon, lat] }, properties: props })),
  };
}

export const CSV_TEMPLATE = [
  "name,lat,lon,value_usd,type,crop,ref,tags,address,area_ha",
  "North paddy block,22.7010,90.3535,12500,insured_plot,rice,POL-2026-0001,parametric;coastal,,2.4",
  "Riverside warehouse,10.2433,105.9722,850000,warehouse,rice,WH-CT-01,logistics,,",
  "Farm by address only,,,4200,farm,maize,F-0003,smallholder,\"Kalapara, Patuakhali, Bangladesh\",1.1",
].join("\n");
