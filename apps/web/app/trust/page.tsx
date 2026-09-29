import Link from "next/link";
import { Activity, ArrowRight, Database, FileLock2, Globe2, KeyRound, Lock, ScrollText, ServerCog, ShieldCheck, Timer, UserCheck, Webhook } from "lucide-react";
import { PROBES } from "@/server/health/sources";

const CONTROLS = [
  { icon: UserCheck, title: "Role-based access", body: "Every page, tRPC procedure and API route checks the caller's role. Workspaces are isolated by organisation; analysts can't change billing, team or keys." },
  { icon: KeyRound, title: "Hashed API keys", body: "Workspace API keys are shown once and stored only as SHA-256 hashes, with scopes (risk:read, scenarios:run…) and instant revocation." },
  { icon: Webhook, title: "Signed webhooks", body: "Every outbound delivery carries an HMAC-SHA256 X-AgriShield-Signature so your systems can verify it came from us." },
  { icon: Timer, title: "Rate limiting", body: "100 requests/min per user, 1,000/min per organisation, 600/min per API key — protecting you from runaway scripts and abuse." },
  { icon: ScrollText, title: "Audit log", body: "Sign-ins, invites, role changes, key creation, plan changes, exports and deletion requests are recorded and exportable as CSV by workspace admins." },
  { icon: Lock, title: "Browser hardening", body: "Content-Security-Policy, X-Frame-Options DENY, nosniff, strict referrer policy and a restrictive Permissions-Policy on every response." },
];

const SLAS = [
  { plan: "Free", uptime: "Best effort", support: "Help centre + email, 2 business days", rpo: "—" },
  { plan: "Business", uptime: "99.5% monthly target", support: "Email, 1 business day · bugs & security 4 business hours", rpo: "Daily backups (production deployments)" },
  { plan: "Enterprise", uptime: "99.9% contractual SLA with service credits", support: "Named success manager, 4-hour P1 response", rpo: "Point-in-time recovery, region pinning" },
];

const OPTIONAL_PROCESSORS = [
  { name: "Stripe", purpose: "Card subscriptions (only when STRIPE_SECRET_KEY is configured)", region: "US / EU" },
  { name: "Razorpay", purpose: "UPI / INR payments (only when configured)", region: "India" },
  { name: "Twilio", purpose: "SMS & WhatsApp alerts (only when configured)", region: "US" },
  { name: "Resend", purpose: "Transactional email (only when configured)", region: "US" },
];

export default function TrustPage() {
  const providers = [...new Map(PROBES.map((p) => [p.provider, p])).values()];
  return (
    <div className="mx-auto max-w-6xl px-4 pb-20 pt-12 sm:px-6">
      <div className="max-w-3xl">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200">
          <ShieldCheck size={13} /> Trust centre
        </div>
        <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">Security, privacy and reliability — stated plainly</h1>
        <p className="mt-3 text-slate-400">Insurers, banks and governments need to know exactly how a risk platform handles their data. This page says what is in place today, what depends on your deployment, and what we don't claim.</p>
        <div className="mt-5 flex flex-wrap gap-2 text-sm">
          <Link href="/status" className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-slate-200 hover:border-cyan-400/40">
            <Activity size={14} /> Live status
          </Link>
          <Link href="/docs/security" className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-slate-200 hover:border-cyan-400/40">
            <FileLock2 size={14} /> Security overview
          </Link>
          <Link href="/docs/privacy" className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-slate-200 hover:border-cyan-400/40">
            <FileLock2 size={14} /> Privacy policy
          </Link>
        </div>
      </div>

      <section className="mt-12">
        <h2 className="font-display text-xl font-semibold text-white">Security controls in the product</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CONTROLS.map((c) => (
            <div key={c.title} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <c.icon size={18} className="text-cyan-300" />
              <h3 className="mt-3 font-medium text-white">{c.title}</h3>
              <p className="mt-1 text-[13.5px] leading-relaxed text-slate-400">{c.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-500/[0.05] p-4 text-[13px] text-amber-100">
          <b>Not certified.</b> Agri-SHIELD is not ISO 27001 or SOC 2 certified. Controls are designed to map to ISO/IEC 27001:2022 Annex A so an audit can follow. We'll say so here the day that changes.
        </p>
      </section>

      <section className="mt-12 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <div className="flex items-center gap-2">
            <Globe2 size={18} className="text-violet-300" />
            <h2 className="font-display text-lg font-semibold text-white">Data residency</h2>
          </div>
          <ul className="mt-3 space-y-2 text-[13.5px] leading-relaxed text-slate-300">
            <li>• <b>This demo environment</b> keeps workspace data in server memory; it is reset on restart and should hold no real customer data.</li>
            <li>• <b>Production deployments</b> run on PostgreSQL with row-level security in the cloud region you choose (e.g. Mumbai, Singapore, Frankfurt). Government deployments can run in-country or on-premise.</li>
            <li>• Climate and hazard data comes from public open-data providers (below); your portfolio records are never sent to them — only coordinates (rounded to ~1 km for portfolio scoring) and, for search, the place name you type.</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <div className="flex items-center gap-2">
            <Database size={18} className="text-emerald-300" />
            <h2 className="font-display text-lg font-semibold text-white">Privacy & your data</h2>
          </div>
          <ul className="mt-3 space-y-2 text-[13.5px] leading-relaxed text-slate-300">
            <li>• Designed for GDPR and India's DPDP Act 2023; see the privacy policy for Bangladesh, Vietnam, Philippines and Indonesia.</li>
            <li>• We never sell data and don't train models on customer portfolios.</li>
            <li>• Admins can export the entire workspace as JSON at any time (Settings → Security).</li>
            <li>• Workspace deletion has a 30-day grace period any admin can cancel; after that, data is removed.</li>
          </ul>
        </div>
      </section>

      <section className="mt-12">
        <div className="flex items-center gap-2">
          <ServerCog size={18} className="text-cyan-300" />
          <h2 className="font-display text-xl font-semibold text-white">Service levels</h2>
        </div>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[640px] text-[13.5px]">
            <thead className="bg-white/[0.03] text-left text-[11.5px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium">Uptime</th>
                <th className="px-4 py-3 font-medium">Support</th>
                <th className="px-4 py-3 font-medium">Backups</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06] text-slate-300">
              {SLAS.map((s) => (
                <tr key={s.plan}>
                  <td className="px-4 py-3 font-medium text-white">{s.plan}</td>
                  <td className="px-4 py-3">{s.uptime}</td>
                  <td className="px-4 py-3">{s.support}</td>
                  <td className="px-4 py-3">{s.rpo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[12.5px] text-slate-500">
          Uptime depends on upstream open-data providers too. When one is down we serve the last good value and label it; the{" "}
          <Link href="/status" className="text-cyan-300 hover:underline">
            status page
          </Link>{" "}
          shows real probe results.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="font-display text-xl font-semibold text-white">Sub-processors & data providers</h2>
        <p className="mt-1 text-sm text-slate-400">Open-data services we query for climate, hazard and satellite information. They receive coordinates, never customer identities or portfolio values.</p>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[680px] text-[13px]">
            <thead className="bg-white/[0.03] text-left text-[11.5px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Provider</th>
                <th className="px-4 py-3 font-medium">Service</th>
                <th className="px-4 py-3 font-medium">Used for</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06] text-slate-300">
              {providers.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2.5 text-white">{p.provider}</td>
                  <td className="px-4 py-2.5">
                    <a href={p.docs} target="_blank" rel="noreferrer" className="text-cyan-300 hover:underline">
                      {p.name}
                    </a>
                  </td>
                  <td className="px-4 py-2.5 text-slate-400">{p.usedFor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3 className="mt-6 font-medium text-white">Optional processors (only when your deployment enables them)</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {OPTIONAL_PROCESSORS.map((p) => (
            <div key={p.name} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="text-sm font-medium text-white">{p.name}</div>
              <div className="mt-0.5 text-[12px] text-slate-400">{p.purpose}</div>
              <div className="mt-1 text-[11px] text-slate-500">Region: {p.region}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-12 rounded-3xl border border-cyan-400/20 bg-gradient-to-br from-cyan-500/[0.06] to-emerald-500/[0.04] p-6 sm:flex sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold text-white">Security questionnaire or DPA?</h2>
          <p className="mt-1 text-sm text-slate-400">We'll complete your vendor-risk questionnaire and sign a data-processing agreement. Report vulnerabilities to security@agrishield.io.</p>
        </div>
        <Link href="/help#contact" className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300 sm:mt-0">
          Contact us <ArrowRight size={15} />
        </Link>
      </section>
    </div>
  );
}
