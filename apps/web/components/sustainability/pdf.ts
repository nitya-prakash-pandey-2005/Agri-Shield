/**
 * Client-side PDFs (jsPDF): the MRV evidence pack (methodology, assumptions, data sources,
 * programme results, per-farm table, adoption evidence) and the ESG summary.
 * Every page is labelled "Indicative, not a Verra VM0051 verified estimate".
 */
import type { RouterOutputs } from "@/lib/trpc";
import { pdfText as t } from "@/components/insurance/kit";

type Prog = RouterOutputs["sustainability"]["carbon"]["programme"];
type Meth = RouterOutputs["sustainability"]["carbon"]["methodology"];
type Esg = RouterOutputs["sustainability"]["esg"]["summary"];

const NAVY: [number, number, number] = [7, 20, 43];
const GREEN: [number, number, number] = [5, 150, 105];
const INK: [number, number, number] = [15, 23, 42];
const MUTED: [number, number, number] = [100, 116, 139];
const n0 = (v: number) => Math.round(v).toLocaleString("en-US");
const n1 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const usd = (v: number) => `USD ${n0(v)}`;

async function doc0(title: string, sub: string, org: string, preparedBy: string, footer: string, banner = "INDICATIVE, NOT A VERRA VM0051 VERIFIED ESTIMATE") {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 16;
  let y = M;
  const lastY = () => ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 7;
  const ensure = (h: number) => {
    if (y + h > H - 20) {
      doc.addPage();
      y = M + 2;
    }
  };
  const h1 = (x: string, s?: string) => {
    ensure(22);
    doc.setFillColor(...GREEN);
    doc.rect(M, y, 2, s ? 11 : 7, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...INK);
    doc.text(t(x), M + 5, y + 5);
    if (s) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...MUTED);
      doc.text(t(s), M + 5, y + 10);
    }
    y += s ? 16 : 12;
  };
  const p = (x: string, size = 9.2, color: [number, number, number] = INK) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(t(x), W - 2 * M) as string[];
    ensure(lines.length * size * 0.42 + 3);
    doc.text(lines, M, y);
    y += lines.length * size * 0.42 + 3;
  };
  const table = (head: string[], body: (string | number)[][], opts: { right?: number[]; size?: number } = {}) => {
    const columnStyles: Record<number, { halign: "right" }> = {};
    for (const i of opts.right ?? []) columnStyles[i] = { halign: "right" };
    autoTable(doc, {
      startY: y,
      head: [head.map(t)],
      body: body.map((r) => r.map((c) => t(c))),
      margin: { left: M, right: M },
      styles: { fontSize: opts.size ?? 8, cellPadding: 1.6, textColor: INK, lineColor: [226, 232, 240], lineWidth: 0.1 },
      headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles,
    });
    y = lastY();
  };
  // cover band
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, 44, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(t(title), M, 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(t(sub), M, 26);
  doc.setFontSize(9);
  doc.text(t(`${org} · prepared by ${preparedBy} · ${new Date().toLocaleString("en-GB")}`), M, 34);
  doc.setFillColor(245, 158, 11);
  doc.rect(M, 38, 108, 5, "F");
  doc.setTextColor(...NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(banner, M + 2, 41.6);
  y = 54;
  const finish = (name: string) => {
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      doc.text(t(footer), M, H - 9);
      doc.text(`${i} / ${pages}`, W - M, H - 9, { align: "right" });
    }
    doc.save(name);
  };
  return { doc, h1, p, table, finish, ensure };
}

export async function mrvEvidencePdf(prog: Prog, meth: Meth, orgName: string, preparedBy: string) {
  const { h1, p, table, finish } = await doc0("MRV evidence pack — rice methane & AWD", "IPCC 2019 Refinement Tier 1 · AR6 GWP-100 · alternate wetting and drying programme", orgName, preparedBy, `Agri-SHIELD · ${orgName} · MRV evidence pack · Indicative, not a Verra VM0051 verified estimate`);
  const T = prog.totals;
  const o = prog.options;

  h1("1. Summary");
  table(
    ["Metric", "Value"],
    [
      ["Crop assets / rice assets", `${T.assets} / ${T.riceAssets}`],
      ["Rice area", `${n1(T.riceAreaHa)} ha`],
      ["AWD-eligible (water control)", `${T.eligibleAssets} assets · ${n1(T.eligibleAreaHa)} ha · ${n0(T.eligibleFarmers)} farmers`],
      ["AWD adopted", `${T.adoptedAssets} assets · ${n1(T.adoptedAreaHa)} ha (${n1(T.adoptionPctArea)} % of eligible area) · ${n0(T.adoptedFarmers)} farmers`],
      ["Verification status", `field-verified ${T.verification.field_verified} · remote-sensed ${T.verification.remote_sensed} · self-reported ${T.verification.self_reported}`],
      ["Emissions this season (all crop assets)", `${n1(T.emissionsSeasonTCo2e)} t CO2e (CH4 ${n1(T.bySource.ch4)} · N2O ${n1(T.bySource.n2o)} · urea CO2 ${n1(T.bySource.ureaCo2)})`],
      ["Baseline this season (no AWD)", `${n1(T.baselineSeasonTCo2e)} t CO2e`],
      ["Annualised emissions", `${n1(T.emissionsAnnualTCo2e)} t CO2e/yr`],
      ["Emissions intensity", T.intensityTCo2ePerT == null ? "-" : `${T.intensityTCo2ePerT} t CO2e / t crop (rice ${T.riceIntensityTCo2ePerT ?? "-"})`],
      ["Avoided by adopted AWD", `${n1(prog.achieved.avoidedAnnualTCo2e)} t CO2e/yr (IPCC EF range ${n1(prog.achieved.avoidedAnnualRange.low)}-${n1(prog.achieved.avoidedAnnualRange.high)})`],
      ["Indicative credit revenue (achieved)", `${usd(prog.achieved.revenue.usd)}/yr — ${n1(prog.achieved.revenue.credits)} credits at USD ${o.priceUsd}/t after ${o.deductionPct} % deduction`],
      [`Scenario: ${o.targetAdoptionPct} % of eligible area`, `${n1(prog.scenario.avoidedAnnualTCo2e)} t CO2e/yr · ${usd(prog.scenario.revenue.usd)}/yr · ${n0(prog.scenario.waterSavedM3)} m3 water saved`],
      ["Irrigation water saved by AWD (achieved)", `${n0(prog.achieved.waterSavedM3)} m3 this season`],
    ],
    { size: 8.5 }
  );

  h1("2. Methodology", "IPCC 2019 Refinement to the 2006 Guidelines, Vol. 4 (AFOLU)");
  p(`Rice methane: ${meth.carbon.ch4.equation}. EF_c = ${meth.carbon.ch4.efBaseline.value} ${meth.carbon.ch4.efBaseline.unit} (${meth.carbon.ch4.efBaseline.table}; range ${meth.carbon.ch4.efBaseline.low}-${meth.carbon.ch4.efBaseline.high})${o.efMode === "regional" ? "; this pack uses the IPCC regional values of Table 5.11A" : ""}. ${meth.carbon.ch4.sfo}. ${meth.carbon.ch4.period}.`);
  const fac = (tbl: Record<string, unknown>) =>
    Object.entries(tbl)
      .filter(([k, v]) => !k.startsWith("_") && typeof v === "object")
      .map(([k, v]) => {
        const f = v as { value: number; low?: number; high?: number; label?: string };
        return [f.label ?? k, f.value, f.low != null ? `${f.low}-${f.high}` : "-"];
      });
  table(["Water regime (Table 5.12)", "SF_w", "Range"], fac(meth.carbon.ch4.sfw as Record<string, unknown>), { right: [1, 2] });
  table(["Pre-season regime (Table 5.13)", "SF_p", ""], fac(meth.carbon.ch4.sfp as Record<string, unknown>), { right: [1] });
  table(["Organic amendment (Table 5.14)", "CFOA", ""], fac(meth.carbon.ch4.cfoa as Record<string, unknown>), { right: [1] });
  p(`Fertiliser N2O: ${meth.carbon.n2o.equation}; EF1 = ${meth.carbon.n2o.ef1Aggregated.value} (aggregated), flooded rice ${meth.carbon.n2o.ef1FloodedRice.value} (continuous ${meth.carbon.n2o.ef1RiceByRegime.continuous}, drained ${meth.carbon.n2o.ef1RiceByRegime.drainage}); Frac_GASF ${meth.carbon.n2o.fracGasf}, EF4 ${meth.carbon.n2o.ef4}, Frac_LEACH ${meth.carbon.n2o.fracLeach}, EF5 ${meth.carbon.n2o.ef5}.`);
  p(`Urea CO2: urea x ${meth.carbon.urea.efTcPerTUrea} t C/t x 44/12; ${meth.carbon.urea.note}.`);
  p(`CO2e: ${meth.carbon.gwp.source} — CH4 (non-fossil) ${meth.carbon.gwp.ch4}, N2O ${meth.carbon.gwp.n2o}.`);
  p(`AWD water: ${meth.water.source}`, 8.5, MUTED);

  h1("3. Assumptions");
  for (const a of meth.carbon.assumptions) p(`- ${a}`, 8.8);
  p(`- Carbon price USD ${o.priceUsd}/t CO2e, conservativeness deduction ${o.deductionPct} %, AWD water saving ${o.awdWaterSavingPct} %.`, 8.8);
  p(`- Eligibility: ${meth.carbon.awd.eligibility}`, 8.8);

  h1("4. Data sources");
  for (const [k, v] of Object.entries(meth.carbon.sources)) p(`- ${k}: ${v}`, 8.3);
  p("- Cultivation periods, yields and water balance: Agri-SHIELD Yield Forecast (FAOSTAT QCL, FAO-56/FAO-33, ERA5 / NASA POWER daily weather).", 8.3);

  h1("5. Per-farm / per-unit results", "Season values; t CO2e");
  const rice = prog.rows.filter((r) => r.crop === "rice");
  table(
    ["Asset", "District", "ha", "Farmers", "Regime", "AWD", "Baseline", "Now", "Avoided"],
    rice.map((r) => [r.name.slice(0, 34), r.district ?? r.country, n1(r.areaHa), n0(r.farmers), r.practice.regime.replace(/_/g, " "), r.practice.awd ? (r.practice.awdStatus ?? "").replace("_", " ") : r.practice.eligible ? "eligible" : "n/a", r.baseline.tCo2e.toFixed(2), r.actual.tCo2e.toFixed(2), r.avoidedTCo2e.toFixed(2)]),
    { right: [2, 3, 6, 7, 8], size: 7.2 }
  );

  h1("6. Adoption evidence register");
  const adopted = rice.filter((r) => r.practice.awd);
  if (adopted.length)
    table(
      ["Asset", "Ref", "Status", "Since", "Lat, lon", "Note"],
      adopted.map((r) => [r.name.slice(0, 32), r.externalRef ?? r.id, (r.practice.awdStatus ?? "").replace("_", " "), r.practice.awdSince ?? "-", `${r.lat.toFixed(4)}, ${r.lon.toFixed(4)}`, (r.practice.note ?? "").slice(0, 40)]),
      { size: 7.4 }
    );
  else p("No AWD adoption recorded yet.");

  h1("7. Limitations");
  p("This pack is an indicative Tier 1 estimate for programme design, investor dialogue and internal reporting. It is NOT a Verra VM0051 (or Gold Standard) quantification: a creditable project needs a validated baseline, measurement of the water regime on every plot (e.g. field water tubes, remote sensing of drying events), statistical sampling, uncertainty deductions, leakage assessment, permanence and third-party validation & verification. Default IPCC factors carry wide uncertainty (EF_c 0.80-1.76 kg CH4/ha/day).", 8.8);
  finish(`mrv-evidence-pack-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export async function esgPdf(e: Esg, preparedBy: string) {
  const { h1, p, table, finish } = await doc0("ESG summary — climate, emissions, water & reach", `${e.workspace.industry ?? "workspace"} · ${e.workspace.country ?? ""}`, e.workspace.name, preparedBy, `Agri-SHIELD · ${e.workspace.name} · ESG summary · decision-support, not audited`, "DECISION-SUPPORT SUMMARY - NOT AUDITED");
  const r = e.physicalRisk;
  h1("1. Physical climate risk", "Portfolio exposure to flood, salinity, drought and heat");
  table(
    ["Metric", "Value"],
    [
      ["Assets", n0(r.assets)],
      ["Exposure", usd(r.exposureUsd)],
      ["Value at risk", `${usd(r.valueAtRiskUsd)} (${r.varRatioPct} % of exposure)`],
      [`Assets at/above risk threshold (${r.threshold})`, `${r.atRiskAssets} · ${usd(r.atRiskExposureUsd)}`],
      ["VaR by hazard", `flood ${usd(r.byHazardUsd.flood)} · salinity ${usd(r.byHazardUsd.salinity)} · drought ${usd(r.byHazardUsd.drought)} · heat ${usd(r.byHazardUsd.heat)}`],
      ["Mean composite risk score", `${r.meanComposite} / 100`],
    ],
    { size: 8.8 }
  );
  h1("2. Production outlook");
  table(
    ["Metric", "Value"],
    [
      ["Crop assets", n0(e.production.cropAssets)],
      ["Expected production (P10 / P50 / P90)", `${n0(e.production.productionT.p10)} / ${n0(e.production.productionT.p50)} / ${n0(e.production.productionT.p90)} t`],
      ["vs 5-yr normal", `${e.production.vsNormalPct} %`],
      ["Farm-gate value", usd(e.production.valueUsd)],
    ],
    { size: 8.8 }
  );
  h1("3. Emissions (IPCC 2019 Tier 1)");
  table(
    ["Metric", "Value"],
    [
      ["Season emissions", `${n1(e.emissions.seasonTCo2e)} t CO2e`],
      ["Annualised", `${n1(e.emissions.annualTCo2e)} t CO2e/yr`],
      ["By source", `rice CH4 ${n1(e.emissions.bySource.ch4)} · N2O ${n1(e.emissions.bySource.n2o)} · urea CO2 ${n1(e.emissions.bySource.ureaCo2)} t CO2e`],
      ["Intensity", e.emissions.intensityTCo2ePerT == null ? "-" : `${e.emissions.intensityTCo2ePerT} t CO2e / t crop`],
      ["Rice intensity", e.emissions.riceIntensityTCo2ePerT == null ? "-" : `${e.emissions.riceIntensityTCo2ePerT} t CO2e / t paddy`],
      ["Avoided by AWD", `${n1(e.emissions.avoidedAnnualTCo2e)} t CO2e/yr (adoption ${e.emissions.awdAdoptionPctArea} % of eligible area)`],
    ],
    { size: 8.8 }
  );
  h1("4. Water");
  table(
    ["Metric", "Value"],
    [
      ["Irrigation withdrawal (season)", `${n0(e.water.withdrawalM3)} m3`],
      ["Green / blue consumptive water", `${n0(e.water.greenM3)} / ${n0(e.water.blueM3)} m3`],
      ["Water footprint", e.water.footprintM3PerT == null ? "-" : `${n0(e.water.footprintM3PerT)} m3 / t`],
      ["Saved by AWD", `${n0(e.water.awdSavedM3)} m3`],
    ],
    { size: 8.8 }
  );
  h1("5. Smallholder reach");
  table(
    ["Metric", "Value"],
    [
      ["Farmers / households covered", n0(e.reach.farmers)],
      ["Area", `${n1(e.reach.areaHa)} ha`],
      ["Women-headed households", e.reach.womenHeadedPct == null ? "not recorded" : `${e.reach.womenHeadedPct} %`],
      ["Basis", e.reach.womenHeadedBasis],
      ["Farmers practising AWD", n0(e.reach.awdFarmers)],
    ],
    { size: 8.8 }
  );
  h1("6. Framework alignment & notes");
  p(`Structured to support: ${e.frameworks.join("; ")}.`, 8.8);
  for (const n of e.notes) p(`- ${n}`, 8.6, MUTED);
  finish(`esg-summary-${new Date().toISOString().slice(0, 10)}.pdf`);
}
