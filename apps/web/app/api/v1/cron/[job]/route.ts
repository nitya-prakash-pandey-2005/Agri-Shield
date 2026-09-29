/**
 * GET /api/v1/cron/{climate-scan|notification-dispatch|satellite-ingest|model-retrain}
 * Serverless trigger for the background jobs (Vercel Cron, GitHub Actions, uptime pingers).
 * Auth: `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends this automatically).
 * Without CRON_SECRET the route only works outside production.
 * Waits up to 50 s for the run; longer runs return 202 and finish in the background.
 */
import { timingSafeEqual } from "node:crypto";
import { isJobName, triggerJob } from "@/server/jobs";
import { apiError, json } from "@/server/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(req: Request, ctx: { params: Promise<{ job: string }> }) {
  const { job } = await ctx.params;
  if (!authorized(req)) return apiError(401, "unauthorized", "Bearer CRON_SECRET required");
  if (!isJobName(job)) return apiError(404, "unknown_job", `Unknown job "${job}"`);

  const run = triggerJob(job, "cron", "cron");
  const done = await Promise.race([run, new Promise<null>((r) => setTimeout(() => r(null), 50_000))]);
  if (!done) return json({ job, status: "running", message: "Run continues in the background; see /api/v1/health" }, { status: 202 });
  return json({ job, runId: done.id, status: done.status, durationMs: done.durationMs, summary: done.summary }, { status: done.status === "failed" ? 500 : 200 });
}
