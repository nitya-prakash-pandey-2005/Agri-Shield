"use client";

/**
 * Interactive API explorer built from /api/v1/openapi.json:
 * pick an endpoint → form generated from its parameters → Send with a
 * workspace API key (proxied server-side so usage is metered) → pretty
 * response, headers, timing and ready-to-paste code.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { KeyRound, Loader2, Lock, Play, Plus, Send, ShieldAlert, Timer } from "lucide-react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { EmptyState, Panel, Skeleton, SourceTag } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { Btn, inputCls } from "@/components/workspace/ui";
import { cn } from "@/lib/utils";
import { CodeBlock, JsonView, SnippetTabs } from "./CodeBlock";
import { snippet } from "./snippets";

type Spec = RouterOutputs["developer"]["spec"];
type Op = Spec["operations"][number];
type Result = RouterOutputs["developer"]["send"];

const STORE_KEY = "ags_dev_keys";
/** Per-browser memory of plaintext keys this viewer created (never sent anywhere but the proxy). */
export function rememberedKeys(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}
export function rememberKey(id: string, key: string | null) {
  try {
    const all = rememberedKeys();
    if (key) all[id] = key;
    else delete all[id];
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    /* storage blocked — the key just isn't remembered */
  }
}

export const METHOD_TONE: Record<string, string> = { GET: "bg-emerald-400/15 text-emerald-300", POST: "bg-amber-400/15 text-amber-300", PUT: "bg-cyan-400/15 text-cyan-300", DELETE: "bg-rose-400/15 text-rose-300" };

function initialValues(op: Op): Record<string, string> {
  const v: Record<string, string> = {};
  for (const p of op.params) {
    const d = p.default ?? p.example;
    if (d !== null && d !== undefined) v[p.name] = String(d);
  }
  return v;
}

export function ApiExplorer({ initialOp }: { initialOp?: string | null }) {
  const utils = trpc.useUtils();
  const spec = trpc.developer.spec.useQuery(undefined, { staleTime: 5 * 60_000 });
  const keys = trpc.developer.keys.useQuery();
  const send = trpc.developer.send.useMutation();
  const createSandbox = trpc.developer.createSandboxKey.useMutation();
  const [opId, setOpId] = useState<string | null>(initialOp ?? null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [keyChoice, setKeyChoice] = useState<string>("");
  const [pasted, setPasted] = useState("");
  const [known, setKnown] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [tab, setTab] = useState<"body" | "headers" | "code">("body");

  useEffect(() => setKnown(rememberedKeys()), []);
  const ops = spec.data?.operations ?? [];
  const op = ops.find((o) => o.id === opId) ?? ops.find((o) => o.callable) ?? null;
  useEffect(() => {
    if (op) {
      setValues(initialValues(op));
      setResult(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op?.id]);

  const usableKeys = (keys.data?.keys ?? []).filter((k) => known[k.id]);
  useEffect(() => {
    if (!keyChoice && usableKeys[0]) setKeyChoice(usableKeys[0].id);
  }, [usableKeys, keyChoice]);
  const apiKey = keyChoice === "__paste" ? pasted.trim() : keyChoice === "__none" ? "" : (known[keyChoice] ?? "");
  const needsKey = !!op && !op.authOptional && op.auth.some((a) => a === "ApiKeyAuth" || a === "BearerKey");

  const grouped = useMemo(() => {
    const m = new Map<string, Op[]>();
    for (const o of ops) m.set(o.tag, [...(m.get(o.tag) ?? []), o]);
    return [...m.entries()];
  }, [ops]);

  const previewUrl = useMemo(() => {
    if (!op || !spec.data) return "";
    let path = op.path;
    const q = new URLSearchParams();
    for (const p of op.params) {
      const v = values[p.name];
      if (!v) continue;
      if (p.in === "path") path = path.replace(`{${p.name}}`, encodeURIComponent(v));
      else if (p.in === "query") q.set(p.name, v);
    }
    const qs = q.toString();
    return `${spec.data.baseUrl}${path}${qs ? `?${qs}` : ""}`;
  }, [op, values, spec.data]);

  const newSandbox = async () => {
    try {
      const r = await createSandbox.mutateAsync({ name: `Explorer ${new Date().toISOString().slice(0, 10)}` });
      rememberKey(r.id, r.key);
      setKnown(rememberedKeys());
      setKeyChoice(r.id);
      toast.success(`Sandbox key ${r.prefix}… created (read-only, expires ${new Date(r.expiresAt).toISOString().slice(0, 10)})`);
      await utils.developer.keys.invalidate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const run = async () => {
    if (!op) return;
    try {
      const r = await send.mutateAsync({ operationId: op.id, values, apiKey: apiKey || null });
      setResult(r);
      setTab("body");
      void utils.developer.usage.invalidate();
      void utils.developer.keys.invalidate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (spec.error) return <EmptyState icon={ShieldAlert} title="Explorer unavailable">{spec.error.message}</EmptyState>;
  if (!spec.data || !op) return <Skeleton className="h-[520px]" />;

  return (
    <div className="grid gap-4 xl:grid-cols-[260px,1fr]">
      {/* Endpoint list */}
      <Panel title="Endpoints" subtitle={`${ops.length} operations · OpenAPI 3.1`} accent="cyan" bodyClassName="px-2 pb-2" actions={<SourceTag href={spec.data.specUrl}>openapi.json</SourceTag>}>
        <nav aria-label="API endpoints" className="max-h-[560px] space-y-3 overflow-y-auto">
          {grouped.map(([tag, list]) => (
            <div key={tag}>
              <div className="hud-label px-2 pb-1 text-slate-500">{tag}</div>
              {list.map((o) => (
                <button key={o.id} onClick={() => setOpId(o.id)} className={cn("group flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors", op.id === o.id ? "bg-cyan-400/10 ring-1 ring-cyan-400/30" : "hover:bg-white/[0.03]")}>
                  <span className={cn("telemetry mt-0.5 w-11 shrink-0 rounded px-1 py-0.5 text-center text-[10px] font-semibold", METHOD_TONE[o.method])}>{o.method}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] text-slate-200">{o.summary}</span>
                    <span className="telemetry block truncate text-[10.5px] text-slate-500">{o.path}</span>
                  </span>
                  {!o.callable && <Lock size={11} className="mt-1 shrink-0 text-slate-600" />}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </Panel>

      <div className="min-w-0 space-y-4">
        {/* Request */}
        <Panel
          title={
            <span className="flex min-w-0 items-center gap-2">
              <span className={cn("telemetry rounded px-1.5 py-0.5 text-[10.5px] font-semibold", METHOD_TONE[op.method])}>{op.method}</span>
              <span className="telemetry truncate">{op.path}</span>
            </span>
          }
          subtitle={op.summary}
          accent="violet"
          sweep={send.isPending}
        >
          <p className="text-[12.5px] leading-relaxed text-slate-400">{op.description}</p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[10.5px]">
            {op.authOptional ? <span className="rounded-full bg-slate-700/50 px-2 py-0.5 text-slate-300">Key optional · 30 req/min anonymous, 600 with a key</span> : null}
            {needsKey && <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-cyan-300">API key required</span>}
            {op.scope && <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-violet-300">scope {op.scope}</span>}
          </div>

          {!op.callable ? (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-400/[0.05] px-3 py-2.5 text-[12.5px] text-amber-100">
              <Lock size={14} className="mt-0.5 shrink-0" /> {op.notCallableReason}
            </div>
          ) : (
            <>
              {op.params.length > 0 && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {op.params.map((p) => (
                    <label key={p.name} className="block">
                      <span className="mb-1 flex items-center gap-1.5 text-[12.5px] text-slate-300">
                        <span className="telemetry">{p.name}</span>
                        {p.required && <span className="text-rose-300">*</span>}
                        <span className="text-[10.5px] text-slate-500">
                          {p.in} · {p.type}
                          {p.minimum !== null ? ` · ≥ ${p.minimum}` : ""}
                          {p.maximum !== null ? ` · ≤ ${p.maximum}` : ""}
                        </span>
                        {p.description && <Explain text={p.description} />}
                      </span>
                      {p.enum ? (
                        <select className={inputCls} value={values[p.name] ?? ""} onChange={(e) => setValues({ ...values, [p.name]: e.target.value })}>
                          {!p.required && <option value="">(default)</option>}
                          {p.enum.map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input className={cn(inputCls, "telemetry")} inputMode={p.type === "number" || p.type === "integer" ? "decimal" : undefined} value={values[p.name] ?? ""} onChange={(e) => setValues({ ...values, [p.name]: e.target.value })} placeholder={p.example !== null ? String(p.example) : ""} />
                      )}
                    </label>
                  ))}
                </div>
              )}

              <div className="mt-4 grid gap-2 sm:grid-cols-[1fr,auto] sm:items-end">
                <label className="block">
                  <span className="mb-1 flex items-center gap-1.5 text-[12.5px] text-slate-300">
                    <KeyRound size={12} /> Authenticate with
                    <Explain text="Keys are stored hashed, so the full key is only known to the browser that created it. Sandbox keys you create here are remembered in this browser only. Paste any other key of this workspace to use it once." />
                  </span>
                  <select className={inputCls} value={keyChoice} onChange={(e) => setKeyChoice(e.target.value)}>
                    {usableKeys.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.name} · {k.prefix}…{k.sandbox ? " (sandbox)" : ""}
                      </option>
                    ))}
                    <option value="__paste">Paste a key…</option>
                    <option value="__none">No key (anonymous)</option>
                  </select>
                </label>
                <Btn variant="outline" onClick={newSandbox} disabled={createSandbox.isPending}>
                  {createSandbox.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} New sandbox key
                </Btn>
              </div>
              {keyChoice === "__paste" && <input className={cn(inputCls, "telemetry mt-2")} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="ags_live_… or ags_test_…" autoComplete="off" spellCheck={false} />}
              {!keyChoice && usableKeys.length === 0 && <p className="mt-2 text-[11.5px] text-slate-500">No key in this browser yet — create a sandbox key (read-only, 30 days) to try authenticated calls.</p>}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Btn onClick={run} disabled={send.isPending || (needsKey && !apiKey)} className="min-w-[120px]">
                  {send.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send request
                </Btn>
                <code className="telemetry min-w-0 flex-1 truncate text-[11.5px] text-slate-500">{previewUrl}</code>
              </div>
            </>
          )}
        </Panel>

        {/* Response */}
        {result ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <Panel
              title={
                <span className="flex items-center gap-2">
                  Response
                  <span className={cn("telemetry rounded px-1.5 py-0.5 text-[11px]", result.status && result.status < 300 ? "bg-emerald-400/15 text-emerald-300" : result.status && result.status < 500 ? "bg-amber-400/15 text-amber-300" : "bg-rose-400/15 text-rose-300")}>
                    {result.status ?? "ERR"} {result.statusText}
                  </span>
                </span>
              }
              subtitle={result.error ?? `${result.contentType ?? "—"}${result.truncated ? " · truncated at 200 KB" : ""}`}
              accent={result.ok ? "emerald" : "amber"}
              actions={
                <span className="telemetry inline-flex items-center gap-1 text-[11px] text-slate-400">
                  <Timer size={12} /> {result.ms} ms
                </span>
              }
            >
              <div className="mb-2 flex gap-1" role="tablist">
                {(["body", "headers", "code"] as const).map((t) => (
                  <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("rounded-md px-2.5 py-1 text-[11.5px] capitalize", tab === t ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-200")}>
                    {t === "code" ? "Code" : t}
                  </button>
                ))}
              </div>
              {tab === "body" && <JsonView text={result.body || "(empty body)"} className="max-h-[440px] rounded-xl border border-white/5 bg-[#050b18] p-3" />}
              {tab === "headers" && (
                <dl className="telemetry space-y-1 rounded-xl border border-white/5 bg-[#050b18] p-3 text-[12px]">
                  {Object.entries(result.headers).map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <dt className="text-cyan-300">{k}:</dt>
                      <dd className="break-all text-slate-300">{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {tab === "code" && (
                <div className="space-y-3">
                  <CodeBlock code={result.curl} title="curl — exactly this request (key masked)" />
                  <SnippetTabs make={(l) => snippet(l, { method: result.method, url: result.url })} />
                </div>
              )}
            </Panel>
          </motion.div>
        ) : (
          <Panel accent="cyan">
            <EmptyState icon={Play} title="Send a request to see the live response">
              Responses come from this deployment's real API — the same data your integrations get. Calls made here are counted in Usage.
            </EmptyState>
          </Panel>
        )}
      </div>
    </div>
  );
}
