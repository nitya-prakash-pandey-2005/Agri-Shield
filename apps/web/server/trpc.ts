/**
 * tRPC v11 foundation: context, auth + permission guards, rate limiting.
 * All inputs are validated with Zod at the procedure level (spec §18).
 */
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { auth } from "@/auth";
import type { Permission } from "@/lib/rbac";
import { rateLimit } from "./rate-limit";
import { ensureLiveRisk } from "./live/district-risk";
// Enterprise security layer: live custom-role resolution, session denylist, IP allow-list
import { denialMessage, resolvePermission } from "./services/custom-roles";
import { isSessionRevoked, touchSession } from "./services/sessions";
import { ipBlockReason } from "./auth/ip-allowlist";

export async function createContext(opts: { req: Request }) {
  const session = await auth();
  const ip = opts.req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  return { session, ip, req: opts.req };
}
export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: { ...shape.data, zodError: error.cause instanceof ZodError ? error.cause.flatten() : null },
    };
  },
});

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;

const limited = t.middleware(({ ctx, next }) => {
  const key = ctx.session?.user?.id ? `u:${ctx.session.user.id}` : `ip:${ctx.ip}`;
  const orgKey = ctx.session?.user?.orgId ? `o:${ctx.session.user.orgId}` : null;
  if (!rateLimit(key, 100) || (orgKey && !rateLimit(orgKey, 1000))) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Rate limit exceeded (100 req/min per user)" });
  }
  ensureLiveRisk(); // non-blocking refresh of live climate overlay
  return next();
});

export const publicProcedure = t.procedure.use(limited);

export const protectedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.session?.user?.id) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in required" });
  const sid = (ctx.session as { sid?: string }).sid;
  // Revoked sessions stop working immediately (the auth() jwt callback also enforces this)
  if (isSessionRevoked(sid)) throw new TRPCError({ code: "UNAUTHORIZED", message: "This session was signed out. Sign in again." });
  const user = ctx.session.user;
  if (user.role !== "platform_admin") {
    const blocked = ipBlockReason(user.orgId, ctx.ip);
    if (blocked) throw new TRPCError({ code: "FORBIDDEN", message: blocked });
  }
  touchSession(sid, { ip: ctx.ip, userAgent: ctx.req?.headers.get("user-agent") ?? undefined });
  return next({ ctx: { ...ctx, user } });
});

/**
 * Permission guard. Built-in RBAC (lib/rbac.ts) unless the member has a
 * workspace custom role, in which case its permission set and module list
 * (checked against the procedure path) apply — see services/custom-roles.ts.
 */
export const permitted = (permission: Permission) =>
  protectedProcedure.use(({ ctx, path, next }) => {
    if (!resolvePermission({ id: ctx.user.id, role: ctx.user.role, orgId: ctx.user.orgId }, permission, path)) {
      throw new TRPCError({ code: "FORBIDDEN", message: denialMessage({ id: ctx.user.id, role: ctx.user.role, orgId: ctx.user.orgId }, permission, path) });
    }
    return next();
  });
