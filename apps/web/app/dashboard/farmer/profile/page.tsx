"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { motion } from "framer-motion";
import { Bell, Check, Copy, CreditCard, Crown, Download, Gift, Globe2, Loader2, LogOut, Save, Share2, Sprout, UserRound } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { HudButton, Panel, SectionHeader, Skeleton, SourceTag } from "@/components/hud";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { CROPS, CropIcon } from "@/components/farmer/crops";
import { PushNotificationsCard } from "@/components/pwa/PushNotificationsCard";

const inputCls = "min-h-[44px] w-full rounded-lg border border-slate-700 bg-slate-900/70 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500/60 focus:outline-none";

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} onClick={onClick} className={cn("inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors active:scale-[0.97]", on ? "border-emerald-500/60 bg-emerald-500/10 text-white" : "border-slate-700 text-slate-400 hover:text-slate-200")}>
      {on && <Check size={13} className="text-emerald-400" />}
      {children}
    </button>
  );
}

function FarmDetails() {
  const { t, tx } = useI18n();
  const utils = trpc.useUtils();
  const p = trpc.farmer.getProfile.useQuery(undefined, { retry: false });
  const save = trpc.farmer.updateProfile.useMutation({
    onSuccess: () => {
      toast.success(t("profile.savedToast"));
      void utils.farmer.getProfile.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const [f, setF] = useState({ name: "", phone: "", email: "", farmName: "", totalAreaHa: "", experienceYears: "", primaryCrops: [] as string[], hasInsurance: false });
  useEffect(() => {
    if (!p.data) return;
    setF({
      name: p.data.user?.name ?? "",
      phone: p.data.user?.phone ?? "",
      email: p.data.user?.email ?? "",
      farmName: p.data.farmer.farmName,
      totalAreaHa: String(p.data.farmer.totalAreaHa),
      experienceYears: String(p.data.farmer.experienceYears),
      primaryCrops: p.data.farmer.primaryCrops,
      hasInsurance: p.data.farmer.hasInsurance,
    });
  }, [p.data]);
  if (!p.data) return <Panel title={t("profile.farmDetails")} icon={Sprout}><Skeleton className="h-64 w-full" /></Panel>;
  const readOnly = p.data.isDemoFallback;
  return (
    <Panel title={t("profile.farmDetails")} icon={Sprout} subtitle={`${p.data.district.name}, ${p.data.district.countryName} · ${p.data.district.basin}`}>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({
            name: f.name || undefined,
            phone: f.phone || undefined,
            email: f.email,
            farmName: f.farmName || undefined,
            totalAreaHa: Number(f.totalAreaHa) || undefined,
            experienceYears: Number.isFinite(Number(f.experienceYears)) ? Number(f.experienceYears) : undefined,
            primaryCrops: f.primaryCrops.length ? (f.primaryCrops as (typeof CROPS)[number][]) : undefined,
            hasInsurance: f.hasInsurance,
          });
        }}
      >
        {(
          [
            ["name", t("profile.name"), "text"],
            ["phone", t("profile.phone"), "tel"],
            ["email", t("profile.email"), "email"],
            ["farmName", t("profile.farmName"), "text"],
            ["totalAreaHa", t("profile.totalArea"), "number"],
            ["experienceYears", t("profile.experience"), "number"],
          ] as const
        ).map(([k, label, type]) => (
          <label key={k} className="block">
            <span className="mb-1 block text-xs text-slate-400">{label}</span>
            <input type={type} step={type === "number" ? "any" : undefined} value={f[k]} disabled={readOnly} onChange={(e) => setF((s) => ({ ...s, [k]: e.target.value }))} className={inputCls} />
          </label>
        ))}
        <div className="sm:col-span-2">
          <span className="mb-1.5 block text-xs text-slate-400">{t("profile.primaryCrops")}</span>
          <div className="flex flex-wrap gap-2">
            {CROPS.map((c) => (
              <Chip key={c} on={f.primaryCrops.includes(c)} onClick={() => !readOnly && setF((s) => ({ ...s, primaryCrops: s.primaryCrops.includes(c) ? s.primaryCrops.filter((x) => x !== c) : [...s.primaryCrops, c] }))}>
                <CropIcon crop={c} size={14} /> {tx(`crops.${c}`)}
              </Chip>
            ))}
          </div>
        </div>
        <label className="flex min-h-[44px] items-center gap-3 sm:col-span-2">
          <input type="checkbox" checked={f.hasInsurance} disabled={readOnly} onChange={(e) => setF((s) => ({ ...s, hasInsurance: e.target.checked }))} className="h-5 w-5 accent-emerald-500" />
          <span className="text-sm text-slate-200">{t("profile.hasInsurance")}</span>
        </label>
        <div className="sm:col-span-2">
          <HudButton type="submit" disabled={save.isPending || readOnly} className="min-h-[44px] w-full sm:w-auto">
            {save.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {t("profile.saveChanges")}
          </HudButton>
        </div>
      </form>
    </Panel>
  );
}

function Notifications() {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const p = trpc.farmer.getProfile.useQuery(undefined, { retry: false });
  const save = trpc.farmer.updateNotificationPrefs.useMutation({
    onSuccess: () => {
      toast.success(t("common.saved"));
      void utils.farmer.getProfile.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const [prefs, setPrefs] = useState<{ alertTypes: string[]; channels: string[]; timing: "immediate" | "daily" | "weekly"; threshold: "low" | "medium" | "high" } | null>(null);
  useEffect(() => {
    if (p.data) setPrefs({ ...p.data.farmer.notificationPrefs });
  }, [p.data]);
  if (!prefs) return <Panel title={t("profile.notifications")} icon={Bell}><Skeleton className="h-48 w-full" /></Panel>;
  const toggle = (k: "alertTypes" | "channels", v: string) => setPrefs((s) => s && { ...s, [k]: s[k].includes(v) ? s[k].filter((x) => x !== v) : [...s[k], v] });
  const types = [
    ["flood", t("profile.alertFlood")],
    ["salinity", t("profile.alertSalinity")],
    ["planting", t("profile.alertPlanting")],
    ["weather", t("profile.alertWeather")],
  ] as const;
  const chans = [
    ["app", t("profile.channelApp")],
    ["sms", t("profile.channelSms")],
    ["whatsapp", t("profile.channelWhatsapp")],
    ["email", t("profile.channelEmail")],
  ] as const;
  return (
    <Panel title={t("profile.notifications")} icon={Bell} accent="amber">
      <div className="space-y-4">
        <div>
          <div className="hud-label mb-2">{t("profile.alertTypes")}</div>
          <div className="flex flex-wrap gap-2">{types.map(([k, l]) => <Chip key={k} on={prefs.alertTypes.includes(k)} onClick={() => toggle("alertTypes", k)}>{l}</Chip>)}</div>
        </div>
        <div>
          <div className="hud-label mb-2">{t("profile.channels")}</div>
          <div className="flex flex-wrap gap-2">{chans.map(([k, l]) => <Chip key={k} on={prefs.channels.includes(k)} onClick={() => toggle("channels", k)}>{l}</Chip>)}</div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="hud-label mb-2">{t("profile.timing")}</div>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-900 p-1">
              {(["immediate", "daily", "weekly"] as const).map((k) => (
                <button key={k} onClick={() => setPrefs((s) => s && { ...s, timing: k })} className={cn("min-h-[40px] rounded-md text-xs", prefs.timing === k ? "bg-emerald-500 font-semibold text-slate-950" : "text-slate-400")}>
                  {t(`profile.timing${k[0]!.toUpperCase()}${k.slice(1)}` as "profile.timingDaily")}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="hud-label mb-2">{t("profile.threshold")}</div>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-900 p-1">
              {(["low", "medium", "high"] as const).map((k) => (
                <button key={k} onClick={() => setPrefs((s) => s && { ...s, threshold: k })} className={cn("min-h-[40px] rounded-md text-xs", prefs.threshold === k ? "bg-amber-400 font-semibold text-slate-950" : "text-slate-400")}>
                  {t(`risk.${k}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
        <HudButton
          onClick={() => save.mutate({ alertTypes: prefs.alertTypes as ("flood" | "salinity" | "planting" | "weather")[], channels: (prefs.channels.length ? prefs.channels : ["app"]) as ("app" | "sms" | "whatsapp" | "email")[], timing: prefs.timing, threshold: prefs.threshold })}
          disabled={save.isPending || p.data?.isDemoFallback}
          className="min-h-[44px]"
        >
          {save.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {t("common.save")}
        </HudButton>
      </div>
    </Panel>
  );
}

function Subscription() {
  const { t, fmt } = useI18n();
  const p = trpc.farmer.getProfile.useQuery(undefined, { retry: false });
  if (!p.data) return <Skeleton className="h-40" />;
  const pro = p.data.subscription.plan === "farmer_pro";
  return (
    <Panel title={t("profile.subscription")} icon={CreditCard} accent={pro ? "violet" : "emerald"}>
      <div className="flex items-center gap-3">
        <span className={cn("grid h-11 w-11 place-items-center rounded-xl", pro ? "bg-violet-500/15" : "bg-slate-800")}>
          <Crown size={20} className={pro ? "text-violet-300" : "text-slate-500"} />
        </span>
        <div>
          <div className="font-display text-lg font-semibold text-white">{pro ? t("profile.planPro") : t("profile.planFree")}</div>
          <div className="text-xs text-slate-400">
            <span className="uppercase telemetry">{p.data.subscription.status}</span>
            {p.data.subscription.currentPeriodEnd && <> · {t("profile.renews", { date: fmt.date(p.data.subscription.currentPeriodEnd) })}</>}
          </div>
        </div>
      </div>
      <p className="mt-3 text-sm text-slate-400">{t("profile.proFeatures")}</p>
      {!pro && (
        <Link href="/pricing" className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-violet-500 to-emerald-500 text-sm font-semibold text-white shadow-[0_0_24px_-6px_rgba(139,92,246,0.8)] active:scale-[0.97]">
          <Crown size={15} /> {t("profile.upgrade")} · {fmt.currency(p.data.currency === "USD" ? 3 : { BDT: 350, INR: 199, VND: 75000, PHP: 169, IDR: 49000 }[p.data.currency] ?? 3, null, p.data.currency)}
        </Link>
      )}
    </Panel>
  );
}

function DataExport() {
  const { t } = useI18n();
  const exp = trpc.farmer.exportData.useMutation({
    onSuccess: (r) => {
      for (const f of r.files) {
        const blob = new Blob(["﻿" + f.csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = f.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
      toast.success(t("profile.downloadReady", { count: r.files.length }), { description: r.files.map((f) => `${f.name} (${f.rows})`).join("\n") });
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Panel title={t("profile.data")} icon={Download} accent="cyan" actions={<SourceTag>CSV · UTF-8</SourceTag>}>
      <p className="text-sm text-slate-400">{t("profile.downloadHint")}</p>
      <HudButton variant="outline" onClick={() => exp.mutate()} disabled={exp.isPending} className="mt-3 min-h-[44px] w-full">
        {exp.isPending ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} {t("profile.downloadData")}
      </HudButton>
    </Panel>
  );
}

function Referral() {
  const { t } = useI18n();
  const r = trpc.farmer.getReferral.useQuery();
  const [copied, setCopied] = useState(false);
  if (!r.data) return <Skeleton className="h-52" />;
  const d = r.data;
  const rewardLabel = (k: string) => t(k === "sms" ? "profile.rewardSms" : k === "pro" ? "profile.rewardPro" : "profile.rewardCoop");
  const max = d.tiers[d.tiers.length - 1]!.at;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(d.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error(d.link);
    }
  };
  const share = async () => {
    const data = { title: "Agri-SHIELD", text: `${t("profile.shareText")} ${d.code}`, url: d.link };
    if (navigator.share) await navigator.share(data).catch(() => {});
    else window.open(`https://wa.me/?text=${encodeURIComponent(`${data.text} ${d.link}`)}`, "_blank", "noopener");
  };
  return (
    <Panel title={t("profile.referral")} icon={Gift} accent="violet">
      <p className="text-sm text-slate-400">{t("profile.referralHint")}</p>
      <div className="mt-3 flex items-center gap-2 rounded-xl border border-dashed border-violet-400/40 bg-violet-500/5 p-3">
        <div className="min-w-0 flex-1">
          <div className="hud-label">{t("profile.yourCode")}</div>
          <div className="telemetry text-xl font-semibold tracking-wider text-white">{d.code}</div>
        </div>
        <button onClick={copy} className="grid h-11 w-11 place-items-center rounded-lg border border-slate-700 text-slate-300 hover:text-white" aria-label={t("profile.copyLink")} title={t("profile.copyLink")}>
          {copied ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
        </button>
        <button onClick={share} className="grid h-11 w-11 place-items-center rounded-lg bg-violet-500 text-white" aria-label={t("profile.shareLink")}>
          <Share2 size={16} />
        </button>
      </div>
      <div className="mt-4">
        <div className="mb-1.5 flex justify-between text-xs">
          <span className="text-slate-300">{t("profile.joined", { count: d.referrals })}</span>
          <span className="text-slate-500">{d.next ? t("profile.nextUnlock", { remaining: d.next.remaining, reward: rewardLabel(d.next.reward) }) : t("profile.allUnlocked")}</span>
        </div>
        <div className="relative h-2 rounded-full bg-slate-800">
          <motion.div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-emerald-400" initial={{ width: 0 }} animate={{ width: `${Math.min(100, (d.referrals / max) * 100)}%` }} transition={{ duration: 1 }} />
          {d.tiers.map((tier) => (
            <span key={tier.at} className={cn("absolute -top-1 h-4 w-4 -translate-x-1/2 rounded-full border-2", tier.unlocked ? "border-emerald-300 bg-emerald-500" : "border-slate-600 bg-slate-900")} style={{ left: `${(tier.at / max) * 100}%` }} title={rewardLabel(tier.reward)} />
          ))}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]">
          {d.tiers.map((tier) => (
            <div key={tier.at} className={cn("rounded-lg p-2", tier.unlocked ? "bg-emerald-500/10 text-emerald-200" : "bg-slate-900/60 text-slate-500")}>
              <div className="telemetry font-semibold">{tier.at}</div>
              {rewardLabel(tier.reward)}
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

export default function FarmerProfilePage() {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-5xl">
      <SectionHeader eyebrow={t("nav.profile")} title={t("profile.title")} />
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <FarmDetails />
          <Notifications />
          <PushNotificationsCard />
        </div>
        <div className="space-y-4 lg:col-span-2">
          <Panel title={t("common.language")} icon={Globe2}>
            <LanguageSwitcher variant="grid" className="sm:grid-cols-2" />
          </Panel>
          <Subscription />
          <Referral />
          <DataExport />
          <Panel title={t("profile.account")} icon={UserRound}>
            <HudButton variant="danger" onClick={() => signOut({ callbackUrl: "/" })} className="min-h-[44px] w-full">
              <LogOut size={15} /> {t("common.signOut")}
            </HudButton>
          </Panel>
        </div>
      </div>
    </div>
  );
}
