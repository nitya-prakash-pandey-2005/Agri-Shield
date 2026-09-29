"use client";

/**
 * Farmer onboarding wizard (spec §4.3) — 5 steps with progress bar:
 * 1 personal + language (UI switches instantly) · 2 farm + crops · 3 draw fields
 * (tap vertices / coordinates / geolocation auto-outline, geodesic area) ·
 * 4 risk profile + auto-detected elevation, coast & river distance · 5 alerts.
 * Completion: confetti + baseline risk + first 3 personalised recommendations.
 */
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  CheckCircle2,
  Crosshair,
  Keyboard,
  Loader2,
  LocateFixed,
  MapPin,
  Mountain,
  PenTool,
  Shield,
  ShieldAlert,
  Sprout,
  Trash2,
  Undo2,
  UserRound,
  Waves,
} from "lucide-react";
import { toast } from "sonner";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { Locale } from "@/lib/i18n/config";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { Skeleton, SourceTag } from "@/components/hud";
import { RiskMeter } from "@/components/ui/RiskMeter";
import { CROPS, CropIcon, type Crop } from "@/components/farmer/crops";
import { closeRing, ringAreaHa, ringCentroid, squareAround } from "@/server/data/farmer-geometry";

const FieldDrawMap = dynamic(() => import("@/components/farmer/onboarding/FieldDrawMap"), { ssr: false, loading: () => <Skeleton className="h-full w-full" /> });

const IRRIGATION = ["rainfed", "canal", "flood_irrigation", "drip", "sprinkler"] as const;
const DRAFT_KEY = "agri_onboarding_draft_v1";

interface FieldDraft {
  key: string;
  name: string;
  cropType: Crop;
  plantingDate: string;
  irrigationType: (typeof IRRIGATION)[number];
  polygon: [number, number][];
}
interface Draft {
  personal: { name: string; phone: string; country: string; districtId: string; experienceYears: string; language: Locale };
  farm: { farmName: string; totalAreaHa: string; primaryCrops: Crop[] };
  fields: FieldDraft[];
  risk: { floodHistory: "never" | "rarely" | "sometimes" | "often"; salinityObserved: boolean | null; hasInsurance: boolean | null };
  notifications: { alertTypes: ("flood" | "salinity" | "planting" | "weather")[]; channels: ("app" | "sms" | "whatsapp" | "email")[]; timing: "immediate" | "daily" | "weekly"; threshold: "low" | "medium" | "high"; whatsappNumber: string };
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

const inputCls = "min-h-[48px] w-full rounded-xl border border-slate-700 bg-slate-900/70 px-3.5 text-[15px] text-slate-100 placeholder:text-slate-500 focus:border-emerald-500/70 focus:outline-none focus:ring-2 focus:ring-emerald-500/20";

function Field({ label, error, children, hint, group }: { label: string; error?: string | null; children: ReactNode; hint?: ReactNode; group?: boolean }) {
  const Tag = group ? "div" : "label";
  return (
    <Tag className="block" {...(group ? { role: "group", "aria-label": label } : {})}>
      <span className="mb-1.5 block text-sm font-medium text-slate-300">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      <AnimatePresence>
        {error && (
          <motion.span initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-1 block text-xs text-rose-400" role="alert">
            {error}
          </motion.span>
        )}
      </AnimatePresence>
    </Tag>
  );
}

function Choice({ on, onClick, children, className }: { on: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.97 }}
      role="checkbox"
      aria-checked={on}
      onClick={onClick}
      className={cn("relative min-h-[48px] rounded-xl border px-3 py-2 text-left text-sm transition-colors", on ? "border-emerald-400/70 bg-emerald-500/10 text-white shadow-[0_0_18px_-8px_rgba(16,185,129,0.9)]" : "border-slate-700/80 bg-slate-900/50 text-slate-300 hover:border-slate-500", className)}
    >
      {children}
      {on && <Check size={14} className="absolute right-2 top-2 text-emerald-400" />}
    </motion.button>
  );
}

export default function FarmerOnboardingPage() {
  const { t, tx, fmt, locale } = useI18n();
  const router = useRouter();
  const utils = trpc.useUtils();
  const meta = trpc.farmer.getOnboardingMeta.useQuery();
  const complete = trpc.farmer.completeOnboarding.useMutation();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<RouterOutputs["farmer"]["completeOnboarding"] | null>(null);
  const [d, setD] = useState<Draft>({
    personal: { name: "", phone: "", country: "BD", districtId: "", experienceYears: "10", language: locale },
    farm: { farmName: "", totalAreaHa: "", primaryCrops: [] },
    fields: [],
    risk: { floodHistory: "sometimes", salinityObserved: null, hasInsurance: null },
    notifications: { alertTypes: ["flood", "salinity", "weather", "planting"], channels: ["app", "sms"], timing: "immediate", threshold: "medium", whatsappNumber: "" },
  });

  // restore draft / prefill from account
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { d: Draft; step: number };
        setD((cur) => ({ ...cur, ...saved.d, personal: { ...saved.d.personal, language: locale } }));
        setStep(Math.min(4, saved.step ?? 0));
        return;
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const m = meta.data;
    if (!m) return;
    setD((cur) => ({
      ...cur,
      personal: {
        ...cur.personal,
        name: cur.personal.name || m.prefill?.name || "",
        phone: cur.personal.phone || m.prefill?.phone || "",
        districtId: cur.personal.districtId || m.existing?.districtId || m.districts.find((x) => x.country === cur.personal.country)?.id || "",
        country: m.existing ? m.districts.find((x) => x.id === m.existing!.districtId)?.country ?? cur.personal.country : cur.personal.country,
        experienceYears: m.existing ? String(m.existing.experienceYears) : cur.personal.experienceYears,
      },
      farm: { ...cur.farm, farmName: cur.farm.farmName || m.existing?.farmName || "", primaryCrops: cur.farm.primaryCrops.length ? cur.farm.primaryCrops : ((m.existing?.primaryCrops as Crop[]) ?? []) },
    }));
  }, [meta.data]);
  useEffect(() => {
    if (result) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ d, step }));
    } catch {}
  }, [d, step, result]);
  useEffect(() => setD((cur) => ({ ...cur, personal: { ...cur.personal, language: locale } })), [locale]);

  const district = meta.data?.districts.find((x) => x.id === d.personal.districtId);
  const steps = [
    { key: "personal", label: t("onboarding.stepPersonal"), icon: UserRound },
    { key: "farm", label: t("onboarding.stepFarm"), icon: Sprout },
    { key: "fields", label: t("onboarding.stepFields"), icon: PenTool },
    { key: "risk", label: t("onboarding.stepRisk"), icon: ShieldAlert },
    { key: "notify", label: t("onboarding.stepNotify"), icon: Bell },
  ];

  const validate = (s: number) => {
    const e: Record<string, string> = {};
    if (s === 0) {
      if (d.personal.name.trim().length < 2) e.name = t("onboarding.required");
      if (!d.personal.districtId) e.district = t("onboarding.required");
      if (d.personal.phone && !/^\+?[0-9\s-]{7,20}$/.test(d.personal.phone)) e.phone = t("auth.phoneInvalid");
    }
    if (s === 1) {
      if (d.farm.farmName.trim().length < 2) e.farmName = t("onboarding.required");
      if (!d.farm.primaryCrops.length) e.crops = t("onboarding.selectCrop");
    }
    if (s === 2 && !d.fields.length) e.fields = t("onboarding.addField");
    setErrors(e);
    return !Object.keys(e).length;
  };

  const go = (to: number) => {
    if (to > step && !validate(step)) return;
    setDir(to > step ? 1 : -1);
    setStep(to);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = async () => {
    for (let s = 0; s < 3; s++)
      if (!validate(s)) {
        setStep(s);
        return;
      }
    const drawnArea = d.fields.reduce((a, f) => a + ringAreaHa(closeRing(f.polygon)), 0);
    try {
      const r = await complete.mutateAsync({
        personal: { name: d.personal.name.trim(), phone: d.personal.phone.trim() || undefined, country: d.personal.country, districtId: d.personal.districtId, experienceYears: Math.max(0, Math.min(80, Number(d.personal.experienceYears) || 0)), language: d.personal.language },
        farm: { farmName: d.farm.farmName.trim(), totalAreaHa: Number(d.farm.totalAreaHa) || Math.max(0.01, Math.round(drawnArea * 100) / 100), primaryCrops: d.farm.primaryCrops },
        fields: d.fields.map((f) => ({ name: f.name.trim() || "Field", cropType: f.cropType, plantingDate: new Date(`${f.plantingDate}T00:00:00`), irrigationType: f.irrigationType, polygon: f.polygon })),
        risk: { floodHistory: d.risk.floodHistory, salinityObserved: !!d.risk.salinityObserved, hasInsurance: !!d.risk.hasInsurance },
        notifications: { alertTypes: d.notifications.alertTypes, channels: d.notifications.channels.length ? d.notifications.channels : ["app"], timing: d.notifications.timing, threshold: d.notifications.threshold, whatsappNumber: d.notifications.whatsappNumber || undefined },
      });
      setResult(r);
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {}
      void utils.farmer.invalidate();
      const confetti = (await import("canvas-confetti")).default;
      const fire = (o: object) => confetti({ particleCount: 90, spread: 75, startVelocity: 42, colors: ["#10b981", "#34d399", "#38bdf8", "#fbbf24", "#a78bfa"], ...o });
      fire({ origin: { x: 0.2, y: 0.7 }, angle: 60 });
      fire({ origin: { x: 0.8, y: 0.7 }, angle: 120 });
      setTimeout(() => fire({ origin: { x: 0.5, y: 0.4 }, particleCount: 140, spread: 110 }), 350);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (result) return <Completion result={result} onOpen={() => router.push("/dashboard/farmer")} />;

  return (
    <div className="mx-auto max-w-3xl px-4 pb-32 pt-6 sm:pt-10">
      <header className="mb-6 flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600">
            <Shield size={17} className="text-slate-950" />
          </span>
          <span className="font-display font-semibold text-white">
            Agri<span className="text-emerald-400">-SHIELD</span>
          </span>
        </Link>
        <LanguageSwitcher />
      </header>

      <div className="mb-2 flex items-end justify-between">
        <h1 className="font-display text-2xl font-semibold text-white sm:text-3xl">{t("onboarding.title")}</h1>
        <span className="telemetry text-xs text-slate-400">{t("onboarding.stepOf", { n: step + 1, total: 5 })}</span>
      </div>
      {/* progress */}
      <div className="relative mb-2 h-1.5 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-valuemin={1} aria-valuemax={5} aria-valuenow={step + 1}>
        <motion.div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400 shadow-[0_0_14px_rgba(16,185,129,0.8)]" animate={{ width: `${((step + 1) / 5) * 100}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
      </div>
      <ol className="mb-6 grid grid-cols-5 gap-1">
        {steps.map((s, i) => (
          <li key={s.key}>
            <button type="button" onClick={() => i < step && go(i)} disabled={i > step} className={cn("flex w-full flex-col items-center gap-1 py-1 text-[10px] sm:text-[11px]", i === step ? "text-emerald-300" : i < step ? "text-slate-300" : "text-slate-600")}>
              <span className={cn("grid h-8 w-8 place-items-center rounded-full border", i < step ? "border-emerald-500 bg-emerald-500 text-slate-950" : i === step ? "border-emerald-400 bg-emerald-500/10" : "border-slate-700")}>{i < step ? <Check size={14} strokeWidth={3} /> : <s.icon size={14} />}</span>
              <span className="hidden text-center leading-tight sm:block">{s.label}</span>
            </button>
          </li>
        ))}
      </ol>

      <AnimatePresence mode="wait" custom={dir}>
        <motion.section key={step} custom={dir} initial={{ opacity: 0, x: dir * 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -40 }} transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }} className="hud-panel p-4 sm:p-6">
          {step === 0 && (
            <div className="space-y-4">
              <StepHead title={t("onboarding.personalTitle")} desc={t("onboarding.personalDesc")} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("onboarding.name")} error={errors.name}>
                  <input className={inputCls} value={d.personal.name} autoComplete="name" onChange={(e) => setD({ ...d, personal: { ...d.personal, name: e.target.value } })} />
                </Field>
                <Field label={t("onboarding.phone")} error={errors.phone}>
                  <input className={inputCls} type="tel" inputMode="tel" autoComplete="tel" value={d.personal.phone} placeholder="+880 1711 000000" onChange={(e) => setD({ ...d, personal: { ...d.personal, phone: e.target.value } })} />
                </Field>
                <Field label={t("onboarding.country")}>
                  <select className={inputCls} value={d.personal.country} onChange={(e) => setD({ ...d, personal: { ...d.personal, country: e.target.value, districtId: meta.data?.districts.find((x) => x.country === e.target.value)?.id ?? "" } })}>
                    {meta.data?.countries.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name} — {c.basin}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("onboarding.district")} error={errors.district}>
                  <select className={inputCls} value={d.personal.districtId} onChange={(e) => setD({ ...d, personal: { ...d.personal, districtId: e.target.value } })}>
                    {meta.data?.districts
                      .filter((x) => x.country === d.personal.country)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name} · {x.riverName}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label={t("onboarding.experience")}>
                  <input className={inputCls} type="number" inputMode="numeric" min={0} max={80} value={d.personal.experienceYears} onChange={(e) => setD({ ...d, personal: { ...d.personal, experienceYears: e.target.value } })} />
                </Field>
              </div>
              <div>
                <div className="mb-2 text-sm font-medium text-slate-300">{t("onboarding.preferredLanguage")}</div>
                <LanguageSwitcher variant="grid" />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <StepHead title={t("onboarding.farmTitle")} desc={t("onboarding.farmDesc")} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("onboarding.farmName")} error={errors.farmName}>
                  <input className={inputCls} value={d.farm.farmName} onChange={(e) => setD({ ...d, farm: { ...d.farm, farmName: e.target.value } })} />
                </Field>
                <Field label={t("onboarding.totalArea")} hint={d.fields.length ? t("onboarding.drawnArea", { area: fmt.number(d.fields.reduce((a, f) => a + ringAreaHa(closeRing(f.polygon)), 0), { maximumFractionDigits: 2 }) }) : undefined}>
                  <input className={inputCls} type="number" inputMode="decimal" min={0.01} step="any" value={d.farm.totalAreaHa} onChange={(e) => setD({ ...d, farm: { ...d.farm, totalAreaHa: e.target.value } })} />
                </Field>
              </div>
              <Field group label={t("onboarding.crops")} error={errors.crops}>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {CROPS.map((c) => {
                    const on = d.farm.primaryCrops.includes(c);
                    return (
                      <Choice key={c} on={on} onClick={() => setD({ ...d, farm: { ...d.farm, primaryCrops: on ? d.farm.primaryCrops.filter((x) => x !== c) : [...d.farm.primaryCrops, c] } })} className="flex flex-col items-center justify-center gap-1.5 py-3 text-center">
                        <CropIcon crop={c} size={24} />
                        <span className="text-xs">{tx(`crops.${c}`)}</span>
                      </Choice>
                    );
                  })}
                </div>
              </Field>
              {district && <p className="text-xs text-slate-500">{district.name}: {district.primaryCrops.map((c) => tx(`crops.${c}`, undefined, c)).join(", ")}</p>}
            </div>
          )}

          {step === 2 && (
            <StepFields
              d={d}
              setD={setD}
              error={errors.fields}
              center={district ? [district.lat, district.lon] : [23.2, 90.2]}
              onError={(m) => toast.error(m)}
            />
          )}

          {step === 3 && <StepRisk d={d} setD={setD} fallback={district ? { lat: district.lat, lon: district.lon } : null} />}

          {step === 4 && (
            <div className="space-y-5">
              <StepHead title={t("onboarding.notifyTitle")} desc={t("onboarding.notifyDesc")} />
              <div>
                <div className="mb-2 text-sm font-medium text-slate-300">{t("onboarding.whichAlerts")}</div>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["flood", t("profile.alertFlood")],
                      ["salinity", t("profile.alertSalinity")],
                      ["planting", t("profile.alertPlanting")],
                      ["weather", t("profile.alertWeather")],
                    ] as const
                  ).map(([k, l]) => {
                    const on = d.notifications.alertTypes.includes(k);
                    return (
                      <Choice key={k} on={on} onClick={() => setD({ ...d, notifications: { ...d.notifications, alertTypes: on ? d.notifications.alertTypes.filter((x) => x !== k) : [...d.notifications.alertTypes, k] } })}>
                        {l}
                      </Choice>
                    );
                  })}
                </div>
              </div>
              <div>
                <div className="mb-2 text-sm font-medium text-slate-300">{t("onboarding.channelsQuestion")}</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(
                    [
                      ["app", t("profile.channelApp")],
                      ["sms", t("profile.channelSms")],
                      ["whatsapp", t("profile.channelWhatsapp")],
                      ["email", t("profile.channelEmail")],
                    ] as const
                  ).map(([k, l]) => {
                    const on = d.notifications.channels.includes(k);
                    return (
                      <Choice key={k} on={on} onClick={() => setD({ ...d, notifications: { ...d.notifications, channels: on ? d.notifications.channels.filter((x) => x !== k) : [...d.notifications.channels, k] } })}>
                        {l}
                      </Choice>
                    );
                  })}
                </div>
                <AnimatePresence>
                  {d.notifications.channels.includes("whatsapp") && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden pt-3">
                      <Field label={t("onboarding.whatsappNumber")}>
                        <input className={inputCls} type="tel" value={d.notifications.whatsappNumber || d.personal.phone} onChange={(e) => setD({ ...d, notifications: { ...d.notifications, whatsappNumber: e.target.value } })} />
                      </Field>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="mb-2 text-sm font-medium text-slate-300">{t("onboarding.timingQuestion")}</div>
                  <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-900 p-1">
                    {(["immediate", "daily", "weekly"] as const).map((k) => (
                      <button key={k} type="button" onClick={() => setD({ ...d, notifications: { ...d.notifications, timing: k } })} className={cn("min-h-[44px] rounded-lg text-xs", d.notifications.timing === k ? "bg-emerald-500 font-semibold text-slate-950" : "text-slate-400")}>
                        {t(`profile.timing${k[0]!.toUpperCase()}${k.slice(1)}` as "profile.timingDaily")}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-sm font-medium text-slate-300">{t("onboarding.thresholdQuestion")}</div>
                  <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-900 p-1">
                    {(["low", "medium", "high"] as const).map((k) => (
                      <button key={k} type="button" onClick={() => setD({ ...d, notifications: { ...d.notifications, threshold: k } })} className={cn("min-h-[44px] rounded-lg text-xs", d.notifications.threshold === k ? "bg-amber-400 font-semibold text-slate-950" : "text-slate-400")}>
                        {t(`risk.${k}`)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </motion.section>
      </AnimatePresence>

      {/* nav */}
      <div className="fixed inset-x-0 bottom-0 z-[1000] border-t border-white/10 bg-[#060a16]/90 px-4 py-3 backdrop-blur-xl pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-3xl gap-3">
          <button type="button" onClick={() => go(step - 1)} disabled={step === 0} className="flex min-h-[48px] items-center gap-1.5 rounded-xl border border-slate-700 px-4 text-sm text-slate-300 disabled:opacity-30">
            <ArrowLeft size={16} /> {t("common.back")}
          </button>
          {step < 4 ? (
            <motion.button whileTap={{ scale: 0.97 }} type="button" onClick={() => go(step + 1)} className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 text-sm font-semibold text-slate-950 shadow-[0_0_24px_-6px_rgba(16,185,129,0.9)]">
              {t("common.continue")} <ArrowRight size={16} />
            </motion.button>
          ) : (
            <motion.button whileTap={{ scale: 0.97 }} type="button" onClick={submit} disabled={complete.isPending} className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 text-sm font-semibold text-slate-950 shadow-[0_0_24px_-6px_rgba(16,185,129,0.9)] disabled:opacity-70">
              {complete.isPending ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> {t("onboarding.submitting")}
                </>
              ) : (
                <>
                  <CheckCircle2 size={16} /> {t("common.finish")}
                </>
              )}
            </motion.button>
          )}
        </div>
      </div>
    </div>
  );
}

function StepHead({ title, desc }: { title: string; desc: string }) {
  return (
    <div>
      <h2 className="font-display text-xl font-semibold text-white">{title}</h2>
      <p className="mt-0.5 text-sm text-slate-400">{desc}</p>
    </div>
  );
}

function StepFields({ d, setD, error, center, onError }: { d: Draft; setD: (d: Draft) => void; error?: string; center: [number, number]; onError: (m: string) => void }) {
  const { t, tx, fmt } = useI18n();
  const [drawing, setDrawing] = useState<[number, number][]>([]);
  const [fly, setFly] = useState<{ lat: number; lon: number; zoom?: number } | null>(d.fields[0] ? { ...ringCentroid(d.fields[0].polygon), zoom: 16 } : null);
  const [locating, setLocating] = useState(false);
  const [manual, setManual] = useState(false);
  const [coords, setCoords] = useState("");
  const defaultCrop = d.farm.primaryCrops[0] ?? "rice";
  const drawArea = drawing.length >= 3 ? ringAreaHa(closeRing(drawing)) : 0;

  const addField = (polygon: [number, number][]) =>
    setD({
      ...d,
      fields: [...d.fields, { key: `f${Date.now()}`, name: t("onboarding.defaultFieldName", { n: d.fields.length + 1 }), cropType: defaultCrop, plantingDate: daysAgo(40), irrigationType: "rainfed", polygon }],
    });

  const finish = () => {
    if (drawing.length < 3) return;
    addField(drawing);
    setDrawing([]);
  };

  const locate = () => {
    if (!navigator.geolocation) return onError(t("onboarding.locationFailed"));
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude: lat, longitude: lon } = pos.coords;
        setFly({ lat, lon, zoom: 17 });
        addField(squareAround(lat, lon, 1).slice(0, -1) as [number, number][]);
      },
      () => {
        setLocating(false);
        onError(t("onboarding.locationFailed"));
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  };

  const fromCoords = () => {
    const pts = coords
      .split(/\n+/)
      .map((l) => l.split(/[,\s]+/).filter(Boolean).map(Number))
      .filter((p) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]!) <= 90 && Math.abs(p[1]!) <= 180)
      .map((p) => [p[1]!, p[0]!] as [number, number]);
    if (pts.length < 3) return onError(t("onboarding.invalidCoordinates"));
    addField(pts);
    setFly({ ...ringCentroid(pts), zoom: 16 });
    setCoords("");
    setManual(false);
  };

  const upd = (key: string, patch: Partial<FieldDraft>) => setD({ ...d, fields: d.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)) });

  return (
    <div className="space-y-4">
      <StepHead title={t("onboarding.fieldsTitle")} desc={t("onboarding.fieldsDesc")} />
      <div className="relative -mx-4 h-[52vh] min-h-[320px] overflow-hidden border-y border-white/10 sm:mx-0 sm:rounded-xl sm:border">
        <FieldDrawMap center={center} zoom={14} fields={d.fields.map((f) => ({ key: f.key, name: f.name, polygon: f.polygon }))} drawing={drawing} onAddPoint={(p) => setDrawing((cur) => [...cur, p])} flyTo={fly} />
        <div className="pointer-events-none absolute left-2 right-2 top-2 z-[500] flex justify-center">
          <div className="pointer-events-auto rounded-lg bg-[#060a16]/85 px-3 py-1.5 text-center text-xs text-slate-200 backdrop-blur">
            <Crosshair size={12} className="mr-1 inline text-amber-400" /> {t("onboarding.drawHint")}
          </div>
        </div>
        {drawing.length > 0 && (
          <div className="absolute bottom-3 left-1/2 z-[500] flex -translate-x-1/2 items-center gap-2 rounded-xl border border-white/10 bg-[#060a16]/90 p-1.5 backdrop-blur">
            <span className="px-2 text-[11px] telemetry text-amber-300">
              {t("onboarding.vertices", { count: drawing.length })}
              {drawArea > 0 && ` · ${fmt.number(drawArea, { maximumFractionDigits: 2 })} ha`}
            </span>
            <button type="button" onClick={() => setDrawing((c) => c.slice(0, -1))} className="flex min-h-[40px] items-center gap-1 rounded-lg px-2.5 text-xs text-slate-200 hover:bg-white/10" aria-label={t("onboarding.undo")}>
              <Undo2 size={14} /> {t("onboarding.undo")}
            </button>
            <button type="button" onClick={() => setDrawing([])} className="flex min-h-[40px] items-center rounded-lg px-2 text-xs text-slate-400 hover:bg-white/10" aria-label={t("onboarding.clearDrawing")}>
              <Trash2 size={14} />
            </button>
            <button type="button" onClick={finish} disabled={drawing.length < 3} className="flex min-h-[40px] items-center gap-1 rounded-lg bg-emerald-500 px-3 text-xs font-semibold text-slate-950 disabled:opacity-40">
              <Check size={14} /> {t("onboarding.finishField")}
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={locate} disabled={locating} className="flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-700 px-3.5 text-sm text-slate-200 hover:border-emerald-500/50">
          {locating ? <Loader2 size={15} className="animate-spin" /> : <LocateFixed size={15} className="text-emerald-400" />} {locating ? t("onboarding.locating") : `${t("onboarding.useLocation")} · ${t("onboarding.autoOutline")}`}
        </button>
        <button type="button" onClick={() => setManual((m) => !m)} className="flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-700 px-3.5 text-sm text-slate-200 hover:border-emerald-500/50" aria-expanded={manual}>
          <Keyboard size={15} className="text-cyan-400" /> {t("onboarding.manualEntry")}
        </button>
      </div>
      <AnimatePresence>
        {manual && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <Field label={t("onboarding.manualEntry")} hint={t("onboarding.manualHint")}>
              <textarea value={coords} onChange={(e) => setCoords(e.target.value)} rows={4} placeholder={"22.7011, 90.3637\n22.7020, 90.3650\n22.7008, 90.3662"} className={cn(inputCls, "py-2 telemetry text-sm")} />
            </Field>
            <button type="button" onClick={fromCoords} className="mt-2 min-h-[44px] rounded-xl bg-cyan-500/15 px-4 text-sm font-medium text-cyan-200">
              {t("onboarding.addFromCoordinates")}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {error && <p className="text-sm text-rose-400" role="alert">{error}</p>}
      {!d.fields.length ? (
        <p className="rounded-xl border border-dashed border-slate-700 p-4 text-center text-sm text-slate-500">{t("onboarding.noFields")}</p>
      ) : (
        <ul className="space-y-3">
          {d.fields.map((f, i) => (
            <motion.li key={f.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-slate-700/70 bg-slate-900/50 p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-500/15 text-xs font-semibold text-emerald-300 telemetry">{i + 1}</span>
                <input value={f.name} onChange={(e) => upd(f.key, { name: e.target.value })} className="min-h-[40px] flex-1 rounded-lg border border-transparent bg-transparent px-2 font-medium text-white hover:border-slate-700 focus:border-emerald-500/60 focus:outline-none" aria-label={t("onboarding.fieldName")} />
                <span className="telemetry text-xs text-emerald-300">{t("onboarding.fieldArea", { area: fmt.number(ringAreaHa(closeRing(f.polygon)), { maximumFractionDigits: 2 }) })}</span>
                <button type="button" onClick={() => setFly({ ...ringCentroid(f.polygon), zoom: 17 })} className="grid h-10 w-10 place-items-center rounded-lg text-slate-400 hover:bg-white/5" aria-label={t("fields.viewOnMap")}>
                  <MapPin size={15} />
                </button>
                <button type="button" onClick={() => setD({ ...d, fields: d.fields.filter((x) => x.key !== f.key) })} className="grid h-10 w-10 place-items-center rounded-lg text-slate-500 hover:bg-rose-500/10 hover:text-rose-400" aria-label={t("common.remove")}>
                  <Trash2 size={15} />
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <Field label={t("onboarding.fieldCrop")}>
                  <select className={cn(inputCls, "min-h-[44px] text-sm")} value={f.cropType} onChange={(e) => upd(f.key, { cropType: e.target.value as Crop })}>
                    {CROPS.map((c) => (
                      <option key={c} value={c}>
                        {tx(`crops.${c}`)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("onboarding.plantingDate")}>
                  <input type="date" max={new Date().toISOString().slice(0, 10)} className={cn(inputCls, "min-h-[44px] text-sm")} value={f.plantingDate} onChange={(e) => upd(f.key, { plantingDate: e.target.value || daysAgo(30) })} />
                </Field>
                <Field label={t("onboarding.irrigation")}>
                  <select className={cn(inputCls, "min-h-[44px] text-sm")} value={f.irrigationType} onChange={(e) => upd(f.key, { irrigationType: e.target.value as FieldDraft["irrigationType"] })}>
                    {IRRIGATION.map((c) => (
                      <option key={c} value={c}>
                        {tx(`irrigation.${c}`)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StepRisk({ d, setD, fallback }: { d: Draft; setD: (d: Draft) => void; fallback: { lat: number; lon: number } | null }) {
  const { t, fmt } = useI18n();
  const point = useMemo(() => (d.fields[0] ? ringCentroid(d.fields[0].polygon) : fallback), [d.fields, fallback]);
  const site = trpc.farmer.getSiteInfo.useQuery(point ?? { lat: 0, lon: 0 }, { enabled: !!point, staleTime: Infinity });
  const yn = (v: boolean | null, set: (b: boolean) => void) => (
    <div className="grid grid-cols-2 gap-2">
      <Choice on={v === true} onClick={() => set(true)}>{t("common.yes")}</Choice>
      <Choice on={v === false} onClick={() => set(false)}>{t("common.no")}</Choice>
    </div>
  );
  return (
    <div className="space-y-5">
      <StepHead title={t("onboarding.riskTitle")} desc={t("onboarding.riskDesc")} />
      <div>
        <div className="mb-2 text-sm font-medium text-slate-300">{t("onboarding.floodedBefore")}</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["never", t("onboarding.floodNever")],
              ["rarely", t("onboarding.floodRarely")],
              ["sometimes", t("onboarding.floodSometimes")],
              ["often", t("onboarding.floodOften")],
            ] as const
          ).map(([k, l]) => (
            <Choice key={k} on={d.risk.floodHistory === k} onClick={() => setD({ ...d, risk: { ...d.risk, floodHistory: k } })}>
              {l}
            </Choice>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-2 text-sm font-medium text-slate-300">{t("onboarding.saltyQuestion")}</div>
        {yn(d.risk.salinityObserved, (b) => setD({ ...d, risk: { ...d.risk, salinityObserved: b } }))}
      </div>
      <div>
        <div className="mb-2 text-sm font-medium text-slate-300">{t("onboarding.insuranceQuestion")}</div>
        {yn(d.risk.hasInsurance, (b) => setD({ ...d, risk: { ...d.risk, hasInsurance: b } }))}
      </div>
      <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="hud-label text-cyan-300/80">{t("onboarding.autoDetected")}</span>
          {site.data && <span className="text-[10px] telemetry text-slate-500">{site.data.district.name}, {site.data.district.countryName}</span>}
        </div>
        {site.isLoading ? (
          <div className="grid grid-cols-3 gap-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : site.data ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-slate-900/70 p-2.5">
                <Mountain size={14} className="text-cyan-400" />
                <div className="mt-1 text-[10px] text-slate-500">{t("onboarding.elevation")}</div>
                <div className="telemetry text-base font-semibold text-white">{site.data.elevationM != null ? `${fmt.number(site.data.elevationM, { maximumFractionDigits: 1 })} m` : "—"}</div>
              </div>
              <div className="rounded-lg bg-slate-900/70 p-2.5">
                <Waves size={14} className="text-sky-400" />
                <div className="mt-1 text-[10px] text-slate-500">{t("onboarding.coastDistance")}</div>
                <div className="telemetry text-base font-semibold text-white">~{fmt.number(site.data.coastKm, { maximumFractionDigits: 0 })} km</div>
                <div className="text-[9px] text-slate-600">{t("onboarding.estimated")}</div>
              </div>
              <div className="rounded-lg bg-slate-900/70 p-2.5">
                <Waves size={14} className="text-blue-400" />
                <div className="mt-1 text-[10px] text-slate-500">{t("onboarding.riverDistance")}</div>
                <div className="telemetry text-base font-semibold text-white">{site.data.river ? `${fmt.number(site.data.river.km, { maximumFractionDigits: 1 })} km` : "—"}</div>
                <div className="truncate text-[9px] text-slate-600">{site.data.river?.name ?? site.data.riverFallback}</div>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {site.data.elevationSource && <SourceTag>Copernicus DEM</SourceTag>}
              {site.data.river && <SourceTag>OpenStreetMap</SourceTag>}
              <SourceTag>Agri-SHIELD districts</SourceTag>
            </div>
          </>
        ) : (
          <p className="text-xs text-slate-500">{t("common.errorLoad")}</p>
        )}
      </div>
    </div>
  );
}

function Completion({ result, onOpen }: { result: RouterOutputs["farmer"]["completeOnboarding"]; onOpen: () => void }) {
  const { t, tx } = useI18n();
  const lvl = (v: number) => (v >= 80 ? "critical" : v >= 60 ? "high" : v >= 35 ? "medium" : "low");
  const P: Record<string, string> = { urgent: "#f87171", high: "#fb923c", medium: "#fbbf24", low: "#4ade80" };
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:py-16">
      <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 180, damping: 14 }} className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-emerald-500/15 ring-2 ring-emerald-400/60 shadow-[0_0_50px_-8px_rgba(16,185,129,0.9)]">
        <svg viewBox="0 0 24 24" className="h-10 w-10 text-emerald-300" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.3, duration: 0.6 }} />
        </svg>
      </motion.div>
      <h1 className="mt-6 text-center font-display text-3xl font-semibold text-white">{t("onboarding.completeTitle")}</h1>
      <p className="mt-2 text-center text-slate-400">{t("onboarding.completeSubtitle", { count: result.fields.length })}</p>

      <div className="hud-panel mt-8 p-5">
        <div className="hud-label mb-3">
          {t("onboarding.baselineRisk")} · {result.district.name}, {result.district.countryName}
        </div>
        <div className="flex justify-around">
          <RiskMeter value={result.baseline.flood} size="md" label={t("risk.flood")} levelLabel={tx(`risk.${lvl(result.baseline.flood)}`)} />
          <RiskMeter value={result.baseline.salinity} size="md" label={t("risk.salinity")} levelLabel={tx(`risk.${lvl(result.baseline.salinity)}`)} caption={`EC ${result.baseline.ec}`} />
        </div>
        <div className="mt-3 flex flex-wrap justify-center gap-1">
          <SourceTag>{result.baseline.elevationSource}</SourceTag>
          <SourceTag>NDVI: {result.baseline.ndviSource}</SourceTag>
        </div>
      </div>

      <h2 className="mb-3 mt-8 font-display text-lg font-semibold text-white">{t("onboarding.firstRecommendations")}</h2>
      <ul className="space-y-3">
        {result.recommendations.map((r, i) => (
          <motion.li key={r.id} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 + i * 0.15 }} className="hud-panel border-l-4 p-4" style={{ borderLeftColor: P[r.priority] }}>
            <div className="flex items-center gap-2 text-[10px] telemetry uppercase tracking-wider" style={{ color: P[r.priority] }}>
              {r.priority} · {r.fieldName}
            </div>
            <div className="mt-1 font-medium text-white">{r.title}</div>
            <p className="mt-1 text-sm text-slate-400">{r.description}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {r.actions.map((a) => (
                <span key={a} className="rounded-md bg-slate-900/80 px-2 py-1 text-[11px] text-slate-300">
                  {a}
                </span>
              ))}
            </div>
          </motion.li>
        ))}
      </ul>
      <motion.button whileTap={{ scale: 0.97 }} onClick={onOpen} className="mt-8 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 font-semibold text-slate-950 shadow-[0_0_30px_-6px_rgba(16,185,129,0.9)]">
        {t("onboarding.openDashboard")} <ArrowRight size={18} />
      </motion.button>
    </div>
  );
}
