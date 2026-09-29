/**
 * Next.js instrumentation hook — runs once per server process at boot.
 * 1. Persistence (server/persist): loads saved store snapshots (file or
 *    Postgres) BEFORE anything touches a store, so every store hydrates from
 *    its snapshot, and starts the periodic flush.
 * 2. Starts the background job scheduler (spec §6).
 * Node.js runtime only: the `NEXT_RUNTIME === "nodejs"` guard wraps the imports
 * directly so the Edge bundle dead-code-eliminates the Node-only code (fs,
 * Postgres, BullMQ, ioredis). See server/jobs/scheduler.ts for mode selection.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { startPersistence } = await import("./server/persist/boot");
    await startPersistence().catch((e: unknown) => console.error("[instrumentation] persistence failed to start:", e));
    const { startScheduler } = await import("./server/jobs/scheduler");
    await startScheduler().catch((e: unknown) => console.error("[instrumentation] scheduler failed to start:", e));
  }
}
