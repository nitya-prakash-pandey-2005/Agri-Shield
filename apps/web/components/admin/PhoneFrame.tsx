"use client";

/**
 * Feature-phone style SMS conversation frame for the admin SMS simulator.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BatteryMedium, Signal } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Bubble {
  id: string;
  dir: "out" | "in";
  text: string;
  at: Date;
  meta?: string;
  error?: boolean;
}

function StatusClock() {
  const [t, setT] = useState<string>("");
  useEffect(() => {
    const f = () => setT(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    f();
    const i = setInterval(f, 15_000);
    return () => clearInterval(i);
  }, []);
  return <span suppressHydrationWarning>{t}</span>;
}

export function PhoneFrame({ title, subtitle, bubbles, typing, footer }: { title: string; subtitle?: string; bubbles: Bubble[]; typing?: boolean; footer: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [bubbles.length, typing]);

  return (
    <div className="mx-auto w-full max-w-[340px]">
      <div className="relative rounded-[42px] border border-slate-600/60 bg-gradient-to-b from-slate-800 to-slate-950 p-2.5 shadow-[0_30px_80px_-20px_rgba(139,92,246,0.45),inset_0_0_0_1px_rgba(255,255,255,0.05)]">
        <div className="relative overflow-hidden rounded-[34px] bg-[#0b1020]">
          {/* notch */}
          <div className="absolute left-1/2 top-0 z-20 h-6 w-32 -translate-x-1/2 rounded-b-2xl bg-slate-950" />
          {/* status bar */}
          <div className="relative z-10 flex h-8 items-center justify-between px-6 pt-1 text-[10.5px] text-slate-300 telemetry">
            <StatusClock />
            <span className="flex items-center gap-1">
              <Signal size={11} /> AGS-NET <BatteryMedium size={13} />
            </span>
          </div>
          {/* header */}
          <div className="flex items-center gap-2.5 border-b border-white/5 bg-slate-900/70 px-4 py-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-emerald-500 text-[11px] font-bold text-white">AS</div>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold text-white">{title}</div>
              {subtitle && <div className="truncate text-[10.5px] text-slate-400">{subtitle}</div>}
            </div>
          </div>
          {/* messages */}
          <div ref={scroller} className="h-[420px] space-y-2 overflow-y-auto px-3 py-3">
            {bubbles.length === 0 && !typing && <div className="mt-24 text-center text-[11px] text-slate-500">Send a command — e.g. STATUS — to talk to the Agri-SHIELD SMS bot.</div>}
            <AnimatePresence initial={false}>
              {bubbles.map((b) => (
                <motion.div key={b.id} initial={{ opacity: 0, y: 8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} className={cn("flex", b.dir === "out" ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[82%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[12.5px] leading-snug",
                      b.dir === "out" ? "rounded-br-sm bg-violet-600 text-white" : b.error ? "rounded-bl-sm border border-rose-500/40 bg-rose-500/10 text-rose-200" : "rounded-bl-sm bg-slate-800 text-slate-100"
                    )}
                  >
                    {b.text}
                    <div className={cn("mt-1 text-[9.5px] telemetry", b.dir === "out" ? "text-violet-200/70" : "text-slate-500")}>
                      {b.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      {b.meta ? ` · ${b.meta}` : ""}
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            {typing && (
              <div className="flex justify-start">
                <div className="flex gap-1 rounded-2xl rounded-bl-sm bg-slate-800 px-3 py-3">
                  {[0, 1, 2].map((i) => (
                    <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-slate-400" animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }} transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }} />
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="border-t border-white/5 bg-slate-900/80 p-2.5">{footer}</div>
          <div className="mx-auto mb-1.5 mt-1 h-1 w-24 rounded-full bg-slate-600" />
        </div>
      </div>
    </div>
  );
}
