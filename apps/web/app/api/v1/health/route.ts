/**
 * GET /api/v1/health — uptime endpoint (spec §10).
 * Web process status + ML API + every open-data source (live probe, latency),
 * store stats, live-risk overlay and background-job status.
 * `?deep=0` skips the external probes (cheap liveness check for load balancers).
 */
import { getStore } from "@/server/data/store";
import { liveRiskStatus } from "@/server/live/district-risk";
import { cacheStats } from "@/server/live/http";
import { checkSources, summarize } from "@/server/health/sources";
import { jobOverview, schedulerState, satelliteStatus } from "@/server/jobs";
import { outbox } from "@/server/notify/channels";
import { API_VERSION, json } from "@/server/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bootedAt = new Date(Date.now() - Math.round(process.uptime() * 1000));

export async function GET(req: Request) {
  const url = new URL(req.url);
  const deep = url.searchParams.get("deep") !== "0";
  const t0 = Date.now();
  const s = getStore();
  const mem = process.memoryUsage();

  const web = {
    status: "up" as const,
    version: process.env.npm_package_version ?? "0.1.0",
    apiVersion: API_VERSION,
    node: process.version,
    env: process.env.NODE_ENV,
    uptimeSec: Math.round(process.uptime()),
    bootedAt,
    memoryMb: { rss: Math.round(mem.rss / 1e6), heapUsed: Math.round(mem.heapUsed / 1e6) },
    dataMode: process.env.DATABASE_URL ? "postgres" : "in-memory",
  };

  const store = {
    seededAt: s.seededAt,
    users: s.users.length,
    farmers: s.farmers.length,
    fields: s.fields.length,
    districts: s.districts.length,
    liveDistricts: s.districts.filter((d) => d.liveSource === "open-meteo").length,
    alerts: s.alerts.length,
    activeAlerts: s.alerts.filter((a) => a.isActive).length,
    recommendations: s.recommendations.length,
    supplyNodes: s.nodes.length,
    auditEntries: s.audit.length,
    outboxMessages: outbox.length,
    scenario: s.scenario.mode,
  };

  const jobs = jobOverview().map((j) => ({
    name: j.name,
    schedule: j.schedule,
    running: j.running,
    lastStatus: j.lastRun?.status ?? null,
    lastRunAt: j.lastRun?.finishedAt ?? null,
    lastSuccessAt: j.lastSuccessAt,
    nextRunAt: j.nextRunAt,
  }));

  const sat = satelliteStatus();
  const sources = deep ? await checkSources() : [];
  const summary = deep ? summarize(sources) : null;
  const ml = sources.find((x) => x.id === "ml-api") ?? null;

  const status = !deep ? "ok" : summary!.status === "major_outage" ? "degraded" : "ok";
  return json(
    {
      status,
      checkedAt: new Date().toISOString(),
      tookMs: Date.now() - t0,
      web,
      ml: ml ? { status: ml.status, latencyMs: ml.latencyMs, url: ml.url, fallback: ml.status === "down" ? "web-formula-v1.2" : null } : null,
      dataSources: deep ? { summary, sources: sources.map(({ docs: _d, ...rest }) => rest) } : "skipped (deep=0)",
      liveRisk: liveRiskStatus(),
      satellite: { lastRunAt: sat.lastRunAt, lastSuccessAt: sat.lastSuccessAt, latestComposite: sat.latestComposite },
      scheduler: schedulerState(),
      jobs,
      store,
      cache: cacheStats(),
    },
    { status: 200 }
  );
}
