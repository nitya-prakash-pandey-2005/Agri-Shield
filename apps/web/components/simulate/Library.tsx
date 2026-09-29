"use client";

/**
 * Scenario library — every saved simulation for the workspace; tick 2–3 to
 * compare side by side, export the comparison, re-open or raise an incident.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CloudSun, Columns3, Droplets, FileDown, FileText, FolderOpen, Library as LibIcon, Play, Siren, Tornado, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, Panel, Skeleton } from "@/components/hud";
import { axisProps, Btn, ErrorBox, num, tooltipStyle, usd, VIZ, WhatThisMeans } from "@/components/insurance/kit";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { exportCsv, exportPdf, ha, people } from "./common";

type Saved = RouterOutputs["simulate"]["library"]["list"][number];
const KIND_ICON = { flood: Droplets, cyclone: Tornado, drought: CloudSun } as const;
const KIND_COLOR = { flood: "text-cyan-300", cyclone: "text-violet-300", drought: "text-amber-300" } as const;
const SERIES = [VIZ.s1, VIZ.s2, VIZ.s3];

export default function Library({ onOpen }: { onOpen: (s: Saved) => void }) {
  const list = trpc.simulate.library.list.useQuery();
  const utils = trpc.useUtils();
  const remove = trpc.simulate.library.remove.useMutation({ onSuccess: () => (toast.success("Scenario deleted"), void utils.simulate.library.list.invalidate()), onError: (e) => toast.error(e.message) });
  const [sel, setSel] = useState<string[]>([]);
  const items = list.data ?? [];
  const chosen = useMemo(() => sel.map((id) => items.find((x) => x.id === id)).filter(Boolean) as Saved[], [sel, items]);

  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 3 ? [...s.slice(1), id] : [...s, id]));

  const metrics: { key: keyof Saved["summary"]; label: string; fmt: (v: number | null) => string; lowerBetter: boolean }[] = [
    { key: "lossUsd", label: "Loss", fmt: (v) => usd(v ?? 0), lowerBetter: true },
    { key: "assetsHit", label: "Assets hit", fmt: (v) => num(v ?? 0), lowerBetter: true },
    { key: "exposureUsd", label: "Exposure hit / revenue", fmt: (v) => usd(v ?? 0), lowerBetter: true },
    { key: "areaHa", label: "Area", fmt: (v) => ha(v), lowerBetter: true },
    { key: "households", label: "Households", fmt: (v) => num(v ?? 0), lowerBetter: true },
    { key: "people", label: "People (est.)", fmt: (v) => people(v), lowerBetter: true },
    { key: "insuredLossUsd", label: "Insured loss", fmt: (v) => usd(v ?? 0), lowerBetter: true },
    { key: "elUpliftUsd", label: "Extra credit loss", fmt: (v) => usd(v ?? 0), lowerBetter: true },
  ];
  // normalised to the worst scenario per metric (100 = worst) so different units share one axis
  const norm = (f: (c: Saved) => number) => {
    const mx = Math.max(1e-9, ...chosen.map(f));
    return Object.fromEntries(chosen.map((c) => [c.id, Math.round((f(c) / mx) * 100)]));
  };
  const chart = [
    { m: "Loss", ...norm((c) => c.summary.lossUsd) },
    { m: "Assets hit", ...norm((c) => c.summary.assetsHit) },
    { m: "Households", ...norm((c) => c.summary.households) },
    { m: "Insured loss", ...norm((c) => c.summary.insuredLossUsd) },
    { m: "Area", ...norm((c) => c.summary.areaHa ?? 0) },
  ];
  const worst = chosen.length > 1 ? chosen.reduce((a, b) => (b.summary.lossUsd > a.summary.lossUsd ? b : a)) : null;

  const csvRows = () =>
    chosen.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      created: new Date(c.createdAt).toISOString(),
      by: c.createdByName,
      headline: c.summary.headline,
      loss_usd: c.summary.lossUsd,
      assets_hit: c.summary.assetsHit,
      exposure_usd: c.summary.exposureUsd,
      area_ha: c.summary.areaHa ?? "",
      households: c.summary.households,
      people: c.summary.people ?? "",
      insured_loss_usd: c.summary.insuredLossUsd,
      el_uplift_usd: c.summary.elUpliftUsd,
      notes: c.notes,
    }));

  if (list.isLoading) return <Skeleton className="h-[400px]" />;
  return (
    <div className="space-y-4">
      <ErrorBox error={list.error} onRetry={() => list.refetch()} />
      {!items.length ? (
        <Panel title="Scenario library" icon={LibIcon} accent="cyan">
          <EmptyState icon={FolderOpen} title="No saved scenarios yet">
            Run a flood, cyclone or drought simulation and press <b>Save scenario</b>. Saved scenarios are shared with everyone in this workspace — compare up to three side by side here.
          </EmptyState>
        </Panel>
      ) : (
        <>
          <Panel title="Scenario library" icon={LibIcon} accent="cyan" subtitle={`${items.length} saved · tick up to 3 to compare`} bodyClassName="px-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[12.5px]">
                <thead className="text-left text-[10.5px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="w-10 px-4 py-2" />
                    <th className="px-2 py-2">Scenario</th>
                    <th className="px-2 py-2 text-right">Loss</th>
                    <th className="px-2 py-2 text-right">Assets</th>
                    <th className="px-2 py-2 text-right">Households</th>
                    <th className="px-2 py-2">Saved</th>
                    <th className="px-4 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((s) => {
                    const Icon = KIND_ICON[s.kind];
                    return (
                      <tr key={s.id} className={`border-t border-slate-800/70 ${sel.includes(s.id) ? "bg-cyan-400/[0.05]" : ""}`}>
                        <td className="px-4">
                          <input type="checkbox" checked={sel.includes(s.id)} onChange={() => toggle(s.id)} className="accent-cyan-400" aria-label={`Compare ${s.name}`} />
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1.5 text-slate-100">
                            <Icon size={13} className={KIND_COLOR[s.kind]} /> {s.name}
                          </div>
                          <div className="text-[11px] text-slate-500">{s.summary.headline}</div>
                          {s.notes && <div className="text-[11px] italic text-slate-500">“{s.notes}”</div>}
                        </td>
                        <td className="px-2 text-right telemetry text-white">{usd(s.summary.lossUsd)}</td>
                        <td className="px-2 text-right telemetry text-slate-300">{s.summary.assetsHit}</td>
                        <td className="px-2 text-right telemetry text-slate-300">{num(s.summary.households)}</td>
                        <td className="px-2 text-[11px] text-slate-400">
                          {new Date(s.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} · {s.createdByName}
                        </td>
                        <td className="px-4 text-right">
                          <div className="inline-flex gap-1">
                            <button onClick={() => onOpen(s)} className="rounded-md p-1.5 text-slate-300 hover:bg-white/5 hover:text-white" title="Re-run & open">
                              <Play size={14} />
                            </button>
                            <Link href={`/app/incidents?new=1&title=${encodeURIComponent(s.name)}&summary=${encodeURIComponent(s.summary.headline)}&source=simulation`} className="rounded-md p-1.5 text-rose-300 hover:bg-rose-500/10" title="Create incident">
                              <Siren size={14} />
                            </Link>
                            <button onClick={() => confirm(`Delete “${s.name}”?`) && remove.mutate({ id: s.id })} className="rounded-md p-1.5 text-slate-500 hover:bg-white/5 hover:text-rose-300" title="Delete">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          {chosen.length >= 2 ? (
            <Panel
              title="Compare"
              icon={Columns3}
              accent="cyan"
              subtitle={`${chosen.length} scenarios`}
              actions={
                <div className="flex gap-1.5">
                  <Btn variant="outline" onClick={() => exportCsv("scenario-comparison.csv", csvRows())}>
                    <FileDown size={13} /> CSV
                  </Btn>
                  <Btn
                    variant="outline"
                    onClick={() =>
                      exportPdf(
                        {
                          title: "Scenario comparison",
                          subtitle: chosen.map((c) => c.name).join("  vs  "),
                          narrative: worst ? `Worst case by loss: ${worst.name} (${usd(worst.summary.lossUsd)}). ${chosen.map((c) => `${c.name}: ${c.summary.headline}.`).join(" ")}` : "",
                          kpis: metrics.map((m) => [m.label, chosen.map((c) => m.fmt(c.summary[m.key] as number | null)).join("  |  ")]),
                          table: { head: ["Scenario", "Type", "Saved by", "Notes"], body: chosen.map((c) => [c.name, c.kind, c.createdByName, c.notes || "-"]) },
                          caveats: ["Scenarios are screening simulations; see each scenario's own caveats (bathtub flooding, parametric winds, seasonal Ky)."],
                          sources: [{ label: "Agri-SHIELD Simulation Lab" }],
                        },
                        "scenario-comparison.pdf"
                      )
                    }
                  >
                    <FileText size={13} /> PDF
                  </Btn>
                </div>
              }
            >
              <div className={`grid gap-3 ${chosen.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
                {chosen.map((c, i) => {
                  const Icon = KIND_ICON[c.kind];
                  return (
                    <div key={c.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3" style={{ boxShadow: `inset 3px 0 0 ${SERIES[i]}` }}>
                      <div className="mb-2 flex items-center gap-1.5 font-display text-[13px] text-white">
                        <Icon size={14} className={KIND_COLOR[c.kind]} /> {c.name}
                      </div>
                      <dl className="space-y-1 text-[12px]">
                        {metrics.map((m) => {
                          const v = c.summary[m.key] as number | null;
                          const vals = chosen.map((x) => (x.summary[m.key] as number | null) ?? 0);
                          const isWorst = chosen.length > 1 && v != null && v === Math.max(...vals) && v > 0;
                          return (
                            <div key={m.key} className="flex justify-between gap-2">
                              <dt className="text-slate-400">{m.label}</dt>
                              <dd className={`telemetry ${isWorst ? "text-rose-300" : "text-slate-100"}`}>{m.fmt(v)}</dd>
                            </div>
                          );
                        })}
                        {c.summary.metrics.map((m) => (
                          <div key={m.label} className="flex justify-between gap-2 text-[11px]">
                            <dt className="text-slate-500">{m.label}</dt>
                            <dd className="truncate text-right text-slate-300">{m.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 text-[11px] text-slate-500">Relative severity per metric — 100 = the worst of the selected scenarios.</div>
              <div className="mt-1 h-[220px]">
                <ResponsiveContainer>
                  <BarChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                    <CartesianGrid stroke={VIZ.grid} vertical={false} />
                    <XAxis dataKey="m" {...axisProps} />
                    <YAxis {...axisProps} width={48} domain={[0, 100]} tickFormatter={(v) => `${v}`} />
                    <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v} (100 = worst)`]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {chosen.map((c, i) => (
                      <Bar key={c.id} dataKey={c.id} name={c.name} fill={SERIES[i]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {worst && (
                <WhatThisMeans tone="amber" className="mt-3">
                  <b>{worst.name}</b> is the most damaging of these ({usd(worst.summary.lossUsd)}, {worst.summary.assetsHit} assets). Use it as the planning case for reserves, pre-positioning or loan-book provisioning — and consider creating an incident playbook from it.
                </WhatThisMeans>
              )}
            </Panel>
          ) : (
            <p className="text-[12px] text-slate-500">Tick two or three scenarios to compare them side by side.</p>
          )}
        </>
      )}
    </div>
  );
}
