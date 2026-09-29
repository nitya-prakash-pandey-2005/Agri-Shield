/**
 * developerRouter — Developers module (/app/developers) + the workspace
 * security API (nested at `developer.security`, see ./security.ts).
 * Guarded by "use_workspace"; always scoped to ctx.user.orgId.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { permitted, router } from "../trpc";
import { getStore } from "../data/store";
import { deliverWebhook } from "../services/supply-chain";
import { scState } from "../data/sc-state";
import { isAdminRole } from "../services/workspace-state";
import { accessSummary } from "../services/custom-roles";
import {
  SANDBOX_SCOPES,
  SANDBOX_TTL_DAYS,
  createSandboxKey,
  deliveriesFor,
  explorerOperations,
  explorerSend,
  keysFor,
  revokeKey,
  trustedOrigin,
  usageFor,
} from "../services/developer-platform";
import { securityRouter } from "./security";

const proc = permitted("use_workspace");

type Ctx = { user: { id: string; name: string; role: import("@agri-shield/types").UserRole; orgId: string | null }; req?: Request; ip: string };

function orgIdOf(ctx: Ctx): string {
  if (!ctx.user.orgId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Your account is not linked to a workspace." });
  return ctx.user.orgId;
}
const actor = (ctx: Ctx) => ({ id: ctx.user.id, name: getStore().users.find((u) => u.id === ctx.user.id)?.name ?? ctx.user.name ?? "user" });
const canManage = (ctx: Ctx) => isAdminRole(ctx.user.role) || accessSummary({ id: ctx.user.id, role: ctx.user.role, orgId: ctx.user.orgId }).permissions.includes("manage_workspace");
function originOf(ctx: Ctx) {
  try {
    return trustedOrigin(ctx.req?.url);
  } catch (e) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: (e as Error).message });
  }
}

export const developerRouter = router({
  ping: proc.query(() => ({ ok: true })),
  security: securityRouter,

  /** Endpoints from /api/v1/openapi.json, shaped for the explorer form. */
  spec: proc.query(({ ctx }) => {
    const origin = originOf(ctx);
    return { baseUrl: origin, operations: explorerOperations(origin), specUrl: `${origin}/api/v1/openapi.json` };
  }),

  keys: proc.query(({ ctx }) => ({ keys: keysFor(orgIdOf(ctx)), canManage: canManage(ctx), sandboxScopes: SANDBOX_SCOPES, sandboxTtlDays: SANDBOX_TTL_DAYS })),

  /** Sandbox keys: read-only scopes, ags_test_ prefix, auto-expire. Any member may create one for the explorer. */
  createSandboxKey: proc.input(z.object({ name: z.string().trim().min(2).max(40) })).mutation(({ ctx, input }) => {
    const orgId = orgIdOf(ctx);
    const mine = keysFor(orgId).filter((k) => k.sandbox);
    if (mine.length >= 10) throw new TRPCError({ code: "BAD_REQUEST", message: "At most 10 sandbox keys per workspace — revoke an old one first" });
    const { record, key, expiresAt } = createSandboxKey(orgId, input.name, actor(ctx));
    return { id: record.id, prefix: record.prefix, key, expiresAt, scopes: record.scopes };
  }),

  revokeKey: proc.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    const orgId = orgIdOf(ctx);
    const k = keysFor(orgId).find((x) => x.id === input.id);
    if (!k) throw new TRPCError({ code: "NOT_FOUND", message: "Key not found" });
    if (!k.sandbox && !canManage(ctx)) throw new TRPCError({ code: "FORBIDDEN", message: "Only admins can revoke live keys" });
    revokeKey(orgId, input.id, actor(ctx));
    return { ok: true };
  }),

  send: proc
    .input(z.object({ operationId: z.string().max(60), values: z.record(z.string(), z.string().max(500)).default({}), apiKey: z.string().trim().max(200).nullable().default(null) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await explorerSend({ origin: originOf(ctx), orgId: orgIdOf(ctx), operationId: input.operationId, values: input.values, apiKey: input.apiKey || null, ip: ctx.ip });
      } catch (e) {
        if (e instanceof TRPCError) throw e;
        throw new TRPCError({ code: "BAD_REQUEST", message: (e as Error).message });
      }
    }),

  usage: proc.input(z.object({ days: z.number().int().min(7).max(30).default(14) }).optional()).query(({ ctx, input }) => usageFor(orgIdOf(ctx), input?.days ?? 14)),

  deliveries: proc.input(z.object({ webhookId: z.string().nullable().optional(), onlyFailed: z.boolean().optional() }).optional()).query(({ ctx, input }) => ({ ...deliveriesFor(orgIdOf(ctx), { webhookId: input?.webhookId ?? null, onlyFailed: input?.onlyFailed }), canManage: canManage(ctx) })),

  /** Re-send a logged delivery (same event + data, new id/signature/timestamp). */
  redeliver: proc.input(z.object({ deliveryId: z.string() })).mutation(async ({ ctx, input }) => {
    if (!canManage(ctx)) throw new TRPCError({ code: "FORBIDDEN", message: "Only admins can redeliver webhooks" });
    const orgId = orgIdOf(ctx);
    const d = scState().deliveries.find((x) => x.id === input.deliveryId && x.orgId === orgId);
    if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Delivery not found" });
    const w = getStore().webhooks.find((x) => x.id === d.webhookId && x.orgId === orgId);
    if (!w) throw new TRPCError({ code: "NOT_FOUND", message: "Webhook was deleted" });
    let data: Record<string, unknown> = {};
    try {
      data = (JSON.parse(d.requestBody) as { data?: Record<string, unknown> }).data ?? {};
    } catch {
      /* truncated body — send without data */
    }
    const r = await deliverWebhook(w, d.event, { ...data, redelivery_of: d.id }, "test");
    return { id: r.id, ok: r.ok, status: r.status, latencyMs: r.latencyMs, error: r.error };
  }),
});
