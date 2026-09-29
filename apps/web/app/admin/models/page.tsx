"use client";

import { toast } from "sonner";
import { Activity, BrainCircuit, Cpu, Database, RefreshCw, Sprout } from "lucide-react";
import { HudButton, Meter, Panel, SectionHeader, Skeleton, SourceTag, StatTile, EmptyState } from "@/components/hud";
import { DataTable, ErrorNote, KV, StatusBadge, Td, TimeAgo, fmtMs, fmtNum } from "@/components/admin/ui";
import { trpc } from "@/lib/trpc";

type Metric = { key: "auc" | "f1" | "brier" | "rmse" | "r2"; label: string; better: "high" | "low"; max: number; hint: string };
const METRICS: Metric[] = [
  { key: "auc", label: "ROC-AUC", better: "high", max: 1, hint: "Discrimination — probability a flood day ranks above a dry day" },
  { key: "f1", label: "F1", better: "high", max: 1, hint: "Precision/recall balance at the alert threshold" },
  { key: "brier", label: "Brier", better: "low", max: 0.25, hint: "Calibration error of predicted probabilities (lower is better)" },
  { key: "rmse", label: "RMSE (dS/m)", better: "low", max: 2, hint: "EC prediction error (lower is better)" },
  { key: "r2", label: "R²", better: "high", max: 1, hint: "Explained variance of EC predictions" },
];

function metricColor(m: Metric, v: number, minAuc: number) {
  if (m.key === "auc") return v >= minAuc ? "#10b981" : "#f43f5e";
  const norm = m.better === "high" ? v / m.max : 1 - v / m.max;
  return norm >= 0.8 ? "#10b981" : norm >= 0.6 ? "#f59e0b" : "#f43f5e";
}

function PsiMeter({ psi }: { psi: number | undefined }) {
  const max = 0.4;
  const pos = psi == null ? null : Math.min(100, (psi / max) * 100);
  return (
    <div>
      <div className="relative h-2 w-full overflow-hidden rounded-full">
        <div className="absolute inset-y-0 left-0 bg-emerald-500/40" style={{ width: `${(0.1 / max) * 100}%` }} />
        <div className="absolute inset-y-0 bg-amber-500/40" style={{ left: `${(0.1 / max) * 100}%`, width: `${(0.15 / max) * 100}%` }} />
        <div className="absolute inset-y-0 right-0 bg-rose-500/40" style={{ left: `${(0.25 / max) * 100}%` }} />
        {pos != null && <div className="absolute -top-0.5 h-3 w-1 rounded bg-white shadow-[0_0_8px_white]" style={{ left: `calc(${pos}% - 2px)` }} />}
      </div>
      <div className="mt-1 flex justify-between text-[9.5px] telemetry text-slate-500">
        <span>0</span>
        <span>0.10</span>
        <span>0.25</span>
        <span>0.40+</span>
      </div>
    </div>
  );
}

export default function ModelsPage() {
  const utils = trpc.useUtils();
  const q = trpc.admin.models.useQuery(undefined, { refetchInterval: 60_000 });
  const retrain = trpc.admin.retrain.useMutation({
    onSuccess: (run) => {
      const fn = run.status === "failed" ? toast.error : run.status === "skipped" ? toast.warning : toast.success;
      fn(`Retrain ${run.status}`, { description: run.summary });
      utils.admin.models.invalidate();
      utils.admin.jobs.invalidate();
    },
    onError: (e) => toast.error("Retrain failed", { description: e.message }),
  });
  const d = q.data;

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="ML OPERATIONS"
        title="Model Performance & Drift"
        description="Live metrics reported by the FastAPI inference service. Population Stability Index (PSI) tracks input drift; the weekly retrain promotes a candidate only if validation AUC improves."
        actions={
          <HudButton onClick={() => retrain.mutate()} disabled={retrain.isPending} className="bg-violet-500 hover:bg-violet-400 text-white shadow-[0_0_24px_-6px_rgba(139,92,246,0.8)]">
            <RefreshCw size={14} className={retrain.isPending ? "animate-spin" : ""} />
            {retrain.isPending ? "Retraining…" : "Retrain now"}
          </HudButton>
        }
      />
      <ErrorNote error={q.error} />

      {retrain.data && (
        <Panel title="Last retrain result" icon={Cpu} accent="violet">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <StatusBadge status={retrain.data.status} />
            <span className="text-slate-300">{retrain.data.summary}</span>
            {"durationMs" in retrain.data && <span className="telemetry text-xs text-slate-500">{fmtMs(retrain.data.durationMs)}</span>}
          </div>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Inference service" subtitle="apps/ml-api · FastAPI" icon={Activity} accent={d?.mlApi.up ? "emerald" : "red"} live={d?.mlApi.up}>
          {!d ? (
            <Skeleton className="h-28" />
          ) : (
            <div>
              <div className="mb-3 flex items-center gap-2">
                <StatusBadge status={d.mlApi.up ? "up" : "down"} pulse={d.mlApi.up} />
                <SourceTag>{d.source}</SourceTag>
              </div>
              <KV k="Endpoint" v={<span className="break-all">{d.mlApi.url}</span>} mono />
              <KV k="Latency" v={fmtMs(d.mlApi.latencyMs)} mono />
              <KV k="Version" v={d.mlApi.version ?? "—"} mono />
              {!d.mlApi.up && (
                <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  Fallback active — the web tier is serving physics-formula risk scores from live Open-Meteo data until the ML API is reachable.
                </div>
              )}
            </div>
          )}
        </Panel>
        <div className="grid grid-cols-2 gap-4 lg:col-span-2">
          <StatTile label="Farmer actions logged" value={d?.feedback.actions ?? 0} icon={Sprout} accent="emerald" />
          <StatTile label="Labelled outcomes" value={d?.feedback.labelled ?? 0} icon={Database} accent="cyan" />
          <StatTile label="Mean crop saved" value={d?.feedback.meanCropSavedPct ?? 0} decimals={1} suffix="%" icon={Sprout} accent="green" hint="Average crop_saved_pct over labelled farmer actions" />
          <StatTile label="Models deployed" value={d?.models.length ?? 0} icon={BrainCircuit} accent="violet" />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {!d
          ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-72" />)
          : d.models.map((m) => {
              const present = METRICS.filter((x) => typeof m[x.key] === "number");
              return (
                <Panel
                  key={m.name}
                  title={m.name}
                  subtitle={
                    <span className="telemetry">
                      {m.version} · trained <TimeAgo date={m.trained_at} />
                    </span>
                  }
                  icon={BrainCircuit}
                  accent="violet"
                  sweep
                  actions={<StatusBadge status={m.drift} label={`drift ${m.drift}`} />}
                >
                  <div className="space-y-3">
                    {present.length === 0 && <div className="text-xs text-slate-500">Simulation model — no supervised accuracy metrics.</div>}
                    {present.map((x) => {
                      const v = m[x.key] as number;
                      const color = metricColor(x, v, d.thresholds.minAuc);
                      const pct = x.better === "high" ? (v / x.max) * 100 : Math.max(4, (1 - v / x.max) * 100);
                      return (
                        <div key={x.key} title={x.hint}>
                          <div className="mb-1 flex items-baseline justify-between">
                            <span className="hud-label">{x.label}</span>
                            <span className="telemetry text-sm font-semibold" style={{ color }}>
                              {v.toFixed(3)}
                              {x.key === "auc" && <span className="ml-1 text-[10px] text-slate-500">min {d.thresholds.minAuc}</span>}
                            </span>
                          </div>
                          <Meter value={pct} color={color} />
                        </div>
                      );
                    })}
                    <div className="pt-1">
                      <div className="mb-1 flex items-baseline justify-between">
                        <span className="hud-label">Input drift (PSI)</span>
                        <span className="telemetry text-sm text-slate-200">{m.drift_psi != null ? m.drift_psi.toFixed(3) : "—"}</span>
                      </div>
                      <PsiMeter psi={m.drift_psi} />
                    </div>
                    <div className="flex items-center justify-between border-t border-white/5 pt-2 text-[11px] text-slate-400">
                      <span>Training samples</span>
                      <span className="telemetry text-slate-200">{fmtNum(m.samples)}</span>
                    </div>
                  </div>
                </Panel>
              );
            })}
      </div>

      <Panel title="Retrain history" subtitle="POST /api/ml/retrain · weekly Sunday 03:00 UTC + manual" icon={RefreshCw} accent="violet">
        {!d ? (
          <Skeleton className="h-24" />
        ) : d.retrainRuns.length === 0 ? (
          <EmptyState icon={RefreshCw} title="No retrain runs yet">
            The scheduler runs weekly; use “Retrain now” to trigger one.
          </EmptyState>
        ) : (
          <DataTable head={["Started", "Trigger", "By", "Status", "Duration", "Summary"]}>
            {d.retrainRuns.map((r) => (
              <tr key={r.id}>
                <Td>
                  <TimeAgo date={r.startedAt} />
                </Td>
                <Td mono>{r.trigger}</Td>
                <Td>{r.triggeredBy}</Td>
                <Td>
                  <StatusBadge status={r.status} />
                </Td>
                <Td mono>{fmtMs(r.durationMs)}</Td>
                <Td className="max-w-[420px] text-slate-400">{r.summary}</Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
      <p className="text-[11px] text-slate-500">
        PSI bands: &lt; {d?.thresholds.psiModerate ?? 0.1} stable · {d?.thresholds.psiModerate ?? 0.1}–{d?.thresholds.psiSignificant ?? 0.25} moderate (monitor) · &gt; {d?.thresholds.psiSignificant ?? 0.25} significant (retrain).
      </p>
    </div>
  );
}
