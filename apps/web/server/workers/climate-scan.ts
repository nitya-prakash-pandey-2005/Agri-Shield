/**
 * BullMQ processor: CLIMATE_SCAN (every 30 min).
 * Thin wrapper — the job logic lives in server/jobs/climate-scan.ts so the
 * in-process scheduler, Vercel cron, admin "Run now" and BullMQ share one code path.
 */
import type { Job } from "bullmq";
import { triggerJob } from "../jobs";

export const CLIMATE_SCAN_QUEUE = "climate-scan";

export async function processClimateScan(job: Job) {
  const run = await triggerJob("climate-scan", "bullmq", (job.data?.triggeredBy as string) ?? "bullmq");
  if (run.status === "failed") throw new Error(run.error ?? run.summary);
  return { runId: run.id, status: run.status, summary: run.summary };
}
