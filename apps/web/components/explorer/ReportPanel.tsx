"use client";

/**
 * Slide-over location report: header (place, coordinates, actions, asset/crop
 * selectors) + tabs. Used by the workspace explorer, the public explorer
 * (limited tabs) and the read-only shared report page.
 */
import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import type { AssetType, CropType } from "@agri-shield/types";
import { Check, Copy, FileDown, Link2, Loader2, Pin, PinOff, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { LiveDot, RiskPill } from "@/components/hud";
import { cn } from "@/lib/utils";
import { ASSET_OPTIONS, CROP_OPTIONS, assetGroup, type ReportBundle } from "./types";
import { DroughtHeatTab, FloodTab, ForecastTab, LockedTab, OverviewTab, SalinityTab } from "./tabs-now";
import { ClimateTab, OutlookTab, SoilTab } from "./tabs-climate";
import type { OverlayKey } from "./ExplorerMap";

export type TabKey = "overview" | "forecast" | "flood" | "salinity" | "drought" | "climate" | "outlook" | "soil";
export const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "forecast", label: "Forecast" },
  { key: "flood", label: "Flood" },
  { key: "salinity", label: "Salinity" },
  { key: "drought", label: "Drought & Heat" },
  { key: "climate", label: "Climate history" },
  { key: "outlook", label: "Outlook 2050" },
  { key: "soil", label: "Soil & terrain" },
];

export function TabBody({ tab, b, onOverlay, locked, onCta }: { tab: TabKey; b: ReportBundle; onOverlay?: (k: OverlayKey) => void; locked?: boolean; onCta?: () => void }) {
  if (locked && tab !== "overview" && tab !== "forecast") return <LockedTab title={TABS.find((t) => t.key === tab)?.label ?? "This section"} onCta={onCta ?? (() => undefined)} />;
  switch (tab) {
    case "overview":
      return <OverviewTab b={b} limitedActions={locked} />;
    case "forecast":
      return <ForecastTab b={b} />;
    case "flood":
      return <FloodTab b={b} onOverlay={onOverlay} />;
    case "salinity":
      return <SalinityTab b={b} />;
    case "drought":
      return <DroughtHeatTab b={b} />;
    case "climate":
      return <ClimateTab b={b} />;
    case "outlook":
      return <OutlookTab b={b} />;
    case "soil":
      return <SoilTab b={b} />;
  }
}

export function TabBar({ tab, setTab, lockedTabs }: { tab: TabKey; setTab: (t: TabKey) => void; lockedTabs?: boolean }) {
  return (
    <div role="tablist" aria-label="Report sections" className="flex gap-1 overflow-x-auto border-b border-white/5 px-3 [scrollbar-width:none]">
      {TABS.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={tab === t.key}
          onClick={() => setTab(t.key)}
          className={cn(
            "relative shrink-0 px-2.5 py-2.5 text-[12.5px] transition-colors",
            tab === t.key ? "text-white" : "text-slate-400 hover:text-slate-200",
            lockedTabs && t.key !== "overview" && t.key !== "forecast" && "opacity-60"
          )}
        >
          {t.label}
          {tab === t.key && <motion.span layoutId="explorer-tab" className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-emerald-400" />}
        </button>
      ))}
    </div>
  );
}

export interface PanelActions {
  pinned?: boolean;
  onPin?: () => void;
  onAddPortfolio?: () => void;
  addPortfolioState?: { disabled: boolean; reason?: string; busy?: boolean; done?: boolean };
  onPdf?: () => void;
  pdfBusy?: boolean;
  onShare?: () => void;
  shareBusy?: boolean;
  shareUrl?: string | null;
}

export function ReportHeader({
  b,
  loadingName,
  onClose,
  actions,
  assetType,
  crop,
  setAssetType,
  setCrop,
  extra,
}: {
  b: ReportBundle | null;
  loadingName?: string | null;
  onClose?: () => void;
  actions?: PanelActions;
  assetType?: AssetType;
  crop?: CropType;
  setAssetType?: (a: AssetType) => void;
  setCrop?: (c: CropType) => void;
  extra?: ReactNode;
}) {
  const r = b?.report;
  const name = r?.location.name ?? loadingName ?? (r ? `${r.location.lat.toFixed(3)}, ${r.location.lon.toFixed(3)}` : "Locating…");
  const sub = r ? [r.location.admin1, r.location.country].filter(Boolean).join(", ") : "";
  const copyCoords = () => {
    if (!r) return;
    void navigator.clipboard?.writeText(`${r.location.lat.toFixed(5)}, ${r.location.lon.toFixed(5)}`);
    toast.success("Coordinates copied");
  };
  return (
    <div className="border-b border-white/5 px-4 pb-3 pt-3.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <LiveDot />
            {r && <RiskPill level={r.composite.level} />}
          </div>
          <h2 className="mt-1 truncate font-display text-lg font-semibold text-white" title={r?.location.displayName ?? name}>
            {name}
          </h2>
          <div className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-slate-400">
            {sub && <span>{sub}</span>}
            {r && (
              <button onClick={copyCoords} className="telemetry inline-flex items-center gap-1 hover:text-slate-200" title="Copy coordinates">
                {r.location.lat.toFixed(4)}, {r.location.lon.toFixed(4)} <Copy size={10} />
              </button>
            )}
            {r && <span>· updated {new Date(r.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>}
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Close report">
            <X size={18} />
          </button>
        )}
      </div>
      {(setAssetType || setCrop) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {setAssetType && assetType && (
            <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
              Asset
              <select value={assetType} onChange={(e) => setAssetType(e.target.value as AssetType)} className="rounded-md border border-white/10 bg-slate-900 px-1.5 py-1 text-[12px] text-slate-200 focus:border-emerald-400/50 focus:outline-none">
                {ASSET_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {setCrop && crop && assetType && ["crop", "finance"].includes(assetGroup(assetType)) && (
            <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
              Crop
              <select value={crop} onChange={(e) => setCrop(e.target.value as CropType)} className="rounded-md border border-white/10 bg-slate-900 px-1.5 py-1 text-[12px] text-slate-200 focus:border-emerald-400/50 focus:outline-none">
                {CROP_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {extra}
        </div>
      )}
      {actions && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {actions.onAddPortfolio && (
            <span title={actions.addPortfolioState?.disabled ? actions.addPortfolioState.reason : "Monitor this place with alerts in your portfolio"}>
              <button
                onClick={actions.onAddPortfolio}
                disabled={!r || actions.addPortfolioState?.disabled || actions.addPortfolioState?.busy || actions.addPortfolioState?.done}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-2.5 py-1.5 text-[12px] font-semibold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {actions.addPortfolioState?.busy ? <Loader2 size={13} className="animate-spin" /> : actions.addPortfolioState?.done ? <Check size={13} /> : <Plus size={13} />}
                {actions.addPortfolioState?.done ? "In portfolio" : "Add to portfolio"}
              </button>
            </span>
          )}
          {actions.onPin && (
            <button onClick={actions.onPin} disabled={!r} className={cn("inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] disabled:opacity-40", actions.pinned ? "border-violet-400/40 bg-violet-400/10 text-violet-200" : "border-white/10 text-slate-200 hover:border-violet-400/40")}>
              {actions.pinned ? <PinOff size={13} /> : <Pin size={13} />} {actions.pinned ? "Unpin" : "Compare"}
            </button>
          )}
          {actions.onPdf && (
            <button onClick={actions.onPdf} disabled={!r || actions.pdfBusy} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[12px] text-slate-200 hover:border-emerald-400/40 disabled:opacity-40">
              {actions.pdfBusy ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />} PDF report
            </button>
          )}
          {actions.onShare && (
            <button onClick={actions.onShare} disabled={!r || actions.shareBusy} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[12px] text-slate-200 hover:border-cyan-400/40 disabled:opacity-40">
              {actions.shareBusy ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />} {actions.shareUrl ? "Copy link" : "Share link"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const STEPS = ["Reading 72-hour weather forecast", "Running the flood model", "Checking river discharge (GloFAS)", "51-member ensemble spread", "Seasonal outlook (ECMWF SEAS5)", "Terrain, coast & soil", "Writing the plain-language summary"];

export function ReportLoading() {
  return (
    <div className="space-y-2 p-4">
      <div className="hud-label mb-2">Building the report</div>
      {STEPS.map((s, i) => (
        <motion.div key={s} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.5 }} className="flex items-center gap-2 text-[12.5px] text-slate-300">
          <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.5 }} className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {s}…
        </motion.div>
      ))}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((k) => (
          <div key={k} className="skeleton h-16 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export function SlideOver({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="report"
          initial={{ x: "100%", opacity: 0.6 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "100%", opacity: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 36 }}
          className="absolute inset-x-0 bottom-0 top-[42%] z-[650] flex flex-col overflow-hidden rounded-t-2xl border-t border-white/10 bg-[#070c1a]/97 shadow-[0_-20px_60px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl sm:top-[30%] lg:inset-y-0 lg:left-auto lg:right-0 lg:top-0 lg:w-[min(720px,56vw)] lg:rounded-none lg:border-l lg:border-t-0"
          aria-label="Location report"
        >
          {children}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
