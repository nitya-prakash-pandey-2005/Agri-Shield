/**
 * Climate stress tests for the loan book.
 *
 * Each scenario overrides the annual hazard probabilities / severities used by
 * the climate-adjusted PD model (credit-risk.ts) and adds collateral haircuts:
 *
 *  flood_10      1-in-10 flood year — every loan whose cell floods at least once a decade
 *                (historical flood frequency ≥ 10 %) experiences the event (p = 1);
 *                others scaled by freq/10 %.
 *  flood_50      1-in-50 flood year — event where freq ≥ 2 %, severity ×1.5, land LGD +10 pp.
 *  drought       Prolonged (two-season) drought — drought event everywhere, severity ×1.3
 *                (×0.6 where historical drought frequency < 5 %), heat severity ×1.2.
 *  salinity      Salinity-intrusion year (2016/2020-type Mekong event) — p = 1 scaled by
 *                coastal salinity exposure, severity ×1.4, land LGD +5 pp in exposed cells.
 *  ssp585_2050   2050 SSP5-8.5 shift — hazard frequencies scaled by CMIP6 HighResMIP change
 *                factors (2031–2050 vs 1995–2014, multi-model mean at each country centroid):
 *                flood × heavy-rain-day frequency factor, drought × (dry-day factor)²,
 *                heat + hot-day delta / 30, salinity × 1.3 (≈ 0.2 m sea-level rise).
 *
 * Outputs: stressed PD, LGD, EL, and IRB "other retail" capital (K·EAD) vs baseline.
 */
import { getStore } from "../data/store";
import { getClimateShift, type ClimateShift } from "../live/history";
import { climatePd, creditBook, HAZARDS, irbRetailK, K_EVENT, LGD_BY_COLLATERAL, lgdFor, ratingFromPd, sensitivity, type Hazard, type LoanRisk } from "./credit-risk";
import { clamp, mean } from "./risk-math";

export type ScenarioId = "flood_10" | "flood_50" | "drought" | "salinity" | "ssp585_2050";

export const SCENARIOS: { id: ScenarioId; name: string; short: string; description: string }[] = [
  { id: "flood_10", name: "1-in-10 flood year", short: "Flood 1:10", description: "A flood season of the severity seen roughly once a decade hits every loan in a cell that floods at least once every 10 years." },
  { id: "flood_50", name: "1-in-50 flood year", short: "Flood 1:50", description: "An extreme flood (e.g. 1998/2000-type) hits nearly all flood-exposed cells with 1.5× damage, and land collateral loses a further 10 pp of recovery value." },
  { id: "drought", name: "Prolonged drought", short: "Drought", description: "Two consecutive failed seasons: every borrower experiences drought with 1.3× severity, plus heat stress." },
  { id: "salinity", name: "Salinity intrusion year", short: "Salinity", description: "A 2016/2020-type dry-season saltwater intrusion across the coastal delta, scaled by each loan's salinity exposure." },
  { id: "ssp585_2050", name: "2050 SSP5-8.5 climate shift", short: "SSP5-8.5 2050", description: "Hazard frequencies shifted to 2031–2050 climate using CMIP6 HighResMIP daily projections (high-emissions pathway)." },
];

export interface StressedLoan {
  id: string;
  pd: number;
  lgd: number;
  el: number;
  k: number;
}

/** Pure: stressed PD/LGD for one loan under a scenario (hazard override + severities + LGD add-on). */
export function stressLoan(l: LoanRisk, sc: ScenarioId, shift: ClimateShift | null): StressedLoan {
  const sens = sensitivity(l.crop);
  const p: Record<Hazard, number> = { ...l.hazardProb };
  const sev: Partial<Record<Hazard, number>> = {};
  let lgdExtra = 0;
  switch (sc) {
    case "flood_10":
      p.flood = l.hazardProb.flood >= 0.1 ? 1 : clamp(l.hazardProb.flood / 0.1);
      break;
    case "flood_50":
      p.flood = l.hazardProb.flood >= 0.02 ? 1 : clamp(l.hazardProb.flood / 0.02);
      sev.flood = 1.5;
      if (l.collateral === "Land-use certificate" && l.hazardProb.flood >= 0.05) lgdExtra = 0.1;
      break;
    case "drought":
      p.drought = 1;
      sev.drought = l.hazardProb.drought >= 0.05 ? 1.3 : 0.6;
      p.heat = Math.max(p.heat, 0.5);
      sev.heat = 1.2;
      break;
    case "salinity":
      p.salinity = l.hazardProb.salinity > 0 ? clamp(0.4 + 1.5 * l.hazardProb.salinity) : 0;
      sev.salinity = 1.4;
      if (l.collateral === "Land-use certificate" && l.hazardProb.salinity >= 0.1) lgdExtra = 0.05;
      break;
    case "ssp585_2050": {
      const s = shift ?? { heavyRainFreqFactor: 1.35, dryDaysFactor: 1.08, hotDaysDelta: 25, rx5dayFactor: 1.1 };
      p.flood = clamp(l.hazardProb.flood * Math.max(1, s.heavyRainFreqFactor));
      p.drought = clamp(l.hazardProb.drought * Math.max(1, s.dryDaysFactor) ** 2);
      p.heat = clamp(l.hazardProb.heat + Math.max(0, s.hotDaysDelta) / 30);
      p.salinity = clamp(l.hazardProb.salinity * 1.3);
      break;
    }
  }
  const pd = l.stage === 3 ? 1 : climatePd(l.pdBase, p, sens, l.segment, sev);
  const lgd = lgdFor(l.collateral, p, lgdExtra);
  return { id: l.id, pd, lgd, el: pd * lgd * l.eadUsd, k: irbRetailK(pd, lgd) * l.eadUsd };
}

export async function runStressTests(workspaceId: string, ids: ScenarioId[] = SCENARIOS.map((s) => s.id)) {
  const book = await creditBook(workspaceId);
  const loans = book.loans;
  // CMIP6 change factors per country centroid (few calls, cached 30 days on disk)
  const shifts = new Map<string, ClimateShift | null>();
  if (ids.includes("ssp585_2050")) {
    const byCountry = new Map<string, LoanRisk[]>();
    for (const l of loans) byCountry.set(l.country, [...(byCountry.get(l.country) ?? []), l]);
    await Promise.all(
      [...byCountry].map(async ([c, ls]) => {
        const pt = { lat: mean(ls.map((l) => l.lat)), lon: mean(ls.map((l) => l.lon)) };
        shifts.set(c, await getClimateShift(pt).catch(() => null));
      })
    );
  }
  const base = {
    elUsd: loans.reduce((t, l) => t + l.elUsd, 0),
    capitalUsd: loans.reduce((t, l) => t + irbRetailK(l.pdClimate, l.lgd) * l.eadUsd, 0),
    capitalBaseUsd: loans.reduce((t, l) => t + irbRetailK(l.pdBase, LGD_BY_COLLATERAL[l.collateral] ?? 0.6) * l.eadUsd, 0),
    pdPct: 0,
    eadUsd: loans.reduce((t, l) => t + l.eadUsd, 0),
  };
  base.pdPct = base.eadUsd ? (loans.reduce((t, l) => t + l.pdClimate * l.eadUsd, 0) / base.eadUsd) * 100 : 0;
  const results = ids.map((id) => {
    const meta = SCENARIOS.find((s) => s.id === id)!;
    const stressed = loans.map((l) => ({ l, s: stressLoan(l, id, shifts.get(l.country) ?? null) }));
    const el = stressed.reduce((t, x) => t + x.s.el, 0);
    const cap = stressed.reduce((t, x) => t + x.s.k, 0);
    const pd = base.eadUsd ? (stressed.reduce((t, x) => t + x.s.pd * x.l.eadUsd, 0) / base.eadUsd) * 100 : 0;
    const byRegion = new Map<string, { eadUsd: number; elUsd: number; elBaseUsd: number }>();
    for (const x of stressed) {
      const r = byRegion.get(x.l.region) ?? { eadUsd: 0, elUsd: 0, elBaseUsd: 0 };
      r.eadUsd += x.l.eadUsd;
      r.elUsd += x.s.el;
      r.elBaseUsd += x.l.elUsd;
      byRegion.set(x.l.region, r);
    }
    const downgrades = stressed.filter((x) => ratingFromPd(x.s.pd) !== x.l.ratingClimate && x.l.stage !== 3).length;
    const top = stressed
      .map((x) => ({ id: x.l.id, name: x.l.name, region: x.l.region, crop: x.l.crop, eadUsd: x.l.eadUsd, pdPct: x.s.pd * 100, elUsd: x.s.el, deltaElUsd: x.s.el - x.l.elUsd, rating: ratingFromPd(x.s.pd) }))
      .sort((a, b) => b.deltaElUsd - a.deltaElUsd)
      .slice(0, 10);
    const shift = id === "ssp585_2050" ? [...shifts.entries()].map(([country, s]) => ({ country, shift: s })) : null;
    return {
      id,
      name: meta.name,
      short: meta.short,
      description: meta.description,
      pdPct: pd,
      elUsd: el,
      elDeltaUsd: el - base.elUsd,
      elMultiple: base.elUsd ? el / base.elUsd : 0,
      capitalUsd: cap,
      capitalDeltaUsd: cap - base.capitalUsd,
      rwaUsd: cap * 12.5,
      elPctOfEad: base.eadUsd ? (el / base.eadUsd) * 100 : 0,
      downgrades,
      byRegion: [...byRegion.entries()].map(([region, v]) => ({ region, ...v })).sort((a, b) => b.elUsd - a.elUsd),
      topLoans: top,
      climateShift: shift,
    };
  });
  return { generatedAt: new Date().toISOString(), base, results, assumptions: { kEvent: K_EVENT, hazards: HAZARDS }, loans: loans.length, workspace: getStore().orgs.find((o) => o.id === workspaceId)?.name ?? workspaceId };
}
