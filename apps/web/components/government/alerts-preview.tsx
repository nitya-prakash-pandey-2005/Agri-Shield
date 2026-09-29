"use client";

/**
 * Multi-channel alert preview: phone-frame mockups of exactly what each
 * channel renders (App push, SMS, WhatsApp card, officer Email), in English
 * or translated to the district language — rendered by the server's
 * previewAlert (same renderers broadcastAlert uses).
 */
import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, ChevronLeft, Languages, Mail, MessageCircle, MessageSquare, Phone, Shield, Smartphone, Video } from "lucide-react";
import { trpc, type RouterInputs, type RouterOutputs } from "@/lib/trpc";
import { Panel, Skeleton, SourceTag } from "@/components/hud";
import { cn } from "@/lib/utils";
import { ErrorNote, Segmented } from "./ui";

type PreviewInput = RouterInputs["government"]["previewAlert"];
type Rendered = RouterOutputs["government"]["previewAlert"]["english"];

const LANG_NAME: Record<string, string> = { en: "English", hi: "Hindi", bn: "Bengali", vi: "Vietnamese", fil: "Filipino", id: "Bahasa Indonesia", ta: "Tamil", si: "Sinhala" };
const PROVIDER_LABEL: Record<string, string> = { deepl: "DeepL", mymemory: "MyMemory", none: "No translation", timeout: "Timed out" };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Debounced previewAlert query shared by the preview panel and the channel step (audience). */
export function useAlertPreview(input: PreviewInput | null) {
  const key = JSON.stringify(input);
  const debouncedKey = useDebounced(key, 600);
  const parsed = debouncedKey && debouncedKey !== "null" ? (JSON.parse(debouncedKey) as PreviewInput) : null;
  const ok = !!parsed && parsed.title.trim().length >= 3 && parsed.description.trim().length >= 3;
  const q = trpc.government.previewAlert.useQuery(parsed ?? ({} as PreviewInput), { enabled: ok, placeholderData: (prev) => prev, staleTime: 5 * 60_000 });
  return { ...q, stale: key !== debouncedKey, enabled: ok };
}

function PhoneFrame({ children, label, icon: Icon, dark = true }: { children: ReactNode; label: string; icon: typeof Bell; dark?: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <div className="hud-label mb-2 flex items-center gap-1.5">
        <Icon size={11} className="text-emerald-400" /> {label}
      </div>
      {/* theme-island: a phone mock-up looks like a phone in every app theme */}
      <div className="theme-island relative w-full max-w-[260px] rounded-[30px] border border-slate-700/70 bg-slate-950 p-2 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)]">
        <div className="absolute left-1/2 top-3 z-10 h-4 w-20 -translate-x-1/2 rounded-full bg-black" />
        <div className={cn("relative h-[430px] overflow-hidden rounded-[24px]", dark ? "bg-slate-900" : "bg-white")}>{children}</div>
      </div>
    </div>
  );
}

function StatusBar({ light }: { light?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between px-5 pt-2.5 text-[10px] font-semibold", light ? "text-slate-900" : "text-white")}>
      <span className="telemetry">09:41</span>
      <span className="telemetry">4G ▮▮▮</span>
    </div>
  );
}

function AppPush({ r }: { r: Rendered }) {
  return (
    <PhoneFrame label="App push" icon={Smartphone}>
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_0%,#064e3b_0%,#0b1120_55%,#020617_100%)]" />
      <div className="relative">
        <StatusBar />
        <div className="mt-8 text-center">
          <div className="telemetry text-5xl font-light text-white">09:41</div>
          <div className="mt-1 text-[11px] text-slate-300">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</div>
        </div>
        <motion.div initial={{ y: -12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 300, damping: 24 }} className="mx-3 mt-8 rounded-2xl bg-white/15 p-3 backdrop-blur-xl">
          <div className="flex items-center gap-2">
            <span className="grid h-5 w-5 place-items-center rounded-md bg-emerald-500">
              <Shield size={11} className="text-slate-950" />
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-200">Agri-SHIELD</span>
            <span className="ml-auto text-[10px] text-slate-300">now</span>
          </div>
          <div className="mt-1.5 text-[12px] font-semibold leading-snug text-white">{r.app.title}</div>
          <div className="mt-0.5 text-[11.5px] leading-snug text-slate-200">{r.app.body}</div>
        </motion.div>
      </div>
    </PhoneFrame>
  );
}

function Sms({ r }: { r: Rendered }) {
  return (
    <PhoneFrame label="SMS" icon={MessageSquare}>
      <StatusBar />
      <div className="flex items-center gap-2 border-b border-white/5 px-3 pb-2 pt-2">
        <ChevronLeft size={16} className="text-sky-400" />
        <div className="grid h-7 w-7 place-items-center rounded-full bg-slate-700 text-[10px] font-semibold text-white">AS</div>
        <div className="leading-tight">
          <div className="text-[12px] font-semibold text-white">AGRISHIELD</div>
          <div className="text-[9.5px] text-slate-400">Text message</div>
        </div>
      </div>
      <div className="p-3">
        <div className="mb-1 text-center text-[9.5px] text-slate-500">Today 09:41</div>
        <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm bg-slate-700/80 px-3 py-2 text-[11.5px] leading-snug text-slate-100">{r.sms.text}</div>
        <div className="mt-3 rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 telemetry text-[10px] text-slate-300">
          <div className="flex justify-between">
            <span>{r.sms.encoding}</span>
            <span>{r.sms.chars} chars</span>
          </div>
          <div className="mt-1 flex justify-between">
            <span className={r.sms.segments > 2 ? "text-amber-300" : "text-emerald-300"}>
              {r.sms.segments} segment{r.sms.segments > 1 ? "s" : ""}
            </span>
            <span className="text-slate-500">{r.sms.perSegment}/segment</span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded bg-slate-800">
            <div className="h-full bg-emerald-400" style={{ width: `${Math.min(100, ((r.sms.chars % r.sms.perSegment || r.sms.perSegment) / r.sms.perSegment) * 100)}%` }} />
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}

function WhatsApp({ r }: { r: Rendered }) {
  const w = r.whatsapp;
  return (
    <PhoneFrame label="WhatsApp" icon={MessageCircle}>
      <div className="bg-[#075e54]">
        <StatusBar />
        <div className="flex items-center gap-2 px-3 pb-2.5 pt-2">
          <ChevronLeft size={16} className="text-white" />
          <div className="grid h-7 w-7 place-items-center rounded-full bg-emerald-300">
            <Shield size={13} className="text-[#075e54]" />
          </div>
          <div className="leading-tight">
            <div className="text-[12px] font-semibold text-white">Agri-SHIELD Alerts</div>
            <div className="text-[9.5px] text-emerald-100">Verified business</div>
          </div>
          <Video size={14} className="ml-auto text-white" />
          <Phone size={13} className="text-white" />
        </div>
      </div>
      <div className="h-full bg-[#0b141a] p-2.5">
        <div className="max-w-[92%] overflow-hidden rounded-lg rounded-tl-none bg-[#202c33] text-[11px] leading-snug text-slate-100">
          <div className="bg-[#2a3942] px-2.5 py-1.5 text-[10px] font-bold tracking-wider text-amber-300">{w.header}</div>
          <div className="px-2.5 pt-2 font-semibold text-white">{w.title}</div>
          <div className="px-2.5 pt-1 text-slate-200 line-clamp-5">{w.body}</div>
          <ol className="space-y-0.5 px-2.5 pt-1.5 text-slate-100">
            {w.actions.map((a, i) => (
              <li key={i}>
                <span className="telemetry text-emerald-300">{i + 1}.</span> {a}
              </li>
            ))}
          </ol>
          <div className="px-2.5 pb-1.5 pt-1.5 text-[9.5px] italic text-slate-400">{w.footer}</div>
        </div>
        <div className="mt-1 max-w-[92%] space-y-1">
          {w.buttons.map((b) => (
            <div key={b} className="rounded-lg bg-[#202c33] py-1.5 text-center text-[11px] font-medium text-sky-400">
              {b}
            </div>
          ))}
        </div>
      </div>
    </PhoneFrame>
  );
}

function Email({ r }: { r: Rendered }) {
  return (
    <PhoneFrame label="Email (officers)" icon={Mail}>
      <StatusBar />
      <div className="border-b border-white/5 px-3 pb-2 pt-2">
        <div className="text-[9.5px] text-slate-500">From: Agri-SHIELD Alerts</div>
        <div className="mt-0.5 text-[11.5px] font-semibold leading-snug text-white">{r.email.subject}</div>
      </div>
      {/* Server-rendered, HTML-escaped email body (CSP forbids frames, so render in a scoped container). */}
      <div className="h-[360px] w-full overflow-auto bg-[#0b1120] [&_table]:!w-full [&_td]:!p-2" dangerouslySetInnerHTML={{ __html: r.email.html }} />
    </PhoneFrame>
  );
}

export function AlertPreviewPanel({ input }: { input: PreviewInput | null }) {
  const [translate, setTranslate] = useState(true);
  const [lang, setLang] = useState<"en" | "tr">("en");
  const [channel, setChannel] = useState<"app" | "sms" | "whatsapp" | "email">("sms");
  const q = useAlertPreview(input ? { ...input, translate } : null);
  const tr = q.data?.translated;
  const r = lang === "tr" && tr ? tr : q.data?.english;
  const fellBack = tr && (tr.provider === "none" || tr.provider === "timeout");

  return (
    <Panel
      title="Multi-channel preview"
      subtitle="Exactly what recipients will see"
      icon={Smartphone}
      accent="emerald"
      actions={q.isFetching || q.stale ? <span className="telemetry text-[10px] text-slate-500 animate-pulse">RENDERING</span> : <SourceTag>previewAlert</SourceTag>}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          size="xs"
          layoutId="preview-channel"
          value={channel}
          onChange={setChannel}
          options={[
            { value: "app", label: "App" },
            { value: "sms", label: "SMS" },
            { value: "whatsapp", label: "WhatsApp" },
            { value: "email", label: "Email" },
          ]}
        />
        <Segmented
          size="xs"
          layoutId="preview-lang"
          value={lang}
          onChange={setLang}
          options={[
            { value: "en", label: "English" },
            { value: "tr", label: q.data ? LANG_NAME[q.data.languageOfDistricts] ?? q.data.languageOfDistricts : "Local" },
          ]}
        />
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[10.5px] text-slate-400">
          <input type="checkbox" checked={translate} onChange={(e) => setTranslate(e.target.checked)} className="accent-emerald-500" />
          <Languages size={12} /> Translate
        </label>
      </div>
      {lang === "tr" && tr && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
          <SourceTag>{PROVIDER_LABEL[tr.provider] ?? tr.provider}</SourceTag>
          <span>{LANG_NAME[tr.language] ?? tr.language}</span>
          {fellBack && <span className="text-amber-300">Translation service unavailable — recipients receive the English text.</span>}
        </div>
      )}
      {lang === "tr" && !tr && q.data && <div className="mb-3 text-[11px] text-slate-500">{translate ? "District language is English — no translation needed." : "Enable Translate to preview the district language."}</div>}
      <ErrorNote error={q.error} className="mb-3" />
      {!q.enabled ? (
        <div className="py-10 text-center text-xs text-slate-500">Add a title and description to render previews.</div>
      ) : !r ? (
        <div className="flex justify-center">
          <Skeleton className="h-[440px] w-[260px] rounded-[30px]" />
        </div>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div key={`${channel}-${lang}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} className={cn(q.stale && "opacity-70")}>
            {channel === "app" && <AppPush r={r} />}
            {channel === "sms" && <Sms r={r} />}
            {channel === "whatsapp" && <WhatsApp r={r} />}
            {channel === "email" && <Email r={r} />}
          </motion.div>
        </AnimatePresence>
      )}
    </Panel>
  );
}
