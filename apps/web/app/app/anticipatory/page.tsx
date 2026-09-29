"use client";

/**
 * Anticipatory Action — forecast-based trigger protocols, live status per
 * community, activation workflow with audit trail, trigger backtests and the
 * pre-arranged cash calculator.
 */
import { Suspense } from "react";
import { useSession } from "next-auth/react";
import { Calculator, History, Radio, Siren } from "lucide-react";
import { SectionHeader, Skeleton } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import Activations from "@/components/anticipatory/Activations";
import CashCalc from "@/components/anticipatory/CashCalc";
import Protocols from "@/components/anticipatory/Protocols";
import Status from "@/components/anticipatory/Status";
import { TabBar, useTab } from "@/components/insurance/kit";
import { can } from "@/lib/rbac";
import { trpc } from "@/lib/trpc";

const TABS = ["status", "protocols", "activations", "cash"] as const;
type Tab = (typeof TABS)[number];

function AaInner() {
  const { data: session } = useSession();
  const canWrite = can(session?.user?.role, "manage_assets");
  const [tab, setTab] = useTab<Tab>(TABS, "status");
  const acts = trpc.insurance.aa.activations.useQuery();
  const open = (acts.data ?? []).filter((a) => !["reviewed", "cancelled", "completed"].includes(a.status)).length;
  return (
    <div>
      <SectionHeader
        eyebrow="Workspace · Anticipatory Action"
        title="Act before the flood"
        description={
          <>
            Pre-agree <Explain term="anticipatory_action">forecast triggers</Explain>, watch every community against them live, release pre-arranged cash with enough <Explain term="lead_time">lead time</Explain>, and prove the trigger works on 30+ years of history.
          </>
        }
      />
      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "status", label: "Live status", icon: Radio },
          { value: "protocols", label: "Protocols & backtest", icon: History },
          { value: "activations", label: "Activations", icon: Siren, badge: open ? <span className="rounded-full bg-rose-500 px-1.5 text-[10px] text-white">{open}</span> : undefined },
          { value: "cash", label: "Cash calculator", icon: Calculator },
        ]}
      />
      {tab === "status" ? <Status canWrite={canWrite} goActivations={() => setTab("activations")} /> : tab === "protocols" ? <Protocols canWrite={canWrite} /> : tab === "activations" ? <Activations canWrite={canWrite} /> : <CashCalc />}
    </div>
  );
}

export default function AnticipatoryPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[600px]" />}>
      <AaInner />
    </Suspense>
  );
}
