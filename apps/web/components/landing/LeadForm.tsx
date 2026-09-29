"use client";

/** Demo / partnership request form → billing.submitLead (stored + emailed via outbox). */
import { useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { z } from "zod";
import { trpc } from "@/lib/trpc";

type Interest = "government_demo" | "partnership" | "investment" | "enterprise" | "supply_chain" | "other";

const INTERESTS: { id: Interest; label: string }[] = [
  { id: "enterprise", label: "Company workspace" },
  { id: "government_demo", label: "Government demo" },
  { id: "supply_chain", label: "Supply chain pilot" },
  { id: "partnership", label: "NGO / research partnership" },
  { id: "investment", label: "Investment" },
  { id: "other", label: "Something else" },
];

const schema = z.object({
  name: z.string().trim().min(2, "Enter your name"),
  email: z.string().trim().email("Enter a valid work email"),
  organisation: z.string().trim().min(2, "Enter your organisation"),
  role: z.string().trim().max(80).optional(),
  country: z.string().trim().max(60).optional(),
  message: z.string().trim().max(2000).optional(),
});

export function LeadForm({ defaultInterest = "government_demo", source = "landing", compact = false }: { defaultInterest?: Interest; source?: string; compact?: boolean }) {
  const [interest, setInterest] = useState<Interest>(defaultInterest);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = trpc.billing.submitLead.useMutation();

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const raw = Object.fromEntries(["name", "email", "organisation", "role", "country", "message"].map((k) => [k, String(fd.get(k) ?? "")]));
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) errs[String(issue.path[0])] = issue.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    submit.mutate({ ...parsed.data, message: parsed.data.message ?? "", interest, source, website: String(fd.get("website") ?? "") || undefined });
  };

  const field = (name: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block">
      <span className="mb-1.5 block text-xs text-slate-400">{label}</span>
      <input name={name} className="site-input" aria-invalid={!!errors[name]} aria-describedby={errors[name] ? `${name}-err` : undefined} {...props} />
      {errors[name] && (
        <span id={`${name}-err`} className="mt-1 block text-xs text-rose-300">
          {errors[name]}
        </span>
      )}
    </label>
  );

  return (
    <AnimatePresence mode="wait">
      {submit.isSuccess ? (
        <motion.div key="ok" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center justify-center py-10 text-center" role="status">
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 14 }}>
            <CheckCircle2 size={44} className="text-emerald-400" />
          </motion.span>
          <p className="mt-4 font-display text-xl font-semibold text-white">Request received</p>
          <p className="mt-2 max-w-sm text-sm text-slate-400">We’ll reply within one business day with a demo slot. Reference <span className="telemetry text-slate-300">{submit.data.id}</span>.</p>
        </motion.div>
      ) : (
        <motion.form key="form" onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Request a demo">
          <fieldset>
            <legend className="mb-2 text-xs text-slate-400">I’m interested in</legend>
            <div className="flex flex-wrap gap-1.5">
              {INTERESTS.map((it) => (
                <label key={it.id} className={`cursor-pointer rounded-lg border px-3 py-2 text-xs transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-emerald-400 ${interest === it.id ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-100" : "border-white/10 text-slate-300 hover:border-white/25"}`}>
                  <input type="radio" name="interest" value={it.id} checked={interest === it.id} onChange={() => setInterest(it.id)} className="sr-only" />
                  {it.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className={`grid gap-4 ${compact ? "" : "sm:grid-cols-2"}`}>
            {field("name", "Full name", { autoComplete: "name", placeholder: "Your name" })}
            {field("email", "Work email", { type: "email", autoComplete: "email", placeholder: "you@company.com" })}
            {field("organisation", "Organisation", { autoComplete: "organization", placeholder: "Ministry, company or NGO" })}
            {field("role", "Role (optional)", { placeholder: "e.g. Deputy Director, DAE" })}
          </div>
          {field("country", "Country (optional)", { autoComplete: "country-name", placeholder: "Bangladesh, Vietnam, India…" })}
          <label className="block">
            <span className="mb-1.5 block text-xs text-slate-400">What should the demo cover? (optional)</span>
            <textarea name="message" rows={compact ? 3 : 4} className="site-input resize-y" placeholder="Provinces, crops, number of farmers, systems you need to integrate with…" />
          </label>
          {/* honeypot */}
          <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
          {submit.error && <p className="text-sm text-rose-300" role="alert">{submit.error.message.includes("Rate limit") ? "Too many requests. Wait a minute and try again." : "Couldn’t send your request. Check the fields and try again."}</p>}
          <button type="submit" disabled={submit.isPending} className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-6 text-[15px] font-semibold text-slate-950 transition-colors hover:bg-emerald-400 disabled:opacity-60 sm:w-auto">
            {submit.isPending ? <Loader2 size={17} className="animate-spin" /> : <Send size={16} />}
            {interest === "government_demo" ? "Request government demo" : "Send request"}
          </button>
          <p className="text-[11px] text-slate-500">We use these details only to reply to you. See our <a href="/docs/privacy" className="underline underline-offset-2">privacy policy</a>.</p>
        </motion.form>
      )}
    </AnimatePresence>
  );
}
