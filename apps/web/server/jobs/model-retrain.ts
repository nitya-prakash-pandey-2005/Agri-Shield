/**
 * MODEL_RETRAIN (spec §6) — outcome feedback loop.
 * Collects farmer actions + outcomes since the last run and POSTs them to the
 * ML service (`POST /api/ml/retrain`). The ML service fine-tunes, validates
 * and promotes only if AUC improves; we record whatever it reports.
 */
import { getStore } from "../data/store";
import { fetchJson } from "../live/http";
import { ML_API_URL, getModelMetrics, mlHealth } from "../ml-client";
import { lastSuccess, type JobResult } from "./registry";

/** Shape returned by apps/ml-api models/registry.py `retrain()` (champion/challenger). */
interface RetrainResponse {
  decision?: "promoted" | "kept_deployed" | "skipped";
  reason?: string;
  duration_s?: number;
  flood?: { candidate_version?: string; candidate_auc?: number; deployed_version?: string | null; deployed_auc?: number | null; promoted?: boolean };
  salinity?: { candidate_version?: string; candidate_rmse?: number; deployed_version?: string | null; deployed_rmse?: number | null; promoted?: boolean };
  [k: string]: unknown;
}

export async function modelRetrain(opts: { force?: boolean; triggeredBy?: string } = {}): Promise<JobResult> {
  const store = getStore();
  const since = lastSuccess("model-retrain")?.startedAt ?? new Date(Date.now() - 7 * 86_400_000);
  const actions = store.farmerActions.filter((a) => a.actionDate >= since);
  const withOutcome = actions.filter((a) => a.cropSavedPct != null);
  const meanSaved = withOutcome.length ? withOutcome.reduce((s, a) => s + (a.cropSavedPct ?? 0), 0) / withOutcome.length : null;

  const feedback = {
    since: since.toISOString(),
    samples: actions.length,
    labelled: withOutcome.length,
    mean_crop_saved_pct: meanSaved == null ? null : Math.round(meanSaved * 10) / 10,
    outcomes: withOutcome.slice(0, 500).map((a) => {
      const alert = a.alertId ? store.alerts.find((x) => x.id === a.alertId) : null;
      return {
        alert_type: alert?.alertType ?? null,
        severity: alert?.severity ?? null,
        predicted_probability: alert?.predictedImpact.probability ?? null,
        action: a.actionTaken,
        crop_saved_pct: a.cropSavedPct,
        lead_time_h: alert ? Math.round((a.actionDate.getTime() - alert.createdAt.getTime()) / 3_600_000) : null,
      };
    }),
  };

  const health = await mlHealth();
  if (!health.up) {
    return {
      status: "skipped",
      summary: `ML API unreachable at ${ML_API_URL} — ${actions.length} new outcome(s) held for next run`,
      output: { mlApi: ML_API_URL, samples: actions.length, labelled: withOutcome.length },
    };
  }

  const before = await getModelMetrics();
  let response: RetrainResponse;
  try {
    response = await fetchJson<RetrainResponse>(`${ML_API_URL}/api/ml/retrain`, 120_000, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(process.env.ML_API_KEY ? { "X-API-Key": process.env.ML_API_KEY } : {}) },
      body: JSON.stringify({ reason: opts.triggeredBy ? `manual:${opts.triggeredBy}` : "weekly-schedule", force: !!opts.force, feedback }),
    });
  } catch (e) {
    return { status: "failed", summary: `Retrain request failed: ${(e as Error).message}`, output: { samples: actions.length } };
  }
  const after = await getModelMetrics();
  const versions = (m: typeof before) => m.models.map((x) => `${x.name}@${x.version}`).join(", ");
  if (response.decision === "skipped") {
    return { status: "skipped", summary: `Retrain skipped by ML service: ${response.reason ?? "busy"}`, output: { response } };
  }
  const f = response.flood;
  const sal = response.salinity;
  const parts = [
    f ? `flood ${f.promoted ? "promoted" : "kept"} (AUC ${f.candidate_auc ?? "?"} vs ${f.deployed_auc ?? "n/a"})` : null,
    sal ? `salinity ${sal.promoted ? "promoted" : "kept"} (RMSE ${sal.candidate_rmse ?? "?"} vs ${sal.deployed_rmse ?? "n/a"})` : null,
  ].filter(Boolean);

  return {
    status: "success",
    summary: `Retrain on ${actions.length} new outcome(s) in ${response.duration_s ?? "?"}s — ${parts.join("; ") || response.decision}; now serving ${versions(after)}`,
    output: { samples: actions.length, labelled: withOutcome.length, response, before: before.models, after: after.models, metricsSource: after.source },
  };
}
