"use client";

/**
 * Visual alert-rule builder:
 *   IF [metric] [op] [value] AND/OR …   FOR [scope]   THEN notify [channels]
 * with a live "would fire on N assets now" dry-run as you edit.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Copy, Eye, EyeOff, Hash, Mail, MessageCircle, Plus, Slack, Smartphone, Sparkles, Trash2, Webhook, Zap } from "lucide-react";
import { toast } from "sonner";
import { RiskPill } from "@/components/hud";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { TYPE_LABEL, fmtUsd } from "../format";
import { Chip, Field, Help, Modal, PfButton, Segmented, Toggle, inputCls } from "../ui";

type Rule = RouterOutputs["portfolio"]["listRules"][number];
type Metric = RouterOutputs["portfolio"]["meta"]["metrics"][number]["value"];
type Op = ">" | ">=" | "<" | "<=";
type Channel = "app" | "email" | "sms" | "whatsapp" | "webhook" | "slack";
type ScopeMode = "all" | "tags" | "types" | "countries" | "assets";

const CHANNELS: { value: Channel; label: string; icon: typeof Bell; help: string }[] = [
  { value: "app", label: "In-app", icon: Bell, help: "Bell notification for every workspace member, in real time" },
  { value: "email", label: "E-mail", icon: Mail, help: "E-mail to the recipients below (or workspace admins)" },
  { value: "sms", label: "SMS", icon: Smartphone, help: "Text message to recipients' phone numbers" },
  { value: "whatsapp", label: "WhatsApp", icon: MessageCircle, help: "WhatsApp message to recipients' phone numbers" },
  { value: "webhook", label: "Webhook", icon: Webhook, help: "Signed JSON POST to your system (core banking, claims, GIS)" },
  { value: "slack", label: "Slack", icon: Slack, help: "Message to a Slack channel via an incoming webhook" },
];

const RULE_METRIC_FALLBACK = ["flood_prob_72h", "flood_prob_24h", "salinity_ec", "composite", "rain_24h_mm", "rain_72h_mm", "drought_risk", "heat_risk", "river_discharge_ratio"];

const PRESETS: { name: string; description: string; conditions: { metric: Metric; op: Op; value: number }[]; severity: "info" | "warning" | "critical" }[] = [
  { name: "Heavy rain — parametric trigger watch", description: "72-hour rain forecast approaching a typical 150 mm payout trigger.", conditions: [{ metric: "rain_72h_mm", op: ">=", value: 120 }], severity: "warning" },
  { name: "Flood likely within 3 days", description: "Flood probability above 60% in the next 72 hours.", conditions: [{ metric: "flood_prob_72h", op: ">", value: 60 }], severity: "critical" },
  { name: "River well above normal", description: "Forecast river flow at least 1.5× its 30-day average.", conditions: [{ metric: "river_discharge_ratio", op: ">=", value: 1.5 }], severity: "warning" },
  { name: "Salinity above rice tolerance", description: "Soil EC forecast above 4 dS/m.", conditions: [{ metric: "salinity_ec", op: ">", value: 4 }], severity: "warning" },
  { name: "Dry spell + heat", description: "Drought and heat stress together.", conditions: [{ metric: "drought_risk", op: ">=", value: 50 }, { metric: "heat_risk", op: ">=", value: 40 }], severity: "warning" },
  { name: "High composite risk", description: "Any asset whose composite climate score crosses 70.", conditions: [{ metric: "composite", op: ">", value: 70 }], severity: "critical" },
];

interface Draft {
  name: string;
  description: string;
  enabled: boolean;
  conditions: { metric: Metric; op: Op; value: number }[];
  match: "all" | "any";
  scopeMode: ScopeMode;
  tags: string[];
  types: string[];
  countries: string[];
  assetIds: string[];
  severity: "info" | "warning" | "critical";
  channels: Channel[];
  recipients: string[];
  webhookUrl: string;
  slackUrl: string;
  cooldownHours: number;
}

const blank = (): Draft => ({ name: "", description: "", enabled: true, conditions: [{ metric: "flood_prob_72h", op: ">", value: 60 }], match: "all", scopeMode: "all", tags: [], types: [], countries: [], assetIds: [], severity: "warning", channels: ["app", "email"], recipients: [], webhookUrl: "", slackUrl: "", cooldownHours: 12 });

function fromRule(r: Rule): Draft {
  const s = r.scope;
  const scopeMode: ScopeMode = s.assetIds?.length ? "assets" : s.tags?.length ? "tags" : s.types?.length ? "types" : s.countries?.length ? "countries" : "all";
  return {
    name: r.name,
    description: r.description,
    enabled: r.enabled,
    conditions: r.conditions as Draft["conditions"],
    match: r.match,
    scopeMode,
    tags: s.tags ?? [],
    types: (s.types as string[]) ?? [],
    countries: s.countries ?? [],
    assetIds: s.assetIds ?? [],
    severity: r.severity,
    channels: r.channels as Channel[],
    recipients: r.recipients,
    webhookUrl: r.webhookUrl ?? "",
    slackUrl: r.slackUrl ?? "",
    cooldownHours: r.cooldownHours,
  };
}

function scopeOf(d: Draft) {
  switch (d.scopeMode) {
    case "tags":
      return { tags: d.tags };
    case "types":
      return { types: d.types as never[] };
    case "countries":
      return { countries: d.countries };
    case "assets":
      return { assetIds: d.assetIds };
    default:
      return {};
  }
}

function useDebounced<T>(v: T, ms: number) {
  const [x, setX] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setX(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return x;
}

export interface RulePrefill {
  metric?: string;
  op?: string;
  value?: number;
  tags?: string[];
  types?: string[];
  countries?: string[];
  assetIds?: string[];
  /** free-text place (country, district, village or asset name) resolved against the workspace's assets */
  place?: string;
  name?: string;
  severity?: string;
}

const OPS: Op[] = [">", ">=", "<", "<="];

function applyPrefill(base: Draft, p: RulePrefill | null | undefined, metrics: Set<string>): Draft {
  if (!p) return base;
  const d = { ...base };
  if (p.metric && metrics.has(p.metric)) {
    const op = OPS.includes(p.op as Op) ? (p.op as Op) : ">=";
    d.conditions = [{ metric: p.metric as Metric, op, value: Number.isFinite(p.value) ? p.value! : base.conditions[0]!.value }];
  }
  if (p.assetIds?.length) Object.assign(d, { scopeMode: "assets", assetIds: p.assetIds });
  else if (p.tags?.length) Object.assign(d, { scopeMode: "tags", tags: p.tags.map((t) => t.toLowerCase()) });
  else if (p.types?.length) Object.assign(d, { scopeMode: "types", types: p.types });
  else if (p.countries?.length) Object.assign(d, { scopeMode: "countries", countries: p.countries });
  if (p.severity === "info" || p.severity === "warning" || p.severity === "critical") d.severity = p.severity;
  if (p.name) d.name = p.name.slice(0, 120);
  return d;
}

export function RuleBuilder({ open, onClose, rule, onSaved, prefill }: { open: boolean; onClose: () => void; rule: Rule | null; onSaved?: () => void; prefill?: RulePrefill | null }) {
  const utils = trpc.useUtils();
  const meta = trpc.portfolio.meta.useQuery(undefined, { staleTime: 3600_000 });
  const opts = trpc.portfolio.ruleOptions.useQuery(undefined, { enabled: open, staleTime: 60_000 });
  const [d, setD] = useState<Draft>(blank);
  const [recipientText, setRecipientText] = useState("");
  const [assetFilter, setAssetFilter] = useState("");
  const [showSecret, setShowSecret] = useState(false);

  const [placeNote, setPlaceNote] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setD(rule ? fromRule(rule) : applyPrefill(blank(), prefill, new Set(meta.data?.metrics.map((m) => m.value) ?? RULE_METRIC_FALLBACK)));
      setRecipientText("");
      setPlaceNote(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rule, prefill, meta.data]);

  // Resolve a free-text place (from a deep link) once the workspace's assets are known
  useEffect(() => {
    const fold = (v: string | null | undefined) => (v ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    const place = fold(prefill?.place?.trim());
    if (!open || rule || !place || !opts.data) return;
    const country = opts.data.countries.find((c) => fold(c.value) === place);
    if (country) {
      setD((x) => ({ ...x, scopeMode: "countries", countries: [country.value] }));
      setPlaceNote(`Scoped to ${country.value}`);
      return;
    }
    const ids = opts.data.assets.filter((a) => [a.name, a.district, a.address, a.country].some((v) => !!v && fold(v).includes(place))).map((a) => a.id);
    if (ids.length) {
      setD((x) => ({ ...x, scopeMode: "assets", assetIds: ids, name: x.name || `Alert — ${prefill!.place}` }));
      setPlaceNote(`Scoped to ${ids.length} asset${ids.length === 1 ? "" : "s"} matching “${prefill!.place}”`);
    } else setPlaceNote(`No assets match “${prefill!.place}” — scope left as all assets`);
  }, [open, rule, prefill, opts.data]);

  const metricMeta = useMemo(() => new Map(meta.data?.metrics.map((m) => [m.value, m]) ?? []), [meta.data]);
  const draftForTest = useMemo(() => ({ scope: scopeOf(d), conditions: d.conditions, match: d.match }), [d]);
  const debounced = useDebounced(draftForTest, 350);
  const test = trpc.portfolio.testRule.useQuery({ draft: debounced }, { enabled: open && debounced.conditions.length > 0, placeholderData: (p) => p });

  const onDone = {
    onSuccess: () => {
      toast.success(rule ? "Rule updated" : "Rule created", { description: "The portfolio monitor evaluates it every hour. Use “Run now” to evaluate immediately." });
      utils.portfolio.listRules.invalidate();
      onSaved?.();
      onClose();
    },
    onError: (e: { message: string }) => toast.error(e.message),
  };
  const createM = trpc.portfolio.createRule.useMutation(onDone);
  const updateM = trpc.portfolio.updateRule.useMutation(onDone);
  const saving = createM.isPending || updateM.isPending;

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const setCond = (i: number, patch: Partial<Draft["conditions"][number]>) => set("conditions", d.conditions.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  const toggleIn = (k: "tags" | "types" | "countries" | "assetIds" | "channels" | "recipients", v: string) => {
    const list = d[k] as string[];
    set(k, (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]) as never);
  };

  const needsWebhook = d.channels.includes("webhook");
  const needsSlack = d.channels.includes("slack");
  const needsPhones = d.channels.includes("sms") || d.channels.includes("whatsapp");
  const scopeEmpty = d.scopeMode !== "all" && (scopeOf(d) as Record<string, string[]>)[Object.keys(scopeOf(d))[0]!]?.length === 0;
  const invalid = !d.name.trim() || !d.channels.length || !d.conditions.length || scopeEmpty || (needsWebhook && !/^https?:\/\//.test(d.webhookUrl)) || (needsSlack && !/^https:\/\//.test(d.slackUrl));

  const submit = () => {
    const body = {
      name: d.name.trim(),
      description: d.description.trim(),
      enabled: d.enabled,
      scope: scopeOf(d),
      conditions: d.conditions,
      match: d.match,
      severity: d.severity,
      channels: d.channels,
      recipients: d.recipients,
      webhookUrl: needsWebhook ? d.webhookUrl.trim() : null,
      slackUrl: needsSlack ? d.slackUrl.trim() : null,
      cooldownHours: d.cooldownHours,
    };
    if (rule) updateM.mutate({ id: rule.id, patch: body });
    else createM.mutate(body);
  };

  const members = opts.data?.members ?? [];
  const filteredAssets = (opts.data?.assets ?? [])
    .filter((a) => !assetFilter || a.name.toLowerCase().includes(assetFilter.toLowerCase()))
    .sort((x, y) => Number(d.assetIds.includes(y.id)) - Number(d.assetIds.includes(x.id)))
    .slice(0, Math.max(60, d.assetIds.length));
  const t = test.data;

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={rule ? `Edit rule · ${rule.name}` : "New alert rule"}
      subtitle="Describe the situation you care about. We check it against every asset after each hourly re-score and notify the right people."
      footer={
        <>
          <span className="mr-auto text-[11px] text-slate-500">
            {invalid ? "Fill in a name, at least one channel and the fields marked for your channels." : "Saved rules run hourly; you can also run them on demand."}
          </span>
          <PfButton variant="ghost" onClick={onClose}>
            Cancel
          </PfButton>
          <PfButton onClick={submit} disabled={invalid} loading={saving}>
            <Zap size={14} /> {rule ? "Save rule" : "Create rule"}
          </PfButton>
        </>
      }
    >
      {!rule && (
        <div className="mb-4">
          <div className="hud-label mb-1.5 flex items-center gap-1.5">
            <Sparkles size={11} /> Start from a template
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <Chip key={p.name} onClick={() => setD((x) => ({ ...x, name: p.name, description: p.description, conditions: p.conditions, severity: p.severity, match: "all" }))}>
                {p.name}
              </Chip>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <div className="min-w-0 space-y-4">
          {/* IF */}
          <section className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-display text-sm font-semibold text-sky-300">IF</span>
              {d.conditions.length > 1 && <Segmented value={d.match} onChange={(v) => set("match", v)} options={[{ value: "all", label: "ALL conditions (AND)" }, { value: "any", label: "ANY condition (OR)" }]} />}
            </div>
            <div className="space-y-2">
              {d.conditions.map((c, i) => {
                const m = metricMeta.get(c.metric);
                return (
                  <div key={i}>
                    {i > 0 && <div className="telemetry my-1 text-center text-[10px] text-sky-400/70">{d.match === "all" ? "AND" : "OR"}</div>}
                    <div className="flex flex-wrap items-center gap-2">
                      <select className={cn(inputCls, "w-auto min-w-[190px] flex-1 py-1.5")} value={c.metric} onChange={(e) => setCond(i, { metric: e.target.value as Metric, value: metricMeta.get(e.target.value as Metric)?.suggested ?? c.value })} aria-label="Metric">
                        {meta.data?.metrics.map((mm) => (
                          <option key={mm.value} value={mm.value}>
                            {mm.label}
                          </option>
                        ))}
                      </select>
                      <select className={cn(inputCls, "w-auto py-1.5")} value={c.op} onChange={(e) => setCond(i, { op: e.target.value as Op })} aria-label="Operator">
                        {meta.data?.ops.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <div className="flex items-center gap-1">
                        <input className={cn(inputCls, "telemetry w-24 py-1.5")} type="number" step={m?.step ?? 1} min={m?.min} max={m?.max} value={c.value} onChange={(e) => setCond(i, { value: Number(e.target.value) })} aria-label="Threshold" />
                        <span className="w-10 text-xs text-slate-400">{m?.unit}</span>
                      </div>
                      {m && <Help text={m.help} />}
                      {d.conditions.length > 1 && (
                        <button onClick={() => set("conditions", d.conditions.filter((_, k) => k !== i))} className="p-1 text-slate-500 hover:text-rose-300" aria-label="Remove condition">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                    {m && <input type="range" className="mt-1 w-full accent-sky-400" min={m.min} max={m.max} step={m.step} value={c.value} onChange={(e) => setCond(i, { value: Number(e.target.value) })} aria-label={`${m.label} slider`} />}
                  </div>
                );
              })}
            </div>
            {d.conditions.length < 8 && (
              <button className="mt-2 inline-flex items-center gap-1 text-xs text-sky-300 hover:underline" onClick={() => set("conditions", [...d.conditions, { metric: "rain_72h_mm", op: ">=", value: 100 }])}>
                <Plus size={12} /> Add condition
              </button>
            )}
          </section>

          {/* FOR */}
          <section className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
            <div className="mb-2 font-display text-sm font-semibold text-sky-300">FOR</div>
            <Segmented
              value={d.scopeMode}
              onChange={(v) => set("scopeMode", v)}
              options={[
                { value: "all", label: "All assets" },
                { value: "tags", label: "Tags" },
                { value: "types", label: "Types" },
                { value: "countries", label: "Countries" },
                { value: "assets", label: "Pick assets" },
              ]}
            />
            {placeNote && <p className="mt-2 text-[11px] text-sky-300">{placeNote}</p>}
            <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
              {d.scopeMode === "all" && <p className="text-xs text-slate-400">Every active asset in the workspace, including ones added later.</p>}
              {d.scopeMode === "tags" &&
                opts.data?.tags.map((t) => (
                  <Chip key={t.value} active={d.tags.includes(t.value)} onClick={() => toggleIn("tags", t.value)}>
                    <Hash size={10} />
                    {t.value} <span className="text-slate-500">{t.count}</span>
                  </Chip>
                ))}
              {d.scopeMode === "types" &&
                opts.data?.types.map((t) => (
                  <Chip key={t.value} active={d.types.includes(t.value)} onClick={() => toggleIn("types", t.value)}>
                    {t.label} <span className="text-slate-500">{t.count}</span>
                  </Chip>
                ))}
              {d.scopeMode === "countries" &&
                opts.data?.countries.map((c) => (
                  <Chip key={c.value} active={d.countries.includes(c.value)} onClick={() => toggleIn("countries", c.value)}>
                    {c.value} <span className="text-slate-500">{c.count}</span>
                  </Chip>
                ))}
              {d.scopeMode === "assets" && (
                <div className="w-full">
                  <input className={cn(inputCls, "mb-2 py-1.5")} placeholder={`Search ${opts.data?.assets.length ?? 0} assets…`} value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} />
                  <div className="flex flex-wrap gap-1.5">
                    {filteredAssets.map((a) => (
                      <Chip key={a.id} active={d.assetIds.includes(a.id)} onClick={() => toggleIn("assetIds", a.id)}>
                        {a.name}
                      </Chip>
                    ))}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">{d.assetIds.length} selected</div>
                </div>
              )}
            </div>
          </section>

          {/* THEN */}
          <section className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
            <div className="mb-2 font-display text-sm font-semibold text-sky-300">THEN notify</div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {CHANNELS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  title={c.help}
                  onClick={() => toggleIn("channels", c.value)}
                  className={cn("flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs transition-colors", d.channels.includes(c.value) ? "border-sky-400/60 bg-sky-400/10 text-white" : "border-white/5 text-slate-400 hover:border-slate-600")}
                  aria-pressed={d.channels.includes(c.value)}
                >
                  <c.icon size={13} /> {c.label}
                </button>
              ))}
            </div>
            {(d.channels.includes("email") || needsPhones) && (
              <div className="mt-3">
                <div className="hud-label mb-1">Recipients</div>
                <div className="flex flex-wrap gap-1.5">
                  {members.map((m) => {
                    const key = m.email ?? m.phone ?? m.id;
                    return (
                      <Chip key={m.id} active={d.recipients.includes(key)} onClick={() => toggleIn("recipients", key)} title={[m.email, m.phone].filter(Boolean).join(" · ")}>
                        {m.name}
                      </Chip>
                    );
                  })}
                  {d.recipients
                    .filter((r) => !members.some((m) => m.email === r || m.phone === r))
                    .map((r) => (
                      <Chip key={r} active onClick={() => toggleIn("recipients", r)}>
                        {r} ✕
                      </Chip>
                    ))}
                </div>
                <input
                  className={cn(inputCls, "mt-2 py-1.5")}
                  placeholder="Add e-mail or +phone and press Enter"
                  value={recipientText}
                  onChange={(e) => setRecipientText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const v = recipientText.trim();
                      if (v && !d.recipients.includes(v)) set("recipients", [...d.recipients, v]);
                      setRecipientText("");
                    }
                  }}
                />
                {needsPhones && <p className="mt-1 text-[10.5px] text-slate-500">SMS/WhatsApp go to phone numbers you add and to members who have a phone on file.</p>}
              </div>
            )}
            {needsWebhook && (
              <div className="mt-3 space-y-1.5">
                <Field label="Webhook URL" hint="We POST a JSON payload signed with HMAC-SHA256.">
                  <input className={inputCls} value={d.webhookUrl} onChange={(e) => set("webhookUrl", e.target.value)} placeholder="https://your-system.example.com/hooks/climate" />
                </Field>
                {opts.data?.webhookSecret && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-950/60 px-2.5 py-1.5 text-[11px] text-slate-400">
                    Verify header <code className="text-sky-300">{opts.data.signatureHeader}</code> = sha256(secret, raw body). Secret:
                    <code className="telemetry text-slate-200">{showSecret ? opts.data.webhookSecret : "whsec_••••••••"}</code>
                    <button onClick={() => setShowSecret((s) => !s)} aria-label="Reveal secret" className="hover:text-white">
                      {showSecret ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                    <button
                      onClick={() => {
                        navigator.clipboard?.writeText(opts.data!.webhookSecret!);
                        toast.success("Signing secret copied");
                      }}
                      aria-label="Copy secret"
                      className="hover:text-white"
                    >
                      <Copy size={12} />
                    </button>
                  </div>
                )}
              </div>
            )}
            {needsSlack && (
              <Field label="Slack incoming-webhook URL" className="mt-3" hint="Slack → Apps → Incoming Webhooks → Add to channel">
                <input className={inputCls} value={d.slackUrl} onChange={(e) => set("slackUrl", e.target.value)} placeholder="https://hooks.slack.com/services/T000/B000/XXXX" />
              </Field>
            )}
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Severity">
                <Segmented value={d.severity} onChange={(v) => set("severity", v)} options={[{ value: "info", label: "Info" }, { value: "warning", label: "Warning" }, { value: "critical", label: "Critical" }]} />
              </Field>
              <Field
                label={
                  <>
                    Quiet period <Help text="After the rule fires it stays silent for this many hours, so a storm doesn't page your team every hour." />
                  </>
                }
              >
                <select className={inputCls} value={d.cooldownHours} onChange={(e) => set("cooldownHours", Number(e.target.value))}>
                  {[0, 1, 3, 6, 12, 24, 48, 72, 168].map((h) => (
                    <option key={h} value={h}>
                      {h === 0 ? "none" : h < 24 ? `${h} h` : `${h / 24} day${h === 24 ? "" : "s"}`}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Field label="Rule name">
              <input className={inputCls} value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Flood watch — coastal book" maxLength={120} />
            </Field>
            <Field label="Enabled">
              <div className="flex h-[38px] items-center">
                <Toggle checked={d.enabled} onChange={(v) => set("enabled", v)} label="Enabled" />
              </div>
            </Field>
            <Field label="Description (optional)" className="sm:col-span-2">
              <input className={inputCls} value={d.description} onChange={(e) => set("description", e.target.value)} placeholder="Why this rule exists / what to do when it fires" maxLength={500} />
            </Field>
          </div>
        </div>

        {/* Live preview */}
        <aside className="min-w-0">
          <div className="sticky top-0 rounded-xl border border-sky-400/20 bg-sky-400/[0.04] p-3">
            <div className="hud-label mb-1 flex items-center gap-1.5 text-sky-300">
              <Zap size={11} /> Live preview
            </div>
            {t ? (
              <>
                <div className="flex items-baseline gap-2">
                  <motion.span key={t.matchCount} initial={{ scale: 1.3, opacity: 0.4 }} animate={{ scale: 1, opacity: 1 }} className={cn("telemetry text-4xl font-semibold", t.matchCount ? "text-rose-300" : "text-emerald-300")}>
                    {t.matchCount}
                  </motion.span>
                  <span className="text-xs text-slate-400">of {t.inScope} assets in scope would fire now</span>
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  {t.matchCount ? `${fmtUsd(t.exposureUsd)} exposure affected` : "Nothing crosses the threshold today — the rule will wait."}
                  {t.withData < t.inScope && ` · ${t.inScope - t.withData} without data yet`}
                </div>
                <ul className="mt-3 max-h-[360px] space-y-1.5 overflow-y-auto">
                  <AnimatePresence initial={false}>
                    {t.matches.slice(0, 25).map((m) => (
                      <motion.li key={m.assetId} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rounded-lg bg-slate-950/50 px-2.5 py-1.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <Link href={`/app/portfolio/${m.assetId}`} target="_blank" className="truncate text-slate-200 hover:text-sky-300">
                            {m.name}
                          </Link>
                          <RiskPill level={m.level} />
                        </div>
                        <div className="telemetry mt-0.5 text-[10.5px] text-slate-400">{m.reason}</div>
                        <div className="text-[10px] text-slate-500">
                          {TYPE_LABEL[m.type ?? ""] ?? m.type} · {fmtUsd(m.valueUsd)}
                        </div>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
                {t.matchCount > 25 && <div className="mt-1 text-[11px] text-slate-500">…and {t.matchCount - 25} more</div>}
              </>
            ) : (
              <div className="skeleton h-24 rounded-lg" />
            )}
          </div>
        </aside>
      </div>
    </Modal>
  );
}
