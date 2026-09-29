"use client";

/**
 * Sustainability & Carbon MRV — IPCC Tier 1 rice methane / N2O / urea CO2, AWD adoption
 * tracker, avoided emissions and indicative credit revenue, irrigation water footprint,
 * workspace ESG summary and the MRV evidence pack.
 */
import { Suspense, useDeferredValue, useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { BarChart3, Droplets, FileCheck2, Leaf, RefreshCw, ShieldCheck, Sprout } from "lucide-react";
import { SectionHeader, Skeleton } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { Btn, ErrorBox, TabBar, useTab } from "@/components/insurance/kit";
import Programme, { type ProgOpts } from "@/components/sustainability/Programme";
import Farms from "@/components/sustainability/Farms";
import Water from "@/components/sustainability/Water";
import Esg from "@/components/sustainability/Esg";
import Evidence from "@/components/sustainability/Evidence";
import { trpc } from "@/lib/trpc";

const TABS = ["programme", "farms", "water", "esg", "evidence"] as const;
type Tab = (typeof TABS)[number];
const EDIT_ROLES = new Set(["field_officer", "regional_admin", "national_admin", "supply_chain_analyst", "supply_chain_admin", "enterprise_analyst", "enterprise_admin", "platform_admin"]);

function SustainabilityInner() {
  const [tab, setTab] = useTab<Tab>(TABS, "programme");
  const [opts, setOpts] = useState<ProgOpts>({ priceUsd: 15, targetAdoptionPct: 50, efMode: "global", deductionPct: 15 });
  const deferred = useDeferredValue(opts);
  const me = trpc.workspace.me.useQuery();
  const utils = trpc.useUtils();
  const prog = trpc.sustainability.carbon.programme.useQuery(deferred, { placeholderData: keepPreviousData, staleTime: 60_000 });
  const refresh = trpc.sustainability.yield.refresh.useMutation({ onSuccess: () => (utils.sustainability.carbon.invalidate(), utils.sustainability.esg.invalidate(), utils.sustainability.yield.invalidate()) });
  const exp = trpc.sustainability.esg.recordExport.useMutation();
  const canEdit = EDIT_ROLES.has(me.data?.user.role ?? "");
  const preparedBy = me.data ? `${me.data.user.name}${me.data.user.title ? `, ${me.data.user.title}` : ""}` : "Agri-SHIELD user";
  const orgName = me.data?.org?.name ?? "Workspace";
  const p = prog.data;

  return (
    <div>
      <SectionHeader
        eyebrow="Workspace · Sustainability & Carbon"
        title="Carbon MRV & sustainability"
        description={
          <>
            Measure the greenhouse gases from the crops you finance, insure or buy, track farmers switching to <Explain text="Alternate Wetting and Drying: irrigated rice is drained until the water is ~15 cm below the soil surface, then re-flooded. It cuts methane by ~45 % (IPCC) and irrigation water by 25-30 %.">alternate wetting and drying (AWD)</Explain>, and see the avoided emissions, water saved and an indicative carbon-credit value — using IPCC 2019 Tier 1 factors with every assumption shown.
          </>
        }
        actions={
          <Btn variant="outline" loading={refresh.isPending || prog.isFetching} onClick={() => refresh.mutate()}>
            <RefreshCw size={13} /> Recompute
          </Btn>
        }
      />
      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "programme", label: "Carbon programme", icon: Leaf },
          { value: "farms", label: "Adoption tracker", icon: Sprout, badge: p ? <span className="telemetry ml-1 rounded bg-white/10 px-1 text-[10.5px]">{p.totals.adoptedAssets}/{p.totals.eligibleAssets}</span> : undefined },
          { value: "water", label: "Water", icon: Droplets },
          { value: "esg", label: "ESG summary", icon: ShieldCheck },
          { value: "evidence", label: "Evidence pack", icon: FileCheck2 },
        ]}
      />
      <ErrorBox error={prog.error} onRetry={() => prog.refetch()} />
      {tab === "esg" ? (
        <Esg preparedBy={preparedBy} />
      ) : !p ? (
        !prog.error && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-[68px]" />
              ))}
            </div>
            <Skeleton className="h-[380px]" />
            <p className="flex items-center justify-center gap-1.5 text-[12px] text-slate-500">
              <BarChart3 size={12} /> Loading season lengths and yields from the forecast engine…
            </p>
          </div>
        )
      ) : tab === "farms" ? (
        <Farms p={p} canEdit={canEdit} onExport={() => exp.mutate({ kind: "mrv_csv" })} />
      ) : tab === "water" ? (
        <Water p={p} />
      ) : tab === "evidence" ? (
        <Evidence p={p} orgName={orgName} preparedBy={preparedBy} />
      ) : (
        <Programme p={p} opts={opts} setOpts={setOpts} onOpenFarms={() => setTab("farms")} />
      )}
    </div>
  );
}

export default function SustainabilityPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <SustainabilityInner />
    </Suspense>
  );
}
