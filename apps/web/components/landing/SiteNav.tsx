"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { ChevronDown, Command, Menu, X } from "lucide-react";
import { INDUSTRIES } from "@/components/marketing/industries";
import { homeForRole } from "@/lib/rbac";
import { openCommandPalette } from "@/components/command/CommandPaletteHost";
import { cn } from "@/lib/utils";
import { LogoMark, Wordmark } from "./Logo";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

const LINKS = [
  { href: "/#platform", label: "Platform" },
  { href: "/customers", label: "Customers" },
  { href: "/roi", label: "ROI" },
  { href: "/compare", label: "Compare" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
];

function SolutionsMenu({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const active = pathname.startsWith("/solutions");
  useEffect(() => setOpen(false), [pathname]);
  return (
    <li className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        className={cn("inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm transition-colors", active ? "text-white" : "text-slate-400 hover:text-white")}
      >
        Solutions <ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.15 }} className="absolute left-0 top-full pt-2">
            <ul className="grid w-[520px] grid-cols-2 gap-1 rounded-2xl border border-white/10 bg-[#07101f]/95 p-2 shadow-2xl backdrop-blur-xl">
              {INDUSTRIES.map((i) => (
                <li key={i.id}>
                  <Link href={`/solutions/${i.id}`} className="block rounded-xl px-3 py-2.5 hover:bg-white/[0.05]">
                    <span className="flex items-center gap-2 text-sm font-medium text-white">
                      <i className="h-2 w-2 rounded-full" style={{ background: i.accent }} aria-hidden />
                      {i.title}
                    </span>
                    <span className="mt-0.5 line-clamp-1 block pl-4 text-xs text-slate-400">{i.headline}</span>
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/solutions" className="flex h-full items-center rounded-xl px-3 py-2.5 text-sm text-emerald-300 hover:bg-white/[0.05]">
                  All solutions →
                </Link>
              </li>
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

export function SiteNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [mac, setMac] = useState(true);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  const home = session?.user ? homeForRole(session.user.role) : null;

  return (
    <header className={cn("fixed inset-x-0 top-0 z-[900] transition-colors duration-300", scrolled || open ? "border-b border-white/[0.06] bg-[#050a14]/80 backdrop-blur-xl" : "bg-transparent")}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-emerald-500 focus:px-3 focus:py-2 focus:text-slate-950">
        Skip to content
      </a>
      <nav aria-label="Main" className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2" aria-label="Agri-SHIELD home">
          <LogoMark size={26} />
          <Wordmark />
        </Link>
        <ul className="hidden items-center gap-0.5 lg:flex">
          <SolutionsMenu pathname={pathname} />
          {LINKS.map((l) => {
            const active = l.href.startsWith("/#") ? false : pathname.startsWith(l.href);
            return (
              <li key={l.href}>
                <Link href={l.href} className={cn("rounded-lg px-3 py-2 text-sm transition-colors", active ? "text-white" : "text-slate-400 hover:text-white")} aria-current={active ? "page" : undefined}>
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <button
            type="button"
            onClick={openCommandPalette}
            className="hidden h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 text-xs text-slate-400 transition-colors hover:border-white/20 hover:text-white xl:inline-flex"
            aria-label="Open command palette"
          >
            <Command size={13} aria-hidden />
            <span>Search</span>
            <kbd className="telemetry rounded border border-white/10 px-1 text-[10px]">{mac ? "⌘K" : "Ctrl K"}</kbd>
          </button>
          {home ? (
            <Link href={home} className="inline-flex h-9 items-center rounded-lg bg-emerald-500 px-3.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400">
              Open dashboard
            </Link>
          ) : (
            <>
              <Link href="/auth/signin" className="hidden h-9 items-center rounded-lg px-3 text-sm text-slate-300 hover:text-white sm:inline-flex">
                Sign in
              </Link>
              <Link href="/book-demo" className="inline-flex h-9 items-center whitespace-nowrap rounded-lg bg-emerald-500 px-3.5 text-sm font-semibold text-slate-950 shadow-[0_0_24px_-8px_rgba(16,185,129,0.9)] hover:bg-emerald-400">
                Book a demo
              </Link>
            </>
          )}
          <button type="button" className="grid h-10 w-10 place-items-center rounded-lg text-slate-300 hover:bg-white/5 lg:hidden" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen((o) => !o)}>
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </nav>
      <AnimatePresence>
        {open && (
          <motion.div id="mobile-menu" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="max-h-[calc(100svh-4rem)] overflow-y-auto border-t border-white/5 lg:hidden">
            <ul className="space-y-1 px-4 py-3">
              <li>
                <p className="px-3 pb-1 pt-2 text-xs uppercase tracking-wider text-slate-500">Solutions</p>
                <ul className="grid grid-cols-2 gap-1">
                  {INDUSTRIES.map((i) => (
                    <li key={i.id}>
                      <Link href={`/solutions/${i.id}`} onClick={() => setOpen(false)} className="flex min-h-[44px] items-center gap-2 rounded-lg px-3 text-[15px] text-slate-200 hover:bg-white/5">
                        <i className="h-2 w-2 shrink-0 rounded-full" style={{ background: i.accent }} aria-hidden />
                        {i.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
              {LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} onClick={() => setOpen(false)} className="flex min-h-[48px] items-center rounded-lg px-3 text-base text-slate-200 hover:bg-white/5">
                    {l.label}
                  </Link>
                </li>
              ))}
              {!home && (
                <li>
                  <Link href="/auth/signin" className="flex min-h-[48px] items-center rounded-lg px-3 text-base text-slate-200 hover:bg-white/5">
                    Sign in
                  </Link>
                </li>
              )}
              <li>
                <button type="button" onClick={() => { setOpen(false); openCommandPalette(); }} className="flex min-h-[48px] w-full items-center gap-2 rounded-lg px-3 text-base text-slate-400 hover:bg-white/5">
                  <Command size={16} /> Search everything
                </button>
              </li>
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
