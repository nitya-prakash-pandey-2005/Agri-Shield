"use client";

/**
 * PWA runtime (spec §7):
 *  - registers /sw.js (production, or dev with NEXT_PUBLIC_SW_DEV=true)
 *  - online / offline status toasts + background-sync replay on reconnect
 *  - install prompt banner (beforeinstallprompt) and an iOS "Add to Home Screen" hint
 */
import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { AnimatePresence, motion } from "framer-motion";
import { Download, Share, X } from "lucide-react";
import { toast } from "sonner";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const SW_ENABLED = process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_SW_DEV === "true";
const DISMISS_KEY = "agri_install_dismissed_at";
const DISMISS_DAYS = 14;
const OFFLINE_TOAST = "agri-offline";

function recentlyDismissed() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return Date.now() - at < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

function postToSw(message: unknown) {
  navigator.serviceWorker?.controller?.postMessage(message);
}

export function PwaManager() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [visible, setVisible] = useState(false);
  const { status } = useSession();
  const prevStatus = useRef(status);

  // Signing out clears cached personal pages + farmer data from the service worker
  useEffect(() => {
    if (prevStatus.current === "authenticated" && status === "unauthenticated") postToSw({ type: "CLEAR_USER_CACHE" });
    prevStatus.current = status;
  }, [status]);

  // Service worker registration
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (!SW_ENABLED) {
      // keep dev servers free of stale workers from a previous production run
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => undefined);
      return;
    }
    let cancelled = false;
    const register = () =>
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((reg) => {
          if (cancelled) return;
          reg.addEventListener("updatefound", () => {
            const next = reg.installing;
            next?.addEventListener("statechange", () => {
              if (next.state === "installed" && navigator.serviceWorker.controller) {
                toast("A new version of Agri-SHIELD is ready", {
                  action: { label: "Reload", onClick: () => window.location.reload() },
                  duration: 12_000,
                });
              }
            });
          });
        })
        .catch(() => undefined);
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    const onMessage = (e: MessageEvent) => {
      const m = e.data as { type?: string; count?: number; sent?: number; remaining?: number };
      if (m?.type === "ACTION_QUEUED") {
        toast.info("Saved offline", { description: `Your action is queued (${m.count ?? 1} pending) and will sync automatically when you're back online.` });
      } else if (m?.type === "QUEUE_REPLAYED") {
        toast.success(`Synced ${m.sent} offline action${m.sent === 1 ? "" : "s"}`, {
          description: m.remaining ? `${m.remaining} still waiting for a connection.` : "Your district officer can now see them.",
        });
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, []);

  // Connectivity toasts
  useEffect(() => {
    const offline = () =>
      toast.warning("You're offline", {
        id: OFFLINE_TOAST,
        description: "Showing the last 72 h of cached alerts and maps. Actions you take are queued and synced later.",
        duration: Infinity,
      });
    const online = () => {
      toast.dismiss(OFFLINE_TOAST);
      toast.success("Back online", { description: "Live climate data restored.", duration: 3500 });
      postToSw({ type: "REPLAY_QUEUE" });
    };
    if (!navigator.onLine) offline();
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, []);

  // Install prompt
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    if (standalone || recentlyDismissed()) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      window.setTimeout(() => setVisible(true), 15_000);
    };
    const onInstalled = () => {
      setVisible(false);
      setDeferred(null);
      toast.success("Agri-SHIELD installed", { description: "Alerts now work even in low-connectivity fields." });
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    const ua = navigator.userAgent;
    const isIos = /iphone|ipad|ipod/i.test(ua) && /safari/i.test(ua) && !/crios|fxios/i.test(ua);
    let t: number | undefined;
    if (isIos && window.location.pathname.startsWith("/dashboard/farmer")) {
      t = window.setTimeout(() => {
        setIosHint(true);
        setVisible(true);
      }, 20_000);
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      if (t) window.clearTimeout(t);
    };
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* private mode */
    }
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice.catch(() => null);
    if (choice?.outcome !== "accepted") dismiss();
    setDeferred(null);
    setVisible(false);
  };

  return (
    <AnimatePresence>
      {visible && (deferred || iosHint) && (
        <motion.aside
          role="dialog"
          aria-label="Install Agri-SHIELD"
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 28 }}
          className="fixed inset-x-3 bottom-3 z-[1200] mx-auto max-w-md rounded-2xl border border-emerald-400/25 bg-[#07101f]/95 p-4 shadow-[0_20px_60px_-20px_rgba(16,185,129,0.45)] backdrop-blur-xl sm:inset-x-auto sm:right-5 sm:bottom-5"
        >
          <div className="flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon-192.png" alt="" width={44} height={44} className="rounded-xl" />
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm font-semibold text-white">Install Agri-SHIELD</p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
                {iosHint && !deferred ? (
                  <>
                    Tap <Share size={12} className="inline -mt-0.5" aria-label="Share" /> then <strong className="text-slate-200">Add to Home Screen</strong> to get alerts offline.
                  </>
                ) : (
                  "Works offline in the field, opens instantly and delivers flood alerts as notifications."
                )}
              </p>
              {deferred && (
                <div className="mt-3 flex gap-2">
                  <button onClick={install} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">
                    <Download size={15} /> Install app
                  </button>
                  <button onClick={dismiss} className="min-h-[40px] rounded-lg px-3 text-sm text-slate-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">
                    Not now
                  </button>
                </div>
              )}
            </div>
            <button onClick={dismiss} aria-label="Dismiss install prompt" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-white">
              <X size={16} />
            </button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
