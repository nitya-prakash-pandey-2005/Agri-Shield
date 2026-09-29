import { describe, expect, it } from "vitest";
import { computeRoi, fmtLine, fmtUsd, planAnnual, ROI_PLANS, ROI_PRESETS, type RoiIndustry } from "@/components/marketing/roi";
import { buildIcs, demoSlots, icsDate, icsEscape, icsFold } from "@/components/marketing/ics";
import { INDUSTRIES, USE_CASES } from "@/components/marketing/industries";
import { MATRIX, MATRIX_COLUMNS, PLANS, planById, priceFor } from "@/app/pricing/plans";

const ALL = Object.keys(ROI_PRESETS) as RoiIndustry[];

describe("ROI model", () => {
  it("computes the insurance example by hand", () => {
    const r = computeRoi("insurance", {}, planAnnual("business"));
    const d = ROI_PRESETS.insurance.defaults;
    const baseline = d.exposureUsd! * (d.lossRatePct! / 100);
    const avoided = baseline * (d.avoidablePct! / 100) * (d.actionRatePct! / 100);
    const ops = d.units! * d.costPerUnitUsd! * (d.opsReductionPct! / 100);
    expect(r.baselineLossUsd).toBeCloseTo(baseline);
    expect(r.avoidedLossUsd).toBeCloseTo(avoided);
    expect(r.opsSavingUsd).toBeCloseTo(ops);
    expect(r.totalBenefitUsd).toBeCloseTo(avoided + ops);
    expect(r.planCostUsd).toBe(1490 * 12);
    expect(r.netBenefitUsd).toBeCloseTo(avoided + ops - 17_880);
    expect(r.paybackMonths).toBeCloseTo((17_880 / (avoided + ops)) * 12);
    expect(r.elReductionPct).toBeCloseTo((d.avoidablePct! * d.actionRatePct!) / 100);
    const lrBefore = r.extras.find((x) => x.label === "Loss ratio before")!.value;
    const lrAfter = r.extras.find((x) => x.label === "Loss ratio after")!.value;
    expect(lrBefore).toBeCloseTo((baseline / (d.exposureUsd! * 0.05)) * 100);
    expect(lrAfter).toBeLessThan(lrBefore);
  });

  it("applies LGD for banking expected loss", () => {
    const r = computeRoi("banking", { exposureUsd: 10_000_000, lossRatePct: 2, lgdPct: 50 }, 0);
    expect(r.baselineLossUsd).toBeCloseTo(100_000);
    expect(r.paybackMonths).toBe(0);
    expect(r.roiMultiple).toBe(0); // no cost → multiple undefined → 0
  });

  it("is monotonic in avoidable share and action rate", () => {
    for (const ind of ALL) {
      const lo = computeRoi(ind, { avoidablePct: 5, actionRatePct: 20 }, 10_000);
      const hi = computeRoi(ind, { avoidablePct: 30, actionRatePct: 80 }, 10_000);
      expect(hi.avoidedLossUsd).toBeGreaterThan(lo.avoidedLossUsd);
      expect(hi.paybackMonths).toBeLessThan(lo.paybackMonths);
    }
  });

  it("returns no payback (Infinity) when there is no benefit, never NaN", () => {
    const r = computeRoi("farmers", { exposureUsd: 0, units: 0 }, 36);
    expect(r.totalBenefitUsd).toBe(0);
    expect(r.paybackMonths).toBe(Number.POSITIVE_INFINITY);
    expect(fmtLine(r.lines.find((l) => l.unit === "months")!)).toBe("no payback");
    for (const l of r.lines) expect(Number.isNaN(l.value)).toBe(false);
  });

  it("every preset has a formula per line, a valid default plan and defaults for every field", () => {
    for (const ind of ALL) {
      const p = ROI_PRESETS[ind];
      expect(ROI_PLANS.some((x) => x.id === p.defaultPlan)).toBe(true);
      for (const f of p.fields) expect(p.defaults[f.key], `${ind}.${f.key}`).toBeTypeOf("number");
      const r = computeRoi(ind, {}, planAnnual(p.defaultPlan));
      for (const l of [...r.lines, ...r.extras]) expect(l.formula.length).toBeGreaterThan(3);
      expect(r.netBenefitUsd).toBeGreaterThan(0); // defaults should describe a plausible, positive case
    }
  });

  it("formats money compactly", () => {
    expect(fmtUsd(950)).toBe("$950");
    expect(fmtUsd(1_490)).toBe("$1.5k");
    expect(fmtUsd(48_200)).toBe("$48k");
    expect(fmtUsd(1_250_000)).toBe("$1.3M");
    expect(fmtUsd(-20_000)).toBe("−$20k");
  });
});

describe(".ics generation", () => {
  const start = new Date(Date.UTC(2026, 9, 6, 4, 30));
  const ics = buildIcs({
    uid: "lead_123@agrishield.io",
    start,
    durationMinutes: 30,
    stamp: new Date(Date.UTC(2026, 8, 29, 10, 0)),
    summary: "Agri-SHIELD demo",
    description: "Insurance walkthrough; bring questions, please.\nSecond line",
    attendeeEmail: "a@b.co",
    attendeeName: "Test, User",
    organizerEmail: "partners@agrishield.io",
  });

  it("uses CRLF line endings and required properties", () => {
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.split("\r\n").every((l) => !l.includes("\n"))).toBe(true);
    for (const k of ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:", "BEGIN:VEVENT", "UID:lead_123@agrishield.io", "DTSTAMP:20260929T100000Z", "END:VEVENT", "END:VCALENDAR"]) expect(ics).toContain(k);
  });

  it("writes UTC start/end", () => {
    expect(ics).toContain("DTSTART:20261006T043000Z");
    expect(ics).toContain("DTEND:20261006T050000Z");
    expect(icsDate(start)).toBe("20261006T043000Z");
  });

  it("escapes text values", () => {
    expect(icsEscape("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    expect(ics).toContain("CN=Test\\, User");
  });

  it("folds long lines at 75 octets", () => {
    const long = "DESCRIPTION:" + "x".repeat(200);
    const folded = icsFold(long);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(2);
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    expect(parts.slice(1).every((p) => p.startsWith(" "))).toBe(true);
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join("")).toBe(long);
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });

  it("offers weekday slots in the future with lead time", () => {
    const now = new Date(2026, 8, 29, 16, 0); // Tue afternoon local
    const days = demoSlots(now, 10, 18);
    expect(days).toHaveLength(10);
    for (const d of days) {
      expect([0, 6]).not.toContain(d.day.getDay());
      for (const s of d.slots) {
        expect(s.getTime() - now.getTime()).toBeGreaterThanOrEqual(18 * 3_600_000);
        expect(s.getHours()).toBeGreaterThanOrEqual(9);
        expect(s.getHours()).toBeLessThan(18);
      }
    }
  });
});

describe("GTM content & plans", () => {
  it("covers all seven industries with demo logins, screens and use cases", () => {
    expect(INDUSTRIES.map((i) => i.id).sort()).toEqual(["agribusiness", "banking", "cooperative", "farmers", "government", "insurance", "ngo"]);
    for (const i of INDUSTRIES) {
      expect(i.demo.email).toMatch(/@demo\.agrishield\.io$/);
      expect(i.screens.length).toBeGreaterThan(0);
      expect(i.faqs.length).toBeGreaterThan(0);
      expect(USE_CASES[i.id].length).toBeGreaterThan(0);
      expect(ROI_PRESETS[i.id]).toBeDefined();
    }
  });

  it("has Business at $1,490 and a quoted Enterprise from $4,900", () => {
    const b = planById("business")!;
    const e = planById("enterprise")!;
    expect(b.usdMonthly).toBe(1490);
    expect(b.audience).toBe("workspace");
    expect(priceFor(b, "USD", "year")).toBe(14_900);
    expect(e.usdMonthly).toBeNull();
    expect(e.fromUsdMonthly).toBe(4900);
  });

  it("matrix rows have a cell for every plan column", () => {
    expect(new Set(MATRIX_COLUMNS)).toEqual(new Set(PLANS.map((p) => p.id)));
    const labels = MATRIX.flatMap((g) => g.rows.map((r) => r.label));
    for (const m of ["Risk Explorer", "Portfolio monitoring", "Alert rules engine", "Insurance module", "Lending & Finance module", "Anticipatory Action module", "Copilot (ask your data)", "REST API + webhooks"]) expect(labels).toContain(m);
    for (const g of MATRIX) for (const r of g.rows) for (const id of MATRIX_COLUMNS) expect(r.cells[id], `${r.label}/${id}`).not.toBeUndefined();
  });
});
