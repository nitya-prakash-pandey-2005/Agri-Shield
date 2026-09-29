/**
 * Public developer portal (/developers): overview, quickstart, authentication,
 * rate limits, errors, signed webhooks, SDK quickstarts, endpoint reference
 * (generated from the live OpenAPI document) and the latest changelog entries.
 */
import Link from "next/link";
import { headers } from "next/headers";
import { ArrowRight, BookOpen, Braces, Code2, Gauge, KeyRound, Lock, Megaphone, Radar, ShieldCheck, Terminal, Webhook, Zap } from "lucide-react";
import { openApiDocument } from "@/server/api/openapi";
import { API_SCOPES } from "@/server/data/sc-reference";
import { WS_WEBHOOK_EVENTS } from "@/server/routers/workspace";
import { CHANGELOG } from "@/components/help/articles";
import { CodeBlock } from "@/components/developers/CodeBlock";
import { PortalSnippet, WebhookVerifySnippet } from "@/components/developers/PortalSnippet";

export const dynamic = "force-dynamic";

const TOC = [
  ["overview", "Overview"],
  ["quickstart", "Quickstart"],
  ["auth", "Authentication"],
  ["limits", "Rate limits"],
  ["errors", "Errors"],
  ["webhooks", "Webhooks"],
  ["sdks", "SDK quickstarts"],
  ["reference", "Endpoint reference"],
  ["changelog", "Changelog"],
] as const;

const METHOD: Record<string, string> = { get: "bg-emerald-400/15 text-emerald-300", post: "bg-amber-400/15 text-amber-300" };

function H2({ id, icon: Icon, children }: { id: string; icon: typeof Code2; children: React.ReactNode }) {
  return (
    <h2 id={id} className="flex scroll-mt-24 items-center gap-2 font-display text-2xl font-semibold tracking-tight text-white">
      <Icon size={20} className="text-cyan-300" /> {children}
    </h2>
  );
}

export default async function DevelopersPortal() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  // The host the reader is actually using wins, so snippets are copy-paste ready
  const base = host ? `${proto}://${host}` : (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");
  const doc = openApiDocument(base) as unknown as { paths: Record<string, Record<string, { operationId: string; summary?: string; tags?: string[]; description?: string; security?: Record<string, unknown>[] }>> };
  const ops = Object.entries(doc.paths).flatMap(([path, m]) => Object.entries(m).map(([method, op]) => ({ path, method, ...op })));
  const riskUrl = `${base}/api/v1/risk?lat=10.03&lon=105.78&type=salinity&crop=rice`;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-12 sm:px-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl border border-cyan-400/20 bg-gradient-to-br from-cyan-500/[0.08] via-slate-950/40 to-emerald-500/[0.06] p-6 sm:p-10">
        <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-cyan-500/15 blur-3xl" />
        <div className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/25 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200">
          <Code2 size={13} /> Developer portal · API v{(openApiDocument(base) as { info: { version: string } }).info.version}
        </div>
        <h1 className="mt-4 max-w-3xl font-display text-3xl font-semibold tracking-tight text-white sm:text-5xl">Climate risk for any coordinate, in one HTTP call</h1>
        <p className="mt-4 max-w-2xl text-slate-400 sm:text-lg">Pull flood and salinity risk, commodity disruption and platform health into your core-banking, underwriting, ERP or GIS systems — and get signed webhooks when risk changes.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/app/developers" className="inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-[0_0_24px_-6px_rgba(56,189,248,0.9)]">
            <Terminal size={16} /> Open the API explorer
          </Link>
          <a href={`${base}/api/v1/openapi.json`} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-200 hover:border-cyan-400/50">
            <Braces size={16} /> OpenAPI 3.1 spec
          </a>
          <Link href="/docs" className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-200 hover:border-cyan-400/50">
            <BookOpen size={16} /> Guides &amp; methodology
          </Link>
        </div>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[200px,minmax(0,1fr)]">
        <nav aria-label="On this page" className="hidden lg:block">
          <ul className="sticky top-24 space-y-1 border-l border-white/10 text-sm">
            {TOC.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="-ml-px block border-l border-transparent py-1 pl-3 text-slate-400 hover:border-cyan-400 hover:text-white">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-14">
          <section className="space-y-4">
            <H2 id="overview" icon={Radar}>
              Overview
            </H2>
            <p className="text-slate-400">A REST API over HTTPS with JSON responses. Every response carries an <code className="telemetry text-cyan-200">X-Request-Id</code> you can quote to support. The same models power the Agri-SHIELD workspace: ML flood and salinity models with physics fallbacks on live open data (Open-Meteo, GloFAS, GDACS).</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { icon: Radar, t: "Point risk", d: "Flood or salinity for any lat/lon — probabilities, depth, EC, crop damage and drivers." },
                { icon: Gauge, t: "Commodity risk", d: "Supply disruption and price impact for 7/14/30-day horizons." },
                { icon: Webhook, t: "Signed webhooks", d: "Reports ready, rules fired, thresholds crossed — HMAC-signed POSTs." },
              ].map((c) => (
                <div key={c.t} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                  <c.icon size={18} className="text-emerald-300" />
                  <div className="mt-2 font-medium text-white">{c.t}</div>
                  <p className="mt-1 text-sm text-slate-400">{c.d}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <H2 id="quickstart" icon={Zap}>
              Quickstart — first call in 2 minutes
            </H2>
            <ol className="space-y-3 text-slate-300">
              <li>
                <b className="text-white">1. Get a key.</b> In your workspace open <Link href="/app/developers?tab=keys" className="text-cyan-300 hover:underline">Developers → Keys &amp; sandbox</Link> and create a sandbox key (read-only, 30 days), or ask an admin for a live key in Settings → API &amp; integrations.
              </li>
              <li>
                <b className="text-white">2. Call the API.</b> Salinity risk for a rice field in the Mekong Delta:
              </li>
            </ol>
            <CodeBlock code={`curl -sS "${riskUrl}" \\\n  -H "X-API-Key: $AGRISHIELD_API_KEY"`} title="shell" />
            <p className="text-slate-400">
              <b className="text-white">3. Explore.</b> Every endpoint is callable from the in-app <Link href="/app/developers" className="text-cyan-300 hover:underline">API explorer</Link>, which builds a form from the spec and shows the live response and the equivalent code.
            </p>
          </section>

          <section className="space-y-4">
            <H2 id="auth" icon={KeyRound}>
              Authentication
            </H2>
            <p className="text-slate-400">
              Send your organisation key in the <code className="telemetry text-cyan-200">X-API-Key</code> header, or as <code className="telemetry text-cyan-200">Authorization: Bearer ags_live_…</code>. Keys are shown once and stored only as SHA-256 hashes. <code className="telemetry">ags_live_</code> keys are for production; <code className="telemetry">ags_test_</code> sandbox keys are read-only and expire automatically.
            </p>
            <div className="overflow-x-auto rounded-2xl border border-white/10">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="bg-white/[0.03] text-left text-slate-400">
                  <tr>
                    <th className="px-4 py-2 font-medium">Scope</th>
                    <th className="px-4 py-2 font-medium">Grants</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-slate-300">
                  {API_SCOPES.map((s) => (
                    <tr key={s}>
                      <td className="telemetry px-4 py-2 text-cyan-200">{s}</td>
                      <td className="px-4 py-2">{({ "risk:read": "Point flood/salinity risk", "commodities:read": "Commodity disruption risk", "network:read": "Supply-network nodes and flows", "scenarios:run": "Run Monte Carlo disruption scenarios", "webhooks:manage": "Create and manage webhooks via API" } as Record<string, string>)[s] ?? s}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm text-slate-400">
              <ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-300" /> Workspace sign-in supports authenticator-app 2-step verification, company single sign-on (OpenID Connect with PKCE), IP allow-lists and custom roles — admins configure them in Settings → Security.
            </p>
          </section>

          <section className="space-y-4">
            <H2 id="limits" icon={Gauge}>
              Rate limits
            </H2>
            <div className="overflow-x-auto rounded-2xl border border-white/10">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="bg-white/[0.03] text-left text-slate-400">
                  <tr>
                    <th className="px-4 py-2 font-medium">Caller</th>
                    <th className="px-4 py-2 font-medium">Limit</th>
                    <th className="px-4 py-2 font-medium">Window</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-slate-300">
                  <tr>
                    <td className="px-4 py-2">Anonymous (no key), per IP</td>
                    <td className="telemetry px-4 py-2">30 requests</td>
                    <td className="px-4 py-2">1 minute</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2">Per API key</td>
                    <td className="telemetry px-4 py-2">600 requests</td>
                    <td className="px-4 py-2">1 minute</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2">Per organisation (all keys)</td>
                    <td className="telemetry px-4 py-2">1,000 requests</td>
                    <td className="px-4 py-2">1 minute</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2">Monthly API calls</td>
                    <td className="px-4 py-2">By plan — see Settings → Plan &amp; billing</td>
                    <td className="px-4 py-2">Calendar month</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-slate-400">
              Over the limit you get <code className="telemetry text-amber-200">429 rate_limited</code> with a <code className="telemetry">Retry-After</code> header (seconds). Back off exponentially and retry.
            </p>
          </section>

          <section className="space-y-4">
            <H2 id="errors" icon={Lock}>
              Errors
            </H2>
            <p className="text-slate-400">Errors share one envelope. Branch on the HTTP status and <code className="telemetry">error.code</code>; show <code className="telemetry">error.message</code> to humans.</p>
            <CodeBlock
              title="application/json"
              code={JSON.stringify({ error: { code: "forbidden", message: "API key lacks scope commodities:read" } }, null, 2)}
            />
            <ul className="grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
              {[
                ["400 invalid_request", "A parameter is missing or out of range"],
                ["401 unauthorized", "Missing, malformed, revoked or expired key"],
                ["403 forbidden", "The key lacks the scope for this endpoint"],
                ["429 rate_limited", "Too many requests — honour Retry-After"],
                ["502 upstream_error", "A model or data source failed; safe to retry"],
              ].map(([c, d]) => (
                <li key={c} className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
                  <span className="telemetry text-amber-200">{c}</span>
                  <span className="block text-slate-400">{d}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-4">
            <H2 id="webhooks" icon={Webhook}>
              Webhooks
            </H2>
            <p className="text-slate-400">
              Register an HTTPS endpoint in Settings → API &amp; integrations and choose events. Each delivery is a JSON <code className="telemetry">POST</code> with headers <code className="telemetry text-cyan-200">X-AgriShield-Event</code>, <code className="telemetry text-cyan-200">X-AgriShield-Delivery</code>, <code className="telemetry text-cyan-200">X-AgriShield-Timestamp</code> and <code className="telemetry text-cyan-200">X-AgriShield-Signature: sha256=&lt;hex HMAC-SHA256 of the raw body&gt;</code>. Answer 2xx within 10 seconds; inspect and redeliver past deliveries in Developers → Webhooks.
            </p>
            <ul className="grid gap-2 text-sm sm:grid-cols-2">
              {[...WS_WEBHOOK_EVENTS, { id: "commodity.risk.threshold", label: "A commodity's disruption risk crossed your threshold (supply chain)" }].map((e) => (
                <li key={e.id} className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
                  <span className="telemetry text-cyan-200">{e.id}</span>
                  <span className="block text-slate-400">{e.label}</span>
                </li>
              ))}
            </ul>
            <WebhookVerifySnippet />
          </section>

          <section className="space-y-4">
            <H2 id="sdks" icon={Code2}>
              SDK quickstarts
            </H2>
            <p className="text-slate-400">No SDK install needed — the API is plain HTTPS + JSON. Copy a starter in your language (reads the key from <code className="telemetry">AGRISHIELD_API_KEY</code>):</p>
            <PortalSnippet url={riskUrl} />
          </section>

          <section className="space-y-4">
            <H2 id="reference" icon={Braces}>
              Endpoint reference
            </H2>
            <ul className="divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/10">
              {ops.map((o) => (
                <li key={o.operationId} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:gap-3">
                  <span className={`telemetry w-12 shrink-0 rounded px-1.5 py-0.5 text-center text-[11px] font-semibold uppercase ${METHOD[o.method] ?? "bg-white/10 text-slate-300"}`}>{o.method}</span>
                  <div className="min-w-0 flex-1">
                    <div className="telemetry break-all text-sm text-white">{o.path}</div>
                    <div className="text-sm text-slate-400">{o.summary}</div>
                  </div>
                  <Link href={`/app/developers?tab=explorer&op=${o.operationId}`} className="inline-flex shrink-0 items-center gap-1 text-[13px] text-cyan-300 hover:underline">
                    Try it <ArrowRight size={13} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-4">
            <H2 id="changelog" icon={Megaphone}>
              Changelog
            </H2>
            <ul className="space-y-3">
              {CHANGELOG.slice(0, 3).map((c) => (
                <li key={c.version} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                  <div className="flex flex-wrap items-center gap-2 text-[13px] text-slate-400">
                    <span className="telemetry rounded bg-white/5 px-1.5 py-0.5 text-slate-300">v{c.version}</span> {c.date}
                  </div>
                  <div className="mt-1 font-medium text-white">{c.title}</div>
                </li>
              ))}
            </ul>
            <Link href="/changelog" className="inline-flex items-center gap-1 text-cyan-300 hover:underline">
              Full changelog <ArrowRight size={14} />
            </Link>
          </section>
        </div>
      </div>
    </div>
  );
}
