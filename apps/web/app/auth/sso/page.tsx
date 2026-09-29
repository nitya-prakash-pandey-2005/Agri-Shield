"use client";

/**
 * Sign in with SSO: e-mail domain discovery → the workspace's OpenID Connect
 * provider → /api/sso/callback → back here to finish the session (the
 * one-time assertion rides in an httpOnly cookie).
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Building2, CheckCircle2, Fingerprint, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { AuthShell, FieldError, FormError, authInput, destinationAfterLogin, inputState, safeCallback } from "../_components/AuthShell";

function Sso() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = safeCallback(params?.get("callbackUrl"));
  const complete = params?.get("complete") === "1";
  const [email, setEmail] = useState(params?.get("email") ?? "");
  const [fieldErr, setFieldErr] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(params?.get("error") ? (params.get("message") ?? "Single sign-on failed") : null);
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const started = useRef(false);

  useEffect(() => {
    if (!complete || started.current) return;
    started.current = true;
    (async () => {
      const res = await signIn("credentials", { mode: "sso", redirect: false }).catch(() => null);
      if (!res || res.error) {
        setError(res?.code === "account_suspended" ? "This account is suspended." : "The single sign-on response expired or was already used. Try again.");
        return;
      }
      router.replace(await destinationAfterLogin(callbackUrl));
      router.refresh();
    })();
  }, [complete, callbackUrl, router]);

  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return setFieldErr("Enter your work e-mail address");
    setFieldErr(undefined);
    setError(null);
    setBusy(true);
    try {
      const r = await utils.developer.security.ssoDiscover.fetch({ email: v });
      if (!r.sso) {
        setError(`No workspace has single sign-on set up for @${v.split("@")[1]}. Sign in with your password instead, or ask your admin.`);
        setBusy(false);
        return;
      }
      setFound(r.orgName);
      const q = new URLSearchParams({ email: v });
      if (callbackUrl) q.set("callbackUrl", callbackUrl);
      window.location.assign(`/api/sso/start?${q.toString()}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <div className="flex items-center gap-2">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-400/10 text-cyan-300 shadow-[0_0_24px_-6px_rgba(56,189,248,0.8)]">
          <Fingerprint size={19} />
        </span>
        <div>
          <div className="hud-label text-cyan-300/80">Enterprise single sign-on</div>
          <h1 className="font-display text-xl font-semibold text-white">{complete ? "Finishing sign-in…" : "Sign in with SSO"}</h1>
        </div>
      </div>

      {complete && !error ? (
        <div className="mt-6 flex flex-col items-center gap-3 py-6 text-center">
          <Loader2 size={28} className="animate-spin text-cyan-300" />
          <p className="text-sm text-slate-400">{params?.get("new") === "1" ? "Your identity provider vouched for you — we've created your workspace account." : "Your identity provider confirmed who you are."}</p>
        </div>
      ) : (
        <form onSubmit={go} className="mt-5" noValidate>
          <p className="text-sm text-slate-400">Use your company account (Okta, Microsoft Entra ID, Google Workspace, Keycloak…). We'll find your workspace from your e-mail domain.</p>
          <div className="mt-4">
            <FormError message={error} />
            <label className="block">
              <span className="mb-1.5 block text-sm text-slate-300">Work e-mail</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus placeholder="you@company.com" className={cn(authInput, inputState(fieldErr))} aria-invalid={!!fieldErr} />
              <FieldError message={fieldErr} />
            </label>
          </div>
          {found && (
            <p className="mt-3 flex items-center gap-2 text-[13px] text-emerald-300">
              <CheckCircle2 size={14} /> Redirecting to {found}'s identity provider…
            </p>
          )}
          <motion.button whileTap={{ scale: 0.97 }} type="submit" disabled={busy} className="mt-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 font-semibold text-slate-950 shadow-[0_0_24px_-6px_rgba(56,189,248,0.9)] disabled:opacity-60">
            {busy ? <Loader2 size={17} className="animate-spin" /> : <ArrowRight size={17} />} Continue
          </motion.button>
          <div className="mt-5 rounded-lg border border-white/5 bg-slate-900/50 px-3 py-2.5 text-[11.5px] text-slate-500">
            <div className="flex items-center gap-1.5 text-slate-400">
              <Building2 size={12} /> For workspace admins
            </div>
            Connect your identity provider in Settings → Security → Single sign-on (OpenID Connect with PKCE). Demo workspaces can use the built-in, clearly labelled mock identity provider to try the flow.
          </div>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-slate-400">
        <Link href={`/auth/signin?tab=email${callbackUrl ? `&callbackUrl=${encodeURIComponent(callbackUrl)}` : ""}`} className="inline-flex items-center gap-1 font-medium text-emerald-400 hover:underline">
          <ArrowLeft size={13} /> Sign in with password instead
        </Link>
      </p>
    </AuthShell>
  );
}

export default function SsoPage() {
  return (
    <Suspense>
      <Sso />
    </Suspense>
  );
}
