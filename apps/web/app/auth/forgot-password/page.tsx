"use client";

import Link from "next/link";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Loader2, MailCheck, Send } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { AuthShell, FieldError, FormError, authInput, inputState } from "../_components/AuthShell";

export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string | undefined>();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const reset = trpc.farmer.requestPasswordReset.useMutation();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return setErr(t("auth.emailInvalid"));
    setErr(undefined);
    await reset.mutateAsync({ email: v }).then(() => setSentTo(v)).catch(() => {});
  };

  return (
    <AuthShell>
      <Link href="/auth/signin?tab=email" className="mb-4 inline-flex min-h-[36px] items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200">
        <ArrowLeft size={13} /> {t("auth.backToSignin")}
      </Link>
      <AnimatePresence mode="wait">
        {sentTo ? (
          <motion.div key="sent" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
            <motion.div initial={{ rotate: -12, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: "spring", stiffness: 200, damping: 12 }} className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-emerald-500/15 ring-1 ring-emerald-400/40">
              <MailCheck size={28} className="text-emerald-300" />
            </motion.div>
            <h1 className="mt-5 font-display text-2xl font-semibold text-white">{t("auth.resetSentTitle")}</h1>
            <p className="mt-2 text-sm text-slate-400">{t("auth.resetSentBody", { email: sentTo })}</p>
            <Link href="/auth/signin?tab=email" className="mt-6 flex min-h-[48px] items-center justify-center rounded-xl border border-slate-700 text-sm font-medium text-slate-200 hover:border-emerald-500/50">
              {t("auth.backToSignin")}
            </Link>
          </motion.div>
        ) : (
          <motion.form key="form" exit={{ opacity: 0 }} onSubmit={submit} noValidate>
            <h1 className="font-display text-2xl font-semibold text-white">{t("auth.forgotTitle")}</h1>
            <p className="mt-1 text-sm text-slate-400">{t("auth.forgotSubtitle")}</p>
            <div className="mt-5">
              <FormError message={reset.error?.message} />
              <label className="block">
                <span className="mb-1.5 block text-sm text-slate-300">{t("auth.email")}</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className={cn(authInput, inputState(err))} aria-invalid={!!err} />
                <FieldError message={err} />
              </label>
              <motion.button whileTap={{ scale: 0.97 }} type="submit" disabled={reset.isPending} className="mt-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 font-semibold text-slate-950 shadow-[0_0_24px_-6px_rgba(16,185,129,0.9)] disabled:opacity-60">
                {reset.isPending ? <Loader2 size={17} className="animate-spin" /> : <Send size={16} />} {t("auth.sendResetLink")}
              </motion.button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </AuthShell>
  );
}
