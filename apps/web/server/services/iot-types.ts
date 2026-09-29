/**
 * Sensors & IoT — shared, dependency-free type catalogue.
 *
 * Imported by the server (registry, simulator, ingest, analytics) AND by the
 * client UI (labels, units, colours), so keep this file pure: no Node APIs,
 * no store imports.
 */

export type DeviceType = "river_gauge" | "soil_probe" | "tide_gauge" | "rain_gauge" | "weather_station" | "piezometer";

/** Canonical metric keys — every ingested reading is normalised to these SI-ish units. */
export type MetricKey =
  | "water_level_m"
  | "tide_level_m"
  | "soil_ec"
  | "soil_moisture"
  | "soil_temp_c"
  | "rain_mm"
  | "air_temp_c"
  | "humidity_pct"
  | "wind_ms"
  | "pressure_hpa"
  | "groundwater_depth_m"
  | "battery_pct"
  | "rssi_dbm"
  | "snr_db";

export interface MetricMeta {
  label: string;
  short: string;
  unit: string;
  decimals: number;
  color: string;
  /** Plain-language explanation for help popovers */
  help: string;
  /** Physically plausible range — values outside are rejected at ingest */
  min: number;
  max: number;
  /** Largest believable change per hour — faster jumps are flagged as sensor spikes */
  maxRatePerHour: number;
  /** Aggregation for long ranges: rain is summed, everything else averaged */
  agg: "mean" | "sum";
}

export const METRIC_META: Record<MetricKey, MetricMeta> = {
  water_level_m: { label: "Water level", short: "Level", unit: "m", decimals: 2, color: "#38bdf8", help: "Height of the river or canal surface above the gauge's zero point (gauge datum), in metres. Rising quickly after rain is the classic early sign of a flood.", min: -5, max: 40, maxRatePerHour: 1.5, agg: "mean" },
  tide_level_m: { label: "Tide level", short: "Tide", unit: "m", decimals: 2, color: "#22d3ee", help: "Sea / estuary surface height relative to mean sea level. Two highs and two lows a day (semi-diurnal tide); the range grows at spring tides (new/full moon) and shrinks at neap tides.", min: -6, max: 8, maxRatePerHour: 2.5, agg: "mean" },
  soil_ec: { label: "Soil salinity (EC)", short: "EC", unit: "dS/m", decimals: 2, color: "#f59e0b", help: "Electrical conductivity of the soil water in deci-Siemens per metre — a direct measure of salt. Rice loses yield above ~3 dS/m; most crops fail above 8.", min: 0, max: 60, maxRatePerHour: 3, agg: "mean" },
  soil_moisture: { label: "Soil moisture", short: "Moisture", unit: "% VWC", decimals: 1, color: "#34d399", help: "Volumetric water content: the share of the soil volume that is water. ~10 % is dry (wilting), 25-35 % is comfortable for most crops, 45 %+ is saturated / waterlogged.", min: 0, max: 70, maxRatePerHour: 25, agg: "mean" },
  soil_temp_c: { label: "Soil temperature", short: "Soil °C", unit: "°C", decimals: 1, color: "#fb923c", help: "Temperature at the probe depth (≈10-20 cm).", min: -20, max: 70, maxRatePerHour: 6, agg: "mean" },
  rain_mm: { label: "Rainfall", short: "Rain", unit: "mm", decimals: 1, color: "#60a5fa", help: "Rain measured by the tipping bucket in each reporting interval. 10 mm/h is heavy rain; 50 mm in a day is very heavy.", min: 0, max: 300, maxRatePerHour: 300, agg: "sum" },
  air_temp_c: { label: "Air temperature", short: "Air °C", unit: "°C", decimals: 1, color: "#f87171", help: "Air temperature at ~2 m.", min: -40, max: 60, maxRatePerHour: 10, agg: "mean" },
  humidity_pct: { label: "Relative humidity", short: "RH", unit: "%", decimals: 0, color: "#a78bfa", help: "How close the air is to saturation. Long spells above ~90 % favour fungal disease such as rice blast.", min: 0, max: 100, maxRatePerHour: 60, agg: "mean" },
  wind_ms: { label: "Wind speed", short: "Wind", unit: "m/s", decimals: 1, color: "#94a3b8", help: "Mean wind speed. 17 m/s ≈ gale force; cyclones exceed 33 m/s.", min: 0, max: 90, maxRatePerHour: 40, agg: "mean" },
  pressure_hpa: { label: "Air pressure", short: "Pressure", unit: "hPa", decimals: 1, color: "#cbd5e1", help: "Barometric pressure. A fall of more than ~5 hPa in 3 hours signals an approaching storm.", min: 850, max: 1090, maxRatePerHour: 8, agg: "mean" },
  groundwater_depth_m: { label: "Depth to groundwater", short: "GW depth", unit: "m bgl", decimals: 2, color: "#2dd4bf", help: "Distance from the ground surface down to the water table (metres below ground level). Bigger numbers mean a deeper, more depleted aquifer.", min: 0, max: 200, maxRatePerHour: 1, agg: "mean" },
  battery_pct: { label: "Battery", short: "Battery", unit: "%", decimals: 0, color: "#4ade80", help: "Remaining battery charge reported by the device.", min: 0, max: 100, maxRatePerHour: 30, agg: "mean" },
  rssi_dbm: { label: "Signal strength (RSSI)", short: "RSSI", unit: "dBm", decimals: 0, color: "#818cf8", help: "Received radio signal strength. Around −70 dBm is excellent, below −115 dBm packets start to get lost.", min: -150, max: 0, maxRatePerHour: 200, agg: "mean" },
  snr_db: { label: "Signal-to-noise (SNR)", short: "SNR", unit: "dB", decimals: 1, color: "#c084fc", help: "LoRa signal-to-noise ratio. Positive is good; below about −10 dB the link is marginal.", min: -30, max: 30, maxRatePerHour: 100, agg: "mean" },
};

export const METRIC_KEYS = Object.keys(METRIC_META) as MetricKey[];

export interface DeviceTypeMeta {
  label: string;
  short: string;
  /** lucide icon name, resolved on the client */
  icon: "Waves" | "Sprout" | "Anchor" | "CloudRain" | "Wind" | "ArrowDownToLine";
  color: string;
  /** Primary metric shown on cards / map */
  primary: MetricKey;
  metrics: MetricKey[];
  /** Default reporting interval (seconds) */
  intervalSec: number;
  description: string;
  latestFirmware: string;
  connectivity: "LoRaWAN" | "NB-IoT" | "4G" | "WiFi";
}

export const DEVICE_TYPES: Record<DeviceType, DeviceTypeMeta> = {
  river_gauge: {
    label: "River / canal water-level gauge",
    short: "Water-level gauge",
    icon: "Waves",
    color: "#38bdf8",
    primary: "water_level_m",
    metrics: ["water_level_m", "battery_pct", "rssi_dbm", "snr_db"],
    intervalSec: 60,
    description: "Radar or pressure-transducer stage sensor on a bridge or canal wall. The ground truth for river-flood forecasts.",
    latestFirmware: "2.4.1",
    connectivity: "LoRaWAN",
  },
  soil_probe: {
    label: "Soil salinity (EC) + moisture probe",
    short: "Soil EC probe",
    icon: "Sprout",
    color: "#f59e0b",
    primary: "soil_ec",
    metrics: ["soil_ec", "soil_moisture", "soil_temp_c", "battery_pct", "rssi_dbm", "snr_db"],
    intervalSec: 300,
    description: "Buried capacitance + conductivity probe in the root zone. Measures salt and water the crop actually feels.",
    latestFirmware: "1.9.0",
    connectivity: "LoRaWAN",
  },
  tide_gauge: {
    label: "Tide gauge",
    short: "Tide gauge",
    icon: "Anchor",
    color: "#22d3ee",
    primary: "tide_level_m",
    metrics: ["tide_level_m", "battery_pct", "rssi_dbm"],
    intervalSec: 60,
    description: "Estuary / port gauge measuring the tide and storm surge that push salt water inland.",
    latestFirmware: "3.1.2",
    connectivity: "4G",
  },
  rain_gauge: {
    label: "Tipping-bucket rain gauge",
    short: "Rain gauge",
    icon: "CloudRain",
    color: "#60a5fa",
    primary: "rain_mm",
    metrics: ["rain_mm", "battery_pct", "rssi_dbm", "snr_db"],
    intervalSec: 60,
    description: "0.2 mm tipping bucket. Local rain truth for parametric triggers and flash-flood warnings.",
    latestFirmware: "1.6.4",
    connectivity: "LoRaWAN",
  },
  weather_station: {
    label: "Automatic weather station",
    short: "Weather station",
    icon: "Wind",
    color: "#a78bfa",
    primary: "air_temp_c",
    metrics: ["air_temp_c", "humidity_pct", "rain_mm", "wind_ms", "pressure_hpa", "battery_pct", "rssi_dbm"],
    intervalSec: 60,
    description: "Solar-powered AWS: temperature, humidity, rain, wind and pressure.",
    latestFirmware: "4.0.3",
    connectivity: "NB-IoT",
  },
  piezometer: {
    label: "Groundwater piezometer",
    short: "Piezometer",
    icon: "ArrowDownToLine",
    color: "#2dd4bf",
    primary: "groundwater_depth_m",
    metrics: ["groundwater_depth_m", "battery_pct", "rssi_dbm", "snr_db"],
    intervalSec: 900,
    description: "Pressure logger in an observation well. Tracks aquifer depletion and saline intrusion risk.",
    latestFirmware: "1.2.7",
    connectivity: "LoRaWAN",
  },
};

export const DEVICE_TYPE_KEYS = Object.keys(DEVICE_TYPES) as DeviceType[];

export type DeviceStatus = "online" | "stale" | "offline" | "never";

/**
 * Status from last-seen: online within 3× the reporting interval (min 10 min),
 * stale up to 6 h, offline beyond; "never" before the first packet.
 */
export function deviceStatus(lastSeen: number | null, intervalSec: number, now = Date.now()): DeviceStatus {
  if (lastSeen == null) return "never";
  const age = now - lastSeen;
  if (age <= Math.max(10 * 60_000, intervalSec * 3000)) return "online";
  if (age <= 6 * 3600_000) return "stale";
  return "offline";
}

export const STATUS_META: Record<DeviceStatus, { label: string; color: string; help: string }> = {
  online: { label: "Online", color: "#22c55e", help: "Reported within the expected interval." },
  stale: { label: "Stale", color: "#f59e0b", help: "Missed several reports (up to 6 h). Often radio interference or a weak battery." },
  offline: { label: "Offline", color: "#ef4444", help: "Silent for more than 6 hours — needs a field visit." },
  never: { label: "Awaiting data", color: "#64748b", help: "Provisioned but no reading received yet." },
};

export type AnomalyKind = "spike" | "flatline" | "rapid_rise" | "rapid_fall" | "ec_surge" | "level_shift" | "outlier" | "gap";
export type AnomalyClass = "sensor_fault" | "real_event" | "suspect";

export interface Anomaly {
  id: string;
  deviceId: string;
  metric: MetricKey;
  kind: AnomalyKind;
  cls: AnomalyClass;
  severity: "info" | "warning" | "critical";
  start: number;
  end: number;
  value: number;
  baseline: number;
  /** robust z-score or rate, depending on kind */
  score: number;
  title: string;
  explanation: string;
}

/** Point in a chart-ready series (downsampled buckets carry min/max). */
export interface SeriesPoint {
  t: number;
  v: number;
  min?: number;
  max?: number;
  n?: number;
}
