"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import { CheckCircle2, Loader2, RotateCw, Webhook, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { EmptyState, Panel, Skeleton, SourceTag } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { Btn } from "@/components/workspace/ui";
import { cn } from "@/lib/utils";
import { JsonView, SnippetTabs } from "./CodeBlock";
import { WEBHOOK_VERIFY } from "./snippets";

export function WebhookInspector() {
  const [hook, setHook] = useState<string | null>(null);
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const q = trpc.developer.deliveries.useQuery({ webhookId: hook, onlyFailed }, { refetchInterval: 20_000 });
  const redeliver = trpc.developer.redeliver.useMutation();
  const d = q.data;
  if (!d) return <Skeleton className="h-96" />;
  const current = d.deliveries.find((x) => x.id === sel) ?? d.deliveries[0] ?? null;

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-[12.5px] text-slate-400">
        <b className="text-slate-200">What this means:</b> every event Agri-SHIELD POSTs to your systems (reports ready, rules fired, risk thresholds, commodity alerts) with the exact signed payload, your server's answer and how long it took. Use it to debug integrations and to replay a delivery after fixing your endpoint.
      </p>
      <div className="grid grid-cols-3 gap-3">
        {[
          ["Deliveries", d.stats.total, "text-white"],
          ["Succeeded", d.stats.ok, "text-emerald-300"],
          ["Failed", d.stats.failed, d.stats.failed ? "text-rose-300" : "text-slate-400"],
        ].map(([l, v, c]) => (
          <div key={l as string} className="hud-panel p-3">
            <div className="hud-label">{l}</div>
            <div className={cn("mt-1 font-display text-2xl font-semibold", c as string)}>{v}</div>
          </div>
        ))}
      </div>

      {d.webhooks.length === 0 ? (
        <Panel accent="cyan">
          <EmptyState icon={Webhook} title="No webhooks configured">
            Add an endpoint in <Link href="/app/settings/api" className="text-cyan-300 underline">Settings → API &amp; integrations</Link>, then send a test event — it shows up here with the full request and response.
          </EmptyState>
        </Panel>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr),minmax(0,1.2fr)]">
          <Panel
            title="Deliveries"
            subtitle={`${d.deliveries.length} shown`}
            icon={Webhook}
            accent="cyan"
            actions={
              <label className="flex items-center gap-1.5 text-[11.5px] text-slate-400">
                <input type="checkbox" className="accent-cyan-400" checked={onlyFailed} onChange={(e) => setOnlyFailed(e.target.checked)} /> Failed only
              </label>
            }
          >
            <select className="mb-3 h-9 w-full rounded-lg border border-slate-700 bg-slate-950/70 px-2 text-[12.5px] text-slate-200" value={hook ?? ""} onChange={(e) => setHook(e.target.value || null)} aria-label="Filter by endpoint">
              <option value="">All endpoints ({d.webhooks.length})</option>
              {d.webhooks.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} · {w.deliveries} deliveries{w.failures ? ` · ${w.failures} failed` : ""}
                </option>
              ))}
            </select>
            {d.deliveries.length === 0 ? (
              <p className="py-6 text-center text-[12.5px] text-slate-500">No deliveries yet — use “Send test” on an endpoint in Settings → API &amp; integrations.</p>
            ) : (
              <ul className="max-h-[480px] space-y-1 overflow-y-auto">
                {d.deliveries.map((x) => (
                  <li key={x.id}>
                    <button onClick={() => setSel(x.id)} className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left", current?.id === x.id ? "bg-cyan-400/10 ring-1 ring-cyan-400/30" : "hover:bg-white/[0.03]")}>
                      {x.ok ? <CheckCircle2 size={15} className="shrink-0 text-emerald-400" /> : <XCircle size={15} className="shrink-0 text-rose-400" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] text-slate-200">{x.event}</span>
                        <span className="block truncate text-[11px] text-slate-500">
                          {x.webhookName} · {formatDistanceToNowStrict(new Date(x.at), { addSuffix: true })}
                          {x.trigger === "test" ? " · test" : ""}
                        </span>
                      </span>
                      <span className="telemetry text-right text-[11px]">
                        <span className={x.ok ? "text-emerald-300" : "text-rose-300"}>{x.status ?? "ERR"}</span>
                        <span className="block text-slate-500">{x.latencyMs ?? "—"} ms</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {current && (
            <Panel
              title={<span className="telemetry">{current.id}</span>}
              subtitle={`${current.event} → ${current.url}`}
              accent={current.ok ? "emerald" : "red"}
              actions={
                d.canManage && (
                  <Btn
                    variant="outline"
                    className="h-8 px-2.5 py-0 text-xs"
                    disabled={redeliver.isPending}
                    onClick={async () => {
                      try {
                        const r = await redeliver.mutateAsync({ deliveryId: current.id });
                        toast[r.ok ? "success" : "error"](r.ok ? `Redelivered · HTTP ${r.status} in ${r.latencyMs} ms` : `Redelivery failed: ${r.error ?? `HTTP ${r.status}`}`);
                        await q.refetch();
                        setSel(r.id);
                      } catch (e) {
                        toast.error((e as Error).message);
                      }
                    }}
                  >
                    {redeliver.isPending ? <Loader2 size={13} className="animate-spin" /> : <RotateCw size={13} />} Redeliver
                  </Btn>
                )
              }
            >
              <dl className="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
                {[
                  ["Status", current.status ?? "no response"],
                  ["Latency", current.latencyMs !== null ? `${current.latencyMs} ms` : "—"],
                  ["Trigger", current.trigger],
                  ["Sent", new Date(current.at).toISOString().slice(0, 19).replace("T", " ")],
                ].map(([k, v]) => (
                  <div key={k as string} className="rounded-lg bg-slate-900/60 px-2.5 py-1.5">
                    <dt className="text-[10.5px] text-slate-500">{k}</dt>
                    <dd className="telemetry text-slate-200">{v}</dd>
                  </div>
                ))}
              </dl>
              {current.error && <p className="mt-2 rounded-lg bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200">{current.error}</p>}
              <div className="mt-3">
                <div className="hud-label mb-1 flex items-center gap-1.5">
                  Request headers <Explain text="Verify X-AgriShield-Signature on your server: HMAC-SHA256 of the raw request body with your endpoint's signing secret, hex-encoded, prefixed with sha256=. Reject requests whose X-AgriShield-Timestamp is older than 5 minutes." />
                </div>
                <dl className="telemetry space-y-0.5 rounded-xl border border-white/5 bg-[#050b18] p-3 text-[11.5px]">
                  {[
                    ["Content-Type", "application/json"],
                    ["X-AgriShield-Event", current.event],
                    ["X-AgriShield-Delivery", current.id],
                    ["X-AgriShield-Signature", current.signature],
                  ].map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <dt className="shrink-0 text-cyan-300">{k}:</dt>
                      <dd className="break-all text-slate-300">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className="mt-3">
                <div className="hud-label mb-1">Request body</div>
                <JsonView text={current.requestBody} className="max-h-60 rounded-xl border border-white/5 bg-[#050b18] p-3" />
              </div>
              <div className="mt-3">
                <div className="hud-label mb-1">Your server&apos;s response</div>
                <pre className="telemetry max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-white/5 bg-[#050b18] p-3 text-[11.5px] text-slate-300">{current.responseSnippet || "(empty)"}</pre>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="hud-label">Verify the signature</span>
                <SourceTag>HMAC-SHA256</SourceTag>
              </div>
              <SnippetTabs className="mt-1" make={(l) => WEBHOOK_VERIFY[l]} initial="javascript" />
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
