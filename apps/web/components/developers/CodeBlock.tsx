"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { LANGS, type Lang } from "./snippets";

export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          /* clipboard blocked */
        }
      }}
      className={cn("inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-slate-400 hover:bg-white/5 hover:text-white", className)}
      aria-label={label}
    >
      {done ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />} {done ? "Copied" : label}
    </button>
  );
}

export function CodeBlock({ code, title, className, maxH = "max-h-80" }: { code: string; title?: ReactNode; className?: string; maxH?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-xl border border-white/10 bg-[#050b18]", className)}>
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-1.5">
        <span className="hud-label text-slate-500">{title ?? "code"}</span>
        <CopyButton text={code} />
      </div>
      <pre className={cn("telemetry overflow-auto p-3 text-[12px] leading-relaxed text-slate-200", maxH)}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** Language tabs over a snippet generator. */
export function SnippetTabs({ make, className, initial = "curl" }: { make: (l: Lang) => string; className?: string; initial?: Lang }) {
  const [lang, setLang] = useState<Lang>(initial);
  const code = useMemo(() => make(lang), [make, lang]);
  return (
    <div className={cn("overflow-hidden rounded-xl border border-white/10 bg-[#050b18]", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-white/5 px-2 py-1">
        <div className="flex gap-0.5 overflow-x-auto" role="tablist" aria-label="Language">
          {LANGS.map((l) => (
            <button key={l.id} role="tab" aria-selected={lang === l.id} onClick={() => setLang(l.id)} className={cn("rounded-md px-2.5 py-1 text-[11.5px] transition-colors", lang === l.id ? "bg-cyan-400/15 text-cyan-200" : "text-slate-500 hover:text-slate-200")}>
              {l.label}
            </button>
          ))}
        </div>
        <CopyButton text={code} />
      </div>
      <pre className="telemetry max-h-80 overflow-auto p-3 text-[12px] leading-relaxed text-slate-200">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** Pretty JSON with lightweight token colouring (no dependencies). */
export function JsonView({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => {
    let pretty = text;
    try {
      pretty = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      /* not JSON — show raw */
    }
    const esc = pretty.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return esc.replace(/("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g, (m) => {
      const cls = /^"/.test(m) ? (/:$/.test(m) ? "text-cyan-300" : "text-emerald-200") : /true|false/.test(m) ? "text-violet-300" : /null/.test(m) ? "text-slate-500" : "text-amber-200";
      return `<span class="${cls}">${m}</span>`;
    });
  }, [text]);
  return <pre className={cn("telemetry overflow-auto whitespace-pre text-[12px] leading-relaxed text-slate-300", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
