/**
 * Agri-SHIELD Copilot — "ask anything about your climate risk".
 *
 *   askCopilot(ctx, question)
 *     1. LLM planner (function calling) when OPENAI_API_KEY / GROQ_API_KEY /
 *        OLLAMA_BASE_URL is configured — falls back to rules on any failure
 *     2. otherwise the deterministic intent router (intent.ts)
 *   Tools (tools.ts) are scoped to ctx.orgId; answers are composed only
 *   from their outputs. History is kept per user, in memory.
 */
import type { Industry } from "@agri-shield/types";
import { getStore } from "../../data/store";
import { routeQuestion, type Lexicon, type RoutedPlan } from "./intent";
import { llmConfig, runLlm } from "./llm";
import { TOOLS } from "./tools";
import type { CopilotAnswer, CopilotContext, ToolCall, ToolOutput } from "./types";
import { restore, track } from "../../persist";

export type { CopilotAnswer, CopilotContext } from "./types";
export { llmConfig } from "./llm";

// ─── History (per user, in memory) ───────────────────────────────────────

const g = globalThis as unknown as { __copilotHistory?: Map<string, CopilotAnswer[]> };
const COPILOT_HISTORY_VERSION = 1;
track("copilot.history", COPILOT_HISTORY_VERSION, () => g.__copilotHistory);
const HISTORY: Map<string, CopilotAnswer[]> = (g.__copilotHistory ??=
  restore<Map<string, CopilotAnswer[]>>("copilot.history", COPILOT_HISTORY_VERSION, (v) => v instanceof Map) ?? new Map());
const MAX_HISTORY = 40;
const hkey = (userId: string, orgId: string) => `${userId}::${orgId}`;

export function historyFor(userId: string, orgId: string): CopilotAnswer[] {
  return HISTORY.get(hkey(userId, orgId)) ?? [];
}
export function clearHistory(userId: string, orgId: string) {
  HISTORY.delete(hkey(userId, orgId));
}
function remember(userId: string, orgId: string, a: CopilotAnswer) {
  const list = HISTORY.get(hkey(userId, orgId)) ?? [];
  list.push(a);
  if (list.length > MAX_HISTORY) list.splice(0, list.length - MAX_HISTORY);
  HISTORY.set(hkey(userId, orgId), list);
}

// ─── Starter questions per industry ──────────────────────────────────────

export const STARTERS: Record<Industry, string[]> = {
  insurance: [
    "How is my portfolio doing today?",
    "Which parametric policies are closest to the payout trigger?",
    "Top 10 coastal plots by flood risk",
    "What is the flood risk in Satkhira?",
    "Any cyclones near our insured plots?",
    "What is basis risk?",
  ],
  banking: [
    "How much of our loan book is at climate risk?",
    "Which rice loans have the highest salinity risk?",
    "Which borrowers in Bến Tre are at risk?",
    "Compare Bến Tre and Cà Mau for salinity",
    "Rain forecast for Cần Thơ next 7 days",
    "What does EC mean?",
  ],
  ngo: [
    "How many households are in high-risk communities?",
    "How much cash should we pre-position?",
    "Any cyclones near our communities?",
    "Which alert rules fired this week?",
    "Forecast for Satkhira next 3 days",
    "What is anticipatory action?",
  ],
  cooperative: [
    "How are our member farms doing?",
    "List the 10 member farms most exposed to drought",
    "Weather forecast for Kendrapara this week",
    "Compare Puri and Balasore",
    "Which farms have salinity above 4 dS/m?",
    "Explain the composite score",
  ],
  agribusiness: [
    "Summarise risk across our facilities",
    "Top 5 facilities by flood risk",
    "Any disasters within 300 km of our facilities?",
    "Compare Chittagong and Ho Chi Minh City",
    "Rain forecast for Cần Thơ next 7 days",
    "What is the river discharge ratio?",
  ],
  government: [
    "Summarise the situation across our districts",
    "Which districts have the highest flood risk?",
    "Any cyclones or floods near our districts?",
    "Compare Khulna and Satkhira",
    "Rain forecast for Barisal next 3 days",
    "What is a return period?",
  ],
};

// ─── Context ──────────────────────────────────────────────────────────────

export function contextFor(user: { id: string; name?: string | null; orgId?: string | null }, orgOverride?: string): CopilotContext | null {
  const s = getStore();
  const orgId = orgOverride ?? user.orgId ?? null;
  if (!orgId) return null;
  const org = s.orgs.find((o) => o.id === orgId);
  if (!org) return null;
  const industry: Industry = org.industry ?? (org.type === "government" ? "government" : org.type === "ngo" ? "ngo" : org.type === "insurance" ? "insurance" : org.type === "bank" ? "banking" : org.type === "cooperative" ? "cooperative" : "agribusiness");
  return { orgId, userId: user.id, userName: user.name ?? "there", industry, orgName: org.name };
}

function lexiconFor(orgId: string): Lexicon {
  const s = getStore();
  return {
    districts: s.districts.map((d) => d.name),
    assetNames: s.assets.filter((a) => a.workspaceId === orgId && a.status === "active" && a.type !== "loan").map((a) => a.name),
  };
}

// ─── Answer composition ──────────────────────────────────────────────────

let seq = 0;
const newId = () => `cop_${Date.now().toString(36)}_${(++seq).toString(36)}`;
const uniq = <T,>(a: T[]) => Array.from(new Set(a));

function helpAnswer(ctx: CopilotContext): Pick<CopilotAnswer, "markdown" | "followUps"> {
  return {
    markdown: [
      `Hi ${ctx.userName.split(" ")[0]} — I answer questions about **${ctx.orgName}**'s climate risk using your workspace data and live forecasts. I can:`,
      "- **Summarise your portfolio** and rank assets by flood, salinity, drought or heat risk (with filters like country, crop, tag or thresholds)",
      "- **Look up one asset** by name or reference and explain what drives its score",
      "- **Assess or forecast any place on Earth**, or compare up to four places",
      "- Report **alert rules, notifications and live hazard events** near your assets",
      "- Give **insurance, lending and anticipatory-action** figures, and **explain any metric** in plain language",
      "I didn't recognise a question I can answer from data in that message — try one of the suggestions below.",
    ].join("\n"),
    followUps: STARTERS[ctx.industry].slice(0, 4),
  };
}

type RunResult = { call: ToolCall; out: ToolOutput; ms: number; ok: boolean };

async function runCall(ctx: CopilotContext, call: ToolCall): Promise<RunResult> {
  const t0 = Date.now();
  try {
    const out = await TOOLS[call.tool](ctx, call.args);
    return { call, out, ms: Date.now() - t0, ok: !out.notFound };
  } catch (err) {
    const msg = `The ${call.tool.replace(/_/g, " ")} tool failed: ${(err as Error).message}`;
    return { call, out: { data: { error: msg }, markdown: msg, artifacts: [], actions: [], sources: [] }, ms: Date.now() - t0, ok: false };
  }
}

async function runPlan(ctx: CopilotContext, plan: RoutedPlan): Promise<RunResult[]> {
  const results = await Promise.all(plan.calls.map((c) => runCall(ctx, c)));
  // A portfolio question about a place where the workspace has no assets → assess the place itself
  const miss = results.find((r) => (r.call.tool === "top_risk_assets" || r.call.tool === "portfolio_summary") && r.out.notFound && typeof r.call.args.area === "string");
  if (miss) {
    const place = miss.call.args.area as string;
    const extra = await runCall(ctx, { tool: "assess_location", args: { place, ...(plan.entities.hazard && plan.entities.hazard !== "composite" ? { focus: plan.entities.hazard } : {}) } });
    if (extra.ok) {
      extra.out.markdown = `${miss.out.markdown} Here is the location assessment for ${place} instead:\n\n${extra.out.markdown}`;
      return [...results.filter((r) => r !== miss), extra];
    }
  }
  return results;
}

function assemble(ctx: CopilotContext, question: string, intent: string, results: RunResult[], text: string | null, planner: CopilotAnswer["planner"], t0: number): CopilotAnswer {
  const markdown = text ?? results.map((r) => r.out.markdown).filter(Boolean).join("\n\n");
  return {
    id: newId(),
    question,
    markdown: markdown || "I couldn't find data to answer that.",
    artifacts: results.flatMap((r) => r.out.artifacts),
    actions: uniq(results.flatMap((r) => r.out.actions).map((a) => JSON.stringify(a))).map((s) => JSON.parse(s)).slice(0, 5),
    followUps: uniq(results.flatMap((r) => r.out.followUps ?? [])).filter((f) => f.toLowerCase() !== question.toLowerCase()).slice(0, 4),
    sources: uniq(results.flatMap((r) => r.out.sources)),
    toolsUsed: results.map((r) => ({ tool: r.call.tool, args: r.call.args, ms: r.ms, ok: r.ok })),
    planner,
    intent,
    createdAt: new Date().toISOString(),
    ms: Date.now() - t0,
  };
}

export async function askCopilot(ctx: CopilotContext, question: string): Promise<CopilotAnswer> {
  const t0 = Date.now();
  const q = question.trim().slice(0, 500);
  const plan = routeQuestion(q, lexiconFor(ctx.orgId));
  let answer: CopilotAnswer | null = null;

  const cfg = llmConfig();
  if (cfg) {
    try {
      const hist = historyFor(ctx.userId, ctx.orgId).slice(-3).map((h) => ({ q: h.question, a: h.markdown }));
      const run = await runLlm(ctx, q, hist);
      if (run.outputs.length && run.text) {
        const results = run.outputs.map((o) => ({ call: { tool: o.tool, args: o.args }, out: o.out, ms: o.ms, ok: o.ok }));
        answer = assemble(ctx, q, run.outputs.map((o) => o.tool).join("+"), results, run.text, run.provider, t0);
      }
      // A model answer with no tool calls is not grounded in data → use the deterministic plan instead.
    } catch {
      answer = null;
    }
  }

  if (!answer) {
    if (plan.intent === "help" || !plan.calls.length) {
      const h = helpAnswer(ctx);
      answer = { id: newId(), question: q, markdown: h.markdown, artifacts: [], actions: [], followUps: h.followUps, sources: [], toolsUsed: [], planner: "rules", intent: "help", createdAt: new Date().toISOString(), ms: Date.now() - t0 };
    } else {
      const results = await runPlan(ctx, plan);
      answer = assemble(ctx, q, plan.intent, results, null, "rules", t0);
    }
  }
  remember(ctx.userId, ctx.orgId, answer);
  return answer;
}
