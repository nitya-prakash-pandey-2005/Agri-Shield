"use client";

/**
 * Yield Forecast — in-season, crop-stage-aware yield forecasts for every crop asset
 * and monitored district, with P10/P90 bands, a drivers waterfall, week-by-week
 * evolution and industry outlooks (insurer payouts, bank repayment, sourcing volume).
 */
import { Suspense, useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BookOpen, LayoutGrid, RefreshCw, Table2, Wheat } from "lucide-react";
import { EmptyState, SectionHeader, Skeleton } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { Btn, ErrorBox, TabBar, useTab } from "@/components/insurance/kit";
import Overview from "@/components/yield/Overview";
import Assets from "@/components/yield/Assets";
import Methodology from "@/components/yield/Methodology";
import { AssetDetail, DistrictDetail } from "@/components/yield/Detail";
import { trpc } from "@/lib/trpc";

const TABS = ["overview", "assets", "method"] as const;
type Tab = (typeof TABS)[number];

function YieldInner() {
  const [tab, setTab] = useTab<Tab>(TABS, "overview");
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const assetId = sp.get("asset");
  const districtId = sp.get("district");
  const setParam = useCallback(
    (k: "asset" | "district", v: string | null) => {
      const q = new URLSearchParams(sp.toString());
      q.delete("asset");
      q.delete("district");
      if (v) q.set(k, v);
      router.replace(`${path}?${q.toString()}`, { scroll: false });
    },
    [sp, router, path]
  );
  const utils = trpc.useUtils();
  const book = trpc.sustainability.yield.book.useQuery(undefined, { staleTime: 10 * 60_000 });
  const refresh = trpc.sustainability.yield.refresh.useMutation({ onSuccess: () => (utils.sustainability.yield.invalidate(), utils.sustainability.carbon.invalidate()) });
  const exp = trpc.sustainability.esg.recordExport.useMutation();

  return (
    <div>
      <SectionHeader
        eyebrow="Workspace · Yield Forecast"
        title="In-season yield forecast"
        description={
          <>
            How much will your fields harvest this season? Each crop asset gets a stage-aware forecast in t/ha with an 80 % range (<Explain text="P10 = only 1 in 10 outcomes is lower; P90 = only 1 in 10 is higher.">P10–P90</Explain>), built from FAOSTAT yields, this season&apos;s water balance (<Explain text="FAO Irrigation & Drainage Paper 33: the yield response factor Ky links the shortfall in crop water use to the shortfall in yield — Ky > 1 means yield falls faster than water use.">FAO-33 Ky</Explain>), heat at flowering, real flood episodes, salinity and satellite <Explain term="ndvi">NDVI</Explain>.
          </>
        }
        actions={
          <Btn variant="outline" loading={refresh.isPending} onClick={() => refresh.mutate()}>
            <RefreshCw size={13} /> Re-run forecast
          </Btn>
        }
      />
      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "overview", label: "Overview", icon: LayoutGrid },
          { value: "assets", label: "Crop assets", icon: Table2, badge: book.data ? <span className="telemetry ml-1 rounded bg-white/10 px-1 text-[10.5px]">{book.data.assets.length}</span> : undefined },
          { value: "method", label: "Methodology", icon: BookOpen },
        ]}
      />
      <ErrorBox error={book.error} onRetry={() => book.refetch()} />
      {tab === "method" ? (
        <Methodology />
      ) : !book.data ? (
        !book.error && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-[68px]" />
              ))}
            </div>
            <Skeleton className="h-14" />
            <Skeleton className="h-[380px]" />
            <p className="text-center text-[12px] text-slate-500">Running 30 past seasons of weather through the crop water balance for every asset…</p>
          </div>
        )
      ) : !book.data.assets.length && !book.data.districts.length ? (
        <EmptyState icon={Wheat} title="Nothing to forecast yet">
          Add crop assets (insured plots, loans or farms with a crop and area) in Portfolio, or monitor districts, and the forecast appears here.
        </EmptyState>
      ) : tab === "assets" ? (
        <Assets book={book.data} onOpen={(id) => setParam("asset", id)} onExport={() => exp.mutate({ kind: "yield_csv" })} />
      ) : (
        <Overview book={book.data} onOpenAsset={(id) => setParam("asset", id)} onOpenDistrict={(id) => setParam("district", id)} />
      )}
      <AssetDetail id={assetId} onClose={() => setParam("asset", null)} />
      <DistrictDetail id={districtId} onClose={() => setParam("district", null)} onOpenAsset={(id) => setParam("asset", id)} />
    </div>
  );
}

export default function YieldPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <YieldInner />
    </Suspense>
  );
}
