/**
 * PORTFOLIO_MONITOR job (every 60 min, +60 s after boot).
 *
 * For every workspace with active assets:
 *   1. re-score all active assets with the batched location engine (assessMany)
 *   2. evaluate the workspace's alert rules and dispatch firings
 *      (in-app notification, e-mail / SMS / WhatsApp, signed webhook, Slack)
 *   3. publish realtime `portfolio.rescored` / `rule.fired` to `ws:<orgId>`
 *   4. on Mondays (UTC) send the weekly digest notification once per ISO week
 */
import type { JobResult } from "./registry";
import { evaluateWorkspaceRules, monitoredWorkspaces, rescoreWorkspace, sendWeeklyDigest } from "../services/portfolio";

export async function portfolioMonitor(opts: { triggeredBy?: string; workspaceIds?: string[]; now?: Date } = {}): Promise<JobResult> {
  const now = opts.now ?? new Date();
  const workspaces = opts.workspaceIds ?? monitoredWorkspaces();
  const per: Record<string, { assets: number; live: number; fallback: number; firings: number; digest: boolean; error?: string }> = {};
  let assets = 0;
  let firings = 0;
  let failed = 0;
  for (const ws of workspaces) {
    try {
      const r = await rescoreWorkspace(ws, { trigger: "monitor", by: opts.triggeredBy ?? "system" });
      const rules = await evaluateWorkspaceRules(ws, { trigger: "monitor", by: "system" });
      const fired = rules.filter((x) => x.fired).length;
      const digest = now.getUTCDay() === 1 ? sendWeeklyDigest(ws) : false;
      per[ws] = { assets: r.count, live: r.live, fallback: r.fallback, firings: fired, digest };
      assets += r.count;
      firings += fired;
    } catch (e) {
      failed++;
      per[ws] = { assets: 0, live: 0, fallback: 0, firings: 0, digest: false, error: (e as Error).message };
    }
  }
  return {
    status: failed === 0 ? "success" : failed < workspaces.length ? "partial" : "failed",
    summary: `Re-scored ${assets} assets in ${workspaces.length} workspace(s); ${firings} rule firing(s)${failed ? `; ${failed} workspace(s) failed` : ""}`,
    output: { workspaces: per },
  };
}
