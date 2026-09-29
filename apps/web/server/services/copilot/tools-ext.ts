/**
 * Copilot tools for the Wave-3 modules: Earth Twin briefing, yield outlook,
 * incidents and IoT sensors. Same contract as tools.ts — every number in the
 * markdown comes from `data`, which comes from the module's own service.
 */
import type { CopilotContext, ToolOutput } from "./types";

const num = (n: number) => Math.round(n).toLocaleString("en-US");
const usd = (n: number) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${Math.round(n)}`);
const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;

// ─── "What should I look at right now?" ───────────────────────────────────

export async function twinBriefingTool(ctx: CopilotContext): Promise<ToolOutput> {
  const { twinBriefing } = await import("../twin");
  const b = await twinBriefing(ctx.orgId, 5);
  const lines = [`**Situation for ${ctx.orgName}:** ${b.summary}`];
  if (b.hotspots.length) {
    lines.push("", "**Where to look first:**");
    b.hotspots.forEach((h, i) => lines.push(`${i + 1}. ${h.caption}`));
  } else {
    lines.push("", "No hotspots stand out right now — nothing in your portfolio is above your risk threshold.");
  }
  return {
    data: { summary: b.summary, hotspots: b.hotspots },
    markdown: lines.join("\n"),
    artifacts: [],
    actions: [
      { label: "Open Earth Twin", href: "/app/twin", kind: "module" },
      { label: "Wall mode for the ops room", href: "/app/twin?mode=wall", kind: "module" },
      ...b.hotspots.slice(0, 2).map((h) => ({ label: h.caption.length > 42 ? `${h.caption.slice(0, 40)}…` : h.caption, href: h.href, kind: "module" as const })),
    ],
    sources: ["Agri-SHIELD portfolio scores", "GDACS / NASA EONET", "IBTrACS cyclone tracks"],
    followUps: ["Which assets are highest risk this week?", "Any open incidents?", "What's our expected harvest?"],
  };
}

// ─── Yield outlook ────────────────────────────────────────────────────────

export async function yieldOutlookTool(ctx: CopilotContext): Promise<ToolOutput> {
  const { yieldBook } = await import("../yield-model");
  const b = await yieldBook(ctx.orgId, { budgetMs: 8000 });
  if (!b.assets.length) {
    return { data: { assets: 0 }, markdown: `${ctx.orgName} has no crop assets to forecast yet — add farms, insured units or crop loans in Portfolio.`, artifacts: [], actions: [{ label: "Open Portfolio", href: "/app/portfolio", kind: "portfolio" }], sources: [], notFound: "no crop assets" };
  }
  const t = b.totals;
  const topDrivers = [...b.drivers].sort((a, c) => Math.abs(c.pct) - Math.abs(a.pct)).slice(0, 3);
  const lines = [
    `**Expected production this season:** ${num(t.productionT.p50)} t (likely range ${num(t.productionT.p10)}–${num(t.productionT.p90)} t) across ${num(t.assets)} crop assets on ${num(t.areaHa)} ha.`,
    `That is **${pct(t.vsNormalPct)}** versus the 5-year normal (${num(t.normalProductionT)} t), worth about ${usd(t.valueUsd)}. ${num(t.belowNormalAssets)} assets are tracking below normal.`,
  ];
  if (topDrivers.length) lines.push("", "**Main drivers:** " + topDrivers.map((d) => `${d.label} ${pct(d.pct)}`).join(" · "));
  const ins = b.outlook.insurer;
  if (ins) lines.push("", `**Insurance outlook:** expected payout ${usd(ins.expectedPayoutUsd)} on ${usd(ins.premiumUsd)} premium${ins.expectedLossRatioPct != null ? ` (loss ratio ${ins.expectedLossRatioPct.toFixed(0)}%)` : ""}; ${ins.unitsLikelyToPay} units likely to pay.`);
  const bank = b.outlook.bank;
  if (bank) lines.push("", `**Repayment outlook:** ${bank.stress} of ${bank.loans} loans show crop revenue below debt service (${usd(bank.outstandingStressUsd)} outstanding); median revenue cover ${bank.medianCoverP50.toFixed(2)}×.`);
  lines.push("", "_Forecast combines FAOSTAT baselines, a daily FAO water balance on real ERA5 weather, heat at flowering, real flood episodes, salinity and NDVI._");
  return {
    data: { totals: t, drivers: topDrivers, insurer: ins, bank },
    markdown: lines.join("\n"),
    artifacts: [
      { kind: "kpis", items: [
        { label: "P50 production", value: `${num(t.productionT.p50)} t`, sub: `${num(t.productionT.p10)}–${num(t.productionT.p90)} t` },
        { label: "vs 5-yr normal", value: pct(t.vsNormalPct), tone: t.vsNormalPct < -5 ? "warn" : t.vsNormalPct < 0 ? "neutral" : "good" },
        { label: "Crop value", value: usd(t.valueUsd) },
        { label: "Below normal", value: num(t.belowNormalAssets), sub: `of ${num(t.assets)} assets` },
      ] },
      ...(b.byCrop.length ? [{ kind: "table" as const, title: "By crop", columns: [{ key: "crop", label: "Crop" }, { key: "p50", label: "P50 t", align: "right" as const, format: "number" as const }, { key: "vs", label: "vs normal %", align: "right" as const, format: "number" as const }], rows: b.byCrop.slice(0, 8).map((c) => ({ crop: c.label || c.key, p50: Math.round(c.productionT.p50), vs: Math.round(c.vsNormalPct * 10) / 10 })) }] : []),
    ],
    actions: [{ label: "Open Yield Forecast", href: "/app/yield", kind: "module" }, { label: "Sustainability & carbon", href: "/app/sustainability", kind: "module" }],
    sources: ["FAOSTAT", "ERA5 (Open-Meteo archive)", "GloFAS flood record", "MODIS NDVI"],
    followUps: ["Which assets are below normal?", "How much would 50% AWD adoption earn in carbon credits?", "What does P10/P90 mean?"],
  };
}

// ─── Incidents ────────────────────────────────────────────────────────────

export async function incidentsTool(ctx: CopilotContext): Promise<ToolOutput> {
  const { listIncidents } = await import("../incidents");
  const { rows, summary } = listIncidents(ctx.orgId, { includeResolved: false });
  const open = rows.filter((r) => r.status !== "resolved");
  if (!open.length) {
    return { data: { active: 0 }, markdown: `No open incidents in ${ctx.orgName}. You can open one from any alert, rule firing or simulation.`, artifacts: [], actions: [{ label: "Open Incidents", href: "/app/incidents", kind: "module" }], sources: ["Agri-SHIELD incidents"] };
  }
  const lines = [
    `**${open.length} open incident${open.length === 1 ? "" : "s"}** (${summary.sev12} at SEV1–2${summary.breached ? `, ${summary.breached} past an SLA target` : ""}), covering ${usd(summary.exposureUsd)} of exposure.`,
    "",
    ...open.slice(0, 6).map((r) => `- **INC-${r.number} · ${r.severity} · ${r.status}** — ${r.title} (${r.assets} assets, ${r.tasksDone}/${r.tasksTotal} tasks done${r.overdueTasks ? `, ${r.overdueTasks} overdue` : ""})`),
  ];
  return {
    data: { summary, open: open.slice(0, 10).map((r) => ({ number: r.number, title: r.title, severity: r.severity, status: r.status, assets: r.assets, exposureUsd: r.exposureUsd })) },
    markdown: lines.join("\n"),
    artifacts: [
      { kind: "kpis", items: [
        { label: "Open incidents", value: `${open.length}`, tone: summary.sev12 ? "bad" : "warn" },
        { label: "SEV1–2", value: `${summary.sev12}`, tone: summary.sev12 ? "critical" : "good" },
        { label: "SLA breached", value: `${summary.breached}`, tone: summary.breached ? "bad" : "good" },
        { label: "Exposure", value: usd(summary.exposureUsd) },
      ] },
      { kind: "table", title: "Open incidents", hrefKey: "href", columns: [{ key: "id", label: "ID" }, { key: "title", label: "Incident" }, { key: "sev", label: "Severity" }, { key: "status", label: "Status" }, { key: "assets", label: "Assets", align: "right", format: "number" }], rows: open.slice(0, 10).map((r) => ({ id: `INC-${r.number}`, title: r.title, sev: r.severity, status: r.status, assets: r.assets, href: `/app/incidents/${r.id}` })) },
    ],
    actions: [{ label: "Open Incidents board", href: "/app/incidents", kind: "module" }, ...open.slice(0, 2).map((r) => ({ label: `War room INC-${r.number}`, href: `/app/incidents/${r.id}`, kind: "module" as const }))],
    sources: ["Agri-SHIELD incidents"],
    followUps: ["What should I look at right now?", "Any cyclones near our assets?"],
  };
}

// ─── Sensors & IoT ────────────────────────────────────────────────────────

export async function sensorsTool(ctx: CopilotContext): Promise<ToolOutput> {
  const [{ ensureIot }, store, analytics] = await Promise.all([import("../iot-service"), import("../iot-store"), import("../iot-analytics")]);
  ensureIot();
  const devices = store.orgDevices(ctx.orgId);
  if (!devices.length) {
    return { data: { devices: 0 }, markdown: `${ctx.orgName} has no sensors connected yet. Connect a water-level gauge or soil probe in Sensors & IoT — or start the built-in virtual device to see live ingestion.`, artifacts: [], actions: [{ label: "Open Sensors & IoT", href: "/app/sensors", kind: "module" }], sources: [] };
  }
  const now = Date.now();
  const since = now - 24 * 3_600_000;
  const rows = devices.map((d) => {
    const status = store.statusOf(d, now);
    const health = analytics.deviceHealth(d, now);
    const anomalies = store.deviceAnomalies(d.id, since);
    const events = anomalies.filter((a) => a.cls !== "sensor_fault");
    const faults = anomalies.filter((a) => a.cls === "sensor_fault");
    return { d, status, health, events, faults };
  });
  const offline = rows.filter((r) => r.status === "offline" || r.status === "stale");
  const lowBattery = rows.filter((r) => r.health.daysToEmpty != null && r.health.daysToEmpty < 21);
  const faulty = rows.filter((r) => r.faults.length);
  const criticalEvents = rows.flatMap((r) => r.events.filter((a) => a.severity === "critical").map((a) => ({ device: r.d.name, title: a.title })));
  const needVisit = [...new Set([...offline, ...lowBattery, ...faulty].map((r) => r.d))];
  const lines = [
    `**${devices.length} sensors** · ${devices.length - offline.length} reporting · ${offline.length} offline/stale · ${faulty.length} with a sensor fault · ${lowBattery.length} low battery.`,
  ];
  if (criticalEvents.length) lines.push("", "**Real events detected by sensors (last 24 h):**", ...criticalEvents.slice(0, 5).map((e) => `- ${e.device}: ${e.title}`));
  if (needVisit.length) lines.push("", `**Need a field visit:** ${needVisit.slice(0, 6).map((d) => d.name).join(", ")}${needVisit.length > 6 ? "…" : ""}`);
  else lines.push("", "All sensors are healthy — no field visits needed.");
  return {
    data: { devices: devices.length, offline: offline.length, faulty: faulty.length, lowBattery: lowBattery.length, criticalEvents, needVisit: needVisit.map((d) => d.name) },
    markdown: lines.join("\n"),
    artifacts: [
      { kind: "kpis", items: [
        { label: "Sensors", value: `${devices.length}` },
        { label: "Offline / stale", value: `${offline.length}`, tone: offline.length ? "warn" : "good" },
        { label: "Real events 24 h", value: `${criticalEvents.length}`, tone: criticalEvents.length ? "critical" : "good" },
        { label: "Need a visit", value: `${needVisit.length}`, tone: needVisit.length ? "warn" : "good" },
      ] },
      { kind: "map", title: "Sensor fleet", markers: devices.map((d) => ({ lat: d.lat, lon: d.lon, label: d.name, href: `/app/sensors/${d.id}`, kind: "asset" as const, score: offline.some((r) => r.d.id === d.id) ? 70 : faulty.some((r) => r.d.id === d.id) ? 55 : 15 })) },
    ],
    actions: [{ label: "Open Sensors & IoT", href: "/app/sensors", kind: "module" }, { label: "Rule: gauge rises 0.5 m in 6 h", href: "/app/alerts?new=1&metric=sensor_water_rise_6h_m&op=%3E%3D&value=0.5", kind: "rule" }],
    sources: ["Agri-SHIELD IoT telemetry"],
    followUps: ["Is the river rising anywhere?", "What should I look at right now?"],
  };
}
