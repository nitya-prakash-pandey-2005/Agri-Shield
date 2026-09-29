/**
 * Standalone worker process entry:  pnpm --filter @agri-shield/web worker
 *
 * With REDIS_URL → consumes the BullMQ queues (and registers the repeatable
 * schedules). Pair it with WORKER_MODE=external on the web process.
 * Without Redis → runs the same jobs on in-process timers so the worker is
 * still useful (e.g. a Railway "agri-shield-worker" service in DATABASE_URL mode).
 *
 * Note: in demo mode (no DATABASE_URL) the system of record is each process's
 * in-memory store, so the default and recommended setup is in-process workers
 * inside the web server (ENABLE_WORKERS=true without WORKER_MODE=external).
 */
import { startBullMQ, stopBullMQ } from "./queues";
import { startIntervalScheduler, stopScheduler } from "../jobs/scheduler";

async function main() {
  console.log(`[worker] Agri-SHIELD worker starting (pid ${process.pid})`);
  if (process.env.REDIS_URL) {
    try {
      await startBullMQ({ runWorkers: true });
      console.log("[worker] consuming BullMQ queues: climate-scan, notification-dispatch, satellite-ingest, model-retrain");
      return;
    } catch (e) {
      console.warn("[worker] BullMQ unavailable:", (e as Error).message);
    }
  }
  startIntervalScheduler("standalone worker (timers)");
}

async function shutdown(signal: string) {
  console.log(`[worker] ${signal} received, draining…`);
  stopScheduler();
  await stopBullMQ();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

main().catch((e) => {
  console.error("[worker] fatal:", e);
  process.exit(1);
});
