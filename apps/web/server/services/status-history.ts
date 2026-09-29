/**
 * Public status page data. Wraps the real health probes
 * (server/health/sources.ts + ML API health) and keeps an in-memory probe
 * history since the server last started, from which per-component daily
 * uptime bars and incidents are derived. Nothing is persisted: the page says
 * "since last restart" and shows days before that as "no data".
 *
 * A light background sampler (every 5 min, unref'd timer) keeps history
 * accumulating even when nobody is looking at the page. Disabled in tests.
 */
import { checkSources, type SourceHealth, type SourceStatus } from "../health/sources";
import { jobOverview } from "../jobs/registry";

export interface ProbeSample {
  at: number;
  status: SourceStatus;
  latencyMs: number | null;
}

export interface ComponentDef {
  id: string;
  name: string;
  description: string;
  probes: string[];
}

export const STATUS_COMPONENTS: ComponentDef[] = [
  { id: "app", name: "Web app & API", description: "Dashboards, tRPC and REST API (/api/v1)", probes: ["self"] },
  { id: "ml", name: "ML inference", description: "Flood & salinity models, Copilot advisor, Monte Carlo", probes: ["ml-api"] },
  { id: "forecast", name: "Weather forecasts", description: "Open-Meteo forecast & ERA5 archive", probes: ["open-meteo-forecast", "open-meteo-archive"] },
  { id: "hydro", name: "River & flood forecasts", description: "Copernicus GloFAS river discharge", probes: ["open-meteo-flood"] },
  { id: "ocean", name: "Sea level & terrain", description: "Marine sea-level and Copernicus DEM elevation", probes: ["open-meteo-marine", "open-meteo-elevation"] },
  { id: "hazards", name: "Disaster feeds", description: "GDACS and NASA EONET live events", probes: ["gdacs", "nasa-eonet"] },
  { id: "satellite", name: "Satellite imagery", description: "NASA GIBS map tiles and ORNL MODIS NDVI", probes: ["nasa-gibs", "ornl-modis"] },
  { id: "soil", name: "Soil data", description: "ISRIC SoilGrids (REST + WMS)", probes: ["soilgrids", "soilgrids-wms"] },
  { id: "translation", name: "Translation", description: "Alert & SMS translation", probes: ["mymemory"] },
  { id: "economics", name: "Economic reference data", description: "World Bank indicators", probes: ["world-bank"] },
  { id: "jobs", name: "Background jobs", description: "Climate scans, notification dispatch, satellite ingest, retraining", probes: ["jobs"] },
];

const MAX_SAMPLES = 5000;
interface HistState {
  bootAt: number;
  samples: Map<string, ProbeSample[]>;
  timer: ReturnType<typeof setInterval> | null;
  lastSample: number;
  lastSources?: SourceHealth[];
  sampling?: Promise<SourceHealth[]> | null;
}
const g = globalThis as unknown as { __agriStatusHist?: HistState };

function hist(): HistState {
  return (g.__agriStatusHist ??= { bootAt: Date.now(), samples: new Map(), timer: null, lastSample: 0 });
}

export function recordSample(id: string, s: ProbeSample) {
  const h = hist();
  const arr = h.samples.get(id) ?? [];
  arr.push(s);
  if (arr.length > MAX_SAMPLES) arr.splice(0, arr.length - MAX_SAMPLES);
  h.samples.set(id, arr);
}

function jobsStatus(): ProbeSample {
  try {
    const statuses = jobOverview().map((j) => j.lastRun?.status).filter(Boolean) as string[];
    const failed = statuses.filter((x) => x === "failed").length;
    return { at: Date.now(), status: failed === 0 ? "up" : failed === statuses.length ? "down" : "degraded", latencyMs: null };
  } catch {
    return { at: Date.now(), status: "up", latencyMs: null };
  }
}

/** Take one sample of every probe (cached 60 s by the probe layer). */
export async function sampleNow(force = false): Promise<SourceHealth[]> {
  const t0 = Date.now();
  const sources = await checkSources(force);
  const h = hist();
  h.lastSample = Date.now();
  h.lastSources = sources;
  for (const s of sources) recordSample(s.id, { at: Date.now(), status: s.status, latencyMs: s.latencyMs });
  recordSample("self", { at: Date.now(), status: "up", latencyMs: Date.now() - t0 > 20_000 ? Date.now() - t0 : null });
  recordSample("jobs", jobsStatus());
  return sources;
}

export function ensureSampler() {
  const h = hist();
  if (h.timer || process.env.DISABLE_SCHEDULER === "true" || process.env.VITEST) return;
  h.timer = setInterval(() => void sampleNow().catch(() => undefined), 5 * 60_000);
  (h.timer as unknown as { unref?: () => void }).unref?.();
}

// ─── Aggregation (pure) ───────────────────────────────────────────────────

const RANK: Record<SourceStatus, number> = { up: 0, degraded: 1, offline: 2, down: 3 };
const worst = (a: SourceStatus, b: SourceStatus) => (RANK[a] >= RANK[b] ? a : b);

export interface DayBar {
  date: string;
  /** null = no data (before last restart) */
  uptimePct: number | null;
  worst: SourceStatus | null;
  samples: number;
}

/** 90 daily bars (oldest → newest). A sample counts as "up" when up or degraded. */
export function dailyBars(samples: ProbeSample[], days = 90, now = Date.now()): DayBar[] {
  const out: DayBar[] = [];
  const today = new Date(now);
  const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  for (let i = days - 1; i >= 0; i--) {
    const from = startOfToday - i * 86_400_000;
    const to = from + 86_400_000;
    const inDay = samples.filter((s) => s.at >= from && s.at < to);
    if (!inDay.length) {
      out.push({ date: new Date(from).toISOString().slice(0, 10), uptimePct: null, worst: null, samples: 0 });
      continue;
    }
    const ok = inDay.filter((s) => s.status === "up" || s.status === "degraded").length;
    out.push({ date: new Date(from).toISOString().slice(0, 10), uptimePct: Math.round((ok / inDay.length) * 1000) / 10, worst: inDay.reduce<SourceStatus>((w, s) => worst(w, s.status), "up"), samples: inDay.length });
  }
  return out;
}

export interface Incident {
  componentId: string;
  componentName: string;
  status: SourceStatus;
  startedAt: number;
  endedAt: number | null;
  samples: number;
}

/** Contiguous runs of non-"up" samples become incidents. */
export function deriveIncidents(componentId: string, componentName: string, samples: ProbeSample[]): Incident[] {
  const out: Incident[] = [];
  let cur: Incident | null = null;
  for (const s of samples) {
    if (s.status !== "up") {
      if (!cur) cur = { componentId, componentName, status: s.status, startedAt: s.at, endedAt: null, samples: 0 };
      cur.status = worst(cur.status, s.status);
      cur.samples += 1;
    } else if (cur) {
      cur.endedAt = s.at;
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export async function statusReport(force = false) {
  ensureSampler();
  const h = hist();
  // Serve the last probe results immediately and refresh in the background, so
  // the page never waits on a slow upstream (probes have up to 12 s timeouts).
  const stale = Date.now() - h.lastSample > 55_000;
  let sources: SourceHealth[];
  if (force || !h.lastSources) {
    sources = await (h.sampling ??= sampleNow(force).finally(() => (h.sampling = null)));
  } else {
    if (stale && !h.sampling) h.sampling = sampleNow(false).finally(() => (h.sampling = null));
    sources = h.lastSources;
  }
  const byId = new Map(sources.map((s) => [s.id, s]));
  const components = STATUS_COMPONENTS.map((c) => {
    const samples = c.probes
      .flatMap((p) => h.samples.get(p) ?? [])
      .sort((a, b) => a.at - b.at);
    const current: SourceStatus = c.probes.reduce<SourceStatus>((w, p) => {
      if (p === "self") return w;
      if (p === "jobs") return worst(w, (h.samples.get("jobs") ?? []).at(-1)?.status ?? "up");
      return worst(w, byId.get(p)?.status ?? "up");
    }, "up");
    const latencies = c.probes.map((p) => byId.get(p)?.latencyMs).filter((v): v is number => typeof v === "number");
    const ok = samples.filter((s) => s.status === "up" || s.status === "degraded").length;
    return {
      ...c,
      status: current,
      latencyMs: latencies.length ? Math.max(...latencies) : null,
      uptimeSinceBootPct: samples.length ? Math.round((ok / samples.length) * 10000) / 100 : null,
      bars: dailyBars(samples),
      checks: samples.length,
      detail: c.probes.map((p) => byId.get(p)).filter(Boolean).map((s) => ({ name: s!.name, status: s!.status, latencyMs: s!.latencyMs, error: s!.error, checkedAt: s!.checkedAt })),
    };
  });
  const incidents = STATUS_COMPONENTS.flatMap((c) => deriveIncidents(c.id, c.name, c.probes.flatMap((p) => h.samples.get(p) ?? []).sort((a, b) => a.at - b.at)))
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 20);
  const down = components.filter((c) => c.status === "down" || c.status === "offline").length;
  const degraded = components.filter((c) => c.status === "degraded").length;
  return {
    overall: down === 0 && degraded === 0 ? ("operational" as const) : down > components.length / 2 ? ("major_outage" as const) : ("degraded" as const),
    bootAt: new Date(h.bootAt),
    checkedAt: new Date(),
    sampleIntervalMin: 5,
    components,
    incidents,
  };
}
