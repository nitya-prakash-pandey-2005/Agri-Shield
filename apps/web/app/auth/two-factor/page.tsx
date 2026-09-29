"use client";

/**
 * Second step of sign-in. The password (or e-mail code) was correct but no
 * session exists yet: this page redeems the short-lived signed challenge with
 * a TOTP / recovery code, or walks the user through mandatory enrolment when
 * their workspace requires 2-step verification.
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, KeyRound, LifeBuoy, Loader2, ShieldCheck, Smartphone, Timer } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { AuthShell, FormError, destinationAfterLogin, safeCallback } from "../_components/AuthShell";
import { CodeInput } from "./_components/CodeInput";
import { QrCode } from "./_components/QrCode";
import { RecoveryCodes } from "./_components/RecoveryCodes";

const STORAGE_KEY = "ags_mfa_challenge";

const ERRORS: Record<string, string> = {
  mfa_invalid: "That code isn't right. Use the newest code in your authenticator app.",
  mfa_replay: "That code was already used. Wait for the next one (codes change every 30 seconds).",
  mfa_locked: "Too many wrong codes. For your security, sign-in is paused for 15 minutes.",
  mfa_expired: "This sign-in attempt expired. Please sign in again.",
};

function useCountdown(until: Date | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!until) return null;
  return Math.max(0, Math.floor((until.getTime() - now) / 1000));
}

function TwoFactor() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = safeCallback(params?.get("callbackUrl"));
  const [challenge, setChallenge] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let c = params?.get("c") ?? null;
    try {
      c = c ?? sessionStorage.getItem(STORAGE_KEY);
    } catch {}
    setChallenge(c);
    setLoaded(true);
  }, [params]);

  const info = trpc.developer.security.challengeInfo.useQuery({ challenge: challenge ?? "" }, { enabled: !!challenge && challenge.length >= 20, retry: false, refetchOnWindowFocus: false, staleTime: Infinity });
  const confirmEnrol = trpc.developer.security.confirmChallengeEnrolment.useMutation();

  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [enrolStep, setEnrolStep] = useState<"scan" | "codes">("scan");
  const inputRef = useRef<HTMLInputElement>(null);

  const d = info.data;
  const expires = useMemo(() => (d && d.ok ? new Date(d.expiresAt) : null), [d]);
  const left = useCountdown(expires);

  const complete = async (payload: Record<string, string>) => {
    const res = await signIn("credentials", { mode: "mfa", challenge: challenge!, ...payload, redirect: false });
    if (!res || res.error) {
      const c = res?.code ?? "mfa_invalid";
      setError(ERRORS[c] ?? ERRORS.mfa_invalid!);
      setBusy(false);
      setCode("");
      inputRef.current?.focus();
      if (c === "mfa_expired" || c === "mfa_locked") void info.refetch();
      return false;
    }
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {}
    router.push(await destinationAfterLogin(callbackUrl));
    router.refresh();
    return true;
  };

  const verify = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const ok = recovery ? /^[a-z0-9]{5}-?[a-z0-9]{5}$/.test(code) : /^\d{6}$/.test(code);
    if (!ok) return setError(recovery ? "Enter a recovery code like abcde-12345" : "Enter the 6-digit code");
    setBusy(true);
    setError(null);
    await complete({ code });
  };

  // Auto-submit a complete 6-digit code
  useEffect(() => {
    if (!recovery && code.length === 6 && d?.ok && d.purpose === "verify" && !busy) void verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const enrol = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!/^\d{6}$/.test(code)) return setError("Enter the 6-digit code your app shows after scanning");
    setBusy(true);
    setError(null);
    try {
      const r = await confirmEnrol.mutateAsync({ challenge: challenge!, code });
      setCodes(r.recoveryCodes);
      setEnrolStep("codes");
    } catch (err) {
      setError((err as Error).message);
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const bad = loaded && (!challenge || (d && !d.ok) || info.isError);
  const reason = d && !d.ok ? d.reason : null;

  return (
    <AuthShell>
      <div className="flex items-center gap-2">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-400/10 text-cyan-300 shadow-[0_0_24px_-6px_rgba(56,189,248,0.8)]">
          <ShieldCheck size={19} />
        </span>
        <div>
          <div className="hud-label text-cyan-300/80">Step 2 of 2 · 2-step verification</div>
          <h1 className="font-display text-xl font-semibold text-white">{d?.ok && d.purpose === "enrol" ? "Set up your authenticator" : "Confirm it's you"}</h1>
        </div>
      </div>

      {!loaded || (challenge && info.isLoading) ? (
        <div className="mt-6 space-y-3">
          <div className="skeleton h-5 w-3/4 rounded" />
          <div className="skeleton h-14 rounded-xl" />
        </div>
      ) : bad ? (
        <div className="mt-5">
          <FormError message={reason === "used" ? "This sign-in was already completed." : reason === "too_many_attempts" ? ERRORS.mfa_locked! : "This sign-in attempt expired or is not valid (they last 5 minutes)."} />
          <Link href={`/auth/signin?tab=email${callbackUrl ? `&callbackUrl=${encodeURIComponent(callbackUrl)}` : ""}`} className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-emerald-500 font-semibold text-slate-950">
            <ArrowLeft size={16} /> Sign in again
          </Link>
        </div>
      ) : d?.ok && d.purpose === "verify" ? (
        <form onSubmit={verify} className="mt-5" noValidate>
          <p className="text-sm text-slate-400">
            Signing in as <b className="text-slate-200">{d.account}</b>
            {d.orgName ? <> · {d.orgName}</> : null}. {recovery ? "Enter one of your saved recovery codes." : "Open your authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…) and enter the 6-digit code for Agri-SHIELD."}
          </p>
          <div className="mt-4">
            <FormError message={error} />
            <CodeInput ref={inputRef} value={code} onChange={setCode} recovery={recovery} invalid={!!error} disabled={busy} autoFocus />
          </div>
          <motion.button whileTap={{ scale: 0.97 }} type="submit" disabled={busy} className="mt-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 font-semibold text-slate-950 shadow-[0_0_24px_-6px_rgba(56,189,248,0.9)] disabled:opacity-60">
            {busy ? <Loader2 size={17} className="animate-spin" /> : <ArrowRight size={17} />} {busy ? "Verifying…" : "Verify and sign in"}
          </motion.button>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
            <button type="button" onClick={() => (setRecovery((r) => !r), setCode(""), setError(null))} className="inline-flex items-center gap-1.5 text-cyan-300 hover:underline">
              {recovery ? <Smartphone size={13} /> : <LifeBuoy size={13} />} {recovery ? "Use my authenticator app" : "Lost your phone? Use a recovery code"}
            </button>
            <span className="telemetry inline-flex items-center gap-1 text-slate-500">
              <Timer size={12} /> {left !== null ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "—"} · {d.attemptsLeft} tries left
            </span>
          </div>
          <p className="mt-5 rounded-lg bg-slate-900/60 px-3 py-2 text-[11.5px] text-slate-500">
            Why this step? Your account is protected with 2-step verification: even with your password, nobody can sign in without the code on your phone. No recovery codes left? Ask a workspace admin to reset your 2-step verification.
          </p>
        </form>
      ) : d?.ok && d.purpose === "enrol" && d.enrol ? (
        <div className="mt-4">
          {enrolStep === "scan" ? (
            <form onSubmit={enrol} noValidate>
              <p className="text-sm text-slate-400">
                <b className="text-slate-200">{d.orgName ?? "Your workspace"}</b> requires 2-step verification for every member. It takes a minute and protects the workspace even if a password leaks.
              </p>
              <ol className="mt-4 space-y-4 text-[13px] text-slate-300">
                <li>
                  <span className="hud-label text-cyan-300/80">1 · Scan with your authenticator app</span>
                  <div className="mt-2 flex flex-col items-center gap-3 sm:flex-row sm:items-start">
                    <QrCode path={d.enrol.qr.path} viewBox={d.enrol.qr.viewBox} label="QR code to add Agri-SHIELD to your authenticator app" size={176} />
                    <div className="min-w-0 text-[12px] text-slate-400">
                      Can't scan? Enter this key manually (time-based, 6 digits):
                      <div className="telemetry mt-1.5 break-all rounded-lg border border-slate-700 bg-slate-950/70 px-2.5 py-2 text-[13px] text-white select-all">{d.enrol.manualKey}</div>
                      <a href={d.enrol.uri} className="mt-2 inline-flex items-center gap-1 text-cyan-300 hover:underline sm:hidden">
                        <KeyRound size={12} /> Open in authenticator app
                      </a>
                    </div>
                  </div>
                </li>
                <li>
                  <span className="hud-label text-cyan-300/80">2 · Enter the 6-digit code it shows</span>
                  <div className="mt-2">
                    <FormError message={error} />
                    <CodeInput ref={inputRef} value={code} onChange={setCode} invalid={!!error} disabled={busy} />
                  </div>
                </li>
              </ol>
              <motion.button whileTap={{ scale: 0.97 }} type="submit" disabled={busy} className="mt-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 font-semibold text-slate-950 disabled:opacity-60">
                {busy ? <Loader2 size={17} className="animate-spin" /> : <ShieldCheck size={17} />} Turn on 2-step verification
              </motion.button>
              <p className="telemetry mt-3 text-center text-[11px] text-slate-500">Session not started yet · expires in {left !== null ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "—"}</p>
            </form>
          ) : (
            <div>
              <p className="mb-3 text-sm text-emerald-300">2-step verification is on.</p>
              <RecoveryCodes codes={codes ?? []} account={d.account} onConfirmed={setSaved} />
              <motion.button
                whileTap={{ scale: 0.97 }}
                disabled={!saved || busy}
                onClick={async () => {
                  setBusy(true);
                  await complete({});
                }}
                className="mt-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 font-semibold text-slate-950 disabled:opacity-50"
              >
                {busy ? <Loader2 size={17} className="animate-spin" /> : <ArrowRight size={17} />} Continue to workspace
              </motion.button>
              <FormError message={error} />
            </div>
          )}
        </div>
      ) : null}
    </AuthShell>
  );
}

export default function TwoFactorPage() {
  return (
    <Suspense>
      <TwoFactor />
    </Suspense>
  );
}
