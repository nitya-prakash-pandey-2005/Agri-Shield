"use client";

import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, ChevronDown, KeyRound, Pencil, Plus, Power, RefreshCw, RotateCcw, Send, ShieldAlert, Trash2, Webhook, Zap } from "lucide-react";
import { useSession } from "next-auth/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState, Panel, Skeleton, SourceTag } from "@/components/hud";
import { commodityColor, timeAgo } from "@/components/supply-chain/theme";
import { Chip, CodeBlock, CopyButton, Field, QueryError, ScButton, ScHeader, Segmented, inputCls } from "@/components/supply-chain/ui";
import { useRealtime } from "@/hooks/useRealtime";
import { trpc, type RouterOutputs } from "@/lib/trpc";

type Hook = RouterOutputs["supplyChain"]["listWebhooks"]["webhooks"][number];
interface FormState {
  id?: string;
  name: string;
  url: string;
  commodities: string[];
  riskThreshold: number;
  events: string[];
}
const EMPTY: FormState = { name: "", url: "https://postman-echo.com/post", commodities: ["rice"], riskThreshold: 70, events: ["commodity.risk.threshold"] };

const statusColor = (s: number | null | undefined, ok?: boolean) => (ok || (s != null && s >= 200 && s < 300) ? "#4ade80" : s == null || s === 0 ? "#f87171" : s >= 500 ? "#f87171" : "#fbbf24");

export default function IntegrationsPage() {
  const utils = trpc.useUtils();
  const { data: session } = useSession();
  const hooks = trpc.supplyChain.listWebhooks.useQuery();
  const deliveries = trpc.supplyChain.listDeliveries.useQuery({ limit: 40 });
  const keys = trpc.supplyChain.listApiKeys.useQuery();
  const docs = trpc.supplyChain.getIntegrationDocs.useQuery(undefined, { staleTime: 5 * 60_000 });

  const [form, setForm] = useState<FormState | null>(null);
  const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [testEvent, setTestEvent] = useState<Record<string, string>>({});
  const [keyForm, setKeyForm] = useState({ name: "", scopes: ["risk:read", "commodities:read"] as string[], environment: "live" as "live" | "test" });
  const [docTab, setDocTab] = useState<"payloads" | "verify" | "rest">("payloads");
  const [docEvent, setDocEvent] = useState(0);
  const [lang, setLang] = useState<"node" | "python">("node");

  const refresh = () => {
    utils.supplyChain.listWebhooks.invalidate();
    utils.supplyChain.listDeliveries.invalidate();
  };
  useRealtime(session?.user?.orgId ? [`sc:${session.user.orgId}`] : [], (env) => {
    if ((env.event as { type: string }).type === "webhook.delivered") refresh();
  });

  const onErr = (e: { message: string }) => toast.error(e.message);
  const create = trpc.supplyChain.createWebhook.useMutation({
    onSuccess: (r) => {
      refresh();
      setForm(null);
      setSecret({ title: `Signing secret for “${r.webhook.name}”`, value: r.secret });
      toast.success("Webhook created");
    },
    onError: onErr,
  });
  const update = trpc.supplyChain.updateWebhook.useMutation({ onSuccess: () => (refresh(), setForm(null), toast.success("Webhook updated")), onError: onErr });
  const toggle = trpc.supplyChain.toggleWebhook.useMutation({ onSuccess: refresh, onError: onErr });
  const del = trpc.supplyChain.deleteWebhook.useMutation({ onSuccess: () => (refresh(), toast.success("Webhook deleted")), onError: onErr });
  const rotate = trpc.supplyChain.rotateWebhookSecret.useMutation({ onSuccess: (r) => setSecret({ title: "New signing secret", value: r.secret }), onError: onErr });
  const test = trpc.supplyChain.sendTestWebhook.useMutation({
    onSuccess: (d) => {
      refresh();
      setExpanded(d.id);
      if (d.ok) toast.success(`Delivered · HTTP ${d.status} · ${d.latencyMs} ms`);
      else toast.error(`Delivery failed · ${d.status ?? d.error}`);
    },
    onError: onErr,
  });
  const evaluate = trpc.supplyChain.evaluateWebhooksNow.useMutation({
    onSuccess: (r) => (refresh(), toast.message(`Evaluated ${r.evaluated} webhook(s) · ${r.fired} fired`)),
    onError: onErr,
  });
  const createKey = trpc.supplyChain.createApiKey.useMutation({
    onSuccess: (r) => {
      utils.supplyChain.listApiKeys.invalidate();
      setSecret({ title: `API key “${r.record.name}”`, value: r.key });
      setKeyForm((k) => ({ ...k, name: "" }));
    },
    onError: onErr,
  });
  const revoke = trpc.supplyChain.revokeApiKey.useMutation({ onSuccess: () => (utils.supplyChain.listApiKeys.invalidate(), toast.success("Key revoked")), onError: onErr });

  const hookName = useMemo(() => new Map((hooks.data?.webhooks ?? []).map((h) => [h.id, h.name])), [hooks.data]);

  const save = () => {
    if (!form) return;
    const body = { name: form.name, url: form.url, commodities: form.commodities, riskThreshold: form.riskThreshold, events: form.events };
    if (form.id) update.mutate({ id: form.id, ...body });
    else create.mutate(body);
  };
  const formValid = form && form.name.trim().length >= 2 && /^https?:\/\/.+/.test(form.url) && form.commodities.length && form.events.length;

  return (
    <div>
      <ScHeader
        eyebrow="Supply chain · alerts & integrations"
        title="Integrations"
        description="Push risk alerts into your ERP or logistics system. Pick a commodity and a risk threshold, and Agri-SHIELD sends a signed webhook when it is crossed. Manage API keys and preview payloads and signature checks."
        actions={
          <ScButton variant="outline" loading={evaluate.isPending} onClick={() => evaluate.mutate()}>
            {!evaluate.isPending && <Zap size={14} />} Evaluate thresholds now
          </ScButton>
        }
      />

      {/* One-time secret reveal */}
      <AnimatePresence>
        {secret && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="mb-5 rounded-xl border border-amber-500/50 bg-amber-500/[0.08] p-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 shrink-0 text-amber-400" size={18} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-amber-100">{secret.title}</div>
                <div className="text-[12px] text-amber-200/70">Copy it now. It is shown only once and stored as a SHA-256 hash (API keys) or kept server-side for signing (webhooks).</div>
                <div className="mt-2 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-md border border-amber-500/30 bg-black/40 px-3 py-2 telemetry text-[13px] text-amber-100">{secret.value}</code>
                  <CopyButton text={secret.value} />
                </div>
              </div>
              <button className="text-xs text-amber-200/70 hover:text-white" onClick={() => setSecret(null)}>
                Dismiss
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {/* Webhooks */}
        <Panel
          title="Webhook endpoints"
          subtitle="Commodity + risk threshold + events → your URL (HMAC-SHA256 signed)"
          icon={Webhook}
          accent="amber"
          actions={
            <ScButton className="px-2.5 py-1.5 text-xs" onClick={() => setForm({ ...EMPTY })}>
              <Plus size={13} /> New webhook
            </ScButton>
          }
        >
          <QueryError error={hooks.error} onRetry={() => hooks.refetch()} what="webhooks" />
          <AnimatePresence>
            {form && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="mb-4 space-y-4 rounded-xl border border-amber-500/30 bg-[#0b1a33]/60 p-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="Name">
                      <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="SAP rice procurement" maxLength={60} />
                    </Field>
                    <Field label="Endpoint URL" hint="Try https://postman-echo.com/post or https://httpbin.org/post to see the signed request">
                      <input className={inputCls} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://erp.example.com/hooks/agrishield" />
                    </Field>
                  </div>
                  <Field label="Commodities">
                    <div className="flex flex-wrap gap-1.5">
                      {hooks.data?.commodities.map((c) => (
                        <Chip key={c.id} active={form.commodities.includes(c.id)} color={commodityColor(c.id)} onClick={() => setForm({ ...form, commodities: form.commodities.includes(c.id) ? form.commodities.filter((x) => x !== c.id) : [...form.commodities, c.id] })}>
                          {c.id}
                        </Chip>
                      ))}
                    </div>
                  </Field>
                  <Field label={`Risk threshold — fire at ≥ ${form.riskThreshold}`}>
                    <input type="range" min={10} max={95} step={5} value={form.riskThreshold} onChange={(e) => setForm({ ...form, riskThreshold: Number(e.target.value) })} className="w-full accent-amber-500" aria-label="Risk threshold" />
                  </Field>
                  <Field label="Events">
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {hooks.data?.events.map((ev) => (
                        <label key={ev.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-800 px-2.5 py-2 text-xs text-slate-300 hover:border-slate-600">
                          <input type="checkbox" className="accent-amber-500" checked={form.events.includes(ev.id)} onChange={() => setForm({ ...form, events: form.events.includes(ev.id) ? form.events.filter((x) => x !== ev.id) : [...form.events, ev.id] })} />
                          <span>
                            <span className="telemetry text-amber-200">{ev.id}</span>
                            <span className="block text-[10.5px] text-slate-500">{ev.label}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </Field>
                  <div className="flex justify-end gap-2">
                    <ScButton variant="ghost" onClick={() => setForm(null)}>
                      Cancel
                    </ScButton>
                    <ScButton onClick={save} disabled={!formValid} loading={create.isPending || update.isPending}>
                      {form.id ? "Save changes" : "Create webhook"}
                    </ScButton>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {hooks.isLoading ? (
            <Skeleton className="h-40" />
          ) : hooks.data?.webhooks.length ? (
            <ul className="space-y-3">
              {hooks.data.webhooks.map((h: Hook) => (
                <motion.li layout key={h.id} className={`rounded-xl border p-3.5 ${h.active ? "border-slate-700/80 bg-slate-900/40" : "border-slate-800 bg-slate-900/20 opacity-70"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white">{h.name}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] telemetry ${h.active ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-700/40 text-slate-400"}`}>{h.active ? "ACTIVE" : "PAUSED"}</span>
                      </div>
                      <div className="mt-0.5 truncate telemetry text-[11.5px] text-slate-400">{h.url}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {h.commodities.map((c) => (
                          <span key={c} className="inline-flex items-center gap-1 rounded border border-slate-800 px-1.5 py-0.5 text-[10.5px] text-slate-300">
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: commodityColor(c) }} />
                            {c}
                          </span>
                        ))}
                        <span className="rounded border border-amber-500/30 px-1.5 py-0.5 telemetry text-[10.5px] text-amber-200">≥ {h.riskThreshold}</span>
                        {h.events.map((e) => (
                          <span key={e} className="rounded bg-slate-800/70 px-1.5 py-0.5 telemetry text-[10px] text-slate-400">
                            {e}
                          </span>
                        ))}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-3 telemetry text-[10.5px] text-slate-500">
                        <span>secret {h.secretMasked}</span>
                        <span>
                          last:{" "}
                          {h.lastDelivery ? (
                            <span style={{ color: statusColor(h.lastDelivery.status) }}>
                              {h.lastDelivery.status || "ERR"} · {timeAgo(h.lastDelivery.at)}
                            </span>
                          ) : (
                            "never"
                          )}
                        </span>
                        <span>{h.deliveries} deliveries{h.successRate != null ? ` · ${h.successRate}% ok` : ""}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <select
                        className="rounded-md border border-slate-700 bg-slate-900 px-1.5 py-1 text-[11px] text-slate-300"
                        value={testEvent[h.id] ?? h.events[0]}
                        onChange={(e) => setTestEvent((s) => ({ ...s, [h.id]: e.target.value }))}
                        aria-label="Test event"
                      >
                        {hooks.data!.events.map((ev) => (
                          <option key={ev.id} value={ev.id}>
                            {ev.id}
                          </option>
                        ))}
                      </select>
                      <ScButton className="px-2.5 py-1 text-xs" loading={test.isPending && test.variables?.id === h.id} onClick={() => test.mutate({ id: h.id, event: testEvent[h.id] ?? h.events[0] })}>
                        {!(test.isPending && test.variables?.id === h.id) && <Send size={12} />} Send test
                      </ScButton>
                      <button title={h.active ? "Pause" : "Activate"} aria-label={h.active ? "Pause webhook" : "Activate webhook"} onClick={() => toggle.mutate({ id: h.id, active: !h.active })} className={`rounded-md p-1.5 ${h.active ? "text-emerald-400 hover:bg-emerald-500/10" : "text-slate-500 hover:bg-white/5"}`}>
                        <Power size={14} />
                      </button>
                      <button title="Edit" aria-label="Edit webhook" onClick={() => setForm({ id: h.id, name: h.name, url: h.url, commodities: h.commodities, riskThreshold: h.riskThreshold, events: h.events })} className="rounded-md p-1.5 text-slate-400 hover:bg-white/5 hover:text-white">
                        <Pencil size={14} />
                      </button>
                      <button title="Rotate secret" aria-label="Rotate signing secret" onClick={() => rotate.mutate({ id: h.id })} className="rounded-md p-1.5 text-slate-400 hover:bg-white/5 hover:text-white">
                        <RotateCcw size={14} />
                      </button>
                      <button
                        title="Delete"
                        aria-label="Delete webhook"
                        onClick={() => {
                          if (confirm(`Delete webhook “${h.name}”?`)) del.mutate({ id: h.id });
                        }}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-rose-500/10 hover:text-rose-300"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </motion.li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Webhook} title="No webhooks yet">
              Create one to push commodity risk alerts into your ERP.
            </EmptyState>
          )}
        </Panel>

        {/* Delivery log */}
        <Panel title="Delivery log" subtitle="Every signed POST — status, latency, request & response" icon={Send} accent="amber" live actions={<button onClick={() => deliveries.refetch()} className="text-slate-400 hover:text-white" aria-label="Refresh deliveries"><RefreshCw size={13} className={deliveries.isFetching ? "animate-spin" : ""} /></button>} bodyClassName="px-0 pb-2">
          {deliveries.isLoading ? (
            <div className="px-4">
              <Skeleton className="h-48" />
            </div>
          ) : deliveries.data?.length ? (
            <ul className="max-h-[560px] divide-y divide-white/5 overflow-y-auto">
              {deliveries.data.map((d) => (
                <li key={d.id}>
                  <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-white/[0.02]" onClick={() => setExpanded(expanded === d.id ? null : d.id)}>
                    <span className="w-12 shrink-0 rounded px-1.5 py-0.5 text-center telemetry text-[11px] font-semibold" style={{ color: statusColor(d.status, d.ok), background: `${statusColor(d.status, d.ok)}1a` }}>
                      {d.status ?? "ERR"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate telemetry text-[11.5px] text-slate-200">{d.event}</span>
                      <span className="block truncate text-[10.5px] text-slate-500">
                        {hookName.get(d.webhookId) ?? d.webhookId} · {d.trigger} · {timeAgo(d.at)}
                      </span>
                    </span>
                    <span className="telemetry text-[11px] text-slate-400">{d.latencyMs != null ? `${d.latencyMs} ms` : "—"}</span>
                    <ChevronDown size={14} className={`text-slate-500 transition-transform ${expanded === d.id ? "rotate-180" : ""}`} />
                  </button>
                  <AnimatePresence>
                    {expanded === d.id && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                        <div className="space-y-2 px-4 pb-3">
                          {d.error && <div className="rounded-md border border-rose-500/30 bg-rose-500/5 px-2 py-1.5 text-[11px] text-rose-200">{d.error}</div>}
                          <div className="telemetry text-[10.5px] text-slate-500 break-all">
                            POST {d.url}
                            <br />
                            X-AgriShield-Signature: {d.signature}
                          </div>
                          <CodeBlock lang="request body" code={prettyJson(d.requestBody)} maxHeight={200} />
                          {d.responseSnippet != null && <CodeBlock lang={`response · HTTP ${d.status}`} code={prettyJson(d.responseSnippet)} maxHeight={200} />}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Send} title="No deliveries yet">
              Use “Send test” on a webhook to make a real signed request.
            </EmptyState>
          )}
        </Panel>
      </div>

      {/* API keys */}
      <Panel className="mt-5" title="API keys" subtitle="Keys are shown once and stored as SHA-256 hashes — only the prefix is kept for display" icon={KeyRound} accent="amber">
        <QueryError error={keys.error} onRetry={() => keys.refetch()} what="API keys" />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="overflow-x-auto">
            {keys.isLoading ? (
              <Skeleton className="h-32" />
            ) : keys.data?.keys.length ? (
              <table className="w-full min-w-[620px] text-sm">
                <thead>
                  <tr className="hud-label text-left">
                    <th className="px-2 py-2">Name</th>
                    <th className="px-2 py-2">Key</th>
                    <th className="px-2 py-2">Scopes</th>
                    <th className="px-2 py-2">Created</th>
                    <th className="px-2 py-2">Last used</th>
                    <th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {keys.data.keys.map((k) => (
                    <tr key={k.id}>
                      <td className="px-2 py-2.5 text-slate-100">{k.name}</td>
                      <td className="px-2 py-2.5 telemetry text-[12px] text-amber-200">
                        {k.prefix}
                        <span className="text-slate-600">••••••••••••••••••••••••••••</span>
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {k.scopes.map((s) => (
                            <span key={s} className="rounded bg-slate-800/70 px-1.5 py-0.5 telemetry text-[10px] text-slate-300">
                              {s}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-2 py-2.5 telemetry text-[11px] text-slate-400">{timeAgo(k.createdAt)}</td>
                      <td className="px-2 py-2.5 telemetry text-[11px] text-slate-400">{k.lastUsed ? timeAgo(k.lastUsed) : "never"}</td>
                      <td className="px-2 py-2.5 text-right">
                        <ScButton
                          variant="danger"
                          className="px-2 py-1 text-xs"
                          onClick={() => {
                            if (confirm(`Revoke “${k.name}”? Integrations using it will stop working immediately.`)) revoke.mutate({ id: k.id });
                          }}
                        >
                          Revoke
                        </ScButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState icon={KeyRound} title="No API keys" />
            )}
          </div>
          <form
            className="space-y-3 rounded-xl border border-slate-800 bg-[#0b1a33]/40 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              createKey.mutate({ name: keyForm.name, scopes: keyForm.scopes as never, environment: keyForm.environment });
            }}
          >
            <div className="text-sm font-medium text-white">Create key</div>
            <Field label="Name">
              <input className={inputCls} value={keyForm.name} onChange={(e) => setKeyForm({ ...keyForm, name: e.target.value })} placeholder="Oracle SCM — production" maxLength={60} />
            </Field>
            <Field label="Environment">
              <Segmented value={keyForm.environment} onChange={(v) => setKeyForm({ ...keyForm, environment: v })} options={[{ value: "live", label: "live" }, { value: "test", label: "test" }]} />
            </Field>
            <Field label="Scopes">
              <div className="flex flex-wrap gap-1.5">
                {keys.data?.scopes.map((s) => (
                  <Chip key={s} active={keyForm.scopes.includes(s)} onClick={() => setKeyForm({ ...keyForm, scopes: keyForm.scopes.includes(s) ? keyForm.scopes.filter((x) => x !== s) : [...keyForm.scopes, s] })}>
                    {s}
                  </Chip>
                ))}
              </div>
            </Field>
            <ScButton type="submit" className="w-full" disabled={keyForm.name.trim().length < 2 || !keyForm.scopes.length} loading={createKey.isPending}>
              <KeyRound size={14} /> Generate key
            </ScButton>
          </form>
        </div>
      </Panel>

      {/* Docs */}
      <Panel
        className="mt-5"
        title="Integration docs"
        subtitle="Sample payloads use live values from your current risk picture"
        icon={BookOpen}
        accent="amber"
        actions={<Segmented value={docTab} onChange={setDocTab} options={[{ value: "payloads", label: "Payloads" }, { value: "verify", label: "Verify signature" }, { value: "rest", label: "REST & headers" }]} />}
      >
        <QueryError error={docs.error} onRetry={() => docs.refetch()} what="docs" />
        {!docs.data ? (
          <Skeleton className="h-72" />
        ) : docTab === "payloads" ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
            <ul className="space-y-1">
              {docs.data.samples.map((s, i) => (
                <li key={s.event}>
                  <button onClick={() => setDocEvent(i)} className={`w-full rounded-lg px-3 py-2 text-left text-xs transition ${docEvent === i ? "bg-amber-500/10 text-amber-100 ring-1 ring-amber-500/40" : "text-slate-400 hover:bg-white/5"}`}>
                    <div className="telemetry">{s.event}</div>
                    <div className="text-[10.5px] text-slate-500">{s.label}</div>
                  </button>
                </li>
              ))}
            </ul>
            <div className="min-w-0 space-y-2">
              <CodeBlock lang="application/json" code={docs.data.samples[docEvent]!.payload} maxHeight={380} />
              <div className="telemetry text-[10.5px] text-slate-500 break-all">
                X-AgriShield-Signature (secret = &quot;whsec_your_signing_secret&quot;, compact body): {docs.data.samples[docEvent]!.signature}
              </div>
            </div>
          </div>
        ) : docTab === "verify" ? (
          <div className="space-y-3">
            <Segmented value={lang} onChange={setLang} options={[{ value: "node", label: "Node.js" }, { value: "python", label: "Python" }]} />
            <CodeBlock lang={lang === "node" ? "javascript · express" : "python · fastapi"} code={docs.data.snippets[lang]} maxHeight={420} />
            <CodeBlock lang="bash · debug a signature" code={docs.data.snippets.curlVerify} maxHeight={120} />
            <p className="text-[11px] text-slate-500">{docs.data.retryPolicy}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <CodeBlock lang="bash · pull commodity risk" code={docs.data.snippets.curlRest} maxHeight={140} />
              <p className="text-[11px] text-slate-500">{docs.data.rateLimits}</p>
              <SourceTag>{docs.data.baseUrl}</SourceTag>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="hud-label text-left">
                  <th className="py-1.5 pr-3">Header</th>
                  <th className="py-1.5">Meaning</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {docs.data.headers.map((h) => (
                  <tr key={h.name}>
                    <td className="py-2 pr-3 telemetry text-amber-200">{h.name}</td>
                    <td className="py-2 text-slate-400">{h.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function prettyJson(raw: string) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
