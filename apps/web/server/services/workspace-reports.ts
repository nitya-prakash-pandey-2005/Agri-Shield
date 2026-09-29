/**
 * Report builders for the Reports hub. Each builder turns real workspace data
 * (assets + live scores, alert rules, notifications, official alerts, hazard
 * feeds, location engine) into a structured ReportSnapshot. The client renders
 * snapshots to PDF with jsPDF, so a download from history is byte-for-byte the
 * same content that was generated at the time.
 */
import { TRPCError } from "@trpc/server";
import type { CropType } from "@agri-shield/types";
import { getStore, type OrgRecord } from "../data/store";
import { assessLocation } from "./location-risk";
import { buildBriefing, computeMetrics, fmtUsd, hazardsNear, industryOf, INDUSTRY_LABEL, portfolioScores } from "./workspace-home";
import { usageSummary } from "./usage";
import { wsState, type ReportSection, type ReportSnapshot, type ReportType } from "./workspace-state";

export const REPORT_CATALOGUE: { type: ReportType; title: string; description: string; audience: string; pages: string; needsLocation?: boolean }[] = [
  { type: "portfolio_summary", title: "Portfolio risk summary", description: "Every monitored asset scored for flood, salinity, drought and heat, with the top risks and where they cluster.", audience: "Risk & portfolio teams", pages: "3–5 pages" },
  { type: "location_dd", title: "Location due-diligence", description: "A full hazard report for one site — forecast, river flow, salinity, drought, heat and nearby disasters — for underwriting or lending.", audience: "Underwriters, credit officers", pages: "2–3 pages", needsLocation: true },
  { type: "physical_risk", title: "Physical-risk disclosure", description: "TCFD / ISSB S2-structured disclosure of physical climate risk across the portfolio: governance, strategy, risk management, metrics.", audience: "Regulators, investors", pages: "4–6 pages" },
  { type: "weekly_digest", title: "Weekly digest", description: "What changed in the last 7 days: rules fired, biggest movers, official alerts and live hazards near your assets.", audience: "Whole team", pages: "2–3 pages" },
  { type: "board_pack", title: "Board pack", description: "One-glance executive summary: headline KPIs, 30-day trend, top 10 risks and recommended actions.", audience: "Board, executives, donors", pages: "3–4 pages" },
];

const DAY = 86_400_000;
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 1000) / 10}%` : "0%");
const TITLE = Object.fromEntries(REPORT_CATALOGUE.map((r) => [r.type, r.title])) as Record<ReportType, string>;

async function portfolioContext(org: OrgRecord) {
  const s = getStore();
  const assets = s.assets.filter((a) => a.workspaceId === org.id && a.status === "active");
  const scores = await portfolioScores(org.id);
  const m = computeMetrics(org, assets, scores);
  const near = assets.length ? await hazardsNear(assets) : [];
  const brief = buildBriefing(m, near.length);
  const sources = [
    "Open-Meteo forecast (ECMWF/GFS/ICON blend) — 72 h rain, soil moisture, temperature",
    "Copernicus GloFAS v4 river discharge via Open-Meteo Flood API",
    "Agri-SHIELD composite scoring (flood · salinity · drought · heat, 0–100)",
    ...(near.length ? ["GDACS (UN OCHA / EC JRC) and NASA EONET live hazard feeds"] : []),
  ];
  const mix = Object.entries(m.sourceMix).map(([k, v]) => `${v} × ${k}`).join(", ");
  return { assets, scores, m, near, brief, sources, mix };
}

function riskTable(m: ReturnType<typeof computeMetrics>): ReportSection["table"] {
  return {
    columns: ["#", "Asset", "Ref", "District", "Composite", "Flood", "Salinity", "Value (USD)", "Main driver"],
    rows: m.top.map((t, i) => [i + 1, t.name, t.ref ?? "—", t.district ?? "—", t.composite, t.flood, t.salinity, Math.round(t.valueUsd), t.driver]),
  };
}

function levelTable(m: ReturnType<typeof computeMetrics>, assets: { id: string; valueUsd: number }[], scores: Map<string, { level: string }>): ReportSection["table"] {
  const levels = ["critical", "high", "medium", "low"] as const;
  return {
    columns: ["Risk level", "Score band", `${m.noun.many}`, "Share", "Exposure (USD)"],
    rows: levels.map((l) => {
      const inL = assets.filter((a) => scores.get(a.id)?.level === l);
      return [l.toUpperCase(), { critical: "80–100", high: "60–79", medium: "35–59", low: "0–34" }[l], inL.length, pct(inL.length, m.total), Math.round(inL.reduce((n, a) => n + a.valueUsd, 0))];
    }),
  };
}

export async function buildReport(type: ReportType, org: OrgRecord, by: { id: string; name: string }, params: { lat?: number; lon?: number; name?: string; crop?: CropType; assetId?: string } = {}): Promise<ReportSnapshot> {
  const now = new Date();
  const s = getStore();
  const base = { type, title: TITLE[type], orgName: org.name, generatedAt: now.toISOString(), generatedBy: by.name };
  const industry = industryOf(org);

  if (type === "location_dd") {
    let lat = params.lat, lon = params.lon, name = params.name ?? null, crop = params.crop;
    if (params.assetId) {
      const a = s.assets.find((x) => x.id === params.assetId && x.workspaceId === org.id);
      if (!a) throw new TRPCError({ code: "NOT_FOUND", message: "Asset not found in this workspace" });
      lat = a.lat;
      lon = a.lon;
      name = a.name;
      crop = a.crop ?? undefined;
    }
    if (lat === undefined || lon === undefined) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick an asset or enter a latitude/longitude" });
    const r = await assessLocation(lat, lon, { crop, name });
    const hz = r.hazards;
    const sections: ReportSection[] = [
      {
        heading: "Site overview",
        kpis: [
          { label: "Coordinates", value: `${lat.toFixed(4)}, ${lon.toFixed(4)}` },
          { label: "Elevation", value: r.location.elevationM === null ? "n/a" : `${Math.round(r.location.elevationM)} m` },
          { label: "Composite risk", value: `${Math.round(r.composite.score)}/100 (${r.composite.level})` },
          { label: "Nearest monitored district", value: r.location.nearestDistrictId ? `${s.districts.find((d) => d.id === r.location.nearestDistrictId)?.name ?? r.location.nearestDistrictId} · ${r.location.nearestDistrictKm ?? "?"} km` : "Outside core coverage" },
        ],
        paragraphs: [r.composite.summary, ...(r.composite.drivers.length ? [`Main drivers: ${r.composite.drivers.join("; ")}.`] : [])],
      },
      {
        heading: "Hazard assessment",
        table: {
          columns: ["Hazard", "Score /100", "Key numbers", "Model"],
          rows: [
            ["Flood", Math.round(hz.flood.score), `P(24h) ${Math.round(hz.flood.p24 * 100)}% · P(72h) ${Math.round(hz.flood.p72 * 100)}% · depth ~${hz.flood.depthM.toFixed(2)} m`, hz.flood.model],
            ["Salinity", Math.round(hz.salinity.score), hz.salinity.applicable ? `EC now ${hz.salinity.ecNow.toFixed(1)} dS/m · 7d ${hz.salinity.ec7d.toFixed(1)} · 30d ${hz.salinity.ec30d.toFixed(1)} (${hz.salinity.class})` : "Not a coastal/delta site", hz.salinity.model],
            ["Drought", Math.round(hz.drought.score), `7-day rain ${Math.round(hz.drought.rain7dForecastMm)} mm vs ET0 ${Math.round(hz.drought.et0_7dMm)} mm (balance ${Math.round(hz.drought.waterBalance7dMm)} mm)`, hz.drought.model],
            ["Heat", Math.round(hz.heat.score), `Max ${hz.heat.maxTempC ?? "n/a"} °C · ${hz.heat.hotDays} hot day(s)`, hz.heat.model],
          ],
        },
        paragraphs: ["Scores run 0–100: below 35 low, 35–59 medium, 60–79 high, 80+ critical. EC (electrical conductivity, dS/m) measures salt: rice loses yield above ~3 dS/m."],
      },
      {
        heading: "7-day forecast",
        table: { columns: ["Date", "Rain (mm)", "Rain chance", "Max °C", "Min °C"], rows: r.forecast.daily.slice(0, 7).map((d) => [d.date, Math.round(d.precipMm * 10) / 10, `${Math.round(d.precipProb)}%`, d.tMax ?? "—", d.tMin ?? "—"]) },
      },
      ...(r.river
        ? [{ heading: "River discharge (GloFAS)", paragraphs: [`Forecast discharge ${r.river.dischargeM3s ?? "n/a"} m³/s vs 30-day mean ${r.river.meanM3s ?? "n/a"} m³/s${r.river.ratio ? ` — ratio ${r.river.ratio.toFixed(2)} (above 1.5 is an early flood signal)` : ""}.`] }]
        : []),
      {
        heading: "Disasters nearby",
        paragraphs: r.hazardsNearby.length ? [] : ["No GDACS or NASA EONET events currently reported near this site."],
        ...(r.hazardsNearby.length ? { table: { columns: ["Event", "Source", "Distance (km)", "Date"], rows: r.hazardsNearby.slice(0, 8).map((h) => [h.title, h.source, Math.round(h.distanceKm), h.date.slice(0, 10)]) } } : {}),
      },
    ];
    return {
      ...base,
      subtitle: name ?? `${lat.toFixed(3)}, ${lon.toFixed(3)}`,
      summary: `${name ?? "This site"} scores ${Math.round(r.composite.score)}/100 (${r.composite.level}) on the composite climate-risk index today.`,
      sections,
      sources: r.sources.map((x) => `${x.name}${x.ok ? "" : " (unavailable — fallback used)"} — ${x.url}`),
    };
  }

  const ctx = await portfolioContext(org);
  const { m, assets, scores, near, brief } = ctx;
  if (!assets.length) {
    return { ...base, subtitle: INDUSTRY_LABEL[industry], summary: "This workspace has no monitored assets yet.", sections: [{ heading: "No assets yet", paragraphs: ["Add assets in Portfolio (upload a CSV or drop pins on the map) and generate this report again."] }], sources: ctx.sources };
  }
  const kpis = [
    { label: `${m.noun.many}`, value: m.total.toLocaleString("en-US") },
    { label: `Total ${m.noun.value}`, value: fmtUsd(m.exposureUsd) },
    { label: `At risk (≥ ${m.threshold})`, value: `${m.atRisk} · ${m.atRiskPct}%` },
    { label: "Exposure at risk", value: fmtUsd(m.atRiskExposureUsd) },
    { label: "Average composite", value: `${m.avgComposite}/100` },
    { label: "Active official alerts", value: String(m.activeAlerts) },
  ];
  const districtTable = { columns: ["District", "Country", `${m.noun.many}`, "At risk", "Avg score", "Exposure (USD)"], rows: m.byDistrict.slice(0, 15).map((d) => [d.district, d.country, d.assets, d.atRisk, d.avgComposite, Math.round(d.exposureUsd)]) };
  const methodology = `Scores combine forecast rainfall, soil moisture, river discharge, elevation, sea level and historical exposure into four hazard scores and one composite (0–100). Assets are re-scored at least every 6 hours; this report used: ${ctx.mix}.`;

  if (type === "portfolio_summary") {
    return {
      ...base,
      subtitle: `${INDUSTRY_LABEL[industry]} · ${m.total} ${m.noun.many}`,
      summary: brief.headline,
      sections: [
        { heading: "Today's briefing", paragraphs: [brief.headline], bullets: brief.lines.map((l) => l.text) },
        { heading: "Headline numbers", kpis },
        { heading: "Risk distribution", table: levelTable(m, assets, scores) },
        { heading: "Hazard breakdown", table: { columns: ["Hazard", `${m.noun.many} at high risk (≥ 60)`, "Share"], rows: [["Flood (72 h)", m.highFlood, pct(m.highFlood, m.total)], ["Salinity", m.highSalinity, pct(m.highSalinity, m.total)], ["Drought", m.highDrought, pct(m.highDrought, m.total)], ["Heat", m.highHeat, pct(m.highHeat, m.total)]] } },
        { heading: "Where risk clusters", table: districtTable },
        { heading: "Top 10 assets by risk", table: riskTable(m) },
        { heading: "Methodology", paragraphs: [methodology] },
      ],
      sources: ctx.sources,
    };
  }

  if (type === "physical_risk") {
    const members = s.users.filter((u) => u.orgId === org.id);
    const rules = s.alertRules.filter((r) => r.workspaceId === org.id);
    const hazardRows = (["flood", "salinity", "drought", "heat"] as const).map((h) => {
      const hi = assets.filter((a) => (scores.get(a.id)?.[h] ?? 0) >= 60);
      const exp = hi.reduce((n, a) => n + a.valueUsd, 0);
      return [h[0]!.toUpperCase() + h.slice(1), hi.length, pct(hi.length, m.total), Math.round(exp), pct(exp, m.exposureUsd)];
    });
    return {
      ...base,
      subtitle: "Physical climate risk — structured to TCFD / ISSB S2",
      summary: `${m.atRiskPct}% of ${m.noun.many} (${fmtUsd(m.atRiskExposureUsd)} of ${fmtUsd(m.exposureUsd)}) are exposed to high or critical acute physical risk at the reporting date.`,
      sections: [
        {
          heading: "1. Governance",
          paragraphs: [
            `Climate-risk monitoring for ${org.name} runs in the Agri-SHIELD workspace with ${members.length} named user(s), of whom ${members.filter((u) => /admin/.test(u.role)).length} hold admin rights. All configuration changes are recorded in the workspace audit log.`,
            `${rules.filter((r) => r.enabled).length} automated alert rule(s) escalate threshold breaches to named recipients (${[...new Set(rules.flatMap((r) => r.channels))].join(", ") || "none configured"}).`,
          ],
        },
        {
          heading: "2. Strategy — exposure by hazard",
          paragraphs: ["Acute physical hazards assessed: riverine/pluvial flood (72-hour probability), saltwater intrusion, agricultural drought and extreme heat. High = hazard score ≥ 60/100."],
          table: { columns: ["Hazard", `${m.noun.many} high`, "Share of count", "Exposure (USD)", "Share of exposure"], rows: hazardRows },
        },
        {
          heading: "3. Risk management",
          paragraphs: [
            `Assets are screened against a workspace risk threshold of ${m.threshold}/100. Scores refresh at least every 6 hours from live forecasts; official alerts (GDACS, national agencies) and satellite events (NASA EONET) are overlaid.`,
            "Forward-looking chronic risk (CMIP6 projections under SSP scenarios) is available per location in Risk Explorer; this disclosure reports current acute risk and the 30-day observed trend.",
          ],
          bullets: rules.slice(0, 8).map((r) => `${r.name} — ${r.conditions.map((c) => `${c.metric} ${c.op} ${c.value}`).join(r.match === "all" ? " AND " : " OR ")} (${r.severity})`),
        },
        {
          heading: "4. Metrics",
          kpis,
          table: levelTable(m, assets, scores),
        },
        { heading: "Concentration by district", table: districtTable },
        { heading: "Methodology & limitations", paragraphs: [methodology, "Scores are probabilistic model outputs, not guarantees. Exposure values are as recorded in the workspace (sum insured, outstanding balance, stock or replacement value)."] },
      ],
      sources: ctx.sources,
    };
  }

  if (type === "weekly_digest") {
    const since = now.getTime() - 7 * DAY;
    const notes = s.notifications.filter((n) => n.workspaceId === org.id && n.createdAt.getTime() >= since);
    const fired = s.alertRules.filter((r) => r.workspaceId === org.id && r.lastTriggeredAt && r.lastTriggeredAt.getTime() >= since);
    const districtIds = new Set(assets.map((a) => a.districtId));
    const official = s.alerts.filter((a) => districtIds.has(a.districtId) && a.createdAt.getTime() >= since);
    const movers = assets
      .map((a) => {
        const h = a.history;
        const then = h[h.length - 8]?.composite;
        const nowS = scores.get(a.id)?.composite ?? h[h.length - 1]?.composite ?? 0;
        return { a, delta: then === undefined ? 0 : Math.round(nowS - then), nowS: Math.round(nowS) };
      })
      .sort((x, y) => y.delta - x.delta)
      .slice(0, 8);
    return {
      ...base,
      subtitle: `${new Date(since).toISOString().slice(0, 10)} → ${now.toISOString().slice(0, 10)}`,
      summary: brief.headline,
      sections: [
        { heading: "This week in one minute", paragraphs: [brief.headline], bullets: brief.lines.map((l) => l.text) },
        { heading: "Numbers", kpis: [...kpis.slice(0, 4), { label: "Rules fired (7 d)", value: String(fired.length) }, { label: "Notifications (7 d)", value: String(notes.length) }] },
        { heading: "Biggest risk increases", table: { columns: ["Asset", "Score now", "Change vs 7 d ago"], rows: movers.map((x) => [x.a.name, x.nowS, `${x.delta > 0 ? "+" : ""}${x.delta}`]) } },
        { heading: "Alert rules that fired", paragraphs: fired.length ? [] : ["No rules fired this week."], ...(fired.length ? { table: { columns: ["Rule", "Severity", "Last fired", "Total fires"], rows: fired.map((r) => [r.name, r.severity, r.lastTriggeredAt!.toISOString().slice(0, 16).replace("T", " "), r.triggerCount]) } } : {}) },
        { heading: "Official alerts in your districts", paragraphs: official.length ? [] : ["No new official alerts in districts where you have assets."], ...(official.length ? { table: { columns: ["Alert", "Type", "Severity", "Issued"], rows: official.slice(0, 12).map((a) => [a.title, a.alertType, a.severity, a.createdAt.toISOString().slice(0, 10)]) } } : {}) },
        { heading: "Live disasters near your assets", paragraphs: near.length ? [] : ["No GDACS / NASA EONET events within 300 km."], ...(near.length ? { table: { columns: ["Event", "Source", "Nearest asset (km)", `${m.noun.many} within 300 km`], rows: near.map((e) => [e.title, e.source, e.distanceKm, e.assetsWithin]) } } : {}) },
      ],
      sources: ctx.sources,
    };
  }

  // board_pack
  const weeks = [28, 21, 14, 7, 0].map((dAgo) => {
    // Today uses the live scores; earlier points use each asset's stored daily history
    const vals = assets.map((a) => (dAgo === 0 ? scores.get(a.id)?.composite : a.history[a.history.length - 1 - dAgo]?.composite)).filter((v): v is number => typeof v === "number");
    const avg = vals.length ? vals.reduce((n, v) => n + v, 0) / vals.length : 0;
    const above = vals.filter((v) => v >= m.threshold).length;
    return [new Date(now.getTime() - dAgo * DAY).toISOString().slice(0, 10), Math.round(avg * 10) / 10, above, pct(above, vals.length)];
  });
  const usage = usageSummary(org.id);
  const actions: string[] = [];
  if (m.highFlood) actions.push(`Contact the ${m.highFlood} ${m.noun.many} with high 72-hour flood risk${m.topFloodDistrict ? ` (concentrated in ${m.topFloodDistrict})` : ""}; confirm early-harvest / evacuation plans.`);
  if (m.highSalinity) actions.push(`Issue salinity advisories to ${m.highSalinity} ${m.noun.many}: delay irrigation from tidal rivers, switch to salt-tolerant varieties.`);
  if (m.nearTrigger) actions.push(`Reserve for ${m.nearTrigger} parametric polic${m.nearTrigger === 1 ? "y" : "ies"} forecast near the payout trigger.`);
  if (m.atRiskPct > 20) actions.push(`Review concentration: ${m.atRiskPct}% of the book is above threshold — consider reinsurance, provisioning or diversification.`);
  if (!s.alertRules.some((r) => r.workspaceId === org.id)) actions.push("Set up at least one automated alert rule so the team is told when risk rises.");
  if (!actions.length) actions.push("No urgent action — keep monitoring; next board pack will flag changes.");
  return {
    ...base,
    subtitle: `${INDUSTRY_LABEL[industry]} · executive summary`,
    summary: brief.headline,
    sections: [
      { heading: "Executive summary", paragraphs: [brief.headline, ...brief.lines.slice(0, 3).map((l) => l.text)] },
      { heading: "Headline KPIs", kpis },
      { heading: "30-day trend", table: { columns: ["Date", "Average score", `${m.noun.many} ≥ ${m.threshold}`, "Share"], rows: weeks } },
      { heading: "Top 10 risks", table: riskTable(m) },
      { heading: "Recommended actions", bullets: actions },
      { heading: "Operations", kpis: [{ label: "Plan", value: usage.planLabel }, ...usage.meters.filter((x) => ["assessments", "reports", "seats"].includes(x.kind)).map((x) => ({ label: x.label, value: `${x.used.toLocaleString("en-US")}${x.limit === null ? "" : ` / ${x.limit.toLocaleString("en-US")}`}` })), { label: "Reports generated (all time)", value: String(wsState().reports.filter((r) => r.orgId === org.id).length) }] },
      { heading: "Methodology", paragraphs: [methodology] },
    ],
    sources: ctx.sources,
  };
}

export function estimatePages(snap: ReportSnapshot): number {
  const rows = snap.sections.reduce((n, s) => n + (s.table?.rows.length ?? 0) + (s.paragraphs?.length ?? 0) * 2 + (s.bullets?.length ?? 0) + (s.kpis ? 3 : 0) + 3, 0);
  return Math.max(1, Math.ceil(rows / 38) + 1);
}
