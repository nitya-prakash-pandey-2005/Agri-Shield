"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { motion, useAnimationControls } from "framer-motion";
import { ArrowLeft, Info, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { AuthShell, FormError, destinationAfterLogin, safeCallback } from "../_components/AuthShell";

const LEN = 6;
const RESEND_S = 30;

function mask(id: string) {
  if (id.includes("@")) {
    const [u, d] = id.split("@");
    return `${u!.slice(0, 2)}•••@${d}`;
  }
  return id.length > 6 ? `${id.slice(0, 4)} ••• ${id.slice(-3)}` : id;
}

function OtpForm() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const identifier = params?.get("identifier") ?? "";
  const next = safeCallback(params?.get("next")) ?? safeCallback(params?.get("callbackUrl"));
  const [digits, setDigits] = useState<string[]>(Array(LEN).fill(""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(RESEND_S);
  const [demoHint, setDemoHint] = useState<string | null>(process.env.NEXT_PUBLIC_DEMO_MODE !== "false" ? t("auth.demoHint") : null);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const shake = useAnimationControls();
  const resend = trpc.auth.requestOtp.useMutation();

  useEffect(() => {
    if (!identifier) router.replace("/auth/signin");
    refs.current[0]?.focus();
  }, [identifier, router]);
  useEffect(() => {
    if (left <= 0) return;
    const tm = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(tm);
  }, [left]);

  const verify = async (code: string) => {
    if (code.length !== LEN || busy) return;
    setBusy(true);
    setError(null);
    const res = await signIn("credentials", { mode: "otp", identifier, otp: code, redirect: false }).catch(() => null);
    if (!res || res.error) {
      setBusy(false);
      setError(res?.code === "account_suspended" ? t("auth.errorSuspended") : t("auth.wrongCode"));
      setDigits(Array(LEN).fill(""));
      void shake.start({ x: [0, -10, 10, -6, 6, 0], transition: { duration: 0.4 } });
      refs.current[0]?.focus();
      return;
    }
    const dest = await destinationAfterLogin(next);
    router.push(dest);
    router.refresh();
  };

  const setAt = (i: number, v: string) => {
    const clean = v.replace(/\D/g, "");
    if (clean.length > 1) {
      // paste or autofill of multiple digits
      const arr = [...digits];
      for (let k = 0; k < clean.length && i + k < LEN; k++) arr[i + k] = clean[k]!;
      setDigits(arr);
      const nextIdx = Math.min(LEN - 1, i + clean.length);
      refs.current[nextIdx]?.focus();
      if (arr.every(Boolean)) void verify(arr.join(""));
      return;
    }
    const arr = [...digits];
    arr[i] = clean;
    setDigits(arr);
    if (clean && i < LEN - 1) refs.current[i + 1]?.focus();
    if (arr.every(Boolean)) void verify(arr.join(""));
  };

  const onKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      refs.current[i - 1]?.focus();
      const arr = [...digits];
      arr[i - 1] = "";
      setDigits(arr);
    }
    if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
    if (e.key === "ArrowRight" && i < LEN - 1) refs.current[i + 1]?.focus();
    if (e.key === "Enter") void verify(digits.join(""));
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const txt = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, LEN);
    if (!txt) return;
    e.preventDefault();
    setAt(0, txt);
  };

  const doResend = async () => {
    try {
      const r = await resend.mutateAsync({ identifier });
      setLeft(RESEND_S);
      if (r.demoHint) setDemoHint(t("auth.demoHint"));
      toast.success(t("auth.codeResent"));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <AuthShell>
      <Link href="/auth/signin" className="mb-4 inline-flex min-h-[36px] items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200">
        <ArrowLeft size={13} /> {t("auth.changeIdentifier")}
      </Link>
      <div className="mb-5 grid h-12 w-12 place-items-center rounded-xl bg-emerald-500/15 ring-1 ring-emerald-400/40">
        <ShieldCheck size={22} className="text-emerald-300" />
      </div>
      <h1 className="font-display text-2xl font-semibold text-white">{t("auth.otpTitle")}</h1>
      <p className="mt-1 text-sm text-slate-400">{t("auth.otpSubtitle", { identifier: mask(identifier) })}</p>

      <div className="mt-6">
        <FormError message={error} />
        <motion.div animate={shake} className="flex justify-between gap-2" onPaste={onPaste}>
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                refs.current[i] = el;
              }}
              value={d}
              onChange={(e) => setAt(i, e.target.value)}
              onKeyDown={(e) => onKey(i, e)}
              onFocus={(e) => e.target.select()}
              inputMode="numeric"
              autoComplete={i === 0 ? "one-time-code" : "off"}
              maxLength={i === 0 ? LEN : 1}
              aria-label={t("auth.otpDigit", { n: i + 1 })}
              disabled={busy}
              className={cn(
                "h-14 w-full min-w-0 rounded-xl border bg-slate-950/70 text-center text-2xl font-semibold text-white telemetry transition-all focus:outline-none focus:ring-2 sm:h-16",
                d ? "border-emerald-500/60 shadow-[0_0_16px_-6px_rgba(16,185,129,0.9)]" : "border-slate-700",
                error ? "focus:ring-rose-500/30" : "focus:border-emerald-400 focus:ring-emerald-500/25"
              )}
            />
          ))}
        </motion.div>

        {demoHint && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-3 py-2 text-xs text-cyan-200">
            <Info size={13} /> {demoHint}
          </div>
        )}

        <motion.button whileTap={{ scale: 0.97 }} onClick={() => verify(digits.join(""))} disabled={busy || digits.some((x) => !x)} className="mt-5 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 font-semibold text-slate-950 shadow-[0_0_24px_-6px_rgba(16,185,129,0.9)] disabled:opacity-50">
          {busy ? <Loader2 size={17} className="animate-spin" /> : <ShieldCheck size={17} />} {busy ? t("auth.verifying") : t("auth.verify")}
        </motion.button>

        <div className="mt-4 text-center text-sm">
          {left > 0 ? (
            <span className="telemetry text-slate-500">{t("auth.resendIn", { s: left })}</span>
          ) : (
            <button onClick={doResend} disabled={resend.isPending} className="inline-flex min-h-[40px] items-center gap-1.5 font-medium text-emerald-400 hover:underline">
              <RefreshCw size={13} className={resend.isPending ? "animate-spin" : ""} /> {t("auth.resend")}
            </button>
          )}
        </div>
      </div>
    </AuthShell>
  );
}

export default function OtpVerifyPage() {
  return (
    <Suspense>
      <OtpForm />
    </Suspense>
  );
}
