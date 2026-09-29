/**
 * Ministry-submission PDF report (jsPDF + jspdf-autotable, client-side).
 * Branded cover, KPI summary, district risk table and any selected sections;
 * footer with data provenance + page numbers on every page.
 */
import type { RouterOutputs } from "@/lib/trpc";

type G = RouterOutputs["government"];

export const REPORT_SECTIONS = [
  { key: "cover", label: "Cover & KPIs" },
  { key: "districts", label: "District risk table" },
  { key: "seasons", label: "Season loss comparison" },
  { key: "response", label: "Alert response" },
  { key: "utilisation", label: "Resource utilisation" },
  { key: "hotspots", label: "Hotspots" },
  { key: "briefs", label: "Policy briefs" },
  { key: "gaps", label: "Infrastructure gaps" },
] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number]["key"];

export interface ReportInput {
  title: string;
  recipient: string;
  preparedBy: string;
  sections: ReportSection[];
  context: G["getContext"];
  overview: G["getOverview"];
  regionMap: G["getRegionMap"];
  analytics?: G["getAnalytics"];
  briefs?: G["getPolicyBriefs"];
  gaps?: G["getInfrastructureGaps"];
}

// jsPDF standard fonts are WinAnsi — transliterate diacritics (e.g. Cần Thơ → Can Tho) and symbols.
const t = (s: unknown): string =>
  String(s ?? "")
    .replace(/[đĐ]/g, (c) => (c === "đ" ? "d" : "D"))
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/→/g, "->")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/[×]/g, "x")
    .replace(/[^\x20-\x7E -ÿ\n]/g, "");

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const usd = (n: number | null | undefined) => (n == null ? "-" : `$${compact.format(n)}`);
const int = (n: number | null | undefined) => (n == null ? "-" : Math.round(n).toLocaleString("en-US"));
const pct = (r: number | null | undefined) => (r == null ? "-" : `${Math.round(r * 100)}%`);

const GREEN_DARK: [number, number, number] = [4, 38, 28];
const GREEN: [number, number, number] = [5, 150, 105];
const INK: [number, number, number] = [15, 23, 42];
const MUTED: [number, number, number] = [100, 116, 139];
const FOOTER = "Agri-SHIELD · Data: Open-Meteo, GloFAS (Copernicus), ERA5, GDACS, NASA EONET";

export async function generateReport(r: ReportInput): Promise<string> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 16;
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
  const want = (k: ReportSection) => r.sections.includes(k);
  let y = M;

  const lastY = () => ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 8;
  const ensure = (h: number) => {
    if (y + h > H - 22) {
      doc.addPage();
      y = M + 4;
    }
  };
  const heading = (title: string, sub?: string) => {
    ensure(24);
    doc.setFillColor(...GREEN);
    doc.rect(M, y, 2, sub ? 11 : 7, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...INK);
    doc.text(t(title), M + 5, y + 5);
    if (sub) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...MUTED);
      doc.text(t(sub), M + 5, y + 10);
    }
    y += sub ? 16 : 12;
  };
  const para = (text: string, size = 9.5) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(...INK);
    const lines = doc.splitTextToSize(t(text), W - 2 * M) as string[];
    ensure(lines.length * size * 0.45 + 4);
    doc.text(lines, M, y);
    y += lines.length * size * 0.42 + 4;
  };
  const table = (head: string[], body: (string | number)[][], opts: { align?: Record<number, "left" | "right" | "center"> } = {}) => {
    const columnStyles: Record<number, { halign: "left" | "right" | "center" }> = {};
    for (const [k, v] of Object.entries(opts.align ?? {})) columnStyles[Number(k)] = { halign: v };
    autoTable(doc, {
      startY: y,
      head: [head.map(t)],
      body: body.map((row) => row.map((c) => t(c))),
      margin: { left: M, right: M, bottom: 20 },
      styles: { font: "helvetica", fontSize: 8.2, cellPadding: 2, textColor: INK, lineColor: [226, 232, 240], lineWidth: 0.1 },
      headStyles: { fillColor: GREEN_DARK, textColor: [236, 253, 245], fontStyle: "bold", fontSize: 8 },
      alternateRowStyles: { fillColor: [244, 250, 247] },
      columnStyles,
    });
    y = lastY();
  };

  // ── Cover ───────────────────────────────────────────────────────────────
  doc.setFillColor(...GREEN_DARK);
  doc.rect(0, 0, W, H, "F");
  doc.setFillColor(...GREEN);
  doc.rect(0, 0, W, 4, "F");
  doc.setDrawColor(16, 185, 129);
  doc.setLineWidth(0.3);
  for (let i = 0; i < 9; i++) doc.line(W - 70 + i * 8, 40, W - 20, 90 - i * 6);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(30);
  doc.setTextColor(255, 255, 255);
  doc.text("AGRI-SHIELD", M + 4, 60);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(110, 231, 183);
  doc.text("Climate Decision Intelligence · Government Operations", M + 4, 68);
  doc.setFillColor(16, 185, 129);
  doc.rect(M + 4, 82, 40, 0.8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(255, 255, 255);
  const titleLines = doc.splitTextToSize(t(r.title), W - 2 * M - 8) as string[];
  doc.text(titleLines, M + 4, 98);
  let cy = 98 + titleLines.length * 9 + 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(209, 250, 229);
  const coverRows: [string, string][] = [
    ["Submitted to", r.recipient],
    ["Issuing authority", r.context.orgName],
    ["Jurisdiction", `${r.context.countryName} · ${r.context.districts.length} monitored districts`],
    ["Reporting date", dateStr],
    ["Prepared by", r.preparedBy],
  ];
  for (const [k, v] of coverRows) {
    doc.setTextColor(110, 231, 183);
    doc.setFontSize(8);
    doc.text(t(k.toUpperCase()), M + 4, cy);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11.5);
    doc.text(t(v), M + 4, cy + 5.5);
    cy += 14;
  }
  if (want("cover")) {
    const k = r.overview.kpis;
    const tiles: [string, string][] = [
      ["Monitored area", `${int(k.monitoredHa)} ha`],
      ["High-risk zones", `${k.highRiskZones} of ${k.districts}`],
      ["Farmers in alert zones", int(k.farmersInAlertZones)],
      ["Dispatched today", `${int(k.resourcesDispatchedToday)} units`],
      ["Alerts sent this week", int(k.alertsSentThisWeek)],
      ["Est. crop loss if no action", usd(k.estCropLossUsd)],
    ];
    const tw = (W - 2 * M - 8 - 2 * 4) / 3;
    tiles.forEach(([label, value], i) => {
      const x = M + 4 + (i % 3) * (tw + 4);
      const ty = H - 88 + Math.floor(i / 3) * 26;
      doc.setFillColor(8, 58, 43);
      doc.roundedRect(x, ty, tw, 22, 2, 2, "F");
      doc.setFontSize(7.5);
      doc.setTextColor(110, 231, 183);
      doc.text(t(label.toUpperCase()), x + 3, ty + 6);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(255, 255, 255);
      doc.text(t(value), x + 3, ty + 15);
      doc.setFont("helvetica", "normal");
    });
  }
  doc.setFontSize(8);
  doc.setTextColor(110, 231, 183);
  doc.text(t(`OFFICIAL · Scenario: ${r.context.scenario.mode === "live" ? "live observations" : r.context.scenario.mode.replace(/_/g, " ")} · Generated ${now.toISOString().slice(0, 16).replace("T", " ")} UTC`), M + 4, H - 30);

  // ── Body ────────────────────────────────────────────────────────────────
  doc.addPage();
  y = M + 4;

  if (want("cover")) {
    const k = r.overview.kpis;
    heading("Executive summary", `${r.context.orgName} · ${dateStr}`);
    const top = r.overview.topDistricts[0];
    para(
      `${k.highRiskZones} of ${k.districts} monitored districts are at high or critical risk (${k.highRiskNames.join(", ") || "none"}). ` +
        `An estimated ${int(k.farmersInAlertZones)} farms lie in alert zones, with ${usd(k.estCropLossUsd)} of crop loss expected if no action is taken ` +
        `(crop value exposed: ${usd(k.cropValueAtRiskUsd)}). ${k.alertsIssuedThisWeek} alerts reached ${int(k.alertsSentThisWeek)} recipients this week; ` +
        `${k.activeAlerts} alerts remain active.${top ? ` The highest expected loss is in ${top.name} (${usd(top.expectedLossUsd)}, 72h flood probability ${pct(top.floodProb72h)}).` : ""}`
    );
    table(
      ["Indicator", "Value"],
      [
        ["Total monitored area", `${int(k.monitoredHa)} ha`],
        ["Active high-risk zones", `${k.highRiskZones} (${k.criticalZones} critical)`],
        ["Farmers in alert zones", `${int(k.farmersInAlertZones)} (${k.registeredInAlertZones} registered on platform)`],
        ["Resources dispatched today", `${int(k.resourcesDispatchedToday)} units in ${k.dispatchesToday} dispatches`],
        ["Alerts sent this week", `${int(k.alertsSentThisWeek)} messages · ${k.alertsIssuedThisWeek} alerts`],
        ["Estimated crop loss (no action)", usd(k.estCropLossUsd)],
      ],
      { align: { 1: "right" } }
    );
  }

  if (want("districts")) {
    heading("District risk table", "Live overlay: Open-Meteo forecast, GloFAS discharge, marine sea level · Model v2.3.1");
    table(
      ["District", "Risk", "Flood 72h", "Salinity", "EC dS/m", "Rain 72h", "Farms at risk", "Expected loss"],
      [...r.regionMap]
        .sort((a, b) => b.expectedLossUsd - a.expectedLossUsd)
        .map((d) => [d.name, d.riskLevel.toUpperCase(), pct(d.floodProb72h), `${d.salinityRisk}`, d.ecCurrent.toFixed(1), `${d.rainfall72hMm} mm`, int(d.farmsAtRisk), usd(d.expectedLossUsd)]),
      { align: { 2: "right", 3: "right", 4: "right", 5: "right", 6: "right", 7: "right" } }
    );
  }

  const a = r.analytics;
  if (a && want("seasons")) {
    heading("Season-over-season crop loss", "Probability-weighted predicted loss vs loss after farmer action on early warnings");
    para(`Across ${a.seasons.length} seasons, early warnings are estimated to have avoided ${usd(a.totals.avoidedUsd)} of crop loss (average crop saved per acting farmer: ${a.totals.avgCropSavedPct}%, ${a.totals.outcomeSamples} outcome reports).`);
    table(
      ["Season", "Alerts", "Without EW", "With EW", "Avoided", "Action rate", "Crop saved"],
      a.seasons.map((s) => [s.season, s.alerts, usd(s.withoutEwUsd), usd(s.withEwUsd), usd(s.avoidedUsd), `${s.actionRate}%`, `${s.cropSavedPct}%`]),
      { align: { 1: "right", 2: "right", 3: "right", 4: "right", 5: "right", 6: "right" } }
    );
  }
  if (a && want("response")) {
    heading("Alert response by week", "Read and action rates of delivered messages, last 12 weeks");
    table(
      ["Week of", "Alerts", "Messages", "Read rate", "Action rate"],
      a.weekly.map((w) => [w.week, w.alerts, int(w.sent), w.readRate == null ? "-" : `${w.readRate}%`, w.actionRate == null ? "-" : `${w.actionRate}%`]),
      { align: { 1: "right", 2: "right", 3: "right", 4: "right" } }
    );
  }
  if (a && want("utilisation")) {
    heading("Resource utilisation", "Allocated in last 90 days as % of modelled need (district x resource)");
    const label: Record<string, string> = { pumps: "Pumps", sandbags: "Sandbags", evacuation_buses: "Buses", medical: "Medical", food_aid: "Food aid" };
    table(
      ["District", ...a.resourceTypes.map((x) => label[x] ?? x)],
      a.heatmap.map((row) => [row.district, ...row.cells.map((c) => (c.need || c.allocated ? `${c.utilisationPct}% (${int(c.allocated)}/${int(c.need)})` : "-"))]),
      { align: Object.fromEntries(a.resourceTypes.map((_, i) => [i + 1, "right" as const])) }
    );
  }
  if (a && want("hotspots")) {
    heading("Flood hotspots", "District flood archive 2020-2025, ranked by cumulative loss");
    table(
      ["Rank", "District", "Events", "Archive alerts", "Avg area (ha)", "Total loss", "Trend (ha/yr)", "Risk now"],
      a.hotspots.map((h, i) => [i + 1, h.district, h.events, h.archiveAlerts, int(h.avgAreaHa), usd(h.totalLossUsd), `${h.trendHaPerYear > 0 ? "+" : ""}${int(h.trendHaPerYear)}`, h.currentRisk]),
      { align: { 2: "right", 3: "right", 4: "right", 5: "right", 6: "right", 7: "right" } }
    );
  }

  const b = r.briefs;
  if (b && want("briefs")) {
    heading(`Policy recommendations · ${b.quarter}`, "Generated from live risk, the loss model and the district flood archive");
    for (const br of b.briefs) {
      ensure(40);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.setTextColor(...GREEN_DARK);
      doc.text(t(`${br.rank}. ${br.headline}`), M, y);
      y += 6;
      para(br.summary, 9);
      table(
        ["Intervention", "Cost"],
        [...br.recommendations.map((x) => [x.item, usd(x.costUsd)]), ["Total", usd(br.totalCostUsd)], ["Avoided annual loss", usd(br.avoidedAnnualUsd)], ["Benefit-cost ratio / payback", `${br.bcr} / ${br.paybackYears ?? "-"} yrs`]],
        { align: { 1: "right" } }
      );
    }
    const rr = b.recommendedResult;
    para(
      `Recommended portfolio of ${usd(rr.totalInvestUsd)} avoids ${usd(rr.avoidedAnnualUsd)} per year against a baseline of ${usd(rr.baselineAnnualLossUsd)} (benefit-cost ratio ${rr.bcr}, payback ${rr.paybackYears ?? "-"} years, NPV ${usd(rr.npvUsd)}). Cost of inaction over 15 years (present value): ${usd(rr.costOfInactionUsd)}.`
    );
    para(`Method: ${b.method}`, 7.5);
  }

  const gp = r.gaps;
  if (gp && want("gaps")) {
    heading("Infrastructure gap analysis", `Sensor network coverage vs required density · total gap ${usd(gp.gapCostUsd)}`);
    table(
      ["Priority", "District", "Risk", "Coverage", ...gp.totals.map((x) => `Missing ${x.key}`), "Gap cost"],
      gp.rows.map((row, i) => [i + 1, row.district, row.riskLevel.toUpperCase(), `${row.coveragePct}%`, ...row.sensors.map((s) => s.missing), usd(row.gapCostUsd)]),
      { align: Object.fromEntries([3, 4, 5, 6, 7, 8].map((i) => [i, "right" as const])) }
    );
    table(
      ["Sensor type", "Required", "Installed", "Online", "Unit cost"],
      gp.totals.map((x) => [x.label, int(x.required), int(x.installed), int(x.online), usd(x.unitCost)]),
      { align: { 1: "right", 2: "right", 3: "right", 4: "right" } }
    );
  }

  // ── Footer on every page ────────────────────────────────────────────────
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    if (i === 1) doc.setTextColor(110, 231, 183);
    else {
      doc.setTextColor(...MUTED);
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.2);
      doc.line(M, H - 14, W - M, H - 14);
      doc.text(t(`${r.title} · ${r.context.orgName}`), M, 10);
    }
    doc.text(t(FOOTER), M, H - 9);
    doc.text(`Page ${i} of ${n}`, W - M, H - 9, { align: "right" });
  }

  const slug = r.context.orgName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40);
  const file = `agri-shield-${slug}-${now.toISOString().slice(0, 10)}.pdf`;
  doc.save(file);
  return file;
}
