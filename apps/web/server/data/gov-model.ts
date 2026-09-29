/**
 * Government decision model — turns the registry (store) + live risk overlay
 * into operational quantities: exposed hectares, expected crop loss, farms at
 * risk, resource needs, sensor coverage, fleet. Everything here is derived
 * deterministically from district records so numbers move when live risk
 * (Open-Meteo / GloFAS / marine) or the active scenario moves.
 *
 * Reference constants (yields, unit costs, planning ratios) are cited inline;
 * they are planning assumptions, not observations.
 */
import type { CropType, ResourceType, UserRole } from "@agri-shield/types";
import { cropDamageProbability, floodCropLoss } from "../risk/scoring";
import { COUNTRIES } from "./geography";
import { mulberry32, round } from "./prng";
import { getStore, type DistrictRecord, type ResourceInventoryRecord } from "./store";

// ─── Scope ────────────────────────────────────────────────────────────────

export interface ScopeUser {
  id: string;
  name: string;
  role: UserRole;
  orgId: string | null;
}

export interface Scope {
  orgId: string;
  countryCode: string;
  countryName: string;
  orgName: string;
  districts: DistrictRecord[];
  districtIds: Set<string>;
}

/** Resolve the org a user operates in. Platform admins pick a country (default BD). */
export function resolveScope(user: ScopeUser, country?: string | null): Scope {
  const store = getStore();
  let orgId = user.orgId ?? "org-gov-bd";
  if (user.role === "platform_admin") orgId = `org-gov-${(country ?? "BD").toLowerCase()}`;
  let districts = store.districts.filter((d) => d.orgId === orgId);
  if (!districts.length) {
    orgId = "org-gov-bd";
    districts = store.districts.filter((d) => d.orgId === orgId);
  }
  const cc = districts[0]!.country;
  const c = COUNTRIES.find((x) => x.code === cc)!;
  const org = store.orgs.find((o) => o.id === orgId);
  return { orgId, countryCode: cc, countryName: c.name, orgName: org?.name ?? c.ministry, districts, districtIds: new Set(districts.map((d) => d.id)) };
}

// ─── Geometry ─────────────────────────────────────────────────────────────

/** Spherical-excess-free approximation: shoelace on equirectangular km. */
export function polygonAreaKm2(ring: number[][]): number {
  if (ring.length < 3) return 0;
  const lat0 = ring.reduce((s, p) => s + p[1]!, 0) / ring.length;
  const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110.57;
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[i + 1]!;
    a += x1! * kx * (y2! * ky) - x2! * kx * (y1! * ky);
  }
  return Math.abs(a / 2);
}

export function districtAreaKm2(d: DistrictRecord): number {
  return Math.round(polygonAreaKm2(d.geometry.coordinates[0]!));
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Ray-casting point-in-polygon on [lon, lat] rings. */
export function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi! > lat !== yj! > lat && lon < ((xj! - xi!) * (lat - yi!)) / (yj! - yi!) + xi!) inside = !inside;
  }
  return inside;
}

/** Districts intersecting a drawn polygon (vertex-in-polygon either way + centroid). */
export function districtsInPolygon(districts: DistrictRecord[], ring: number[][]): string[] {
  return districts
    .filter((d) => {
      const dr = d.geometry.coordinates[0]!;
      if (pointInRing(d.lon, d.lat, ring)) return true;
      if (dr.some(([x, y]) => pointInRing(x!, y!, ring))) return true;
      return ring.some(([x, y]) => pointInRing(x!, y!, dr));
    })
    .map((d) => d.id);
}

// ─── Crop economics ───────────────────────────────────────────────────────

/** Typical yields, t/ha (FAOSTAT 2022 national averages for the five deltas, rounded). */
export const YIELD_T_HA: Partial<Record<CropType, number>> = {
  rice: 4.6, jute: 2.4, vegetables: 16, sugarcane: 68, coconut: 5.5, maize: 5.2, onion: 17, mango: 8, wheat: 3.4,
};

export function valuePerHa(crop: string): number {
  const store = getStore();
  const price = store.commodities.find((c) => c.commodity === crop)?.basePriceUsd ?? 450;
  return (YIELD_T_HA[crop as CropType] ?? 4) * price;
}

function sensitivity(crop: string) {
  const c = getStore().commodities.find((x) => x.commodity === crop);
  return { flood: c?.floodSensitivity ?? 0.6, salinity: c?.salinitySensitivity ?? 0.5 };
}

/** Crop mix: registered field areas where available, otherwise district primary crops. */
export function cropMix(d: DistrictRecord): { crop: string; share: number }[] {
  const store = getStore();
  const farmerIds = new Set(store.farmers.filter((f) => f.districtId === d.id).map((f) => f.id));
  const areas = new Map<string, number>();
  for (const f of store.fields) if (farmerIds.has(f.farmerId)) areas.set(f.cropType, (areas.get(f.cropType) ?? 0) + f.areaHa);
  const prior = new Map<string, number>(d.primaryCrops.map((c, i) => [c, i === 0 ? 0.65 : 0.35 / Math.max(1, d.primaryCrops.length - 1)]));
  const total = [...areas.values()].reduce((s, v) => s + v, 0);
  const keys = new Set([...prior.keys(), ...areas.keys()]);
  const mix = [...keys].map((crop) => ({ crop, share: 0.5 * (prior.get(crop) ?? 0) + 0.5 * (total ? (areas.get(crop) ?? 0) / total : prior.get(crop) ?? 0) }));
  const s = mix.reduce((a, m) => a + m.share, 0) || 1;
  return mix.map((m) => ({ ...m, share: m.share / s })).sort((a, b) => b.share - a.share);
}

export interface DistrictEconomics {
  exposedHa: number;
  atRiskHa: number;
  depthM: number;
  expectedLossUsd: number;
  floodLossUsd: number;
  salinityLossUsd: number;
  farmsAtRisk: number;
  farmsInVulnerableZone: number;
  avgFarmHa: number;
  peopleAtRisk: number;
  cropValueUsd: number;
}

/** Share of monitored area currently under an in-season crop. */
const IN_SEASON = 0.72;

export function districtEconomics(d: DistrictRecord): DistrictEconomics {
  const p = d.floodProb72h;
  const vulnShare = Math.min(1, d.vulnerableAreaHa / Math.max(1, d.monitoredAreaHa));
  const exposedHa = d.monitoredAreaHa * vulnShare * IN_SEASON;
  const depthM = Math.max(0.15, (p - 0.35) * 1.6 + d.rainfall72hMm / 1000);
  let flood = 0;
  let sal = 0;
  let value = 0;
  for (const { crop, share } of cropMix(d)) {
    const v = exposedHa * share * valuePerHa(crop);
    const sens = sensitivity(crop);
    const fl = p * floodCropLoss(depthM, 5, sens.flood);
    const sl = (1 - fl) * cropDamageProbability(crop as CropType, d.ecCurrent) * sens.salinity * 0.6;
    value += v;
    flood += v * fl;
    sal += v * sl;
  }
  const avgFarmHa = d.monitoredAreaHa / Math.max(1, d.totalFarms);
  const salShare = Math.min(1, d.salinityRisk / 100);
  const atRiskHa = exposedHa * Math.max(p, salShare * 0.8);
  return {
    exposedHa: Math.round(exposedHa),
    atRiskHa: Math.round(atRiskHa),
    depthM: round(depthM, 2),
    expectedLossUsd: Math.round(flood + sal),
    floodLossUsd: Math.round(flood),
    salinityLossUsd: Math.round(sal),
    farmsAtRisk: Math.round(atRiskHa / avgFarmHa),
    farmsInVulnerableZone: Math.round(d.totalFarms * vulnShare),
    avgFarmHa: round(avgFarmHa, 2),
    peopleAtRisk: Math.round(d.population * vulnShare * p * 0.35),
    cropValueUsd: Math.round(value),
  };
}

// ─── Resource needs ───────────────────────────────────────────────────────

export const RESOURCE_TYPES: ResourceType[] = ["pumps", "sandbags", "evacuation_buses", "medical", "food_aid"];

/**
 * Planning ratios (Sphere Handbook 2018 + BD Standing Orders on Disaster 2019, simplified):
 *  pumps       — one 6" dewatering pump per 900 ha of severely inundated cropland
 *  sandbags    — ~500 bags per km of breach-prone embankment; breach-prone km ≈ severe ha / 3,000
 *  buses       — 50 seats × 3 trips per evacuation window; 0.4% of population in severe cells evacuates
 *  medical     — one family kit per 25 evacuees
 *  food aid    — one weekly household package per displaced household (4.5 persons)
 */
export function districtNeeds(d: DistrictRecord): Record<ResourceType, number> {
  const e = districtEconomics(d);
  const severe = Math.min(1, Math.max(0, (d.floodProb72h - 0.4) / 0.5));
  const severeHa = e.atRiskHa * severe;
  const evacuees = d.population * 0.004 * severe;
  return {
    pumps: Math.ceil(severeHa / 900),
    sandbags: Math.ceil(((severeHa / 3000) * 500) / 10) * 10,
    evacuation_buses: Math.ceil(evacuees / 150),
    medical: Math.ceil(evacuees / 25),
    food_aid: Math.ceil(evacuees / 4.5),
  };
}

export function depotFor(inv: ResourceInventoryRecord, d: DistrictRecord) {
  return inv.depots.find((x) => x.name.startsWith(d.name));
}

/** Units already dispatched/delivered into a district (requests ledger). */
export function deployedTo(districtId: string, type: ResourceType): number {
  return getStore()
    .resourceRequests.filter((r) => r.targetDistrictId === districtId && r.resourceType === type && (r.status === "dispatched" || r.status === "delivered"))
    .reduce((s, r) => s + r.quantity, 0);
}

export function districtResourceBalance(orgId: string, d: DistrictRecord) {
  const store = getStore();
  const needs = districtNeeds(d);
  return RESOURCE_TYPES.map((type) => {
    const inv = store.inventory.find((i) => i.orgId === orgId && i.type === type);
    const depot = inv ? depotFor(inv, d) : undefined;
    const atDepot = depot?.quantity ?? 0;
    const deployed = deployedTo(d.id, type);
    const available = atDepot + deployed;
    const need = needs[type];
    return {
      type,
      label: inv?.label ?? type,
      unit: inv?.unit ?? "units",
      needed: need,
      atDepot,
      deployed,
      available,
      coveragePct: need ? Math.min(100, Math.round((available / need) * 100)) : 100,
      gap: Math.max(0, need - available),
    };
  });
}

// ─── Sensors (infrastructure gap) ─────────────────────────────────────────

const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

/** Unit capex, USD — vendor list prices 2025 for telemetry-grade kit (approx.). */
export const SENSOR_TYPES = [
  { key: "rain", label: "Rain gauges (tipping-bucket, GSM)", unitCost: 3200 },
  { key: "river", label: "River level radar gauges", unitCost: 16500 },
  { key: "salinity", label: "Salinity / EC probes (CTD)", unitCost: 5800 },
  { key: "soil", label: "Soil-moisture IoT nodes", unitCost: 420 },
] as const;
export type SensorKey = (typeof SENSOR_TYPES)[number]["key"];

/**
 * Required densities: WMO-168 guidance for flood-forecast rain gauges in flat
 * deltas (~1 per 100 km²); river gauges scale with riverine exposure; EC probes
 * with tidal-salinity exposure; soil nodes 1 per 4,000 ha monitored cropland.
 * Installed counts are the registry's deterministic inventory per district.
 */
export function sensorInventory(d: DistrictRecord) {
  const rng = mulberry32(hash(d.id));
  const area = districtAreaKm2(d);
  const countryBias = { BD: 0.12, VN: 0.08, IN: 0.02, PH: -0.04, ID: -0.08 }[d.country] ?? 0;
  const required: Record<SensorKey, number> = {
    rain: Math.max(4, Math.ceil(area / 100)),
    river: Math.ceil(2 + d.floodExposure * 8),
    salinity: Math.ceil(d.salinityExposure * 14),
    soil: Math.ceil(d.monitoredAreaHa / 4000),
  };
  const rows = SENSOR_TYPES.map((t) => {
    const cov = Math.min(1, Math.max(0.08, 0.2 + rng() * 0.7 + countryBias));
    const installed = Math.round(required[t.key] * cov);
    const online = Math.round(installed * (0.78 + rng() * 0.2));
    const missing = Math.max(0, required[t.key] - installed);
    return { key: t.key, label: t.label, required: required[t.key], installed, online, missing, coveragePct: required[t.key] ? Math.round((installed / required[t.key]) * 100) : 100, gapCostUsd: missing * t.unitCost };
  });
  const req = rows.reduce((s, r) => s + r.required, 0);
  const inst = rows.reduce((s, r) => s + r.installed, 0);
  return { areaKm2: area, rows, coveragePct: req ? Math.round((inst / req) * 100) : 100, gapCostUsd: rows.reduce((s, r) => s + r.gapCostUsd, 0) };
}

// ─── Fleet ────────────────────────────────────────────────────────────────

const PLATE: Record<string, string> = { BD: "DHK-METRO-TA", VN: "65C", PH: "NCR", IN: "OD-05", ID: "H" };

/** Deterministic logistics fleet per org: 3 vehicles per depot district. */
export function fleetFor(orgId: string) {
  const store = getStore();
  const districts = store.districts.filter((d) => d.orgId === orgId);
  const kinds = [
    { kind: "truck", label: "10-t Truck", capacity: "10 t / 400 bags", speedKmh: 35 },
    { kind: "boat", label: "Rescue Speedboat", capacity: "12 pax / 1.2 t", speedKmh: 25 },
    { kind: "pickup", label: "4×4 Pickup", capacity: "1.5 t", speedKmh: 45 },
  ];
  const busy = new Map<string, string>();
  for (const r of store.resourceRequests) if (r.orgId === orgId && r.status === "dispatched" && r.vehicle) busy.set(r.vehicle, r.id);
  return districts.flatMap((d) => {
    const rng = mulberry32(hash(`fleet-${d.id}`));
    return kinds.map((k, i) => {
      const plate = `${PLATE[d.country] ?? "GOV"} ${Math.floor(1000 + rng() * 8999)}`;
      const id = `${d.id}-${k.kind}-${i}`;
      const label = `${k.label} · ${plate}`;
      return { id, label, kind: k.kind, capacity: k.capacity, speedKmh: k.speedKmh, homeDistrictId: d.id, homeDistrict: d.name, busyWith: busy.get(label) ?? null };
    });
  });
}

// ─── Seasons ──────────────────────────────────────────────────────────────

/** Agronomic seasons used in South/Southeast Asian reporting. */
export function seasonOf(date: Date): { key: string; label: string; order: number } {
  const m = date.getMonth();
  const y = date.getFullYear();
  if (m >= 5 && m <= 9) return { key: `${y}-kharif`, label: `Monsoon ${y}`, order: y * 10 + 2 };
  if (m >= 10) return { key: `${y + 1}-dry`, label: `Dry ${y}/${String(y + 1).slice(2)}`, order: (y + 1) * 10 + 0 };
  if (m <= 1) return { key: `${y}-dry`, label: `Dry ${y - 1}/${String(y).slice(2)}`, order: y * 10 + 0 };
  return { key: `${y}-premonsoon`, label: `Pre-monsoon ${y}`, order: y * 10 + 1 };
}

export const SEVERITY_RANK = { watch: 1, warning: 2, emergency: 3 } as const;
