/**
 * Job registry — run history, status and single-flight execution for the
 * background pipeline (spec §6). Lives on globalThis so route handlers,
 * instrumentation and the tRPC admin router all see the same history.
 */

export type JobName = "climate-scan" | "notification-dispatch" | "satellite-ingest" | "model-retrain";
export type JobTrigger = "schedule" | "boot" | "manual" | "bullmq" | "cron" | "scenario";
export type JobStatus = "running" | "success" | "partial" | "failed" | "skipped";

export interface JobRun {
  id: string;
  job: JobName;
  trigger: JobTrigger;
  triggeredBy: string;
  status: JobStatus;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  summary: string;
  output: Record<string, unknown> | null;
  error: string | null;
}

export interface JobResult {
  status?: Exclude<JobStatus, "running">;
  summary: string;
  output?: Record<string, unknown>;
}

export interface JobDef {
  name: JobName;
  label: string;
  description: string;
  schedule: string;
  cron: string;
}

export const JOB_DEFS: Record<JobName, JobDef> = {
  "climate-scan": {
    name: "climate-scan",
    label: "Climate scan",
    description: "Refresh Open-Meteo / GloFAS / marine risk for 22 districts, check GDACS + EONET hazards, raise model alerts, generate farm recommendations, escalate, fire webhooks.",
    schedule: "Every 30 min (+15 s after boot)",
    cron: "*/30 * * * *",
  },
  "notification-dispatch": {
    name: "notification-dispatch",
    label: "Notification dispatch",
    description: "Drain the pending delivery queue and retry failed SMS / WhatsApp / e-mail messages with exponential backoff (max 3 attempts).",
    schedule: "Every 2 min",
    cron: "*/2 * * * *",
  },
  "satellite-ingest": {
    name: "satellite-ingest",
    label: "Satellite ingest (MODIS NDVI)",
    description: "Pull MOD13Q1 250 m 16-day NDVI + pixel reliability from the ORNL DAAC MODIS REST API for every district, update field NDVI history, flag >20 % drops.",
    schedule: "Daily 02:00 UTC (+ once after boot)",
    cron: "0 2 * * *",
  },
  "model-retrain": {
    name: "model-retrain",
    label: "Model retrain",
    description: "Send new farmer-action outcomes to the ML service (POST /api/ml/retrain); promote if validation AUC improves.",
    schedule: "Weekly, Sunday 03:00 UTC",
    cron: "0 3 * * 0",
  },
};

interface RegistryState {
  runs: JobRun[];
  running: Map<JobName, Promise<JobRun>>;
  seq: number;
  scheduler: { mode: "interval" | "bullmq" | "off"; startedAt: Date | null; detail: string; nextRuns: Partial<Record<JobName, Date>> };
}

const g = globalThis as unknown as { __agriJobs?: RegistryState };
const state: RegistryState = (g.__agriJobs ??= {
  runs: [],
  running: new Map(),
  seq: 0,
  scheduler: { mode: "off", startedAt: null, detail: "not started", nextRuns: {} },
});

export function schedulerState() {
  return state.scheduler;
}

export function setSchedulerState(patch: Partial<RegistryState["scheduler"]>) {
  Object.assign(state.scheduler, patch);
}

export function setNextRun(job: JobName, at: Date) {
  state.scheduler.nextRuns[job] = at;
}

/**
 * Execute a job once. If the same job is already running the in-flight run
 * is returned (single-flight) so overlapping triggers never double-send alerts.
 */
export function runJob(job: JobName, fn: () => Promise<JobResult>, trigger: JobTrigger = "manual", triggeredBy = "system"): Promise<JobRun> {
  const inflight = state.running.get(job);
  if (inflight) return inflight;

  const run: JobRun = {
    id: `run_${(++state.seq).toString().padStart(4, "0")}_${Date.now().toString(36)}`,
    job,
    trigger,
    triggeredBy,
    status: "running",
    startedAt: new Date(),
    finishedAt: null,
    durationMs: null,
    summary: "running…",
    output: null,
    error: null,
  };
  state.runs.unshift(run);
  if (state.runs.length > 300) state.runs.length = 300;

  const p = (async () => {
    try {
      const r = await fn();
      run.status = r.status ?? "success";
      run.summary = r.summary;
      run.output = r.output ?? null;
    } catch (e) {
      run.status = "failed";
      run.error = (e as Error).message ?? String(e);
      run.summary = `Failed: ${run.error}`;
      console.error(`[jobs] ${job} failed:`, e);
    } finally {
      run.finishedAt = new Date();
      run.durationMs = run.finishedAt.getTime() - run.startedAt.getTime();
      state.running.delete(job);
    }
    return run;
  })();
  state.running.set(job, p);
  return p;
}

export function jobRuns(filter?: { job?: JobName; limit?: number }): JobRun[] {
  const list = filter?.job ? state.runs.filter((r) => r.job === filter.job) : state.runs;
  return list.slice(0, filter?.limit ?? 100);
}

export function lastRun(job: JobName, onlyFinished = false): JobRun | null {
  return state.runs.find((r) => r.job === job && (!onlyFinished || r.status !== "running")) ?? null;
}

export function lastSuccess(job: JobName): JobRun | null {
  return state.runs.find((r) => r.job === job && (r.status === "success" || r.status === "partial")) ?? null;
}

export function isRunning(job: JobName): boolean {
  return state.running.has(job);
}

export function jobOverview() {
  return (Object.keys(JOB_DEFS) as JobName[]).map((name) => {
    const last = lastRun(name, true);
    const runs = state.runs.filter((r) => r.job === name && r.status !== "running");
    const ok = runs.filter((r) => r.status === "success" || r.status === "partial" || r.status === "skipped").length;
    return {
      ...JOB_DEFS[name],
      running: isRunning(name),
      lastRun: last,
      lastSuccessAt: lastSuccess(name)?.finishedAt ?? null,
      nextRunAt: state.scheduler.nextRuns[name] ?? null,
      totalRuns: runs.length,
      successRate: runs.length ? ok / runs.length : null,
      avgDurationMs: runs.length ? Math.round(runs.reduce((s, r) => s + (r.durationMs ?? 0), 0) / runs.length) : null,
    };
  });
}

/** Test helper — wipe history. */
export function __resetJobRegistry() {
  state.runs = [];
  state.running.clear();
}
