"use client";

/**
 * Widget settings drawer. Every change applies live to the widget behind it
 * (and is undoable); filters, metric, time range and colour thresholds are
 * shown only where the widget kind uses them.
 */
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Chip, Field, Segmented, inputCls } from "@/components/portfolio/ui";
import { trpc } from "@/lib/trpc";
import { ASSET_METRICS, BAR_DIMENSIONS, BAR_MEASURES, KPI_METRICS, SERIES, WIDGETS, describeWidget, type Widget, type WidgetConfig } from "./catalog";
import { Markdown } from "./Markdown";

const FILTERABLE = new Set(["kpi", "gauge", "timeseries", "bar", "map", "table", "hazards"]);
const selectCls = `${inputCls} appearance-none pr-8`;

export function ConfigPanel({ widget, onChange, onClose }: { widget: Widget | null; onChange: (patch: Partial<Widget>, key: string) => void; onClose: () => void }) {
  const facets = trpc.dashboards.facets.useQuery(undefined, { enabled: !!widget, staleTime: 60_000 });
  useEffect(() => {
    if (!widget) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [widget, onClose]);
  if (typeof document === "undefined") return null;

  const c = widget?.config ?? {};
  const setCfg = (patch: Partial<WidgetConfig>, key: string) => widget && onChange({ config: { ...widget.config, ...patch } }, key);
  const toggle = (field: "tags" | "types" | "countries", v: string) => {
    const cur = c.filters?.[field] ?? [];
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    setCfg({ filters: { ...c.filters, [field]: next } }, `filter-${field}`);
  };
  const f = facets.data;
  const kind = widget?.kind;
  const kpiDef = KPI_METRICS[(c.metric ?? "var") as keyof typeof KPI_METRICS];

  return createPortal(
    <AnimatePresence>
      {widget && (
        <motion.aside
          key="cfg"
          role="dialog"
          aria-label={`Configure ${widget.title}`}
          initial={{ x: 420, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 420, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 36 }}
          className="fixed bottom-0 right-0 top-0 z-[950] flex w-full max-w-[400px] flex-col border-l border-sky-400/20 bg-[#070d1c]/95 shadow-[-30px_0_60px_-30px_rgba(0,0,0,0.9)] backdrop-blur-xl"
        >
          <div className="flex items-start justify-between gap-3 border-b border-white/5 px-5 py-4">
            <div className="min-w-0">
              <div className="hud-label text-sky-300/80">Widget settings · {WIDGETS[widget.kind].label}</div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-slate-400">{describeWidget(widget)}</p>
            </div>
            <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Close settings">
              <X size={18} />
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <Field label="Title">
              <input className={inputCls} value={widget.title} maxLength={120} onChange={(e) => onChange({ title: e.target.value }, "title")} />
            </Field>

            {(kind === "kpi" || kind === "gauge") && (
              <>
                <Field label="Metric" hint={kpiDef?.explain}>
                  <select className={selectCls} value={c.metric ?? "var"} onChange={(e) => setCfg({ metric: e.target.value, thresholds: undefined }, "metric")}>
                    {Object.entries(KPI_METRICS)
                      .filter(([, m]) => kind !== "gauge" || m.unit === "pct" || m.unit === "score")
                      .map(([k, m]) => (
                        <option key={k} value={k}>
                          {m.label}
                        </option>
                      ))}
                  </select>
                </Field>
                {c.metric === "rule_firings" && (
                  <Field label="Time range">
                    <Segmented value={String(c.days ?? 7)} options={["1", "7", "30", "90"].map((d) => ({ value: d, label: `${d} d` }))} onChange={(v) => setCfg({ days: Number(v) }, "days")} />
                  </Field>
                )}
                <div>
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">Colour thresholds</div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-[11px] text-amber-300/90">
                      Warning at
                      <input type="number" className={`${inputCls} mt-1`} placeholder={kpiDef && "thresholds" in kpiDef ? String((kpiDef as { thresholds: { warn: number } }).thresholds.warn) : "none"} value={c.thresholds?.warn ?? ""} onChange={(e) => setCfg({ thresholds: { warn: e.target.value === "" ? null : Number(e.target.value), crit: c.thresholds?.crit ?? null } }, "th-warn")} />
                    </label>
                    <label className="text-[11px] text-rose-300/90">
                      Critical at
                      <input type="number" className={`${inputCls} mt-1`} placeholder={kpiDef && "thresholds" in kpiDef ? String((kpiDef as { thresholds: { crit: number } }).thresholds.crit) : "none"} value={c.thresholds?.crit ?? ""} onChange={(e) => setCfg({ thresholds: { warn: c.thresholds?.warn ?? null, crit: e.target.value === "" ? null : Number(e.target.value) } }, "th-crit")} />
                    </label>
                  </div>
                  <p className="mt-1 text-[10.5px] text-slate-500">In the metric's own unit. {kpiDef?.higherIsWorse === false ? "Colours apply when the value falls to or below the limit." : "Colours apply when the value reaches the limit."} Leave empty for the default.</p>
                </div>
              </>
            )}

            {kind === "timeseries" && (
              <>
                <Field label="Series" hint={SERIES[(c.series ?? "composite") as keyof typeof SERIES]?.explain}>
                  <select className={selectCls} value={c.series ?? "composite"} onChange={(e) => setCfg({ series: e.target.value }, "series")}>
                    {Object.entries(SERIES).map(([k, s]) => (
                      <option key={k} value={k}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Time range">
                  <Segmented value={String(c.days ?? 30)} options={["7", "14", "30", "60", "90"].map((d) => ({ value: d, label: `${d} d` }))} onChange={(v) => setCfg({ days: Number(v) }, "days")} />
                </Field>
              </>
            )}

            {kind === "bar" && (
              <>
                <Field label="Group by" hint={BAR_DIMENSIONS[(c.dimension ?? "histogram") as keyof typeof BAR_DIMENSIONS]?.explain}>
                  <select className={selectCls} value={c.dimension ?? "histogram"} onChange={(e) => setCfg({ dimension: e.target.value }, "dimension")}>
                    {Object.entries(BAR_DIMENSIONS).map(([k, d]) => (
                      <option key={k} value={k}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Measure">
                  <select className={selectCls} value={c.measure ?? "count"} onChange={(e) => setCfg({ measure: e.target.value }, "measure")}>
                    {Object.entries(BAR_MEASURES).map(([k, m]) => (
                      <option key={k} value={k}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            )}

            {(kind === "map" || kind === "table") && (
              <Field label={kind === "map" ? "Colour by" : "Rank by"}>
                <select className={selectCls} value={c.metric ?? (kind === "map" ? "composite" : "var")} onChange={(e) => setCfg({ metric: e.target.value }, "metric")}>
                  {Object.entries(ASSET_METRICS).map(([k, m]) => (
                    <option key={k} value={k}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {kind === "map" && (
              <Field label="Display">
                <Segmented value={c.mapMode ?? "points"} options={[{ value: "points", label: "Asset dots" }, { value: "choropleth", label: "District choropleth" }]} onChange={(v) => setCfg({ mapMode: v as "points" | "choropleth" }, "mapMode")} />
              </Field>
            )}
            {kind === "table" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Rows">
                  <select className={selectCls} value={c.limit ?? 8} onChange={(e) => setCfg({ limit: Number(e.target.value) }, "limit")}>
                    {[5, 8, 10, 15, 25].map((n) => (
                      <option key={n} value={n}>
                        Top {n}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Order">
                  <Segmented value={c.sortDir ?? "desc"} options={[{ value: "desc", label: "Highest" }, { value: "asc", label: "Lowest" }]} onChange={(v) => setCfg({ sortDir: v as "asc" | "desc" }, "sortDir")} />
                </Field>
              </div>
            )}
            {(kind === "hazards" || kind === "notifications") && (
              <Field label="Items">
                <select className={selectCls} value={c.limit ?? 6} onChange={(e) => setCfg({ limit: Number(e.target.value) }, "limit")}>
                  {[3, 6, 10, 15].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {kind === "forecast" && (
              <>
                <Field label="Asset" hint="Pick one of your assets, or enter coordinates below.">
                  <select className={selectCls} value={c.assetId ?? ""} onChange={(e) => setCfg({ assetId: e.target.value || null, place: e.target.value ? null : c.place }, "asset")}>
                    <option value="">— Workspace default / custom place —</option>
                    {f?.assets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </Field>
                {!c.assetId && (
                  <div className="grid grid-cols-3 gap-2">
                    <Field label="Lat">
                      <input type="number" step="0.01" className={inputCls} value={c.place?.lat ?? ""} onChange={(e) => setCfg({ place: { lat: Number(e.target.value), lon: c.place?.lon ?? 90, name: c.place?.name ?? "Custom place" } }, "place-lat")} />
                    </Field>
                    <Field label="Lon">
                      <input type="number" step="0.01" className={inputCls} value={c.place?.lon ?? ""} onChange={(e) => setCfg({ place: { lat: c.place?.lat ?? 23, lon: Number(e.target.value), name: c.place?.name ?? "Custom place" } }, "place-lon")} />
                    </Field>
                    <Field label="Name">
                      <input className={inputCls} value={c.place?.name ?? ""} onChange={(e) => setCfg({ place: { lat: c.place?.lat ?? 23, lon: c.place?.lon ?? 90, name: e.target.value } }, "place-name")} />
                    </Field>
                  </div>
                )}
              </>
            )}

            {kind === "note" && (
              <>
                <Field label="Text (Markdown)" hint="**bold**, *italic*, - lists, 1. steps, [links](/app/portfolio)">
                  <textarea className={`${inputCls} min-h-[160px] font-mono text-[12px]`} value={c.text ?? ""} maxLength={4000} onChange={(e) => setCfg({ text: e.target.value }, "text")} />
                </Field>
                <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                  <div className="hud-label mb-2">Preview</div>
                  <Markdown text={c.text ?? ""} />
                </div>
              </>
            )}

            {kind === "explorer" && (
              <Field label="Saved Explorer report" hint={f && !f.reports.length ? "No saved reports yet — assess a place in Risk Explorer and press Share/Save." : undefined}>
                <select className={selectCls} value={c.reportId ?? ""} onChange={(e) => setCfg({ reportId: e.target.value || null }, "report")}>
                  <option value="">— Choose a report —</option>
                  {f?.reports.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {kind === "embed" && (
              <Field label="Shared link" hint="A shared Explorer report (/r/…), a shared dashboard (/d/…), or any https link.">
                <input className={inputCls} placeholder="/r/abc123 or https://…" value={c.url ?? ""} onChange={(e) => setCfg({ url: e.target.value || null }, "url")} />
              </Field>
            )}

            {kind && FILTERABLE.has(kind) && (
              <div className="space-y-3 rounded-xl border border-white/5 bg-white/[0.02] p-3">
                <div className="hud-label text-sky-300/80">Filters</div>
                {!f ? (
                  <div className="text-[11px] text-slate-500">Loading workspace facets…</div>
                ) : (
                  <>
                    <FacetRow label="Asset type" items={f.types.map((t) => ({ value: t.value, label: t.label, count: t.count }))} active={c.filters?.types ?? []} onToggle={(v) => toggle("types", v)} />
                    <FacetRow label="Tag" items={f.tags.slice(0, 24).map((t) => ({ value: t.value, label: t.value, count: t.count }))} active={c.filters?.tags ?? []} onToggle={(v) => toggle("tags", v)} />
                    <FacetRow label="Country" items={f.countries.map((t) => ({ value: t.value, label: t.value, count: t.count }))} active={c.filters?.countries ?? []} onToggle={(v) => toggle("countries", v)} />
                    <p className="text-[10.5px] text-slate-500">Nothing selected = all assets. Within a group, any selected value matches.</p>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="border-t border-white/5 px-5 py-3 text-[11px] text-slate-500">Changes apply instantly · Ctrl+Z to undo</div>
        </motion.aside>
      )}
    </AnimatePresence>,
    document.body
  );
}

function FacetRow({ label, items, active, onToggle }: { label: string; items: { value: string; label: string; count: number }[]; active: string[]; onToggle: (v: string) => void }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="mb-1 text-[10.5px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="flex flex-wrap gap-1">
        {items.map((it) => (
          <Chip key={it.value} active={active.includes(it.value)} onClick={() => onToggle(it.value)}>
            {it.label} <span className="telemetry text-[9.5px] text-slate-500">{it.count}</span>
          </Chip>
        ))}
      </div>
    </div>
  );
}
