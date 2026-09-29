"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import { AlertTriangle, BookOpen, Copy, KeyRound, Loader2, Plus, Send, Trash2, Webhook } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { EmptyState, Meter, Panel, Skeleton } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { Btn, Field, Modal, Toggle, inputCls } from "@/components/workspace/ui";
import { cn } from "@/lib/utils";

const copyText = async (t: string, what = "Copied") => {
  try {
    await navigator.clipboard.writeText(t);
    toast.success(what);
  } catch {
    toast.message(t);
  }
};

export default function ApiSettings() {
  const utils = trpc.useUtils();
  const q = trpc.workspace.api.useQuery();
  const refresh = () => Promise.all([utils.workspace.api.invalidate(), utils.workspace.onboarding.invalidate()]);
  const createKey = trpc.workspace.createApiKey.useMutation();
  const revokeKey = trpc.workspace.revokeApiKey.useMutation();
  const createHook = trpc.workspace.createWebhook.useMutation();
  const toggleHook = trpc.workspace.toggleWebhook.useMutation();
  const deleteHook = trpc.workspace.deleteWebhook.useMutation();
  const testHook = trpc.workspace.testWebhook.useMutation();

  const [keyOpen, setKeyOpen] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [keyEnv, setKeyEnv] = useState<"live" | "test">("live");
  const [scopes, setScopes] = useState<string[]>(["risk:read"]);
  const [revealed, setRevealed] = useState<string | null>(null);

  const [hookOpen, setHookOpen] = useState(false);
  const [hookName, setHookName] = useState("");
  const [hookUrl, setHookUrl] = useState("https://");
  const [events, setEvents] = useState<string[]>(["report.ready"]);
  const [secret, setSecret] = useState<string | null>(null);

  const d = q.data;
  if (!d) return <div className="grid gap-4 lg:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-64" />)}</div>;

  const onCreateKey = async () => {
    try {
      const r = await createKey.mutateAsync({ name: keyName.trim(), scopes: scopes as never, environment: keyEnv });
      setRevealed(r.key);
      setKeyName("");
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const onCreateHook = async () => {
    try {
      const r = await createHook.mutateAsync({ name: hookName.trim(), url: hookUrl.trim(), events });
      setSecret(r.secret);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const sample = `curl -H "X-API-Key: ${revealed ?? "ags_live_…"}" \\\n  "${typeof window !== "undefined" ? window.location.origin : d.baseUrl}/api/v1/risk?lat=22.7&lon=90.35"`;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title={
            <span className="flex items-center gap-1.5">
              API keys <Explain term="api_key" />
            </span>
          }
          subtitle="Let your own systems pull risk data from Agri-SHIELD"
          icon={KeyRound}
          accent="cyan"
          className="lg:col-span-2"
          actions={
            d.canManage && (
              <Btn className="h-8 px-2.5 py-0 text-xs" onClick={() => (setRevealed(null), setKeyOpen(true))}>
                <Plus size={13} /> New key
              </Btn>
            )
          }
        >
          {d.keys.length === 0 ? (
            <EmptyState icon={KeyRound} title="No API keys yet">
              Create a key to call the REST API from your ERP, core-banking or GIS system.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-white/5">
              {d.keys.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <KeyRound size={15} className={k.prefix.includes("_test_") ? "text-amber-300" : "text-emerald-300"} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-slate-100">{k.name}</div>
                    <div className="text-[11.5px] text-slate-500">
                      <span className="telemetry text-slate-400">{k.prefix}…</span> · {k.scopes.join(", ")} · created {formatDistanceToNowStrict(new Date(k.createdAt), { addSuffix: true })} · {k.lastUsed ? `last used ${formatDistanceToNowStrict(new Date(k.lastUsed), { addSuffix: true })}` : "never used"}
                    </div>
                  </div>
                  {k.hashed && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">SHA-256 stored</span>}
                  {d.canManage && (
                    <button
                      onClick={async () => {
                        if (!window.confirm(`Revoke "${k.name}"? Any system using it stops working immediately.`)) return;
                        try {
                          await revokeKey.mutateAsync({ id: k.id });
                          toast.success("Key revoked");
                          await refresh();
                        } catch (e) {
                          toast.error((e as Error).message);
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-slate-400 hover:bg-rose-500/10 hover:text-rose-300"
                    >
                      <Trash2 size={12} /> Revoke
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="API usage" subtitle="This month" icon={BookOpen} accent="violet">
          <div className="flex items-baseline gap-1.5">
            <span className="telemetry text-2xl font-semibold text-white">{d.usage.used.toLocaleString("en-US")}</span>
            <span className="text-sm text-slate-400">/ {d.usage.limit === null ? "unlimited" : d.usage.limit.toLocaleString("en-US")} calls</span>
          </div>
          {d.usage.limit !== null && <Meter value={d.usage.pct} color="#a78bfa" className="mt-2" />}
          <div className="mt-4 space-y-2 text-[12.5px]">
            <Link href="/docs/api-reference" className="flex items-center gap-1.5 text-cyan-300 hover:underline">
              <BookOpen size={13} /> REST API reference
            </Link>
            <Link href="/docs/integration-guide" className="flex items-center gap-1.5 text-cyan-300 hover:underline">
              <BookOpen size={13} /> Webhooks & signature verification
            </Link>
            <a href="/api/v1/openapi.json" target="_blank" className="flex items-center gap-1.5 text-cyan-300 hover:underline">
              <BookOpen size={13} /> OpenAPI spec (JSON)
            </a>
          </div>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-950/80 p-2.5 text-[10.5px] leading-relaxed text-slate-300">{sample}</pre>
        </Panel>
      </div>

      <Panel
        title={
          <span className="flex items-center gap-1.5">
            Webhook endpoints <Explain term="webhook" />
          </span>
        }
        subtitle="We POST signed JSON to your URL when things happen in this workspace"
        icon={Webhook}
        accent="emerald"
        actions={
          d.canManage && (
            <Btn className="h-8 px-2.5 py-0 text-xs" onClick={() => (setSecret(null), setHookOpen(true))}>
              <Plus size={13} /> Add endpoint
            </Btn>
          )
        }
      >
        {d.webhooks.length === 0 ? (
          <EmptyState icon={Webhook} title="No webhook endpoints">
            Add an endpoint to get reports, rule alerts and threshold crossings pushed into Slack, Teams, your ERP or a data lake.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-white/5">
            {d.webhooks.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className={cn("h-2 w-2 rounded-full", w.active ? "bg-emerald-400" : "bg-slate-600")} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-slate-100">{w.name}</div>
                  <div className="truncate text-[11.5px] text-slate-500">
                    <span className="telemetry">{w.url}</span> · {w.events.join(", ")}
                  </div>
                  <div className="text-[11px] text-slate-600">{w.lastDelivery ? `Last delivery HTTP ${w.lastDelivery.status} · ${formatDistanceToNowStrict(new Date(w.lastDelivery.at), { addSuffix: true })}` : "No deliveries yet"}</div>
                </div>
                {d.canManage && (
                  <>
                    <Btn
                      variant="outline"
                      className="h-7 px-2 py-0 text-[11.5px]"
                      disabled={testHook.isPending}
                      onClick={async () => {
                        try {
                          const r = await testHook.mutateAsync({ id: w.id });
                          r.ok ? toast.success(`Delivered — HTTP ${r.status} in ${r.latencyMs} ms`) : toast.error(`Delivery failed: ${r.error ?? `HTTP ${r.status}`}`);
                          await refresh();
                        } catch (e) {
                          toast.error((e as Error).message);
                        }
                      }}
                    >
                      <Send size={12} /> Send test
                    </Btn>
                    <Toggle checked={w.active} label={`Enable ${w.name}`} onChange={async (v) => (await toggleHook.mutateAsync({ id: w.id, active: v }), await refresh())} />
                    <button
                      onClick={async () => {
                        if (!window.confirm("Delete this endpoint?")) return;
                        await deleteHook.mutateAsync({ id: w.id });
                        toast.success("Endpoint deleted");
                        await refresh();
                      }}
                      className="p-1 text-slate-500 hover:text-rose-300"
                      aria-label="Delete endpoint"
                    >
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {d.deliveries.length > 0 && (
          <div className="mt-4 border-t border-white/5 pt-3">
            <div className="hud-label mb-2">Recent deliveries</div>
            <ul className="space-y-1">
              {d.deliveries.map((x) => (
                <li key={x.id} className="flex items-center gap-2 text-[11.5px]">
                  <span className={cn("telemetry rounded px-1.5", x.ok ? "bg-emerald-500/10 text-emerald-300" : "bg-rose-500/10 text-rose-300")}>{x.status ?? "ERR"}</span>
                  <span className="text-slate-300">{x.event}</span>
                  <span className="text-slate-600">{formatDistanceToNowStrict(new Date(x.at), { addSuffix: true })}</span>
                  {x.latencyMs !== null && <span className="text-slate-600">{x.latencyMs} ms</span>}
                  {x.error && <span className="truncate text-rose-300/80">{x.error}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>

      <Modal
        open={keyOpen}
        onClose={() => setKeyOpen(false)}
        title={revealed ? "Copy your new API key" : "Create an API key"}
        footer={
          revealed ? (
            <Btn onClick={() => setKeyOpen(false)}>I've stored it safely</Btn>
          ) : (
            <>
              <Btn variant="outline" onClick={() => setKeyOpen(false)}>
                Cancel
              </Btn>
              <Btn onClick={onCreateKey} disabled={createKey.isPending || keyName.trim().length < 2 || !scopes.length}>
                {createKey.isPending && <Loader2 size={14} className="animate-spin" />} Create key
              </Btn>
            </>
          )
        }
      >
        {revealed ? (
          <div className="space-y-3">
            <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[12.5px] text-amber-200">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> This is the only time you'll see this key. We store just a SHA-256 hash of it.
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-slate-950 p-2.5">
              <code className="min-w-0 flex-1 break-all text-[12px] text-emerald-300">{revealed}</code>
              <button onClick={() => copyText(revealed, "Key copied")} className="text-cyan-300" aria-label="Copy key">
                <Copy size={15} />
              </button>
            </div>
            <pre className="overflow-x-auto rounded-lg bg-slate-950/80 p-2.5 text-[10.5px] text-slate-300">{sample}</pre>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="Name" hint="Where it's used, e.g. “Core banking — production”">
              <input className={inputCls} value={keyName} onChange={(e) => setKeyName(e.target.value)} autoFocus />
            </Field>
            <Field label="Environment">
              <select className={inputCls} value={keyEnv} onChange={(e) => setKeyEnv(e.target.value as "live" | "test")}>
                <option value="live">Live</option>
                <option value="test">Test (sandbox)</option>
              </select>
            </Field>
            <div>
              <div className="mb-1.5 text-[13px] text-slate-300">Scopes</div>
              <div className="grid grid-cols-2 gap-1.5">
                {d.scopes.map((s) => (
                  <label key={s} className="flex items-center gap-2 rounded-md border border-white/5 px-2 py-1.5 text-[12px] text-slate-300">
                    <input type="checkbox" className="accent-cyan-400" checked={scopes.includes(s)} onChange={(e) => setScopes((x) => (e.target.checked ? [...x, s] : x.filter((y) => y !== s)))} />
                    <span className="telemetry">{s}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={hookOpen}
        onClose={() => setHookOpen(false)}
        title={secret ? "Save your signing secret" : "Add a webhook endpoint"}
        footer={
          secret ? (
            <Btn onClick={() => setHookOpen(false)}>Done</Btn>
          ) : (
            <>
              <Btn variant="outline" onClick={() => setHookOpen(false)}>
                Cancel
              </Btn>
              <Btn onClick={onCreateHook} disabled={createHook.isPending || hookName.trim().length < 2 || !/^https?:\/\/.+\..+/.test(hookUrl) || !events.length}>
                {createHook.isPending && <Loader2 size={14} className="animate-spin" />} Add endpoint
              </Btn>
            </>
          )
        }
      >
        {secret ? (
          <div className="space-y-3">
            <p className="text-[12.5px] text-slate-300">Every request carries an <code className="text-cyan-300">X-AgriShield-Signature</code> HMAC-SHA256 header computed with this secret. Verify it before trusting the payload.</p>
            <div className="flex items-center gap-2 rounded-lg bg-slate-950 p-2.5">
              <code className="min-w-0 flex-1 break-all text-[12px] text-emerald-300">{secret}</code>
              <button onClick={() => copyText(secret, "Secret copied")} className="text-cyan-300" aria-label="Copy secret">
                <Copy size={15} />
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="Name">
              <input className={inputCls} value={hookName} onChange={(e) => setHookName(e.target.value)} placeholder="Risk team Slack relay" autoFocus />
            </Field>
            <Field label="Endpoint URL" hint="HTTPS recommended. We retry failed deliveries on the next event.">
              <input className={inputCls} value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} />
            </Field>
            <div>
              <div className="mb-1.5 text-[13px] text-slate-300">Events</div>
              <div className="space-y-1.5">
                {d.events.map((ev) => (
                  <label key={ev.id} className="flex items-center gap-2 rounded-md border border-white/5 px-2 py-1.5 text-[12px] text-slate-300">
                    <input type="checkbox" className="accent-cyan-400" checked={events.includes(ev.id)} onChange={(e) => setEvents((x) => (e.target.checked ? [...x, ev.id] : x.filter((y) => y !== ev.id)))} />
                    <span className="telemetry text-slate-400">{ev.id}</span> — {ev.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
