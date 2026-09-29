"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import { CheckCircle2, Copy, FlaskConical, Fingerprint, Loader2, PlugZap, Save, XCircle } from "lucide-react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { Panel, Skeleton } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { Btn, Field, Toggle, inputCls } from "@/components/workspace/ui";
import { Hint, Pill, toastErr } from "./shared";

type Sso = RouterOutputs["developer"]["security"]["sso"];
type Test = RouterOutputs["developer"]["security"]["testSso"];

const copy = async (t: string) => {
  try {
    await navigator.clipboard.writeText(t);
    toast.success("Copied");
  } catch {
    toast.message(t);
  }
};

export function SsoPanel({ orgShort, onChanged }: { orgShort: string; onChanged: () => void }) {
  const utils = trpc.useUtils();
  const q = trpc.developer.security.sso.useQuery();
  const save = trpc.developer.security.saveSso.useMutation();
  const test = trpc.developer.security.testSso.useMutation();
  const [f, setF] = useState<{ enabled: boolean; issuer: string; clientId: string; clientSecret: string; domains: string; defaultRole: string; jit: boolean; enforce: boolean } | null>(null);
  const [result, setResult] = useState<Test | null>(null);

  const d: Sso | undefined = q.data;
  useEffect(() => {
    if (d && !f) setF({ enabled: d.config.enabled, issuer: d.config.issuer, clientId: d.config.clientId, clientSecret: "", domains: d.config.allowedDomains.join(", "), defaultRole: d.config.defaultRole, jit: d.config.jitProvisioning, enforce: d.config.enforceForDomains });
  }, [d, f]);
  if (!d || !f) return <Skeleton className="h-80" />;
  const c = d.config;

  const submit = async (enabled = f.enabled) => {
    try {
      await save.mutateAsync({ enabled, issuer: f.issuer.trim(), clientId: f.clientId.trim(), clientSecret: f.clientSecret || null, allowedDomains: f.domains.split(/[,\s]+/).filter(Boolean), defaultRole: f.defaultRole as never, jitProvisioning: f.jit, enforceForDomains: f.enforce });
      setF({ ...f, enabled, clientSecret: "" });
      toast.success(enabled ? "Single sign-on saved and enabled" : "Single sign-on saved (disabled)");
      await utils.developer.security.sso.invalidate();
      onChanged();
    } catch (e) {
      toastErr(e);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[1.35fr,1fr]">
      <Panel
        title={
          <span className="flex items-center gap-1.5">
            Single sign-on (OpenID Connect) <Explain text="Members sign in through your company identity provider (Okta, Microsoft Entra ID, Google Workspace, Keycloak, Auth0…). Agri-SHIELD uses the authorization-code flow with PKCE, verifies the ID token's signature against the provider's published keys (JWKS), and checks issuer, audience, expiry and nonce." title="OIDC SSO" />
          </span>
        }
        subtitle={c.configured ? (c.enabled ? `Enabled · ${c.logins} sign-in(s)` : "Configured · disabled") : "Not configured"}
        icon={Fingerprint}
        accent="violet"
        actions={c.enabled ? <Pill tone="emerald">Active</Pill> : c.configured ? <Pill tone="amber">Disabled</Pill> : null}
      >
        {d.mockAvailable && d.mock && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/30 bg-amber-400/[0.06] px-3.5 py-3">
            <FlaskConical size={18} className="shrink-0 text-amber-300" />
            <div className="min-w-0 flex-1 text-[12.5px] text-amber-100">
              <b>Demo:</b> no IdP handy? Use the built-in <b>mock identity provider</b> (development/demo only — it asserts any e-mail you type, clearly labelled).
            </div>
            <Btn
              variant="outline"
              className="border-amber-400/40 text-amber-100"
              onClick={() => {
                setF({ ...f, issuer: d.mock!.issuer, clientId: d.mock!.clientId, clientSecret: d.mock!.clientSecret, domains: f.domains || `${orgShort.toLowerCase().replace(/[^a-z0-9]+/g, "")}.example`, enabled: true });
                toast.message("Mock IdP details filled in — review and Save");
              }}
            >
              Use mock IdP
            </Btn>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Issuer URL" hint="The IdP's base URL; we read /.well-known/openid-configuration" className="sm:col-span-2">
            <input className={inputCls} value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })} placeholder="https://login.yourcompany.com" spellCheck={false} />
          </Field>
          <Field label="Client ID">
            <input className={inputCls} value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })} spellCheck={false} />
          </Field>
          <Field label="Client secret" hint={c.hasClientSecret ? "Stored encrypted — leave blank to keep" : "Encrypted at rest (AES-256-GCM)"}>
            <input className={inputCls} type="password" value={f.clientSecret} onChange={(e) => setF({ ...f, clientSecret: e.target.value })} placeholder={c.hasClientSecret ? "••••••••••" : ""} autoComplete="new-password" />
          </Field>
          <Field label={<>Allowed e-mail domains <Explain text="Only people whose verified e-mail ends in one of these domains can sign in through this IdP. Typing name@domain on the sign-in page routes them here automatically." /></>} hint="Comma-separated, e.g. mekongcredit.com, mekongcredit.vn" className="sm:col-span-2">
            <input className={inputCls} value={f.domains} onChange={(e) => setF({ ...f, domains: e.target.value })} spellCheck={false} />
          </Field>
          <Field label="Default role for new members">
            <select className={inputCls} value={f.defaultRole} onChange={(e) => setF({ ...f, defaultRole: e.target.value })}>
              {d.roles.map((r) => (
                <option key={r.role} value={r.role}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
          <div className="space-y-2.5 pt-1">
            <label className="flex items-center justify-between gap-3 text-[12.5px] text-slate-300">
              <span>
                Just-in-time provisioning <Explain text="Create the Agri-SHIELD account automatically the first time someone from an allowed domain signs in, with the default role. Off = only people you invited can use SSO." />
              </span>
              <Toggle checked={f.jit} onChange={(v) => setF({ ...f, jit: v })} label="Just-in-time provisioning" />
            </label>
            <label className="flex items-center justify-between gap-3 text-[12.5px] text-slate-300">
              <span>
                Enforce SSO for these domains <Explain text="Password and e-mail-code sign-in are refused for addresses on your domains, so leavers lose access as soon as IT disables them in the IdP. Requires one successful SSO sign-in first." />
              </span>
              <Toggle checked={f.enforce} onChange={(v) => setF({ ...f, enforce: v })} label="Enforce SSO" />
            </label>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Btn onClick={() => submit(true)} disabled={save.isPending || !f.issuer || !f.clientId}>
            {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save &amp; enable
          </Btn>
          <Btn variant="outline" onClick={() => submit(false)} disabled={save.isPending || !f.issuer || !f.clientId}>
            Save disabled
          </Btn>
          <Btn
            variant="ghost"
            disabled={!c.configured || test.isPending}
            onClick={async () => {
              try {
                setResult(await test.mutateAsync());
              } catch (e) {
                toastErr(e);
              }
            }}
          >
            {test.isPending ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />} Test connection
          </Btn>
        </div>
      </Panel>

      <div className="space-y-4">
        <Panel title="Your IdP needs these values" icon={Copy} accent="cyan">
          <dl className="space-y-2.5 text-[12.5px]">
            {[
              ["Redirect (callback) URI", d.redirectUri],
              ["Grant type", "authorization_code + PKCE (S256)"],
              ["Scopes", "openid email profile"],
              ["Token auth", "client_secret_basic"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-slate-500">{k}</dt>
                <dd className="flex items-center gap-2">
                  <code className="telemetry min-w-0 flex-1 break-all rounded-md bg-slate-950/70 px-2 py-1 text-[12px] text-cyan-100">{v}</code>
                  {k.startsWith("Redirect") && (
                    <button onClick={() => copy(v!)} aria-label="Copy redirect URI" className="text-slate-500 hover:text-white">
                      <Copy size={13} />
                    </button>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel title="Status" icon={PlugZap} accent="emerald">
          <ul className="space-y-1.5 text-[12.5px] text-slate-300">
            <li>Last SSO sign-in: {c.lastLoginAt ? formatDistanceToNowStrict(new Date(c.lastLoginAt), { addSuffix: true }) : "never"}</li>
            <li>Total SSO sign-ins: {c.logins}</li>
            {c.lastError && <li className="text-rose-300">Last error: {c.lastError}</li>}
          </ul>
          {result && (
            <ul className="mt-3 space-y-1.5 border-t border-white/5 pt-3">
              {result.checks.map((x) => (
                <li key={x.label} className="flex items-start gap-2 text-[12px]">
                  {x.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-400" /> : <XCircle size={14} className="mt-0.5 shrink-0 text-rose-400" />}
                  <span>
                    <span className="text-slate-200">{x.label}</span>
                    <span className="block break-all text-[11px] text-slate-500">{x.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <Hint>
              Try it: open a private window, go to <b>/auth/sso</b> and enter an address on one of your domains{c.isMockIdp ? " (e.g. linh.pham@" + (c.allowedDomains[0] ?? "yourdomain.example") + ")" : ""}. New people are created with the default role when just-in-time provisioning is on.
            </Hint>
          </div>
        </Panel>
      </div>
    </div>
  );
}
