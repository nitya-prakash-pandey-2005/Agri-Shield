"use client";

/**
 * Live ops feed: realtime events (SSE / Socket.io) on top, audit trail below.
 */
import { AnimatePresence, motion } from "framer-motion";
import { Activity, Bell, CheckCircle2, FileEdit, Radio, ShieldAlert, Truck, XCircle } from "lucide-react";
import type { RealtimeEnvelope } from "@/server/realtime";
import { trpc } from "@/lib/trpc";
import { Panel, Skeleton, SourceTag, EmptyState } from "@/components/hud";
import { useGovInput, useGovStore } from "./scope";
import { ago, hhmm, SEVERITY_COLOR, STATUS_COLOR } from "./ui";

function describe(env: RealtimeEnvelope): { text: string; color: string; icon: typeof Bell } {
  const e = env.event;
  switch (e.type) {
    case "alert.created":
      return { text: `${e.severity.toUpperCase()} · ${e.title}`, color: SEVERITY_COLOR[e.severity] ?? "#fb923c", icon: Bell };
    case "resource.updated":
      return { text: `Request ${e.requestId} → ${e.status}`, color: STATUS_COLOR[e.status] ?? "#38bdf8", icon: Truck };
    case "alert.actioned":
      return { text: `Farmer ${e.farmerId} actioned alert ${e.alertId}`, color: "#10b981", icon: CheckCircle2 };
    case "risk.updated":
      return { text: `Risk overlay updated for ${e.districtIds.length} districts`, color: "#38bdf8", icon: Radio };
    case "scan.completed":
      return { text: `Climate scan complete · ${e.alertsCreated} new alert(s)`, color: "#a78bfa", icon: Activity };
    case "sms.inbound":
      return { text: `Inbound SMS ${e.command} from ${e.from}`, color: "#94a3b8", icon: Activity };
    case "alert.escalated":
      return { text: `ESCALATED ${e.from.toUpperCase()} → ${e.to.toUpperCase()} · ${e.title}`, color: "#f87171", icon: ShieldAlert };
    default:
      return { text: e.type, color: "#94a3b8", icon: Activity };
  }
}

const AUDIT_ICON: Record<string, { icon: typeof Bell; color: string }> = {
  "alert.create": { icon: Bell, color: "#fb923c" },
  "alert.escalate": { icon: ShieldAlert, color: "#f87171" },
  "alert.schedule": { icon: Bell, color: "#facc15" },
  "resource.request": { icon: Truck, color: STATUS_COLOR.pending! },
  "resource.approve": { icon: CheckCircle2, color: STATUS_COLOR.approved! },
  "resource.dispatch": { icon: Truck, color: STATUS_COLOR.dispatched! },
  "resource.deliver": { icon: CheckCircle2, color: STATUS_COLOR.delivered! },
  "resource.reject": { icon: XCircle, color: STATUS_COLOR.rejected! },
  "resource.modify": { icon: FileEdit, color: "#94a3b8" },
};

export function OpsFeed({ className }: { className?: string }) {
  const scope = useGovInput();
  const events = useGovStore((s) => s.events);
  const feed = trpc.government.getOpsFeed.useQuery(scope, { refetchInterval: 60_000 });

  return (
    <Panel title="Ops feed" subtitle="Realtime events + audit trail" icon={Activity} live className={className} bodyClassName="max-h-[420px] overflow-y-auto" actions={<SourceTag>Audit log</SourceTag>}>
      <ul className="space-y-1">
        <AnimatePresence initial={false}>
          {events.map((env) => {
            const { text, color, icon: Icon } = describe(env);
            return (
              <motion.li
                key={`${env.at}-${env.event.type}-${text}`}
                initial={{ opacity: 0, x: 24, height: 0 }}
                animate={{ opacity: 1, x: 0, height: "auto" }}
                exit={{ opacity: 0 }}
                className="flex items-start gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/[0.05] px-2 py-1.5"
              >
                <Icon size={13} style={{ color }} className="mt-0.5 shrink-0" />
                <span className="flex-1 text-xs text-slate-100">{text}</span>
                <span className="telemetry text-[10px] text-emerald-300">{hhmm(env.at)}</span>
              </motion.li>
            );
          })}
        </AnimatePresence>
        {feed.isLoading &&
          Array.from({ length: 6 }, (_, i) => (
            <li key={i}>
              <Skeleton className="h-8" />
            </li>
          ))}
        {feed.data?.map((a) => {
          const m = AUDIT_ICON[a.kind] ?? { icon: Activity, color: "#64748b" };
          const Icon = m.icon;
          return (
            <li key={a.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-white/[0.03]">
              <Icon size={13} style={{ color: m.color }} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-xs text-slate-300 line-clamp-2">{a.text}</div>
                <div className="telemetry text-[10px] text-slate-500">
                  {a.actor} · {ago(a.at)}
                </div>
              </div>
            </li>
          );
        })}
        {feed.data && !feed.data.length && !events.length && <EmptyState icon={Activity} title="No activity yet" />}
      </ul>
    </Panel>
  );
}
