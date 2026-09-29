"use client";

/**
 * Insurance module — parametric product designer & backtester, live trigger
 * monitor, claims validation and book/PML view.
 */
import { Suspense, useCallback, useState } from "react";
import { useSession } from "next-auth/react";
import { FileSearch, FlaskConical, Layers, Radar } from "lucide-react";
import { SectionHeader, Skeleton } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import Book from "@/components/insurance/Book";
import Claims from "@/components/insurance/Claims";
import Designer from "@/components/insurance/Designer";
import Monitor from "@/components/insurance/Monitor";
import { ErrorBox, TabBar, useTab } from "@/components/insurance/kit";
import { can } from "@/lib/rbac";
import { trpc, type RouterOutputs } from "@/lib/trpc";

const TABS = ["designer", "monitor", "claims", "book"] as const;
type Tab = (typeof TABS)[number];
type Product = RouterOutputs["insurance"]["products"][number];

function InsuranceInner() {
  const { data: session } = useSession();
  const canWrite = can(session?.user?.role, "manage_assets");
  const [tab, setTab] = useTab<Tab>(TABS, "designer");
  const meta = trpc.insurance.meta.useQuery();
  const [editing, setEditing] = useState<Product | null>(null);
  const clearEditing = useCallback(() => setEditing(null), []);
  const me = trpc.workspace.me.useQuery();

  return (
    <div>
      <SectionHeader
        eyebrow="Workspace · Insurance"
        title="Parametric & crop insurance"
        description={
          <>
            Design <Explain term="parametric">index covers</Explain> and price them on 35 years of real weather and river data, watch live triggers across your book, validate claims against independent evidence, and size your <Explain term="pml">PML</Explain> and reinsurance.
          </>
        }
      />
      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "designer", label: "Product designer", icon: FlaskConical },
          { value: "monitor", label: "Live trigger monitor", icon: Radar },
          { value: "claims", label: "Claims validation", icon: FileSearch },
          { value: "book", label: "Portfolio & PML", icon: Layers },
        ]}
      />
      <ErrorBox error={meta.error} onRetry={() => meta.refetch()} />
      {!meta.data ? (
        <Skeleton className="h-[600px]" />
      ) : tab === "designer" ? (
        <Designer meta={meta.data} editing={editing} onEdited={clearEditing} />
      ) : tab === "monitor" ? (
        <Monitor />
      ) : tab === "claims" ? (
        <Claims meta={meta.data} orgName={me.data?.org?.name ?? "Insurer workspace"} />
      ) : (
        <Book
          canWrite={canWrite}
          onEdit={(p) => {
            setEditing(p);
            setTab("designer");
          }}
        />
      )}
    </div>
  );
}

export default function InsurancePage() {
  return (
    <Suspense fallback={<Skeleton className="h-[600px]" />}>
      <InsuranceInner />
    </Suspense>
  );
}
