"use client";

/**
 * Resource Management (spec §4.5): inventory, depot map with coverage radii,
 * request queue (approve / reject / modify), dispatch wizard, real-time
 * Pending → Approved → Dispatched → Delivered tracking, shortage alerts.
 */
import { useMemo, useState } from "react";
import { Hourglass, Navigation, PackageCheck, Plus, Truck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { HudButton, LiveDot, SectionHeader, Skeleton, StatTile } from "@/components/hud";
import { DispatchModal, type DispatchTarget } from "@/components/government/DispatchModal";
import { useGovInput } from "@/components/government/scope";
import { InventoryTable, ShortageBanner } from "@/components/government/resources-inventory";
import { DepotMap } from "@/components/government/resources-map";
import { RequestQueue } from "@/components/government/resources-queue";
import { RequestKanban } from "@/components/government/resources-kanban";
import { ModifyModal, NewRequestModal, RejectModal, TimelineModal, type RequestRow } from "@/components/government/resources-actions";

const DAY = 86_400_000;

export default function ResourcesPage() {
  const scope = useGovInput();
  const ctx = trpc.government.getContext.useQuery(scope);
  const inv = trpc.government.getResourceInventory.useQuery(scope);
  const reqs = trpc.government.getResourceRequests.useQuery(scope);

  const [dispatchTarget, setDispatchTarget] = useState<DispatchTarget | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [modifyId, setModifyId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [timelineId, setTimelineId] = useState<string | null>(null);

  const requests = reqs.data ?? [];
  const byId = (id: string | null) => (id ? requests.find((r) => r.id === id) ?? null : null);
  const perms = ctx.data?.permissions;
  const canApprove = perms?.approveResources ?? false;
  const canRequest = perms?.requestResources ?? false;

  const stats = useMemo(() => {
    const now = Date.now();
    const fleet = inv.data?.fleet ?? [];
    return {
      pending: requests.filter((r) => r.status === "pending").length,
      criticalPending: requests.filter((r) => r.status === "pending" && r.priority === "critical").length,
      transit: requests.filter((r) => r.status === "dispatched").length,
      transitUnits: requests.filter((r) => r.status === "dispatched").reduce((s, r) => s + r.quantity, 0),
      delivered7d: requests.filter((r) => r.status === "delivered" && r.timeline.some((t) => t.status === "delivered" && +new Date(t.at) > now - 7 * DAY)).length,
      fleetFree: fleet.filter((v) => !v.busyWith).length,
      fleetTotal: fleet.length,
    };
  }, [requests, inv.data]);

  const resources = (inv.data?.rows ?? []).map((r) => ({ type: r.type, label: r.label, unit: r.unit }));
  const districts = ctx.data?.districts ?? [];
  const loadingTop = reqs.isLoading || inv.isLoading;

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow="Resource Management"
        title="Resources & Logistics"
        description={ctx.data ? `${ctx.data.orgName} · depot stock, request approvals and dispatch tracking across ${districts.length} districts.` : "Depot stock, request approvals and dispatch tracking."}
        actions={
          <>
            <LiveDot label="REALTIME" />
            {canRequest && (
              <HudButton onClick={() => setNewOpen(true)}>
                <Plus size={14} /> New request
              </HudButton>
            )}
          </>
        }
      />

      <ShortageBanner />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {loadingTop ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[104px]" />)
        ) : (
          <>
            <StatTile label="Requests pending" value={stats.pending} icon={Hourglass} accent="amber" delta={stats.criticalPending ? `${stats.criticalPending} critical priority` : "none critical"} deltaGood={!stats.criticalPending} />
            <StatTile label="In transit" value={stats.transit} icon={Truck} accent="violet" unit="dispatches" delta={`${stats.transitUnits.toLocaleString()} units on the road`} deltaGood />
            <StatTile label="Delivered (7d)" value={stats.delivered7d} icon={PackageCheck} accent="emerald" unit="requests" />
            <StatTile
              label="Fleet available"
              value={stats.fleetFree}
              unit={`/ ${stats.fleetTotal}`}
              icon={Navigation}
              accent="cyan"
              delta={`${stats.fleetTotal - stats.fleetFree} on assignment`}
              deltaGood={stats.fleetFree > stats.fleetTotal / 3}
            />
          </>
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <DepotMap />
        </div>
        <div className="xl:col-span-2">
          <RequestQueue
            requests={requests}
            loading={reqs.isLoading}
            error={reqs.error}
            canApprove={canApprove}
            canRequest={canRequest}
            onModify={(r) => setModifyId(r.id)}
            onReject={(r) => setRejectId(r.id)}
            onOpen={(r) => setTimelineId(r.id)}
          />
        </div>
      </div>

      <RequestKanban
        requests={requests}
        loading={reqs.isLoading}
        error={reqs.error}
        canApprove={canApprove}
        canRequest={canRequest}
        onOpen={(r) => setTimelineId(r.id)}
        onDispatch={(r: RequestRow) => setDispatchTarget({ kind: "request", request: r })}
      />

      <InventoryTable />

      <DispatchModal open={!!dispatchTarget} onClose={() => setDispatchTarget(null)} target={dispatchTarget} />
      <NewRequestModal open={newOpen} onClose={() => setNewOpen(false)} resources={resources} districts={districts} />
      <ModifyModal request={byId(modifyId)} onClose={() => setModifyId(null)} resources={resources} districts={districts} />
      <RejectModal request={byId(rejectId)} onClose={() => setRejectId(null)} />
      <TimelineModal request={byId(timelineId)} onClose={() => setTimelineId(null)} />
    </div>
  );
}
