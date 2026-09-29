/**
 * Supply-chain reference coefficients (agronomic + market + logistics).
 *
 * These are published/literature-calibrated constants, not demo data:
 *  - yields: FAOSTAT 2019-2023 averages for South & Southeast Asian deltas
 *  - price flexibility: short-run inverse demand elasticities reported for
 *    Asian staple markets (IFPRI / FAO AMIS), thin-market crops are higher
 *  - freight & speed: typical regional road / inland-waterway / short-sea
 *    shipping costs (World Bank Logistics Performance, ADB transport notes)
 */
import type { CropType, SupplyChainNodeType } from "@agri-shield/types";

/** Average harvested yield, tonnes per hectare (FAOSTAT, regional mean). */
export const CROP_YIELD_T_HA: Record<string, number> = {
  rice: 4.5, // paddy
  wheat: 3.3,
  jute: 2.5, // fibre
  sugarcane: 70,
  coconut: 10, // ≈10,000 nuts/ha × ~1 kg
  vegetables: 18,
  onion: 17,
  maize: 5.5,
  mango: 8,
};

/** Share of monitored farmland typically planted to the crop when no field sample exists. */
export const DEFAULT_CROP_SHARE: Record<string, number> = {
  rice: 0.55,
  wheat: 0.18,
  jute: 0.1,
  sugarcane: 0.06,
  coconut: 0.05,
  vegetables: 0.05,
  onion: 0.03,
  maize: 0.1,
};

/** Weeks of a harvest window the network sources over (used to compare weekly volume vs standing crop). */
export const SOURCING_WINDOW_WEEKS = 16;

/** % price move per 1 % supply shortfall (short run, 0-6 weeks). */
export const PRICE_FLEXIBILITY: Record<string, number> = {
  rice: 1.6,
  wheat: 0.9,
  jute: 1.3,
  sugarcane: 0.6,
  coconut: 0.8,
  vegetables: 2.2,
  onion: 2.8,
  maize: 1.0,
};

/** Share of the relevant traded market that the monitored deltas supply. */
export const MARKET_SHARE_OF_DELTAS: Record<string, number> = {
  rice: 0.55,
  wheat: 0.12,
  jute: 0.8,
  sugarcane: 0.3,
  coconut: 0.35,
  vegetables: 0.6,
  onion: 0.4,
  maize: 0.2,
};

export const COMMODITY_LABEL: Record<string, string> = {
  rice: "Rice (paddy)",
  wheat: "Wheat",
  jute: "Raw jute",
  sugarcane: "Sugarcane",
  coconut: "Coconut",
  vegetables: "Vegetables",
  onion: "Onion",
  maize: "Maize",
};

export const asCrop = (commodity: string): CropType => commodity as CropType;

export type TransportMode = "road" | "river_barge" | "short_sea";

export const MODE_SPEC: Record<TransportMode, { label: string; kmPerDay: number; handlingDays: number; usdPerTkm: number; fixedUsdPerT: number }> = {
  road: { label: "Road (truck)", kmPerDay: 380, handlingDays: 1, usdPerTkm: 0.065, fixedUsdPerT: 4 },
  river_barge: { label: "Inland waterway", kmPerDay: 170, handlingDays: 1.5, usdPerTkm: 0.028, fixedUsdPerT: 6 },
  short_sea: { label: "Short-sea shipping", kmPerDay: 600, handlingDays: 4, usdPerTkm: 0.012, fixedUsdPerT: 14 },
};

/** Countries whose deltas are served by navigable inland waterways (BD, VN). */
const WATERWAY_COUNTRIES = new Set(["Bangladesh", "Vietnam"]);

export function pickMode(countryA: string, countryB: string, km: number): TransportMode {
  if (countryA !== countryB) return "short_sea";
  if (WATERWAY_COUNTRIES.has(countryA) && km > 60) return "river_barge";
  return "road";
}

/** Road/sea distances are longer than great-circle; standard detour factors. */
export const DETOUR: Record<TransportMode, number> = { road: 1.35, river_barge: 1.25, short_sea: 1.15 };

/** Storage / holding cost per tonne per week (warehousing + capital cost). */
export const HOLDING_USD_PER_T_WEEK = 2.4;
/** Demurrage + spoilage + expediting cost per tonne delayed, per week. */
export const DELAY_USD_PER_T_WEEK = 18;
/** Forward-contract hedge premium as a share of notional. */
export const FORWARD_PREMIUM_PCT = 0.028;
/** Parametric insurance loading over expected loss. */
export const PARAMETRIC_LOADING = 1.35;

export const NODE_TYPE_LABEL: Record<SupplyChainNodeType, string> = {
  warehouse: "Warehouse",
  port: "Port",
  processor: "Processor",
  retailer: "Wholesale / retail",
};

/**
 * Downstream buyer segments served by terminal nodes (ports / wholesale).
 * Used to extend impact cascades beyond the modelled node graph.
 */
export const DOWNSTREAM_BUYERS: Record<string, { name: string; segment: string; share: number; commodities?: string[] }[]> = {
  "node-01": [
    { name: "Bangladesh public food distribution (OMS / PFDS)", segment: "Public procurement", share: 0.45 },
    { name: "Khatunganj wholesale traders", segment: "Wholesale", share: 0.35 },
    { name: "Regional export buyers (India, Nepal)", segment: "Export", share: 0.2 },
  ],
  "node-02": [
    { name: "Jute yarn & sacking exporters", segment: "Export", share: 0.6, commodities: ["jute"] },
    { name: "Khulna division wholesale", segment: "Wholesale", share: 0.4 },
  ],
  "node-08": [
    { name: "West Africa rice importers", segment: "Export", share: 0.4 },
    { name: "China & Malaysia private importers", segment: "Export", share: 0.35 },
    { name: "Coconut product processors (desiccated / oil)", segment: "Industrial", share: 0.25, commodities: ["coconut"] },
  ],
  "node-11": [
    { name: "NFA buffer stock — Metro Manila", segment: "Public procurement", share: 0.4 },
    { name: "Divisoria & Balintawak wholesale", segment: "Wholesale", share: 0.35 },
    { name: "Sugar Regulatory Administration offtakers", segment: "Industrial", share: 0.25, commodities: ["sugarcane"] },
  ],
  "node-14": [
    { name: "Odisha Civil Supplies (PDS)", segment: "Public procurement", share: 0.5 },
    { name: "Kolkata jute mills", segment: "Industrial", share: 0.2, commodities: ["jute"] },
    { name: "Coastal Andhra & Tamil Nadu millers", segment: "Wholesale", share: 0.3 },
  ],
  "node-17": [
    { name: "Bulog Central Java reserve", segment: "Public procurement", share: 0.5 },
    { name: "Semarang distributors", segment: "Wholesale", share: 0.3 },
    { name: "Java sugar mills (PTPN)", segment: "Industrial", share: 0.2, commodities: ["sugarcane"] },
  ],
  "node-20": [
    { name: "Greater Jakarta modern retail chains", segment: "Retail", share: 0.55 },
    { name: "Traditional pasar vendors", segment: "Retail", share: 0.45 },
  ],
};

export const WEBHOOK_EVENTS = [
  { id: "commodity.risk.threshold", label: "Commodity risk crosses threshold" },
  { id: "node.flood.warning", label: "Node flood warning (composite ≥ threshold)" },
  { id: "scenario.critical", label: "Scenario P90 loss is critical" },
  { id: "supplier.alternative.available", label: "Alternative supplier recommendation" },
] as const;

export const API_SCOPES = ["risk:read", "commodities:read", "network:read", "scenarios:run", "webhooks:manage"] as const;
