"use client";

/** Renders a QR matrix produced server-side by server/auth/qr.ts (one SVG path). */
export function QrCode({ path, viewBox, label, size = 208 }: { path: string; viewBox: number; label: string; size?: number }) {
  return (
    <div className="relative inline-block rounded-xl bg-white p-2 shadow-[0_0_40px_-8px_rgba(56,189,248,0.55)]">
      <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${viewBox} ${viewBox}`} shapeRendering="crispEdges" className="block">
        <rect width="100%" height="100%" fill="#fff" />
        <path d={path} fill="#020617" />
      </svg>
      {/* HUD corner brackets */}
      {["-left-1.5 -top-1.5 border-l-2 border-t-2", "-right-1.5 -top-1.5 border-r-2 border-t-2", "-bottom-1.5 -left-1.5 border-b-2 border-l-2", "-bottom-1.5 -right-1.5 border-b-2 border-r-2"].map((c) => (
        <span key={c} className={`pointer-events-none absolute h-4 w-4 border-cyan-300/80 ${c}`} />
      ))}
    </div>
  );
}
