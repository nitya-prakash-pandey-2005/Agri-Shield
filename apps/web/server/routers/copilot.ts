/**
 * copilotRouter — "ask anything about your climate risk".
 * Guarded by "use_workspace"; every tool is scoped to ctx.user.orgId
 * (platform admins may pass an orgId to act inside another workspace).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { permitted, router } from "../trpc";
import { askCopilot, clearHistory, contextFor, historyFor, llmConfig, STARTERS } from "../services/copilot";
import { enforceLimit, trackUsage } from "../services/usage";

const proc = permitted("use_workspace");
const orgInput = z.object({ orgId: z.string().max(64).optional() }).optional();

function ctxOrThrow(user: { id: string; name?: string | null; orgId?: string | null; role?: string | null }, orgId?: string) {
  const override = user.role === "platform_admin" ? orgId : undefined;
  const c = contextFor(user, override);
  if (!c) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Copilot needs a workspace — your account is not linked to an organisation." });
  return c;
}

export const copilotRouter = router({
  ping: proc.query(() => ({ ok: true })),

  /** Planner mode, workspace and starter questions for the UI. */
  status: proc.input(orgInput).query(({ ctx, input }) => {
    const c = ctxOrThrow(ctx.user, input?.orgId);
    const llm = llmConfig();
    return {
      orgId: c.orgId,
      orgName: c.orgName,
      industry: c.industry,
      planner: llm ? { mode: "llm" as const, provider: llm.provider, model: llm.model } : { mode: "rules" as const, provider: null, model: null },
      starters: STARTERS[c.industry],
    };
  }),

  ask: proc
    .input(z.object({ question: z.string().trim().min(2).max(500), orgId: z.string().max(64).optional() }))
    .mutation(async ({ ctx, input }) => {
      const c = ctxOrThrow(ctx.user, input.orgId);
      enforceLimit(c.orgId, "messages");
      const answer = await askCopilot(c, input.question);
      trackUsage(c.orgId, "messages");
      return answer;
    }),

  history: proc.input(orgInput).query(({ ctx, input }) => {
    const c = ctxOrThrow(ctx.user, input?.orgId);
    return historyFor(c.userId, c.orgId);
  }),

  clearHistory: proc.input(orgInput).mutation(({ ctx, input }) => {
    const c = ctxOrThrow(ctx.user, input?.orgId);
    clearHistory(c.userId, c.orgId);
    return { ok: true };
  }),
});
