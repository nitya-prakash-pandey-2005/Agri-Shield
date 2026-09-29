"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertOctagon, CloudRain, Droplets, Radar, RotateCcw, Sun, Tornado, Waves, type LucideIcon } from "lucide-react";
import { HudButton, LiveDot, Panel, RiskPill, SectionHeader, Skeleton } from "@/components/hud";
import { DataTable, ErrorNote, StatusBadge, Td, TimeAgo, chartTooltip } from "@/components/admin/ui";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type Mode = "live" | "monsoon_surge" | "cyclone_landfall" | "dry_season_salinity";
type Snap = RouterOutputs["admin"]["scenario"]["districts"][number];
type Result = RouterOutputs["admin"]["setScenario"];

const MODES: { mode: Mode; label: string; icon: LucideIcon; color: string; desc: string }[] = [
  { mode: "live", label: "Live observations", icon: Radar, color: "#10b981", desc: "Pure Open-Meteo forecast, GloFAS discharge and marine sea level — no injected stress. The production setting." },
  { mode: "monsoon_surge", label: "Monsoon surge", icon: CloudRain, color: "#38bdf8", desc: "+70 / 130 / 190 mm rain over 24 / 48 / 72 h, wetter soils and a river-discharge surge — all weighted by each district's flood exposure × intensity." },
  { mode: "cyclone_landfall", label: "Cyclone landfall", icon: Tornado, color: "#f43f5e", desc: "Monsoon-style rain boosted 1.3× for coastal districts (< 40 km from sea), plus a storm surge of +1.2 m × intensity on sea level." },
  { mode: "dry_season_salinity", label: "Dry-season salinity", icon: Sun, color: "#f59e0b", desc: "Salinity season shifted to its peak month with no rainfall dilution (5 mm / 30 d) — models saltwater creep up tidal rivers." },
];

function Delta({ v, suffix = "" }: { v: number; suffix?: string }) {
  const c = v > 0.5 ? "text-rose-400" : v < -0.5 ? "text-emerald-400" : "text-slate-500";
  return <span className={cn("telemetry", c)}>{`${v > 0 ? "+" : ""}${Math.round(v)}${suffix}`}</span>;
}

export default function ScenarioPage() {
  const utils = trpc.useUtils();
  const q = trpc.admin.scenario.useQuery(undefined, { refetchInterval: 30_000 });
  const [mode, setMode] = useState<Mode>("live");
  const [intensity, setIntensity] = useState(70);
  const [runScan, setRunScan] = useState(true);
  const [result, setResult] = useState<Result | null>(null);
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    if (q.data && !result) {
      setMode(q.data.scenario.mode as Mode);
      setIntensity(Math.round(q.data.scenario.intensity * 100));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data?.scenario.mode]);

  const apply = trpc.admin.setScenario.useMutation({
    onSuccess: (r) => {
      setResult(r);
      toast.success(`Scenario → ${r.scenario.mode}`, { description: r.scan ? r.scan.summary : "Live risk recomputed for all districts" });
      utils.admin.invalidate();
      utils.public.invalidate();
    },
    onError: (e) => toast.error("Scenario switch failed", { description: e.message }),
  });
  const reset = trpc.admin.resetDemo.useMutation({
    onSuccess: () => {
      toast.success("Demo data reset", { description: "Deterministic seed restored; live overlay refreshing." });
      setConfirm("");
      setResult(null);
      utils.invalidate();
    },
    onError: (e) => toast.error("Reset failed", { description: e.message }),
  });

  const rows = useMemo(() => {
    if (!result) return null;
    const before = new Map(result.before.map((b) => [b.id, b]));
    return result.after
      .map((a) => {
        const b = before.get(a.id) as Snap | undefined;
        return { a, b, dF: a.floodRisk - (b?.floodRisk ?? a.floodRisk), dS: a.salinityRisk - (b?.salinityRisk ?? a.salinityRisk) };
      })
      .sort((x, y) => Math.max(Math.abs(y.dF), Math.abs(y.dS)) - Math.max(Math.abs(x.dF), Math.abs(x.dS)));
  }, [result]);

  const current = q.data?.scenario;
  const active = MODES.find((m) => m.mode === current?.mode);

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="DRILLS & DEMOS"
        title="Scenario Control"
        description="Inject a stress event on top of live observations to rehearse the full pipeline — risk scoring, automated alerts, recommendations, escalation and supply-chain webhooks — without waiting for a real storm."
        actions={current && <LiveDot label={current.mode === "live" ? "LIVE" : "DRILL ACTIVE"} color={current.mode === "live" ? "#22c55e" : "#f59e0b"} />}
      />
      <ErrorNote error={q.error ?? apply.error} />

      {current && (
        <div className="hud-panel flex flex-wrap items-center gap-3 p-4 text-sm" style={{ ["--hud-accent" as string]: "139 92 246" }}>
          {active && <active.icon size={18} style={{ color: active.color }} />}
          <span className="text-slate-300">
            Active: <span className="font-semibold text-white">{active?.label ?? current.mode}</span>
            {current.mode !== "live" && <span className="telemetry text-amber-300"> @ {Math.round(current.intensity * 100)}%</span>}
          </span>
          <span className="text-xs text-slate-500">
            set by {current.setBy} · <TimeAgo date={current.setAt} />
          </span>
          <span className="ml-auto text-xs text-slate-500">
            live overlay refreshed <TimeAgo date={q.data?.liveRisk.lastRefresh} />
          </span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {MODES.map((m) => {
          const sel = mode === m.mode;
          return (
            <button
              key={m.mode}
              type="button"
              onClick={() => setMode(m.mode)}
              className={cn("hud-panel p-4 text-left transition-all", sel ? "ring-1" : "opacity-80 hover:opacity-100")}
              style={{ ["--hud-accent" as string]: "139 92 246", ...(sel ? { boxShadow: `0 0 0 1px ${m.color}, 0 0 28px -8px ${m.color}` } : {}) }}
            >
              <div className="flex items-center gap-2">
                <m.icon size={16} style={{ color: m.color }} />
                <span className="font-display text-sm font-semibold text-white">{m.label}</span>
                {current?.mode === m.mode && <StatusBadge status="active" className="ml-auto" />}
              </div>
              <p className="mt-2 text-[11.5px] leading-relaxed text-slate-400">{m.desc}</p>
            </button>
          );
        })}
      </div>

      <Panel title="Apply scenario" icon={Radar} accent="violet">
        <div className="flex flex-col gap-4 md:flex-row md:items-end">
          <label className="flex-1">
            <div className="mb-1 flex justify-between text-xs">
              <span className="hud-label">Intensity</span>
              <span className="telemetry text-violet-300">{mode === "live" ? "n/a" : `${intensity}%`}</span>
            </div>
            <input type="range" min={0} max={100} step={5} value={intensity} disabled={mode === "live"} onChange={(e) => setIntensity(Number(e.target.value))} className="w-full accent-violet-500 disabled:opacity-30" />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={runScan} onChange={(e) => setRunScan(e.target.checked)} className="h-4 w-4 accent-violet-500" />
            Run climate scan after switching
          </label>
          <HudButton onClick={() => apply.mutate({ mode, intensity: intensity / 100, runScan })} disabled={apply.isPending} className="bg-violet-500 text-white hover:bg-violet-400 shadow-[0_0_24px_-6px_rgba(139,92,246,0.8)]">
            <Radar size={14} className={apply.isPending ? "animate-spin" : ""} />
            {apply.isPending ? "Recomputing 22 districts…" : "Apply"}
          </HudButton>
        </div>
      </Panel>

      {result && rows && (
        <div className="grid gap-4 xl:grid-cols-5">
          <Panel title="Impact · before → after" subtitle={`${result.scenario.mode} @ ${Math.round(result.scenario.intensity * 100)}% · sorted by largest change`} icon={Waves} accent="amber" className="xl:col-span-3">
            <DataTable head={["District", "Flood risk", "Δ", "Salinity", "Δ", "Level"]}>
              {rows.map(({ a, b, dF, dS }) => (
                <tr key={a.id}>
                  <Td className="text-slate-100">
                    {a.name} <span className="text-[10px] text-slate-500">{a.country}</span>
                  </Td>
                  <Td mono>
                    {b?.floodRisk ?? "—"} → <span className="text-white">{a.floodRisk}</span>
                  </Td>
                  <Td>
                    <Delta v={dF} />
                  </Td>
                  <Td mono>
                    {b?.salinityRisk ?? "—"} → <span className="text-white">{a.salinityRisk}</span>
                  </Td>
                  <Td>
                    <Delta v={dS} />
                  </Td>
                  <Td>
                    <span className="inline-flex items-center gap-1">
                      {b && b.riskLevel !== a.riskLevel && (
                        <>
                          <RiskPill level={b.riskLevel} className="opacity-50" />→
                        </>
                      )}
                      <RiskPill level={a.riskLevel} />
                    </span>
                  </Td>
                </tr>
              ))}
            </DataTable>
          </Panel>
          <div className="space-y-4 xl:col-span-2">
            <Panel title="Flood-risk delta by district" icon={Droplets} accent="cyan">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rows.map((r) => ({ name: r.a.name, flood: Math.round(r.dF), salinity: Math.round(r.dS) }))} layout="vertical" margin={{ left: 10 }}>
                    <CartesianGrid stroke="rgba(148,163,184,0.08)" horizontal={false} />
                    <XAxis type="number" tick={{ fill: "#64748b", fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} width={80} interval={0} />
                    <Tooltip {...chartTooltip} />
                    <Bar dataKey="flood" name="Δ flood" radius={[0, 3, 3, 0]}>
                      {rows.map((r) => (
                        <Cell key={r.a.id} fill={r.dF >= 0 ? "#f43f5e" : "#10b981"} />
                      ))}
                    </Bar>
                    <Bar dataKey="salinity" name="Δ salinity" fill="#f59e0b" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            {result.scan && (
              <Panel title="Climate scan" icon={Radar} accent="violet">
                <div className="mb-2 flex items-center gap-2">
                  <StatusBadge status={result.scan.status} />
                  <span className="telemetry text-[11px] text-slate-500">{result.scan.id}</span>
                </div>
                <p className="text-[12px] leading-relaxed text-slate-300">{result.scan.summary}</p>
              </Panel>
            )}
          </div>
        </div>
      )}

      {!result && (
        <Panel title="Current district risk" subtitle="Updates when the live overlay refreshes (20 min) or the scenario changes" icon={Waves} accent="violet">
          {!q.data ? (
            <Skeleton className="h-60" />
          ) : (
            <DataTable head={["District", "Flood risk", "P(72h)", "Rain 72h", "Salinity", "EC", "Level", "Source"]}>
              {[...q.data.districts]
                .sort((a, b) => b.floodRisk - a.floodRisk)
                .map((d) => (
                  <tr key={d.id}>
                    <Td className="text-slate-100">
                      {d.name} <span className="text-[10px] text-slate-500">{d.country}</span>
                    </Td>
                    <Td mono>{d.floodRisk}</Td>
                    <Td mono>{Math.round(d.floodProb72h * 100)}%</Td>
                    <Td mono>{d.rainfall72hMm} mm</Td>
                    <Td mono>{d.salinityRisk}</Td>
                    <Td mono>{d.ecCurrent} dS/m</Td>
                    <Td>
                      <RiskPill level={d.riskLevel} />
                    </Td>
                    <Td>
                      <StatusBadge status={d.liveSource === "open-meteo" ? "up" : "skipped"} label={d.liveSource} />
                    </Td>
                  </tr>
                ))}
            </DataTable>
          )}
        </Panel>
      )}

      <Panel title="Danger zone" subtitle="Restore the deterministic demo dataset (users, alerts, audit, flags…)" icon={AlertOctagon} accent="red">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <p className="flex-1 text-[12px] text-slate-400">
            Resets the in-memory store to its seeded state. Job history and the outbox are kept. Type <span className="telemetry text-rose-300">RESET</span> to confirm.
          </p>
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="RESET"
            aria-label="Type RESET to confirm"
            className="h-9 w-32 rounded-lg border border-rose-500/40 bg-slate-950/60 px-3 telemetry text-sm text-rose-200 outline-none focus:border-rose-400"
          />
          <HudButton variant="danger" disabled={confirm !== "RESET" || reset.isPending} onClick={() => reset.mutate({ confirm: "RESET" })}>
            <RotateCcw size={14} className={reset.isPending ? "animate-spin" : ""} /> Reset demo data
          </HudButton>
        </div>
      </Panel>
    </div>
  );
}
