import { describe, expect, it } from "vitest";
import { activate, assignTeams, canTransition, cashPlan, episodes, hindcastMetric, levelFor, listActivations, listProtocols, observedEventDays, recordDisbursement, review, saveProtocol, transition, verifyTrigger } from "@/server/services/anticipatory";
import { getStore } from "@/server/data/store";
import type { DailyHistory } from "@/server/live/history";

const user = { id: "user-ngo-demo", name: "Tahmina Sultana" };
const WS = "org-ngo-brac";

describe("cash plan", () => {
  it("computes targeted households, cash, fees, stock and funding gap", () => {
    const p = cashPlan({ households: [1000, 500], coveragePct: 40, cashPerHouseholdUsd: 85, deliveryFeePct: 2, stock: [{ item: "ORS", perHousehold: 6, unitCostUsd: 0.15 }], budgetUsd: 50_000 });
    expect(p.householdsTargeted).toBe(600);
    expect(p.cashUsd).toBe(51_000);
    expect(p.feesUsd).toBe(1020);
    expect(p.stockUsd).toBe(540);
    expect(p.totalUsd).toBe(52_560);
    expect(p.fundingGapUsd).toBe(2560);
    expect(p.perHouseholdUsd).toBeCloseTo(85 * 1.02 + 0.9, 6);
    expect(p.affordableHouseholds).toBe(Math.floor(50_000 / (85 * 1.02 + 0.9)));
    expect(p.stockLines[0]!.quantity).toBe(3600);
  });
});

describe("trigger levels, episodes and verification", () => {
  it("classifies metric values", () => {
    const p = { readiness: 50, activation: 70 };
    expect(levelFor(null, p)).toBe("monitoring");
    expect(levelFor(49, p)).toBe("monitoring");
    expect(levelFor(55, p)).toBe("readiness");
    expect(levelFor(70, p)).toBe("activation");
  });
  it("groups days into episodes with a gap tolerance", () => {
    const f = [false, true, true, false, false, true, false, false, false, false, false, false, false, false, true];
    expect(episodes(f, 3)).toEqual([
      { start: 1, end: 5 },
      { start: 14, end: 14 },
    ]);
  });
  it("counts hits (with lead time), missed events and false alarms", () => {
    const act = [
      { start: 10, end: 12 },
      { start: 50, end: 51 },
      { start: 100, end: 100 },
    ];
    const ev = [{ start: 13 }, { start: 80 }, { start: 103 }];
    const v = verifyTrigger(act, ev, 3);
    expect(v.hits.map((h) => [h.event, h.leadDays])).toEqual([
      [13, 3],
      [103, 3],
    ]);
    expect(v.missed).toEqual([80]);
    expect(v.falseAlarms).toEqual([50]);
  });
});

function hist(rain: number[], dis: number[] | null): DailyHistory {
  const time = rain.map((_, i) => new Date(Date.UTC(2000, 0, 1) + i * 86_400_000).toISOString().slice(0, 10));
  return { lat: 22.5, lon: 89.5, provider: "ERA5", era5Cell: null, glofasCell: null, elevationM: 3, time, rain, tmax: rain.map(() => 30), et0: rain.map(() => 4), gust: rain.map(() => 20), discharge: dis, fetchedAt: "", source: "live" };
}

describe("hindcast metrics", () => {
  it("5-day forward rain and peak-flow ratio", () => {
    const rain = Array.from({ length: 40 }, (_, i) => (i >= 20 && i < 25 ? 40 : 1));
    const dis = Array.from({ length: 40 }, (_, i) => (i === 22 ? 300 : 100));
    const h = hist(rain, dis);
    const r5 = hindcastMetric("rain_5d_mm", h, 0.5);
    expect(r5[20]).toBe(200);
    expect(r5[0]).toBe(5);
    const q = hindcastMetric("discharge_ratio", h, 0.5);
    expect(q[20]).toBeCloseTo(3, 6);
    const fp = hindcastMetric("flood_prob_72h", h, 0.9);
    expect(fp[20]!).toBeGreaterThan(fp[10]!);
    expect(fp[3]).toBeNull(); // needs 7 days of antecedent rain
  });
  it("observed events use the 1-in-5-year river level, or rainfall when there is no river", () => {
    // 10 years: each year's peak flow = 100 + 50·k on one day
    const n = 3653;
    const dis = Array.from({ length: n }, () => 50);
    for (let k = 0; k < 10; k++) dis[k * 365 + 200] = 100 + 50 * k;
    const ev = observedEventDays(hist(Array.from({ length: n }, () => 1), dis));
    expect(ev.rule).toMatch(/1-in-5-year/);
    expect(ev.flags.filter(Boolean).length).toBe(2); // the two largest annual peaks
    const noRiver = observedEventDays(hist(Array.from({ length: n }, () => 1), null));
    expect(noRiver.rule).toMatch(/3-day rain/);
  });
});

describe("activation workflow", () => {
  it("runs activate → teams → disburse → complete → review with an audit trail", () => {
    const comms = getStore().assets.filter((a) => a.workspaceId === WS && a.type === "community").slice(0, 3);
    const p = saveProtocol(WS, user, { name: "Test protocol", hazard: "flood", metric: "rain_5d_mm", readiness: 100, activation: 150, minCommunities: 2, leadTimeDays: 3, scopeTags: [], actions: [], budgetUsd: 100_000, cashPerHouseholdUsd: 85, coveragePct: 40, deliveryFeePct: 1.5, stock: [], status: "active" });
    expect(listProtocols(WS).some((x) => x.id === p.id)).toBe(true);
    const a = activate(WS, user, { protocolId: p.id, communityIds: comms.map((c) => c.id), reason: "test", trigger: "forecast" });
    expect(a.status).toBe("activated");
    expect(() => activate(WS, user, { protocolId: p.id, communityIds: [comms[0]!.id], reason: "again", trigger: "manual" })).toThrow(/open activation/);
    expect(() => recordDisbursement(WS, user, a.id, { communityId: comms[0]!.id, households: 10, amountUsd: 850, channel: "bKash" })).toThrow(/Assign field teams/);
    assignTeams(WS, user, a.id, [{ name: "T1", lead: "Rahim", contact: "", communityIds: comms.map((c) => c.id) }]);
    recordDisbursement(WS, user, a.id, { communityId: comms[0]!.id, households: 100, amountUsd: 8500, channel: "bKash" });
    expect(a.status).toBe("disbursing");
    expect(() => review(WS, user, a.id, { eventOccurred: true, outcome: "ok", lessons: "" })).toThrow();
    transition(WS, user, a.id, "completed", "done");
    review(WS, user, a.id, { eventOccurred: true, outcome: "Cash arrived 36 h before peak", lessons: "" });
    expect(a.status).toBe("reviewed");
    expect(a.review?.householdsReached).toBe(100);
    expect(a.trail.map((t) => t.action)).toEqual(["Activated", "Teams assigned", "Disbursement recorded", "Operations completed", "Post-event review"]);
    expect(listActivations(WS)[0]!.id).toBe(a.id);
    expect(getStore().notifications.some((n) => n.workspaceId === WS && n.title.includes("ACTIVATED"))).toBe(true);
  });
  it("enforces the status flow", () => {
    expect(canTransition("activated", "teams_assigned")).toBe(true);
    expect(canTransition("activated", "completed")).toBe(false);
    expect(canTransition("reviewed", "cancelled")).toBe(false);
  });
});
