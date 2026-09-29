/**
 * Copilot tools cross-checked against the store (offline: live feeds fall back
 * to district baselines, so these tests never touch the network).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { getStore } from "@/server/data/store";
import { askCopilot, contextFor } from "@/server/services/copilot";
import { TOOLS } from "@/server/services/copilot/tools";
import type { CopilotContext } from "@/server/services/copilot/types";

const ctxOf = (userId: string): CopilotContext => {
  const u = getStore().users.find((x) => x.id === userId)!;
  return contextFor(u)!;
};

let ins: CopilotContext;
let bank: CopilotContext;
let ngo: CopilotContext;
beforeAll(() => {
  ins = ctxOf("user-insurer-demo");
  bank = ctxOf("user-bank-demo");
  ngo = ctxOf("user-ngo-demo");
});

const assetsOf = (org: string) => getStore().assets.filter((a) => a.workspaceId === org && a.status === "active");

describe("copilot tools — numbers match the store", () => {
  it("insurance stats: policies, sum insured and premium", async () => {
    const out = await TOOLS.insurance_stats(ins, {});
    const plots = assetsOf("org-ins-deltamutual").filter((a) => a.type === "insured_plot");
    expect(out.data.policies).toBe(plots.length);
    expect(out.data.sumInsuredUsd).toBe(plots.reduce((t, a) => t + a.valueUsd, 0));
    expect(out.data.premiumUsd).toBe(plots.reduce((t, a) => t + Number(a.meta.premiumUsd ?? 0), 0));
    expect(out.markdown).toContain(`**${plots.length} insured units**`);
  });

  it("finance stats: loans, outstanding and days past due", async () => {
    const out = await TOOLS.finance_stats(bank, {});
    const loans = assetsOf("org-bank-mekong").filter((a) => a.type === "loan");
    const pd = out.data.pastDue as { count: number; npl90: number };
    expect(out.data.loans).toBe(loans.length);
    expect(out.data.outstandingUsd).toBe(loans.reduce((t, a) => t + a.valueUsd, 0));
    expect(pd.count).toBe(loans.filter((a) => Number(a.meta.daysPastDue) > 0).length);
    expect(pd.npl90).toBe(loans.filter((a) => Number(a.meta.daysPastDue) >= 90).length);
  });

  it("anticipatory stats: households and cash envelope", async () => {
    const out = await TOOLS.anticipatory_stats(ngo, {});
    const com = assetsOf("org-ngo-brac").filter((a) => a.type === "community");
    expect(out.data.communities).toBe(com.length);
    expect(out.data.households).toBe(com.reduce((t, a) => t + Number(a.meta.households), 0));
    const t = out.data.targeted as { households: number; cashUsd: number };
    const per = Number(com[0]!.meta.cashPerHouseholdUsd);
    expect(com.every((a) => a.valueUsd === Number(a.meta.households) * per)).toBe(true);
    expect(t.cashUsd).toBe(t.households * per);
  });

  it("tools never leak another tenant's assets", async () => {
    const out = await TOOLS.top_risk_assets(bank, { hazard: "composite", limit: 50 });
    const ids = new Set(assetsOf("org-bank-mekong").map((a) => a.id));
    const top = out.data.top as { id: string }[];
    expect(top.length).toBe(50);
    expect(top.every((r) => ids.has(r.id))).toBe(true);
  });

  it("asset lookup by policy reference", async () => {
    const plot = assetsOf("org-ins-deltamutual")[5]!;
    const out = await TOOLS.asset_detail(ins, { asset: plot.externalRef! });
    expect((out.data.asset as { id: string }).id).toBe(plot.id);
    expect(out.actions.some((a) => a.kind === "rule" && a.href.includes(plot.id))).toBe(true);
  });

  it("threshold filters report 'none' honestly", async () => {
    const out = await TOOLS.top_risk_assets(ins, { hazard: "flood", threshold: { op: ">", value: 101, unit: "%" } });
    expect(out.data.matches).toBe(0);
    expect(out.markdown).toMatch(/None/);
  });

  it("glossary explains from methodology", async () => {
    const out = await TOOLS.explain_metric(ins, { term: "basis_risk" });
    expect(out.markdown).toContain("Basis risk");
  });

  it("end-to-end: question → answer with artifacts, history kept per user", async () => {
    const a = await askCopilot(bank, "How many loans are past due?");
    expect(a.planner).toBe("rules");
    expect(a.intent).toBe("finance");
    expect(a.artifacts.some((x) => x.kind === "kpis")).toBe(true);
    const help = await askCopilot(bank, "hello there");
    expect(help.intent).toBe("help");
    expect(help.followUps.length).toBeGreaterThan(0);
  });
});

describe("copilot LLM planner (OpenAI-compatible function calling, mocked)", () => {
  it("runs the tools the model picks and keeps deterministic artifacts", async () => {
    const { vi } = await import("vitest");
    process.env.OPENAI_API_KEY = "test-key";
    let round = 0;
    const bodies: { messages: { role: string }[]; tools: unknown[] }[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      round++;
      const message =
        round === 1
          ? { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "finance_stats", arguments: "{}" } }] }
          : { role: "assistant", content: "Your loan book has **160 loans**." };
      return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    try {
      const a = await askCopilot(bank, "How is the loan book?");
      expect(a.planner).toBe("openai");
      expect(a.toolsUsed.map((t) => t.tool)).toEqual(["finance_stats"]);
      expect(a.markdown).toContain("160 loans");
      expect(a.artifacts.some((x) => x.kind === "kpis")).toBe(true);
      expect(bodies[0]!.tools.length).toBe(12);
      expect(bodies[1]!.messages.some((m) => m.role === "tool")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.OPENAI_API_KEY;
    }
  });

  it("falls back to the rules planner when the model call fails", async () => {
    const { vi } = await import("vitest");
    process.env.GROQ_API_KEY = "test-key";
    vi.stubGlobal("fetch", async () => new Response("upstream down", { status: 503 }));
    try {
      const a = await askCopilot(bank, "How many loans are past due?");
      expect(a.planner).toBe("rules");
      expect(a.intent).toBe("finance");
    } finally {
      vi.unstubAllGlobals();
      delete process.env.GROQ_API_KEY;
    }
  });
});
