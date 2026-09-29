import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";

vi.mock("@/auth", () => ({ auth: async () => null, signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

const { appRouter } = await import("@/server/routers/_app");
const { createCallerFactory } = await import("@/server/trpc");
const { getStore, resetStore } = await import("@/server/data/store");

const createCaller = createCallerFactory(appRouter);
let ip = 0;
function caller(userId: string) {
  const u = getStore().users.find((x) => x.id === userId)!;
  const session = { user: { id: u.id, name: u.name, email: u.email, role: u.role, orgId: u.orgId, language: u.language }, expires: new Date(Date.now() + 3600_000).toISOString() } as Session;
  return createCaller({ session, ip: `10.1.0.${++ip % 250}`, req: new Request("http://localhost/api/trpc") });
}

beforeEach(() => resetStore());

describe("farmer tools router", () => {
  it("farmer asks, district officer answers, farmer sees the answer", async () => {
    const farmer = caller("user-farmer-demo");
    const q = await farmer.farmer.askQuestion({ text: "Black lesions on my jute stems, what to do?", crop: "jute" });
    expect(q.status).toBe("open");
    const officer = caller("user-officer-barisal");
    const inbox = await officer.farmer.listQuestions({ status: "open" });
    expect(inbox.map((x) => x.id)).toContain(q.id);
    await officer.farmer.answerQuestion({ id: q.id, text: "Likely stem rot — remove infected plants and drain." });
    const mine = await farmer.farmer.listQuestions();
    expect(mine.find((x) => x.id === q.id)!.answers).toHaveLength(1);
    // a new question notifies the district's government workspace
    expect(getStore().notifications.some((n) => n.workspaceId === "org-gov-bd" && n.title.includes("Farmer question"))).toBe(true);
  });

  it("farmers cannot answer questions", async () => {
    const farmer = caller("user-farmer-demo");
    const q = await farmer.farmer.askQuestion({ text: "Is this salt injury on my rice?" });
    await expect(farmer.farmer.answerQuestion({ id: q.id, text: "self answer" })).rejects.toThrow(/permission/i);
  });

  it("ledger entries validate category vs type and roll up into profit", async () => {
    const farmer = caller("user-farmer-demo");
    await expect(farmer.farmer.addLedgerEntry({ season: "Aman 2026", fieldId: "field-1", date: "2026-09-20", kind: "income", category: "seed", amount: 10 })).rejects.toThrow(/Category/);
    const before = (await farmer.farmer.ledger()).summary.seasons.find((s) => s.season === "Aman 2026")!;
    await farmer.farmer.addLedgerEntry({ season: "Aman 2026", fieldId: "field-1", date: "2026-09-20", kind: "income", category: "sale", amount: 1000 });
    const after = (await farmer.farmer.ledger()).summary.seasons.find((s) => s.season === "Aman 2026")!;
    expect(after.profit - before.profit).toBe(1000);
  });

  it("insurance enrolment request notifies the insurer once", async () => {
    const farmer = caller("user-farmer-demo");
    const r = await farmer.farmer.requestInsurance({ fieldIds: ["field-1"], phone: "+8801700000000" });
    const offer = await farmer.farmer.insuranceOffer();
    expect(r.premiumUsd).toBe(Math.round(r.sumInsuredUsd * offer.book!.premiumRate));
    expect(offer.book!.premiumRate).toBeGreaterThan(0.02);
    expect(offer.book!.premiumRate).toBeLessThan(0.12);
    expect(getStore().notifications.find((n) => n.id === r.notificationId)?.workspaceId).toBe("org-ins-deltamutual");
    await expect(farmer.farmer.requestInsurance({ fieldIds: ["field-1"] })).rejects.toThrow(/already/);
  });

  it("Crop Doctor case is stored with ranked causes", async () => {
    const farmer = caller("user-farmer-demo");
    const saved = await farmer.farmer.saveDoctorCase({ crop: "rice", part: "grain", symptoms: ["white_head"] });
    expect(saved.results[0]!.causeId).toBe("stem_borer");
    const list = await farmer.farmer.listDoctorCases();
    expect(list[0]!.id).toBe(saved.id);
  });
});
