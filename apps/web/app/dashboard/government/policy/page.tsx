"use client";

import { Landmark } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Panel, SectionHeader, Skeleton, SourceTag } from "@/components/hud";
import { useGovInput } from "@/components/government/scope";
import { ErrorNote } from "@/components/government/ui";
import { PolicyBriefs } from "@/components/government/policy-briefs";
import { BudgetPlanner } from "@/components/government/policy-budget";
import { InfrastructureGaps } from "@/components/government/policy-gaps";

export default function GovPolicyPage() {
  const scope = useGovInput();
  const briefs = trpc.government.getPolicyBriefs.useQuery(scope);
  const gaps = trpc.government.getInfrastructureGaps.useQuery(scope);
  const ctx = trpc.government.getContext.useQuery(scope);

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Policy recommendations"
        title={briefs.data ? `Investment priorities · ${briefs.data.quarter}` : "Investment priorities"}
        description="Briefs are generated from live flood and salinity risk, the expected-loss model and each district's flood archive. Use the planner to test alternative portfolios before submission."
        actions={
          <>
            <SourceTag>Open-Meteo</SourceTag>
            <SourceTag>GloFAS</SourceTag>
            <SourceTag>Model v2.3.1</SourceTag>
          </>
        }
      />

      <ErrorNote error={briefs.error ?? gaps.error} />

      {briefs.data ? (
        briefs.data.briefs.length ? (
          <PolicyBriefs data={briefs.data} />
        ) : (
          <Panel title="Policy briefs" icon={Landmark}>
            <p className="text-sm text-slate-400">No districts in this jurisdiction yet.</p>
          </Panel>
        )
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[440px]" />
          ))}
        </div>
      )}

      {briefs.data ? <BudgetPlanner data={briefs.data} /> : <Skeleton className="h-[560px]" />}

      {gaps.data && ctx.data ? <InfrastructureGaps data={gaps.data} center={ctx.data.center} fitKey={ctx.data.orgId} /> : <Skeleton className="h-[440px]" />}
    </div>
  );
}
