"use client";

/**
 * Copilot conversation — shared by the full page (/app/copilot) and the
 * floating launcher panel. Answers are revealed progressively, artifacts
 * fade in after the text, and every answer can be copied or exported.
 */
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, Bot, Check, Copy, Cpu, Database, FileDown, Loader2, Mic, MicOff, RotateCcw, Sparkles, Trash2, User, Wrench } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { SourceTag } from "@/components/hud";
import { Markdown } from "./Markdown";
import { Artifacts, download } from "./Artifacts";
import type { Artifact, CopilotAnswer } from "@/server/services/copilot/types";

// ─── Progressive reveal ──────────────────────────────────────────────────

function useReveal(text: string, active: boolean, onDone?: () => void) {
  const [n, setN] = useState(active ? 0 : text.length);
  useEffect(() => {
    if (!active) {
      setN(text.length);
      return;
    }
    setN(0);
    const step = Math.max(6, Math.ceil(text.length / 60)); // ~1 s regardless of length
    const t = setInterval(() => {
      setN((v) => {
        const next = Math.min(text.length, v + step);
        if (next >= text.length) {
          clearInterval(t);
          onDone?.();
        }
        return next;
      });
    }, 16);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, active]);
  // don't cut inside a **bold** marker
  let cut = text.slice(0, n);
  if ((cut.match(/\*\*/g)?.length ?? 0) % 2 === 1) cut += "**";
  return { shown: cut, done: n >= text.length };
}

// ─── Export helpers ──────────────────────────────────────────────────────

function artifactMarkdown(a: Artifact): string {
  if (a.kind === "kpis") return a.items.map((k) => `- **${k.label}:** ${k.value}${k.sub ? ` (${k.sub})` : ""}`).join("\n");
  if (a.kind === "table") {
    const head = `| ${a.columns.map((c) => c.label).join(" | ")} |\n| ${a.columns.map((c) => (c.align === "right" ? "---:" : "---")).join(" | ")} |`;
    const body = a.rows.map((r) => `| ${a.columns.map((c) => String(r[c.key] ?? "—").replace(/\|/g, "/")).join(" | ")} |`).join("\n");
    return `**${a.title ?? "Table"}**\n\n${head}\n${body}`;
  }
  if (a.kind === "chart") return `**${a.title ?? "Chart"}** — ${a.series.map((s) => `${s.name}: ${s.data.map((d) => `${d.x}=${d.y ?? "—"}`).join(", ")}`).join("; ")}`;
  return `**${a.title ?? "Map"}** — ${a.markers.length} locations`;
}

function answerMarkdown(a: CopilotAnswer) {
  return [`## ${a.question}`, a.markdown, ...a.artifacts.filter((x) => x.kind !== "map").map(artifactMarkdown), `_Sources: ${a.sources.join("; ") || "—"} · generated ${a.createdAt.slice(0, 16).replace("T", " ")} UTC by Agri-SHIELD Copilot_`].join("\n\n");
}

// ─── One answer ──────────────────────────────────────────────────────────

function AnswerBubble({ a, animate, compact, onAsk }: { a: CopilotAnswer; animate: boolean; compact?: boolean; onAsk: (q: string) => void }) {
  const [textDone, setTextDone] = useState(!animate);
  const { shown } = useReveal(a.markdown, animate, () => setTextDone(true));
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(answerMarkdown(a));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Clipboard is not available in this browser");
    }
  };
  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10">
        <Bot size={14} className="text-cyan-300" />
      </div>
      <div className="min-w-0 flex-1">
        <div className={`rounded-xl rounded-tl-sm border border-slate-700/50 bg-slate-900/70 px-3.5 py-2.5 text-slate-300 ${compact ? "text-[12.5px]" : "text-[13.5px]"}`}>
          <Markdown text={shown} />
          {textDone && a.artifacts.length > 0 && <Artifacts items={a.artifacts} compact={compact} />}
          {textDone && a.actions.length > 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: animate ? 0.15 + a.artifacts.length * 0.12 : 0 }} className="mt-3 flex flex-wrap gap-1.5">
              {a.actions.map((x) => (
                <Link key={x.href + x.label} href={x.href} className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11.5px] font-medium text-emerald-200 hover:border-emerald-400/60 hover:bg-emerald-500/15">
                  {x.label} →
                </Link>
              ))}
            </motion.div>
          )}
        </div>
        {textDone && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[10.5px] text-slate-500">
            <span className="inline-flex items-center gap-1" title={a.toolsUsed.map((t) => `${t.tool}(${JSON.stringify(t.args)}) ${t.ms} ms`).join("\n")}>
              <Wrench size={10} /> {a.toolsUsed.length ? a.toolsUsed.map((t) => t.tool.replace(/_/g, " ")).join(", ") : "no tools"}
            </span>
            <span className="inline-flex items-center gap-1">
              <Cpu size={10} /> {a.planner === "rules" ? "intent router" : a.planner} · {(a.ms / 1000).toFixed(1)} s
            </span>
            {!compact && a.sources.slice(0, 3).map((s) => <SourceTag key={s}>{s}</SourceTag>)}
            <span className="ml-auto flex items-center gap-1">
              <button type="button" onClick={copy} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/5 hover:text-slate-300" aria-label="Copy answer">
                {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />} {copied ? "Copied" : "Copy"}
              </button>
              <button type="button" onClick={() => download(`copilot-${a.id}.md`, answerMarkdown(a), "text/markdown")} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/5 hover:text-slate-300" aria-label="Export answer as Markdown">
                <FileDown size={11} /> Export
              </button>
            </span>
          </div>
        )}
        {textDone && a.followUps.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5 px-1">
            {a.followUps.map((f) => (
              <button key={f} type="button" onClick={() => onAsk(f)} className="rounded-full border border-slate-700 bg-slate-900/60 px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-cyan-500/50 hover:text-white">
                {f}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function QuestionBubble({ q }: { q: string }) {
  return (
    <div className="flex justify-end gap-2.5">
      <div className="max-w-[85%] rounded-xl rounded-tr-sm border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-2 text-[13px] text-emerald-50">{q}</div>
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-800/70">
        <User size={13} className="text-slate-300" />
      </div>
    </div>
  );
}

const THINKING = ["Understanding your question", "Picking the right tools", "Querying your workspace & live feeds", "Composing the answer"];

function Thinking() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => Math.min(THINKING.length - 1, v + 1)), 900);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10">
        <Loader2 size={14} className="animate-spin text-cyan-300" />
      </div>
      <div className="rounded-xl rounded-tl-sm border border-slate-700/50 bg-slate-900/70 px-3.5 py-2.5 text-[12.5px] text-slate-400">
        {THINKING.map((s, k) => (
          <div key={s} className={`flex items-center gap-2 transition-opacity ${k > i ? "opacity-30" : ""}`}>
            {k < i ? <Check size={11} className="text-emerald-400" /> : k === i ? <Loader2 size={11} className="animate-spin text-cyan-300" /> : <span className="h-[11px] w-[11px]" />}
            {s}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Voice input (Web Speech API) ────────────────────────────────────────

type SpeechRec = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };

function useVoice(onText: (t: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const rec = useRef<SpeechRec | null>(null);
  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    setSupported(!!(w.SpeechRecognition ?? w.webkitSpeechRecognition));
  }, []);
  const toggle = useCallback(() => {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = navigator.language || "en-US";
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => onText(Array.from(e.results).map((x) => x[0]!.transcript).join(" "));
    r.onend = () => setListening(false);
    r.onerror = (e) => {
      setListening(false);
      if (e.error !== "aborted" && e.error !== "no-speech") toast.error(e.error === "not-allowed" ? "Microphone permission was denied" : `Voice input error: ${e.error}`);
    };
    rec.current = r;
    setListening(true);
    r.start();
  }, [listening, onText]);
  return { supported, listening, toggle };
}

// ─── Chat ─────────────────────────────────────────────────────────────────

export function CopilotChat({ variant = "page", initialQuestion }: { variant?: "page" | "panel"; initialQuestion?: string | null }) {
  const compact = variant === "panel";
  const utils = trpc.useUtils();
  const status = trpc.copilot.status.useQuery(undefined, { staleTime: 5 * 60_000 });
  const history = trpc.copilot.history.useQuery(undefined, { staleTime: 60_000 });
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [animateId, setAnimateId] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const asked = useRef(false);

  const ask = trpc.copilot.ask.useMutation({
    onSuccess: (a) => {
      utils.copilot.history.setData(undefined, (old) => [...(old ?? []), a]);
      setAnimateId(a.id);
      setPending(null);
    },
    onError: (e) => {
      setPending(null);
      toast.error(e.message || "Copilot could not answer");
    },
  });
  const clear = trpc.copilot.clearHistory.useMutation({
    onSuccess: () => {
      utils.copilot.history.setData(undefined, []);
      toast.success("Conversation cleared");
    },
  });

  const send = useCallback(
    (q?: string) => {
      const question = (q ?? input).trim();
      if (question.length < 2 || ask.isPending) return;
      setPending(question);
      setInput("");
      ask.mutate({ question });
    },
    [input, ask]
  );

  const voice = useVoice((t) => setInput(t));

  useEffect(() => {
    if (initialQuestion && !asked.current && history.isSuccess) {
      asked.current = true;
      send(initialQuestion);
    }
  }, [initialQuestion, history.isSuccess, send]);

  const answers = history.data ?? [];
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [answers.length, pending]);

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const starters = status.data?.starters ?? [];
  const planner = status.data?.planner;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scroller} className={`min-h-0 flex-1 space-y-4 overflow-y-auto ${compact ? "px-3 py-3" : "px-1 py-2 md:px-2"}`} aria-live="polite">
        {history.isLoading && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 size={14} className="animate-spin" /> Loading conversation…
          </div>
        )}
        {!history.isLoading && answers.length === 0 && !pending && (
          <div className={compact ? "pt-2" : "pt-6 md:pt-10"}>
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10">
                <Sparkles size={16} className="text-cyan-300" />
              </div>
              <div>
                <div className="font-display text-[15px] font-semibold text-white">Ask anything about your climate risk</div>
                <div className="text-[12px] text-slate-400">{status.data ? `Answers come only from ${status.data.orgName}'s data and live forecasts — with tables, maps and charts.` : "Answers come only from your workspace data and live forecasts."}</div>
              </div>
            </div>
            <div className={`mt-4 grid gap-2 ${compact ? "grid-cols-1" : "sm:grid-cols-2"}`}>
              {(starters.length ? starters : ["How is my portfolio doing today?", "What is the flood risk in Dhaka?", "Compare Khulna and Cà Mau", "What does EC mean?"]).map((s) => (
                <button key={s} type="button" onClick={() => send(s)} className="group rounded-lg border border-slate-700/60 bg-slate-900/50 px-3 py-2 text-left text-[12.5px] text-slate-300 transition hover:border-cyan-500/50 hover:bg-cyan-500/5 hover:text-white">
                  <span className="mr-1.5 text-cyan-400 group-hover:text-cyan-300">›</span>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {answers.map((a) => (
          <div key={a.id} className="space-y-2.5">
            <QuestionBubble q={a.question} />
            <AnswerBubble a={a} animate={a.id === animateId} compact={compact} onAsk={send} />
          </div>
        ))}
        <AnimatePresence>
          {pending && (
            <motion.div key="pending" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-2.5">
              <QuestionBubble q={pending} />
              <Thinking />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className={`border-t border-slate-800/80 ${compact ? "p-2.5" : "pt-3"}`}>
        <div className="flex items-end gap-2 rounded-xl border border-slate-700/70 bg-slate-900/70 px-2.5 py-2 focus-within:border-cyan-500/60">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            rows={1}
            maxLength={500}
            placeholder={voice.listening ? "Listening…" : "e.g. Which coastal plots have flood risk above 60%?"}
            aria-label="Ask Copilot"
            className="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent text-[13px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          {voice.supported && (
            <button type="button" onClick={voice.toggle} className={`rounded-lg p-1.5 ${voice.listening ? "bg-rose-500/20 text-rose-300" : "text-slate-400 hover:bg-white/5 hover:text-white"}`} aria-label={voice.listening ? "Stop voice input" : "Ask by voice"} title={voice.listening ? "Stop" : "Ask by voice"}>
              {voice.listening ? <MicOff size={15} /> : <Mic size={15} />}
            </button>
          )}
          <button type="button" onClick={() => send()} disabled={input.trim().length < 2 || ask.isPending} className="rounded-lg bg-cyan-500 p-1.5 text-slate-950 transition hover:bg-cyan-400 disabled:opacity-30" aria-label="Send question">
            {ask.isPending ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={15} />}
          </button>
        </div>
        <div className="mt-1.5 flex items-center gap-2 px-1 text-[10.5px] text-slate-500">
          <Database size={10} />
          <span className="truncate">
            {planner?.mode === "llm" ? `Planner: ${planner.provider} (${planner.model}) with function calling` : "Planner: deterministic intent router"} · answers only from tool outputs
          </span>
          {answers.length > 0 && (
            <button type="button" onClick={() => clear.mutate()} className="ml-auto inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/5 hover:text-slate-300" aria-label="Clear conversation">
              {compact ? <Trash2 size={11} /> : <RotateCcw size={11} />} Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
