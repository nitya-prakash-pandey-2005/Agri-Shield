"use client";

/**
 * Deck-style scrolling pitch. ←/→ (or PageUp/PageDown, J/K) move between slides,
 * Home/End jump, P toggles presenter mode (fullscreen, snap, speaker notes), N toggles notes.
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Maximize2, Minimize2, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import { LogoMark, Wordmark } from "@/components/landing/Logo";
import { BusinessSlide, ContactSlide, CoverSlide, DemoSlide, DiffSlide, ImpactSlide, ProblemSlide, SdgSlide, SolutionSlide, TeamSlide, TechSlide } from "./slides";

const SLIDES: { id: string; label: string; notes: string; node: ReactNode }[] = [
  { id: "cover", label: "Agri-SHIELD", node: <CoverSlide />, notes: "Open with the gap: forecasts see floods days ahead, but nobody in the field acts. The counters are live from the platform." },
  { id: "problem", label: "Problem", node: <ProblemSlide />, notes: "$123B/yr to disasters (FAO 2023), $27B/yr on salt-affected land. GCA: 24 h warning cuts damage 30%. We give 72 h." },
  { id: "solution", label: "Solution", node: <SolutionSlide />, notes: "Open data in, one risk engine, three role-specific portals. Point at the purple loop: farmer outcomes recalibrate thresholds." },
  { id: "demo", label: "Live demo", node: <DemoSlide />, notes: "Switch Flood → Salinity, jump to Mekong Delta, open Bến Tre, toggle NASA IMERG rain. Everything is live." },
  { id: "impact", label: "Impact", node: <ImpactSlide />, notes: "Numbers are computed from the platform right now. Avoided loss is simulated; formula is on the slide." },
  { id: "tech", label: "Technology", node: <TechSlide />, notes: "No proprietary hardware. A ministry can self-host everything." },
  { id: "why", label: "Differentiators", node: <DiffSlide />, notes: "Emphasise salinity forecasting and the three-portal architecture: nobody else combines them." },
  { id: "business", label: "Business model", node: <BusinessSlide />, notes: "Free for farmers; governments and supply chains pay. Pilot → province → national." },
  { id: "sdg", label: "SDGs", node: <SdgSlide />, notes: "SDG 2, 13, 17." },
  { id: "team", label: "Team", node: <TeamSlide />, notes: "Nitya Prakash Pandey, founder. Next hires: ML, agronomy, partnerships." },
  { id: "contact", label: "Contact", node: <ContactSlide />, notes: "Ask: a district pilot partner and introductions to agriculture ministries." },
];

export function PitchDeck() {
  const [current, setCurrent] = useState(0);
  const [presenter, setPresenter] = useState(false);
  const [notes, setNotes] = useState(false);
  const refs = useRef<(HTMLElement | null)[]>([]);

  const go = useCallback((i: number) => {
    const idx = Math.max(0, Math.min(SLIDES.length - 1, i));
    refs.current[idx]?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }, []);

  // track the slide in view
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (vis) setCurrent(Number((vis.target as HTMLElement).dataset.index));
      },
      { threshold: [0.35, 0.6] }
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  const togglePresenter = useCallback(async () => {
    const next = !presenter;
    setPresenter(next);
    setNotes(next);
    try {
      if (next && !document.fullscreenElement) await document.documentElement.requestFullscreen();
      if (!next && document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* fullscreen not allowed — presenter still works */
    }
  }, [presenter]);

  useEffect(() => {
    const onFs = () => !document.fullscreenElement && setPresenter(false);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    html.style.scrollSnapType = presenter ? "y mandatory" : "";
    return () => {
      html.style.scrollSnapType = "";
    };
  }, [presenter]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable=true], .leaflet-container")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (["ArrowRight", "PageDown", "j", "J"].includes(e.key)) {
        e.preventDefault();
        go(current + 1);
      } else if (["ArrowLeft", "PageUp", "k", "K"].includes(e.key)) {
        e.preventDefault();
        go(current - 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        go(0);
      } else if (e.key === "End") {
        e.preventDefault();
        go(SLIDES.length - 1);
      } else if (e.key === "p" || e.key === "P") {
        void togglePresenter();
      } else if (e.key === "n" || e.key === "N") {
        setNotes((n) => !n);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, go, togglePresenter]);

  const slide = SLIDES[current]!;

  return (
    <div className={cn("site-shell min-h-screen", presenter && "text-[17px]")}>
      <header className="fixed inset-x-0 top-0 z-[900] border-b border-white/[0.06] bg-[#050a14]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2" aria-label="Agri-SHIELD home">
            <LogoMark size={22} />
            <Wordmark className="hidden sm:inline" />
          </Link>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="telemetry shrink-0 text-xs text-slate-500">
              {String(current + 1).padStart(2, "0")}/{String(SLIDES.length).padStart(2, "0")}
            </span>
            <span className="truncate text-sm text-slate-200">{slide.label}</span>
            <div className="hidden h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06] md:block" aria-hidden>
              <div className="h-full bg-gradient-to-r from-emerald-400 to-sky-400 transition-all duration-500" style={{ width: `${((current + 1) / SLIDES.length) * 100}%` }} />
            </div>
          </div>
          <nav aria-label="Slides" className="hidden items-center gap-1 lg:flex">
            {SLIDES.map((s, i) => (
              <button key={s.id} onClick={() => go(i)} aria-label={`Go to slide ${i + 1}: ${s.label}`} aria-current={i === current ? "step" : undefined} className="grid h-8 w-5 place-items-center">
                <span className={cn("block w-1.5 rounded-full transition-all", i === current ? "h-4 bg-emerald-400" : "h-1.5 bg-white/25 hover:bg-white/50")} />
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-1">
            <button onClick={() => go(current - 1)} aria-label="Previous slide" className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white">
              <ChevronUp size={18} />
            </button>
            <button onClick={() => go(current + 1)} aria-label="Next slide" className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white">
              <ChevronDown size={18} />
            </button>
            <button onClick={() => setNotes((n) => !n)} aria-pressed={notes} aria-label="Toggle speaker notes (N)" className={cn("hidden h-9 w-9 place-items-center rounded-lg hover:bg-white/5 sm:grid", notes ? "text-amber-300" : "text-slate-400")}>
              <StickyNote size={16} />
            </button>
            <button onClick={togglePresenter} aria-pressed={presenter} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-xs text-slate-300 hover:border-white/25 hover:text-white">
              {presenter ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              <span className="hidden sm:inline">{presenter ? "Exit presenter" : "Present"}</span>
            </button>
          </div>
        </div>
      </header>

      <main id="main">
        {SLIDES.map((s, i) => (
          <section
            key={s.id}
            id={s.id}
            data-index={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            aria-label={`Slide ${i + 1}: ${s.label}`}
            className={cn("relative flex min-h-[100svh] snap-start items-center border-b border-white/[0.04] pt-14", i % 2 === 1 && "bg-[#060c19]")}
          >
            {i === 0 && <div aria-hidden className="site-grid pointer-events-none absolute inset-0" />}
            <div className="relative mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 sm:py-20">{s.node}</div>
          </section>
        ))}
      </main>

      {notes && (
        <aside aria-label="Speaker notes" className="fixed inset-x-3 bottom-3 z-[950] mx-auto max-w-3xl rounded-2xl border border-amber-400/25 bg-[#0c0f18]/95 p-4 text-sm text-amber-50 shadow-2xl backdrop-blur">
          <div className="mb-1 flex items-center justify-between text-xs text-amber-300/80">
            <span>
              Notes · {current + 1}. {slide.label}
            </span>
            <span className="telemetry text-slate-500">← → navigate · P present · N notes</span>
          </div>
          {slide.notes}
        </aside>
      )}
    </div>
  );
}
