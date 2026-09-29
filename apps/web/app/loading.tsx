/** Root route-transition state: a quiet HUD scan, no spinner. */
export default function Loading() {
  return (
    <div className="hud-bg grid min-h-screen place-items-center" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-4">
        <div className="relative h-16 w-16">
          <div className="absolute inset-0 rounded-full border border-emerald-400/20" />
          <div className="absolute inset-0 animate-spin rounded-full border-t-2 border-emerald-400 [animation-duration:1.4s] motion-reduce:animate-none" />
          <div className="absolute inset-[22px] rounded-full bg-emerald-400/70 shadow-[0_0_18px_rgba(52,211,153,0.9)]" />
        </div>
        <span className="telemetry text-[11px] tracking-[0.18em] text-slate-500">SYNCING CLIMATE FEEDS</span>
        <span className="sr-only">Loading</span>
      </div>
    </div>
  );
}
