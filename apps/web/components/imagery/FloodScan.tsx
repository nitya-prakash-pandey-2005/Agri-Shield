"use client";

/**
 * Flood extent: sample NASA's MODIS 2-day flood map at every asset of the
 * workspace for a chosen date → "observed flooded" list, with links into
 * Insurance claims validation. Coarse satellite evidence, labelled as such.
 */
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { BellRing, CloudRain, Download, ExternalLink, FileSearch, Radar, ScanLine, ShieldAlert, Waves } from "lucide-react";
import { EmptyState, Panel, Skeleton, SourceTag } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { ErrorBox, Kpi, WhatThisMeans } from "@/components/insurance/kit";
import { Chip, Help, Segmented } from "@/components/portfolio/ui";
import { TYPE_LABEL } from "@/components/portfolio/format";
import { can } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { DateField, VERDICT_META, download, usd, type LayerInfo, type Verdict } from "./common";
import { addDays } from "./tile-math";

const FloodMap = dynamic(() => import("./FloodMap"), { ssr: false, loading: () => <Skeleton className="h-[460px]" /> });

type ScanResult = RouterOutputs["imagery"]["floodScan"];

const claimHref = (assetId: string, date: string) => `/app/insurance?tab=claims&assetId=${encodeURIComponent(assetId)}&lossDate=${date}&peril=flood`;

export default function FloodScan({ floodLayer, initialDate, initialDays, center }: { floodLayer: LayerInfo | undefined; initialDate?: string | null; initialDays?: number | null; center: [number, number] }) {
  const { data: session } = useSession();
  const canNotify = can(session?.user?.role, "manage_assets");
  const utils = trpc.useUtils();
  const last = trpc.imagery.lastFloodScan.useQuery(undefined, { staleTime: 60_000 });
  const [date, setDate] = useState<string>(initialDate ?? "");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [filter, setFilter] = useState<Verdict | "all" | "flagged">("flagged");
  const [days, setDays] = useState<"1" | "3" | "7">(initialDays === 1 || initialDays === 7 ? (String(initialDays) as "1" | "7") : "3");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!date && floodLayer?.latest) setDate(addDays(floodLayer.latest, -1));
  }, [floodLayer?.latest, date]);
  useEffect(() => {
    if (initialDate) setDate(initialDate);
  }, [initialDate]);
  useEffect(() => {
    if (!result && last.data?.result && (!initialDate || last.data.result.date === initialDate)) {
      setResult(last.data.result);
      if (!initialDate) setDate(last.data.result.date);
    }
  }, [last.data, result, initialDate]);

  const scan = trpc.imagery.floodScan.useMutation({
    onSuccess: (r) => {
      setResult(r);
      setFilter(r.summary.flooded + r.summary.nearby > 0 ? "flagged" : "all");
      void utils.imagery.lastFloodScan.invalidate();
      toast.success(`Scanned ${r.summary.assets} assets: ${r.summary.flooded} under flood pixels, ${r.summary.nearby} with flood nearby`);
    },
    onError: (e) => toast.error(e.message),
  });
  const notify = trpc.imagery.notifyFloodScan.useMutation({ onSuccess: (n) => toast.success(`Team notified: ${n.title}`), onError: (e) => toast.error(e.message) });

  const rows = useMemo(() => {
    const all = result?.rows ?? [];
    if (filter === "all") return all;
    if (filter === "flagged") return all.filter((r) => r.verdict === "observed_flooded" || r.verdict === "flood_nearby");
    return all.filter((r) => r.verdict === filter);
  }, [result, filter]);

  const markers = useMemo(
    () =>
      (result?.rows ?? []).map((r) => ({
        id: r.assetId,
        lat: r.lat,
        lon: r.lon,
        name: r.name,
        color: VERDICT_META[r.verdict].color,
        label: `${VERDICT_META[r.verdict].label} · ${usd(r.valueUsd)}`,
        emphasis: r.verdict === "observed_flooded" || r.verdict === "flood_nearby",
      })),
    [result]
  );

  const exportCsv = () => {
    if (!result) return;
    const head = ["asset_id", "name", "type", "country", "lat", "lon", "observed_on", "clear_days_in_window", "verdict", "centre_pixel", "flood_pixels_3x3", "cloud_pixels_3x3", "value_usd", "var_usd", "composite", "source"];
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [head.join(","), ...result.rows.map((r) => [r.assetId, r.name, r.type, r.country, r.lat, r.lon, r.observedOn ?? "", r.clearDays, r.verdict, r.pixel ?? "", r.floodNeighbours, r.cloudNeighbours, r.valueUsd, r.varUsd, r.composite, result.source].map(esc).join(","))];
    download(`flood-scan-${result.from}_${result.date}.csv`, lines.join("\n"), "text/csv");
  };

  const s = result?.summary;
  const selRow = result?.rows.find((r) => r.assetId === selected);
  const mapDate = selRow?.observedOn ?? result?.rows.find((r) => r.verdict === "observed_flooded")?.observedOn ?? result?.date ?? "";
  const flaggedIds = (result?.rows ?? []).filter((r) => r.verdict === "observed_flooded" && r.type === "insured_plot").map((r) => r.assetId);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-400/[0.06] px-4 py-3 text-[12.5px] leading-relaxed text-amber-100">
        <ShieldAlert size={16} className="mt-0.5 shrink-0 text-amber-300" />
        <div>
          <b className="text-amber-200">Coarse 250 m satellite evidence.</b> MODIS sees one ~6 ha pixel at a time and cannot see through cloud. A “flooded” flag is strong supporting evidence for a claim or a response decision — it does not replace a field visit, and <b>no flood pixel does not prove there was no flood</b>.
        </div>
      </div>

      <Panel title="Scan your portfolio for observed flood water" subtitle="Samples NASA's MODIS Combined Flood 2-Day map at every asset location" icon={ScanLine} accent="cyan">
        <div className="grid items-end gap-3 sm:grid-cols-[200px_auto_auto] lg:grid-cols-[200px_auto_auto_1fr]">
          <DateField label="Observation date (last day)" value={date || ""} onChange={setDate} layer={floodLayer} min="2021-01-01" />
          <div className="pb-[18px]">
            <div className="mb-1 text-[12px] text-slate-400">
              Look back <Help text="Clouds hide the ground on most monsoon days. Looking back over several days keeps the clearest look at each asset: any flood seen wins, otherwise the latest cloud-free day." />
            </div>
            <Segmented value={days} onChange={(v) => setDays(v as typeof days)} options={[{ value: "1", label: "1 day" }, { value: "3", label: "3 days" }, { value: "7", label: "7 days" }]} />
          </div>
          <div className="pb-[18px]">
            <button type="button" disabled={!date || scan.isPending} onClick={() => scan.mutate({ date, windowDays: Number(days) })} className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2 text-[13px] font-medium text-slate-950 hover:bg-cyan-300 disabled:opacity-40">
              <Radar size={14} className={scan.isPending ? "animate-spin" : ""} />
              {scan.isPending ? "Reading satellite pixels…" : "Scan portfolio"}
            </button>
          </div>
          <div className="pb-[18px] text-[11.5px] text-slate-500">
            Each asset's pixel and its 8 neighbours (≈ ±300 m) are read from NASA's flood tile for every day in the window. Monsoon cloud often hides the ground — widen the look-back if many assets come back “cloud”.
          </div>
        </div>
      </Panel>

      <ErrorBox error={scan.error} />

      {scan.isPending && !result ? (
        <Skeleton className="h-[420px]" />
      ) : !result ? (
        <Panel>
          <EmptyState icon={Waves} title="No scan yet">
            Pick a date and press “Scan portfolio”. The newest flood map is usually 1–2 days behind today.
          </EmptyState>
        </Panel>
      ) : (
        <>
          <WhatThisMeans tone={s!.flooded ? "rose" : s!.nearby ? "amber" : "sky"}>
            {s!.flooded ? (
              <>
                {result.windowDays > 1 ? <>Between <b>{result.from}</b> and <b>{result.date}</b></> : <>On <b>{result.date}</b></>} NASA's satellites saw flood water on top of <b>{s!.flooded}</b> of your {s!.assets} assets ({usd(s!.exposureFloodedUsd)} exposure), and within ~300 m of {s!.nearby} more. Prioritise these for claims checks, loan follow-up or response teams.
              </>
            ) : s!.nearby ? (
              <>No asset sits directly under a flood pixel {result.windowDays > 1 ? `between ${result.from} and ${result.date}` : `on ${result.date}`}, but {s!.nearby} {s!.nearby === 1 ? "has" : "have"} flood water within ~300 m ({usd(s!.exposureNearbyUsd)} exposure) — worth a phone call.</>
            ) : (
              <>No flood water was seen at any asset {result.windowDays > 1 ? `between ${result.from} and ${result.date}` : `on ${result.date}`}.</>
            )}{" "}
            {s!.cloud > 0 && (
              <span className="text-slate-400">
                {s!.cloud} asset{s!.cloud === 1 ? " was" : "s were"} under cloud on every day checked, so the satellite could not tell — widen the look-back or check again later.
              </span>
            )}
          </WhatThisMeans>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Kpi label="Observed flooded" value={s!.flooded} sub={usd(s!.exposureFloodedUsd)} tone={s!.flooded ? "bad" : "good"} />
            <Kpi label="Flood within ~300 m" value={s!.nearby} sub={usd(s!.exposureNearbyUsd)} tone={s!.nearby ? "warn" : "good"} />
            <Kpi label="Cloud / no data" value={s!.cloud + s!.unavailable} sub={`of ${s!.assets} assets`} tone={s!.cloud + s!.unavailable > s!.assets / 2 ? "warn" : "neutral"} />
            <Kpi label="No water seen" value={s!.dry + s!.normalWater} sub={s!.normalWater ? `${s!.normalWater} on normal water` : undefined} />
            <Kpi label="Tiles read" value={s!.tilesFetched} sub={s!.tilesFailed || s!.tilesSkipped ? `${s!.tilesFailed} failed · ${s!.tilesSkipped} skipped` : "z9 · ~300 m pixels"} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <Panel title="Flood map" subtitle={`MODIS 2-day flood over true colour · ${mapDate}`} icon={CloudRain} accent="cyan" actions={result.worldview ? <a href={result.worldview} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-cyan-300 hover:underline">Worldview <ExternalLink size={12} /></a> : null}>
              <FloodMap date={mapDate} markers={markers} center={center} selected={selected} onSelect={setSelected} />
              <div className="mt-2 flex flex-wrap gap-1.5">
                <SourceTag href="https://www.earthdata.nasa.gov/gibs">NASA GIBS · MODIS Combined Flood 2-Day</SourceTag>
                <SourceTag>~250 m · coarse satellite evidence</SourceTag>
                <SourceTag>scanned {new Date(result.scannedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</SourceTag>
              </div>
            </Panel>

            <Panel
              title="Assets"
              subtitle={`${rows.length} shown`}
              accent="cyan"
              actions={
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={exportCsv} className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-cyan-400/50" aria-label="Download CSV">
                    <Download size={12} /> CSV
                  </button>
                  {canNotify && (
                    <button type="button" onClick={() => notify.mutate()} disabled={notify.isPending} className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-cyan-400/50 disabled:opacity-40">
                      <BellRing size={12} /> Notify team
                    </button>
                  )}
                </div>
              }
            >
              <div className="mb-2 flex flex-wrap gap-1.5">
                <Chip active={filter === "flagged"} onClick={() => setFilter("flagged")} color={VERDICT_META.observed_flooded.color}>
                  Flagged {s!.flooded + s!.nearby}
                </Chip>
                {(["observed_flooded", "flood_nearby", "cloud", "dry"] as Verdict[]).map((v) => (
                  <Chip key={v} active={filter === v} onClick={() => setFilter(v)} color={VERDICT_META[v].color}>
                    {VERDICT_META[v].short} {result.rows.filter((r) => r.verdict === v).length}
                  </Chip>
                ))}
                <Chip active={filter === "all"} onClick={() => setFilter("all")}>
                  All {s!.assets}
                </Chip>
              </div>
              {flaggedIds.length > 0 && (
                <Link href={claimHref(flaggedIds[0]!, result.rows.find((r) => r.assetId === flaggedIds[0])?.observedOn ?? result.date)} className="mb-2 flex items-center gap-2 rounded-lg border border-rose-400/25 bg-rose-400/[0.06] px-3 py-2 text-[12px] text-rose-100 hover:border-rose-300/50">
                  <FileSearch size={14} className="shrink-0" />
                  Validate flood claims for {flaggedIds.length} flooded asset{flaggedIds.length === 1 ? "" : "s"} in Insurance → Claims (starts with the highest exposure)
                </Link>
              )}
              {rows.length === 0 ? (
                <EmptyState icon={Waves} title="Nothing in this filter">Try “All”.</EmptyState>
              ) : (
                <div className="max-h-[430px] overflow-y-auto pr-1">
                  <ul className="divide-y divide-slate-800/70">
                    {rows.slice(0, 300).map((r) => (
                      <li key={r.assetId} className={cn("flex items-center gap-2 py-2", selected === r.assetId && "bg-cyan-400/[0.05]")}>
                        <button type="button" onClick={() => setSelected(r.assetId)} className="min-w-0 flex-1 text-left">
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: VERDICT_META[r.verdict].color }} />
                            <span className="truncate text-[13px] text-slate-100">{r.name}</span>
                          </div>
                          <div className="ml-[18px] truncate text-[11px] text-slate-500">
                            {VERDICT_META[r.verdict].label}
                            {r.observedOn && result.windowDays > 1 ? ` · ${r.observedOn.slice(5)}` : ""}
                            {r.floodNeighbours > 0 && r.verdict !== "observed_flooded" ? ` · ${r.floodNeighbours}/9 flood px` : ""} · {TYPE_LABEL[r.type] ?? r.type} · {r.country} · {usd(r.valueUsd)}
                          </div>
                        </button>
                        {(r.verdict === "observed_flooded" || r.verdict === "flood_nearby") && r.type !== "insured_plot" && (
                          <Link href={`/app/portfolio?asset=${encodeURIComponent(r.assetId)}`} className="shrink-0 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-cyan-400/50">
                            Open asset
                          </Link>
                        )}
                        {(r.verdict === "observed_flooded" || r.verdict === "flood_nearby") && r.type === "insured_plot" && (
                          <Link href={claimHref(r.assetId, r.observedOn ?? result.date)} className="shrink-0 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-cyan-400/50" title="Open Insurance claims validation for this asset and date">
                            Validate claim
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="mt-2 text-[11px] text-slate-500">
                Observed flooded = the asset's own pixel is flood or <Explain text="Areas MODIS has seen flooding in most years at this time — e.g. seasonally inundated floodplains.">recurring flood</Explain>. Flood nearby = at least one of the 8 surrounding pixels is.
              </p>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
