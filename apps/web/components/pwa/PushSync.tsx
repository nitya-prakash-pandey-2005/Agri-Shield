"use client";

/**
 * Keeps this device's Web Push subscription registered for the signed-in user
 * (mounted by PwaManager while authenticated; renders nothing):
 *  - once per session, if the user opted in and permission is granted, makes sure
 *    the browser subscription exists for the server's current VAPID key and is
 *    registered (repairs expired subscriptions, key changes, server restarts)
 *  - on PUSH_RESUBSCRIBE from sw.js (`pushsubscriptionchange`) subscribes again
 */
import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { browserSubscribe, detectPushSupport, pushOptedIn, subscriptionJSON } from "./usePushNotifications";

const SYNC_KEY = "agri_push_synced";

export function PushSync({ userId }: { userId: string }) {
  const utils = trpc.useUtils();

  useEffect(() => {
    if (detectPushSupport().status !== null) return;
    let busy = false;
    const sync = async () => {
      if (busy || Notification.permission !== "granted" || !pushOptedIn()) return;
      busy = true;
      try {
        const { publicKey } = await utils.client.push.publicKey.query();
        const sub = await browserSubscribe(publicKey);
        await utils.client.push.subscribe.mutate({ subscription: subscriptionJSON(sub) });
        await utils.push.list.invalidate();
      } catch {
        /* offline or permission revoked: try again next session */
      } finally {
        busy = false;
      }
    };

    let done = false;
    try {
      done = sessionStorage.getItem(SYNC_KEY) === userId;
      if (!done) sessionStorage.setItem(SYNC_KEY, userId);
    } catch {
      /* private mode */
    }
    if (!done) void sync();

    const onMessage = (e: MessageEvent) => {
      if ((e.data as { type?: string } | null)?.type === "PUSH_RESUBSCRIBE") void sync();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [userId, utils]);

  return null;
}
