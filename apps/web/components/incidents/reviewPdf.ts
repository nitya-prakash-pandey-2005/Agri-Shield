/**
 * Post-incident review → branded A4 PDF (jsPDF + autotable, client-side).
 * Contents: summary band, SLA metrics, what happened / impact / what worked / what to
 * improve, follow-up actions, stakeholder updates, task checklist and full timeline.
 */
import type { RouterOutputs } from "@/lib/trpc";
import { pdfText } from "@/components/workspace/reportPdf";
import { HAZARD_META, SEVERITY_META, STATUS_META, fmtMinutes } from "./meta";

type Detail = RouterOutputs["incidents"]["get"];
type Review = { whatHappened: string; impact: string; whatWorked: string; whatToImprove: string; actions: { text: string; ownerId: string | null; dueAt: Date | string | null; done: boolean }[]; completedAt?: Date | string | null };

const NAVY: [number, number, number] = [8, 16, 34];
const CYAN: [number, number, number] = [56, 189, 248];
const INK: [number, number, number] = [15, 23, 42];
const MUTED: [number, number, number] = [100, 116, 139];

export async function renderReviewPdf(inc: Detail, review: Review, orgName: string): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 16;
  const t = pdfText;
  let y = 0;
  const lastY = () => ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 7;
  const ensure = (h: number) => {
    if (y + h > H - 18) {
      doc.addPage();
      y = M;
    }
  };
  const name = (id: string | null) => inc.members.find((m) => m.id === id)?.name ?? "—";
  const dt = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—");

  // Cover band
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, 58, "F");
  doc.setFillColor(...CYAN);
  doc.rect(0, 58, W, 1.2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(148, 163, 184);
  doc.text(t(`${orgName.toUpperCase()}  |  POST-INCIDENT REVIEW`), M, 16);
  doc.setFontSize(18);
  doc.setTextColor(255, 255, 255);
  const titleLines = doc.splitTextToSize(t(`INC-${inc.number} ${inc.title}`), W - 2 * M) as string[];
  doc.text(titleLines.slice(0, 2), M, 28);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...CYAN);
  doc.text(t(`${SEVERITY_META[inc.severity].label} | ${HAZARD_META[inc.hazard].label} | ${STATUS_META[inc.status].label} | ${inc.assets.length} assets`), M, 46);
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(8);
  doc.text(t(`Opened ${dt(inc.createdAt)}  |  Resolved ${dt(inc.resolvedAt)}  |  Commander ${name(inc.roles.commander)}${inc.demo ? "  |  DEMO DATA" : ""}`), M, 52);
  y = 68;

  // Metrics
  autoTable(doc, {
    startY: y,
    head: [["Service level", "Target", "Actual", "Result"]],
    body: inc.metrics.clocks.map((c) => [c.label, fmtMinutes(c.targetMin), c.done ? fmtMinutes(c.elapsedMin) : `${fmtMinutes(c.elapsedMin)} (running)`, c.state === "met" ? "Met" : c.state === "breached" ? "Missed" : c.state === "at_risk" ? "At risk" : "Running"]),
    theme: "grid",
    headStyles: { fillColor: NAVY, textColor: 255, fontSize: 8.5 },
    styles: { fontSize: 8.5, textColor: INK },
    margin: { left: M, right: M },
  });
  y = lastY();

  const section = (heading: string, text: string) => {
    if (!text.trim()) return;
    ensure(18);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    doc.text(t(heading), M, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);
    for (const para of t(text).split("\n")) {
      const lines = doc.splitTextToSize(para, W - 2 * M) as string[];
      for (const ln of lines) {
        ensure(5);
        doc.text(ln, M, y);
        y += 4.4;
      }
      y += 1;
    }
    y += 3;
  };
  section("What happened", review.whatHappened);
  section("Impact", `${review.impact}\nExposure in affected assets: $${Math.round(inc.exposureUsd).toLocaleString("en-US")} | modelled value at risk: $${Math.round(inc.varUsd).toLocaleString("en-US")}.`);
  section("What worked", review.whatWorked);
  section("What to improve", review.whatToImprove);

  if (review.actions.length) {
    ensure(20);
    autoTable(doc, {
      startY: y,
      head: [["Follow-up action", "Owner", "Due", "Done"]],
      body: review.actions.map((a) => [t(a.text), t(name(a.ownerId)), a.dueAt ? new Date(a.dueAt).toISOString().slice(0, 10) : "—", a.done ? "Yes" : "No"]),
      theme: "striped",
      headStyles: { fillColor: CYAN, textColor: NAVY, fontSize: 8.5 },
      styles: { fontSize: 8.5, textColor: INK },
      margin: { left: M, right: M },
    });
    y = lastY();
  }

  const updates = inc.updates.filter((u) => u.state === "published");
  if (updates.length) {
    ensure(20);
    autoTable(doc, {
      startY: y,
      head: [["Published", "Stakeholder update", "Sent"]],
      body: updates.map((u) => [dt(u.publishedAt), t(`${u.title}\n${u.body}`), `${u.deliveries.email} e-mail / ${u.deliveries.sms} SMS`]),
      theme: "grid",
      headStyles: { fillColor: NAVY, textColor: 255, fontSize: 8.5 },
      styles: { fontSize: 8, textColor: INK },
      columnStyles: { 0: { cellWidth: 34 }, 2: { cellWidth: 28 } },
      margin: { left: M, right: M },
    });
    y = lastY();
  }

  ensure(20);
  autoTable(doc, {
    startY: y,
    head: [["Phase", "Task", "Owner", "Done at"]],
    body: inc.tasks.map((k) => [k.phase, t(k.title), t(name(k.assigneeId)), k.done ? dt(k.doneAt) : "Not done"]),
    theme: "striped",
    headStyles: { fillColor: NAVY, textColor: 255, fontSize: 8.5 },
    styles: { fontSize: 8, textColor: INK },
    margin: { left: M, right: M },
  });
  y = lastY();

  ensure(20);
  autoTable(doc, {
    startY: y,
    head: [["Time (UTC)", "Who", "Timeline"]],
    body: inc.timeline.map((e) => [dt(e.at).replace(" UTC", ""), t(e.actorName), t(e.text)]),
    theme: "plain",
    headStyles: { fillColor: [226, 232, 240], textColor: INK, fontSize: 8.5 },
    styles: { fontSize: 7.8, textColor: INK },
    columnStyles: { 0: { cellWidth: 30 }, 1: { cellWidth: 32 } },
    margin: { left: M, right: M },
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(t(`Agri-SHIELD incident command | INC-${inc.number} | ${review.completedAt ? `review completed ${dt(review.completedAt)}` : "review draft"}`), M, H - 8);
    doc.text(`${i}/${pages}`, W - M, H - 8, { align: "right" });
  }
  return doc.output("blob");
}
