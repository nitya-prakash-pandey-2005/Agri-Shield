/**
 * Scheduler bootstrap (called from instrumentation.ts `register()`).
 *
 * Mode selection:
 *   ENABLE_WORKERS=true + REDIS_URL reachable → BullMQ repeatable jobs.
 *       WORKER_MODE=external → only enqueue; `pnpm --filter @agri-shield/web worker` processes.
 *       otherwise           → workers also run in this process (shares the in-memory store).
 *   anything else → dependency-free in-process timers.
 *   DISABLE_SCHEDULER=true (or NODE_ENV=test) → off.
 * Redis is optional: any connection failure falls back to timers, never crashes.
 */
import { CADENCE, JOB_DEFS, schedulerState, setNextRun, setSchedulerState, type JobName } from "./registry";
import { triggerJob } from "./index";

const g = globalThis as unknown as { __agriSchedulerStarted?: boolean; __agriTimers?: NodeJS.Timeout[] };

const MIN = 60_000;

/** Next occurrence of a UTC wall-clock time (optionally on a weekday, 0 = Sunday). */
export function nextUtc(hour: number, minute = 0, weekday?: number, from = new Date()): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hour, minute, 0, 0));
  if (weekday !== undefined) {
    const add = (weekday - d.getUTCDay() + 7) % 7;
    d.setUTCDate(d.getUTCDate() + add);
  }
  while (d.getTime() <= from.getTime()) d.setUTCDate(d.getUTCDate() + (weekday !== undefined ? 7 : 1));
  return d;
}

function timer(fn: () => void, ms: number, repeat = false) {
  const t = repeat ? setInterval(fn, ms) : setTimeout(fn, ms);
  t.unref?.();
  (g.__agriTimers ??= []).push(t);
  return t;
}

function fire(job: JobName, trigger: "schedule" | "boot" = "schedule") {
  triggerJob(job, trigger, "scheduler").catch((e) => console.error(`[scheduler] ${job}:`, e));
}

function every(job: JobName, ms: number, firstDelayMs: number) {
  setNextRun(job, new Date(Date.now() + firstDelayMs));
  timer(() => {
    fire(job, "boot");
    setNextRun(job, new Date(Date.now() + ms));
    timer(() => {
      fire(job);
      setNextRun(job, new Date(Date.now() + ms));
    }, ms, true);
  }, firstDelayMs);
}

function atWallClock(job: JobName, next: () => Date) {
  const arm = () => {
    const at = next();
    setNextRun(job, at);
    timer(() => {
      fire(job);
      arm();
    }, Math.min(at.getTime() - Date.now(), 2 ** 31 - 1));
  };
  arm();
}

export function startIntervalScheduler(reason = "in-process timers") {
  setSchedulerState({ mode: "interval", startedAt: new Date(), detail: reason });
  every("climate-scan", CADENCE.climateScanMin * MIN, 15_000);
  every("notification-dispatch", 2 * MIN, 40_000);
  every("portfolio-monitor", CADENCE.portfolioMonitorMin * MIN, CADENCE.portfolioFirstRunMs);
  // IoT sensor fleet: seed + start the 60 s telemetry loop so alert rules can use ground truth
  timer(() => {
    void import("../services/iot-service").then((m) => m.ensureIot()).catch((e) => console.warn("[scheduler] IoT boot failed:", e));
  }, 20_000);
  // satellite: once shortly after boot (non-blocking, ~2 min of polite API calls), then daily 02:00 UTC
  if (process.env.SATELLITE_BOOT_INGEST !== "false") timer(() => fire("satellite-ingest", "boot"), 45_000);
  atWallClock("satellite-ingest", () => nextUtc(2, 0));
  atWallClock("model-retrain", () => nextUtc(3, 0, 0));
  console.log("[scheduler] in-process scheduler started: climate-scan 30m, dispatch 2m, satellite 02:00Z, retrain Sun 03:00Z");
}

export async function startScheduler(): Promise<void> {
  if (g.__agriSchedulerStarted) return;
  g.__agriSchedulerStarted = true;
  if (process.env.DISABLE_SCHEDULER === "true" || process.env.NODE_ENV === "test") {
    setSchedulerState({ mode: "off", detail: "DISABLE_SCHEDULER=true" });
    return;
  }
  if (process.env.ENABLE_WORKERS === "true" && process.env.REDIS_URL) {
    try {
      const { startBullMQ } = await import("../workers/queues");
      const external = process.env.WORKER_MODE === "external";
      await startBullMQ({ runWorkers: !external });
      setSchedulerState({ mode: "bullmq", startedAt: new Date(), detail: external ? "BullMQ (external worker process)" : "BullMQ (in-process workers)" });
      for (const def of Object.values(JOB_DEFS)) setNextRun(def.name, new Date(Date.now() + 30 * MIN));
      return;
    } catch (e) {
      console.warn("[scheduler] BullMQ unavailable, falling back to in-process timers:", (e as Error).message);
      startIntervalScheduler(`timers (BullMQ fallback: ${(e as Error).message})`);
      return;
    }
  }
  startIntervalScheduler();
}

export function stopScheduler() {
  for (const t of g.__agriTimers ?? []) clearTimeout(t);
  g.__agriTimers = [];
  g.__agriSchedulerStarted = false;
  setSchedulerState({ mode: "off", detail: "stopped" });
}

export { schedulerState };
