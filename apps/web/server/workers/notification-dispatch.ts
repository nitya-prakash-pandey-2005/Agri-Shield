/**
 * BullMQ processor: NOTIFICATION_DISPATCH (every 2 min) — drains the pending
 * delivery queue and retries failed Twilio / Resend sends with backoff.
 */
import type { Job } from "bullmq";
import { triggerJob } from "../jobs";

export const NOTIFICATION_QUEUE = "notification-dispatch";

export async function processNotificationDispatch(job: Job) {
  const run = await triggerJob("notification-dispatch", "bullmq", (job.data?.triggeredBy as string) ?? "bullmq");
  if (run.status === "failed") throw new Error(run.error ?? run.summary);
  return { runId: run.id, status: run.status, summary: run.summary };
}
