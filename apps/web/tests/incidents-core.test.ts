import { describe, expect, it } from "vitest";
import {
  allowedTransitions,
  applyTransition,
  canTransition,
  draftReview,
  fmtMinutes,
  incidentMetrics,
  inArea,
  instantiateTemplate,
  pointInPolygon,
  slugify,
  suggestSeverity,
  transitionWarnings,
  TASK_TEMPLATES,
  type Incident,
} from "@/server/services/incidents";

const T0 = new Date("2026-09-01T00:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const actor = { id: "u1", name: "Arif" };

function blank(over: Partial<Incident> = {}): Incident {
  return {
    id: "inc_t",
    workspaceId: "ws",
    number: 101,
    slug: "t",
    title: "Test",
    summary: "",
    severity: "SEV1",
    status: "investigating",
    hazard: "flood",
    source: { kind: "manual", refId: null, label: null },
    assetIds: [],
    area: null,
    roles: { commander: null, fieldLead: null, comms: null },
    timeline: [],
    tasks: [],
    links: [],
    updates: [],
    subscribers: [],
    publicEnabled: false,
    createdAt: T0,
    createdBy: "u1",
    acknowledgedAt: null,
    mobilisedAt: null,
    resolvedAt: null,
    statusChangedAt: T0,
    reopenCount: 0,
    review: null,
    demo: false,
    ...over,
  };
}

describe("status transitions", () => {
  it("allows forward skips and single-step back-steps only", () => {
    expect(canTransition("investigating", "responding")).toBe(true);
    expect(canTransition("investigating", "resolved")).toBe(true);
    expect(canTransition("monitoring", "responding")).toBe(true);
    expect(canTransition("monitoring", "investigating")).toBe(false);
    expect(canTransition("responding", "responding")).toBe(false);
    expect(allowedTransitions("responding")).toEqual(["mobilising", "monitoring", "resolved"]);
  });

  it("reopens a resolved incident into any active state", () => {
    expect(allowedTransitions("resolved")).toEqual(["investigating", "mobilising", "responding", "monitoring"]);
  });

  it("stamps acknowledge/mobilise/resolve once and records the timeline", () => {
    const inc = blank();
    applyTransition(inc, "mobilising", actor, at(10));
    expect(inc.acknowledgedAt).toEqual(at(10));
    expect(inc.mobilisedAt).toEqual(at(10));
    applyTransition(inc, "responding", actor, at(50));
    applyTransition(inc, "mobilising", actor, at(55)); // step back keeps original stamps
    expect(inc.mobilisedAt).toEqual(at(10));
    applyTransition(inc, "resolved", actor, at(600));
    expect(inc.resolvedAt).toEqual(at(600));
    expect(inc.timeline.map((e) => e.text)).toEqual([
      "Status: Investigating → Mobilising",
      "Status: Mobilising → Responding",
      "Status: Responding → Mobilising",
      "Status: Mobilising → Resolved",
    ]);
  });

  it("reopen clears resolvedAt and counts reopens", () => {
    const inc = blank();
    applyTransition(inc, "resolved", actor, at(5));
    applyTransition(inc, "responding", actor, at(20), "water rising again");
    expect(inc.resolvedAt).toBeNull();
    expect(inc.reopenCount).toBe(1);
    expect(inc.timeline.at(-1)!.text).toBe("Reopened: Resolved → Responding — water rising again");
  });

  it("rejects illegal moves", () => {
    const inc = blank({ status: "monitoring" });
    expect(() => applyTransition(inc, "investigating", actor)).toThrow(/Cannot move/);
  });

  it("warns (without blocking) about open tasks, missing commander and silent SEV1s", () => {
    const inc = blank({ tasks: instantiateTemplate("flood", "insurance", {}, T0) });
    expect(transitionWarnings(inc, "mobilising")).toContain("No incident commander is assigned yet.");
    const w = transitionWarnings(inc, "resolved");
    expect(w[0]).toMatch(/tasks are still open/);
    expect(w[1]).toMatch(/No stakeholder update/);
  });
});

describe("SLA metrics", () => {
  it("computes TTA / TTM / TTR against SEV targets", () => {
    const m = incidentMetrics({ severity: "SEV1", createdAt: T0, acknowledgedAt: at(12), mobilisedAt: at(75), resolvedAt: at(60 * 50) }, at(60 * 60));
    expect(m.tta).toBe(12);
    expect(m.ttm).toBe(75);
    expect(m.ttr).toBe(3000);
    expect(m.clocks.map((c) => c.state)).toEqual(["met", "breached", "met"]);
    expect(m.breached).toBe(1);
    expect(m.next).toBeNull();
  });

  it("running clocks go at-risk at 75 % and breached past target", () => {
    const running = incidentMetrics({ severity: "SEV2", createdAt: T0, acknowledgedAt: null, mobilisedAt: null, resolvedAt: null }, at(10));
    expect(running.clocks[0]).toMatchObject({ state: "running", remainingMin: 20, done: false });
    const risk = incidentMetrics({ severity: "SEV2", createdAt: T0, acknowledgedAt: null, mobilisedAt: null, resolvedAt: null }, at(25));
    expect(risk.clocks[0]!.state).toBe("at_risk");
    const late = incidentMetrics({ severity: "SEV2", createdAt: T0, acknowledgedAt: null, mobilisedAt: null, resolvedAt: null }, at(45));
    expect(late.clocks[0]).toMatchObject({ state: "breached", remainingMin: -15 });
    expect(late.next!.key).toBe("ack");
  });

  it("accepts ISO strings (client-side ticking) and formats durations", () => {
    const m = incidentMetrics({ severity: "SEV4", createdAt: T0.toISOString(), acknowledgedAt: at(90).toISOString(), mobilisedAt: null, resolvedAt: null }, at(100));
    expect(m.tta).toBe(90);
    expect(fmtMinutes(45)).toBe("45m");
    expect(fmtMinutes(135)).toBe("2h 15m");
    expect(fmtMinutes(3 * 1440 + 120)).toBe("3d 2h");
    expect(fmtMinutes(-20)).toBe("-20m");
    expect(fmtMinutes(null)).toBe("—");
  });
});

describe("task templates", () => {
  it("filters industry-specific tasks and assigns by role", () => {
    const roles = { commander: "cmd", fieldLead: "fld", comms: "com" };
    const ins = instantiateTemplate("flood", "insurance", roles, T0);
    const titles = ins.map((t) => t.title);
    expect(titles.some((t) => /claims triage/.test(t))).toBe(true);
    expect(titles.some((t) => /anticipatory cash/.test(t))).toBe(false);
    expect(titles.some((t) => /restructuring/.test(t))).toBe(false);
    const ngo = instantiateTemplate("flood", "ngo", roles, T0).map((t) => t.title);
    expect(ngo.some((t) => /anticipatory cash/.test(t))).toBe(true);
    const first = ins.find((t) => t.phase === "Comms")!;
    expect(first.assigneeId).toBe("com");
    expect(ins.find((t) => t.role === "fieldLead")!.assigneeId).toBe("fld");
  });

  it("falls back to the commander when a role is empty and sets due times from now", () => {
    const tasks = instantiateTemplate("cyclone", "banking", { commander: "cmd" }, T0);
    expect(tasks.every((t) => t.assigneeId === "cmd")).toBe(true);
    const track = tasks.find((t) => /forecast cone/.test(t.title))!;
    expect(track.dueAt).toEqual(new Date(T0.getTime() + 3_600_000));
    expect(new Set(tasks.map((t) => t.id)).size).toBe(tasks.length);
    expect(tasks.every((t) => !t.done && t.fromTemplate === "cyclone")).toBe(true);
  });

  it("every hazard has a template ending in a review task", () => {
    for (const [h, t] of Object.entries(TASK_TEMPLATES)) {
      expect(t.tasks.length, h).toBeGreaterThan(3);
      expect(t.tasks.at(-1)!.title).toMatch(/post-incident review/);
    }
    expect(instantiateTemplate("salinity", null, {}, T0).every((t) => t.assigneeId === null)).toBe(true);
  });
});

describe("geometry, severity suggestion, slugs, review draft", () => {
  const poly: [number, number][] = [[22.9, 88.9], [22.9, 89.9], [21.8, 89.9], [21.8, 88.9]];
  it("point-in-polygon and circle membership", () => {
    expect(pointInPolygon(22.3, 89.4, poly)).toBe(true);
    expect(pointInPolygon(23.3, 89.4, poly)).toBe(false);
    expect(inArea({ type: "circle", lat: 22.7, lon: 89.07, radiusKm: 10 }, 22.75, 89.1)).toBe(true);
    expect(inArea({ type: "circle", lat: 22.7, lon: 89.07, radiusKm: 10 }, 23.7, 89.1)).toBe(false);
  });

  it("suggests severity from share of book and worst score", () => {
    expect(suggestSeverity(200, 1000, 40)).toBe("SEV1");
    expect(suggestSeverity(10, 1000, 72)).toBe("SEV2");
    expect(suggestSeverity(20, 1000, 30)).toBe("SEV3");
    expect(suggestSeverity(1, 1000, 30)).toBe("SEV4");
  });

  it("slugifies Vietnamese / Bangla-romanised titles", () => {
    expect(slugify("Mekong salinity — rice borrowers (Bến Tre)")).toBe("mekong-salinity-rice-borrowers-ben-tre");
    expect(slugify("!!!")).toBe("incident");
  });

  it("drafts a review from metrics and tasks", () => {
    const inc = blank({ severity: "SEV3", hazard: "drought", tasks: instantiateTemplate("drought", "banking", { commander: "c" }, T0) });
    applyTransition(inc, "mobilising", actor, at(30));
    inc.tasks[0]!.done = true;
    inc.tasks[0]!.doneAt = at(40);
    applyTransition(inc, "resolved", actor, at(60 * 24));
    const r = draftReview(inc);
    expect(r.whatHappened).toMatch(/Drought incident "Test"/);
    expect(r.whatWorked).toMatch(/Acknowledged in 30m/);
    expect(r.whatToImprove).toMatch(/never completed/);
    expect(r.actions.length).toBeGreaterThan(0);
    expect(r.actions[0]!.ownerId).toBe("c");
  });
});
