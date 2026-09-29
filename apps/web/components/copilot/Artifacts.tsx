"use client";

/**
 * Renders Copilot answer artifacts: KPI cards, data tables (clickable rows,
 * CSV export), Recharts line/bar charts and a Leaflet mini map.
 */
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Download, Map as MapIcon } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RiskPill, riskColor } from "@/components/hud";
import type { Artifact, KpiItem, TableColumn } from "@/server/services/copilot/types";

const BaseMap = dynamic(() => import("@/components/maps/BaseMap"), { ssr: false, loading: () => <div className="h-full w-full skeleton rounded-lg" /> });

const TONE: Record<NonNullable<KpiItem["tone"]>, string> = {
  neutral: "text-white",
  good: "text-emerald-300",
  warn: "text-amber-300",
  bad: "text-rose-300",
  critical: "text-violet-300",
};

function Kpis({ items, compact }: { items: KpiItem[]; compact?: boolean }) {
  return (
    <div className={`grid gap-2 ${compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"}`}>
      {items.map((k) => (
        <div key={k.label} className="rounded-lg border border-slate-700/50 bg-slate-900/60 px-3 py-2">
          <div className="hud-label truncate">{k.label}</div>
          <div className={`telemetry text-lg font-semibold leading-tight ${TONE[k.tone ?? "neutral"]}`}>{k.value}</div>
          {k.sub && <div className="truncate text-[10.5px] text-slate-500">{k.sub}</div>}
        </div>
      ))}
    </div>
  );
}

const money = (v: number) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e4 ? `$${(v / 1e3).toFixed(1)}k` : `$${Math.round(v).toLocaleString("en-US")}`);

function Cell({ col, v }: { col: TableColumn; v: string | number | null | undefined }) {
  if (v == null || v === "") return <span className="text-slate-600">—</span>;
  switch (col.format) {
    case "score": {
      const n = Number(v);
      return (
        <span className="telemetry inline-flex min-w-[2.2rem] justify-center rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ color: riskColor(n), background: `${riskColor(n)}1f` }}>
          {n}
        </span>
      );
    }
    case "level":
      return <RiskPill level={String(v)} />;
    case "money":
      return <span className="telemetry">{money(Number(v))}</span>;
    case "number":
      return <span className="telemetry">{typeof v === "number" ? v.toLocaleString("en-US", { maximumFractionDigits: 1 }) : v}</span>;
    case "percent":
      return <span className="telemetry">{v}%</span>;
    default:
      return <>{String(v)}</>;
  }
}

export function toCsv(columns: TableColumn[], rows: Record<string, string | number | null>[]) {
  const esc = (x: unknown) => {
    const s = x == null ? "" : String(x);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map((c) => esc(c.label)).join(","), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(","))].join("\n");
}

export function download(name: string, text: string, type = "text/plain") {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DataTable({ a, compact }: { a: Extract<Artifact, { kind: "table" }>; compact?: boolean }) {
  const router = useRouter();
  const [all, setAll] = useState(false);
  const limit = compact ? 6 : 10;
  const rows = all ? a.rows : a.rows.slice(0, limit);
  const cols = compact ? a.columns.filter((c, i) => i === 0 || !["ref", "district", "source", "type", "last", "state", "level"].includes(c.key)).slice(0, 4) : a.columns;
  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-950/40">
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-semibold text-slate-200">{a.title ?? "Table"}</div>
          {a.note && <div className="truncate text-[10.5px] text-slate-500">{a.note}</div>}
        </div>
        <button
          type="button"
          onClick={() => download(`${(a.title ?? "table").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`, toCsv(a.columns, a.rows), "text/csv")}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[10.5px] text-slate-300 hover:border-cyan-500/50 hover:text-white"
          aria-label="Download table as CSV"
        >
          <Download size={11} /> CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[12px]">
          <thead>
            <tr className="text-slate-500">
              {cols.map((c) => (
                <th key={c.key} className={`whitespace-nowrap px-3 py-1.5 font-medium ${c.align === "right" ? "text-right" : ""}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const href = a.hrefKey ? (r[a.hrefKey] as string | null) : null;
              return (
                <tr
                  key={i}
                  onClick={href ? () => router.push(href) : undefined}
                  onKeyDown={href ? (e) => e.key === "Enter" && router.push(href) : undefined}
                  tabIndex={href ? 0 : undefined}
                  className={`border-t border-slate-800/70 text-slate-300 ${href ? "cursor-pointer hover:bg-cyan-500/5 focus:bg-cyan-500/10 focus:outline-none" : ""}`}
                >
                  {cols.map((c) => (
                    <td key={c.key} className={`px-3 py-1.5 ${c.align === "right" ? "text-right" : ""} ${c.key === "name" || c.key === "title" || c.key === "place" ? "max-w-[220px] truncate text-slate-100" : "whitespace-nowrap"}`}>
                      <Cell col={c} v={r[c.key]} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {a.rows.length > limit && (
        <button type="button" onClick={() => setAll((v) => !v)} className="w-full border-t border-slate-800 py-1.5 text-[11px] text-cyan-300 hover:text-cyan-200">
          {all ? "Show fewer" : `Show all ${a.rows.length} rows`}
        </button>
      )}
    </div>
  );
}

const PALETTE = ["#38bdf8", "#f87171", "#a78bfa", "#fbbf24", "#34d399"];

function Chart({ a, compact }: { a: Extract<Artifact, { kind: "chart" }>; compact?: boolean }) {
  const data = useMemo(() => {
    const xs = Array.from(new Set(a.series.flatMap((s) => s.data.map((d) => d.x))));
    return xs.map((x) => {
      const row: Record<string, string | number | null> = { x: x.length === 10 && /^\d{4}-/.test(x) ? x.slice(5) : x };
      for (const s of a.series) row[s.name] = s.data.find((d) => d.x === x)?.y ?? null;
      return row;
    });
  }, [a]);
  const axis = { stroke: "#475569", fontSize: 10, tickLine: false };
  const tip = { contentStyle: { background: "#0b1224", border: "1px solid #1e293b", borderRadius: 8, fontSize: 11 }, labelStyle: { color: "#cbd5e1" } };
  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-950/40 p-3">
      <div className="mb-2 text-[12px] font-semibold text-slate-200">{a.title}</div>
      <div className={compact ? "h-36" : "h-48"}>
        <ResponsiveContainer width="100%" height="100%">
          {a.type === "bar" ? (
            <BarChart data={data} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="x" {...axis} interval="preserveStartEnd" />
              <YAxis {...axis} tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
              <Tooltip {...tip} cursor={{ fill: "rgba(56,189,248,0.06)" }} formatter={(v: number) => [`${Number(v).toLocaleString("en-US")} ${a.unit ?? ""}`]} />
              {a.series.map((s, i) => (
                <Bar key={s.name} dataKey={s.name} fill={s.color ?? PALETTE[i % PALETTE.length]} radius={[3, 3, 0, 0]} maxBarSize={36} />
              ))}
            </BarChart>
          ) : (
            <LineChart data={data} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="x" {...axis} interval="preserveStartEnd" minTickGap={18} />
              <YAxis {...axis} domain={["auto", "auto"]} />
              <Tooltip {...tip} formatter={(v: number) => [`${v} ${a.unit ?? ""}`]} />
              {a.series.length > 1 && <Legend wrapperStyle={{ fontSize: 10 }} />}
              {a.series.map((s, i) => (
                <Line key={s.name} type="monotone" dataKey={s.name} stroke={s.color ?? PALETTE[i % PALETTE.length]} strokeWidth={2} dot={false} connectNulls />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function MiniMap({ a, compact }: { a: Extract<Artifact, { kind: "map" }>; compact?: boolean }) {
  const router = useRouter();
  const center: [number, number] = a.markers[0] ? [a.markers[0].lat, a.markers[0].lon] : [20, 90];
  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-950/40 p-2">
      <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[12px] font-semibold text-slate-200">
        <MapIcon size={12} className="text-cyan-400" /> {a.title ?? "Map"}
        <span className="ml-auto text-[10.5px] font-normal text-slate-500">{a.markers.length} markers</span>
      </div>
      <div className={`relative overflow-hidden rounded-md ${compact ? "h-44" : "h-60"}`}>
        <BaseMap
          center={center}
          zoom={a.markers.length === 1 ? 9 : 6}
          showBasemapSwitcher={false}
          onReady={(map, L) => {
            const group = L.featureGroup();
            for (const m of a.markers) {
              const color = m.kind === "hazard" ? "#fb923c" : m.score != null ? riskColor(m.score) : "#38bdf8";
              const mk = m.kind === "hazard"
                ? L.circleMarker([m.lat, m.lon], { radius: 8, color, weight: 2, fillOpacity: 0.15, dashArray: "3 3" })
                : L.circleMarker([m.lat, m.lon], { radius: m.kind === "place" ? 8 : 5, color, weight: 1.5, fillColor: color, fillOpacity: 0.75 });
              const label = `${m.label}${m.score != null ? ` · ${m.score}/100` : ""}`;
              mk.bindTooltip(label.replace(/[<>&]/g, ""), { direction: "top" });
              if (m.href) mk.on("click", () => router.push(m.href!));
              mk.addTo(group);
            }
            group.addTo(map);
            if (a.markers.length > 1) map.fitBounds(group.getBounds(), { padding: [18, 18], maxZoom: 10 });
            return () => {
              group.remove();
            };
          }}
        />
      </div>
    </div>
  );
}

export function Artifacts({ items, compact, delay = 0 }: { items: Artifact[]; compact?: boolean; delay?: number }) {
  return (
    <div className="mt-3 space-y-2.5">
      {items.map((a, i) => (
        <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: delay + i * 0.12, duration: 0.3 }}>
          {a.kind === "kpis" && <Kpis items={a.items} compact={compact} />}
          {a.kind === "table" && <DataTable a={a} compact={compact} />}
          {a.kind === "chart" && <Chart a={a} compact={compact} />}
          {a.kind === "map" && a.markers.length > 0 && <MiniMap a={a} compact={compact} />}
        </motion.div>
      ))}
    </div>
  );
}
