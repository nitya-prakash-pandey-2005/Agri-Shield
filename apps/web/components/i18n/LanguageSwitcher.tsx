"use client";

/**
 * LanguageSwitcher — importable by every portal.
 *   <LanguageSwitcher />                 compact dropdown (top bars)
 *   <LanguageSwitcher variant="grid" />  card grid (onboarding / signup / profile)
 * Inside an <I18nProvider> the UI switches instantly; outside one it persists
 * the choice (cookie + localStorage + profile) and refreshes server components.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Globe2, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { LOCALES, LOCALE_COOKIE, isLocale, localeMeta, type Locale } from "@/lib/i18n/config";
import { persistLocaleClient, useI18nOptional } from "@/lib/i18n/I18nProvider";

function readCookieLocale(): Locale {
  if (typeof document === "undefined") return "en";
  const m = document.cookie.match(new RegExp(`${LOCALE_COOKIE}=([a-z]+)`));
  return isLocale(m?.[1]) ? m![1] as Locale : "en";
}

export function LanguageSwitcher({
  variant = "compact",
  className,
  align = "right",
  onChange,
}: {
  variant?: "compact" | "grid";
  className?: string;
  align?: "left" | "right";
  onChange?: (l: Locale) => void;
}) {
  const i18n = useI18nOptional();
  const router = useRouter();
  const { data: session, update } = useSession();
  const setLanguage = trpc.auth.setLanguage.useMutation();
  const [standalone, setStandalone] = useState<Locale>("en");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!i18n) setStandalone(readCookieLocale());
  }, [i18n]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const current = i18n?.locale ?? standalone;
  const busy = i18n?.switching ?? false;

  const choose = async (l: Locale) => {
    setOpen(false);
    onChange?.(l);
    if (i18n) return i18n.setLocale(l);
    persistLocaleClient(l);
    setStandalone(l);
    if (session?.user?.id) {
      setLanguage.mutate({ language: l });
      await update({ language: l }).catch(() => {});
    }
    router.refresh();
  };

  if (variant === "grid") {
    return (
      <div role="radiogroup" aria-label="Language" className={cn("grid grid-cols-2 sm:grid-cols-4 gap-2", className)}>
        {LOCALES.map((l) => {
          const active = l.code === current;
          return (
            <motion.button
              type="button"
              key={l.code}
              role="radio"
              aria-checked={active}
              whileTap={{ scale: 0.97 }}
              onClick={() => choose(l.code)}
              className={cn(
                "relative min-h-[56px] rounded-xl border px-3 py-2 text-left transition-colors",
                active ? "border-emerald-400/70 bg-emerald-500/10 shadow-[0_0_20px_-8px_rgba(16,185,129,0.9)]" : "border-slate-700/70 bg-slate-900/50 hover:border-slate-500"
              )}
            >
              <div className="text-sm font-medium text-white leading-tight">{l.nativeName}</div>
              <div className="text-[10px] telemetry uppercase tracking-wider text-slate-500 mt-0.5">
                {l.name} · {l.code}
              </div>
              {active && <Check size={14} className="absolute top-2 right-2 text-emerald-400" />}
            </motion.button>
          );
        })}
      </div>
    );
  }

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Change language"
        className="inline-flex h-9 min-w-[44px] items-center gap-1.5 rounded-lg border border-white/10 bg-slate-900/60 px-2.5 text-xs text-slate-200 hover:border-emerald-500/40 transition-colors"
      >
        {busy ? <Loader2 size={14} className="animate-spin text-emerald-400" /> : <Globe2 size={14} className="text-emerald-400" />}
        <span className="hidden sm:inline">{localeMeta(current).nativeName}</span>
        <span className="sm:hidden telemetry uppercase">{current}</span>
        <ChevronDown size={12} className={cn("text-slate-500 transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            aria-label="Languages"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className={cn(
              "absolute z-[1200] mt-2 w-60 overflow-hidden rounded-xl border border-white/10 bg-[#0a1122]/95 p-1 shadow-2xl backdrop-blur-xl",
              align === "right" ? "right-0" : "left-0"
            )}
          >
            {LOCALES.map((l) => (
              <li key={l.code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={l.code === current}
                  onClick={() => choose(l.code)}
                  className={cn(
                    "flex w-full min-h-[44px] items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors",
                    l.code === current ? "bg-emerald-500/10 text-white" : "text-slate-300 hover:bg-white/5"
                  )}
                >
                  <span>
                    <span className="block leading-tight">{l.nativeName}</span>
                    <span className="block text-[10px] telemetry uppercase tracking-wider text-slate-500">{l.region}</span>
                  </span>
                  {l.code === current && <Check size={14} className="text-emerald-400" />}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

export default LanguageSwitcher;
