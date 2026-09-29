"use client";

/**
 * Organisation (enterprise) self-serve sign-up: creates a workspace with a
 * 14-day Business trial and signs the new admin straight into /app, where
 * the onboarding checklist and product tour take over.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { motion } from "framer-motion";
import { ArrowLeft, Building2, Check, HandHeart, Landmark, Loader2, Rocket, ShieldCheck, Sprout, Users, Wheat } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { FieldError, FormError, authInput, inputState } from "../_components/AuthShell";

const INDUSTRIES = [
  { key: "insurance", label: "Insurance", desc: "Crop & parametric insurers, reinsurers", icon: ShieldCheck, color: "#38bdf8" },
  { key: "banking", label: "Banking & MFI", desc: "Agri lenders, microfinance, DFIs", icon: Landmark, color: "#a78bfa" },
  { key: "agribusiness", label: "Agribusiness", desc: "Traders, processors, food companies", icon: Wheat, color: "#f59e0b" },
  { key: "government", label: "Government", desc: "Ministries, disaster agencies", icon: Building2, color: "#22d3ee" },
  { key: "ngo", label: "NGO", desc: "Humanitarian & anticipatory action", icon: HandHeart, color: "#f472b6" },
  { key: "cooperative", label: "Co-operative", desc: "Farmer producer organisations", icon: Users, color: "#10b981" },
] as const;
type IndustryKey = (typeof INDUSTRIES)[number]["key"];

const COUNTRIES = ["Bangladesh", "India", "Vietnam", "Philippines", "Indonesia", "Sri Lanka", "Nepal", "Pakistan", "Thailand", "Myanmar", "Cambodia", "Singapore", "Kenya", "Nigeria", "Ethiopia", "Ghana", "Brazil", "Mexico", "United Kingdom", "United States", "Other"];

export function OrgSignup({ onBack, language }: { onBack: () => void; language: string }) {
  const router = useRouter();
  const reg = trpc.auth.registerWorkspace.useMutation();
  const [industry, setIndustry] = useState<IndustryKey>("insurance");
  const [v, setV] = useState({ orgName: "", country: "Bangladesh", name: "", title: "", email: "", password: "", confirm: "", agree: false, website: "" });
  const [err, setErr] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof v, val: string | boolean) => setV((x) => ({ ...x, [k]: val }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const x: Record<string, string> = {};
    if (v.orgName.trim().length < 2) x.orgName = "Enter your organisation's name";
    if (v.name.trim().length < 2) x.name = "Enter your full name";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) x.email = "Enter a valid work email";
    if (v.password.length < 8) x.password = "At least 8 characters";
    if (v.password !== v.confirm) x.confirm = "Passwords don't match";
    if (!v.agree) x.agree = "Please accept the terms to continue";
    setErr(x);
    if (Object.keys(x).length) return;
    setFormError(null);
    try {
      await reg.mutateAsync({ orgName: v.orgName.trim(), industry, country: v.country, name: v.name.trim(), title: v.title.trim() || undefined, email: v.email.trim(), password: v.password, language: (["en", "hi", "bn", "vi", "fil", "id", "ta", "si"].includes(language) ? language : "en") as "en", website: v.website || undefined });
      const res = await signIn("credentials", { mode: "password", email: v.email.trim(), password: v.password, redirect: false });
      if (!res || res.error) throw new Error("Workspace created — please sign in.");
      setDone(true);
      setTimeout(() => {
        router.push("/app?welcome=1");
        router.refresh();
      }, 1100);
    } catch (e2) {
      setFormError((e2 as Error).message);
    }
  };

  if (done)
    return (
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="py-6 text-center">
        <motion.div initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 160, damping: 14 }} className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-cyan-500/15 ring-1 ring-cyan-400/40">
          <Rocket size={28} className="text-cyan-300" />
        </motion.div>
        <h1 className="mt-5 font-display text-2xl font-semibold text-white">Your workspace is ready</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-slate-400">14-day Business trial active — no card needed. Taking you to your workspace…</p>
        <Loader2 size={18} className="mx-auto mt-4 animate-spin text-cyan-300" />
      </motion.div>
    );

  return (
    <motion.form key="org" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} onSubmit={submit} noValidate className="mt-5 space-y-3">
      <FormError message={formError} />
      <div>
        <div className="mb-2 text-sm text-slate-300">Your industry</div>
        <div role="radiogroup" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {INDUSTRIES.map((i) => {
            const on = industry === i.key;
            return (
              <button key={i.key} type="button" role="radio" aria-checked={on} onClick={() => setIndustry(i.key)} className={cn("flex min-h-[64px] flex-col items-start gap-1 rounded-xl border p-2.5 text-left transition-colors", on ? "bg-slate-900/80" : "border-slate-700/80 bg-slate-950/40 hover:border-slate-500")} style={on ? { borderColor: i.color, boxShadow: `0 0 20px -10px ${i.color}` } : undefined}>
                <span className="flex w-full items-center gap-1.5">
                  <i.icon size={15} style={{ color: i.color }} />
                  <span className="text-[13px] font-medium text-white">{i.label}</span>
                  {on && <Check size={13} className="ml-auto" style={{ color: i.color }} />}
                </span>
                <span className="text-[11px] leading-snug text-slate-500">{i.desc}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm text-slate-300">Organisation name</span>
          <input value={v.orgName} onChange={(e) => set("orgName", e.target.value)} autoComplete="organization" className={cn(authInput, inputState(err.orgName))} aria-invalid={!!err.orgName} />
          <FieldError message={err.orgName} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm text-slate-300">Country (HQ)</span>
          <select value={v.country} onChange={(e) => set("country", e.target.value)} className={cn(authInput, inputState(false))}>
            {COUNTRIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm text-slate-300">Your full name</span>
          <input value={v.name} onChange={(e) => set("name", e.target.value)} autoComplete="name" className={cn(authInput, inputState(err.name))} aria-invalid={!!err.name} />
          <FieldError message={err.name} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm text-slate-300">Job title <span className="text-slate-500">(optional)</span></span>
          <input value={v.title} onChange={(e) => set("title", e.target.value)} autoComplete="organization-title" className={cn(authInput, inputState(false))} />
        </label>
      </div>
      <label className="block">
        <span className="mb-1.5 block text-sm text-slate-300">Work email</span>
        <input type="email" value={v.email} onChange={(e) => set("email", e.target.value)} autoComplete="email" className={cn(authInput, inputState(err.email))} aria-invalid={!!err.email} />
        <FieldError message={err.email} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm text-slate-300">Password</span>
          <input type="password" value={v.password} onChange={(e) => set("password", e.target.value)} autoComplete="new-password" placeholder="8+ characters" className={cn(authInput, inputState(err.password))} aria-invalid={!!err.password} />
          <FieldError message={err.password} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm text-slate-300">Confirm password</span>
          <input type="password" value={v.confirm} onChange={(e) => set("confirm", e.target.value)} autoComplete="new-password" className={cn(authInput, inputState(err.confirm))} aria-invalid={!!err.confirm} />
          <FieldError message={err.confirm} />
        </label>
      </div>
      {/* honeypot */}
      <input tabIndex={-1} autoComplete="off" value={v.website} onChange={(e) => set("website", e.target.value)} className="hidden" aria-hidden="true" />
      <label className="flex min-h-[44px] cursor-pointer items-start gap-3 pt-1">
        <input type="checkbox" checked={v.agree} onChange={(e) => set("agree", e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-cyan-400" />
        <span className="text-sm text-slate-300">
          I agree to the <a href="/docs/terms" target="_blank" className="text-cyan-300 hover:underline">terms</a> and <a href="/docs/privacy" target="_blank" className="text-cyan-300 hover:underline">privacy policy</a>.
        </span>
      </label>
      <FieldError message={err.agree} />
      <div className="rounded-xl border border-cyan-400/20 bg-cyan-500/5 px-3 py-2.5 text-[12.5px] text-cyan-100">
        <Sprout size={13} className="mr-1 inline text-cyan-300" /> 14-day Business trial · no card · 2,500 assets, 10 seats, API & scheduled reports. You'll be the workspace admin.
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onBack} className="flex min-h-[48px] items-center gap-1.5 rounded-xl border border-slate-700 px-4 text-sm text-slate-300" aria-label="Back">
          <ArrowLeft size={16} />
        </button>
        <motion.button whileTap={{ scale: 0.97 }} type="submit" disabled={reg.isPending} className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-cyan-400 font-semibold text-slate-950 shadow-[0_0_24px_-6px_rgba(56,189,248,0.9)] disabled:opacity-60">
          {reg.isPending ? <Loader2 size={17} className="animate-spin" /> : <Rocket size={17} />} {reg.isPending ? "Creating workspace…" : "Create workspace"}
        </motion.button>
      </div>
    </motion.form>
  );
}
