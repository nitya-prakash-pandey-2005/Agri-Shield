"use client";

/**
 * Floating Copilot launcher available on every workspace page.
 * Opens a slide-over chat panel (Ctrl/⌘ + J). Hidden on /app/copilot itself.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Bot, Maximize2, X } from "lucide-react";
import { CopilotChat } from "./CopilotChat";

export function CopilotLauncher() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const hidden = pathname?.startsWith("/app/copilot");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  if (hidden) return null;
  return (
    <>
      <AnimatePresence>
        {!open && (
          <motion.button
            key="fab"
            type="button"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => setOpen(true)}
            className="fixed bottom-5 right-5 z-[900] inline-flex items-center gap-2 rounded-full border border-cyan-400/40 bg-slate-950/90 py-2.5 pl-3 pr-4 text-[13px] font-medium text-cyan-100 shadow-[0_0_30px_-6px_rgba(56,189,248,0.7)] backdrop-blur"
            aria-label="Open Copilot (Ctrl+J)"
            title="Ask Copilot (Ctrl+J)"
          >
            <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/20">
              <Bot size={14} className="text-cyan-300" />
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
            </span>
            <span className="hidden sm:inline">Ask Copilot</span>
          </motion.button>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {open && (
          <motion.aside
            key="panel"
            role="dialog"
            aria-label="Agri-SHIELD Copilot"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="fixed inset-x-2 bottom-2 top-16 z-[900] flex flex-col overflow-hidden rounded-2xl border border-cyan-500/25 bg-[#070c1a]/95 shadow-[0_20px_60px_-10px_rgba(0,0,0,0.8)] backdrop-blur-xl sm:inset-x-auto sm:right-4 sm:w-[440px]"
          >
            <header className="flex items-center gap-2 border-b border-slate-800 px-3.5 py-2.5">
              <Bot size={15} className="text-cyan-300" />
              <div className="font-display text-[13px] font-semibold text-white">Copilot</div>
              <span className="hud-label">climate-risk analyst</span>
              <div className="ml-auto flex items-center gap-1">
                <Link href="/app/copilot" className="rounded-md p-1.5 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Open full-page Copilot" title="Open full page">
                  <Maximize2 size={14} />
                </Link>
                <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1.5 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Close Copilot">
                  <X size={15} />
                </button>
              </div>
            </header>
            <div className="min-h-0 flex-1">
              <CopilotChat variant="panel" />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
