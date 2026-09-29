"use client";

/**
 * Web Push on this device: support detection, permission, subscribe /
 * unsubscribe against the server's VAPID key (push.* tRPC router), the
 * user's device list. Re-subscription after the push service rotates a
 * subscription (sw.js → PUSH_RESUBSCRIBE) is handled app-wide by PushSync.
 *
 * iOS / iPadOS only expose PushManager to web apps added to the Home Screen
 * (16.4+), so a Safari tab reports "ios-install" and the UI shows how to install.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";

export type PushStatus =
  | "loading"
  | "unsupported" // no serviceWorker / PushManager / Notification
  | "insecure" // not HTTPS (localhost is fine)
  | "ios-install" // iOS Safari tab: must be installed to the Home Screen first
  | "sw-disabled" // development build without NEXT_PUBLIC_SW_DEV=true
  | "denied" // user blocked notifications for this site
  | "off" // can be enabled
  | "on"; // this device is subscribed and registered on the server

const SW_ENABLED = process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_SW_DEV === "true";
/** Set while the user wants push on this device; PushSync uses it to repair lost subscriptions. */
export const PUSH_OPT_IN_KEY = "agri_push_opt_in";

export function setPushOptIn(on: boolean) {
  try {
    if (on) localStorage.setItem(PUSH_OPT_IN_KEY, "1");
    else localStorage.removeItem(PUSH_OPT_IN_KEY);
  } catch {
    /* private mode */
  }
}

export function pushOptedIn(): boolean {
  try {
    return localStorage.getItem(PUSH_OPT_IN_KEY) === "1";
  } catch {
    return false;
  }
}

/** VAPID public key (base64url) → Uint8Array for PushManager.subscribe(). */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

export function detectPushSupport(): { status: Exclude<PushStatus, "loading" | "denied" | "off" | "on"> | null; ios: boolean; standalone: boolean } {
  const ua = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const apis = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!window.isSecureContext) return { status: "insecure", ios, standalone };
  if (ios && !standalone) return { status: "ios-install", ios, standalone };
  if (!apis) return { status: "unsupported", ios, standalone };
  if (!SW_ENABLED) return { status: "sw-disabled", ios, standalone };
  return { status: null, ios, standalone };
}

/** The app's service worker registration (registers /sw.js if PwaManager hasn't yet). */
export async function pushRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator) || !SW_ENABLED) return null;
  const existing = await navigator.serviceWorker.getRegistration("/");
  const reg = existing ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
  // wait (bounded) until a worker is active so pushManager.subscribe() succeeds
  if (!reg.active) await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 8000))]);
  return reg;
}

/** Subscribe the browser with the given VAPID key; replaces a subscription made with an old key. */
export async function browserSubscribe(publicKey: string): Promise<PushSubscription> {
  const reg = await pushRegistration();
  if (!reg) throw new Error("Service worker unavailable");
  const key = urlBase64ToUint8Array(publicKey);
  const current = await reg.pushManager.getSubscription();
  if (current && sameKey(current.options?.applicationServerKey, key)) return current;
  if (current) await current.unsubscribe().catch(() => false);
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

export function subscriptionJSON(sub: PushSubscription) {
  const j = sub.toJSON();
  return { endpoint: sub.endpoint, expirationTime: j.expirationTime ?? null, keys: { p256dh: j.keys?.p256dh ?? "", auth: j.keys?.auth ?? "" } };
}

export function usePushNotifications({ enabled = true }: { enabled?: boolean } = {}) {
  const [support, setSupport] = useState<ReturnType<typeof detectPushSupport> | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "unknown">("unknown");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "subscribe" | "unsubscribe" | "test">(null);
  const [error, setError] = useState<string | null>(null);

  const available = enabled && !!support && support.status === null;
  const key = trpc.push.publicKey.useQuery(undefined, { enabled: available, staleTime: Infinity, retry: 1 });
  const devices = trpc.push.list.useQuery(undefined, { enabled: enabled && !!support, staleTime: 30_000 });
  const utils = trpc.useUtils();
  const subscribeM = trpc.push.subscribe.useMutation();
  const unsubscribeM = trpc.push.unsubscribe.useMutation();
  const testM = trpc.push.test.useMutation();

  // Detect support + current browser subscription (client only)
  useEffect(() => {
    const s = detectPushSupport();
    setSupport(s);
    if ("Notification" in window) setPermission(Notification.permission);
    if (s.status !== null) return;
    let alive = true;
    navigator.serviceWorker
      .getRegistration("/")
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => alive && setEndpoint(sub?.endpoint ?? null))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const register = useCallback(
    async (publicKey: string) => {
      const sub = await browserSubscribe(publicKey);
      await subscribeM.mutateAsync({ subscription: subscriptionJSON(sub) });
      setEndpoint(sub.endpoint);
      await utils.push.list.invalidate();
      return sub;
    },
    [subscribeM, utils]
  );

  // The browser still has a subscription the server doesn't know (restart without persistence,
  // another account used this device before): quietly re-register it for the current user.
  const listed = devices.data?.some((d) => d.endpoint === endpoint) ?? false;
  const synced = useRef<string | null>(null);
  useEffect(() => {
    if (!available || !endpoint || !devices.isSuccess || listed || !key.data || permission !== "granted" || busy || synced.current === endpoint) return;
    synced.current = endpoint;
    register(key.data.publicKey).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, endpoint, devices.isSuccess, listed, key.data, permission, busy]);

  const subscribe = useCallback(async () => {
    setError(null);
    setBusy("subscribe");
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") throw new Error(perm === "denied" ? "Notifications are blocked for this site." : "Permission was not granted.");
      const publicKey = key.data?.publicKey ?? (await utils.push.publicKey.fetch()).publicKey;
      const sub = await register(publicKey);
      synced.current = sub.endpoint;
      setPushOptIn(true);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }, [key.data, register, utils]);

  const unsubscribe = useCallback(async () => {
    setError(null);
    setBusy("unsubscribe");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      const ep = sub?.endpoint ?? endpoint;
      await sub?.unsubscribe().catch(() => false);
      setPushOptIn(false);
      if (ep) await unsubscribeM.mutateAsync({ endpoint: ep });
      setEndpoint(null);
      await utils.push.list.invalidate();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }, [endpoint, unsubscribeM, utils]);

  const removeDevice = useCallback(
    async (id: string) => {
      const d = devices.data?.find((x) => x.id === id);
      if (d && d.endpoint === endpoint) return unsubscribe();
      await unsubscribeM.mutateAsync({ id });
      await utils.push.list.invalidate();
      return true;
    },
    [devices.data, endpoint, unsubscribe, unsubscribeM, utils]
  );

  const sendTest = useCallback(async () => {
    setError(null);
    setBusy("test");
    try {
      const r = await testM.mutateAsync();
      await utils.push.list.invalidate();
      return r;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(null);
    }
  }, [testM, utils]);

  const status: PushStatus = useMemo(() => {
    if (!support) return "loading";
    if (support.status) return support.status;
    if (permission === "denied") return "denied";
    if (endpoint && permission === "granted" && (listed || devices.isLoading)) return "on";
    return "off";
  }, [support, permission, endpoint, listed, devices.isLoading]);

  return {
    status,
    permission,
    ios: support?.ios ?? false,
    standalone: support?.standalone ?? false,
    endpoint,
    devices: devices.data ?? [],
    devicesLoading: devices.isLoading,
    serverSending: key.data?.sending ?? true,
    busy,
    error,
    subscribe,
    unsubscribe,
    removeDevice,
    sendTest,
  };
}
