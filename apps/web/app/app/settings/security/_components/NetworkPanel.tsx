"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, FileCheck2, Globe2, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Panel } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { Btn, Field, Toggle, downloadBlob, inputCls } from "@/components/workspace/ui";
import { Hint, Pill, toastErr } from "./shared";

export function IpAllowlistPanel({ policy, currentIp, onChanged }: { policy: { enabled: boolean; entries: { cidr: string; label: string }[] }; currentIp: string; onChanged: () => void }) {
  const save = trpc.developer.security.setIpAllowlist.useMutation();
  const [enabled, setEnabled] = useState(policy.enabled);
  const [rows, setRows] = useState(policy.entries.length ? policy.entries : [{ cidr: "", label: "" }]);
  useEffect(() => {
    setEnabled(policy.enabled);
    setRows(policy.entries.length ? policy.entries : [{ cidr: "", label: "" }]);
  }, [policy]);
  const myIp = currentIp === "local" ? "127.0.0.1" : currentIp;
  const dirty = enabled !== policy.enabled || JSON.stringify(rows.filter((r) => r.cidr.trim())) !== JSON.stringify(policy.entries);

  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          IP allow-list <Explain text="Only requests from these addresses or ranges (CIDR, e.g. 203.0.113.0/24) can use this workspace. Everyone else gets “blocked by your workspace's IP allow-list”, even with a valid session. Typical entries: office egress IPs and your VPN range." title="IP allow-list" />
        </span>
      }
      subtitle={policy.enabled ? `${policy.entries.length} range(s) enforced` : "Off — any network can reach the workspace"}
      icon={Globe2}
      accent="amber"
      actions={policy.enabled ? <Pill tone="emerald">Enforced</Pill> : <Pill>Off</Pill>}
    >
      <div className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3.5 py-3">
        <div>
          <div className="text-[13px] text-slate-100">Restrict access to these networks</div>
          <div className="telemetry text-[11px] text-slate-500">Your current address: {myIp}</div>
        </div>
        <Toggle checked={enabled} onChange={setEnabled} label="Enforce IP allow-list" />
      </div>
      <ul className="mt-3 space-y-2">
        {rows.map((r, i) => (
          <li key={i} className="flex gap-2">
            <input className={`${inputCls} telemetry flex-[1.2]`} value={r.cidr} placeholder="203.0.113.0/24 or 2001:db8::/32" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, cidr: e.target.value } : x)))} aria-label="Address or CIDR range" spellCheck={false} />
            <input className={`${inputCls} flex-1`} value={r.label} placeholder="Label (e.g. Hanoi office)" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} aria-label="Label" />
            <button aria-label="Remove" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-rose-500/10 hover:text-rose-300" onClick={() => setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : [{ cidr: "", label: "" }])}>
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <Btn variant="ghost" onClick={() => setRows([...rows.filter((x) => x.cidr.trim()), { cidr: "", label: "" }])}>
          <Plus size={14} /> Add range
        </Btn>
        <Btn variant="ghost" onClick={() => !rows.some((x) => x.cidr === myIp) && setRows([...rows.filter((x) => x.cidr.trim()), { cidr: myIp, label: "My current address" }])}>
          <Plus size={14} /> Add my address
        </Btn>
        <Btn
          className="ml-auto"
          disabled={!dirty || save.isPending}
          onClick={async () => {
            try {
              await save.mutateAsync({ enabled, entries: rows.filter((x) => x.cidr.trim()) });
              toast.success(enabled ? "IP allow-list enforced" : "IP allow-list saved (not enforced)");
              onChanged();
            } catch (e) {
              toastErr(e);
            }
          }}
        >
          {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
        </Btn>
      </div>
      <div className="mt-3">
        <Hint>We refuse to save a list that doesn't include your own address, so you can't lock yourself out. Agri-SHIELD platform staff are never blocked (support access is audited).</Hint>
      </div>
    </Panel>
  );
}

export function AuditExportPanel() {
  const exp = trpc.developer.security.auditExport.useMutation();
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const [prefix, setPrefix] = useState("");
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [last, setLast] = useState<{ rows: number; sha256: string; filename: string } | null>(null);
  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          Audit log export <Explain text="Download every audited action in this workspace (sign-ins, 2FA and role changes, API keys, exports, deletions…) for your SIEM or auditors. The SHA-256 fingerprint lets you prove the file wasn't altered after export." title="Audit export" />
        </span>
      }
      subtitle="CSV or JSON with a SHA-256 fingerprint"
      icon={FileCheck2}
      accent="cyan"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From">
          <input type="date" className={inputCls} value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <input type="date" className={inputCls} value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Events">
          <select className={inputCls} value={prefix} onChange={(e) => setPrefix(e.target.value)}>
            <option value="">All events</option>
            <option value="auth.">Sign-ins &amp; 2-step challenges</option>
            <option value="security.">Security settings, roles &amp; sessions</option>
            <option value="apikey.">API keys</option>
            <option value="workspace.">Workspace (exports, deletion)</option>
            <option value="user.">Users (sign-up, SSO provisioning)</option>
          </select>
        </Field>
        <Field label="Format">
          <select className={inputCls} value={format} onChange={(e) => setFormat(e.target.value as "csv" | "json")}>
            <option value="csv">CSV (Excel, SIEM)</option>
            <option value="json">JSON</option>
          </select>
        </Field>
      </div>
      <Btn
        className="mt-3"
        disabled={exp.isPending}
        onClick={async () => {
          try {
            const r = await exp.mutateAsync({ from, to, prefix: prefix || undefined, format });
            downloadBlob(r.filename, r.content, r.format === "csv" ? "text/csv" : "application/json");
            setLast({ rows: r.rows, sha256: r.sha256, filename: r.filename });
            toast.success(`Exported ${r.rows} events`);
          } catch (e) {
            toastErr(e);
          }
        }}
      >
        {exp.isPending ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Export audit log
      </Btn>
      {last && (
        <div className="mt-3 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.05] px-3 py-2 text-[11.5px] text-slate-300">
          <div>
            {last.filename} · {last.rows} events
          </div>
          <div className="telemetry break-all text-emerald-200">sha256 {last.sha256}</div>
        </div>
      )}
    </Panel>
  );
}
