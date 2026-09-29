"use client";

/**
 * Satellite Lab — before/after swipe, time-lapse, vegetation (NDVI) anomaly
 * and portfolio flood-extent scan, all on free NASA imagery (GIBS, ORNL DAAC).
 *
 * Deep links: ?tab=swipe|timelapse|vegetation|flood &asset=<id> &lat=&lon= &date=YYYY-MM-DD
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Film, Leaf, Satellite, SplitSquareHorizontal, Waves } from "lucide-react";
import { LiveDot, Skeleton } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { ErrorBox, TabBar, useTab } from "@/components/insurance/kit";
import { PageTitle } from "@/components/portfolio/ui";
import { trpc } from "@/lib/trpc";
import { useLayerMeta, type Place } from "@/components/imagery/common";
import SwipeCompare from "@/components/imagery/SwipeCompare";
import Timelapse from "@/components/imagery/Timelapse";
import Vegetation from "@/components/imagery/Vegetation";
import FloodScan from "@/components/imagery/FloodScan";

const TABS = ["swipe", "timelapse", "vegetation", "flood"] as const;
type Tab = (typeof TABS)[number];

function ImageryInner() {
  const [tab, setTab] = useTab<Tab>(TABS, "swipe");
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const { query: layersQ, byId, source } = useLayerMeta();
  const places = trpc.imagery.places.useQuery(undefined, { staleTime: 5 * 60_000 });
  const [place, setPlaceState] = useState<Place | null>(null);
  const dateParam = params.get("date");
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : null;

  // Resolve ?asset= / ?lat=&lon= once places load
  useEffect(() => {
    if (place || !places.data) return;
    const assetId = params.get("asset");
    const lat = Number(params.get("lat"));
    const lon = Number(params.get("lon"));
    if (assetId) {
      const a = places.data.assets.find((x) => x.id === assetId);
      if (a) return setPlaceState({ lat: a.lat, lon: a.lon, name: a.name, assetId: a.id });
    }
    if (params.get("lat") && Number.isFinite(lat) && Number.isFinite(lon)) return setPlaceState({ lat, lon, name: `${lat.toFixed(3)}, ${lon.toFixed(3)}` });
    const first = places.data.assets[0];
    if (first) setPlaceState({ lat: first.lat, lon: first.lon, name: first.name, assetId: first.id });
  }, [places.data, params, place]);

  const setPlace = useCallback(
    (p: Place) => {
      setPlaceState(p);
      const q = new URLSearchParams(params.toString());
      q.delete("asset");
      q.delete("lat");
      q.delete("lon");
      if (p.assetId) q.set("asset", p.assetId);
      else {
        q.set("lat", p.lat.toFixed(4));
        q.set("lon", p.lon.toFixed(4));
      }
      router.replace(`${path}?${q.toString()}`, { scroll: false });
    },
    [params, router, path]
  );

  const latest = useMemo(() => byId.get("modis_flood")?.latest ?? null, [byId]);

  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-x-0 -top-6 h-40 bg-[radial-gradient(ellipse_at_top,rgba(34,211,238,0.10),transparent_70%)]" />
      <PageTitle
        eyebrow="Monitor · Satellite Lab"
        title="Satellite Lab"
        description={
          <>
            Look at your assets from orbit: compare any two dates, animate a flood season, track crop greenness against normal (<Explain term="ndvi">NDVI</Explain>) and check which assets sit under NASA-observed flood water. Free NASA <Explain term="gibs">GIBS</Explain> imagery, from 30 m field-scale to daily 250 m.
          </>
        }
        actions={
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <Satellite size={14} className="text-cyan-300" />
            {latest ? (
              <>
                <LiveDot label="GIBS" color="#22d3ee" /> newest flood map <span className="telemetry text-slate-200">{latest}</span>
              </>
            ) : layersQ.isLoading ? (
              "Checking imagery calendar…"
            ) : (
              "Imagery calendar unavailable"
            )}
            {source === "assumed-daily" && <span className="text-amber-300">(availability estimated)</span>}
          </div>
        }
      />
      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "swipe", label: "Before / after", icon: SplitSquareHorizontal },
          { value: "timelapse", label: "Time-lapse", icon: Film },
          { value: "vegetation", label: "Vegetation", icon: Leaf },
          { value: "flood", label: "Flood extent", icon: Waves },
        ]}
      />
      <ErrorBox error={places.error} onRetry={() => places.refetch()} />
      {tab === "swipe" ? (
        <SwipeCompare places={places.data} place={place} onPlace={setPlace} layers={byId} initialDate={date} />
      ) : tab === "timelapse" ? (
        <Timelapse places={places.data} place={place} onPlace={setPlace} layers={byId} initial={{ date }} />
      ) : tab === "vegetation" ? (
        <Vegetation places={places.data} place={place} onPlace={setPlace} />
      ) : (
        <FloodScan floodLayer={byId.get("modis_flood")} initialDate={date} initialDays={Number(params.get("days")) || null} center={places.data?.center ?? [22.7, 90.3]} />
      )}
    </div>
  );
}

export default function ImageryPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[600px]" />}>
      <ImageryInner />
    </Suspense>
  );
}
