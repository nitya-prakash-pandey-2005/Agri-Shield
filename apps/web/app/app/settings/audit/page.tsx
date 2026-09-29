"use client";

import { useDeferredValue, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { Download, ScrollText, Search } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { EmptyState, Panel, Skeleton } from "@/components/hud";
import { Btn, downloadBlob, inputCls, toCsv } from "@/components/workspace/ui";
import { cn } from "@/lib/utils";

const COLOR: Record<string, string> = { auth: "#38bdf8", team: "#a78bfa", billing: "#f59e0b", workspace: "#10b981", apikey: "#f472b6", webhook: "#22d3ee", report: "#84cc16", security: "#fb7185" };

export default function AuditSettings() {
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [userId, setUserId] = useState("");
  const dq = useDeferredValue(q);
  const res = trpc.workspace.auditLog.useQuery({ q: dq || undefined, action: action || undefined, userId: userId || undefined, limit: 300 });
  const d = res.data;

  const exportCsv = () => {
    if (!d) return;
    downloadBlob(
      `audit-log-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(["time_utc", "user", "action", "entity", "entity_id", "details"], d.rows.map((r) => [new Date(r.at).toISOString(), r.userName, r.action, r.entity, r.entityId, r.details])),
      "text/csv"
    );
  };

  return (
    <Panel
      title="Audit log"
      subtitle="Every sign-in and change made by members of this workspace"
      icon={ScrollText}
      accent="cyan"
      actions={
        <Btn variant="outline" className="h-8 px-2.5 py-0 text-xs" onClick={exportCsv} disabled={!d?.rows.length}>
          <Download size={13} /> CSV
        </Btn>
      }
    >
      <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_180px_180px]">
        <label className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input className={cn(inputCls, "pl-8")} placeholder="Search actions, people, details…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search audit log" />
        </label>
        <select className={inputCls} value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filter by action">
          <option value="">All actions</option>
          {d?.actions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select className={inputCls} value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Filter by person">
          <option value="">Everyone</option>
          {d?.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>
      {!d ? (
        <div className="space-y-2">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-9" />)}</div>
      ) : d.rows.length === 0 ? (
        <EmptyState icon={ScrollText} title="No matching events" />
      ) : (
        <>
          <div className="mb-2 text-[11.5px] text-slate-500">
            Showing {d.rows.length} of {d.total} events
          </div>
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-[12.5px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-2 py-2 font-medium">Who</th>
                  <th className="px-2 py-2 font-medium">Action</th>
                  <th className="px-4 py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {d.rows.map((r) => {
                  const c = COLOR[r.action.split(".")[0]!] ?? "#94a3b8";
                  return (
                    <tr key={r.id} className="hover:bg-white/[0.015]">
                      <td className="whitespace-nowrap px-4 py-2 text-slate-400" title={new Date(r.at).toISOString()}>
                        {formatDistanceToNowStrict(new Date(r.at), { addSuffix: true })}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-slate-200">{r.userName}</td>
                      <td className="px-2 py-2">
                        <span className="telemetry rounded px-1.5 py-0.5 text-[11px]" style={{ background: `${c}1a`, color: c }}>
                          {r.action}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-400">{r.details}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}
