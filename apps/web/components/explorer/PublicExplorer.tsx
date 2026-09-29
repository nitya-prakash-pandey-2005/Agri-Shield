"use client";

/**
 * Public (no-login) Risk Explorer for lead generation: same map, search and
 * report shell, limited to the summary + forecast. Anonymous use is capped at
 * 5 reports per hour per IP; everything else is a sign-up CTA.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Compass, Lock, MousePointerClick } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { ExplorerMap } from "./ExplorerMap";
import { SearchBox } from "./SearchBox";
import { ReportHeader, ReportLoading, SlideOver, TabBar, TabBody, type TabKey } from "./ReportPanel";
import { EXAMPLE_PLACES, type Place, type ReportBundle } from "./types";

export function PublicExplorer() {
  const params = useSearchParams();
  const router = useRouter();
  const { data: session } = useSession();
  const initial = useMemo(() => {
    const lat = Number(params.get("lat"));
    const lon = Number(params.get("lon"));
    return params.get("lat") != null && params.get("lon") != null && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon, name: params.get("name") } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [selected, setSelected] = useState<Place | null>(initial);
  const [tab, setTab] = useState<TabKey>("overview");
  const pick = useCallback((p: Place) => {
    setSelected(p);
    setTab("overview");
  }, []);

  useEffect(() => {
    const q = selected ? `?lat=${selected.lat.toFixed(4)}&lon=${selected.lon.toFixed(4)}${selected.name ? `&name=${encodeURIComponent(selected.name)}` : ""}` : "";
    router.replace(`/explore${q}`, { scroll: false });
  }, [selected, router]);

  const quota = trpc.explorer.publicQuota.useQuery(undefined, { staleTime: 10_000 });
  const q = trpc.explorer.publicAssess.useQuery({ lat: selected?.lat ?? 0, lon: selected?.lon ?? 0, name: selected?.name ?? null }, { enabled: !!selected, staleTime: 30 * 60_000, retry: false, refetchOnWindowFocus: false });
  useEffect(() => {
    if (q.data) void quota.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  const fullHref = selected ? `/app/explorer?lat=${selected.lat.toFixed(4)}&lon=${selected.lon.toFixed(4)}` : "/app/explorer";
  const cta = () => router.push(session?.user ? fullHref : `/auth/signup?callbackUrl=${encodeURIComponent(fullHref)}`);
  const limited = q.error?.data?.code === "TOO_MANY_REQUESTS";
  const bundle: ReportBundle | null = q.data ? { report: q.data.report, climate: null, outlook: null, assetType: "farm", crop: "rice" } : null;
  const remaining = q.data?.remaining ?? quota.data?.remaining;

  return (
    <div className="relative h-[calc(100dvh-4rem)] overflow-hidden">
      <ExplorerMap selected={selected} pins={[]} hazards={bundle?.report.hazardsNearby.map((h) => ({ lat: h.lat, lon: h.lon, title: h.title, type: h.type })) ?? []} onPick={(lat, lon) => pick({ lat, lon, name: null })} compactControls initialCenter={initial ? [initial.lat, initial.lon] : [15, 60]} initialZoom={initial ? 8 : 3} />
      <div className="absolute left-3 top-3 z-[620] w-[calc(100%-7.5rem)] max-w-[440px]">
        <SearchBox onPick={pick} />
        {remaining != null && (
          <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#060a16]/85 px-2.5 py-1 text-[11px] text-slate-400 backdrop-blur">
            {remaining} of 5 free reports left this hour ·{" "}
            <button onClick={cta} className="text-emerald-300 hover:underline">
              unlimited with a free workspace
            </button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {!selected && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="absolute bottom-8 left-3 right-3 z-[610] mx-auto max-w-xl rounded-2xl border border-white/10 bg-[#060a16]/92 p-4 shadow-2xl backdrop-blur-xl sm:left-6 sm:right-auto">
            <div className="flex items-center gap-2 text-emerald-300">
              <Compass size={16} />
              <span className="hud-label text-emerald-300/90">Free climate-risk check</span>
            </div>
            <h1 className="mt-1 font-display text-lg font-semibold text-white">How exposed is any place on Earth to floods, drought and heat?</h1>
            <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-slate-400">
              <MousePointerClick size={13} /> Click the map or search a place — no sign-up needed.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {EXAMPLE_PLACES.map((p) => (
                <button key={p.name} onClick={() => pick(p)} className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-left hover:border-emerald-400/40">
                  <div className="text-[12px] text-slate-100">{p.name}</div>
                  <div className="text-[10.5px] text-slate-500">{p.blurb}</div>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <SlideOver open={!!selected}>
        <ReportHeader b={bundle} loadingName={selected?.name} onClose={() => setSelected(null)} />
        <TabBar tab={tab} setTab={setTab} lockedTabs />
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-24 pt-3">
          {limited ? (
            <div className="flex flex-col items-center rounded-xl border border-amber-400/25 bg-amber-400/[0.05] px-6 py-10 text-center">
              <Lock size={24} className="text-amber-300" />
              <div className="mt-2 font-display text-[15px] font-semibold text-white">You&apos;ve used today&apos;s free reports</div>
              <p className="mt-1 max-w-sm text-[12.5px] text-slate-300">{q.error?.message}</p>
              <button onClick={cta} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400">
                Create a free workspace <ArrowRight size={14} />
              </button>
            </div>
          ) : q.isLoading ? (
            <ReportLoading />
          ) : q.error ? (
            <div className="rounded-xl border border-rose-400/20 bg-rose-400/[0.05] p-4 text-sm text-rose-200">Could not build the report: {q.error.message}</div>
          ) : bundle ? (
            <div className="space-y-3">
              <TabBody tab={tab} b={bundle} locked onCta={cta} />
              {tab === "overview" && (
                <div className="rounded-xl border border-emerald-400/25 bg-gradient-to-br from-emerald-500/10 to-cyan-500/5 p-4">
                  <div className="font-display text-[15px] font-semibold text-white">Need this for a portfolio, a loan book or an insurance product?</div>
                  <p className="mt-1 text-[12.5px] text-slate-300">The full report adds tailored actions, flood depth & river records, salinity forecasts, SPI drought, 40-year trends & return periods, 2050 projections, soil — plus PDF due-diligence reports, sharing and automatic alerts for thousands of sites.</p>
                  <button onClick={cta} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400">
                    Unlock the full report <ArrowRight size={14} />
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </SlideOver>
    </div>
  );
}
