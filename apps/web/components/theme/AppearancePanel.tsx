"use client";

/**
 * Appearance panel — popover (desktop) / bottom sheet (< 640 px).
 *   · live mini previews of every theme (a tiny HUD panel + chart in that palette)
 *   · System and Solar Auto cards (Solar shows the real next switch time)
 *   · sun-path strip for Solar Auto with location source + "use my location"
 *   · accent swatches, motion preference, keyboard hints
 * Keyboard: arrows move between options, Enter/Space selects, Esc closes;
 * focus is trapped inside while open and returns to the button afterwards.
 * Author: Nitya Prakash Pandey
 */
import { motion } from "framer-motion";
import { Check, Keyboard, LocateFixed, MapPin, Monitor, Sunrise, Sunset, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ACCENTS,
  ACCENT_IDS,
  CIVIL_TWILIGHT_DEG,
  THEMES,
  THEME_IDS,
  solarSummary,
  sunPath,
  type AccentId,
  type MotionPref,
  type SolarLocation,
  type ThemeId,
  type ThemeMode,
  type ThemePalette,
} from "./logic";
import { useAppearance } from "./useAppearance";

const MODES: ThemeMode[] = [...THEME_IDS, "system", "solar"];

// ─── Previews (inline styles only — never remapped by app/themes.css) ─────

function lineColor(p: ThemePalette, theme: ThemeId, accent: AccentId): string {
  if (accent === "emerald") return p.line;
  const a = ACCENTS[accent];
  return theme === "light" ? `rgb(${a.deep})` : theme === "contrast" ? `rgb(${a.soft})` : `rgb(${a.hi})`;
}

const SPARK = "0,30 12,26 24,28 36,18 48,21 60,11 72,15 84,6 96,9";

function MiniHud({ theme, accent, style }: { theme: ThemeId; accent: AccentId; style?: CSSProperties }) {
  const p = THEMES[theme].palette;
  const line = lineColor(p, theme, accent);
  const bracket = accent === "emerald" ? p.bracket : line;
  const gid = `g-${theme}-${accent}`;
  return (
    <div
      aria-hidden
      className="theme-raw absolute inset-0 overflow-hidden"
      style={{
        background: p.bg,
        backgroundImage: p.grid === "transparent" ? undefined : `linear-gradient(${p.grid} 1px, transparent 1px), linear-gradient(90deg, ${p.grid} 1px, transparent 1px)`,
        backgroundSize: "10px 10px",
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "9px 10px",
          borderRadius: 7,
          background: p.panel,
          border: `${theme === "contrast" ? 1.5 : 1}px solid ${p.border}`,
          boxShadow: theme === "light" ? "0 1px 2px rgba(15,23,42,.06), 0 6px 14px -8px rgba(15,23,42,.25)" : p.glow ? "0 8px 18px -10px rgba(0,0,0,.8)" : "none",
        }}
      >
        <span style={{ position: "absolute", top: -1, left: -1, width: 8, height: 8, borderTop: `2px solid ${bracket}`, borderLeft: `2px solid ${bracket}`, borderTopLeftRadius: 7 }} />
        <span style={{ position: "absolute", bottom: -1, right: -1, width: 8, height: 8, borderBottom: `2px solid ${bracket}`, borderRight: `2px solid ${bracket}`, borderBottomRightRadius: 7 }} />
        <div style={{ position: "absolute", top: 7, left: 8, width: "38%", height: 4, borderRadius: 2, background: p.text, opacity: 0.9 }} />
        <div style={{ position: "absolute", top: 14, left: 8, width: "24%", height: 3, borderRadius: 2, background: p.muted, opacity: 0.8 }} />
        <div style={{ position: "absolute", top: 7, right: 8, width: 14, height: 5, borderRadius: 3, background: line, opacity: theme === "contrast" ? 1 : 0.85 }} />
        <svg viewBox="0 0 96 34" preserveAspectRatio="none" style={{ position: "absolute", left: 8, right: 8, bottom: 6, width: "calc(100% - 16px)", height: "48%", overflow: "visible" }}>
          <defs>
            <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" style={{ stopColor: line, stopOpacity: theme === "contrast" ? 0 : 0.35 }} />
              <stop offset="1" style={{ stopColor: line, stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          <polygon points={`0,34 ${SPARK} 96,34`} style={{ fill: `url(#${gid})` }} />
          <polyline
            points={SPARK}
            style={{ fill: "none", stroke: line, strokeWidth: theme === "contrast" ? 2.4 : 1.8, strokeLinejoin: "round", strokeLinecap: "round", filter: p.glow ? `drop-shadow(0 0 3px ${line})` : undefined }}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
    </div>
  );
}

function SolarPreview({ loc, now, accent }: { loc: SolarLocation | null; now: number; accent: AccentId }) {
  const path = useMemo(() => (loc ? sunPath(loc.lat, loc.lon, now, 12, 12, 30) : []), [loc, now]);
  const cur = path.length ? path[Math.floor(path.length / 2)]!.el : 0;
  const day = cur > CIVIL_TWILIGHT_DEG;
  const y = (el: number) => 30 - (Math.max(-30, Math.min(75, el)) + 30) * (26 / 105);
  const pts = path.map((s, i) => `${(i / Math.max(1, path.length - 1)) * 96},${y(s.el).toFixed(1)}`).join(" ");
  const sunX = 48;
  const sunY = y(cur);
  const sun = accent === "emerald" ? "#fbbf24" : ACCENTS[accent].hex;
  return (
    <div
      aria-hidden
      className="theme-raw absolute inset-0 overflow-hidden"
      style={{ background: day ? "linear-gradient(180deg,#bfe3ff 0%,#eef6ff 70%,#f3f5f9 100%)" : "linear-gradient(180deg,#020617 0%,#0b1733 70%,#101c3a 100%)" }}
    >
      {!day && (
        <>
          <span style={{ position: "absolute", top: 8, left: 16, width: 2, height: 2, borderRadius: 2, background: "#e2e8f0", opacity: 0.8 }} />
          <span style={{ position: "absolute", top: 18, left: 70, width: 1.5, height: 1.5, borderRadius: 2, background: "#e2e8f0", opacity: 0.6 }} />
          <span style={{ position: "absolute", top: 10, right: 20, width: 2, height: 2, borderRadius: 2, background: "#e2e8f0", opacity: 0.7 }} />
        </>
      )}
      <svg viewBox="0 0 96 34" preserveAspectRatio="none" style={{ position: "absolute", inset: "6px 8px", width: "calc(100% - 16px)", height: "calc(100% - 12px)", overflow: "visible" }}>
        <line x1="0" x2="96" y1={y(CIVIL_TWILIGHT_DEG)} y2={y(CIVIL_TWILIGHT_DEG)} style={{ stroke: day ? "rgba(15,23,42,.35)" : "rgba(226,232,240,.35)", strokeWidth: 0.8, strokeDasharray: "2 2" }} vectorEffect="non-scaling-stroke" />
        {pts && <polyline points={pts} style={{ fill: "none", stroke: day ? "rgba(15,23,42,.55)" : "rgba(148,163,184,.7)", strokeWidth: 1.2 }} vectorEffect="non-scaling-stroke" />}
        <circle cx={sunX} cy={sunY} r="3.6" style={{ fill: day ? sun : "#e2e8f0", filter: day ? `drop-shadow(0 0 3px ${sun})` : undefined }} />
      </svg>
    </div>
  );
}

function SystemPreview({ accent }: { accent: AccentId }) {
  return (
    <div aria-hidden className="theme-raw absolute inset-0">
      <MiniHud theme="dark" accent={accent} style={{ clipPath: "polygon(0 0, 62% 0, 38% 100%, 0 100%)" }} />
      <MiniHud theme="light" accent={accent} style={{ clipPath: "polygon(62% 0, 100% 0, 100% 100%, 38% 100%)" }} />
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function AppearancePanel({ anchor, onClose }: { anchor: RefObject<HTMLElement | null>; onClose: (refocus: boolean) => void }) {
  const a = useAppearance();
  const panel = useRef<HTMLDivElement>(null);
  const [sheet, setSheet] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [focusIdx, setFocusIdx] = useState(() => Math.max(0, MODES.indexOf(a.mode)));
  const cards = useRef<(HTMLButtonElement | null)[]>([]);
  const [mac, setMac] = useState(false);
  const [locating, setLocating] = useState(false);

  useLayoutEffect(() => {
    const place = () => {
      const narrow = window.innerWidth < 640;
      setSheet(narrow);
      const r = anchor.current?.getBoundingClientRect();
      if (r) setPos({ top: Math.round(r.bottom + 10), right: Math.max(12, Math.round(window.innerWidth - r.right - 4)) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor]);

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    // Initial focus on the selected theme
    const f = window.setTimeout(() => cards.current[Math.max(0, MODES.indexOf(a.mode))]?.focus(), 30);
    return () => {
      window.clearInterval(t);
      window.clearTimeout(f);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close on outside pointer / Escape
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose(true);
      }
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [anchor, onClose]);

  const trap = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !panel.current) return;
    const els = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0);
    if (!els.length) return;
    const first = els[0]!;
    const last = els[els.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const centerOf = (el: HTMLElement | null) => {
    const r = el?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined;
  };

  const onCardKey = (e: ReactKeyboardEvent<HTMLButtonElement>, i: number) => {
    const cols = 2;
    let n = i;
    if (e.key === "ArrowRight") n = (i + 1) % MODES.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + MODES.length) % MODES.length;
    else if (e.key === "ArrowDown") n = Math.min(MODES.length - 1, i + cols);
    else if (e.key === "ArrowUp") n = Math.max(0, i - cols);
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = MODES.length - 1;
    else return;
    e.preventDefault();
    setFocusIdx(n);
    cards.current[n]?.focus();
  };

  const loc = a.solarLocation;
  const solar = loc ? solarSummary(loc, now) : null;
  const accentRing = `rgb(${ACCENTS[a.accent].rgb})`;
  const kbd = mac ? "⌘ ⇧ L" : "Ctrl ⇧ L";

  const sourceText = !loc
    ? "Locating…"
    : loc.source === "workspace"
      ? `Workspace map centre · ${loc.label}`
      : loc.source === "device"
        ? `This device · ${loc.label}`
        : `Estimated from your time zone · ${loc.label}`;

  const useMyLocation = async () => {
    setLocating(true);
    const ok = await a.requestDeviceLocation();
    setLocating(false);
    if (ok) toast.success("Solar Auto now follows this device's position");
    else toast.error("Location unavailable", { description: "Permission was denied or the position could not be read — Solar Auto keeps using the workspace / time-zone location." });
  };

  const body = (
    <motion.div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-label="Appearance"
      onKeyDown={trap}
      initial={sheet ? { y: 40, opacity: 0 } : { y: -6, scale: 0.98, opacity: 0 }}
      animate={sheet ? { y: 0, opacity: 1 } : { y: 0, scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 460, damping: 34 }}
      className={cn(
        "hud-panel fixed z-[2100] overflow-y-auto overscroll-contain bg-[#070c1a] text-slate-200 shadow-2xl",
        sheet ? "inset-x-0 bottom-0 max-h-[88vh] rounded-b-none pb-[max(1rem,env(safe-area-inset-bottom))]" : "w-[424px] max-h-[calc(100vh-80px)]"
      )}
      style={{ ...(sheet ? {} : { top: pos?.top ?? 64, right: pos?.right ?? 12 }), ["--hud-accent" as string]: ACCENTS[a.accent].rgb }}
    >
      {sheet && <div aria-hidden className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/15" />}
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5">
        <div>
          <h2 className="font-display text-[15px] font-semibold tracking-wide text-white">Appearance</h2>
          <p className="text-[11px] text-slate-400">Theme, accent and motion — saved on this device.</p>
        </div>
        <button type="button" onClick={() => onClose(true)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Close appearance panel">
          <X size={16} aria-hidden />
        </button>
      </div>

      {/* Themes */}
      <div className="px-4 pt-3">
        <div className="hud-label mb-2" id="appearance-theme-label">
          Theme
        </div>
        <div role="radiogroup" aria-labelledby="appearance-theme-label" className="grid grid-cols-2 gap-2">
          {MODES.map((m, i) => {
            const selected = a.mode === m;
            const title = m === "system" ? "System" : m === "solar" ? "Solar Auto" : THEMES[m].label;
            const sub =
              m === "system"
                ? `Follows your OS · now ${THEMES[a.theme === "light" ? "light" : "dark"].label}`
                : m === "solar"
                  ? solar
                    ? solar.next
                      ? `${solar.isDay ? "Day" : "Night"} at ${loc!.label} · ${solar.next.to === "light" ? "Daylight" : "Mission Control"} at ${solar.when}`
                      : solar.text
                    : "Follows the real sun"
                  : THEMES[m].tagline;
            return (
              <button
                key={m}
                ref={(el) => {
                  cards.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={i === focusIdx ? 0 : -1}
                onFocus={() => setFocusIdx(i)}
                onKeyDown={(e) => onCardKey(e, i)}
                onClick={(e) => a.setMode(m, e.detail === 0 ? centerOf(e.currentTarget) : { x: e.clientX, y: e.clientY })}
                className={cn(
                  "group relative overflow-hidden rounded-xl border text-left transition-colors focus-visible:outline-none",
                  selected ? "border-transparent" : "border-white/10 hover:border-white/25"
                )}
                style={selected ? { boxShadow: `0 0 0 2px ${accentRing}` } : undefined}
              >
                <div className="relative h-[70px]">
                  {m === "system" ? <SystemPreview accent={a.accent} /> : m === "solar" ? <SolarPreview loc={loc} now={now} accent={a.accent} /> : <MiniHud theme={m} accent={a.accent} />}
                  {m === "system" && (
                    <span className="theme-raw absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-md" style={{ background: "rgba(2,6,23,.75)", color: "#e2e8f0" }}>
                      <Monitor size={11} aria-hidden />
                    </span>
                  )}
                  {selected && (
                    <span className="theme-raw absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full" style={{ background: accentRing, color: "#020617" }}>
                      <Check size={12} strokeWidth={3} aria-hidden />
                    </span>
                  )}
                </div>
                <div className="border-t border-white/5 bg-white/[0.02] px-2.5 py-2 group-focus-visible:bg-white/[0.06]">
                  <div className="text-[12.5px] font-medium text-slate-100">{title}</div>
                  <div className="line-clamp-2 text-[10.5px] leading-snug text-slate-400">{sub}</div>
                </div>
                <span aria-hidden className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-inset ring-transparent group-focus-visible:ring-sky-400" />
              </button>
            );
          })}
        </div>
      </div>

      {/* Solar Auto detail */}
      <div className="mx-4 mt-3 rounded-xl border border-white/10 bg-white/[0.02] p-3" aria-live="polite">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-amber-400/10 text-amber-300">
            {solar?.isDay ? <Sunset size={15} aria-hidden /> : <Sunrise size={15} aria-hidden />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-medium text-slate-100">Solar Auto {a.mode === "solar" ? <span className="telemetry text-[10px] text-emerald-300">· ACTIVE</span> : null}</div>
            <p className="text-[11.5px] leading-snug text-slate-300">{solar ? solar.text : "Working out where the sun is…"}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-slate-500">
              <span className="inline-flex items-center gap-1">
                <MapPin size={11} aria-hidden /> {sourceText}
              </span>
              {solar && <span className="telemetry">sun {solar.elevation.toFixed(1)}° · switch at −6° (civil twilight)</span>}
            </p>
          </div>
        </div>
        {loc?.source !== "device" && (
          <button type="button" onClick={useMyLocation} disabled={locating} className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2 py-1 text-[11px] text-slate-300 hover:border-white/25 hover:text-white disabled:opacity-50">
            <LocateFixed size={12} aria-hidden /> {locating ? "Locating…" : "Use my precise location"}
          </button>
        )}
      </div>

      {/* Accent */}
      <div className="px-4 pt-3">
        <div className="hud-label mb-2" id="appearance-accent-label">
          Accent
        </div>
        <div
          role="radiogroup"
          aria-labelledby="appearance-accent-label"
          className="flex flex-wrap gap-2"
          onKeyDown={(e) => {
            const i = ACCENT_IDS.indexOf(a.accent);
            const n = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % ACCENT_IDS.length : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i - 1 + ACCENT_IDS.length) % ACCENT_IDS.length : -1;
            if (n < 0) return;
            e.preventDefault();
            a.setAccent(ACCENT_IDS[n]!);
            (e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=radio]")[n] as HTMLButtonElement | undefined)?.focus();
          }}
        >
          {ACCENT_IDS.map((id) => {
            const acc = ACCENTS[id];
            const on = a.accent === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                onClick={() => a.setAccent(id)}
                className={cn("inline-flex h-9 items-center gap-2 rounded-lg border px-2.5 text-[12px] transition-colors", on ? "border-white/25 bg-white/[0.06] text-white" : "border-white/10 text-slate-300 hover:border-white/20")}
              >
                <span className="theme-raw grid h-4 w-4 place-items-center rounded-full" style={{ background: acc.hex, boxShadow: on ? `0 0 0 2px rgba(255,255,255,.9), 0 0 0 3.5px ${acc.hex}` : undefined }}>
                  {on && <Check size={10} strokeWidth={3.5} color="#020617" aria-hidden />}
                </span>
                {acc.label}
                {id === "emerald" && <span className="text-[10px] text-slate-500">default</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Motion */}
      <div className="px-4 pt-3">
        <div className="hud-label mb-2" id="appearance-motion-label">
          Motion
        </div>
        <div
          role="radiogroup"
          aria-labelledby="appearance-motion-label"
          className="grid grid-cols-3 gap-1 rounded-lg border border-white/10 bg-white/[0.02] p-1"
          onKeyDown={(e) => {
            const opts: MotionPref[] = ["system", "full", "reduced"];
            const i = opts.indexOf(a.motion);
            const n = e.key === "ArrowRight" ? (i + 1) % 3 : e.key === "ArrowLeft" ? (i + 2) % 3 : -1;
            if (n < 0) return;
            e.preventDefault();
            a.setMotion(opts[n]!);
            e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=radio]")[n]?.focus();
          }}
        >
          {(["system", "full", "reduced"] as MotionPref[]).map((m) => {
            const on = a.motion === m;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                onClick={() => a.setMotion(m)}
                className={cn("rounded-md px-2 py-1.5 text-[12px] transition-colors", on ? "bg-white/10 font-medium text-white" : "text-slate-400 hover:text-slate-100")}
              >
                {m === "system" ? "Auto" : m === "full" ? "Full" : "Reduced"}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[10.5px] text-slate-500">
          {a.motion === "system" ? `Following your device (${a.reducedMotion ? "reduce motion is on" : "full motion"}).` : a.motion === "reduced" ? "Animations, glow sweeps and theme reveals are switched off." : "All animations on, including the circular theme reveal."}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/5 px-4 py-2.5 text-[10.5px] text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <Keyboard size={12} aria-hidden /> <kbd className="telemetry rounded border border-white/10 px-1 text-slate-300">{kbd}</kbd> cycle themes
        </span>
        <span>
          <kbd className="telemetry rounded border border-white/10 px-1 text-slate-300">{mac ? "⌘K" : "Ctrl K"}</kbd> → “Appearance”
        </span>
        <span>
          <kbd className="telemetry rounded border border-white/10 px-1 text-slate-300">Esc</kbd> close
        </span>
      </div>
    </motion.div>
  );

  return createPortal(
    <>
      {sheet && <div aria-hidden className="fixed inset-0 z-[2090] bg-black/50" />}
      {body}
    </>,
    document.body
  );
}
