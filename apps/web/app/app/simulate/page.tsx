"use client";

/**
 * Simulation Lab — "what if" physics on the workspace's real portfolio:
 * flood inundation on a real DEM, cyclone replays (Holland wind + surge),
 * drought & heat seasons (FAO-33 Ky), and a shared scenario library.
 */
import { Suspense, useState } from "react";
import { motion } from "framer-motion";
import { CloudSun, Cpu, Droplets, Library as LibIcon, Tornado } from "lucide-react";
import { SectionHeader, Skeleton, SourceTag } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { ErrorBox, TabBar, useTab } from "@/components/insurance/kit";
import FloodLab, { type FloodPrefill } from "@/components/simulate/FloodLab";
import CycloneLab, { type CyclonePrefill } from "@/components/simulate/CycloneLab";
import DroughtLab, { type DroughtPrefill } from "@/components/simulate/DroughtLab";
import Library from "@/components/simulate/Library";
import { METHOD_TEXT } from "@/components/simulate/common";
import { trpc } from "@/lib/trpc";

const TABS = ["flood", "cyclone", "drought", "library"] as const;
type Tab = (typeof TABS)[number];

function SimInner() {
  const [tab, setTab] = useTab<Tab>(TABS, "flood");
  const ctx = trpc.simulate.context.useQuery(undefined, { staleTime: 60_000 });
  const lib = trpc.simulate.library.list.useQuery();
  const [floodPre, setFloodPre] = useState<FloodPrefill | null>(null);
  const [tcPre, setTcPre] = useState<CyclonePrefill | null>(null);
  const [drPre, setDrPre] = useState<DroughtPrefill | null>(null);

  return (
    <div>
      <SectionHeader
        eyebrow="Workspace · Simulation Lab"
        title="What if it happened tomorrow?"
        description={
          <>
            Run real physics on your own portfolio: raise the water on a real terrain model (<Explain title={METHOD_TEXT.bathtub.title} text={METHOD_TEXT.bathtub.text}>connectivity-aware bathtub</Explain>), replay a real cyclone (<Explain title={METHOD_TEXT.holland.title} text={METHOD_TEXT.holland.text}>Holland wind model</Explain>), or dry out a season (<Explain title={METHOD_TEXT.ky.title} text={METHOD_TEXT.ky.text}>FAO Ky</Explain>) — and see the hectares, assets, dollars and households affected.
          </>
        }
        actions={
          <div className="hidden items-center gap-1.5 md:flex">
            <SourceTag href="https://registry.opendata.aws/terrain-tiles/">SRTM DEM</SourceTag>
            <SourceTag href="https://global-surface-water.appspot.com/">JRC water</SourceTag>
            <SourceTag href="https://www.ncei.noaa.gov/products/international-best-track-archive">IBTrACS</SourceTag>
          </div>
        }
      />
      <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mb-4 hidden items-center gap-3 overflow-hidden rounded-xl border border-cyan-400/15 bg-[linear-gradient(90deg,rgba(34,211,238,0.07),transparent)] px-4 py-2 text-[11.5px] text-slate-400 md:flex">
        <Cpu size={14} className="text-cyan-300" />
        <span className="telemetry uppercase tracking-widest text-cyan-200/80">Physics engine online</span>
        <span>Server-side rasters (typed arrays, ~2 M cells in &lt; 2 s) · all results scoped to <b className="text-slate-200">{ctx.data?.workspace.name ?? "your workspace"}</b> · {ctx.data?.assets.length ?? "…"} assets</span>
      </motion.div>
      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "flood", label: "Flood", icon: Droplets },
          { value: "cyclone", label: "Cyclone", icon: Tornado },
          { value: "drought", label: "Drought & heat", icon: CloudSun },
          { value: "library", label: "Library & compare", icon: LibIcon, badge: lib.data?.length ? <span className="rounded-full bg-cyan-500/80 px-1.5 text-[10px] text-slate-950">{lib.data.length}</span> : undefined },
        ]}
      />
      <ErrorBox error={ctx.error} onRetry={() => ctx.refetch()} />
      {!ctx.data ? (
        <Skeleton className="h-[560px]" />
      ) : (
        <>
          {/* keep labs mounted so switching tabs never loses a run */}
          <div hidden={tab !== "flood"}>
            <FloodLab ctx={ctx.data} prefill={floodPre} />
          </div>
          <div hidden={tab !== "cyclone"}>{(tab === "cyclone" || tcPre) && <CycloneLab ctx={ctx.data} prefill={tcPre} />}</div>
          <div hidden={tab !== "drought"}>{(tab === "drought" || drPre) && <DroughtLab ctx={ctx.data} prefill={drPre} />}</div>
          {tab === "library" && (
            <Library
              onOpen={(s) => {
                const input = s.input as Record<string, unknown>;
                if (s.kind === "flood") {
                  setFloodPre({ ...(input as unknown as FloodPrefill) });
                  setTab("flood");
                } else if (s.kind === "cyclone") {
                  setTcPre({ ...(input as unknown as CyclonePrefill) });
                  setTab("cyclone");
                } else {
                  setDrPre({ ...(input as unknown as DroughtPrefill) });
                  setTab("drought");
                }
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

export default function SimulatePage() {
  return (
    <Suspense fallback={<Skeleton className="h-[600px]" />}>
      <SimInner />
    </Suspense>
  );
}
