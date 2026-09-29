"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CloudOff, RefreshCw, Wifi } from "lucide-react";

const CACHED_LINKS = [
  { href: "/dashboard/farmer", label: "My fields & risk" },
  { href: "/dashboard/farmer/alerts", label: "Alerts (last 72 h)" },
  { href: "/dashboard/farmer/map", label: "Farm map" },
];

export function OfflineClient() {
  const [online, setOnline] = useState(false);
  const [queued, setQueued] = useState<number | null>(null);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const onMsg = (e: MessageEvent) => e.data?.type === "QUEUE_SIZE" && setQueued(e.data.count);
    navigator.serviceWorker?.addEventListener("message", onMsg);
    navigator.serviceWorker?.controller?.postMessage({ type: "QUEUE_SIZE" });
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      navigator.serviceWorker?.removeEventListener("message", onMsg);
    };
  }, []);

  return (
    <div className="hud-panel w-full max-w-md p-7 text-center">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-amber-400/10 ring-1 ring-amber-400/30">
        {online ? <Wifi size={28} className="text-emerald-300" aria-hidden /> : <CloudOff size={28} className="text-amber-300" aria-hidden />}
      </div>
      <h1 className="mt-5 font-display text-2xl font-semibold text-white">{online ? "You’re back online" : "No connection right now"}</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">
        {online
          ? "Reload to get the latest forecasts and alerts."
          : "This page wasn’t saved for offline use. Pages you opened recently, and the last 72 hours of alerts, still work without a connection."}
      </p>
      {queued !== null && queued > 0 && (
        <p className="mt-3 rounded-lg bg-white/[0.04] px-3 py-2 text-xs text-slate-300" role="status">
          {queued} action{queued === 1 ? "" : "s"} saved on this phone will sync when you reconnect.
        </p>
      )}
      <button type="button" onClick={() => window.location.reload()} className="mt-6 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 font-semibold text-slate-950 hover:bg-emerald-400">
        <RefreshCw size={16} aria-hidden /> Try again
      </button>
      <nav aria-label="Available offline" className="mt-6 border-t border-white/[0.07] pt-5 text-left">
        <p className="text-xs text-slate-500">Usually available offline</p>
        <ul className="mt-2 space-y-1">
          {CACHED_LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="flex min-h-[44px] items-center rounded-lg px-3 text-sm text-slate-200 hover:bg-white/[0.04]">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-slate-500">
          No smartphone signal? Text <span className="telemetry text-slate-300">STATUS</span> to the Agri-SHIELD number for your farm’s risk by SMS.
        </p>
      </nav>
    </div>
  );
}
