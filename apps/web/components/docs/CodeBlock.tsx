"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <div className="group relative my-5 overflow-hidden rounded-xl border border-white/10 bg-[#040811]">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-1.5">
        <span className="telemetry text-[10.5px] uppercase tracking-wider text-slate-500">{lang || "text"}</span>
        <button type="button" onClick={copy} aria-label={copied ? "Copied" : "Copy code"} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-slate-400 hover:bg-white/5 hover:text-white">
          {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-[12.5px] leading-relaxed text-slate-200">
        <code>{code}</code>
      </pre>
    </div>
  );
}
