"use client";

/** Last-resort boundary: replaces the root layout, so it must render its own <html>/<body> and inline styles. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#050a14", color: "#e2e8f0", fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif", padding: 16 }}>
        <main role="alert" style={{ maxWidth: 440, width: "100%", border: "1px solid rgba(148,163,184,.18)", borderRadius: 16, padding: 28, background: "rgba(15,23,42,.7)" }}>
          <p style={{ margin: 0, fontFamily: "ui-monospace, Consolas, monospace", fontSize: 11, letterSpacing: ".12em", color: "#fca5a5" }}>CRITICAL FAULT</p>
          <h1 style={{ margin: "8px 0 0", fontSize: 22, color: "#fff" }}>Agri-SHIELD couldn’t start this page</h1>
          <p style={{ margin: "12px 0 0", fontSize: 14, lineHeight: 1.6, color: "#94a3b8" }}>
            Reload to try again. If you’re in the field without signal, text STATUS to the Agri-SHIELD number for your farm’s risk by SMS.
          </p>
          {error.digest && <p style={{ margin: "12px 0 0", fontSize: 12, color: "#64748b" }}>Reference {error.digest}</p>}
          <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
            <button onClick={reset} style={{ minHeight: 44, padding: "0 18px", borderRadius: 12, border: 0, background: "#10b981", color: "#04120c", fontWeight: 600, cursor: "pointer" }}>
              Try again
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" style={{ minHeight: 44, padding: "0 18px", borderRadius: 12, border: "1px solid rgba(255,255,255,.2)", color: "#fff", display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
              Go to home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
