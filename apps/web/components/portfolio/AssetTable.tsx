"use client";

/**
 * Paginated, sortable asset table with inline risk pills, 30-day sparklines,
 * 7-day change and value-at-risk. Row click → asset page. Checkbox selection
 * feeds the bulk-action bar.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";
import { RiskPill } from "@/components/hud";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/lib/trpc";
import { Sparkline } from "./charts";
import { TYPE_LABEL, fmtUsd } from "./format";
import { TagPill } from "./ui";

type Rows = RouterOutputs["portfolio"]["listAssets"]["rows"];
export type SortKey = "name" | "composite" | "value" | "var" | "change7d" | "createdAt" | "type" | "country" | "flood" | "salinity" | "drought" | "heat";

export function AssetTable({
  rows,
  sort,
  dir,
  onSort,
  selected,
  onToggle,
  onToggleAll,
  page,
  pages,
  total,
  onPage,
  loading,
}: {
  rows: Rows;
  sort: SortKey;
  dir: "asc" | "desc";
  onSort: (k: SortKey) => void;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (ids: string[], on: boolean) => void;
  page: number;
  pages: number;
  total: number;
  onPage: (p: number) => void;
  loading?: boolean;
}) {
  const router = useRouter();
  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const Th = ({ k, children, className }: { k?: SortKey; children: React.ReactNode; className?: string }) => (
    <th className={cn("whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-slate-500", className)}>
      {k ? (
        <button onClick={() => onSort(k)} className={cn("inline-flex items-center gap-1 hover:text-slate-200", sort === k && "text-sky-300")}>
          {children}
          {sort === k ? dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} /> : <ChevronsUpDown size={11} className="opacity-40" />}
        </button>
      ) : (
        children
      )}
    </th>
  );

  return (
    <div className={cn("transition-opacity", loading && "opacity-60")}>
      <div className="overflow-x-auto rounded-xl border border-white/5">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-white/[0.02]">
            <tr>
              <th className="w-9 px-3">
                <input type="checkbox" aria-label="Select page" checked={allOn} onChange={(e) => onToggleAll(rows.map((r) => r.id), e.target.checked)} className="accent-sky-400" />
              </th>
              <Th k="name">Asset</Th>
              <Th k="type">Type</Th>
              <Th k="composite">Risk</Th>
              <Th>30-day trend</Th>
              <Th k="change7d" className="text-right">
                7-day Δ
              </Th>
              <Th k="value" className="text-right">
                Exposure
              </Th>
              <Th k="var" className="text-right">
                Value-at-risk
              </Th>
              <Th k="country">Location</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {rows.map((r) => (
              <tr
                key={r.id}
                onClick={() => router.push(`/app/portfolio/${r.id}`)}
                className={cn("cursor-pointer transition-colors hover:bg-sky-400/[0.04]", selected.has(r.id) && "bg-sky-400/[0.06]")}
              >
                <td className="px-3" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.id)} onChange={() => onToggle(r.id)} className="accent-sky-400" />
                </td>
                <td className="max-w-[260px] px-3 py-2.5">
                  <Link href={`/app/portfolio/${r.id}`} onClick={(e) => e.stopPropagation()} className="block truncate font-medium text-slate-100 hover:text-sky-300">
                    {r.name}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                    {r.externalRef && <span className="telemetry text-[10px] text-slate-500">{r.externalRef}</span>}
                    {r.tags.slice(0, 2).map((t) => (
                      <TagPill key={t} tag={t} />
                    ))}
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 text-xs text-slate-400">{TYPE_LABEL[r.type] ?? r.type}</td>
                <td className="whitespace-nowrap px-3">
                  <div className="flex items-center gap-2">
                    <span className="telemetry w-7 text-right text-sm text-white">{r.composite}</span>
                    <RiskPill level={r.level} />
                  </div>
                  <div className="mt-0.5 max-w-[190px] truncate text-[10px] text-slate-500" title={r.drivers.join(" · ")}>
                    {sort === "flood" || sort === "salinity" || sort === "drought" || sort === "heat" ? (
                      <span className="text-sky-300">
                        {sort} score {r[sort]}/100
                      </span>
                    ) : r.source === "baseline" ? (
                      "baseline · awaiting live score"
                    ) : (
                      r.drivers[0]
                    )}
                  </div>
                </td>
                <td className="px-3">
                  <Sparkline values={r.spark} />
                </td>
                <td className={cn("telemetry whitespace-nowrap px-3 text-right text-xs", r.change7d == null ? "text-slate-600" : r.change7d > 0 ? "text-rose-400" : r.change7d < 0 ? "text-emerald-400" : "text-slate-400")}>
                  {r.change7d == null ? "—" : `${r.change7d > 0 ? "▲ +" : r.change7d < 0 ? "▼ " : ""}${r.change7d}`}
                </td>
                <td className="telemetry whitespace-nowrap px-3 text-right text-xs text-slate-200">{fmtUsd(r.valueUsd)}</td>
                <td className="telemetry whitespace-nowrap px-3 text-right text-xs text-amber-200/90">{fmtUsd(r.varUsd)}</td>
                <td className="max-w-[160px] truncate px-3 text-xs text-slate-400">{r.districtName ? `${r.districtName}, ${r.country}` : r.country}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>
          {total.toLocaleString()} asset{total === 1 ? "" : "s"} · page {page} of {pages}
        </span>
        <div className="flex items-center gap-1">
          <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded-md border border-white/10 p-1.5 hover:border-sky-400/50 disabled:opacity-30" aria-label="Previous page">
            <ChevronLeft size={14} />
          </button>
          {Array.from({ length: Math.min(5, pages) }, (_, i) => {
            const start = Math.max(1, Math.min(page - 2, pages - 4));
            const p = start + i;
            return (
              <button key={p} onClick={() => onPage(p)} className={cn("telemetry min-w-[28px] rounded-md px-2 py-1", p === page ? "bg-sky-400 text-slate-950" : "hover:bg-white/5")}>
                {p}
              </button>
            );
          })}
          <button disabled={page >= pages} onClick={() => onPage(page + 1)} className="rounded-md border border-white/10 p-1.5 hover:border-sky-400/50 disabled:opacity-30" aria-label="Next page">
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
