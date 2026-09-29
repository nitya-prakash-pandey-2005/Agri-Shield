/**
 * financeRouter — climate-adjusted credit risk, loan-book analytics, climate
 * stress tests and the physical-risk disclosure data pack. Scoped to
 * ctx.user.orgId (platform_admin may pass `orgId`).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { permitted, router } from "../trpc";
import { getStore } from "../data/store";
import { HISTORY_SOURCES } from "../live/history";
import { trackUsage } from "../services/usage";
import { CROP_SENSITIVITY, creditBook, creditCacheBust, HAZARDS, K_EVENT, LGD_BY_COLLATERAL, portfolioSummary, RATING_BANDS, RATING_PD } from "../services/credit-risk";
import { runStressTests, SCENARIOS, type ScenarioId } from "../services/stress-test";

const read = permitted("use_workspace");

type Ctx = { user: { id: string; name: string; role: string; orgId: string | null } };
function wsOf(ctx: Ctx, orgId?: string | null): string {
  if (orgId && ctx.user.role === "platform_admin") return orgId;
  if (!ctx.user.orgId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Your account is not attached to a workspace" });
  return ctx.user.orgId;
}
async function guard<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof TRPCError) throw e;
    throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : String(e), cause: e });
  }
}
const orgZ = z.string().max(80).optional();

export const METHODOLOGY = {
  ratingPd: RATING_PD,
  ratingBands: RATING_BANDS,
  lgd: LGD_BY_COLLATERAL,
  kEvent: K_EVENT,
  cropSensitivity: CROP_SENSITIVITY,
  hazards: HAZARDS,
  dpd: "DPD 1–29: PD ×1.5 · DPD 30–89: PD ×2.5, Stage 2 · DPD ≥ 90: default, Stage 3 (PD 100 %)",
  formula: "PD_climate = 1 − (1 − PD_base) · Π_h (1 − p_h · s_crop,h · k_h · m_segment);  EL = PD · LGD · EAD",
  hazardRules: {
    flood: "Share of years (1995 → last full year) with max 5-day rain ≥ max(250 mm, local 1-in-5 level) OR GloFAS peak ≥ 2× its median annual peak; × (0.5 + 0.5 · floodplain exposure)",
    drought: "Share of years with annual rainfall < 75 % of the long-term median",
    salinity: "Coastal salinity exposure × share of dry seasons (Dec–Apr) with < 50 % of median rain",
    heat: "Share of years with at least max(10, 2 × local median) days of Tmax ≥ 35 °C",
  },
  live: "An active live hazard (forecast score ≥ 40) lifts the current quarter: p = p_hist + 0.15 · max(0, live score − p_hist)",
  capital: "Basel IRB 'other retail' risk-weight function: K = LGD·[N((G(PD)+√R·G(0.999))/√(1−R)) − PD], R = 0.03·w + 0.16·(1−w), w = (1−e^(−35PD))/(1−e^(−35)); RWA = 12.5·K·EAD",
  sources: HISTORY_SOURCES,
};

export const financeRouter = router({
  ping: read.query(() => ({ ok: true })),

  book: read.input(z.object({ orgId: orgZ, refresh: z.boolean().optional() }).optional()).query(({ ctx, input }) =>
    guard(async () => {
      const ws = wsOf(ctx, input?.orgId);
      if (input?.refresh) creditCacheBust(ws);
      const b = await creditBook(ws);
      trackUsage(ws, "assessments");
      const reanalysisCells = b.freqByCell.size;
      return {
        generatedAt: b.generatedAt,
        loans: b.loans,
        summary: portfolioSummary(b.loans),
        coverage: { cells: b.cells.length, reanalysisCells, fallbackLoans: b.loans.filter((l) => l.dataSource !== "reanalysis").length },
        methodology: METHODOLOGY,
      };
    })
  ),

  /** Drop cached results and re-score the whole book (live forecast + reanalysis). */
  rescore: read.input(z.object({ orgId: orgZ }).optional()).mutation(({ ctx, input }) => {
    creditCacheBust(wsOf(ctx, input?.orgId));
    return { ok: true };
  }),

  loan: read.input(z.object({ orgId: orgZ, id: z.string().max(40) })).query(({ ctx, input }) =>
    guard(async () => {
      const ws = wsOf(ctx, input.orgId);
      const b = await creditBook(ws);
      const l = b.loans.find((x) => x.id === input.id);
      if (!l) throw new TRPCError({ code: "NOT_FOUND", message: "Loan not found" });
      const a = getStore().assets.find((x) => x.id === input.id);
      return { loan: l, asset: a ? { meta: a.meta, tags: a.tags, areaHa: a.areaHa, history: a.history } : null };
    })
  ),

  scenarios: read.query(() => SCENARIOS),

  stress: read
    .input(z.object({ orgId: orgZ, scenarios: z.array(z.enum(SCENARIOS.map((s) => s.id) as [ScenarioId, ...ScenarioId[]])).min(1).max(5).optional() }).optional())
    .query(({ ctx, input }) =>
      guard(async () => {
        const ws = wsOf(ctx, input?.orgId);
        trackUsage(ws, "assessments");
        return runStressTests(ws, input?.scenarios);
      })
    ),

  /** Data pack for the TCFD / IFRS S2-aligned physical-risk disclosure (PDF rendered client-side). */
  disclosure: read.input(z.object({ orgId: orgZ }).optional()).query(({ ctx, input }) =>
    guard(async () => {
      const ws = wsOf(ctx, input?.orgId);
      const [b, stress] = await Promise.all([creditBook(ws), runStressTests(ws)]);
      trackUsage(ws, "reports");
      const org = getStore().orgs.find((o) => o.id === ws);
      const summary = portfolioSummary(b.loans);
      const bands = [
        { band: "Low (PD uplift < 0.25 pp)", test: (u: number) => u < 0.25 },
        { band: "Moderate (0.25–1 pp)", test: (u: number) => u >= 0.25 && u < 1 },
        { band: "High (1–2.5 pp)", test: (u: number) => u >= 1 && u < 2.5 },
        { band: "Very high (≥ 2.5 pp)", test: (u: number) => u >= 2.5 },
      ].map((x) => {
        const ls = b.loans.filter((l) => l.stage !== 3 && x.test((l.pdClimate - l.pdBase) * 100));
        return { band: x.band, loans: ls.length, eadUsd: ls.reduce((t, l) => t + l.eadUsd, 0), elUsd: ls.reduce((t, l) => t + l.elUsd, 0) };
      });
      return {
        org: { name: org?.name ?? ws, country: org?.country ?? "", region: org?.region ?? "" },
        generatedAt: new Date().toISOString(),
        summary,
        bands,
        stress,
        watchlist: [...b.loans].filter((l) => l.notches > 0).sort((a, c) => c.notches - a.notches || c.elUpliftUsd - a.elUpliftUsd).slice(0, 15),
        methodology: METHODOLOGY,
      };
    })
  ),
});
