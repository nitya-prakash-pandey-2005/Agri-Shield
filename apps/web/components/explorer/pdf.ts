/**
 * Branded, multi-page climate due-diligence PDF (jsPDF + autotable, client-side).
 * Charts are drawn from the data with vector primitives (no screenshots), so the
 * PDF is crisp, small and reproducible. Sections: cover & verdict, forecast,
 * flood & river, salinity / drought / heat, 40-year climate, outlook & 2050,
 * soil & terrain, methodology & sources.
 */
import type { ReportBundle } from "./types";
import { buildInsights } from "./insights";
import { assetLabel, cropLabel } from "./types";

type RGB = [number, number, number];
const INK: RGB = [15, 23, 42];
const MUTED: RGB = [100, 116, 139];
const GREEN: RGB = [5, 150, 105];
const GREEN_DARK: RGB = [4, 38, 28];
const SKY: RGB = [14, 165, 233];
const SKY_SOFT: RGB = [186, 230, 253];
const AMBER: RGB = [217, 119, 6];
const ROSE: RGB = [225, 29, 72];
const GRID: RGB = [226, 232, 240];

// jsPDF standard fonts are WinAnsi — transliterate (Bến Tre → Ben Tre) and symbols.
const t = (s: unknown): string =>
  String(s ?? "")
    .replace(/[đĐ]/g, (c) => (c === "đ" ? "d" : "D"))
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/→/g, "->")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/×/g, "x")
    .replace(/−/g, "-")
    .replace(/[₀]/g, "0")
    .replace(/m³/g, "m3")
    .replace(/[^\x20-\x7E -ÿ\n]/g, "");

const scoreRGB = (s: number): RGB => (s >= 80 ? [124, 58, 237] : s >= 60 ? [220, 38, 38] : s >= 35 ? [217, 119, 6] : [22, 163, 74]);
const pct = (p: number | null | undefined) => (p == null ? "-" : `${Math.round(p * 100)}%`);
const num = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? "-" : v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }));
const sgn = (v: number | null | undefined, d = 0) => (v == null ? "-" : `${v > 0 ? "+" : ""}${v.toFixed(d)}`);

export async function generateExplorerPdf(b: ReportBundle, opts: { preparedFor?: string | null; preparedBy?: string | null; shareUrl?: string | null } = {}): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 16;
  const r = b.report;
  const x = r.extras ?? {};
  const hist = b.climate?.history ?? x.climate ?? null;
  const drought = b.climate?.drought ?? x.drought ?? null;
  const seasonal = b.outlook?.seasonal ?? x.seasonal ?? null;
  const proj = b.outlook?.projection ?? x.projection ?? null;
  const ins = buildInsights(b, b.assetType, b.crop);
  const place = r.location.name ?? `${r.location.lat.toFixed(4)}, ${r.location.lon.toFixed(4)}`;
  const dateStr = new Date(r.generatedAt).toLocaleString("en-GB", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
  let y = M;

  const lastY = () => ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 6;
  const ensure = (h: number) => {
    if (y + h > H - 20) {
      doc.addPage();
      y = M + 2;
    }
  };
  const heading = (title: string, sub?: string) => {
    ensure(22);
    doc.setFillColor(...GREEN);
    doc.rect(M, y, 2, sub ? 10 : 6.5, "F");
    doc.setTextColor(...INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(t(title), M + 5, y + 5);
    if (sub) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...MUTED);
      doc.text(t(sub), M + 5, y + 9.5, { maxWidth: W - 2 * M - 5 });
    }
    y += sub ? 15 : 11;
  };
  const para = (text: string, size = 9.5, color: RGB = INK) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(t(text), W - 2 * M) as string[];
    ensure(lines.length * size * 0.42 + 2);
    doc.text(lines, M, y);
    y += lines.length * size * 0.42 + 2;
  };
  const bullets = (items: string[], color: RGB = GREEN) => {
    for (const it of items) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      const lines = doc.splitTextToSize(t(it), W - 2 * M - 5) as string[];
      ensure(lines.length * 4.1 + 1.5);
      doc.setFillColor(...color);
      doc.circle(M + 1.2, y - 1.1, 0.8, "F");
      doc.setTextColor(...INK);
      doc.text(lines, M + 4.5, y);
      y += lines.length * 4.1 + 1.5;
    }
  };
  const table = (head: string[], body: (string | number)[][], opts2: { colWidths?: number[] } = {}) => {
    autoTable(doc, {
      startY: y,
      head: [head.map(t)],
      body: body.map((row) => row.map((c) => t(c))),
      margin: { left: M, right: M },
      styles: { fontSize: 8.5, cellPadding: 1.8, textColor: INK, lineColor: GRID, lineWidth: 0.1 },
      headStyles: { fillColor: GREEN_DARK, textColor: [236, 253, 245], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: Object.fromEntries((opts2.colWidths ?? []).map((w, i) => [i, { cellWidth: w }])),
    });
    y = lastY();
  };

  /** Minimal vector chart: bars / line / band over a shared x index, one y-axis. */
  const chart = (
    title: string,
    h: number,
    series: { kind: "bar" | "line" | "band" | "dash"; values: (number | null)[]; upper?: (number | null)[]; color: RGB }[],
    labels: string[],
    unit: string
  ) => {
    ensure(h + 12);
    const x0 = M + 10;
    const x1 = W - M;
    const y0 = y + 6;
    const y1 = y + 6 + h;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(t(title), M, y);
    const all = series.flatMap((s) => [...s.values, ...(s.upper ?? [])]).filter((v): v is number => v != null && Number.isFinite(v));
    const hasBar = series.some((s) => s.kind === "bar");
    const nonNeg = all.every((v) => v >= 0);
    let lo = hasBar ? 0 : Math.min(...all);
    let hi = Math.max(...all, lo + 1);
    const pad = (hi - lo) * 0.08;
    if (!hasBar) lo = nonNeg ? Math.max(0, lo - pad) : lo - pad;
    hi += pad;
    const n = labels.length;
    const xs = (i: number) => x0 + ((i + 0.5) / n) * (x1 - x0);
    const ys = (v: number) => y1 - ((v - lo) / (hi - lo || 1)) * (y1 - y0);
    doc.setDrawColor(...GRID);
    doc.setLineWidth(0.15);
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    for (let k = 0; k <= 3; k++) {
      const v = lo + ((hi - lo) * k) / 3;
      const yy = ys(v);
      doc.line(x0, yy, x1, yy);
      doc.text(`${Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10}`, x0 - 1.5, yy + 1, { align: "right" });
    }
    doc.text(t(unit), x0 - 1.5, y0 - 2.5, { align: "right" });
    for (const s of series) {
      if (s.kind === "band" && s.upper) {
        doc.setFillColor(...s.color);
        for (let i = 0; i < n - 1; i++) {
          const a = s.values[i];
          const bq = s.upper[i];
          const c = s.values[i + 1];
          const d = s.upper[i + 1];
          if (a == null || bq == null || c == null || d == null) continue;
          // quad as two triangles
          doc.triangle(xs(i), ys(a), xs(i), ys(bq), xs(i + 1), ys(d), "F");
          doc.triangle(xs(i), ys(a), xs(i + 1), ys(d), xs(i + 1), ys(c), "F");
        }
      } else if (s.kind === "bar") {
        doc.setFillColor(...s.color);
        const bw = Math.max(0.4, ((x1 - x0) / n) * 0.7);
        s.values.forEach((v, i) => {
          if (v == null || v <= 0) return;
          doc.rect(xs(i) - bw / 2, ys(v), bw, y1 - ys(v), "F");
        });
      } else {
        doc.setDrawColor(...s.color);
        doc.setLineWidth(s.kind === "dash" ? 0.35 : 0.6);
        if (s.kind === "dash") doc.setLineDashPattern([1.2, 1], 0);
        for (let i = 0; i < n - 1; i++) {
          const a = s.values[i];
          const c = s.values[i + 1];
          if (a == null || c == null) continue;
          doc.line(xs(i), ys(a), xs(i + 1), ys(c));
        }
        doc.setLineDashPattern([], 0);
      }
    }
    doc.setFontSize(6.5);
    doc.setTextColor(...MUTED);
    const step = Math.max(1, Math.ceil(n / 8));
    labels.forEach((l, i) => {
      if (i % step === 0 || i === n - 1) doc.text(t(l), xs(i), y1 + 3.5, { align: "center" });
    });
    y = y1 + 8;
  };

  // ── Cover ────────────────────────────────────────────────────────────
  doc.setFillColor(...GREEN_DARK);
  doc.rect(0, 0, W, 58, "F");
  doc.setFillColor(...GREEN);
  doc.rect(0, 58, W, 1.2, "F");
  doc.setTextColor(167, 243, 208);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("AGRI-SHIELD  |  CLIMATE DUE-DILIGENCE REPORT", M, 14);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.text(t(place), M, 28, { maxWidth: W - 2 * M - 40 });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(209, 250, 229);
  doc.text(t(`${[r.location.admin1, r.location.country].filter(Boolean).join(", ")}  ·  ${r.location.lat.toFixed(4)}, ${r.location.lon.toFixed(4)}  ·  elevation ${num(r.location.elevationM)} m`), M, 36);
  doc.text(t(`Asset: ${assetLabel(b.assetType)}${["farm", "field", "insured_plot", "loan"].includes(b.assetType) ? ` (${cropLabel(b.crop)})` : ""}  ·  Generated ${dateStr}`), M, 42);
  if (opts.preparedFor || opts.preparedBy) doc.text(t(`Prepared${opts.preparedFor ? ` for ${opts.preparedFor}` : ""}${opts.preparedBy ? ` by ${opts.preparedBy}` : ""}`), M, 48);
  // score badge
  const sc = r.composite.score;
  doc.setFillColor(...scoreRGB(sc));
  doc.roundedRect(W - M - 34, 14, 34, 30, 3, 3, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.text(String(sc), W - M - 17, 30, { align: "center" });
  doc.setFontSize(7.5);
  doc.text(`${r.composite.level.toUpperCase()} RISK / 100`, W - M - 17, 38, { align: "center" });
  y = 68;

  heading("Verdict", "Plain-language summary for decision makers");
  para(ins.headline, 11.5, INK);
  y += 1;
  bullets(ins.meaning);
  y += 2;
  table(
    ["Hazard", "Score (0-100)", "Key number", "Model / source"],
    [
      ["Flood", r.hazards.flood.score, `${pct(r.hazards.flood.p72)} chance within 72 h`, r.hazards.flood.model],
      ["Salinity", r.hazards.salinity.score, r.hazards.salinity.applicable ? `${r.hazards.salinity.ec30d.toFixed(1)} dS/m in 30 days` : "not applicable", r.hazards.salinity.model],
      ["Drought", r.hazards.drought.score, drought?.spi90 != null ? `SPI-90 ${drought.spi90.toFixed(2)} (${drought.category90})` : `${sgn(r.hazards.drought.waterBalance7dMm)} mm water balance (7 d)`, r.hazards.drought.model],
      ["Heat", r.hazards.heat.score, r.hazards.heat.heatIndexMaxC != null ? `heat index up to ${Math.round(r.hazards.heat.heatIndexMaxC)} C` : `max ${num(r.hazards.heat.maxTempC, 1)} C`, r.hazards.heat.model],
    ],
    { colWidths: [24, 26] }
  );
  heading("Recommended actions");
  table(["When", "Action", "Detail"], ins.actions.map((a) => [a.urgency.toUpperCase(), a.title, a.detail]), { colWidths: [22, 45] });

  // ── Forecast ─────────────────────────────────────────────────────────
  doc.addPage();
  y = M + 2;
  heading("Forecast", "Next 72 hours (hourly) and 15-day ensemble uncertainty");
  const hr = r.forecast.hourly;
  if (hr.length) {
    chart("Rain, next 72 hours (mm/h)", 32, [{ kind: "bar", values: hr.map((h) => h.precipMm), color: SKY }], hr.map((h) => new Date(h.time).toLocaleString("en-GB", { weekday: "short", hour: "2-digit" })), "mm/h");
    chart("Temperature, next 72 hours (C)", 30, [{ kind: "line", values: hr.map((h) => h.tempC), color: AMBER }], hr.map((h) => new Date(h.time).toLocaleString("en-GB", { weekday: "short", hour: "2-digit" })), "C");
  }
  const ens = x.ensemble;
  if (ens) {
    chart(
      `Daily rain, ${ens.days.length}-day ensemble: median and 10-90% range (${ens.members} runs)`,
      36,
      [
        { kind: "band", values: ens.days.map((d) => d.p10), upper: ens.days.map((d) => d.p90), color: SKY_SOFT },
        { kind: "line", values: ens.days.map((d) => d.p50), color: SKY },
      ],
      ens.days.map((d) => d.date.slice(5)),
      "mm/day"
    );
    table(["Window", "Dry case (p10)", "Likely (p50)", "Wet case (p90)"], [
      ["Next 3 days", `${num(ens.totals.days3.p10)} mm`, `${num(ens.totals.days3.p50)} mm`, `${num(ens.totals.days3.p90)} mm`],
      ["Next 7 days", `${num(ens.totals.days7.p10)} mm`, `${num(ens.totals.days7.p50)} mm`, `${num(ens.totals.days7.p90)} mm`],
      [`Next ${ens.days.length} days`, `${num(ens.totals.days14.p10)} mm`, `${num(ens.totals.days14.p50)} mm`, `${num(ens.totals.days14.p90)} mm`],
    ]);
  }

  // ── Flood & river ────────────────────────────────────────────────────
  heading("Flood & river", "Agri-SHIELD flood model and GloFAS v4 river discharge");
  table(["Horizon", "Flood probability", "Likely depth", "Confidence"], [
    ["24 h", pct(r.hazards.flood.p24), "", ""],
    ["48 h", pct(r.hazards.flood.p48), "", ""],
    ["72 h", pct(r.hazards.flood.p72), `${num(r.hazards.flood.depthM, 2)} m`, `${pct(r.hazards.flood.ci[0])}-${pct(r.hazards.flood.ci[1])}`],
  ]);
  if (x.forecastRarity) {
    const fr = x.forecastRarity;
    const worst = Math.max(fr.dailyReturnPeriodYears ?? 0, fr.threeDayReturnPeriodYears ?? 0);
    para(worst >= 2 ? `Forecast wettest day ${num(fr.maxDailyMm)} mm and wettest 3 days ${num(fr.max3dMm)} mm: about a 1-in-${Math.round(worst)}-year event for this site's own 40-year record.` : `Forecast rain (wettest day ${num(fr.maxDailyMm)} mm, 3 days ${num(fr.max3dMm)} mm) is not unusual for this site's 40-year record.`, 9, MUTED);
  }
  if (r.river && r.river.series.length) {
    const s = r.river.series;
    chart(
      "River discharge: last 30 days + 7-day forecast (line) vs normal range for each date (band)",
      36,
      [
        { kind: "band", values: s.map((d) => d.p10 ?? null), upper: s.map((d) => d.p90 ?? null), color: GRID },
        { kind: "dash", values: s.map((d) => d.p50 ?? null), color: MUTED },
        { kind: "line", values: s.map((d) => d.value), color: SKY },
      ],
      s.map((d) => d.date.slice(5)),
      "m3/s"
    );
    const rh = x.riverHistory;
    if (rh) {
      para(rh.summary, 9, INK);
      if (rh.returnLevels.length) table(["Return period", ...rh.returnLevels.map((l) => `1-in-${l.years} yr`)], [["Peak flow (m3/s)", ...rh.returnLevels.map((l) => num(l.dischargeM3s))]]);
    }
  }

  // ── Salinity, drought, heat ──────────────────────────────────────────
  heading("Salinity, drought & heat");
  const sal = r.hazards.salinity;
  table(
    ["Indicator", "Value", "Meaning"],
    [
      ["Salinity (EC) now / 7 d / 30 d", sal.applicable ? `${sal.ecNow.toFixed(1)} / ${sal.ec7d.toFixed(1)} / ${sal.ec30d.toFixed(1)} dS/m` : "n/a", sal.applicable ? `${sal.class}; ${pct(sal.cropDamageProb)} chance of ${cropLabel(b.crop).toLowerCase()} damage` : sal.reason ?? "not applicable"],
      ["SPI-30 / SPI-90", drought ? `${num(drought.spi30, 2)} / ${num(drought.spi90, 2)}` : "-", drought ? `${drought.category30} / ${drought.category90}; last 90 d ${drought.rain90Mm} mm vs normal ${drought.normal90Mm} mm` : "40-year reference not computed"],
      ["Water balance next 7 d", `${sgn(r.hazards.drought.waterBalance7dMm)} mm`, `rain ${num(r.hazards.drought.rain7dForecastMm)} mm vs evaporation ${num(r.hazards.drought.et0_7dMm)} mm`],
      ["Max heat index / wet-bulb", x.heatStress ? `${num(x.heatStress.heatIndexMaxC, 1)} / ${num(x.heatStress.wetBulbMaxC, 1)} C` : "-", x.heatStress ? `${x.heatStress.category}. ${x.heatStress.labourAdvice}` : ""],
    ],
    { colWidths: [48, 38] }
  );

  // ── Climate history ──────────────────────────────────────────────────
  if (hist) {
    doc.addPage();
    y = M + 2;
    heading(`Climate history ${hist.period[0]}-${hist.period[1]}`, hist.source);
    bullets(hist.headline, SKY);
    const years = hist.annual.map((a) => String(a.year));
    const fit = (tr: { slopePerDecade: number; intercept: number }) => hist.annual.map((a) => tr.intercept + (tr.slopePerDecade / 10) * a.year);
    chart("Annual rainfall (bars) and linear trend (dashed)", 34, [{ kind: "bar", values: hist.annual.map((a) => a.rainMm), color: SKY }, { kind: "dash", values: fit(hist.trends.rain), color: INK }], years, "mm");
    chart("Hottest day of each year and trend", 30, [{ kind: "line", values: hist.annual.map((a) => a.hottestDayC), color: ROSE }, { kind: "dash", values: fit(hist.trends.hottestDay), color: INK }], years, "C");
    table(["Return period", "Chance / year", "1-day rain", "3-day rain"], hist.returnPeriods.map((q) => [`1-in-${q.years} years`, `${Math.round(100 / q.years)}%`, `${q.dailyRainMm} mm`, `${q.threeDayRainMm} mm`]));
    const tr = hist.trends;
    table(["Trend per decade", "Value", "p (Mann-Kendall)", "Significant?"], [
      ["Annual rain (mm)", sgn(tr.rain.slopePerDecade), tr.rain.pValue.toFixed(3), tr.rain.significant ? "yes" : "no"],
      ["Wettest day (mm)", sgn(tr.maxDaily.slopePerDecade, 1), tr.maxDaily.pValue.toFixed(3), tr.maxDaily.significant ? "yes" : "no"],
      ["Wettest 3 days (mm)", sgn(tr.wettest3d.slopePerDecade, 1), tr.wettest3d.pValue.toFixed(3), tr.wettest3d.significant ? "yes" : "no"],
      ["Hottest day (C)", sgn(tr.hottestDay.slopePerDecade, 2), tr.hottestDay.pValue.toFixed(3), tr.hottestDay.significant ? "yes" : "no"],
      ["Days >= 35 C", sgn(tr.hotDays.slopePerDecade, 1), tr.hotDays.pValue.toFixed(3), tr.hotDays.significant ? "yes" : "no"],
    ]);
  }

  // ── Outlook ──────────────────────────────────────────────────────────
  if (seasonal || proj) {
    heading("Outlook", "Seasonal forecast and mid-century climate projection");
    if (seasonal) {
      para(`${seasonal.summary} (${seasonal.model})`, 9.5);
      table(["Month", "Rain", "vs normal", "Temperature", "vs normal"], seasonal.months.map((m) => [m.month, `${Math.round(m.precipMm)} mm`, m.precipAnomPct == null ? `${sgn(m.precipAnomMm)} mm` : `${sgn(m.precipAnomPct)}%`, `${m.tempC} C`, `${sgn(m.tempAnomC, 1)} C`]));
    }
    if (proj) {
      para(`${proj.scenario}; ${proj.future} vs ${proj.baseline}.`, 9, MUTED);
      const e = proj.ensemble;
      table(["Change by ~2050", "Model mean", "Model range"], [
        ["Annual rain", `${sgn(e.annualRainPct.mean)}%`, `${sgn(e.annualRainPct.min)} to ${sgn(e.annualRainPct.max)}%`],
        ["Wettest day of the year", `${sgn(e.rx1dayPct.mean)}%`, `${sgn(e.rx1dayPct.min)} to ${sgn(e.rx1dayPct.max)}%`],
        ["Days >= 50 mm / yr", sgn(e.heavyRainDays.mean, 1), `${sgn(e.heavyRainDays.min, 1)} to ${sgn(e.heavyRainDays.max, 1)}`],
        ["Days >= 35 C / yr", sgn(e.hotDays.mean), `${sgn(e.hotDays.min)} to ${sgn(e.hotDays.max)}`],
        ["Average daily max temperature", `${sgn(e.tmaxC.mean, 1)} C`, `${sgn(e.tmaxC.min, 1)} to ${sgn(e.tmaxC.max, 1)} C`],
      ]);
      para(proj.caveat, 8, MUTED);
    }
  }

  // ── Soil & terrain ───────────────────────────────────────────────────
  if (x.soil || x.terrain) {
    heading("Soil & terrain");
    const rows: string[][] = [];
    if (x.soil) rows.push(["Soil texture (0-30 cm)", x.soil.texture ?? "-", `clay ${num(x.soil.clayPct)}% · sand ${num(x.soil.sandPct)}% · silt ${num(x.soil.siltPct)}%`], ["pH / organic carbon", `${num(x.soil.ph, 1)} / ${num(x.soil.socGkg, 1)} g/kg`, x.soil.notes.join(" ")]);
    if (x.terrain) rows.push(["Elevation / relief / slope", `${num(x.terrain.elevationM)} m / ${num(x.terrain.reliefM)} m / ${num(x.terrain.slopePct, 1)}%`, `${x.terrain.position}. ${x.terrain.notes.join(" ")}`]);
    table(["Indicator", "Value", "Notes"], rows, { colWidths: [42, 42] });
  }

  // ── Methodology & sources ────────────────────────────────────────────
  heading("Methodology & data sources");
  bullets(
    [
      "Composite score: the dominant hazard sets the score; secondary hazards add a compounding bonus (flood, salinity x0.9, drought x0.85, heat x0.7).",
      "Flood: Agri-SHIELD ensemble model on forecast rain (24/48/72 h), soil saturation, GloFAS river discharge vs its 30-day mean, terrain exposure (elevation, depression, coast).",
      "Salinity: gradient-boosted model of EC driven by season, 30-day rainfall dilution, tidal proxy and exposure; only applied on low-lying land within ~60 km of the coast.",
      "Ensemble: ECMWF IFS 0.25 deg 51-member forecast; totals are summed per member then ranked (p10/p50/p90).",
      "Climate history: ERA5 daily reanalysis; linear trends with Mann-Kendall significance; return levels from a method-of-moments Gumbel (EV-I) fit to annual maxima.",
      "SPI: gamma distribution (Thom MLE) fitted to the 30/90-day totals ending on the same date in each reference year, transformed to a standard normal (McKee et al. 1993).",
      "Heat: NOAA Rothfusz heat index; Stull (2011) wet-bulb temperature from hourly temperature and humidity.",
      "Projection: CMIP6 HighResMIP (highresSST-future, SSP5-8.5 forcing), multi-model change computed within each model to remove bias.",
    ],
    MUTED
  );
  table(
    ["Source", "Status", "Note"],
    r.sources.map((s) => [s.name, s.ok ? "OK" : "unavailable", s.note ?? ""]),
    { colWidths: [70, 22] }
  );
  para("This report is decision support, not a guarantee. Forecasts are probabilistic; verify critical decisions with local authorities. Data: Open-Meteo (CC BY 4.0), ECMWF, Copernicus (ERA5, GloFAS, DEM), NASA, ISRIC SoilGrids (CC BY 4.0), OpenStreetMap (ODbL), GDACS.", 8, MUTED);
  if (opts.shareUrl) para(`Live version: ${opts.shareUrl}`, 8.5, GREEN);

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...GRID);
    doc.setLineWidth(0.2);
    doc.line(M, H - 12, W - M, H - 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(t(`Agri-SHIELD · ${place} · ${r.location.lat.toFixed(3)}, ${r.location.lon.toFixed(3)}`), M, H - 7);
    doc.text(`Page ${i} of ${pages}`, W - M, H - 7, { align: "right" });
  }
  const safe = t(place).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "location";
  doc.save(`Agri-SHIELD-due-diligence-${safe}-${new Date().toISOString().slice(0, 10)}.pdf`);
}
