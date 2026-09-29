"use client";

/**
 * Risk Explorer (workspace) — "climate due-diligence for any place on Earth".
 * Full-bleed map → click / search / locate / paste coordinates → slide-over
 * report with 8 tabs, compare up to 4 places, add to portfolio, branded PDF,
 * shareable read-only link. Deep link: /app/explorer?lat=..&lon=..&name=..&tab=..
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { AnimatePresence, motion } from "framer-motion";
import { Bookmark, Columns3, Compass, ExternalLink, Link2, Loader2, MousePointerClick, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { AssetType, CropType } from "@agri-shield/types";
import { trpc } from "@/lib/trpc";
import { can } from "@/lib/rbac";
import { RiskPill } from "@/components/hud";
import { ExplorerMap, type OverlayKey } from "./ExplorerMap";
import { SearchBox } from "./SearchBox";
import { ComparePanel } from "./ComparePanel";
import { ReportHeader, ReportLoading, SlideOver, TabBar, TabBody, TABS, type TabKey } from "./ReportPanel";
import { EXAMPLE_PLACES, assetGroup, type Place, type ReportBundle } from "./types";
import { generateExplorerPdf } from "./pdf";

const LS = { pins: "agri.explorer.pins", asset: "agri.explorer.asset", crop: "agri.explorer.crop" };
const readLS = <T,>(k: string, fb: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fb;
  } catch {
    return fb;
  }
};
const writeLS = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* private mode */
  }
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function ExplorerApp() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { data: session } = useSession();
  const utils = trpc.useUtils();

  const initial = useMemo(() => {
    const lat = Number(params.get("lat"));
    const lon = Number(params.get("lon"));
    const ok = params.get("lat") != null && params.get("lon") != null && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    const tab = params.get("tab") as TabKey | null;
    return { place: ok ? { lat, lon, name: params.get("name") } : null, tab: tab && TABS.some((t) => t.key === tab) ? tab : "overview" };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [selected, setSelected] = useState<Place | null>(initial.place);
  const [tab, setTab] = useState<TabKey>(initial.tab);
  const [assetType, setAssetType] = useState<AssetType>("farm");
  const [crop, setCrop] = useState<CropType>("rice");
  const [pins, setPins] = useState<Place[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [overlayReq, setOverlayReq] = useState<{ key: OverlayKey; n: number } | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const [wantLongTerm, setWantLongTerm] = useState(false);

  // Restore per-viewer preferences once, then persist changes (never overwrite before the first read)
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  useEffect(() => {
    setPins(readLS<Place[]>(LS.pins, []));
    setAssetType(readLS<AssetType>(LS.asset, "farm"));
    setCrop(readLS<CropType>(LS.crop, "rice"));
    setPrefsLoaded(true);
  }, []);
  useEffect(() => {
    if (prefsLoaded) writeLS(LS.pins, pins);
  }, [pins, prefsLoaded]);
  useEffect(() => {
    if (prefsLoaded) writeLS(LS.asset, assetType);
  }, [assetType, prefsLoaded]);
  useEffect(() => {
    if (prefsLoaded) writeLS(LS.crop, crop);
  }, [crop, prefsLoaded]);

  // Deep-link sync
  useEffect(() => {
    const q = new URLSearchParams();
    if (selected) {
      q.set("lat", selected.lat.toFixed(4));
      q.set("lon", selected.lon.toFixed(4));
      if (selected.name) q.set("name", selected.name);
      if (tab !== "overview") q.set("tab", tab);
    }
    const next = q.toString() ? `${pathname}?${q}` : pathname;
    router.replace(next, { scroll: false });
  }, [selected, tab, pathname, router]);

  const pick = useCallback((p: Place) => {
    setSelected(p);
    setShareUrl(null);
    setAdded(null);
    setWantLongTerm(false);
  }, []);

  const cropForQuery = ["crop", "finance"].includes(assetGroup(assetType)) ? crop : undefined;
  const assess = trpc.explorer.assess.useQuery(
    { lat: selected?.lat ?? 0, lon: selected?.lon ?? 0, crop: cropForQuery, name: selected?.name ?? null },
    {
      enabled: !!selected,
      staleTime: 5 * 60_000,
      retry: 1,
      refetchInterval: (q) => (q.state.data?.extras?.pending?.length && q.state.dataUpdateCount < 4 ? 20_000 : false),
    }
  );
  const needClimate = !!selected && (tab === "drought" || tab === "climate" || wantLongTerm);
  const needOutlook = !!selected && (tab === "outlook" || wantLongTerm);
  const climate = trpc.explorer.climate.useQuery({ lat: selected?.lat ?? 0, lon: selected?.lon ?? 0 }, { enabled: needClimate, staleTime: 30 * 60_000, refetchInterval: (q) => (q.state.data && !q.state.data.ready ? 8000 : false) });
  const outlook = trpc.explorer.outlook.useQuery({ lat: selected?.lat ?? 0, lon: selected?.lon ?? 0 }, { enabled: needOutlook, staleTime: 30 * 60_000, refetchInterval: (q) => (q.state.data && !q.state.data.ready ? 8000 : false) });

  const bundle: ReportBundle | null = assess.data
    ? {
        report: assess.data,
        climate: climate.data ? { ...climate.data } : needClimate ? { history: null, drought: null, ready: false } : null,
        outlook: outlook.data ? { ...outlook.data } : needOutlook ? { seasonal: null, projection: null, applied: null, ready: false } : null,
        assetType,
        crop,
      }
    : null;

  // ── Actions ──
  const canAdd = can(session?.user?.role, "manage_assets");
  const createAsset = trpc.portfolio.createAsset.useMutation();
  const addToPortfolio = async (allowDuplicate = false) => {
    if (!bundle) return;
    const r = bundle.report;
    try {
      const a = await createAsset.mutateAsync({
        name: (r.location.name ?? `Site ${r.location.lat.toFixed(3)}, ${r.location.lon.toFixed(3)}`).slice(0, 120),
        type: assetType,
        lat: r.location.lat,
        lon: r.location.lon,
        country: r.location.country ?? null,
        crop: ["crop", "finance"].includes(assetGroup(assetType)) ? crop : null,
        valueUsd: 0,
        tags: ["explorer"],
        allowDuplicate,
      });
      const name = (a as { name?: string }).name ?? "Site";
      setAdded(`${r.location.lat},${r.location.lon}`);
      void utils.portfolio.invalidate();
      toast.success(`“${name}” added to your portfolio`, { description: "It will be re-scored automatically and trigger your alert rules.", action: { label: "Open portfolio", onClick: () => router.push("/app/portfolio") } });
    } catch (e) {
      const err = e as { message?: string; data?: { code?: string } };
      if (err.data?.code === "CONFLICT" && !allowDuplicate) toast.warning(err.message ?? "A similar asset already exists", { action: { label: "Add anyway", onClick: () => void addToPortfolio(true) } });
      else toast.error(err.message ?? "Could not add to portfolio");
    }
  };

  const save = trpc.explorer.saveReport.useMutation();
  const share = async () => {
    if (!bundle) return;
    if (shareUrl) {
      void navigator.clipboard?.writeText(shareUrl);
      toast.success("Link copied");
      return;
    }
    try {
      const res = await save.mutateAsync({ lat: bundle.report.location.lat, lon: bundle.report.location.lon, crop: cropForQuery, name: selected?.name ?? null, assetType });
      const url = `${window.location.origin}${res.url}`;
      setShareUrl(url);
      void utils.explorer.listSavedReports.invalidate();
      try {
        await navigator.clipboard?.writeText(url);
        toast.success("Shareable link copied", { description: url, action: { label: "Open", onClick: () => window.open(url, "_blank") } });
      } catch {
        toast.success("Shareable report created", { description: url });
      }
    } catch (e) {
      toast.error((e as Error).message ?? "Could not create link");
    }
  };

  const pdf = async () => {
    if (!bundle || !selected) return;
    setPdfBusy(true);
    setWantLongTerm(true);
    const tid = toast.loading("Compiling the due-diligence report (forecast, 40-year climate, 2050 outlook)…");
    try {
      let c = climate.data;
      let o = outlook.data;
      for (let i = 0; i < 4 && (!c?.ready || !o?.ready); i++) {
        [c, o] = await Promise.all([c?.ready ? c : utils.explorer.climate.fetch({ lat: selected.lat, lon: selected.lon }, { staleTime: 0 }), o?.ready ? o : utils.explorer.outlook.fetch({ lat: selected.lat, lon: selected.lon }, { staleTime: 0 })]);
        if (!c?.ready || !o?.ready) await sleep(6000);
      }
      await generateExplorerPdf({ ...bundle, climate: c ?? null, outlook: o ?? null }, { preparedBy: session?.user?.name ?? null, shareUrl });
      toast.success(c?.history && o?.projection ? "PDF downloaded" : "PDF downloaded — long-term sections still computing were left out", { id: tid });
    } catch (e) {
      toast.error(`PDF failed: ${(e as Error).message}`, { id: tid });
    } finally {
      setPdfBusy(false);
    }
  };

  const isPinned = !!selected && pins.some((p) => Math.abs(p.lat - selected.lat) < 1e-4 && Math.abs(p.lon - selected.lon) < 1e-4);
  const togglePin = () => {
    if (!selected || !bundle) return;
    if (isPinned) return setPins((ps) => ps.filter((p) => !(Math.abs(p.lat - selected.lat) < 1e-4 && Math.abs(p.lon - selected.lon) < 1e-4)));
    if (pins.length >= 4) return toast.warning("You can compare up to 4 places — remove one first");
    setPins((ps) => [...ps, { lat: selected.lat, lon: selected.lon, name: bundle.report.location.name ?? selected.name ?? null }]);
    toast.success(pins.length >= 1 ? `Pinned — ${pins.length + 1} places ready to compare` : "Pinned — pick another place to compare");
  };

  const saved = trpc.explorer.listSavedReports.useQuery(undefined, { enabled: savedOpen });
  const del = trpc.explorer.deleteSavedReport.useMutation({ onSuccess: () => void utils.explorer.listSavedReports.invalidate() });

  // Esc closes the report
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !compareOpen && selectedRef.current && document.activeElement?.tagName !== "INPUT") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [compareOpen]);

  const addState = !canAdd
    ? { disabled: true, reason: "Your role can view but not add assets — ask a workspace admin (needs “manage assets”)." }
    : { disabled: false, busy: createAsset.isPending, done: added === `${bundle?.report.location.lat},${bundle?.report.location.lon}` };

  return (
    <div className="relative -m-4 h-[calc(100dvh-3.5rem)] overflow-hidden md:-m-6 lg:-m-8">
      <ExplorerMap
        selected={selected}
        pins={pins}
        hazards={bundle?.report.hazardsNearby.map((h) => ({ lat: h.lat, lon: h.lon, title: h.title, type: h.type })) ?? []}
        riverCell={bundle?.report.river?.cell ?? null}
        onPick={(lat, lon) => pick({ lat, lon, name: null })}
        overlayRequest={overlayReq}
        compactControls
        initialCenter={initial.place ? [initial.place.lat, initial.place.lon] : [15, 60]}
        initialZoom={initial.place ? 8 : 3}
      />

      {/* Search + tools */}
      <div className="absolute left-3 top-3 z-[620] flex w-[calc(100%-7.5rem)] max-w-[440px] flex-col gap-2">
        <SearchBox onPick={pick} />
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setSavedOpen((o) => !o)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#060a16]/85 px-2.5 py-1.5 text-[11.5px] text-slate-300 backdrop-blur hover:text-white">
            <Bookmark size={12} /> Shared reports
          </button>
        </div>
        <AnimatePresence>
          {savedOpen && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="max-h-[50vh] overflow-auto rounded-xl border border-white/10 bg-[#060a16]/95 p-2 shadow-2xl backdrop-blur-xl">
              <div className="flex items-center justify-between px-1.5 pb-1">
                <span className="hud-label">Shared reports · this workspace</span>
                <button onClick={() => setSavedOpen(false)} className="text-slate-500 hover:text-white" aria-label="Close">
                  <X size={13} />
                </button>
              </div>
              {saved.isLoading && <div className="px-2 py-3 text-xs text-slate-500">Loading…</div>}
              {saved.data?.length === 0 && <div className="px-2 py-3 text-xs text-slate-500">No shared reports yet. Open a place and press “Share link” to create a read-only report for clients or colleagues.</div>}
              {saved.data?.map((s) => (
                <div key={s.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
                  <button onClick={() => pick({ lat: s.lat, lon: s.lon, name: s.name })} className="min-w-0 flex-1 text-left">
                    <div className="truncate text-[12.5px] text-slate-100">{s.name ?? s.title}</div>
                    <div className="text-[10.5px] text-slate-500">
                      {new Date(s.createdAt).toLocaleDateString("en-GB")} · {s.createdByName} · {s.views} view{s.views === 1 ? "" : "s"}
                    </div>
                  </button>
                  <RiskPill level={s.level} />
                  <a href={s.url} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-cyan-300" aria-label="Open shared report">
                    <ExternalLink size={13} />
                  </a>
                  <button onClick={() => { void navigator.clipboard?.writeText(`${window.location.origin}${s.url}`); toast.success("Link copied"); }} className="text-slate-500 hover:text-cyan-300" aria-label="Copy link">
                    <Link2 size={13} />
                  </button>
                  <button onClick={() => del.mutate({ id: s.id })} className="text-slate-500 hover:text-rose-300" aria-label="Delete shared report">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Empty state */}
      <AnimatePresence>
        {!selected && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="absolute bottom-10 left-3 right-3 z-[610] mx-auto max-w-xl rounded-2xl border border-white/10 bg-[#060a16]/92 p-4 shadow-2xl backdrop-blur-xl sm:left-6 sm:right-auto">
            <div className="flex items-center gap-2 text-emerald-300">
              <Compass size={16} />
              <span className="hud-label text-emerald-300/90">Risk Explorer</span>
            </div>
            <h1 className="mt-1 font-display text-lg font-semibold text-white">Climate due-diligence for any place on Earth</h1>
            <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-slate-400">
              <MousePointerClick size={13} /> Click the map, search a place, paste coordinates or use your location.
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

      {/* Compare tray */}
      {pins.length > 0 && (
        <div className={`absolute bottom-8 left-3 z-[615] flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-1.5 rounded-xl border border-violet-400/25 bg-[#060a16]/92 p-1.5 backdrop-blur-xl ${selected ? "lg:max-w-[calc(100%-min(720px,56vw)-2rem)]" : ""} ${selected ? "max-lg:hidden" : ""}`}>
          {pins.map((p, i) => (
            <span key={`${p.lat},${p.lon}`} className="inline-flex items-center gap-1 rounded-lg bg-violet-400/10 px-2 py-1 text-[11.5px] text-violet-100">
              <button onClick={() => pick(p)} className="max-w-[9rem] truncate hover:underline">
                {i + 1}. {p.name ?? `${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}`}
              </button>
              <button onClick={() => setPins((ps) => ps.filter((_, k) => k !== i))} className="text-violet-300/70 hover:text-white" aria-label="Unpin">
                <X size={11} />
              </button>
            </span>
          ))}
          <button onClick={() => setCompareOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-violet-500 px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-violet-400">
            <Columns3 size={13} /> Compare {pins.length}
          </button>
        </div>
      )}

      {/* Report */}
      <SlideOver open={!!selected}>
        <ReportHeader
          b={bundle}
          loadingName={selected?.name}
          onClose={() => setSelected(null)}
          assetType={assetType}
          crop={crop}
          setAssetType={setAssetType}
          setCrop={setCrop}
          actions={{ pinned: isPinned, onPin: togglePin, onAddPortfolio: () => void addToPortfolio(), addPortfolioState: addState, onPdf: () => void pdf(), pdfBusy, onShare: () => void share(), shareBusy: save.isPending, shareUrl }}
        />
        <TabBar tab={tab} setTab={setTab} />
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-24 pt-3">
          {assess.isLoading ? (
            <ReportLoading />
          ) : assess.error ? (
            <div className="rounded-xl border border-rose-400/20 bg-rose-400/[0.05] p-4 text-sm text-rose-200">
              Could not build the report: {assess.error.message}
              <button onClick={() => void assess.refetch()} className="ml-2 underline">
                Retry
              </button>
            </div>
          ) : bundle ? (
            <motion.div key={`${tab}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
              {assess.isFetching && !assess.isLoading && (
                <div className="mb-2 flex items-center gap-1.5 text-[11px] text-slate-500">
                  <Loader2 size={11} className="animate-spin" /> refreshing…
                </div>
              )}
              <TabBody tab={tab} b={bundle} onOverlay={(key) => setOverlayReq({ key, n: Date.now() })} />
            </motion.div>
          ) : null}
        </div>
      </SlideOver>

      {compareOpen && (
        <ComparePanel
          places={pins}
          crop={crop}
          onClose={() => setCompareOpen(false)}
          onRemove={(i) => setPins((ps) => ps.filter((_, k) => k !== i))}
          onOpen={(p) => {
            setCompareOpen(false);
            pick(p);
          }}
        />
      )}
    </div>
  );
}
