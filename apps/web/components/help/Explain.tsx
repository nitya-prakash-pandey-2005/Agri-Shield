"use client";

/**
 * <Explain> — plain-language help for jargon, anywhere in the product.
 *
 *   <Explain term="ec" />                       → small ⓘ icon with a glossary popover
 *   <Explain term="auc">AUC</Explain>           → dotted-underlined text that opens the glossary entry
 *   <Explain text="Share of plots above your threshold">At-risk %</Explain>  → inline custom help
 *
 * Opens on hover (desktop), tap/click or keyboard focus + Enter. Links to the
 * full glossary at /help/glossary#<term>.
 */
import * as Popover from "@radix-ui/react-popover";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { BookOpen, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { GLOSSARY, GLOSSARY_CATEGORIES, lookupTerm } from "./glossary";

export { GLOSSARY, lookupTerm };

export function Explain({
  term,
  text,
  title,
  children,
  className,
  iconSize = 12,
  side = "top",
}: {
  /** Glossary key or alias (case-insensitive): "ec", "dS/m", "return period", "PD"… */
  term?: string;
  /** Custom explanation when no glossary entry fits */
  text?: ReactNode;
  /** Optional heading for custom text */
  title?: string;
  children?: ReactNode;
  className?: string;
  iconSize?: number;
  side?: "top" | "bottom" | "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const entry = term ? lookupTerm(term) : null;
  if (!entry && !text) return <>{children}</>;

  const heading = title ?? entry?.title;
  const hoverOpen = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hoverClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 140);
  };
  const label = `What is ${heading ?? (typeof children === "string" ? children : "this")}?`;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        {children ? (
          <span
            role="button"
            tabIndex={0}
            aria-label={label}
            onMouseEnter={hoverOpen}
            onMouseLeave={hoverClose}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setOpen((o) => !o);
              }
            }}
            className={cn("cursor-help underline decoration-dotted decoration-slate-500 underline-offset-[3px] hover:decoration-cyan-400 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 rounded-sm", className)}
          >
            {children}
          </span>
        ) : (
          <button
            type="button"
            aria-label={label}
            onMouseEnter={hoverOpen}
            onMouseLeave={hoverClose}
            className={cn("inline-grid place-items-center align-middle text-slate-500 hover:text-cyan-300 focus:outline-none focus-visible:text-cyan-300 rounded-full", className)}
          >
            <Info size={iconSize} />
          </button>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side={side}
          align="center"
          sideOffset={6}
          collisionPadding={12}
          onMouseEnter={hoverOpen}
          onMouseLeave={hoverClose}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-[200] w-[min(320px,calc(100vw-24px))] rounded-xl border border-cyan-400/25 bg-[#081022]/95 p-3.5 text-left shadow-[0_12px_40px_-8px_rgba(0,0,0,0.8),0_0_24px_-12px_rgba(56,189,248,0.6)] backdrop-blur-xl data-[state=open]:animate-in data-[state=open]:fade-in-0"
        >
          {entry && <div className="hud-label text-cyan-300/80 mb-1">{GLOSSARY_CATEGORIES[entry.category]}</div>}
          {heading && <div className="font-display text-[13px] font-semibold text-white leading-snug">{heading}</div>}
          <div className="mt-1 text-[12.5px] leading-relaxed text-slate-200">{entry ? entry.short : text}</div>
          {entry && text && <div className="mt-1.5 text-[12px] leading-relaxed text-slate-300">{text}</div>}
          {entry?.example && <div className="mt-2 rounded-lg bg-slate-900/80 px-2.5 py-1.5 text-[11.5px] text-slate-300"><span className="text-slate-500">e.g. </span>{entry.example}</div>}
          {entry && (
            <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-white/5 pt-2">
              {entry.unit ? <span className="telemetry text-[10px] text-slate-500">UNIT · {entry.unit}</span> : <span />}
              <Link href={`/help/glossary#${entry.key}`} className="inline-flex items-center gap-1 text-[11px] text-cyan-300 hover:underline" onClick={() => setOpen(false)}>
                <BookOpen size={11} /> Full glossary
              </Link>
            </div>
          )}
          <Popover.Arrow className="fill-[#081022]" width={10} height={5} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export default Explain;
