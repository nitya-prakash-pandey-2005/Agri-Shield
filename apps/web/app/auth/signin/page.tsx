"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Building2, Eye, EyeOff, HandHeart, KeyRound, Landmark, Loader2, Mail, ShieldCheck, Smartphone, Sprout, Truck, UserCog, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { AuthShell, FieldError, FormError, authInput, destinationAfterLogin, inputState, safeCallback } from "../_components/AuthShell";

type Demo = { key: string; label: string; icon: typeof Sprout; color: string; creds: Record<string, string> };

function SignInForm() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = safeCallback(params?.get("callbackUrl"));
  const [tab, setTab] = useState<"phone" | "email">(params?.get("tab") === "email" ? "email" : "phone");
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const initialErr = params?.get("error") ? (params.get("code") === "account_suspended" ? t("auth.errorSuspended") : t("auth.errorInvalid")) : null;
  const [error, setError] = useState<string | null>(initialErr);
  const requestOtp = trpc.auth.requestOtp.useMutation();

  const errorFor = (code?: string | null) => (code === "account_suspended" ? t("auth.errorSuspended") : code ? t("auth.errorInvalid") : t("auth.errorGeneric"));

  const finish = async () => {
    const dest = await destinationAfterLogin(callbackUrl);
    router.push(dest);
    router.refresh();
  };

  const login = async (key: string, creds: Record<string, string>) => {
    setBusy(key);
    setError(null);
    try {
      const res = await signIn("credentials", { ...creds, redirect: false });
      if (!res || res.error) {
        setError(errorFor(res?.code ?? res?.error));
        setBusy(null);
        return;
      }
      await finish();
    } catch {
      setError(t("auth.errorGeneric"));
      setBusy(null);
    }
  };

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = identifier.trim();
    const valid = id.includes("@") ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id) : /^\+?[0-9\s-]{7,20}$/.test(id);
    if (!valid) return setFieldErr({ identifier: id.includes("@") ? t("auth.emailInvalid") : t("auth.phoneInvalid") });
    setFieldErr({});
    setBusy("otp");
    setError(null);
    try {
      await requestOtp.mutateAsync({ identifier: id });
      const q = new URLSearchParams({ identifier: id });
      if (callbackUrl) q.set("callbackUrl", callbackUrl);
      router.push(`/auth/otp-verify?${q.toString()}`);
    } catch (err) {
      setError((err as Error).message || t("auth.errorGeneric"));
      setBusy(null);
    }
  };

  const passwordLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errs.email = t("auth.emailInvalid");
    if (password.length < 4) errs.password = t("auth.passwordMin");
    setFieldErr(errs);
    if (Object.keys(errs).length) return;
    void login("password", { mode: "password", email: email.trim(), password });
  };

  const demos: Demo[] = [
    { key: "farmer", label: t("auth.demoFarmer"), icon: Sprout, color: "#10b981", creds: { mode: "otp", identifier: "farmer@demo.agrishield.io", otp: "123456" } },
    { key: "gov", label: t("auth.demoGov"), icon: Building2, color: "#38bdf8", creds: { mode: "password", email: "gov@demo.agrishield.io", password: "demo2026" } },
    { key: "supply", label: t("auth.demoSupply"), icon: Truck, color: "#f59e0b", creds: { mode: "password", email: "supply@demo.agrishield.io", password: "demo2026" } },
    { key: "admin", label: t("auth.demoAdmin"), icon: UserCog, color: "#a78bfa", creds: { mode: "password", email: "admin@demo.agrishield.io", password: "demo2026" } },
  ];
  /** Multi-tenant SaaS workspaces (seeded tenants) — land on /app */
  const workspaceDemos: (Demo & { org: string })[] = [
    { key: "insurer", label: "Insurer", org: "Delta Mutual · 140 plots", icon: ShieldCheck, color: "#38bdf8", creds: { mode: "password", email: "insurer@demo.agrishield.io", password: "demo2026" } },
    { key: "bank", label: "Bank", org: "Mekong Rural Credit · 160 loans", icon: Landmark, color: "#a78bfa", creds: { mode: "password", email: "bank@demo.agrishield.io", password: "demo2026" } },
    { key: "ngo", label: "NGO", org: "Delta Resilience · 48 communities", icon: HandHeart, color: "#f472b6", creds: { mode: "password", email: "ngo@demo.agrishield.io", password: "demo2026" } },
    { key: "coop", label: "Co-op", org: "Mahanadi FPC · 90 farms", icon: Users, color: "#10b981", creds: { mode: "password", email: "coop@demo.agrishield.io", password: "demo2026" } },
  ];

  return (
    <AuthShell>
      <h1 className="font-display text-2xl font-semibold text-white">{t("auth.signinTitle")}</h1>
      <p className="mt-1 text-sm text-slate-400">{t("auth.signinSubtitle")}</p>

      <div role="tablist" className="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-slate-950/70 p-1">
        {(
          [
            ["phone", t("auth.tabPhone"), Smartphone],
            ["email", t("auth.tabEmail"), Mail],
          ] as const
        ).map(([k, label, Icon]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setFieldErr({}); setError(null); }} className={cn("relative flex min-h-[44px] items-center justify-center gap-2 rounded-lg text-sm transition-colors", tab === k ? "text-slate-950 font-semibold" : "text-slate-400 hover:text-slate-200")}>
            {tab === k && <motion.span layoutId="signin-tab" className="absolute inset-0 rounded-lg bg-emerald-500" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
            <Icon size={15} className="relative" />
            <span className="relative">{label}</span>
          </button>
        ))}
      </div>

      <div className="mt-5">
        <FormError message={error} />
        <AnimatePresence mode="wait">
          {tab === "phone" ? (
            <motion.form key="phone" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} onSubmit={sendCode} noValidate>
              <label className="block">
                <span className="mb-1.5 block text-sm text-slate-300">{t("auth.identifierLabel")}</span>
                <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} inputMode="tel" autoComplete="tel" placeholder={t("auth.identifierPlaceholder")} className={cn(authInput, inputState(fieldErr.identifier))} aria-invalid={!!fieldErr.identifier} />
                <FieldError message={fieldErr.identifier} />
              </label>
              <p className="mt-2 text-xs text-slate-500">{t("auth.farmerOtpNote")}</p>
              <motion.button whileTap={{ scale: 0.97 }} type="submit" disabled={!!busy} className="mt-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 font-semibold text-slate-950 shadow-[0_0_24px_-6px_rgba(16,185,129,0.9)] disabled:opacity-60">
                {busy === "otp" ? <Loader2 size={17} className="animate-spin" /> : <KeyRound size={17} />} {busy === "otp" ? t("auth.sending") : t("auth.sendCode")}
              </motion.button>
            </motion.form>
          ) : (
            <motion.form key="email" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} onSubmit={passwordLogin} noValidate className="space-y-3">
              <label className="block">
                <span className="mb-1.5 block text-sm text-slate-300">{t("auth.email")}</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className={cn(authInput, inputState(fieldErr.email))} aria-invalid={!!fieldErr.email} />
                <FieldError message={fieldErr.email} />
              </label>
              <label className="block">
                <span className="mb-1.5 flex items-center justify-between text-sm text-slate-300">
                  {t("auth.password")}
                  <Link href="/auth/forgot-password" className="text-xs text-emerald-400 hover:underline">
                    {t("auth.forgotPassword")}
                  </Link>
                </span>
                <span className="relative block">
                  <input type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className={cn(authInput, inputState(fieldErr.password), "pr-12")} aria-invalid={!!fieldErr.password} />
                  <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center text-slate-500 hover:text-slate-200" aria-label={show ? "Hide password" : "Show password"}>
                    {show ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </span>
                <FieldError message={fieldErr.password} />
              </label>
              <motion.button whileTap={{ scale: 0.97 }} type="submit" disabled={!!busy} className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 font-semibold text-slate-950 shadow-[0_0_24px_-6px_rgba(16,185,129,0.9)] disabled:opacity-60">
                {busy === "password" ? <Loader2 size={17} className="animate-spin" /> : <ArrowRight size={17} />} {busy === "password" ? t("auth.signingIn") : t("auth.signIn")}
              </motion.button>
            </motion.form>
          )}
        </AnimatePresence>
      </div>

      <div className="my-6 flex items-center gap-3">
        <span className="hud-divider flex-1" />
        <span className="hud-label">{t("auth.demoAccess")}</span>
        <span className="hud-divider flex-1" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {demos.map((d) => (
          <motion.button
            key={d.key}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => login(d.key, d.creds)}
            disabled={!!busy}
            className="group flex min-h-[52px] items-center gap-2.5 rounded-xl border border-slate-700/80 bg-slate-950/50 px-3 text-left text-sm text-slate-200 transition-colors hover:border-[color:var(--c)] disabled:opacity-50"
            style={{ ["--c" as string]: `${d.color}99` }}
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: `${d.color}22` }}>
              {busy === d.key ? <Loader2 size={15} className="animate-spin" style={{ color: d.color }} /> : <d.icon size={15} style={{ color: d.color }} />}
            </span>
            <span className="font-medium">{d.label}</span>
          </motion.button>
        ))}
      </div>

      <div className="mt-4 mb-2 flex items-center gap-2">
        <span className="hud-label text-cyan-300/80">Enterprise workspaces</span>
        <span className="hud-divider flex-1" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {workspaceDemos.map((d) => (
          <motion.button
            key={d.key}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => login(d.key, d.creds)}
            disabled={!!busy}
            className="group flex min-h-[56px] items-center gap-2.5 rounded-xl border border-slate-700/80 bg-slate-950/50 px-3 text-left text-sm text-slate-200 transition-colors hover:border-[color:var(--c)] disabled:opacity-50"
            style={{ ["--c" as string]: `${d.color}99` }}
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: `${d.color}22` }}>
              {busy === d.key ? <Loader2 size={15} className="animate-spin" style={{ color: d.color }} /> : <d.icon size={15} style={{ color: d.color }} />}
            </span>
            <span className="min-w-0">
              <span className="block font-medium">{d.label}</span>
              <span className="block truncate text-[10.5px] text-slate-500">{d.org}</span>
            </span>
          </motion.button>
        ))}
      </div>

      <p className="mt-6 text-center text-sm text-slate-400">
        {t("auth.noAccount")}{" "}
        <Link href={`/auth/signup${callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ""}`} className="font-medium text-emerald-400 hover:underline">
          {t("auth.createAccount")}
        </Link>
        <span className="mx-1.5 text-slate-600">·</span>
        <Link href="/auth/signup?type=org" className="font-medium text-cyan-300 hover:underline">
          Create an organisation workspace
        </Link>
      </p>
    </AuthShell>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
