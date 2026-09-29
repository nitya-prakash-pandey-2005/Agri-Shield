"use client";

/**
 * Irrigation scheduler — FAO-56 soil water balance per field (upland) or the
 * AWD ponded-water balance (paddy rice), driven by Open-Meteo ET0 + rain.
 * Headline "Irrigate X mm on {day}" / "No irrigation needed — rain expected",
 * 7-day plan chart, AWD water-tube gauge, irrigation log.
 */
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CloudRain, Droplets, History, Loader2, Sprout, Trash2, Waves } from "lucide-react";
import { toast } from "sonner";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { EmptyState, HudButton, Panel, Skeleton, SourceTag } from "@/components/hud";
import { CropIcon } from "@/components/farmer/crops";
import { CachedNote, Chip, HelpTip, ToolHeader, fmtDay, useOfflineSnapshot } from "@/components/farmer/tools/common";

type Data = RouterOutputs["farmer"]["irrigationPlan"];
type FieldPlan = Data["fields"][number];

function Headline({ fp, today }: { fp: FieldPlan; today: string }) {
  const { t, tx, fmt } = useI18n();
  const p = fp.plan!;
  const n = p.next;
  let tone = "emerald";
  let title = "";
  let sub: string | null = null;
  if (n.kind === "irrigate") {
    tone = n.date === today ? "amber" : "sky";
    title = n.date === today ? t("tools.irr.irrigateToday", { mm: n.mm }) : t("tools.irr.irrigateOn", { mm: n.mm, day: fmtDay(fmt, n.date, { weekday: "long", day: "numeric", month: "short" }) });
    sub = t("tools.irr.volume", { m3: fmt.number(n.m3), hours: fmt.number(n.pumpHours, { maximumFractionDigits: 1 }) });
  } else if (n.kind === "rain") {
    title = t("tools.irr.rainExpected", { day: n.date ? fmtDay(fmt, n.date) : "", mm: fmt.number(n.rainMm, { maximumFractionDigits: 0 }) });
  } else if (n.kind === "drain") {
    tone = "amber";
    title = t("tools.irr.drainNow");
  } else if (n.kind === "stop") title = t("tools.irr.stop");
  else title = t("tools.irr.noneNeeded");
  if (!sub && p.beyond) sub = p.beyond.kind === "irrigate" ? t("tools.irr.beyondIrrigate", { day: fmtDay(fmt, p.beyond.date), mm: p.beyond.mm }) : t("tools.irr.beyondDrain", { day: fmtDay(fmt, p.beyond.date) });
  const colors: Record<string, string> = { emerald: "from-emerald-500/20 border-emerald-400/40", sky: "from-sky-500/20 border-sky-400/40", amber: "from-amber-500/25 border-amber-400/50" };
  const Icon = n.kind === "irrigate" ? Droplets : n.kind === "rain" ? CloudRain : n.kind === "drain" ? Waves : Sprout;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn("rounded-2xl border bg-gradient-to-br to-transparent p-4", colors[tone])} aria-live="polite">
      <div className="flex items-start gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/10">
          <Icon size={24} className="text-white" />
        </span>
        <div className="min-w-0">
          <div className="hud-label mb-0.5">{fp.field.name} · {tx(`crops.${fp.field.crop}`, undefined, fp.field.crop)}</div>
          <div className="font-display text-lg font-semibold leading-snug text-white md:text-xl">{title}</div>
          {sub && <div className="mt-1 text-sm text-slate-300">{sub}</div>}
          {fp.plan!.rainfed && n.kind === "irrigate" && <div className="mt-1 text-xs text-amber-200">{t("tools.irr.rainfedNote")}</div>}
        </div>
      </div>
    </motion.div>
  );
}

function AwdGauge({ level }: { level: number }) {
  const { t, fmt } = useI18n();
  // scale: +100 mm (top) … −250 mm (bottom)
  const top = 100;
  const bottom = -250;
  const y = (v: number) => ((top - Math.max(bottom, Math.min(top, v))) / (top - bottom)) * 100;
  const cm = Math.abs(level) / 10;
  return (
    <div className="flex items-stretch gap-3">
      <div className="relative h-44 w-16 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-slate-900 to-[#2a1d12]" aria-hidden>
        <div className="absolute inset-x-0 border-t border-dashed border-amber-200/60" style={{ top: `${y(0)}%` }} />
        <div className="absolute inset-x-0 border-t-2 border-rose-400/80" style={{ top: `${y(-150)}%` }} />
        <div className="absolute inset-x-0 border-t border-emerald-400/70" style={{ top: `${y(50)}%` }} />
        <motion.div className="absolute inset-x-2 bottom-0 rounded-t bg-sky-500/60" initial={{ height: 0 }} animate={{ height: `${100 - y(level)}%` }} transition={{ duration: 0.9 }} />
      </div>
      <div className="flex flex-col justify-between py-1 text-xs">
        <div className="text-emerald-300">+5 cm · {t("tools.irr.refillLine")}</div>
        <div className="text-amber-200">0 · {t("tools.irr.soilSurface")}</div>
        <div className="font-semibold text-white">{level >= 0 ? t("tools.irr.waterAbove", { cm: fmt.number(cm, { maximumFractionDigits: 1 }) }) : t("tools.irr.waterBelow", { cm: fmt.number(cm, { maximumFractionDigits: 1 }) })}</div>
        <div className="text-rose-300">−15 cm · {t("tools.irr.awdTrigger")}</div>
      </div>
    </div>
  );
}

function PlanChart({ fp, today }: { fp: FieldPlan; today: string }) {
  const { t, fmt } = useI18n();
  const p = fp.plan!;
  const paddy = p.mode === "paddy";
  const rows = p.days
    .filter((d) => d.date >= addDays(today, -6))
    .map((d) => ({
      day: fmtDay(fmt, d.date, { weekday: "short", day: "numeric" }),
      date: d.date,
      etc: d.etc,
      rain: d.effRain,
      irr: d.irrigationMm,
      level: paddy ? d.level / 10 : d.level,
      forecast: d.forecast,
    }));
  const todayLabel = rows.find((r) => r.date === today)?.day;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="#1e293b" vertical={false} />
          <XAxis dataKey="day" tick={{ fill: "#94a3b8", fontSize: 10 }} interval={0} angle={-35} textAnchor="end" height={42} />
          <YAxis yAxisId="mm" tick={{ fill: "#94a3b8", fontSize: 10 }} />
          <YAxis yAxisId="lv" orientation="right" tick={{ fill: "#94a3b8", fontSize: 10 }} reversed={!paddy} width={36} domain={paddy ? [(min: number) => Math.floor(Math.min(min, -16)), (max: number) => Math.ceil(Math.max(max, 6))] : [0, (max: number) => Math.ceil(Math.max(max, (p.raw ?? 0) * 1.1))]} />
          <Tooltip contentStyle={{ background: "#0b1224", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 12 }} labelStyle={{ color: "#fff" }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {todayLabel && <ReferenceLine yAxisId="mm" x={todayLabel} stroke="#10b981" strokeDasharray="3 3" label={{ value: t("common.today"), fill: "#10b981", fontSize: 10, position: "insideTopLeft" }} />}
          <Bar yAxisId="mm" dataKey="etc" name={t("tools.irr.cropUse")} fill="#f59e0b" radius={[3, 3, 0, 0]} maxBarSize={14} />
          <Bar yAxisId="mm" dataKey="rain" name={t("tools.irr.usefulRain")} fill="#38bdf8" radius={[3, 3, 0, 0]} maxBarSize={14} />
          <Bar yAxisId="mm" dataKey="irr" name={t("tools.irr.irrigation")} fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={14} />
          {paddy && <ReferenceLine yAxisId="lv" y={-15} stroke="#f87171" strokeDasharray="4 3" />}
          {paddy && <ReferenceLine yAxisId="lv" y={0} stroke="#fcd34d" strokeDasharray="2 3" />}
          {!paddy && <ReferenceLine yAxisId="lv" y={p.raw ?? 0} stroke="#f87171" strokeDasharray="4 3" />}
          <Line yAxisId="lv" type="monotone" dataKey="level" name={paddy ? t("tools.irr.waterLevelCm") : t("tools.irr.dryness")} stroke="#e2e8f0" strokeWidth={2} dot={{ r: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function LogForm({ fp, today }: { fp: FieldPlan; today: string }) {
  const { t, fmt } = useI18n();
  const utils = trpc.useUtils();
  const [date, setDate] = useState(today);
  const [mm, setMm] = useState(50);
  const [note, setNote] = useState("");
  useEffect(() => setDate(today), [today]);
  const log = trpc.farmer.logIrrigation.useMutation({
    onSuccess: (r) => {
      toast.success(t("tools.irr.logged", { mm: r.mm }));
      setNote("");
      void utils.farmer.irrigationPlan.invalidate();
      void utils.farmer.todayActions.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.farmer.deleteIrrigationLog.useMutation({ onSuccess: () => void utils.farmer.irrigationPlan.invalidate() });
  return (
    <Panel title={t("tools.irr.logTitle")} icon={History} accent="emerald">
      <form
        className="grid gap-3 sm:grid-cols-[1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          log.mutate({ fieldId: fp.field.id, date, mm, note: note || undefined });
        }}
      >
        <div className="grid gap-3">
          <label className="grid gap-1 text-xs text-slate-400">
            {t("tools.irr.date")}
            <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className="min-h-[44px] rounded-lg border border-white/10 bg-slate-900 px-3 text-sm text-white" required />
          </label>
          <div className="grid gap-1 text-xs text-slate-400">
            {t("tools.irr.amountMm")}
            <div className="flex flex-wrap gap-2">
              {[25, 50, 75, 100].map((v) => (
                <Chip key={v} active={mm === v} onClick={() => setMm(v)}>
                  {v} mm
                </Chip>
              ))}
              <input type="number" min={1} max={300} value={mm} onChange={(e) => setMm(Number(e.target.value))} className="min-h-[44px] w-24 rounded-lg border border-white/10 bg-slate-900 px-3 text-sm text-white" aria-label={t("tools.irr.amountMm")} />
            </div>
            <span className="text-[11px] text-slate-500">{t("tools.irr.mmHint", { m3: fmt.number(Math.round(mm * fp.field.areaHa * 10)) })}</span>
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder={t("tools.noteOptional")} className="min-h-[44px] rounded-lg border border-white/10 bg-slate-900 px-3 text-sm text-white placeholder:text-slate-600" />
        </div>
        <HudButton type="submit" disabled={log.isPending} className="min-h-[48px] self-end">
          {log.isPending ? <Loader2 size={16} className="animate-spin" /> : <Droplets size={16} />} {t("tools.irr.logButton")}
        </HudButton>
      </form>
      <div className="mt-4">
        <div className="hud-label mb-2">{t("tools.irr.recent")}</div>
        {fp.logs.length ? (
          <ul className="divide-y divide-white/5">
            {fp.logs.map((l) => (
              <li key={l.id} className="flex min-h-[44px] items-center gap-3 text-sm">
                <span className="w-28 text-slate-400">{fmtDay(fmt, l.date)}</span>
                <span className="font-semibold text-white">{l.mm} mm</span>
                <span className="min-w-0 flex-1 truncate text-slate-500">{l.note}</span>
                <button onClick={() => del.mutate({ id: l.id })} className="grid h-10 w-10 place-items-center rounded-lg text-slate-500 hover:text-rose-400" aria-label={t("common.remove")}>
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">{t("tools.irr.noLogs")}</p>
        )}
      </div>
    </Panel>
  );
}

export default function IrrigationPage() {
  const { t, tx, fmt } = useI18n();
  const q = trpc.farmer.irrigationPlan.useQuery(undefined, { staleTime: 10 * 60_000 });
  const snap = useOfflineSnapshot("irrigation", q.data);
  const data = snap.data;
  const [sel, setSel] = useState<string | null>(null);
  const fields = useMemo(() => (data?.fields ?? []).filter((f) => f.plan), [data]);
  const fp = fields.find((f) => f.field.id === sel) ?? fields[0];

  return (
    <div className="mx-auto max-w-5xl">
      <ToolHeader icon={Droplets} color="#38bdf8" title={t("tools.irr.title")} subtitle={t("tools.irr.subtitle")} />
      {snap.fromCache && <CachedNote savedAt={snap.savedAt} />}
      {q.isLoading && !data ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : !fp ? (
        <EmptyState icon={Droplets} title={data && !data.available ? t("tools.weatherUnavailable") : t("tools.irr.noFields")}>
          {t("tools.tryAgainLater")}
        </EmptyState>
      ) : (
        <div className="space-y-4">
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1" role="tablist">
            {fields.map((f) => (
              <Chip key={f.field.id} active={f.field.id === fp.field.id} onClick={() => setSel(f.field.id)}>
                <CropIcon crop={f.field.crop} size={16} /> {f.field.name}
                {f.plan!.next.kind === "irrigate" && <span className="h-2 w-2 rounded-full bg-amber-400" aria-label={t("tools.irr.dueSoon")} />}
              </Chip>
            ))}
          </div>

          <Headline fp={fp} today={data!.today} />

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { label: t("tools.irr.et0"), value: fp.plan!.et0Today != null ? `${fmt.number(fp.plan!.et0Today, { maximumFractionDigits: 1 })} mm` : "—", help: t("tools.irr.et0Help") },
              { label: t("tools.irr.etc"), value: fp.plan!.etcToday != null ? `${fmt.number(fp.plan!.etcToday, { maximumFractionDigits: 1 })} mm` : "—", help: t("tools.irr.etcHelp") },
              { label: t("tools.irr.kc"), value: `${fmt.number(fp.plan!.kcToday, { maximumFractionDigits: 2 })} · ${tx(`tools.stage.${fp.plan!.stage}`)}`, help: t("tools.irr.kcHelp", { days: fp.plan!.dap }) },
              fp.plan!.mode === "paddy"
                ? { label: t("tools.irr.rain7"), value: `${fmt.number(fp.plan!.totals.rainNext7, { maximumFractionDigits: 0 })} mm`, help: t("tools.irr.rain7Help") }
                : { label: t("tools.irr.soilHolds"), value: `${fmt.number(fp.plan!.taw ?? 0, { maximumFractionDigits: 0 })} mm`, help: t("tools.irr.tawHelp", { raw: fmt.number(fp.plan!.raw ?? 0, { maximumFractionDigits: 0 }), depth: fmt.number(fp.plan!.rootDepthM ?? 0, { maximumFractionDigits: 2 }) }) },
            ].map((s) => (
              <div key={s.label} className="hud-panel p-3">
                <div className="flex items-center justify-between">
                  <span className="hud-label">{s.label}</span>
                  <HelpTip title={s.label}>{s.help}</HelpTip>
                </div>
                <div className="mt-1 text-lg font-semibold text-white">{s.value}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel
              className="lg:col-span-2"
              title={t("tools.irr.planTitle")}
              subtitle={fp.plan!.mode === "paddy" ? t("tools.irr.planPaddyHint") : t("tools.irr.planUplandHint")}
              icon={CloudRain}
              accent="cyan"
              actions={<SourceTag href="https://open-meteo.com">Open-Meteo · FAO-56</SourceTag>}
            >
              <PlanChart fp={fp} today={data!.today} />
              <div className="mt-3 -mx-1 overflow-x-auto no-scrollbar">
                <table className="w-full min-w-[520px] text-xs">
                  <thead className="text-slate-500">
                    <tr className="text-left">
                      <th className="px-1 py-1 font-normal">{t("tools.irr.date")}</th>
                      <th className="px-1 font-normal">{t("tools.irr.todo")}</th>
                      <th className="px-1 font-normal">{t("tools.irr.cropUse")}</th>
                      <th className="px-1 font-normal">{t("tools.irr.rainCol")}</th>
                      <th className="px-1 font-normal">ET₀</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fp.plan!.days
                      .filter((d) => d.forecast)
                      .slice(0, 7)
                      .map((d) => (
                        <tr key={d.date} className={cn("border-t border-white/5", d.action === "irrigate" && "bg-sky-500/10")}>
                          <td className="px-1 py-2 text-slate-300">{fmtDay(fmt, d.date)}</td>
                          <td className="px-1 font-medium text-white">{d.action === "irrigate" ? t("tools.irr.doIrrigate", { mm: Math.round(d.irrigationMm) }) : tx(`tools.irr.action.${d.action}`)}</td>
                          <td className="px-1 telemetry">{d.etc}</td>
                          <td className="px-1 telemetry">
                            {d.rainMm}
                            {d.rainProb != null && <span className="text-slate-500"> ({d.rainProb}%)</span>}
                          </td>
                          <td className="px-1 telemetry">{d.et0}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <div className="space-y-4">
              {fp.plan!.awd && (
                <Panel title={t("tools.irr.awdTitle")} icon={Waves} accent="cyan" actions={<HelpTip title={t("tools.irr.awdTitle")}>{t("tools.irr.awdHelp")}</HelpTip>}>
                  <AwdGauge level={fp.plan!.awd.waterLevelMm} />
                  <p className="mt-3 text-sm leading-relaxed text-slate-300">{tx(`tools.irr.awd.${fp.plan!.awd.phase}`)}</p>
                  <p className="mt-2 text-[11px] text-slate-500">{t("tools.irr.awdTube")}</p>
                </Panel>
              )}
              <Panel title={t("tools.howItWorks")} icon={Sprout} accent="violet">
                <p className="text-xs leading-relaxed text-slate-400">{fp.plan!.mode === "paddy" ? t("tools.irr.methodPaddy") : t("tools.irr.methodUpland")}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  <SourceTag>{fp.plan!.source}</SourceTag>
                  <SourceTag>{data!.source ?? "Open-Meteo"}</SourceTag>
                </div>
              </Panel>
            </div>
          </div>

          <LogForm fp={fp} today={data!.today} />
        </div>
      )}
    </div>
  );
}
