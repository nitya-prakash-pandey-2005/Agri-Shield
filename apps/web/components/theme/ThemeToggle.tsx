"use client";

/**
 * Theme button for every top bar. The icon morphs (spring) between
 * sun / moon / eclipse / contrast; a small dot marks automatic modes
 * (System, Solar Auto). Click → Appearance panel.
 * Author: Nitya Prakash Pandey
 */
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { Contrast, Eclipse, Moon, Sun, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { THEMES, modeLabel, type ThemeId } from "./logic";
import { APPEARANCE_OPEN_EVENT, useAppearance } from "./useAppearance";

const AppearancePanel = dynamic(() => import("./AppearancePanel"), { ssr: false });

export const THEME_ICONS: Record<ThemeId, LucideIcon> = { dark: Moon, light: Sun, midnight: Eclipse, contrast: Contrast };

export function ThemeToggle({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { theme, mode, mounted } = useAppearance();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const shown: ThemeId = mounted ? theme : "dark";
  const Icon = THEME_ICONS[shown];
  const auto = mounted && (mode === "system" || mode === "solar");

  // ⌘K "Appearance settings…" opens the first toggle on the page
  useEffect(() => {
    const onOpen = () => {
      const first = document.querySelector("[data-theme-toggle]");
      if (first === btn.current) setOpen(true);
    };
    window.addEventListener(APPEARANCE_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(APPEARANCE_OPEN_EVENT, onOpen);
  }, []);

  const label = mounted ? `${modeLabel(mode)}${auto ? ` (now ${THEMES[theme].label})` : ""}` : "Mission Control";
  return (
    <>
      <button
        ref={btn}
        type="button"
        data-theme-toggle=""
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Appearance: ${label}. Change theme`}
        title={`Appearance — ${label} (Ctrl+Shift+L to cycle)`}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "theme-toggle relative grid shrink-0 place-items-center rounded-lg text-slate-300 transition-colors hover:bg-white/5 hover:text-white",
          compact ? "h-11 w-11" : "h-9 w-9",
          open && "bg-white/5 text-white",
          className
        )}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={shown}
            className="grid place-items-center"
            initial={{ rotate: -120, scale: 0.3, opacity: 0 }}
            animate={{ rotate: 0, scale: 1, opacity: 1 }}
            exit={{ rotate: 120, scale: 0.3, opacity: 0 }}
            transition={{ type: "spring", stiffness: 520, damping: 24 }}
          >
            <Icon size={compact ? 19 : 17} aria-hidden />
          </motion.span>
        </AnimatePresence>
        {auto && (
          <span
            aria-hidden
            className={cn("absolute rounded-full ring-2 ring-[#060b18]", compact ? "bottom-2 right-2 h-2 w-2" : "bottom-1 right-1 h-1.5 w-1.5", mode === "solar" ? "bg-amber-400" : "bg-sky-400")}
          />
        )}
      </button>
      {open && <AppearancePanel anchor={btn} onClose={(refocus) => { setOpen(false); if (refocus) btn.current?.focus(); }} />}
    </>
  );
}
