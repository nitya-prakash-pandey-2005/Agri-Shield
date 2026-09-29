"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Building2, Check, Clock3, Gift, Loader2, Sprout, Truck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { homeForRole } from "@/lib/rbac";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { AuthShell, FieldError, FormError, authInput, inputState, safeCallback } from "../_components/AuthShell";

type Role = "farmer" | "field_officer" | "supply_chain_analyst";

const COUNTRIES = ["Bangladesh", "India", "Vietnam", "Philippines", "Indonesia", "Sri Lanka", "Other"];

function makeSchema(t: (k: never, v?: Record<string, string | number>) => string) {
  const tt = t as unknown as (k: string) => string;
  return z
    .object({
      role: z.enum(["farmer", "field_officer", "supply_chain_analyst"]),
      name: z.string().trim().min(2, tt("auth.nameMin")).max(80),
      phone: z.string().trim().optional(),
      email: z.string().trim().optional(),
      organization: z.string().trim().optional(),
      country: z.string().min(1),
      password: z.string().optional(),
      confirm: z.string().optional(),
      agree: z.boolean().refine((v) => v, tt("auth.mustAgree")),
    })
    .superRefine((v, ctx) => {
      if (v.role === "farmer") {
        if (!v.phone || !/^\+?[0-9\s-]{7,20}$/.test(v.phone)) ctx.addIssue({ code: "custom", path: ["phone"], message: tt("auth.phoneInvalid") });
      } else {
        if (!v.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) ctx.addIssue({ code: "custom", path: ["email"], message: tt("auth.emailInvalid") });
        if (!v.organization || v.organization.length < 2) ctx.addIssue({ code: "custom", path: ["organization"], message: tt("auth.orgRequired") });
        if (!v.password || v.password.length < 8) ctx.addIssue({ code: "custom", path: ["password"], message: tt("auth.passwordMin") });
        if (v.password !== v.confirm) ctx.addIssue({ code: "custom", path: ["confirm"], message: tt("auth.passwordsMismatch") });
      }
    });
}
type FormValues = z.infer<ReturnType<typeof makeSchema>>;

function SignUpFlow() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const ref = params?.get("ref");
  const callbackUrl = safeCallback(params?.get("callbackUrl"));
  const [step, setStep] = useState(0);
  const [role, setRole] = useState<Role>("farmer");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const register = trpc.auth.register.useMutation();
  const requestOtp = trpc.auth.requestOtp.useMutation();

  const form = useForm<FormValues>({
    resolver: zodResolver(makeSchema(t as never)),
    mode: "onTouched",
    defaultValues: { role: "farmer", name: "", phone: "", email: "", organization: "", country: "Bangladesh", password: "", confirm: "", agree: false },
  });
  const { register: reg, handleSubmit, formState } = form;
  const e = formState.errors;

  const roles = [
    { key: "farmer" as const, label: t("auth.roleFarmer"), desc: t("auth.roleFarmerDesc"), icon: Sprout, color: "#10b981" },
    { key: "field_officer" as const, label: t("auth.roleGov"), desc: t("auth.roleGovDesc"), icon: Building2, color: "#38bdf8" },
    { key: "supply_chain_analyst" as const, label: t("auth.roleSupply"), desc: t("auth.roleSupplyDesc"), icon: Truck, color: "#f59e0b" },
  ];

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      if (role === "farmer") {
        const phone = v.phone!.replace(/\s/g, "");
        await register.mutateAsync({ name: v.name, role, phone, country: v.country, language: locale, referralCode: ref ?? undefined });
        await requestOtp.mutateAsync({ identifier: phone });
        const q = new URLSearchParams({ identifier: phone, next: "/onboarding/farmer" });
        router.push(`/auth/otp-verify?${q.toString()}`);
      } else {
        await register.mutateAsync({ name: v.name, role, email: v.email!.trim(), password: v.password!, organization: v.organization!, country: v.country, language: locale });
        const res = await signIn("credentials", { mode: "password", email: v.email!.trim(), password: v.password!, redirect: false });
        if (!res || res.error) throw new Error(t("auth.errorGeneric"));
        setPending(`${callbackUrl ?? homeForRole(role)}?verification=pending`);
        setStep(3);
      }
    } catch (err) {
      setError((err as Error).message || t("auth.errorGeneric"));
    }
  });

  const busy = formState.isSubmitting || register.isPending || requestOtp.isPending;
  const stepLabels = [t("auth.stepRole"), t("auth.stepLanguage"), t("auth.stepDetails")];

  return (
    <AuthShell wide>
      {step < 3 && (
        <>
          <h1 className="font-display text-2xl font-semibold text-white">{t("auth.signupTitle")}</h1>
          <p className="mt-1 text-sm text-slate-400">{t("auth.signupSubtitle")}</p>
          {ref && (
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-violet-400/30 bg-violet-500/10 px-2.5 py-1 text-xs text-violet-200">
              <Gift size={12} /> <span className="telemetry">{ref}</span>
            </div>
          )}
          <ol className="mt-5 flex items-center gap-2">
            {stepLabels.map((s, i) => (
              <li key={s} className="flex flex-1 items-center gap-2">
                <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs telemetry", i < step ? "border-emerald-500 bg-emerald-500 text-slate-950" : i === step ? "border-emerald-400 text-emerald-300" : "border-slate-700 text-slate-600")}>{i < step ? <Check size={13} strokeWidth={3} /> : i + 1}</span>
                <span className={cn("hidden text-xs sm:inline", i === step ? "text-white" : "text-slate-500")}>{s}</span>
                {i < 2 && <span className={cn("h-px flex-1", i < step ? "bg-emerald-500/60" : "bg-slate-700")} />}
              </li>
            ))}
          </ol>
        </>
      )}

      <AnimatePresence mode="wait">
        {step === 0 && (
          <motion.div key="role" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="mt-5">
            <div className="mb-2 text-sm text-slate-300">{t("auth.roleQuestion")}</div>
            <div role="radiogroup" className="space-y-2">
              {roles.map((r) => {
                const on = role === r.key;
                return (
                  <motion.button key={r.key} type="button" role="radio" aria-checked={on} whileTap={{ scale: 0.98 }} onClick={() => { setRole(r.key); form.setValue("role", r.key); form.clearErrors(); }} className={cn("flex min-h-[64px] w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors", on ? "bg-slate-900/80" : "border-slate-700/80 bg-slate-950/40 hover:border-slate-500")} style={on ? { borderColor: r.color, boxShadow: `0 0 24px -10px ${r.color}` } : undefined}>
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl" style={{ background: `${r.color}22` }}>
                      <r.icon size={20} style={{ color: r.color }} />
                    </span>
                    <span className="flex-1">
                      <span className="block font-medium text-white">{r.label}</span>
                      <span className="block text-xs text-slate-400">{r.desc}</span>
                    </span>
                    <span className={cn("grid h-5 w-5 place-items-center rounded-full border", on ? "border-transparent" : "border-slate-600")} style={on ? { background: r.color } : undefined}>
                      {on && <Check size={12} strokeWidth={3} className="text-slate-950" />}
                    </span>
                  </motion.button>
                );
              })}
            </div>
            <motion.button whileTap={{ scale: 0.97 }} onClick={() => setStep(1)} className="mt-5 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 font-semibold text-slate-950">
              {t("common.continue")} <ArrowRight size={17} />
            </motion.button>
          </motion.div>
        )}

        {step === 1 && (
          <motion.div key="lang" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="mt-5">
            <div className="mb-2 text-sm text-slate-300">{t("auth.chooseLanguage")}</div>
            <LanguageSwitcher variant="grid" className="sm:grid-cols-2" />
            <div className="mt-5 flex gap-2">
              <button onClick={() => setStep(0)} className="flex min-h-[48px] items-center gap-1.5 rounded-xl border border-slate-700 px-4 text-sm text-slate-300">
                <ArrowLeft size={16} /> {t("common.back")}
              </button>
              <motion.button whileTap={{ scale: 0.97 }} onClick={() => setStep(2)} className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 font-semibold text-slate-950">
                {t("common.continue")} <ArrowRight size={17} />
              </motion.button>
            </div>
          </motion.div>
        )}

        {step === 2 && (
          <motion.form key="details" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} onSubmit={onSubmit} noValidate className="mt-5 space-y-3">
            <FormError message={error} />
            <label className="block">
              <span className="mb-1.5 block text-sm text-slate-300">{t("auth.fullName")}</span>
              <input {...reg("name")} autoComplete="name" className={cn(authInput, inputState(e.name))} aria-invalid={!!e.name} />
              <FieldError message={e.name?.message} />
            </label>
            {role === "farmer" ? (
              <label className="block">
                <span className="mb-1.5 block text-sm text-slate-300">{t("auth.phone")}</span>
                <input {...reg("phone")} type="tel" inputMode="tel" autoComplete="tel" placeholder={t("auth.identifierPlaceholder")} className={cn(authInput, inputState(e.phone))} aria-invalid={!!e.phone} />
                <FieldError message={e.phone?.message} />
                <span className="mt-1 block text-xs text-slate-500">{t("auth.farmerOtpNote")}</span>
              </label>
            ) : (
              <>
                <label className="block">
                  <span className="mb-1.5 block text-sm text-slate-300">{t("auth.organization")}</span>
                  <input {...reg("organization")} autoComplete="organization" className={cn(authInput, inputState(e.organization))} aria-invalid={!!e.organization} />
                  <FieldError message={e.organization?.message} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm text-slate-300">{t("auth.workEmail")}</span>
                  <input {...reg("email")} type="email" autoComplete="email" className={cn(authInput, inputState(e.email))} aria-invalid={!!e.email} />
                  <FieldError message={e.email?.message} />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-sm text-slate-300">{t("auth.password")}</span>
                    <input {...reg("password")} type="password" autoComplete="new-password" placeholder={t("auth.passwordHint")} className={cn(authInput, inputState(e.password))} aria-invalid={!!e.password} />
                    <FieldError message={e.password?.message} />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm text-slate-300">{t("auth.confirmPassword")}</span>
                    <input {...reg("confirm")} type="password" autoComplete="new-password" className={cn(authInput, inputState(e.confirm))} aria-invalid={!!e.confirm} />
                    <FieldError message={e.confirm?.message} />
                  </label>
                </div>
              </>
            )}
            <label className="block">
              <span className="mb-1.5 block text-sm text-slate-300">{t("auth.country")}</span>
              <select {...reg("country")} className={cn(authInput, inputState(false))}>
                {COUNTRIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="flex min-h-[44px] cursor-pointer items-start gap-3 pt-1">
              <input type="checkbox" {...reg("agree")} className="mt-0.5 h-5 w-5 shrink-0 accent-emerald-500" />
              <span className="text-sm text-slate-300">{t("auth.agreeTerms")}</span>
            </label>
            <FieldError message={e.agree?.message} />
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setStep(1)} className="flex min-h-[48px] items-center gap-1.5 rounded-xl border border-slate-700 px-4 text-sm text-slate-300">
                <ArrowLeft size={16} />
              </button>
              <motion.button whileTap={{ scale: 0.97 }} type="submit" disabled={busy} className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 font-semibold text-slate-950 shadow-[0_0_24px_-6px_rgba(16,185,129,0.9)] disabled:opacity-60">
                {busy ? <Loader2 size={17} className="animate-spin" /> : <Check size={17} />} {busy ? t("auth.creating") : t("auth.createAccountCta")}
              </motion.button>
            </div>
          </motion.form>
        )}

        {step === 3 && pending && (
          <motion.div key="pending" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
            <motion.div initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 160, damping: 14 }} className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-amber-500/15 ring-1 ring-amber-400/40">
              <Clock3 size={28} className="text-amber-300" />
            </motion.div>
            <h1 className="mt-5 font-display text-2xl font-semibold text-white">{t("auth.pendingTitle")}</h1>
            <p className="mx-auto mt-2 max-w-sm text-sm text-slate-400">{t("auth.pendingBody")}</p>
            <motion.button whileTap={{ scale: 0.97 }} onClick={() => { router.push(pending); router.refresh(); }} className="mt-6 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 font-semibold text-slate-950">
              {t("auth.goToDashboard")} <ArrowRight size={17} />
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {step < 3 && (
        <p className="mt-6 text-center text-sm text-slate-400">
          {t("auth.haveAccount")}{" "}
          <Link href="/auth/signin" className="font-medium text-emerald-400 hover:underline">
            {t("auth.signIn")}
          </Link>
        </p>
      )}
    </AuthShell>
  );
}

export default function SignUpPage() {
  return (
    <Suspense>
      <SignUpFlow />
    </Suspense>
  );
}
