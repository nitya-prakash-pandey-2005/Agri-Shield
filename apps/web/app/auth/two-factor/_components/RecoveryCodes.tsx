"use client";

import { useState } from "react";
import { Check, Copy, Download, Printer } from "lucide-react";
import { toast } from "sonner";

/** Shows freshly issued recovery codes once, with copy / download / print. */
export function RecoveryCodes({ codes, account, onConfirmed }: { codes: string[]; account: string; onConfirmed?: (v: boolean) => void }) {
  const [saved, setSaved] = useState(false);
  const text = `Agri-SHIELD recovery codes for ${account}\nGenerated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC\nEach code works once. Keep them somewhere safe (password manager, printed copy).\n\n${codes.join("\n")}\n`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      toast.success("Recovery codes copied");
    } catch {
      toast.message("Select the codes and copy them manually");
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "agri-shield-recovery-codes.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const print = () => {
    const w = window.open("", "_blank", "width=480,height=640");
    if (!w) return;
    w.document.write(`<pre style="font:14px/1.7 ui-monospace,Consolas,monospace;padding:24px">${text.replace(/</g, "&lt;")}</pre>`);
    w.document.close();
    w.print();
  };
  return (
    <div>
      <div className="rounded-xl border border-amber-400/30 bg-amber-400/[0.06] p-3">
        <p className="text-[12.5px] text-amber-100">Save these 10 recovery codes now. If you lose your phone, each code signs you in once. We only store a one-way hash — they can't be shown again.</p>
        <ol className="telemetry mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[15px] text-white">
          {codes.map((c, i) => (
            <li key={c} className="flex items-center gap-2">
              <span className="w-5 text-right text-[11px] text-slate-500">{i + 1}.</span>
              {c}
            </li>
          ))}
        </ol>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-[13px] text-slate-200 hover:border-cyan-400/50">
          <Copy size={14} /> Copy
        </button>
        <button type="button" onClick={download} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-[13px] text-slate-200 hover:border-cyan-400/50">
          <Download size={14} /> Download .txt
        </button>
        <button type="button" onClick={print} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-[13px] text-slate-200 hover:border-cyan-400/50">
          <Printer size={14} /> Print
        </button>
      </div>
      {onConfirmed && (
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-[13px] text-slate-300">
          <input
            type="checkbox"
            checked={saved}
            onChange={(e) => {
              setSaved(e.target.checked);
              onConfirmed(e.target.checked);
            }}
            className="h-4 w-4 accent-cyan-400"
          />
          {saved ? <Check size={14} className="text-emerald-400" /> : null} I've saved my recovery codes
        </label>
      )}
    </div>
  );
}
