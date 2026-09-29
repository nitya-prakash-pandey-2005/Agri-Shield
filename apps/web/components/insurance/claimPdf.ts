/**
 * Claims evidence report (jsPDF + autotable, client-side).
 */
import type { RouterOutputs } from "@/lib/trpc";
import { pdfText as t } from "./kit";

type Claim = RouterOutputs["insurance"]["validateClaim"];

const INK: [number, number, number] = [15, 23, 42];
const MUTED: [number, number, number] = [100, 116, 139];
const TEAL: [number, number, number] = [8, 145, 178];
const VERDICT: Record<string, { label: string; rgb: [number, number, number] }> = {
  consistent: { label: "CONSISTENT", rgb: [22, 163, 74] },
  partially_consistent: { label: "PARTIALLY CONSISTENT", rgb: [217, 119, 6] },
  not_supported: { label: "NOT SUPPORTED", rgb: [220, 38, 38] },
};

export async function claimEvidencePdf(c: Claim, perilLabel: string, org: string) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 15;
  let y = 0;

  // header band
  doc.setFillColor(6, 18, 38);
  doc.rect(0, 0, W, 34, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text("AGRI-SHIELD  |  Claim evidence report", M, 15);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(165, 243, 252);
  doc.text(t(`${org} - reference ${c.id} - generated ${new Date(c.createdAt).toUTCString()} by ${c.createdBy}`), M, 23);
  doc.text("Decision support from independent open data. Not a loss-adjustment report.", M, 28.5);
  y = 44;

  // verdict box
  const v = VERDICT[c.verdict]!;
  doc.setFillColor(...v.rgb);
  doc.roundedRect(M, y, 62, 22, 2, 2, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(v.label, M + 4, y + 7);
  doc.setFontSize(20);
  doc.text(`${c.score}/100`, M + 4, y + 17);
  doc.setTextColor(...INK);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(t(`Claimed peril: ${perilLabel}`), M + 68, y + 5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const loc = `${c.input.assetName ? `${c.input.assetName} - ` : ""}${c.input.lat.toFixed(4)}, ${c.input.lon.toFixed(4)}`;
  doc.text(t(`Location: ${loc}`), M + 68, y + 11);
  doc.text(t(`Loss date: ${c.input.lossDate}${c.input.claimedUsd ? `   Claimed: USD ${Math.round(c.input.claimedUsd).toLocaleString("en-US")}` : ""}`), M + 68, y + 16.5);
  y += 30;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Summary", M, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  const sum = doc.splitTextToSize(t(c.summary), W - 2 * M) as string[];
  doc.text(sum, M, y);
  y += sum.length * 4.3 + 4;

  autoTable(doc, {
    startY: y,
    head: [["Evidence", "Observed", "Context", "Support", "Weight", "Source"]],
    body: c.evidence.map((e) => [t(e.label), t(e.value), t(e.detail), e.support == null ? "n/a" : `${Math.round(e.support * 100)}%`, e.weight ? `${Math.round(e.weight * 100)}` : "-", t(e.source)]),
    margin: { left: M, right: M },
    styles: { font: "helvetica", fontSize: 7.8, cellPadding: 1.8, textColor: INK, lineColor: [226, 232, 240], lineWidth: 0.1 },
    headStyles: { fillColor: [6, 18, 38], textColor: [236, 254, 255], fontSize: 7.8 },
    columnStyles: { 0: { cellWidth: 34 }, 1: { cellWidth: 22 }, 2: { cellWidth: 60 }, 3: { halign: "right", cellWidth: 15 }, 4: { halign: "right", cellWidth: 13 } },
  });
  y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 8;

  // rainfall bar chart around the loss date
  const series = c.rainSeries;
  if (series.length) {
    if (y + 60 > H - 20) {
      doc.addPage();
      y = M;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Daily rainfall around the loss date (mm, ERA5)", M, y);
    y += 3;
    const ch = 42;
    const cw = W - 2 * M;
    const max = Math.max(10, ...series.map((s) => s.rain ?? 0));
    const bw = cw / series.length;
    doc.setDrawColor(203, 213, 225);
    doc.line(M, y + ch, M + cw, y + ch);
    series.forEach((s, i) => {
      const hgt = ((s.rain ?? 0) / max) * (ch - 4);
      const isLoss = s.date === c.input.lossDate;
      doc.setFillColor(...(isLoss ? ([220, 38, 38] as [number, number, number]) : TEAL));
      if (hgt > 0) doc.rect(M + i * bw + 0.2, y + ch - hgt, Math.max(0.4, bw - 0.4), hgt, "F");
    });
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(`max ${Math.round(max)} mm`, M, y + 2);
    doc.text(series[0]!.date, M, y + ch + 4);
    doc.text(series[series.length - 1]!.date, M + cw - 16, y + ch + 4);
    doc.text(`loss date ${c.input.lossDate} (red)`, M + cw / 2 - 12, y + ch + 4);
    y += ch + 10;
  }

  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  if (y + 40 > H - 20) {
    doc.addPage();
    y = M;
  }
  doc.text("Satellite evidence", M, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  if (c.ndviChangePct != null) doc.text(t(`MODIS NDVI change across the loss date: ${c.ndviChangePct > 0 ? "+" : ""}${c.ndviChangePct}%`), M, y), (y += 4.5);
  doc.setTextColor(...TEAL);
  const wv = doc.splitTextToSize(`NASA Worldview observed-flood layer (MODIS 2-day): ${c.worldviewUrl}`, W - 2 * M) as string[];
  doc.textWithLink(wv[0]!, M, y, { url: c.worldviewUrl });
  if (wv.length > 1) doc.text(wv.slice(1), M, y + 4);
  y += wv.length * 4 + 4;
  doc.setTextColor(...INK);
  if (c.dataNotes.length) {
    doc.setFontSize(8.5);
    for (const n of c.dataNotes) {
      const l = doc.splitTextToSize(t(`Note: ${n}`), W - 2 * M) as string[];
      doc.text(l, M, y);
      y += l.length * 4;
    }
  }
  y += 3;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Method", M, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.3);
  const meth = doc.splitTextToSize(
    t(
      "Each signal is compared with the same calendar window in every other year since 1991 (percentile rank) and converted to a 0-1 support value for the claimed peril. The consistency score is the weighted mean of available signals (weights shown). Verdict: >= 65 consistent, 40-64 partially consistent, < 40 not supported. Rainfall, temperature, evapotranspiration and wind: ERA5 reanalysis (ECMWF/Copernicus) via Open-Meteo (NASA POWER fallback). River discharge: GloFAS v4 (Copernicus EMS). Vegetation: MODIS MOD13Q1 250 m NDVI via ORNL DAAC. Observed flood extent: NASA GIBS MODIS Combined Flood 2-Day."
    ),
    W - 2 * M
  ) as string[];
  doc.text(meth, M, y);

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(t(`Agri-SHIELD claim evidence - ${c.id} - page ${i}/${pages} - decision support, verify on the ground before settlement`), M, H - 8);
  }
  doc.save(`claim-evidence-${c.id}.pdf`);
}
