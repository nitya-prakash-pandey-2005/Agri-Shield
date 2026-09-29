"use client";

/**
 * Interactive product tour — a step-through spotlight overlay.
 * Auto-starts on a user's first visit to Home (/app); restartable from the
 * Help menu, the Help centre, or /app?tour=1. Progress/completion is stored
 * server-side per user (workspace.tourState / setTour).
 *
 * Steps point at elements via CSS selectors (mostly `[data-tour=…]`). Steps
 * whose target isn't on screen (e.g. the sidebar on mobile) are skipped.
 * Keyboard: → / Enter next · ← back · Esc close.
 */
import { AnimatePresence, motion } from "framer-motion";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface Step {
  target: string | null;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  { target: null, title: "Welcome to your Agri-SHIELD workspace", body: "A 60-second tour of where everything lives. Use the arrow keys or the buttons — press Esc any time to skip." },
  { target: '[data-tour="briefing"]', title: "Today's risk briefing", body: "Every morning we re-check your assets against the latest flood, salinity, drought and heat forecasts, and summarise it here in plain language." },
  { target: '[data-tour="kpis"]', title: "Your numbers at a glance", body: "Live totals from your portfolio. Hover the ⓘ icons for a plain-language explanation of each term." },
  { target: '[data-tour="map"]', title: "Where the risk is", body: "Each dot is one of your assets, coloured by its composite risk score. Open Portfolio for the full interactive map." },
  { target: '[data-tour="checklist"]', title: "Get set up in 5 steps", body: "Add assets, invite your team, create an alert rule, generate a report and connect the API. Progress is saved for the whole workspace." },
  { target: 'aside a[href="/app/explorer"]', title: "Risk Explorer", body: "Click anywhere on Earth to get a full climate-risk report for that exact location — forecasts, rivers, salinity, satellite and more." },
  { target: 'aside a[href="/app/portfolio"]', title: "Portfolio", body: "All your plots, loans, farms or sites — import a CSV, see exposure, drill into any asset." },
  { target: 'aside a[href="/app/alerts"]', title: "Alerts & Rules", body: "Tell us what matters (e.g. flood probability above 60% on coastal plots) and who to notify, by email, SMS, WhatsApp or webhook." },
  { target: 'aside a[href="/app/reports"]', title: "Reports", body: "Board packs, disclosures and due-diligence PDFs from live data — generate now or schedule weekly." },
  { target: 'header button[aria-label^="Notifications"]', title: "Notifications", body: "Rules that fire, reports that finish and team changes land here." },
  { target: '[data-tour="help"]', title: "Help is always one click away", body: "The help centre, glossary, system status and support — and you can restart this tour from here." },
];

type Rect = { top: number; left: number; width: number; height: number };

function visibleRect(sel: string | null): Rect | null {
  if (!sel || typeof document === "undefined") return null;
  const el = document.querySelector(sel) as HTMLElement | null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function ProductTour() {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const tour = trpc.workspace.tourState.useQuery(undefined, { staleTime: Infinity, enabled: pathname === "/app" });
  const setTour = trpc.workspace.setTour.useMutation();
  const utils = trpc.useUtils();
  const [active, setActive] = useState(false);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [vw, setVw] = useState(1280);
  const [vh, setVh] = useState(800);

  const forced = params?.get("tour") === "1";

  // Auto-start on first visit (or when ?tour=1)
  useEffect(() => {
    if (pathname !== "/app" || active) return;
    if (!forced && (tour.isLoading || !tour.data || tour.data.seen)) return;
    const t = setTimeout(() => {
      setI(0);
      setActive(true);
    }, 1400);
    return () => clearTimeout(t);
  }, [pathname, forced, tour.isLoading, tour.data, active]);

  // Steps whose targets exist right now
  const steps = useMemo(() => (active ? STEPS.filter((s) => !s.target || visibleRect(s.target)) : STEPS), [active]);
  const step = steps[Math.min(i, steps.length - 1)];

  const measure = useCallback(() => {
    setVw(window.innerWidth);
    setVh(window.innerHeight);
    setRect(step?.target ? visibleRect(step.target) : null);
  }, [step]);

  useLayoutEffect(() => {
    if (!active || !step) return;
    const el = step.target ? (document.querySelector(step.target) as HTMLElement | null) : null;
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.top < 70 || r.bottom > window.innerHeight - 40) el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    measure();
    const t = setTimeout(measure, 450);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [active, step, measure]);

  const close = useCallback(
    (completed: boolean) => {
      setActive(false);
      void setTour.mutateAsync({ action: completed ? "complete" : "dismiss", step: i }).then(() => utils.workspace.tourState.invalidate());
      if (forced) router.replace("/app");
    },
    [forced, i, router, setTour, utils]
  );

  const next = useCallback(() => (i >= steps.length - 1 ? close(true) : setI((x) => x + 1)), [i, steps.length, close]);
  const back = useCallback(() => setI((x) => Math.max(0, x - 1)), []);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
      else if (e.key === "ArrowRight" || e.key === "Enter") (e.preventDefault(), next());
      else if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, next, back, close]);

  if (!active || !step) return null;

  const pad = 8;
  const cardW = Math.min(340, vw - 24);
  let cardTop: number, cardLeft: number;
  if (rect) {
    const below = rect.top + rect.height + pad + 12;
    const fitsBelow = below + 190 < vh;
    cardTop = fitsBelow ? below : Math.max(12, rect.top - pad - 12 - 190);
    cardLeft = Math.min(Math.max(12, rect.left + rect.width / 2 - cardW / 2), vw - cardW - 12);
    // Sidebar targets: put the card to the right instead
    if (rect.left < 260 && rect.width < 260 && vw > 700) {
      cardLeft = rect.left + rect.width + 16;
      cardTop = Math.min(Math.max(12, rect.top - 20), vh - 210);
    }
  } else {
    cardTop = vh / 2 - 110;
    cardLeft = vw / 2 - cardW / 2;
  }

  return createPortal(
    <div className="fixed inset-0 z-[300]" role="dialog" aria-modal="true" aria-label={`Product tour: ${step.title}`}>
      {/* Dim + spotlight */}
      {rect ? (
        <motion.div
          className="pointer-events-none fixed rounded-xl"
          initial={false}
          animate={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
          transition={{ type: "spring", stiffness: 260, damping: 30 }}
          style={{ boxShadow: "0 0 0 9999px rgba(2,6,23,0.74), 0 0 0 2px rgba(56,189,248,0.9), 0 0 32px 4px rgba(56,189,248,0.35)" }}
        />
      ) : (
        <div className="fixed inset-0 bg-[rgba(2,6,23,0.78)]" />
      )}
      {/* Click-catcher (clicking the dim area does nothing destructive) */}
      <div className="fixed inset-0" onClick={(e) => e.stopPropagation()} />

      <AnimatePresence mode="wait">
        <motion.div
          key={step.title}
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22 }}
          className="fixed rounded-2xl border border-cyan-400/30 bg-[#081022] p-4 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.9)]"
          style={{ top: cardTop, left: cardLeft, width: cardW }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="hud-label text-cyan-300/80">
              Step {Math.min(i, steps.length - 1) + 1} of {steps.length}
            </div>
            <button onClick={() => close(false)} className="-mr-1 -mt-1 p-1 text-slate-500 hover:text-white" aria-label="Close tour">
              <X size={15} />
            </button>
          </div>
          <h3 className="mt-1 font-display text-base font-semibold text-white">{step.title}</h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-slate-300">{step.body}</p>
          <div className="mt-3 flex items-center gap-1">
            {steps.map((_, k) => (
              <span key={k} className="h-1 flex-1 rounded-full" style={{ background: k <= i ? "rgb(56 189 248)" : "rgb(51 65 85)" }} />
            ))}
          </div>
          <div className="mt-3.5 flex items-center justify-between">
            <button onClick={() => close(false)} className="text-xs text-slate-500 hover:text-slate-300">
              Skip tour
            </button>
            <div className="flex gap-2">
              {i > 0 && (
                <button onClick={back} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-500">
                  <ArrowLeft size={13} /> Back
                </button>
              )}
              <button onClick={next} autoFocus className="inline-flex items-center gap-1 rounded-lg bg-cyan-400 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-300">
                {i >= steps.length - 1 ? (
                  <>
                    Finish <Check size={13} />
                  </>
                ) : (
                  <>
                    Next <ArrowRight size={13} />
                  </>
                )}
              </button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>,
    document.body
  );
}
