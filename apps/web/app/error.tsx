"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[route error]", error);
  }, [error]);

  const offline = typeof navigator !== "undefined" && !navigator.onLine;

  return (
    <main id="main" className="hud-bg grid min-h-[70vh] place-items-center px-4 py-16 text-slate-200">
      <div className="hud-panel w-full max-w-lg p-7" style={{ ["--hud-accent" as string]: "239 68 68" }} role="alert">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-rose-500/10 ring-1 ring-rose-400/30">
            <AlertTriangle size={20} className="text-rose-300" aria-hidden />
          </span>
          <div>
            <p className="telemetry text-[11px] text-rose-300/80">SUBSYSTEM FAULT</p>
            <h1 className="font-display text-xl font-semibold text-white">This view failed to load</h1>
          </div>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-slate-400">
          {offline
            ? "You’re offline. Reconnect and try again; cached alerts are still available from the farmer dashboard."
            : "Something went wrong while loading this screen. Live data and alerts are unaffected. Try again, or go back to a working page."}
        </p>
        {error.digest && (
          <p className="mt-3 text-xs text-slate-500">
            Reference <span className="telemetry text-slate-400">{error.digest}</span>
          </p>
        )}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={reset} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 font-semibold text-slate-950 hover:bg-emerald-400">
            <RotateCcw size={16} aria-hidden /> Try again
          </button>
          <Link href="/" className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-white/15 px-5 text-white hover:border-white/35">
            Go to home
          </Link>
        </div>
      </div>
    </main>
  );
}
