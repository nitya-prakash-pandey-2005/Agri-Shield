"use client";

/**
 * Read-only shared report (/r/<id>): a frozen snapshot of a Risk Explorer
 * report, laid out as one long printable document (all sections, no tabs).
 */
import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import type { AssetType, CropType } from "@agri-shield/types";
import { ArrowRight, FileDown, Loader2, Printer, Shield } from "lucide-react";
import { toast } from "sonner";
import { RiskPill } from "@/components/hud";
import { trpc } from "@/lib/trpc";
import { TabBody, TABS } from "./ReportPanel";
import { assetLabel, cropLabel, type ReportBundle } from "./types";
import { generateExplorerPdf } from "./pdf";

const BaseMap = dynamic(() => import("@/components/maps/BaseMap"), { ssr: false, loading: () => <div className="h-full w-full skeleton" /> });

export function SharedReportView({ id }: { id: string }) {
  const q = trpc.explorer.getSharedReport.useQuery({ id }, { retry: false, staleTime: Infinity, refetchOnWindowFocus: false });
  const [busy, setBusy] = useState(false);

  if (q.isLoading)
    return (
      <div className="grid min-h-screen place-items-center hud-bg text-slate-400">
        <Loader2 className="animate-spin" />
      </div>
    );
  if (q.error || !q.data)
    return (
      <div className="grid min-h-screen place-items-center hud-bg px-6 text-center">
        <div>
          <div className="font-display text-xl font-semibold text-white">Report not found</div>
          <p className="mt-1 text-sm text-slate-400">{q.error?.message ?? "This link is invalid or the report was removed."}</p>
          <Link href="/explore" className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950">
            Check any location for free <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    );

  const s = q.data;
  const b: ReportBundle = {
    report: s.report,
    climate: { history: s.climate, drought: s.drought, ready: true, error: s.climate ? null : "not computed when this snapshot was taken" },
    outlook: { seasonal: s.seasonal, projection: s.projection, applied: null, ready: true, seasonalError: s.seasonal ? null : "not in this snapshot", projectionError: s.projection ? null : "not computed when this snapshot was taken" },
    assetType: s.assetType as AssetType,
    crop: (s.crop ?? "rice") as CropType,
  };
  const loc = s.report.location;
  const pdf = async () => {
    setBusy(true);
    try {
      await generateExplorerPdf(b, { preparedFor: null, preparedBy: s.orgName ?? s.createdByName, shareUrl: window.location.href });
    } catch (e) {
      toast.error(`PDF failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shared-report min-h-screen hud-bg text-slate-200">
      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          html, body { background: #070c1a !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .shared-report section, .shared-report figure { break-inside: avoid; page-break-inside: avoid; }
          .shared-report .print-break { break-before: page; page-break-before: always; }
          .shared-report .leaflet-control-container { display: none; }
        }
      `}</style>
      <header className="border-b border-white/5 bg-[#060a16]/80 backdrop-blur no-print">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600">
              <Shield size={16} className="text-slate-950" />
            </span>
            <span className="font-display font-semibold text-white">
              Agri<span className="text-emerald-400">-SHIELD</span>
            </span>
          </Link>
          <span className="hidden hud-label border-l border-white/10 pl-3 sm:inline">Shared report · read-only</span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[12px] text-slate-200 hover:border-emerald-400/40">
              <Printer size={13} /> Print
            </button>
            <button onClick={() => void pdf()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-2.5 py-1.5 text-[12px] font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />} PDF
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6">
        <div className="grid gap-4 md:grid-cols-[1fr_300px]">
          <div>
            <div className="hud-label text-emerald-300/80">Climate due-diligence report</div>
            <h1 className="mt-1 font-display text-2xl font-semibold text-white md:text-3xl">{loc.name ?? `${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)}`}</h1>
            <div className="mt-1 text-sm text-slate-400">
              {[loc.admin1, loc.country].filter(Boolean).join(", ")} · <span className="telemetry">{loc.lat.toFixed(4)}, {loc.lon.toFixed(4)}</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-slate-400">
              <RiskPill level={s.report.composite.level} />
              <span>
                {assetLabel(b.assetType)}
                {s.crop ? ` · ${cropLabel(b.crop)}` : ""}
              </span>
              <span>· prepared by {s.createdByName}{s.orgName ? ` (${s.orgName})` : ""}</span>
              <span>· snapshot {new Date(s.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
            </div>
            {s.note && <p className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] text-slate-300">{s.note}</p>}
            <p className="mt-3 text-[11.5px] text-slate-500">This is a frozen snapshot — forecasts reflect the moment it was created. Open the live explorer for current conditions.</p>
          </div>
          <div className="h-48 overflow-hidden rounded-xl border border-white/10 md:h-auto">
            <BaseMap
              center={[loc.lat, loc.lon]}
              zoom={9}
              basemap="satellite"
              showBasemapSwitcher={false}
              onReady={(map, L) => {
                L.circleMarker([loc.lat, loc.lon], { radius: 8, color: "#052e1f", weight: 3, fillColor: "#34d399", fillOpacity: 1 }).addTo(map);
              }}
            />
          </div>
        </div>

        {TABS.map((t, i) => (
          <section key={t.key} className={i > 1 ? "print-break" : undefined}>
            <h2 className="mb-2 border-b border-white/5 pb-1.5 font-display text-lg font-semibold text-white">{t.label}</h2>
            <TabBody tab={t.key} b={b} />
          </section>
        ))}

        <div className="no-print rounded-2xl border border-emerald-400/25 bg-gradient-to-br from-emerald-500/10 to-cyan-500/5 p-5 text-center">
          <div className="font-display text-lg font-semibold text-white">Run this analysis for your own sites</div>
          <p className="mx-auto mt-1 max-w-lg text-sm text-slate-300">Agri-SHIELD monitors thousands of farms, loans, insured plots and facilities with the same engine — and alerts you before the flood, drought or salt arrives.</p>
          <Link href="/explore" className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400">
            Check any location free <ArrowRight size={14} />
          </Link>
        </div>
        <footer className="pb-6 text-center text-[11px] text-slate-600">Agri-SHIELD · Data: Open-Meteo (CC BY 4.0), ECMWF, Copernicus ERA5/GloFAS/DEM, NASA, ISRIC SoilGrids, OpenStreetMap, GDACS</footer>
      </main>
    </div>
  );
}
