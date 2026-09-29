/**
 * BullMQ processor: SATELLITE_INGEST (daily 02:00 UTC) — MODIS MOD13Q1 NDVI
 * from the ORNL DAAC REST API for every monitored district.
 */
import type { Job } from "bullmq";
import { triggerJob } from "../jobs";

export const SATELLITE_QUEUE = "satellite-ingest";

export async function processSatelliteIngest(job: Job) {
  const run = await triggerJob("satellite-ingest", "bullmq", (job.data?.triggeredBy as string) ?? "bullmq");
  if (run.status === "failed") throw new Error(run.error ?? run.summary);
  return { runId: run.id, status: run.status, summary: run.summary };
}
