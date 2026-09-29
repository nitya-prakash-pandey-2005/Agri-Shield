import { describe, expect, it } from "vitest";
import { routeQuestion, type Lexicon } from "@/server/services/copilot/intent";

const LEX: Lexicon = { districts: ["Barisal", "Khulna", "Satkhira", "Bến Tre"], assetNames: [] };
const tools = (q: string) => routeQuestion(q, LEX).calls.map((c) => c.tool);

describe("Copilot routing for wave-3 modules", () => {
  it("routes briefing questions", () => {
    expect(tools("What should I look at right now?")).toEqual(["situation_briefing"]);
    expect(tools("Give me today's situation briefing")).toEqual(["situation_briefing"]);
  });
  it("routes yield questions", () => {
    expect(tools("What's our expected harvest this season?")).toEqual(["yield_outlook"]);
    expect(tools("How is yield tracking vs normal?")).toEqual(["yield_outlook"]);
  });
  it("routes incident questions", () => {
    expect(tools("Any open incidents?")).toEqual(["incidents_status"]);
  });
  it("routes sensor questions", () => {
    expect(tools("Which sensors need a field visit?")).toEqual(["sensors_status"]);
  });
  it("keeps existing routes intact", () => {
    expect(tools("Top 5 plots by flood risk")).toContain("top_risk_assets");
  });
});
