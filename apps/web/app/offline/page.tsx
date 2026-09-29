import type { Metadata } from "next";
import { OfflineClient } from "./OfflineClient";

export const metadata: Metadata = {
  title: "Offline",
  robots: { index: false },
};

/** Precached by the service worker; served for any navigation that fails while offline. */
export default function OfflinePage() {
  return (
    <main id="main" className="hud-bg grid min-h-screen place-items-center px-4 py-16 text-slate-200">
      <OfflineClient />
    </main>
  );
}
