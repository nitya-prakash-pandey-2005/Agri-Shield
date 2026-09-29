/**
 * Background job catalogue + trigger API used by the scheduler, BullMQ
 * workers, the Vercel cron route and the admin "Run now" buttons.
 */
import { climateScan } from "./climate-scan";
import { notificationDispatch } from "./notification-dispatch";
import { satelliteIngest } from "./satellite-ingest";
import { modelRetrain } from "./model-retrain";
import { runJob, type JobName, type JobResult, type JobRun, type JobTrigger } from "./registry";

export * from "./registry";
export { enqueueNotification, notificationQueue } from "./notification-dispatch";
export { satelliteStatus } from "./satellite-ingest";

export const JOB_FNS: Record<JobName, (by: string) => Promise<JobResult>> = {
  "climate-scan": (by) => climateScan({ triggeredBy: by }),
  "notification-dispatch": () => notificationDispatch(),
  "satellite-ingest": () => satelliteIngest(),
  "model-retrain": (by) => modelRetrain({ triggeredBy: by === "system" ? undefined : by }),
  "portfolio-monitor": (by) => import("./portfolio-monitor").then((m) => m.portfolioMonitor({ triggeredBy: by })),
};

export const JOB_NAMES = Object.keys(JOB_FNS) as JobName[];

export function isJobName(v: string): v is JobName {
  return (JOB_NAMES as string[]).includes(v);
}

/** Run a job through the registry (single-flight, history, timing). */
export function triggerJob(job: JobName, trigger: JobTrigger = "manual", by = "system"): Promise<JobRun> {
  return runJob(job, () => JOB_FNS[job](by), trigger, by);
}
