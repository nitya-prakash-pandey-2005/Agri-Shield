/**
 * Renders a workspace ReportSnapshot (server-built from live data) to a
 * branded A4 PDF with jsPDF + jspdf-autotable, client-side. The same
 * snapshot always renders the same document, so history downloads match
 * what was generated at the time. Also: CSV export of every table.
 */
import type { ReportSnapshot } from "@/server/services/workspace-state";

const CYAN: [number, number, number] = [56, 189, 248];
const NAVY: [number, number, number] = [8, 16, 34];
const INK: [number, number, number] = [15, 23, 42];
const MUTED: [number, number, number] = [100, 116, 139];

/** Helvetica (WinAnsi) can't draw every glyph — normalise text so nothing turns into garbage. */
export function pdfText(v: unknown): string {
  return String(v ?? "")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/→/g, "->")
    .replace(/·/g, "|")
    .replace(/…/g, "...")
    .replace(/[đĐ]/g, (c) => (c === "đ" ? "d" : "D"))
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E -ÿ\n]/g, "");
}

export async function renderReportPdf(snap: ReportSnapshot, opts: { logoInitials?: string; logoColor?: string } = {}): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 16;
  let y = M;
  const t = pdfText;
  const lastY = () => ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 7;
  const ensure = (h: number) => {
    if (y + h > H - 20) {
      doc.addPage();
      y = M + 4;
    }
  };

  // ── Cover band ───────────────────────────────────────────────────────
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, 64, "F");
  doc.setFillColor(...CYAN);
  doc.rect(0, 64, W, 1.2, "F");
  const hex = (opts.logoColor ?? "#38bdf8").replace("#", "");
  doc.setFillColor(parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16));
  doc.roundedRect(M, 14, 14, 14, 3, 3, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...NAVY);
  doc.text(t(opts.logoInitials ?? "AS"), M + 7, 23, { align: "center" });
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.text(t(snap.orgName.toUpperCase()), M + 18, 19.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(148, 163, 184);
  doc.text("Prepared with Agri-SHIELD climate decision intelligence", M + 18, 24.5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(255, 255, 255);
  doc.text(t(snap.title), M, 42);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...CYAN);
  doc.text(t(snap.subtitle), M, 49);
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(8.5);
  doc.text(t(`Generated ${new Date(snap.generatedAt).toUTCString().replace(" GMT", " UTC")} by ${snap.generatedBy}`), M, 56);
  y = 76;

  // ── Summary callout ──────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  const sumLines = doc.splitTextToSize(t(snap.summary), W - 2 * M - 10) as string[];
  const boxH = sumLines.length * 5.2 + 8;
  doc.setFillColor(236, 248, 255);
  doc.setDrawColor(...CYAN);
  doc.roundedRect(M, y, W - 2 * M, boxH, 2, 2, "FD");
  doc.setTextColor(...INK);
  doc.text(sumLines, M + 5, y + 7);
  y += boxH + 8;

  for (const s of snap.sections) {
    // keep a heading with the first rows of its table / KPI grid
    ensure(s.table ? 42 : s.kpis ? 30 : 20);
    doc.setFillColor(...CYAN);
    doc.rect(M, y - 4, 1.6, 6.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12.5);
    doc.setTextColor(...INK);
    doc.text(t(s.heading), M + 4, y + 1);
    y += 8;

    for (const p of s.paragraphs ?? []) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(...INK);
      const lines = doc.splitTextToSize(t(p), W - 2 * M) as string[];
      ensure(lines.length * 4.3 + 3);
      doc.text(lines, M, y);
      y += lines.length * 4.2 + 3;
    }
    if (s.kpis?.length) {
      const cols = Math.min(3, s.kpis.length);
      const cw = (W - 2 * M - (cols - 1) * 4) / cols;
      s.kpis.forEach((k, i) => {
        const col = i % cols;
        if (col === 0) ensure(19);
        const x = M + col * (cw + 4);
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(226, 232, 240);
        doc.roundedRect(x, y, cw, 16, 1.5, 1.5, "FD");
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(...MUTED);
        doc.text(t(k.label.toUpperCase()), x + 3, y + 5);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11.5);
        doc.setTextColor(...INK);
        doc.text(t(k.value), x + 3, y + 12, { maxWidth: cw - 6 });
        if (col === cols - 1 || i === s.kpis!.length - 1) y += 19;
      });
      y += 1;
    }
    if (s.bullets?.length) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      for (const b of s.bullets) {
        const lines = doc.splitTextToSize(t(b), W - 2 * M - 6) as string[];
        ensure(lines.length * 4.3 + 2);
        doc.setFillColor(...CYAN);
        doc.circle(M + 1.5, y - 1.2, 0.8, "F");
        doc.setTextColor(...INK);
        doc.text(lines, M + 5, y);
        y += lines.length * 4.2 + 2;
      }
      y += 2;
    }
    if (s.table) {
      ensure(18);
      autoTable(doc, {
        startY: y,
        head: [s.table.columns.map(t)],
        body: s.table.rows.map((r) => r.map((c) => (typeof c === "number" ? c.toLocaleString("en-US") : t(c)))),
        margin: { left: M, right: M, bottom: 18 },
        styles: { font: "helvetica", fontSize: 8, cellPadding: 1.8, textColor: INK, lineColor: [226, 232, 240], lineWidth: 0.1 },
        headStyles: { fillColor: NAVY, textColor: [224, 242, 254], fontStyle: "bold", fontSize: 7.8 },
        alternateRowStyles: { fillColor: [245, 249, 255] },
      });
      y = lastY();
    }
    y += 3;
  }

  // ── Sources ──────────────────────────────────────────────────────────
  ensure(20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  doc.text("Data sources", M, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  for (const src of snap.sources) {
    const lines = doc.splitTextToSize(t(`- ${src}`), W - 2 * M) as string[];
    ensure(lines.length * 3.6 + 1);
    doc.text(lines, M, y);
    y += lines.length * 3.6 + 1;
  }

  // ── Footers ──────────────────────────────────────────────────────────
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(t(`${snap.orgName} | ${snap.title} | Model outputs are probabilistic estimates, not guarantees.`), M, H - 8);
    doc.text(`${p} / ${pages}`, W - M, H - 8, { align: "right" });
  }
  return doc.output("blob");
}

export function reportFileName(snap: ReportSnapshot, ext = "pdf") {
  const slug = snap.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug}-${snap.generatedAt.slice(0, 10)}.${ext}`;
}

/** All tables in the snapshot as one CSV (sections separated by a heading row). */
export function reportCsv(snap: ReportSnapshot): string {
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const out: string[] = [`# ${snap.title} — ${snap.orgName} — ${snap.generatedAt}`];
  for (const s of snap.sections) {
    if (s.kpis) out.push("", `# ${s.heading}`, "metric,value", ...s.kpis.map((k) => `${esc(k.label)},${esc(k.value)}`));
    if (s.table) out.push("", `# ${s.heading}`, s.table.columns.map(esc).join(","), ...s.table.rows.map((r) => r.map(esc).join(",")));
  }
  return out.join("\n");
}
