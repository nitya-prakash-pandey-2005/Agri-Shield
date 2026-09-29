/**
 * BullMQ wiring (Redis-backed queues, repeatable job schedulers, workers).
 * Only loaded when ENABLE_WORKERS=true and REDIS_URL is set; reachability is
 * checked first so a missing/dead Redis falls back to in-process timers.
 *
 * bullmq / ioredis are loaded with a runtime-only require (never statically
 * traceable), so neither webpack nor Turbopack ever pulls them into an Edge or
 * client bundle — only type imports are static.
 */
import { join } from "node:path";
import type { Job, Processor, Queue as QueueT, Worker as WorkerT } from "bullmq";
import type RedisT from "ioredis";
import { JOB_DEFS, type JobName } from "../jobs/registry";
import { processClimateScan } from "./climate-scan";
import { processNotificationDispatch } from "./notification-dispatch";
import { processSatelliteIngest } from "./satellite-ingest";
import { processModelRetrain } from "./model-retrain";

const PROCESSORS: Record<JobName, Processor> = {
  "climate-scan": processClimateScan,
  "notification-dispatch": processNotificationDispatch,
  "satellite-ingest": processSatelliteIngest,
  "model-retrain": processModelRetrain,
  "portfolio-monitor": async (job) => {
    const { triggerJob } = await import("../jobs");
    const run = await triggerJob("portfolio-monitor", "bullmq", (job.data?.triggeredBy as string) ?? "bullmq");
    if (run.status === "failed") throw new Error(run.error ?? run.summary);
    return { runId: run.id, status: run.status, summary: run.summary };
  },
};

const ATTEMPTS: Record<JobName, number> = { "climate-scan": 3, "notification-dispatch": 5, "satellite-ingest": 2, "model-retrain": 2, "portfolio-monitor": 2 };

type BullMQModule = typeof import("bullmq");
type IORedisModule = { default?: typeof RedisT } & typeof RedisT;

/** Resolve a package from the app root at runtime (cwd = apps/web for next dev/start and the worker). */
function runtimeRequire<T>(id: string): T {
  // process.getBuiltinModule (Node ≥ 20.16) keeps createRequire invisible to bundler parsers.
  const nodeModule = (process as unknown as { getBuiltinModule?: (m: string) => typeof import("node:module") | undefined }).getBuiltinModule?.("node:module");
  if (!nodeModule) throw new Error("BullMQ mode needs Node ≥ 20.16 (process.getBuiltinModule)");
  const { createRequire } = nodeModule;
  const roots = [process.cwd(), join(process.cwd(), "apps", "web")];
  let last: unknown;
  for (const root of roots) {
    try {
      return createRequire(join(root, "package.json"))(id) as T;
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error(`Cannot load ${id}`);
}
const bullmq = () => runtimeRequire<BullMQModule>("bullmq");
const IORedis = (): typeof RedisT => {
  const m = runtimeRequire<IORedisModule>("ioredis");
  return (m.default ?? m) as typeof RedisT;
};

const g = globalThis as unknown as { __agriBull?: { queues: Map<JobName, QueueT>; workers: WorkerT[] } };

export function redisConnection() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL not set");
  return { url, maxRetriesPerRequest: null, enableOfflineQueue: false } as const;
}

/** PING Redis with a hard timeout — never throws. */
export async function redisReachable(url = process.env.REDIS_URL, timeoutMs = 2500): Promise<{ ok: boolean; latencyMs: number | null; error?: string }> {
  if (!url) return { ok: false, latencyMs: null, error: "REDIS_URL not set" };
  let Redis: typeof RedisT;
  try {
    Redis = IORedis();
  } catch (e) {
    return { ok: false, latencyMs: null, error: `ioredis unavailable: ${(e as Error).message}` };
  }
  const client = new Redis(url, { lazyConnect: true, connectTimeout: timeoutMs, maxRetriesPerRequest: 0, retryStrategy: () => null, enableOfflineQueue: false });
  client.on("error", () => {});
  const t = Date.now();
  try {
    await Promise.race([
      (async () => {
        await client.connect();
        await client.ping();
      })(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs)),
    ]);
    return { ok: true, latencyMs: Date.now() - t };
  } catch (e) {
    return { ok: false, latencyMs: null, error: (e as Error).message };
  } finally {
    client.disconnect();
  }
}

export async function startBullMQ(opts: { runWorkers: boolean; bootRuns?: boolean }) {
  if (g.__agriBull) return g.__agriBull;
  const ping = await redisReachable();
  if (!ping.ok) throw new Error(`Redis unreachable (${ping.error})`);

  const { Queue, Worker } = bullmq();
  const connection = redisConnection();
  const queues = new Map<JobName, QueueT>();
  const workers: WorkerT[] = [];

  for (const def of Object.values(JOB_DEFS)) {
    const q = new Queue(def.name, {
      connection,
      defaultJobOptions: { attempts: ATTEMPTS[def.name], backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 100, removeOnFail: 200 },
    });
    q.on("error", (e) => console.warn(`[bullmq] queue ${def.name}:`, e.message));
    await q.upsertJobScheduler(`${def.name}-schedule`, { pattern: def.cron, tz: "UTC" }, { name: def.name, data: { triggeredBy: "bullmq-scheduler" } });
    queues.set(def.name, q);

    if (opts.runWorkers) {
      const w = new Worker(def.name, PROCESSORS[def.name], { connection, concurrency: 1, lockDuration: 10 * 60_000 });
      w.on("error", (e) => console.warn(`[bullmq] worker ${def.name}:`, e.message));
      w.on("failed", (job: Job | undefined, e) => console.warn(`[bullmq] ${def.name} job ${job?.id} failed:`, e.message));
      workers.push(w);
    }
  }

  if (opts.bootRuns !== false) {
    await queues.get("climate-scan")!.add("climate-scan", { triggeredBy: "boot" }, { delay: 15_000, jobId: `boot-scan-${Math.floor(Date.now() / 60_000)}` });
    if (process.env.SATELLITE_BOOT_INGEST !== "false")
      await queues.get("satellite-ingest")!.add("satellite-ingest", { triggeredBy: "boot" }, { delay: 45_000, jobId: `boot-sat-${Math.floor(Date.now() / 3_600_000)}` });
  }

  g.__agriBull = { queues, workers };
  console.log(`[bullmq] ${queues.size} queues + schedulers registered${opts.runWorkers ? `, ${workers.length} workers running` : " (external workers)"}`);
  return g.__agriBull;
}

/** Enqueue an immediate one-off run (used when the admin panel runs jobs in BullMQ mode). */
export async function enqueueNow(job: JobName, by: string) {
  const q = g.__agriBull?.queues.get(job);
  if (!q) return null;
  const j = await q.add(job, { triggeredBy: by });
  return j.id ?? null;
}

export async function bullStats() {
  const b = g.__agriBull;
  if (!b) return null;
  const out: Record<string, Record<string, number>> = {};
  for (const [name, q] of b.queues) out[name] = await q.getJobCounts("waiting", "active", "delayed", "completed", "failed");
  return out;
}

export async function stopBullMQ() {
  const b = g.__agriBull;
  if (!b) return;
  await Promise.allSettled([...b.workers.map((w) => w.close()), ...[...b.queues.values()].map((q) => q.close())]);
  g.__agriBull = undefined;
}
