"use client";

/** Side-by-side comparison of up to 4 pinned places (explorer.compare). */
import { motion } from "framer-motion";
import { Download, Loader2, X } from "lucide-react";
import type { CropType } from "@agri-shield/types";
import { RiskPill, riskColor } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { trpc } from "@/lib/trpc";
import type { CompareRow, Place } from "./types";

type Row = { label: string; term?: string; help?: string; get: (r: CompareRow) => number | string | null; worst?: "max" | "min"; fmt?: (v: number) => string; risk?: boolean };

const ROWS: Row[] = [
  { label: "Composite risk", term: "composite_score", get: (r) => r.composite, worst: "max", risk: true },
  { label: "Flood score", get: (r) => r.flood, worst: "max", risk: true },
  { label: "Flood chance 72 h", term: "flood_probability", get: (r) => r.floodP72, worst: "max", fmt: (v) => `${Math.round(v * 100)}%` },
  { label: "Salinity score", get: (r) => (r.salinityApplicable ? r.salinity : "n/a"), worst: "max", risk: true },
  { label: "Drought score", get: (r) => r.drought, worst: "max", risk: true },
  { label: "Heat score", get: (r) => r.heat, worst: "max", risk: true },
  { label: "Rain next 72 h", get: (r) => r.rain72hMm, worst: "max", fmt: (v) => `${Math.round(v)} mm` },
  { label: "Rain 14 d (likely / wet case)", term: "ensemble", get: (r) => (r.rain14dP50 == null ? null : `${Math.round(r.rain14dP50)} / ${Math.round(r.rain14dP90 ?? 0)} mm`) },
  { label: "Max heat index", help: "How hot it feels with humidity (NOAA heat index).", get: (r) => r.heatIndexMaxC, worst: "max", fmt: (v) => `${Math.round(v)} °C` },
  { label: "SPI-90", term: "spi", get: (r) => r.spi90, worst: "min", fmt: (v) => v.toFixed(2) },
  { label: "Mean annual rain", get: (r) => r.meanAnnualRainMm, fmt: (v) => `${v.toLocaleString("en-US")} mm` },
  { label: "Rain trend / decade", get: (r) => r.rainTrendPctPerDecade, fmt: (v) => `${v > 0 ? "+" : ""}${v}%` },
  { label: "1-in-10-yr daily rain", term: "return_period", get: (r) => r.rp10DailyMm, worst: "max", fmt: (v) => `${v} mm` },
  { label: "Hot days by 2050", term: "climate_projection", get: (r) => r.hotDays2050Change, worst: "max", fmt: (v) => `${v > 0 ? "+" : ""}${Math.round(v)}/yr` },
  { label: "Rain by 2050", get: (r) => r.rain2050ChangePct, fmt: (v) => `${v > 0 ? "+" : ""}${v}%` },
  { label: "Elevation", term: "elevation", get: (r) => r.elevationM, worst: "min", fmt: (v) => `${Math.round(v)} m` },
  { label: "Coast", get: (r) => (r.coastKm ? `≤ ${r.coastKm} km` : r.coastKm === null ? "> 60 km" : null) },
  { label: "Soil", get: (r) => r.soilTexture },
];

export function ComparePanel({ places, crop, onClose, onRemove, onOpen }: { places: Place[]; crop: CropType; onClose: () => void; onRemove: (i: number) => void; onOpen: (p: Place) => void }) {
  const q = trpc.explorer.compare.useQuery({ places: places.map((p) => ({ lat: p.lat, lon: p.lon, name: p.name ?? null })), crop }, { enabled: places.length > 0, staleTime: 5 * 60_000 });
  const rows = q.data ?? [];

  const exportCsv = () => {
    const head = ["Metric", ...rows.map((r) => r.name)];
    const lines = [head, ...ROWS.map((row) => [row.label, ...rows.map((r) => String(row.get(r) ?? ""))])];
    const csv = lines.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `agri-shield-compare-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const worstIdx = (row: Row) => {
    if (!row.worst || rows.filter((r) => typeof row.get(r) === "number").length < 2) return -1;
    let best = -1;
    let bv = row.worst === "max" ? -Infinity : Infinity;
    rows.forEach((r, i) => {
      const v = row.get(r);
      if (typeof v !== "number") return;
      if ((row.worst === "max" && v > bv) || (row.worst === "min" && v < bv)) {
        bv = v;
        best = i;
      }
    });
    return best;
  };

  return (
    <div className="absolute inset-0 z-[800] grid place-items-center bg-black/60 p-3 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} onClick={(e) => e.stopPropagation()} className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#070c1a] shadow-2xl" role="dialog" aria-label="Compare places">
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <div>
            <h2 className="font-display text-base font-semibold text-white">Compare places</h2>
            <p className="text-[11.5px] text-slate-500">Same engine, same moment — the riskiest value in each row is highlighted.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={exportCsv} disabled={!rows.length} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[12px] text-slate-200 hover:border-emerald-400/40 disabled:opacity-40">
              <Download size={13} /> CSV
            </button>
            <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Close compare">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="overflow-auto p-4">
          {q.isLoading ? (
            <div className="flex items-center gap-2 py-10 text-sm text-slate-400">
              <Loader2 size={16} className="animate-spin" /> Assessing {places.length} places…
            </div>
          ) : q.error ? (
            <div className="py-10 text-sm text-rose-300">{q.error.message}</div>
          ) : (
            <table className="w-full min-w-[560px] text-[12.5px]">
              <thead>
                <tr>
                  <th className="w-44" />
                  {rows.map((r, i) => (
                    <th key={i} className="px-2 pb-3 text-left align-top">
                      <div className="flex items-start justify-between gap-2">
                        <button onClick={() => onOpen({ lat: r.lat, lon: r.lon, name: r.name })} className="min-w-0 text-left">
                          <div className="flex items-center gap-1.5">
                            <span className="grid h-5 w-5 place-items-center rounded-full border border-violet-400 text-[10px] text-violet-200">{i + 1}</span>
                            <span className="truncate font-display text-[13px] font-semibold text-white hover:underline">{r.name}</span>
                          </div>
                          <div className="mt-0.5 text-[10.5px] font-normal text-slate-500">{r.country ?? ""}</div>
                        </button>
                        <button onClick={() => onRemove(i)} className="text-slate-600 hover:text-rose-300" aria-label={`Remove ${r.name}`}>
                          <X size={13} />
                        </button>
                      </div>
                      <div className="mt-1.5">
                        <RiskPill level={r.level} />
                      </div>
                      <div className="mt-1 line-clamp-2 text-[11px] font-normal text-slate-400">{r.topDriver}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => {
                  const wi = worstIdx(row);
                  return (
                    <tr key={row.label} className="border-t border-white/[0.04]">
                      <td className="py-1.5 pr-2 text-slate-400">
                        <span className="inline-flex items-center gap-1">
                          {row.label}
                          {(row.term || row.help) && <Explain term={row.term} text={row.help} title={row.term ? undefined : row.label} />}
                        </span>
                      </td>
                      {rows.map((r, i) => {
                        const v = row.get(r);
                        const txt = v == null ? "–" : typeof v === "number" ? (row.fmt ? row.fmt(v) : String(v)) : v;
                        return (
                          <td key={i} className={`px-2 py-1.5 telemetry ${i === wi ? "rounded bg-rose-500/10 text-rose-200" : "text-slate-200"}`} style={row.risk && typeof v === "number" ? { color: riskColor(v) } : undefined}>
                            {txt}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                <tr className="border-t border-white/[0.04]">
                  <td className="py-1.5 pr-2 align-top text-slate-400">Next 3 months</td>
                  {rows.map((r, i) => (
                    <td key={i} className="px-2 py-1.5 text-[11.5px] text-slate-300">
                      {r.seasonalSummary ?? "–"}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          )}
          <p className="mt-3 text-[11px] text-slate-500">Rows with “–” need the long-term data for that place — open its report and visit the Climate / Outlook tabs to compute it.</p>
        </div>
      </motion.div>
    </div>
  );
}
