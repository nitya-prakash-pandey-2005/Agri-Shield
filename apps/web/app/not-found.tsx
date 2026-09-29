import Link from "next/link";
import type { Metadata } from "next";
import { Compass } from "lucide-react";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

export default function NotFound() {
  return (
    <main id="main" className="hud-bg relative grid min-h-screen place-items-center overflow-hidden px-4 text-slate-200">
      <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="h-[520px] w-[520px] rounded-full border border-emerald-400/10" />
        <div className="absolute h-[360px] w-[360px] rounded-full border border-emerald-400/10" />
        <div className="absolute h-[200px] w-[200px] rounded-full border border-dashed border-emerald-400/15" />
      </div>
      <div className="relative max-w-md text-center">
        <p className="telemetry text-sm text-emerald-400/80">ERR 404 · NO SIGNAL AT THESE COORDINATES</p>
        <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">This page isn’t on the map.</h1>
        <p className="mt-4 text-slate-400">The link may be old, or the page moved. Everything else is still being watched.</p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href="/" className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-emerald-500 px-6 font-semibold text-slate-950 hover:bg-emerald-400">
            Back to home
          </Link>
          <Link href="/#demo" className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-white/15 px-6 text-white hover:border-white/35">
            <Compass size={16} aria-hidden /> Open the live map
          </Link>
        </div>
        <p className="mt-6 text-xs text-slate-500">
          Tip: press <kbd className="telemetry rounded border border-white/15 px-1">Ctrl K</kbd> to search every page and district.
        </p>
      </div>
    </main>
  );
}
