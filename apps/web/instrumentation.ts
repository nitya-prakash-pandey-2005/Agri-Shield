/**
 * Next.js instrumentation hook — runs once per server process at boot.
 * Starts the background job scheduler (spec §6) in the Node.js runtime only.
 * The `NEXT_RUNTIME === "nodejs"` guard wraps the import directly so the
 * Edge bundle dead-code-eliminates the Node-only job system (BullMQ, ioredis).
 * See server/jobs/scheduler.ts for mode selection (timers vs BullMQ).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { startScheduler } = await import("./server/jobs/scheduler");
    await startScheduler().catch((e: unknown) => console.error("[instrumentation] scheduler failed to start:", e));
  }
}
