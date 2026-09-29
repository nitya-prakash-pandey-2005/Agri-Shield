"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Command, Menu, X } from "lucide-react";
import { homeForRole } from "@/lib/rbac";
import { openCommandPalette } from "@/components/command/CommandPaletteHost";
import { cn } from "@/lib/utils";
import { LogoMark, Wordmark } from "./Logo";

const LINKS = [
  { href: "/#how-it-works", label: "Platform" },
  { href: "/#demo", label: "Live map" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
  { href: "/pitch", label: "Pitch" },
];

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
        <ul className="hidden items-center gap-1 md:flex">
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
          <button
            type="button"
            onClick={openCommandPalette}
            className="hidden h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 text-xs text-slate-400 transition-colors hover:border-white/20 hover:text-white lg:inline-flex"
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
              <Link href="/auth/signup" className="inline-flex h-9 items-center rounded-lg bg-emerald-500 px-3.5 text-sm font-semibold text-slate-950 shadow-[0_0_24px_-8px_rgba(16,185,129,0.9)] hover:bg-emerald-400">
                Get started
              </Link>
            </>
          )}
          <button type="button" className="grid h-10 w-10 place-items-center rounded-lg text-slate-300 hover:bg-white/5 md:hidden" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen((o) => !o)}>
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </nav>
      <AnimatePresence>
        {open && (
          <motion.div id="mobile-menu" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-white/5 md:hidden">
            <ul className="space-y-1 px-4 py-3">
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
