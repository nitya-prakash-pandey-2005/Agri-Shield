"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, BookOpen, Check, Cpu, Loader2, Mic, MicOff, RotateCcw, Send, ShieldCheck, Sparkles, User } from "lucide-react";
import { toast } from "sonner";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { localeMeta } from "@/lib/i18n/config";
import { Skeleton, SourceTag, riskColor } from "@/components/hud";
import { Markdown } from "@/components/farmer/advisor/Markdown";
import { useSpeech } from "@/components/farmer/advisor/useSpeech";
import { CropIcon } from "@/components/farmer/crops";

type Answer = RouterOutputs["ml"]["askAdvisor"];
interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: number;
  meta?: Pick<Answer, "actions" | "sources" | "confidence" | "provider">;
  error?: boolean;
}

const URGENCY: Record<string, string> = { urgent: "#f87171", high: "#fb923c", medium: "#fbbf24", low: "#4ade80" };

export default function AdvisorPage() {
  const { t, locale, fmt } = useI18n();
  const ctxQ = trpc.farmer.getAdvisorContext.useQuery(undefined, { staleTime: 10 * 60_000 });
  const profile = trpc.farmer.getProfile.useQuery(undefined, { retry: false });
  const ask = trpc.ml.askAdvisor.useMutation();
  const log = trpc.farmer.logFarmerAction.useMutation();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [logged, setLogged] = useState<Record<string, boolean>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const storeKey = profile.data ? `agri_advisor_${profile.data.farmer.id}` : null;

  // restore conversation (sessionStorage)
  useEffect(() => {
    if (!storeKey) return;
    try {
      const raw = sessionStorage.getItem(storeKey);
      if (raw) setMsgs(JSON.parse(raw) as Msg[]);
    } catch {}
  }, [storeKey]);
  useEffect(() => {
    if (!storeKey) return;
    try {
      sessionStorage.setItem(storeKey, JSON.stringify(msgs.slice(-40)));
    } catch {}
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs, storeKey]);

  const send = async (q: string) => {
    const question = q.trim();
    if (question.length < 2 || !ctxQ.data || ask.isPending) return;
    setInput("");
    const user: Msg = { id: `u${Date.now()}`, role: "user", content: question, at: Date.now() };
    const history = msgs.filter((m) => !m.error).slice(-8).map((m) => ({ role: m.role, content: m.content.slice(0, 3900) }));
    setMsgs((m) => [...m, user]);
    try {
      const a = await ask.mutateAsync({ question, language: locale, history, context: ctxQ.data.context });
      setMsgs((m) => [...m, { id: `a${Date.now()}`, role: "assistant", content: a.answer, at: Date.now(), meta: { actions: a.actions, sources: a.sources, confidence: a.confidence, provider: a.provider } }]);
    } catch {
      setMsgs((m) => [...m, { id: `e${Date.now()}`, role: "assistant", content: t("advisor.errorAnswer"), at: Date.now(), error: true }]);
    }
  };

  const speech = useSpeech(localeMeta(locale).speech, (text) => {
    setInput(text);
    void send(text);
  });

  const doAction = (key: string, label: string) => {
    log.mutate(
      { actionTaken: `${label} (via AI Advisor)` },
      {
        onSuccess: () => {
          setLogged((l) => ({ ...l, [key]: true }));
          toast.success(t("advisor.actionLogged", { action: label }));
        },
        onError: (e) => toast.error(e.message),
      }
    );
  };

  const quick = [t("advisor.quickFlood"), t("advisor.quickPlant"), t("advisor.quickSalt"), t("advisor.quickIrrigate"), t("advisor.quickInsurance")];
  const d = ctxQ.data?.display;
  const name = ctxQ.data?.context.name.split(" ")[0] ?? "";
  const defaultActions = [
    { id: "flush", label: t("advisor.actionIrrigation"), description: "", urgency: "medium" },
    { id: "officer", label: t("advisor.actionOfficer"), description: "", urgency: "medium" },
    { id: "insurance", label: t("advisor.actionInsurance"), description: "", urgency: "low" },
  ];

  return (
    <div className="mx-auto flex h-[calc(100dvh-3.5rem-4rem-2.5rem)] max-w-5xl flex-col gap-3 lg:h-[calc(100vh-3.5rem-4rem)] lg:flex-row">
      {/* Context rail */}
      <aside className="shrink-0 lg:w-72">
        <div className="hud-panel p-3 lg:p-4">
          <div className="flex items-center gap-2.5">
            <span className="relative grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-emerald-400/30 to-cyan-500/20 ring-1 ring-emerald-400/40">
              <Bot size={20} className="text-emerald-300" />
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
            </span>
            <div className="min-w-0">
              <h1 className="font-display text-[15px] font-semibold leading-tight text-white">{t("advisor.title")}</h1>
              <p className="text-[11px] text-slate-400">{t("advisor.subtitle")}</p>
            </div>
          </div>
          <div className="hud-divider my-3 hidden lg:block" />
          <div className="mt-3 lg:mt-0">
            <div className="hud-label mb-2 hidden lg:block">{t("advisor.contextTitle")}</div>
            {d ? (
              <div className="flex gap-2 overflow-x-auto no-scrollbar lg:grid lg:grid-cols-2">
                <div className="shrink-0 rounded-lg bg-slate-900/70 px-2.5 py-1.5">
                  <div className="text-[9px] telemetry uppercase text-slate-500">{t("risk.flood")} 72h</div>
                  <div className="telemetry text-sm font-semibold" style={{ color: riskColor(d.floodPct) }}>{d.floodPct}%</div>
                </div>
                <div className="shrink-0 rounded-lg bg-slate-900/70 px-2.5 py-1.5">
                  <div className="text-[9px] telemetry uppercase text-slate-500">EC</div>
                  <div className="telemetry text-sm font-semibold text-amber-300">{fmt.number(d.ec, { maximumFractionDigits: 1 })} dS/m</div>
                </div>
                <div className="shrink-0 rounded-lg bg-slate-900/70 px-2.5 py-1.5">
                  <div className="text-[9px] telemetry uppercase text-slate-500">{t("home.rainNext72h")}</div>
                  <div className="telemetry text-sm font-semibold text-sky-300">{fmt.number(d.rain72, { maximumFractionDigits: 0 })} mm</div>
                </div>
                <div className="shrink-0 rounded-lg bg-slate-900/70 px-2.5 py-1.5">
                  <div className="text-[9px] telemetry uppercase text-slate-500">{t("home.myFields")}</div>
                  <div className="flex items-center gap-1 pt-0.5">
                    {Array.from(new Set(d.crops)).map((c) => <CropIcon key={c} crop={c} size={14} />)}
                    <span className="telemetry text-xs text-slate-300">×{d.fields}</span>
                  </div>
                </div>
              </div>
            ) : (
              <Skeleton className="h-14 w-full" />
            )}
            {d && (
              <div className="mt-2 hidden flex-wrap gap-1 lg:flex">
                <SourceTag>{d.floodSource === "ml-api" ? "ML API" : "Open-Meteo formula"}</SourceTag>
                {d.weatherSource && <SourceTag>{d.weatherSource}</SourceTag>}
              </div>
            )}
          </div>
          <button onClick={() => setMsgs([])} className="mt-3 hidden min-h-[40px] w-full items-center justify-center gap-1.5 rounded-lg border border-slate-700 text-xs text-slate-300 hover:border-emerald-500/40 lg:flex">
            <RotateCcw size={13} /> {t("advisor.newChat")}
          </button>
        </div>
      </aside>

      {/* Chat */}
      <section className="hud-panel flex min-h-0 flex-1 flex-col overflow-hidden" aria-label={t("advisor.title")}>
        <div ref={scroller} className="flex-1 space-y-4 overflow-y-auto p-3 sm:p-4" aria-live="polite">
          {/* welcome */}
          <div className="flex gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-500/15"><Sparkles size={15} className="text-emerald-300" /></span>
            <div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-white/5 bg-slate-900/80 px-3.5 py-2.5 text-sm text-slate-200">
              {d ? t("advisor.welcome", { name, flood: d.floodPct, ec: fmt.number(d.ec, { maximumFractionDigits: 1 }) }) : <Skeleton className="h-4 w-56" />}
            </div>
          </div>

          <AnimatePresence initial={false}>
            {msgs.map((m) => (
              <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn("flex gap-2.5", m.role === "user" && "flex-row-reverse")}>
                <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", m.role === "user" ? "bg-cyan-500/15" : "bg-emerald-500/15")}>
                  {m.role === "user" ? <User size={15} className="text-cyan-300" /> : <Bot size={15} className="text-emerald-300" />}
                </span>
                <div className={cn("min-w-0 max-w-[88%]", m.role === "user" && "text-right")}>
                  <div className={cn("inline-block rounded-2xl px-3.5 py-2.5 text-left text-sm", m.role === "user" ? "rounded-tr-sm bg-cyan-500/15 text-cyan-50" : m.error ? "rounded-tl-sm border border-rose-500/30 bg-rose-500/10 text-rose-200" : "rounded-tl-sm border border-white/5 bg-slate-900/80")}>
                    {m.role === "assistant" && !m.error ? <Markdown text={m.content} /> : <span className="whitespace-pre-wrap break-words">{m.content}</span>}
                  </div>
                  {m.meta && (
                    <div className="mt-2 space-y-2">
                      {/* action cards */}
                      <div className="grid gap-2 sm:grid-cols-3">
                        {(m.meta.actions.length ? m.meta.actions : defaultActions).slice(0, 3).map((a) => {
                          const key = `${m.id}:${a.id}`;
                          const done = logged[key];
                          return (
                            <motion.button
                              key={key}
                              whileTap={{ scale: 0.97 }}
                              whileHover={{ y: -2 }}
                              disabled={done || log.isPending}
                              onClick={() => doAction(key, a.label)}
                              className={cn("flex min-h-[64px] flex-col items-start rounded-xl border p-2.5 text-left transition-colors", done ? "border-emerald-500/40 bg-emerald-500/10" : "border-slate-700/80 bg-slate-900/60 hover:border-emerald-500/40")}
                            >
                              <span className="flex w-full items-center gap-1.5">
                                <span className="h-1.5 w-1.5 rounded-full" style={{ background: URGENCY[a.urgency] ?? "#94a3b8" }} />
                                <span className="text-[12.5px] font-medium leading-tight text-slate-100">{a.label}</span>
                                {done && <Check size={13} className="ml-auto text-emerald-400" />}
                              </span>
                              {a.description && <span className="mt-1 text-[11px] leading-snug text-slate-400">{a.description}</span>}
                              <span className="mt-auto pt-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">{done ? t("alerts.actioned") : t("advisor.logAction")}</span>
                            </motion.button>
                          );
                        })}
                      </div>
                      {m.meta.sources.length > 0 && (
                        <details className="rounded-lg border border-white/5 bg-slate-950/50 px-3 py-2 text-xs">
                          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-slate-400">
                            <BookOpen size={12} /> {t("advisor.sources")} ({m.meta.sources.length})
                          </summary>
                          <ul className="mt-2 space-y-1.5">
                            {m.meta.sources.map((s, i) => (
                              <li key={i}>
                                <div className="font-medium text-slate-200">{s.title}</div>
                                <div className="text-slate-500">{s.snippet}</div>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <SourceTag>
                          <Cpu size={9} /> {t("advisor.provider")}: {m.meta.provider}
                        </SourceTag>
                        <SourceTag>
                          <ShieldCheck size={9} /> {t("advisor.confidence", { pct: Math.round(m.meta.confidence * 100) })}
                        </SourceTag>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {ask.isPending && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2.5" role="status">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-500/15"><Bot size={15} className="text-emerald-300" /></span>
              <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-white/5 bg-slate-900/80 px-3.5 py-3">
                {[0, 1, 2].map((i) => (
                  <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-emerald-400" animate={{ opacity: [0.2, 1, 0.2], y: [0, -3, 0] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }} />
                ))}
                <span className="ml-1 text-xs text-slate-400">{t("advisor.thinking")}</span>
              </div>
            </motion.div>
          )}
        </div>

        {/* quick prompts */}
        {msgs.length < 2 && (
          <div className="flex gap-2 overflow-x-auto border-t border-white/5 px-3 py-2 no-scrollbar">
            {quick.map((q) => (
              <button key={q} onClick={() => send(q)} disabled={!ctxQ.data || ask.isPending} className="min-h-[40px] shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/5 px-3 text-xs text-emerald-200 hover:bg-emerald-500/15 disabled:opacity-40">
                {q}
              </button>
            ))}
          </div>
        )}

        {/* composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="flex items-end gap-2 border-t border-white/5 bg-slate-950/40 p-2.5"
        >
          <button
            type="button"
            onClick={() => {
              if (!speech.supported) return toast.message(t("advisor.voiceUnsupported"));
              if (speech.listening) speech.stop();
              else speech.start();
            }}
            className={cn("relative grid h-11 w-11 shrink-0 place-items-center rounded-xl border transition-colors", speech.listening ? "border-rose-500/60 bg-rose-500/15 text-rose-300" : "border-slate-700 text-slate-300 hover:text-emerald-300", !speech.supported && "opacity-50")}
            aria-label={speech.listening ? t("advisor.stopVoice") : t("advisor.voice")}
            title={speech.supported ? t("advisor.voice") : t("advisor.voiceUnsupported")}
          >
            {speech.listening && <span className="absolute inset-0 animate-ping rounded-xl border border-rose-500/50" />}
            {speech.supported ? <Mic size={18} /> : <MicOff size={18} />}
          </button>
          <div className="relative flex-1">
            <textarea
              value={speech.listening ? speech.interim || "" : input}
              onChange={(e) => setInput(e.target.value.slice(0, 1000))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={1}
              placeholder={speech.listening ? t("advisor.listening") : t("advisor.placeholder")}
              aria-label={t("advisor.placeholder")}
              className="max-h-32 min-h-[44px] w-full resize-none rounded-xl border border-slate-700 bg-slate-900/70 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500/60 focus:outline-none"
            />
          </div>
          <motion.button whileTap={{ scale: 0.95 }} type="submit" disabled={input.trim().length < 2 || ask.isPending || !ctxQ.data} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-500 text-slate-950 disabled:opacity-40" aria-label={t("advisor.send")}>
            {ask.isPending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </motion.button>
        </form>
      </section>
    </div>
  );
}
