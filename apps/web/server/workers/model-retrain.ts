/**
 * BullMQ processor: MODEL_RETRAIN (weekly, Sunday 03:00 UTC) — ships farmer
 * outcome feedback to the ML service for fine-tuning + gated promotion.
 */
import type { Job } from "bullmq";
import { triggerJob } from "../jobs";

export const RETRAIN_QUEUE = "model-retrain";

export async function processModelRetrain(job: Job) {
  const run = await triggerJob("model-retrain", "bullmq", (job.data?.triggeredBy as string) ?? "bullmq");
  if (run.status === "failed") throw new Error(run.error ?? run.summary);
  return { runId: run.id, status: run.status, summary: run.summary };
}
