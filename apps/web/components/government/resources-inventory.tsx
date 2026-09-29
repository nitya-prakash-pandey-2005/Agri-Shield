"use client";

/** Shortage banner + inventory table (available / deployed / locations / modelled need). */
import { Fragment, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertOctagon, AlertTriangle, Boxes, ChevronDown, MapPin, Package } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { EmptyState, Meter, Panel, Skeleton, SourceTag } from "@/components/hud";
import { cn } from "@/lib/utils";
import { useGovInput } from "./scope";
import { ErrorNote, fmtInt, RESOURCE_COLOR, RESOURCE_ICON } from "./ui";

export function ShortageBanner() {
  const scope = useGovInput();
  const q = trpc.government.getShortages.useQuery(scope);
  if (q.isLoading) return <Skeleton className="h-16 mb-5" />;
  if (q.error) return <ErrorNote error={q.error} className="mb-5" />;
  const items = (q.data ?? []).filter((s) => s.level !== "ok").sort((a, b) => (a.level === "critical" ? -1 : 1) - (b.level === "critical" ? -1 : 1));
  if (!items.length) return null;
  return (
    <div className="mb-5 grid gap-2 lg:grid-cols-2">
      <AnimatePresence initial={false}>
        {items.map((s, i) => {
          const crit = s.level === "critical";
          const c = crit ? "#f87171" : "#fbbf24";
          const Icon = crit ? AlertOctagon : AlertTriangle;
          return (
            <motion.div
              key={s.type}
              layout
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ delay: i * 0.05 }}
              className={cn("relative overflow-hidden rounded-xl border px-4 py-3", crit && "animate-[pulse_3s_ease-in-out_infinite]")}
              style={{ borderColor: `${c}55`, background: `linear-gradient(90deg, ${c}1f, ${c}08)` }}
            >
              <div className="flex items-start gap-3">
                <Icon size={16} style={{ color: c }} className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="telemetry text-[10px] font-semibold tracking-widest" style={{ color: c }}>
                      {crit ? "CRITICAL SHORTAGE" : "WARNING"}
                    </span>
                    <SourceTag>Model v2.3.1</SourceTag>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-200">{s.message}</p>
                  <div className="mt-2 flex items-center gap-3">
                    <Meter value={s.availablePct} color={c} className="flex-1" />
                    <span className="telemetry text-[10px] text-slate-400">
                      {s.availablePct}% free · need {fmtInt(s.needed)}
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export function InventoryTable() {
  const scope = useGovInput();
  const q = trpc.government.getResourceInventory.useQuery(scope);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Panel
      title="Inventory"
      subtitle="Quantity available, deployed and held per depot"
      icon={Boxes}
      accent="emerald"
      actions={
        <div className="hidden sm:flex gap-1.5">
          <SourceTag>Agri-SHIELD registry</SourceTag>
          <SourceTag>Model v2.3.1</SourceTag>
        </div>
      }
    >
      {q.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-11" />
          ))}
        </div>
      ) : q.error ? (
        <ErrorNote error={q.error} />
      ) : !q.data?.rows.length ? (
        <EmptyState icon={Package} title="No inventory registered" />
      ) : (
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-xs">
            <thead>
              <tr className="border-b border-white/5 text-left">
                {["Resource", "Total", "Deployed", "Available", "Availability", "Modelled need", "Depots", ""].map((h) => (
                  <th key={h} className="hud-label px-4 py-2 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {q.data.rows.map((r) => {
                const Icon = RESOURCE_ICON[r.type] ?? Package;
                const color = RESOURCE_COLOR[r.type] ?? "#94a3b8";
                const expanded = open === r.type;
                const short = r.needed > r.available;
                const stocked = r.depots.filter((d) => d.quantity > 0).length;
                return (
                  <Fragment key={r.id}>
                    <tr onClick={() => setOpen(expanded ? null : r.type)} className={cn("cursor-pointer border-b border-white/[0.04] transition-colors hover:bg-white/[0.03]", expanded && "bg-white/[0.03]")}>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: `${color}1a` }}>
                            <Icon size={14} style={{ color }} />
                          </span>
                          <div>
                            <div className="font-medium text-slate-100">{r.label}</div>
                            <div className="telemetry text-[10px] text-slate-500">{r.unit}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 telemetry text-slate-200">{fmtInt(r.total)}</td>
                      <td className="px-4 telemetry text-violet-300">{fmtInt(r.deployed)}</td>
                      <td className="px-4 telemetry text-emerald-300">{fmtInt(r.available)}</td>
                      <td className="px-4 w-40">
                        <div className="flex items-center gap-2">
                          <Meter value={r.availablePct} color={r.availablePct < 15 ? "#f87171" : r.availablePct < 35 ? "#fbbf24" : "#10b981"} />
                          <span className="telemetry w-9 text-right text-slate-400">{r.availablePct}%</span>
                        </div>
                      </td>
                      <td className={cn("px-4 telemetry", short ? "text-rose-300" : "text-slate-300")}>
                        {fmtInt(r.needed)}
                        {short && <span className="ml-1.5 text-[10px] text-rose-400">(-{fmtInt(r.needed - r.available)})</span>}
                      </td>
                      <td className="px-4 telemetry text-slate-300">
                        {stocked}/{r.depots.length}
                      </td>
                      <td className="px-4 text-right">
                        <ChevronDown size={14} className={cn("inline text-slate-500 transition-transform", expanded && "rotate-180")} />
                      </td>
                    </tr>
                    <AnimatePresence initial={false}>
                      {expanded && (
                        <tr>
                          <td colSpan={8} className="p-0">
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                              <div className="grid gap-2 bg-[#060a16]/60 px-4 py-3 sm:grid-cols-2 lg:grid-cols-3">
                                {r.depots.map((d) => {
                                  const share = r.total ? (d.quantity / Math.max(1, r.available)) * 100 : 0;
                                  return (
                                    <div key={d.name} className="rounded-lg border border-white/5 px-3 py-2">
                                      <div className="flex items-center gap-1.5 text-slate-200">
                                        <MapPin size={11} style={{ color }} />
                                        <span className="truncate">{d.name}</span>
                                      </div>
                                      <div className="mt-1 flex items-center justify-between telemetry text-[10px] text-slate-400">
                                        <span>
                                          {d.lat.toFixed(3)}, {d.lon.toFixed(3)} · {d.coverageKm} km radius
                                        </span>
                                        <span className={d.quantity ? "text-emerald-300" : "text-rose-300"}>
                                          {fmtInt(d.quantity)} {r.unit}
                                        </span>
                                      </div>
                                      <Meter value={share} color={color} className="mt-1.5 h-1" />
                                    </div>
                                  );
                                })}
                              </div>
                            </motion.div>
                          </td>
                        </tr>
                      )}
                    </AnimatePresence>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
