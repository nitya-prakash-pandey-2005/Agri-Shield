"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Eye, MailCheck, ScrollText, Send } from "lucide-react";
import { EmptyState, HudButton, Panel, RiskPill, SectionHeader, Skeleton, StatTile } from "@/components/hud";
import { DataTable, ErrorNote, SearchInput, Select, StatusBadge, Td, TimeAgo, fmtNum, fmtPct } from "@/components/admin/ui";
import { TabBar, downloadCsv, useDebounced } from "@/components/admin/Overlay";
import { trpc } from "@/lib/trpc";

type Tab = "alerts" | "all";
type AType = "flood" | "salinity" | "drought" | "storm" | "frost";
type Sev = "watch" | "warning" | "emergency";
type Src = "model" | "manual" | "gdacs" | "eonet";

const SOURCE_STYLE: Record<string, string> = {
  model: "bg-violet-500/15 text-violet-300",
  manual: "bg-sky-500/15 text-sky-300",
  gdacs: "bg-amber-500/15 text-amber-300",
  eonet: "bg-emerald-500/15 text-emerald-300",
};

function AlertAudit() {
  const [type, setType] = useState<AType | "">("");
  const [severity, setSeverity] = useState<Sev | "">("");
  const [source, setSource] = useState<Src | "">("");
  const [district, setDistrict] = useState<string>("");
  const [activeOnly, setActiveOnly] = useState(false);
  const q = trpc.admin.alertAudit.useQuery(
    { type: type || undefined, severity: severity || undefined, source: source || undefined, districtId: district || undefined, activeOnly, limit: 300 },
    { placeholderData: (p) => p }
  );
  const d = q.data;
  const t = d?.totals;

  return (
    <div className="space-y-4">
      <ErrorNote error={q.error} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {!t ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[104px]" />)
        ) : (
          <>
            <StatTile label="Sent" value={t.sent} icon={Send} accent="violet" delta={`${fmtNum(d!.total)} alerts`} deltaGood />
            <StatTile label="Delivered" value={t.delivered} icon={MailCheck} accent="cyan" delta={`${fmtPct(t.delivered / Math.max(1, t.sent), 1)} of sent`} deltaGood />
            <StatTile label="Read" value={t.read} icon={Eye} accent="amber" delta={`${fmtPct(t.read / Math.max(1, t.delivered), 1)} of delivered`} deltaGood />
            <StatTile label="Actioned" value={t.actioned} icon={CheckCircle2} accent="emerald" delta={`${fmtPct(t.actioned / Math.max(1, t.read), 1)} of read`} deltaGood />
          </>
        )}
      </div>

      <Panel
        title="Alert audit log"
        subtitle="Every alert with origin, author, validity and delivery funnel"
        icon={AlertTriangle}
        accent="amber"
        actions={
          <HudButton
            variant="outline"
            className="h-8 text-xs"
            disabled={!d?.rows.length}
            onClick={() =>
              d &&
              downloadCsv(
                `agri-shield-alert-audit-${new Date().toISOString().slice(0, 10)}.csv`,
                d.rows.map((r) => ({ id: r.id, created_at: r.createdAt, type: r.alertType, severity: r.severity, district: r.district, source: r.source, created_by: r.createdBy, active: r.isActive, valid_until: r.validUntil, probability: r.probability, sent: r.deliveries.sent, delivered: r.deliveries.delivered, read: r.deliveries.read, actioned: r.deliveries.actioned, title: r.title }))
              )
            }
          >
            <Download size={13} /> CSV
          </HudButton>
        }
      >
        <div className="mb-3 flex flex-wrap gap-2">
          <Select<AType> label="Type" value={type} onChange={setType} options={[{ value: "", label: "All types" }, ...(["flood", "salinity", "drought", "storm", "frost"] as const).map((v) => ({ value: v, label: v }))]} />
          <Select<Sev> label="Severity" value={severity} onChange={setSeverity} options={[{ value: "", label: "Any severity" }, ...(["watch", "warning", "emergency"] as const).map((v) => ({ value: v, label: v }))]} />
          <Select<Src> label="Source" value={source} onChange={setSource} options={[{ value: "", label: "Any source" }, ...(["model", "manual", "gdacs", "eonet"] as const).map((v) => ({ value: v, label: v }))]} />
          <Select<string> label="District" value={district} onChange={setDistrict} options={[{ value: "", label: "All districts" }, ...(d?.districts ?? []).map((x) => ({ value: x.id, label: `${x.name} (${x.country})` }))]} />
          <label className="inline-flex items-center gap-2 text-[12.5px] text-slate-300 px-1">
            <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} className="accent-violet-500" /> Active only
          </label>
        </div>

        {!d ? (
          <Skeleton className="h-64" />
        ) : d.rows.length === 0 ? (
          <EmptyState icon={AlertTriangle} title="No alerts match these filters" />
        ) : (
          <div className="max-h-[620px] overflow-y-auto">
            <DataTable head={["Created", "Severity", "Alert", "District", "Source", "Created by", "Deliveries (sent / read / actioned)", "State"]}>
              {d.rows.map((a) => (
                <tr key={a.id} className="hover:bg-white/[0.02]">
                  <Td>
                    <TimeAgo date={a.createdAt} className="text-slate-400 whitespace-nowrap" />
                  </Td>
                  <Td>
                    <RiskPill level={a.severity} />
                  </Td>
                  <Td>
                    <div className="text-slate-100 max-w-[320px] truncate" title={a.title}>
                      {a.title}
                    </div>
                    <div className="telemetry text-[10.5px] text-slate-500">
                      {a.alertType} · p={a.probability} · {a.channels.join("/")}
                    </div>
                  </Td>
                  <Td className="text-slate-400 whitespace-nowrap">{a.district}</Td>
                  <Td>
                    <span className={`telemetry rounded px-1.5 py-0.5 text-[10.5px] uppercase ${SOURCE_STYLE[a.source] ?? ""}`}>{a.source}</span>
                  </Td>
                  <Td className="text-slate-400">{a.createdBy}</Td>
                  <Td mono>
                    {fmtNum(a.deliveries.sent)} / {fmtNum(a.deliveries.read)} / <span className="text-emerald-300">{fmtNum(a.deliveries.actioned)}</span>
                  </Td>
                  <Td>{a.isActive ? <StatusBadge status="active" pulse /> : <StatusBadge status="cancelled" label="expired" />}</Td>
                </tr>
              ))}
            </DataTable>
          </div>
        )}
      </Panel>
    </div>
  );
}

const SINCE: { value: string; label: string; hours?: number }[] = [
  { value: "", label: "All time" },
  { value: "1", label: "Last hour", hours: 1 },
  { value: "24", label: "Last 24 h", hours: 24 },
  { value: "168", label: "Last 7 days", hours: 168 },
  { value: "720", label: "Last 30 days", hours: 720 },
];

function FullAudit() {
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [entity, setEntity] = useState("");
  const [since, setSince] = useState("");
  const dq = useDebounced(q, 250);
  const query = trpc.admin.audit.useQuery(
    { q: dq || undefined, action: action || undefined, entity: entity || undefined, sinceHours: since ? Number(since) : undefined, limit: 500 },
    { placeholderData: (p) => p, refetchInterval: 20_000 }
  );
  const d = query.data;

  return (
    <Panel
      title="Full audit log"
      subtitle={d ? `${fmtNum(d.total)} entries · create/update/delete operations with actor and timestamp (spec §18)` : undefined}
      icon={ScrollText}
      accent="violet"
      actions={
        <HudButton
          variant="outline"
          className="h-8 text-xs"
          disabled={!d?.rows.length}
          onClick={() => d && downloadCsv(`agri-shield-audit-${new Date().toISOString().slice(0, 10)}.csv`, d.rows.map((r) => ({ id: r.id, at: r.at, user_id: r.userId, user: r.userName, action: r.action, entity: r.entity, entity_id: r.entityId, details: r.details })))}
        >
          <Download size={13} /> CSV
        </HudButton>
      }
    >
      <ErrorNote error={query.error} />
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Actor, entity id or details…" />
        <Select<string> label="Action" value={action} onChange={setAction} options={[{ value: "", label: "All actions" }, ...(d?.actions ?? []).map((a) => ({ value: a, label: a }))]} />
        <Select<string> label="Entity" value={entity} onChange={setEntity} options={[{ value: "", label: "All entities" }, ...(d?.entities ?? []).map((a) => ({ value: a, label: a }))]} />
        <Select<string> label="Time window" value={since} onChange={setSince} options={SINCE.map((s) => ({ value: s.value, label: s.label }))} />
      </div>
      {!d ? (
        <Skeleton className="h-64" />
      ) : d.rows.length === 0 ? (
        <EmptyState icon={ScrollText} title="No audit entries match" />
      ) : (
        <div className="max-h-[640px] overflow-y-auto">
          <DataTable head={["Time", "Actor", "Action", "Entity", "Details"]}>
            {d.rows.map((a) => (
              <tr key={a.id} className="hover:bg-white/[0.02]">
                <Td className="whitespace-nowrap">
                  <TimeAgo date={a.at} className="text-slate-400" />
                  <div className="telemetry text-[10px] text-slate-600">{new Date(a.at).toISOString().replace("T", " ").slice(0, 19)}</div>
                </Td>
                <Td>
                  <div className="text-slate-100">{a.userName}</div>
                  <div className="telemetry text-[10px] text-slate-500">{a.userId}</div>
                </Td>
                <Td>
                  <span className="telemetry rounded bg-violet-500/10 px-1.5 py-0.5 text-[10.5px] text-violet-300 whitespace-nowrap">{a.action}</span>
                </Td>
                <Td mono className="text-slate-400">
                  {a.entity}:<span className="text-slate-300">{a.entityId}</span>
                </Td>
                <Td className="text-slate-300 max-w-[460px]">{a.details}</Td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}
    </Panel>
  );
}

export default function AdminAuditPage() {
  const [tab, setTab] = useState<Tab>("alerts");
  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow="Compliance"
        title="Audit logs"
        description="Immutable trail of every alert raised (model, manual, GDACS/EONET) and every administrative action. Export to CSV for regulators and donors."
        actions={
          <TabBar<Tab>
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "alerts", label: "Alert audit" },
              { value: "all", label: "Full audit log" },
            ]}
          />
        }
      />
      {tab === "alerts" ? <AlertAudit /> : <FullAudit />}
    </div>
  );
}
