/**
 * Web Push device registration (server/notify/webpush.ts).
 *
 *   push.publicKey    VAPID application server key for PushManager.subscribe()
 *   push.subscribe    register this browser's PushSubscription for the signed-in user
 *   push.unsubscribe  remove one of my devices (by endpoint or id)
 *   push.list         my subscribed devices
 *   push.test         send a test notification to all my devices (3 / min)
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import { rateLimit } from "../rate-limit";
import { listSubscriptions, pushSendingEnabled, pushServiceFor, removeSubscription, saveSubscription, sendPushToUser, vapidConfig } from "../notify/webpush";

const b64url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/, "must be base64url");

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048).refine((e) => !!pushServiceFor(e), "Unsupported push service endpoint"),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: b64url.min(16).max(256), auth: b64url.min(8).max(64) }),
});

/** Farmers land in the farmer app; every organisation role has the workspace alert centre. */
const alertsUrlFor = (role: string | undefined) => (role === "farmer" ? "/dashboard/farmer/alerts" : "/app/alerts");

const view = (s: ReturnType<typeof listSubscriptions>[number]) => ({
  id: s.id,
  endpoint: s.endpoint,
  label: s.label,
  service: s.service,
  createdAt: s.createdAt,
  lastSuccessAt: s.lastSuccessAt,
  lastError: s.lastError,
  failures: s.failures,
});

export const pushRouter = router({
  publicKey: protectedProcedure.query(() => {
    const v = vapidConfig();
    return { publicKey: v.publicKey, source: v.source, sending: pushSendingEnabled() };
  }),

  subscribe: protectedProcedure.input(z.object({ subscription: pushSubscriptionSchema, label: z.string().trim().max(60).optional() })).mutation(({ ctx, input }) => {
    const rec = saveSubscription({
      userId: ctx.user.id,
      orgId: ctx.user.orgId ?? null,
      subscription: input.subscription,
      userAgent: ctx.req?.headers.get("user-agent") ?? null,
      label: input.label,
    });
    return view(rec);
  }),

  unsubscribe: protectedProcedure
    .input(z.object({ endpoint: z.string().max(2048).optional(), id: z.string().max(64).optional() }).refine((v) => !!(v.endpoint || v.id), "endpoint or id required"))
    .mutation(({ ctx, input }) => ({ removed: removeSubscription(input, ctx.user.id) })),

  list: protectedProcedure.query(({ ctx }) => listSubscriptions(ctx.user.id).map(view)),

  test: protectedProcedure.mutation(async ({ ctx }) => {
    if (!rateLimit(`push-test:${ctx.user.id}`, 3)) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Please wait a minute before sending another test notification." });
    const devices = listSubscriptions(ctx.user.id).length;
    if (!devices) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No devices are subscribed yet. Enable notifications on this device first." });
    const r = await sendPushToUser(ctx.user.id, {
      title: "Agri-SHIELD test notification",
      body: "Notifications are working on this device. Flood and salinity alerts will arrive here.",
      severity: "watch",
      tag: "agri-test",
      url: alertsUrlFor(ctx.user.role),
    });
    return r;
  }),
});
