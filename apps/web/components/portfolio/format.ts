/** Formatting + colour helpers shared by the portfolio, asset and alerts screens. */

export const LEVEL_COLOR: Record<string, string> = { low: "#4ade80", medium: "#fbbf24", high: "#f87171", critical: "#a78bfa" };
export const LEVELS = ["low", "medium", "high", "critical"] as const;
export type Level = (typeof LEVELS)[number];

export const HAZARD_META = {
  flood: { label: "Flood", color: "#3494d4", explain: "Chance that the site is inundated in the next 72 hours from forecast rain, saturated soil, swollen rivers and low terrain." },
  salinity: { label: "Salinity", color: "#d9689e", explain: "Saltwater intrusion into soil and irrigation water. Rice starts losing yield above ~3 dS/m; most crops fail above 8." },
  drought: { label: "Drought", color: "#b58f1c", explain: "Whether crops will lose more water to evaporation than rain will replace over the next week (FAO-56 water balance)." },
  heat: { label: "Heat", color: "#8a7ff0", explain: "Crop heat stress from the forecast maximum temperature: 0 at 32 °C, 100 at 42 °C and above." },
} as const;
export type HazardKey = keyof typeof HAZARD_META;

export const TYPE_LABEL: Record<string, string> = {
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

export function fmtUsd(v: number | null | undefined, compact = true): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (!compact) return `$${Math.round(v).toLocaleString("en-US")}`;
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e4) return `$${Math.round(v / 1e3)}k`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}k`;
  return `$${Math.round(v)}`;
}

export function fmtNum(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function timeAgo(d: Date | string | null | undefined): string {
  if (!d) return "never";
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 0) return "just now";
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 30 * 86400) return `${Math.round(s / 86400)} d ago`;
  return new Date(d).toISOString().slice(0, 10);
}

export function levelOf(score: number): Level {
  return score >= 80 ? "critical" : score >= 60 ? "high" : score >= 35 ? "medium" : "low";
}

export function downloadText(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** ESRI World Imagery static snapshot around a point (~`km` wide). */
export function esriSnapshotUrl(lat: number, lon: number, km = 1.2, w = 480, h = 300): string {
  const dLat = km / 111 / 2;
  const dLon = km / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180))) / 2;
  const ratio = w / h;
  const bbox = [lon - dLon * ratio, lat - dLat, lon + dLon * ratio, lat + dLat].map((v) => v.toFixed(6)).join(",");
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${bbox}&bboxSR=4326&imageSR=3857&size=${w},${h}&format=jpg&f=image`;
}

/** NASA GIBS Harmonized Landsat-Sentinel (HLS, 30 m) WMS snapshot for a recent date. */
export function hlsSnapshotUrl(lat: number, lon: number, date: string, km = 6, w = 480, h = 300): string {
  const dLat = km / 111 / 2;
  const dLon = (dLat * w) / h / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const bbox = [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map((v) => v.toFixed(5)).join(",");
  return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=HLS_S30_Nadir_BRDF_Adjusted_Reflectance&STYLES=&FORMAT=image/jpeg&CRS=EPSG:4326&BBOX=${bbox}&WIDTH=${w}&HEIGHT=${h}&TIME=${date}`;
}

/** NASA GIBS MODIS Terra true colour (daily, 250 m) WMS snapshot — clouds, smoke and floodwater. */
export function modisSnapshotUrl(lat: number, lon: number, date: string, km = 60, w = 480, h = 300): string {
  const dLat = km / 111 / 2;
  const dLon = (dLat * w) / h / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const bbox = [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map((v) => v.toFixed(5)).join(",");
  return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=MODIS_Terra_CorrectedReflectance_TrueColor&STYLES=&FORMAT=image/jpeg&CRS=EPSG:4326&BBOX=${bbox}&WIDTH=${w}&HEIGHT=${h}&TIME=${date}`;
}
