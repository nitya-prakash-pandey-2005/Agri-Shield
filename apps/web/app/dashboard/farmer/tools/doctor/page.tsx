"use client";

/**
 * Crop Doctor — symptom wizard (crop → plant part → illustrated symptoms →
 * ranked likely causes with treatment, prevention and when to call an officer).
 * The knowledge base runs in the browser, so diagnosis works offline; farm
 * weather/salinity context (when online) re-weights the causes. Optional photo
 * is compressed and kept in the case history — photo AI is not enabled yet.
 */
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Camera, CheckCircle2, ClipboardList, Loader2, MessageCircleQuestion, PhoneCall, ShieldCheck, Stethoscope, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { HudButton, Meter, Panel, SourceTag } from "@/components/hud";
import { CropIcon } from "@/components/farmer/crops";
import { useTranslated } from "@/components/farmer/hooks";
import { Chip, TOOLS_BASE, ToolHeader, compressImage, fmtDay } from "@/components/farmer/tools/common";
import { PART_GLYPH, SymptomGlyph } from "@/components/farmer/tools/SymptomGlyph";
import { diagnose, symptomsFor, type Part } from "@/server/services/farm-doctor";

const DOCTOR_CROPS = ["rice", "jute", "wheat", "maize", "vegetables", "onion", "potato", "sugarcane", "mango", "coconut"];
const PARTS: Part[] = ["leaf", "stem", "root", "grain", "whole"];
const TYPE_COLOR: Record<string, string> = { disease: "#f87171", pest: "#fb923c", abiotic: "#38bdf8", nutrient: "#a3e635" };

export default function DoctorPage() {
  const { t, tx, fmt } = useI18n();
  const utils = trpc.useUtils();
  const profile = trpc.farmer.getProfile.useQuery(undefined, { retry: false, staleTime: 5 * 60_000 });
  const fields = trpc.farmer.getFields.useQuery(undefined, { staleTime: 5 * 60_000 });
  const ctxQ = trpc.farmer.doctorContext.useQuery(undefined, { staleTime: 30 * 60_000, retry: false });
  const cases = trpc.farmer.listDoctorCases.useQuery();
  const [step, setStep] = useState(0);
  const [crop, setCrop] = useState<string | null>(null);
  const [fieldId, setFieldId] = useState<string | null>(null);
  const [part, setPart] = useState<Part | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [photo, setPhoto] = useState<string | null>(null);
  const [busyPhoto, setBusyPhoto] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const own = useMemo(() => [...new Set((fields.data ?? []).map((f) => f.cropType as string))], [fields.data]);
  const crops = [...own, ...DOCTOR_CROPS.filter((c) => !own.includes(c))];
  const symptoms = crop ? symptomsFor(crop, part) : [];
  const results = crop && sel.length ? diagnose(crop, sel, ctxQ.data) : [];
  const tr = useTranslated(results.flatMap((r) => [r.cause.name, r.cause.summary, ...r.cause.treatment, ...r.cause.prevention, r.cause.callOfficer]));

  const save = trpc.farmer.saveDoctorCase.useMutation({
    onSuccess: () => {
      toast.success(t("tools.doc.saved"));
      void utils.farmer.listDoctorCases.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const upd = trpc.farmer.updateDoctorCase.useMutation({ onSuccess: () => void utils.farmer.listDoctorCases.invalidate() });

  const reset = () => {
    setStep(0);
    setCrop(null);
    setPart(null);
    setSel([]);
    setPhoto(null);
    setFieldId(null);
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusyPhoto(true);
    try {
      setPhoto(await compressImage(f));
    } catch {
      toast.error(t("tools.doc.photoError"));
    } finally {
      setBusyPhoto(false);
    }
  };

  const steps = [t("tools.doc.stepCrop"), t("tools.doc.stepPart"), t("tools.doc.stepSymptoms"), t("tools.doc.stepResult")];

  return (
    <div className="mx-auto max-w-5xl">
      <ToolHeader icon={Stethoscope} color="#f87171" title={t("tools.doc.title")} subtitle={t("tools.doc.subtitle")} />

      <ol className="mb-4 grid grid-cols-4 gap-2" aria-label={t("tools.doc.steps")}>
        {steps.map((s, i) => (
          <li key={s} className={cn("rounded-lg border px-2 py-1.5 text-center text-[11px]", i === step ? "border-rose-400/60 bg-rose-500/10 text-white" : i < step ? "border-emerald-500/30 text-emerald-300" : "border-white/5 text-slate-500")}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.2 }}>
          {step === 0 && (
            <Panel title={t("tools.doc.whichCrop")} icon={Stethoscope} accent="red">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {crops.map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      setCrop(c);
                      const f = (fields.data ?? []).find((x) => x.cropType === c);
                      setFieldId(f?.id ?? null);
                      setStep(1);
                    }}
                    className="flex min-h-[64px] items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-left text-sm text-white hover:border-rose-400/50 active:scale-[0.98]"
                  >
                    <CropIcon crop={c} size={24} />
                    <span>
                      {tx(`crops.${c}`, undefined, c)}
                      {own.includes(c) && <span className="block text-[10px] text-emerald-300">{t("tools.doc.yourCrop")}</span>}
                    </span>
                  </button>
                ))}
              </div>
            </Panel>
          )}

          {step === 1 && crop && (
            <Panel title={t("tools.doc.whichPart")} icon={Stethoscope} accent="red" actions={<BackBtn onClick={() => setStep(0)} />}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {PARTS.map((p) => (
                  <button key={p} onClick={() => { setPart(p); setSel([]); setStep(2); }} className="flex min-h-[96px] flex-col items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-2 text-sm text-white hover:border-rose-400/50 active:scale-[0.98]">
                    <SymptomGlyph glyph={PART_GLYPH[p]!} size={44} />
                    {tx(`tools.part.${p}`)}
                  </button>
                ))}
              </div>
            </Panel>
          )}

          {step === 2 && crop && (
            <Panel title={t("tools.doc.whatSee")} subtitle={t("tools.doc.pickAll")} icon={Stethoscope} accent="red" actions={<BackBtn onClick={() => setStep(1)} />}>
              {symptoms.length ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {symptoms.map((s) => {
                    const on = sel.includes(s.id);
                    return (
                      <button key={s.id} aria-pressed={on} onClick={() => setSel((x) => (on ? x.filter((y) => y !== s.id) : [...x, s.id]))} className={cn("flex min-h-[68px] items-center gap-3 rounded-xl border p-2 text-left text-sm transition-colors", on ? "border-rose-400/70 bg-rose-500/10 text-white" : "border-white/10 bg-white/[0.03] text-slate-200 hover:border-white/20")}>
                        <SymptomGlyph glyph={s.glyph} size={52} />
                        <span className="flex-1">{tx(`tools.sym.${s.id}`, undefined, s.label)}</span>
                        {on && <CheckCircle2 size={18} className="shrink-0 text-rose-300" />}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-slate-500">{t("tools.doc.noSymptoms")}</p>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
                <HudButton type="button" variant="outline" className="min-h-[48px]" onClick={() => fileRef.current?.click()} disabled={busyPhoto}>
                  {busyPhoto ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />} {photo ? t("tools.doc.retakePhoto") : t("tools.doc.addPhoto")}
                </HudButton>
                {photo && (
                  <span className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo} alt={t("tools.doc.photoAlt")} className="h-12 w-12 rounded-lg object-cover" />
                    <button onClick={() => setPhoto(null)} className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-slate-800 text-slate-300" aria-label={t("common.remove")}>
                      <X size={12} />
                    </button>
                  </span>
                )}
                <HudButton type="button" className="ml-auto min-h-[48px]" disabled={!sel.length} onClick={() => setStep(3)}>
                  {t("tools.doc.seeCauses")}
                </HudButton>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">{t("tools.doc.photoNote")}</p>
            </Panel>
          )}

          {step === 3 && crop && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <BackBtn onClick={() => setStep(2)} />
                {ctxQ.data && (
                  <div className="flex flex-wrap gap-1 text-[11px]">
                    {(["humid", "flood", "salinity", "dry", "hot"] as const).filter((k) => ctxQ.data![k]).map((k) => (
                      <span key={k} className="rounded bg-sky-500/15 px-2 py-0.5 text-sky-200">{tx(`tools.doc.ctx.${k}`)}</span>
                    ))}
                  </div>
                )}
              </div>
              {results.map((r, i) => (
                <motion.div key={r.cause.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="hud-panel p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase" style={{ background: `${TYPE_COLOR[r.cause.type]}22`, color: TYPE_COLOR[r.cause.type] }}>{tx(`tools.doc.type.${r.cause.type}`)}</span>
                        {i === 0 && <span className="text-[10px] text-rose-300">{t("tools.doc.mostLikely")}</span>}
                      </div>
                      <h3 className="mt-1 font-display text-base font-semibold text-white">{tr.get(r.cause.name) ?? r.cause.name}</h3>
                    </div>
                    <div className="w-24 text-right">
                      <div className="text-lg font-semibold text-white">{r.score}%</div>
                      <Meter value={r.score} color={i === 0 ? "#f87171" : "#64748b"} />
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-slate-300">{tr.get(r.cause.summary) ?? r.cause.summary}</p>
                  {i < 3 && (
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div>
                        <div className="hud-label mb-1 text-emerald-300">{t("tools.doc.treatment")}</div>
                        <ul className="space-y-1 text-sm text-slate-200">
                          {r.cause.treatment.map((x) => (
                            <li key={x} className="flex gap-2"><CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-400" /> {tr.get(x) ?? x}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <div className="hud-label mb-1 text-sky-300">{t("tools.doc.prevention")}</div>
                        <ul className="space-y-1 text-sm text-slate-300">
                          {r.cause.prevention.map((x) => (
                            <li key={x} className="flex gap-2"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-sky-400" /> {tr.get(x) ?? x}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                  <div className={cn("mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs", r.cause.urgency === "high" ? "bg-rose-500/10 text-rose-200" : "bg-white/[0.03] text-slate-300")}>
                    <PhoneCall size={14} className="mt-0.5 shrink-0" /> <span><b>{t("tools.doc.callOfficer")}:</b> {tr.get(r.cause.callOfficer) ?? r.cause.callOfficer}</span>
                  </div>
                  <div className="mt-2 text-[10px] text-slate-600">{r.cause.source}</div>
                </motion.div>
              ))}
              <div className="flex flex-wrap gap-2">
                <HudButton
                  className="min-h-[48px]"
                  disabled={save.isPending || !part}
                  onClick={() => save.mutate({ crop, part: part!, symptoms: sel, photo, fieldId })}
                >
                  {save.isPending ? <Loader2 size={16} className="animate-spin" /> : <ClipboardList size={16} />} {t("tools.doc.saveCase")}
                </HudButton>
                <Link href={`${TOOLS_BASE}/ask`} className="inline-flex min-h-[48px] items-center gap-2 rounded-lg border border-slate-700 px-3.5 text-sm text-slate-200 hover:border-emerald-500/50">
                  <MessageCircleQuestion size={16} /> {t("tools.doc.askOfficer")}
                </Link>
                <HudButton variant="ghost" className="min-h-[48px]" onClick={reset}>
                  {t("tools.doc.newCheck")}
                </HudButton>
              </div>
              <p className="text-[11px] text-slate-500">{t("tools.doc.disclaimer")}</p>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <Panel className="mt-6" title={t("tools.doc.history")} icon={ClipboardList} accent="violet" actions={<SourceTag>{t("tools.doc.cases", { count: cases.data?.length ?? 0 })}</SourceTag>}>
        {cases.data?.length ? (
          <ul className="space-y-2">
            {cases.data.map((c) => (
              <li key={c.id} className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-2">
                {c.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.photo} alt={t("tools.doc.photoAlt")} className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                ) : (
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-white/5"><CropIcon crop={c.crop} size={20} /></span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-white">{c.top?.name ?? "—"} <span className="text-slate-500">· {c.top?.score}%</span></div>
                  <div className="truncate text-[11px] text-slate-500">{tx(`crops.${c.crop}`, undefined, c.crop)} · {tx(`tools.part.${c.part}`)} · {fmtDay(fmt, c.createdAt.toISOString().slice(0, 10))}</div>
                </div>
                <select value={c.status} onChange={(e) => upd.mutate({ id: c.id, status: e.target.value as "open" | "treated" | "resolved" })} className="min-h-[40px] rounded-lg border border-white/10 bg-slate-900 px-2 text-xs text-white" aria-label={t("tools.doc.status")}>
                  {(["open", "treated", "resolved"] as const).map((s) => (
                    <option key={s} value={s}>{tx(`tools.doc.st.${s}`)}</option>
                  ))}
                </select>
                <button onClick={() => upd.mutate({ id: c.id, remove: true })} className="grid h-10 w-10 place-items-center rounded-lg text-slate-500 hover:text-rose-400" aria-label={t("common.remove")}>
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">{t("tools.doc.noCases")}</p>
        )}
        {profile.data?.isDemoFallback && <p className="mt-2 text-[11px] text-slate-500">{t("common.demoPreview")}</p>}
      </Panel>
    </div>
  );
}

function BackBtn({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <Chip active={false} onClick={onClick} className="min-h-[40px]">
      <ArrowLeft size={14} /> {t("common.back")}
    </Chip>
  );
}
