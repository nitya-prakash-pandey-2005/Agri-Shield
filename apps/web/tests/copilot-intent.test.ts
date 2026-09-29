import { describe, expect, it } from "vitest";
import { extractEntities, routeQuestion, type Lexicon } from "@/server/services/copilot/intent";
import { findTerm } from "@/server/services/copilot/glossary";

const LEX: Lexicon = {
  districts: ["Barisal", "Khulna", "Satkhira", "Patuakhali", "Sylhet", "Cần Thơ", "Bến Tre", "Sóc Trăng", "Cà Mau", "An Giang", "Pampanga", "Bulacan", "Nueva Ecija", "Tarlac", "Kendrapara", "Jagatsinghpur", "Balasore", "Puri", "Demak", "Pekalongan", "Indramayu", "Semarang"],
  assetNames: ["Gabura plot 012", "Chittagong Port Silo"],
};

const route = (q: string) => routeQuestion(q, LEX);
const tools = (q: string) => route(q).calls.map((c) => c.tool);

describe("copilot intent routing — insurers", () => {
  it("portfolio overview", () => {
    const r = route("How is my portfolio doing today?");
    expect(r.intent).toBe("portfolio_summary");
    expect(tools("Give me an overview of our book")).toEqual(["portfolio_summary"]);
  });
  it("top-N riskiest insured plots with hazard + tag + threshold", () => {
    const r = route("Show me the top 5 coastal plots with flood risk above 60%");
    expect(r.intent).toBe("top_risk");
    const a = r.calls[0]!.args;
    expect(a).toMatchObject({ hazard: "flood", limit: 5, tag: "coastal", types: ["insured_plot"] });
    expect(a.threshold).toEqual({ op: ">", value: 60, unit: "%" });
  });
  it("parametric trigger proximity goes to the insurance tool", () => {
    expect(tools("Which parametric policies are closest to the payout trigger?")).toEqual(["insurance_stats"]);
    expect(tools("What is our total premium and sum insured?")).toEqual(["insurance_stats"]);
  });
  it("specific asset by name number and by policy reference", () => {
    const r = route("Tell me about plot 12");
    expect(r.intent).toBe("asset_detail");
    expect(r.calls[0]!.args.asset).toBe("plot 12");
    expect(route("details for DMA-BD-202610007").calls[0]!.args.asset).toBe("DMA-BD-202610007");
    expect(route("What's the forecast for Gabura plot 012?").calls[0]).toMatchObject({ tool: "forecast" });
  });
});

describe("copilot intent routing — banks & MFIs", () => {
  it("loan book stats", () => {
    expect(tools("How many loans are past due?")).toEqual(["finance_stats"]);
    expect(route("What's the outstanding exposure of our loan book in Vietnam?").calls[0]!.args).toEqual({ country: "Vietnam" });
  });
  it("ranked loans by salinity become a filtered top-risk query", () => {
    const r = route("Which rice loans have the highest salinity risk?");
    expect(r.intent).toBe("top_risk");
    expect(r.calls[0]!.args).toMatchObject({ hazard: "salinity", crop: "rice", types: ["loan"] });
  });
  it("portfolio assets filtered to a district", () => {
    const r = route("Which of my borrowers in Bến Tre are at risk?");
    expect(r.intent).toBe("top_risk");
    expect(r.calls[0]!.args.area).toBe("Bến Tre");
  });
});

describe("copilot intent routing — NGOs, co-ops, agribusiness, government", () => {
  it("anticipatory action households", () => {
    expect(tools("How many households are in high-risk communities?")).toEqual(["anticipatory_stats"]);
    expect(tools("How much cash should we pre-position for anticipatory action?")).toEqual(["anticipatory_stats"]);
  });
  it("member farm drought ranking", () => {
    const r = route("List the 10 member farms most exposed to drought");
    expect(r.intent).toBe("top_risk");
    expect(r.calls[0]!.args).toMatchObject({ hazard: "drought", limit: 10, types: ["farm"] });
  });
  it("facilities and hazard events", () => {
    expect(tools("Are there any cyclones near our warehouses?")).toEqual(["hazards_near_assets"]);
    expect(tools("Any cyclones near our insured plots?")).toEqual(["hazards_near_assets"]);
    expect(tools("Which districts have the highest flood risk?")).toEqual(["top_risk_assets"]);
    const r = route("Any disasters within 200 km of my facilities?");
    expect(r.calls[0]).toEqual({ tool: "hazards_near_assets", args: { radiusKm: 200 } });
  });
  it("alerts and rules", () => {
    expect(tools("Which alert rules fired this week?")).toEqual(["alerts_and_rules"]);
    expect(tools("show my notifications")).toEqual(["alerts_and_rules"]);
  });
});

describe("copilot intent routing — any location on Earth", () => {
  it("assess a place", () => {
    const r = route("What is the flood risk in Dhaka?");
    expect(r.intent).toBe("location");
    expect(r.calls[0]!.args).toMatchObject({ place: "Dhaka", focus: "flood" });
    expect(route("is Hanoi safe for rice this season?").calls[0]!.args.place).toBe("Hanoi");
    expect(route("climate risk for Nairobi, Kenya").calls[0]!.args.place).toBe("Nairobi");
  });
  it("lower-case place names and comma-country suffix", () => {
    expect(route("salinity risk in ho chi minh city").calls[0]!.args.place).toBe("ho chi minh city");
    expect(route("assess Satkhira, Bangladesh").calls[0]!.args.place).toBe("Satkhira, Bangladesh");
  });
  it("forecast with time window", () => {
    const r = route("Will it rain in Manila over the next 3 days?");
    expect(r.intent).toBe("forecast");
    expect(r.calls[0]!.args).toEqual({ place: "Manila", days: 3 });
    expect(route("weather forecast for Cần Thơ tomorrow").calls[0]!.args).toEqual({ place: "Cần Thơ", days: 2 });
    expect(route("rainfall outlook next week").calls[0]!.args).toEqual({ days: 7 });
  });
  it("compare places", () => {
    expect(route("Compare Khulna and Cà Mau for salinity").calls[0]).toEqual({ tool: "compare_places", args: { places: ["Khulna", "Cà Mau"], hazard: "salinity" } });
    expect(route("Dhaka vs Kolkata vs Yangon flood risk").calls[0]!.args.places).toEqual(["Dhaka", "Kolkata", "Yangon"]);
    expect(route("Which is riskier, Puri or Balasore?").calls[0]!.args.places).toEqual(["Puri", "Balasore"]);
  });
});

describe("copilot glossary", () => {
  it("explains jargon", () => {
    expect(route("What does EC mean?").calls[0]).toEqual({ tool: "explain_metric", args: { term: "ec" } });
    expect(route("what is basis risk?").calls[0]!.args.term).toBe("basis_risk");
    expect(route("Explain the composite score").calls[0]!.args.term).toBe("composite");
    expect(route("What is a return period?").calls[0]!.args.term).toBe("return_period");
    expect(findTerm("how is SPI computed")?.key).toBe("spi");
  });
  it("does not mistake a location question for a definition", () => {
    expect(route("What is the salinity in Bến Tre?").intent).toBe("location");
  });
});

describe("entity extraction", () => {
  it("extracts hazards, windows, limits and thresholds", () => {
    const e = extractEntities("top ten assets where 72h rain is over 120 mm in Bangladesh", LEX);
    expect(e.limit).toBe(10);
    expect(e.hours).toBe(72);
    expect(e.days).toBe(3);
    expect(e.threshold).toEqual({ op: ">", value: 120, unit: "mm" });
    expect(e.countries).toEqual(["Bangladesh"]);
    expect(e.portfolioScoped).toBe(true);
  });
  it("extracts salinity thresholds in dS/m and risk levels", () => {
    const e = extractEntities("Which farms have EC at least 4 dS/m and are critical?", LEX);
    expect(e.hazard).toBe("salinity");
    expect(e.threshold).toEqual({ op: ">=", value: 4, unit: "dS/m" });
    expect(e.level).toBe("critical");
  });
  it("does not treat time phrases or portfolio words as places", () => {
    expect(extractEntities("What happens to my portfolio in the next 72 hours?", LEX).places).toEqual([]);
    expect(extractEntities("flood risk for rice in terms of exposure", LEX).places).toEqual([]);
  });
  it("falls back to help for unrelated chatter", () => {
    expect(route("hello there").intent).toBe("help");
  });
});
