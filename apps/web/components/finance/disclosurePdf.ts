/**
 * Physical climate-risk disclosure (TCFD / IFRS S2-aligned structure), multi-page
 * jsPDF report generated client-side from finance.disclosure.
 * Labelled throughout as decision-support, not audited.
 */
import type { RouterOutputs } from "@/lib/trpc";
import { pdfText as t } from "@/components/insurance/kit";

type D = RouterOutputs["finance"]["disclosure"];

const NAVY: [number, number, number] = [7, 20, 43];
const TEAL: [number, number, number] = [8, 145, 178];
const INK: [number, number, number] = [15, 23, 42];
const MUTED: [number, number, number] = [100, 116, 139];
const usd = (v: number) => `USD ${Math.round(v).toLocaleString("en-US")}`;
const pc = (v: number, d = 1) => `${v.toFixed(d)}%`;

export async function disclosurePdf(d: D, preparedBy: string) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 16;
  let y = M;
  const s = d.summary;
  const lastY = () => ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 7;
  const ensure = (h: number) => {
    if (y + h > H - 20) {
      doc.addPage();
      y = M + 2;
    }
  };
  const h1 = (x: string, sub?: string) => {
    ensure(22);
    doc.setFillColor(...TEAL);
    doc.rect(M, y, 2, sub ? 11 : 7, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13.5);
    doc.setTextColor(...INK);
    doc.text(t(x), M + 5, y + 5);
    if (sub) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...MUTED);
      doc.text(t(sub), M + 5, y + 10);
    }
    y += sub ? 16 : 12;
  };
  const p = (x: string, size = 9.3) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(...INK);
    const lines = doc.splitTextToSize(t(x), W - 2 * M) as string[];
    ensure(lines.length * size * 0.42 + 3);
    doc.text(lines, M, y);
    y += lines.length * size * 0.42 + 3;
  };
  const table = (head: string[], body: (string | number)[][], right: number[] = []) => {
    const columnStyles: Record<number, { halign: "right" }> = {};
    for (const i of right) columnStyles[i] = { halign: "right" };
    autoTable(doc, {
      startY: y,
      head: [head.map(t)],
      body: body.map((r) => r.map((c) => t(c))),
      margin: { left: M, right: M, bottom: 20 },
      styles: { font: "helvetica", fontSize: 8, cellPadding: 1.8, textColor: INK, lineColor: [226, 232, 240], lineWidth: 0.1 },
      headStyles: { fillColor: NAVY, textColor: [224, 242, 254], fontSize: 8 },
      alternateRowStyles: { fillColor: [241, 245, 249] },
      columnStyles,
    });
    y = lastY();
  };

  // ── Cover
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, H, "F");
  doc.setFillColor(...TEAL);
  doc.rect(0, 0, W, 4, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.text("Physical climate risk", M + 2, 70);
  doc.text("disclosure", M + 2, 82);
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(165, 243, 252);
  doc.text(t(`${d.org.name} - agricultural loan book`), M + 2, 94);
  doc.text("Structured along TCFD recommendations and IFRS S2 (physical risk)", M + 2, 101);
  doc.setFontSize(10);
  doc.setTextColor(203, 213, 225);
  doc.text(t(`Reporting date: ${new Date(d.generatedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}`), M + 2, 120);
  doc.text(t(`Prepared by: ${preparedBy} using Agri-SHIELD`), M + 2, 126);
  doc.setFillColor(220, 38, 38);
  doc.roundedRect(M + 2, 140, W - 2 * M - 4, 20, 2, 2, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("DECISION-SUPPORT ANALYSIS - NOT AUDITED", M + 6, 148);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text("Model outputs for internal risk management and disclosure preparation; not an assurance engagement.", M + 6, 154);

  // ── 1. Summary
  doc.addPage();
  y = M + 2;
  h1("1. Executive summary");
  p(
    `The ${s.loans} agricultural loans in scope carry ${usd(s.eadUsd)} of exposure at default. Weighting each borrower's internal rating by the physical hazards at its location (flood, drought, salinity intrusion, heat) raises the exposure-weighted 12-month probability of default from ${pc(s.pdBasePct, 2)} to ${pc(s.pdClimatePct, 2)} and expected credit loss from ${usd(s.elBaseUsd)} to ${usd(s.elUsd)} (+${pc(s.elUpliftPct, 0)}). ${s.downgraded} loans (${usd(s.downgradedEadUsd)} EAD) would sit at least one rating notch lower on a climate-adjusted basis.`
  );
  const worst = [...d.stress.results].sort((a, b) => b.elUsd - a.elUsd)[0]!;
  p(`Under the most severe scenario tested (${worst.name}) expected loss reaches ${usd(worst.elUsd)} (${worst.elMultiple.toFixed(1)}x today) and IRB-style capital increases by ${usd(worst.capitalDeltaUsd)}.`);
  table(
    ["Metric", "Baseline", "Climate-adjusted"],
    [
      ["Exposure at default (EAD)", usd(s.eadUsd), usd(s.eadUsd)],
      ["Weighted PD (12 m)", pc(s.pdBasePct, 2), pc(s.pdClimatePct, 2)],
      ["Weighted LGD", "-", pc(s.lgdPct, 1)],
      ["Expected credit loss (12 m)", usd(s.elBaseUsd), usd(s.elUsd)],
      ["Lifetime expected loss", "-", usd(s.lifetimeElUsd)],
      ["Loans downgraded", "-", String(s.downgraded)],
    ],
    [1, 2]
  );

  // ── 2. Governance
  h1("2. Governance", "TCFD Governance a-b / IFRS S2 paras 5-7");
  p("[To be completed by the institution] Describe board oversight of climate-related risks (committee, frequency of reporting) and management's role (e.g. Chief Risk Officer ownership of the climate-adjusted PD overlay, credit committee use of the watchlist). Agri-SHIELD provides the quantitative inputs below; governance statements must be written and approved by the institution.");

  // ── 3. Strategy
  h1("3. Strategy - physical risks and opportunities", "TCFD Strategy a-c / IFRS S2 paras 10-22");
  p("Acute physical risks: riverine and pluvial flooding (monsoon and typhoon rainfall, river discharge), dry-season saltwater intrusion in the coastal delta, and heat stress. Chronic physical risks: rising frequency of heavy-rain days and hot days under high-emission pathways, sea-level rise extending salinity intrusion.");
  table(
    ["Hazard", "Avg. annual probability of a severe year", "Contribution to weighted PD"],
    s.hazardShare.map((h) => [h.hazard, pc((s.avgHazardProb as Record<string, number>)[h.hazard]! * 100, 1), `+${h.pp.toFixed(2)} pp`]),
    [1, 2]
  );
  p("Concentration: exposure by region and crop (top rows).");
  table(
    ["Region", "Loans", "EAD", "Climate EL", "Weighted PD"],
    s.byRegion.slice(0, 10).map((r) => [r.key, r.loans, usd(r.eadUsd), usd(r.elUsd), pc(r.pdClimatePct, 2)]),
    [1, 2, 3, 4]
  );
  table(
    ["Crop", "Loans", "EAD", "Baseline EL", "Climate EL"],
    s.byCrop.map((r) => [r.key, r.loans, usd(r.eadUsd), usd(r.elBaseUsd), usd(r.elUsd)]),
    [1, 2, 3, 4]
  );
  p("Resilience - scenario analysis (12-month horizon, static balance sheet):");
  table(
    ["Scenario", "Weighted PD", "Expected loss", "x today", "Capital (K.EAD)", "Change in capital"],
    [["Today (climate-adjusted)", pc(d.stress.base.pdPct, 2), usd(d.stress.base.elUsd), "1.00", usd(d.stress.base.capitalUsd), "-"], ...d.stress.results.map((r) => [r.name, pc(r.pdPct, 2), usd(r.elUsd), r.elMultiple.toFixed(2), usd(r.capitalUsd), `+${usd(r.capitalDeltaUsd)}`])],
    [1, 2, 3, 4, 5]
  );

  // ── 4. Risk management
  h1("4. Risk management", "TCFD Risk Management a-c / IFRS S2 paras 24-26");
  p("Identification: every financed farm is geolocated and assessed against 35 years of daily reanalysis (ERA5 via Open-Meteo, NASA POWER fallback) and GloFAS v4 river discharge, plus the live 72-hour forecast. Assessment: severe-hazard frequencies are converted to a PD overlay on the internal rating and to a collateral haircut in LGD. Management: loans downgraded by climate are placed on a watchlist; borrowers in arrears facing an active hazard in the next 72 hours trigger early-warning outreach.");
  table(
    ["Exposure band (climate PD uplift)", "Loans", "EAD", "Climate EL"],
    d.bands.map((b) => [b.band, b.loans, usd(b.eadUsd), usd(b.elUsd)]),
    [1, 2, 3]
  );
  if (d.watchlist.length) {
    p("Watchlist - largest climate downgrades:");
    table(
      ["Borrower", "Region", "EAD", "Rating", "PD base -> climate", "Main driver"],
      d.watchlist.slice(0, 12).map((l) => [l.name, l.region, usd(l.eadUsd), `${l.ratingBase} -> ${l.ratingClimate}`, `${pc(l.pdBase * 100, 1)} -> ${pc(l.pdClimate * 100, 1)}`, (l.drivers[0] ?? "").split(":")[0] ?? ""]),
      [2]
    );
  }

  // ── 5. Metrics & targets
  h1("5. Metrics and targets", "TCFD Metrics & Targets a-c / IFRS S2 paras 27-37");
  p(`Amount and share of assets vulnerable to physical risk: ${usd(d.bands.filter((b) => !b.band.startsWith("Low")).reduce((a, b) => a + b.eadUsd, 0))} (${pc((d.bands.filter((b) => !b.band.startsWith("Low")).reduce((a, b) => a + b.eadUsd, 0) / Math.max(1, s.eadUsd)) * 100, 0)} of EAD) sits in loans whose PD rises by at least 0.25 percentage points because of physical climate hazards. [Targets - e.g. maximum share of EAD in the 'very high' band, adaptation-finance volumes - to be set by the institution.]`);

  // ── 6. Methodology
  h1("6. Methodology and limitations");
  const m = d.methodology;
  p(`Baseline PD by internal rating: ${Object.entries(m.ratingPd).map(([k, v]) => `${k} ${(Number(v) * 100).toFixed(1)}%`).join(", ")}. ${m.dpd}.`);
  p(`Climate overlay: ${m.formula}. Extra default probability in a severe hazard year (k): ${Object.entries(m.kEvent).map(([k, v]) => `${k} ${(Number(v) * 100).toFixed(0)}%`).join(", ")}; SME segment x0.7. Crop sensitivities range 0.3-1.0 by crop and hazard.`);
  for (const [k, v] of Object.entries(m.hazardRules)) p(`${k[0]!.toUpperCase()}${k.slice(1)} frequency: ${v}.`, 8.8);
  p(`${m.live}.`, 8.8);
  p(`LGD by collateral: ${Object.entries(m.lgd).map(([k, v]) => `${k} ${(Number(v) * 100).toFixed(0)}%`).join(", ")}; +5 pp on land in flood-prone (>= 25 %/yr) or salinising cells, +3 pp for machinery in flood-prone cells.`, 8.8);
  p(`Capital: ${m.capital}.`, 8.8);
  p("Stress scenarios: 1-in-10 and 1-in-50 flood years, prolonged two-season drought, 2016/2020-type salinity intrusion, and a 2050 SSP5-8.5 shift using CMIP6 HighResMIP daily projections (EC-Earth3P-HR, MRI-AGCM3-2-S) via the Open-Meteo climate API.", 8.8);
  p("Limitations: hazard frequencies are estimated at district reference points, not individual parcels; k-factors are calibration assumptions to be validated against the institution's own default history after past hazard events; balance sheet static; no second-round effects (prices, migration); transition risk out of scope. Results are decision-support and have not been audited.", 8.8);
  p(`Data sources: ${m.sources.map((x) => x.name).join("; ")}; NASA POWER; CMIP6 HighResMIP (Open-Meteo climate API).`, 8.3);

  const pages = doc.getNumberOfPages();
  for (let i = 2; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(t(`${d.org.name} - Physical climate risk disclosure - decision-support, not audited - page ${i - 1}/${pages - 1}`), M, H - 8);
  }
  doc.save(`physical-risk-disclosure-${new Date().toISOString().slice(0, 10)}.pdf`);
}
