/**
 * Alert broadcast service — the single path by which a climate alert reaches
 * people. Used by the government Early-Warning wizard, auto-escalation and the
 * platform CLIMATE_SCAN job (spec §6).
 *
 *   broadcastAlert(input)      → creates one AlertRecord per district, fans out
 *                                 per-recipient deliveries (farmer prefs: types,
 *                                 threshold, channels; language-translated),
 *                                 bulk SMS roster, officer email, audits, and
 *                                 publishes realtime to gov / district / farmer rooms.
 *   evaluateEscalations(opts)  → applies escalation rules (T+6h) to active alerts.
 *   processScheduledAlerts()   → sends "schedule for later" alerts that are due.
 *
 * Channels go through server/notify/channels.ts: real Twilio / Resend when keys
 * are configured, otherwise the in-memory outbox (status "simulated").
 */
import type { AlertChannel, AlertSeverity, AlertType, SupportedLanguage } from "@agri-shield/types";
import { audit, getStore, nextId, type AlertRecord, type DistrictRecord } from "../data/store";
import { districtEconomics, SEVERITY_RANK } from "../data/gov-model";
import { govState, rulesFor, type DeliveryRecord, type EscalationEvent, type EscalationRule, type ScheduledAlert } from "../data/gov-store";
import { outbox, recordAppPush, sendEmail, sendSms, sendWhatsApp } from "../notify/channels";
import { publish } from "../realtime";
import { translate } from "../live/translate";
import { COUNTRIES } from "../data/geography";

// ─── Types ────────────────────────────────────────────────────────────────

export interface BroadcastAlertInput {
  alertType: AlertType;
  severity: AlertSeverity;
  districtIds: string[];
  title: string;
  description: string;
  recommendedActions: string[];
  channels: AlertChannel[];
  /** user id, or "system" for automated scans */
  createdBy: string;
  source?: AlertRecord["source"];
  /** alert validity window in hours (default 72) */
  validHours?: number;
}

const HOUR = 3_600_000;
const SEV_LABEL: Record<AlertSeverity, string> = { watch: "WATCH", warning: "WARNING", emergency: "EMERGENCY" };
const TYPE_LABEL: Record<AlertType, string> = { flood: "Flood", salinity: "Salinity", drought: "Dry spell", storm: "Cyclone/Storm", frost: "Cold wave" };
/** farmer notificationPrefs.alertTypes vocabulary */
const PREF_TYPE: Record<AlertType, string> = { flood: "flood", salinity: "salinity", drought: "weather", storm: "weather", frost: "weather" };
const THRESHOLD_RANK = { low: 0, medium: 1, high: 2 } as const;

const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 11) >>> 0;

// ─── Message rendering ────────────────────────────────────────────────────

const GSM7 = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXT = "^{}\\[~]|€";

export function smsSegments(text: string) {
  const gsm = [...text].every((ch) => GSM7.includes(ch) || GSM7_EXT.includes(ch));
  const units = gsm ? [...text].reduce((n, ch) => n + (GSM7_EXT.includes(ch) ? 2 : 1), 0) : [...text].length;
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  const segments = units <= single ? 1 : Math.ceil(units / multi);
  return { encoding: gsm ? ("GSM-7" as const) : ("UCS-2" as const), chars: units, segments, perSegment: units <= single ? single : multi };
}

export interface RenderInput {
  alertType: AlertType;
  severity: AlertSeverity;
  title: string;
  description: string;
  recommendedActions: string[];
  districtName?: string;
  validUntil?: Date;
  shortId?: string;
}

/** Replace typographic characters that would force UCS-2 (70-char segments) with GSM-7 equivalents. */
export function toGsmFriendly(s: string): string {
  return s
    .replace(/[‒-―]/g, "-")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/…/g, "...")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/³/g, "3")
    .replace(/²/g, "2")
    .replace(/×/g, "x")
    .replace(/°/g, " deg")
    .replace(/[   ]/g, " ");
}

export function renderSms(a: RenderInput): string {
  const acts = a.recommendedActions.slice(0, 2).map((x) => x.replace(/\.$/, "")).join("; ");
  const link = a.shortId ? ` agrishield.io/a/${a.shortId}` : "";
  return toGsmFriendly(`AGRI-SHIELD ${SEV_LABEL[a.severity]}: ${a.title}. ${acts ? `Act now: ${acts}.` : ""}${link} Reply HELP or STOP`).replace(/\s+/g, " ").trim();
}

export function renderApp(a: RenderInput) {
  const body = a.description.length > 150 ? `${a.description.slice(0, 147).trimEnd()}…` : a.description;
  return { title: `${SEV_LABEL[a.severity]} · ${a.title}`, body };
}

export function renderWhatsApp(a: RenderInput) {
  return {
    header: `${TYPE_LABEL[a.alertType].toUpperCase()} ${SEV_LABEL[a.severity]}`,
    title: a.title,
    body: a.description,
    actions: a.recommendedActions.slice(0, 3),
    footer: a.validUntil ? `Valid until ${a.validUntil.toISOString().slice(0, 16).replace("T", " ")} UTC · Agri-SHIELD` : "Agri-SHIELD early warning",
    buttons: ["I've taken action", "Call field officer", "Stop alerts"],
  };
}

export function whatsAppText(a: RenderInput): string {
  const w = renderWhatsApp(a);
  return `*${w.header}*\n*${w.title}*\n\n${w.body}\n\n${w.actions.map((x, i) => `${i + 1}. ${x}`).join("\n")}\n\n_${w.footer}_`;
}

export function renderEmail(a: RenderInput) {
  const color = a.severity === "emergency" ? "#ef4444" : a.severity === "warning" ? "#f97316" : "#eab308";
  const subject = `[${SEV_LABEL[a.severity]}] ${a.title}`;
  const html = `<!doctype html><html><body style="margin:0;background:#0b1120;font-family:Inter,Arial,sans-serif;color:#e2e8f0">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#111827;border:1px solid #1f2937;border-radius:12px;overflow:hidden">
<tr><td style="background:${color};height:4px"></td></tr>
<tr><td style="padding:20px 24px">
<div style="font:600 11px monospace;letter-spacing:.14em;color:${color}">${TYPE_LABEL[a.alertType].toUpperCase()} · ${SEV_LABEL[a.severity]}</div>
<h1 style="font-size:20px;margin:8px 0 12px;color:#fff">${escapeHtml(a.title)}</h1>
<p style="font-size:14px;line-height:1.6;color:#cbd5e1">${escapeHtml(a.description)}</p>
<h3 style="font-size:13px;color:#10b981;margin:16px 0 8px">Recommended actions</h3>
<ol style="font-size:14px;line-height:1.6;color:#e2e8f0;padding-left:18px">${a.recommendedActions.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ol>
${a.validUntil ? `<p style="font-size:12px;color:#64748b">Valid until ${a.validUntil.toUTCString()}</p>` : ""}
</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #1f2937;font-size:11px;color:#64748b">Agri-SHIELD Early Warning · Government operations dashboard</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Translate the farmer-facing parts of a message. Never throws; falls back to English. */
export async function translateMessage(a: RenderInput, language: SupportedLanguage, budgetMs = 7000) {
  if (language === "en") return { language, provider: "none", title: a.title, description: a.description, actions: a.recommendedActions };
  const joined = [a.title, a.description, ...a.recommendedActions].join("\n");
  const r = await withTimeout(translate(joined, language), budgetMs, { text: joined, provider: "timeout" });
  const parts = r.text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const ok = parts.length === 2 + a.recommendedActions.length && r.provider !== "none" && r.provider !== "timeout";
  return ok
    ? { language, provider: r.provider, title: parts[0]!, description: parts[1]!, actions: parts.slice(2) }
    : { language, provider: r.provider === "timeout" ? "timeout" : "none", title: a.title, description: a.description, actions: a.recommendedActions };
}

// ─── Templates ────────────────────────────────────────────────────────────

export interface AlertTemplate {
  key: string;
  name: string;
  alertType: AlertType;
  defaultSeverity: AlertSeverity;
  channels: AlertChannel[];
  validHours: number;
  build: (d: DistrictRecord) => { title: string; description: string; recommendedActions: string[] };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** GloFAS-aware river sentence: only claims "above normal" when discharge actually is. */
function riverLine(d: DistrictRecord): string {
  const q = d.riverDischargeM3s;
  const m = d.riverDischargeMeanM3s;
  if (!q || !m) return `The ${d.riverName} is being watched for rising water.`;
  const r = q / m;
  const vs = `${q.toLocaleString()} m³/s vs a 30-day mean of ${m.toLocaleString()} m³/s`;
  return r >= 1.15 ? `The ${d.riverName} is forecast to run ${Math.round((r - 1) * 100)}% above normal (${vs}).` : `The ${d.riverName} is ${r < 0.85 ? "below" : "near"} its 30-day mean (${vs}); the risk is driven by local rainfall, soil saturation and low-lying fields.`;
}

export const ALERT_TEMPLATES: AlertTemplate[] = [
  {
    key: "flood_warning",
    name: "Riverine flood warning (72h)",
    alertType: "flood",
    defaultSeverity: "warning",
    channels: ["app", "sms", "whatsapp"],
    validHours: 72,
    build: (d) => ({
      title: `Flood warning — ${d.name}`,
      description: `${riverLine(d)} ${d.rainfall72hMm} mm of rain is expected in 72h. Probability of field flooding: ${pct(d.floodProb24h)} (24h), ${pct(d.floodProb72h)} (72h).`,
      recommendedActions: ["Harvest mature crops (80% or more ripe) now", "Move seed, fertiliser and livestock to raised ground", "Clear drainage outlets and open bunds toward canals"],
    }),
  },
  {
    key: "flood_emergency",
    name: "Flood emergency / embankment breach",
    alertType: "flood",
    defaultSeverity: "emergency",
    channels: ["app", "sms", "whatsapp", "email"],
    validHours: 48,
    build: (d) => ({
      title: `FLOOD EMERGENCY — ${d.name}`,
      description: `Imminent flooding along the ${d.riverName}. 24h flood probability ${pct(d.floodProb24h)}; low-lying unions may see ${Math.max(0.3, Math.round((d.floodProb72h - 0.35) * 16) / 10)} m of water. Follow instructions from your Upazila/district officer.`,
      recommendedActions: ["Move family, livestock and documents to the nearest cyclone/flood shelter", "Switch off irrigation pumps and electrical connections", "Keep phone charged; call the district control room if trapped"],
    }),
  },
  {
    key: "cyclone",
    name: "Cyclone / severe storm landfall",
    alertType: "storm",
    defaultSeverity: "warning",
    channels: ["app", "sms", "whatsapp", "email"],
    validHours: 48,
    build: (d) => ({
      title: `Cyclone warning — ${d.name} coast`,
      description: `A tropical cyclone may bring damaging winds, ${d.rainfall72hMm} mm of rain and storm surge within ${d.coastDistanceKm} km of the coast. Crops near harvest are at high risk.`,
      recommendedActions: ["Harvest ready produce before landfall", "Secure roofs, nets and greenhouse covers", "Move boats and nets to safe harbour"],
    }),
  },
  {
    key: "salinity_emergency",
    name: "Saltwater intrusion emergency",
    alertType: "salinity",
    defaultSeverity: "warning",
    channels: ["app", "sms", "whatsapp"],
    validHours: 168,
    build: (d) => ({
      title: `Saltwater intrusion — ${d.name}`,
      description: `River/soil salinity is ${d.ecCurrent} dS/m and forecast to reach ${d.ecPredicted30d} dS/m within 30 days on the ${d.riverName}. Rice loses yield above 3 dS/m.`,
      recommendedActions: ["Do not irrigate from the river at high tide", "Flush fields with 150 mm of fresh water where available", "Apply gypsum 2–4 t/ha on affected plots"],
    }),
  },
  {
    key: "dry_spell",
    name: "Dry spell / heat stress",
    alertType: "drought",
    defaultSeverity: "watch",
    channels: ["app", "sms"],
    validHours: 168,
    build: (d) => ({
      title: `Dry spell watch — ${d.name}`,
      description: `Only ${d.rainfall72hMm} mm of rain forecast over 72h while crops in ${d.name} approach flowering. Soil moisture is falling.`,
      recommendedActions: ["Prioritise irrigation for flowering-stage crops", "Use alternate wetting and drying (AWD)", "Mulch vegetable beds to save moisture"],
    }),
  },
  {
    key: "cold_wave",
    name: "Cold wave (Boro seedbeds)",
    alertType: "frost",
    defaultSeverity: "watch",
    channels: ["app", "sms"],
    validHours: 72,
    build: (d) => ({
      title: `Cold wave watch — ${d.name}`,
      description: `Night temperatures are forecast to drop sharply in ${d.name}. Rice seedbeds and vegetables may be damaged.`,
      recommendedActions: ["Cover seedbeds with polythene overnight", "Irrigate lightly in the evening to retain heat"],
    }),
  },
];

// ─── Delivery fan-out ─────────────────────────────────────────────────────

/** Historical response calibration from the alert archive (read / actioned per delivered). */
export function historicalResponseRates() {
  const past = getStore().alerts.filter((a) => !a.isActive && a.deliveries.delivered > 0);
  const del = past.reduce((s, a) => s + a.deliveries.delivered, 0) || 1;
  const sent = past.reduce((s, a) => s + a.deliveries.sent, 0) || 1;
  return {
    delivery: del / sent,
    read: past.reduce((s, a) => s + a.deliveries.read, 0) / del,
    action: past.reduce((s, a) => s + a.deliveries.actioned, 0) / del,
  };
}

/** Share of district farms enrolled in the ministry SMS roster (feature-phone users). */
export function rosterSize(d: DistrictRecord): number {
  const rate = 0.018 + (hash(d.id) % 25) / 1000; // 1.8–4.2%
  return Math.round(d.totalFarms * rate);
}

interface FanoutResult {
  deliveries: DeliveryRecord[];
  farmerIds: string[];
}

async function fanout(alert: AlertRecord, d: DistrictRecord, channels: AlertChannel[], prefix = ""): Promise<FanoutResult> {
  const store = getStore();
  const gs = govState();
  const base: RenderInput = { alertType: alert.alertType, severity: alert.severity, title: prefix + alert.title, description: alert.description, recommendedActions: alert.recommendedActions, districtName: d.name, validUntil: alert.validUntil, shortId: alert.id.slice(-6) };
  const out: DeliveryRecord[] = [];
  const farmerIds: string[] = [];

  // Registered farmers in the district, filtered by their notification preferences
  const recipients = store.farmers
    .filter((f) => f.districtId === d.id)
    .map((f) => ({ f, u: store.users.find((u) => u.id === f.userId) }))
    .filter(({ f, u }) => {
      if (!u || u.status === "suspended") return false;
      const typeOk = f.notificationPrefs.alertTypes.includes(PREF_TYPE[alert.alertType]) || alert.severity === "emergency";
      const sevOk = SEVERITY_RANK[alert.severity] > THRESHOLD_RANK[f.notificationPrefs.threshold] || alert.severity === "emergency";
      return typeOk && sevOk;
    });

  // One translation per language (cached), in parallel, bounded time
  const langs = [...new Set(recipients.map((r) => r.u!.language))];
  const translations = new Map<string, Awaited<ReturnType<typeof translateMessage>>>();
  await Promise.all(langs.map(async (l) => translations.set(l, await translateMessage(base, l))));

  const now = new Date();
  const mk = (p: Omit<DeliveryRecord, "id" | "alertId" | "sentAt" | "deliveredAt" | "readAt" | "actionedAt" | "districtId">): DeliveryRecord => ({
    ...p,
    id: nextId("dlv"),
    alertId: alert.id,
    districtId: d.id,
    sentAt: now,
    deliveredAt: p.status === "failed" ? null : now,
    readAt: null,
    actionedAt: null,
  });

  for (const { f, u } of recipients) {
    const tr = translations.get(u!.language)!;
    const msg: RenderInput = { ...base, title: tr.title, description: tr.description, recommendedActions: tr.actions };
    let chans = channels.filter((c) => c !== "email" && f.notificationPrefs.channels.includes(c));
    if (!chans.length && alert.severity === "emergency") chans = ["sms"]; // life-safety override
    if (!chans.length) continue;
    farmerIds.push(f.id);
    for (const ch of chans) {
      const to = ch === "app" ? u!.id : u!.phone ?? u!.email ?? u!.id;
      let rec;
      let body: string;
      if (ch === "sms") rec = await sendSms(to, (body = renderSms(msg)));
      else if (ch === "whatsapp") rec = await sendWhatsApp(to, (body = whatsAppText(msg)));
      else rec = recordAppPush(to, (body = `${renderApp(msg).title}\n${renderApp(msg).body}`));
      out.push(mk({ recipientId: f.id, recipientKind: "farmer", recipientName: u!.name, channel: ch, language: u!.language, to, body, count: 1, status: rec.status, provider: rec.provider, messageId: rec.id }));
    }
  }

  // Ministry SMS roster (feature phones) — bulk gateway, one entry per district
  if (channels.includes("sms")) {
    const n = rosterSize(d);
    const lang = COUNTRIES.find((c) => c.code === d.country)!.language;
    const tr = translations.get(lang) ?? (await translateMessage(base, lang));
    const body = renderSms({ ...base, title: tr.title, recommendedActions: tr.actions });
    const id = `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    outbox.unshift({ id, channel: "sms", to: `roster:${d.id} (${n.toLocaleString()} recipients)`, body, at: now, status: "simulated", provider: "bulk-sms-gateway" });
    out.push(mk({ recipientId: `roster-${d.id}`, recipientKind: "roster", recipientName: `${d.name} SMS roster`, channel: "sms", language: lang, to: `roster:${d.id}`, body, count: n, status: "simulated", provider: "bulk-sms-gateway", messageId: id }));
  }

  // Government officers of the owning org — HTML email (spec §6)
  if (channels.includes("email")) {
    const officers = store.users.filter((u) => u.orgId === d.orgId && u.email && u.role !== "farmer" && u.status === "active");
    const { subject, html } = renderEmail(base);
    for (const o of officers) {
      const rec = await sendEmail(o.email!, subject, html);
      out.push(mk({ recipientId: o.id, recipientKind: "officer", recipientName: o.name, channel: "email", language: "en", to: o.email!, body: subject, count: 1, status: rec.status, provider: rec.provider, messageId: rec.id }));
    }
  }

  gs.deliveries.unshift(...out);
  if (gs.deliveries.length > 20000) gs.deliveries.length = 20000;
  return { deliveries: out, farmerIds };
}

/**
 * Progress read/actioned receipts for simulated recipients using a response
 * curve calibrated on the historical archive. Real farmer interactions
 * (markDeliveryRead / alert.actioned) always take precedence.
 */
export function refreshReceipts(now = Date.now()) {
  const gs = govState();
  const rates = historicalResponseRates();
  const touched = new Set<string>();
  for (const d of gs.deliveries) {
    if (d.status === "failed" || d.recipientKind === "officer") continue;
    if (d.recipientId === "farmer-000") continue; // demo farmer: only real clicks count
    const h = hash(d.id);
    const elapsedMin = (now - d.sentAt.getTime()) / 60_000;
    const delay = 3 + (h % 90); // 3–92 min to open
    if (!d.readAt && elapsedMin > delay && (h % 1000) / 1000 < rates.read) {
      d.readAt = new Date(d.sentAt.getTime() + delay * 60_000);
      touched.add(d.alertId);
    }
    if (d.readAt && !d.actionedAt && elapsedMin > delay * 2.5 && ((h >> 3) % 1000) / 1000 < rates.action / Math.max(0.01, rates.read)) {
      d.actionedAt = new Date(d.sentAt.getTime() + delay * 2.5 * 60_000);
      touched.add(d.alertId);
    }
  }
  if (!touched.size) return;
  const store = getStore();
  for (const alertId of touched) {
    const a = store.alerts.find((x) => x.id === alertId);
    if (!a) continue;
    const ds = gs.deliveries.filter((x) => x.alertId === alertId);
    const read = ds.reduce((s, x) => s + (x.readAt ? (x.recipientKind === "roster" ? Math.round(x.count * rates.read) : 1) : 0), 0);
    const actioned = ds.reduce((s, x) => s + (x.actionedAt ? (x.recipientKind === "roster" ? Math.round(x.count * rates.action) : 1) : 0), 0);
    // never go backwards: the farmer portal may have counted real interactions too
    a.deliveries.read = Math.max(a.deliveries.read, read);
    a.deliveries.actioned = Math.max(a.deliveries.actioned, actioned);
  }
}

// ─── broadcastAlert ───────────────────────────────────────────────────────

/**
 * Create and deliver an alert for one or more districts.
 * Returns the created AlertRecord(s) — one per district — with delivery counts filled.
 */
export async function broadcastAlert(input: BroadcastAlertInput): Promise<AlertRecord[]> {
  const store = getStore();
  const now = new Date();
  const validHours = input.validHours ?? 72;
  const channels = [...new Set(input.channels)] as AlertChannel[];
  const creator = store.users.find((u) => u.id === input.createdBy);
  const created: AlertRecord[] = [];
  const rates = historicalResponseRates();

  const districts = input.districtIds.map((id) => store.districts.find((d) => d.id === id)).filter((d): d is DistrictRecord => !!d);
  await Promise.all(
    districts.map(async (d) => {
      const e = districtEconomics(d);
      const probability =
        input.alertType === "salinity" ? Math.min(0.99, d.salinityRisk / 100) : input.alertType === "flood" || input.alertType === "storm" ? d.floodProb72h : 0.6;
      const title = districts.length > 1 && !input.title.includes(d.name) ? `${input.title} — ${d.name}` : input.title;
      const alert: AlertRecord = {
        id: nextId("alr"),
        alertType: input.alertType,
        severity: input.severity,
        districtId: d.id,
        title,
        description: input.description.replaceAll("{district}", d.name),
        predictedImpact: { farmsAffected: e.farmsAtRisk, areaHa: e.atRiskHa, estLossUsd: e.expectedLossUsd, probability: Math.round(probability * 100) / 100 },
        recommendedActions: input.recommendedActions.filter((x) => x.trim()),
        channels,
        validFrom: now,
        validUntil: new Date(now.getTime() + validHours * HOUR),
        createdAt: now,
        createdBy: input.createdBy,
        source: input.source ?? (input.createdBy === "system" ? "model" : "manual"),
        isActive: true,
        deliveries: { sent: 0, delivered: 0, read: 0, actioned: 0 },
      };
      store.alerts.unshift(alert);
      const { deliveries, farmerIds } = await fanout(alert, d, channels);
      const sent = deliveries.reduce((s, x) => s + x.count, 0);
      const delivered = deliveries.reduce((s, x) => s + (x.status === "failed" ? 0 : x.recipientKind === "roster" ? Math.round(x.count * rates.delivery) : x.count), 0);
      alert.deliveries = { sent, delivered, read: 0, actioned: 0 };
      store.counters.smsSentToday = (store.counters.smsSentToday ?? 0) + deliveries.filter((x) => x.channel === "sms").reduce((s, x) => s + x.count, 0);

      const ev = { type: "alert.created" as const, alertId: alert.id, districtId: d.id, severity: alert.severity, title: alert.title, alertType: alert.alertType };
      publish(`gov:${d.orgId}`, ev);
      publish(`district:${d.id}`, ev);
      for (const fid of farmerIds) publish(`farmer:${fid}`, ev);
      created.push(alert);
    })
  );

  if (created.length) {
    audit({
      userId: input.createdBy,
      userName: creator?.name ?? "Agri-SHIELD climate scan",
      action: "alert.create",
      entity: "climate_alert",
      entityId: created.map((a) => a.id).join(","),
      details: `${SEV_LABEL[input.severity]} ${input.alertType} alert → ${districts.map((d) => d.name).join(", ")} via ${channels.join("/")} (${created.reduce((s, a) => s + a.deliveries.sent, 0).toLocaleString()} recipients)`,
    });
  }
  return created;
}

// ─── Scheduling ───────────────────────────────────────────────────────────

const timers = globalThis as unknown as { __agriSchedTimers?: Map<string, ReturnType<typeof setTimeout>> };
const schedTimers = (timers.__agriSchedTimers ??= new Map());

export function scheduleAlert(orgId: string, user: { id: string; name: string }, payload: ScheduledAlert["payload"], sendAt: Date): ScheduledAlert {
  const s: ScheduledAlert = { id: nextId("sch"), orgId, sendAt, createdAt: new Date(), createdBy: user.id, createdByName: user.name, status: "scheduled", sentAlertIds: [], payload };
  govState().scheduled.unshift(s);
  const ms = sendAt.getTime() - Date.now();
  if (ms < 24 * HOUR) schedTimers.set(s.id, setTimeout(() => void processScheduledAlerts(), Math.max(0, ms) + 250));
  audit({ userId: user.id, userName: user.name, action: "alert.schedule", entity: "climate_alert", entityId: s.id, details: `${payload.severity} ${payload.alertType} scheduled for ${sendAt.toISOString()} → ${payload.districtIds.length} district(s)` });
  return s;
}

export function cancelScheduledAlert(id: string, user: { id: string; name: string }): boolean {
  const s = govState().scheduled.find((x) => x.id === id);
  if (!s || s.status !== "scheduled") return false;
  s.status = "cancelled";
  clearTimeout(schedTimers.get(id));
  audit({ userId: user.id, userName: user.name, action: "alert.schedule.cancel", entity: "climate_alert", entityId: id, details: "Scheduled alert cancelled" });
  return true;
}

/** Send every scheduled alert whose time has come. Safe to call often (platform job + reads). */
export async function processScheduledAlerts(now = Date.now()): Promise<number> {
  const due = govState().scheduled.filter((s) => s.status === "scheduled" && s.sendAt.getTime() <= now);
  let sent = 0;
  for (const s of due) {
    s.status = "sent"; // claim first to avoid double sends
    try {
      const alerts = await broadcastAlert({ ...s.payload, createdBy: s.createdBy, source: "manual" });
      s.sentAlertIds = alerts.map((a) => a.id);
      sent += alerts.length;
    } catch {
      s.status = "failed";
    }
  }
  return sent;
}

// ─── Escalation ───────────────────────────────────────────────────────────

const NEXT: Record<AlertSeverity, AlertSeverity> = { watch: "warning", warning: "emergency", emergency: "emergency" };

export function metricValue(d: DistrictRecord, m: EscalationRule["metric"]): number {
  return d[m];
}

export interface EscalationCheck {
  alertId: string;
  alertTitle: string;
  districtId: string;
  districtName: string;
  severity: AlertSeverity;
  ruleId: string;
  ruleName: string;
  observed: number;
  threshold: number;
  checkAt: Date;
  state: "armed" | "breached" | "below" | "escalated" | "max";
}

function activeOrgAlerts(orgId: string, now: number) {
  const store = getStore();
  return store.alerts
    .filter((a) => a.isActive && a.validUntil.getTime() > now)
    .map((a) => ({ a, d: store.districts.find((d) => d.id === a.districtId)! }))
    .filter(({ d }) => d && d.orgId === orgId);
}

/** Live monitor of every (active alert × enabled rule) pair — for the rules editor. */
export function escalationMonitor(orgId: string, now = Date.now()): EscalationCheck[] {
  const gs = govState();
  const out: EscalationCheck[] = [];
  for (const { a, d } of activeOrgAlerts(orgId, now)) {
    for (const r of rulesFor(orgId)) {
      if (!r.enabled || !r.alertTypes.includes(a.alertType)) continue;
      const observed = metricValue(d, r.metric);
      const checkAt = new Date(a.createdAt.getTime() + r.afterHours * HOUR);
      const esc = gs.escalations.find((e) => e.alertId === a.id && e.ruleId === r.id);
      const state: EscalationCheck["state"] = esc
        ? "escalated"
        : a.severity === "emergency"
          ? "max"
          : observed >= r.threshold
            ? checkAt.getTime() <= now
              ? "breached"
              : "armed"
            : "below";
      out.push({ alertId: a.id, alertTitle: a.title, districtId: d.id, districtName: d.name, severity: a.severity, ruleId: r.id, ruleName: r.name, observed, threshold: r.threshold, checkAt, state });
    }
  }
  return out;
}

/**
 * Apply escalation rules. For each active alert at/after T+afterHours where the
 * district's live metric crosses the rule threshold, raise severity (one step or
 * straight to emergency), re-notify recipients, audit and publish realtime.
 * Throttled per org to once a minute unless `force`.
 */
export async function evaluateEscalations(opts: { orgId?: string; force?: boolean; now?: Date } = {}): Promise<EscalationEvent[]> {
  const store = getStore();
  const gs = govState();
  const now = (opts.now ?? new Date()).getTime();
  const orgIds = opts.orgId ? [opts.orgId] : [...new Set(store.districts.map((d) => d.orgId))];
  const flagOn = store.flags.find((f) => f.key === "auto_escalation")?.enabled ?? true;
  const events: EscalationEvent[] = [];
  if (!flagOn) return events;

  for (const orgId of orgIds) {
    if (!opts.force && now - (gs.lastEscalationRun[orgId] ?? 0) < 60_000) continue;
    gs.lastEscalationRun[orgId] = now;
    for (const { a, d } of activeOrgAlerts(orgId, now)) {
      for (const r of rulesFor(orgId)) {
        if (!r.enabled || !r.alertTypes.includes(a.alertType) || a.severity === "emergency") continue;
        if (now - a.createdAt.getTime() < r.afterHours * HOUR) continue;
        if (now - (gs.escalatedAt[a.id] ?? 0) < r.afterHours * HOUR) continue;
        const observed = metricValue(d, r.metric);
        if (observed < r.threshold) continue;

        const from = a.severity;
        const to: AlertSeverity = r.mode === "emergency" ? "emergency" : NEXT[from];
        a.severity = to;
        a.title = a.title.replace(/\b(Watch|Warning|WATCH|WARNING)\b/, to === "emergency" ? "Emergency" : "Warning");
        a.validUntil = new Date(Math.max(a.validUntil.getTime(), now + 24 * HOUR));
        gs.escalatedAt[a.id] = now;

        const { deliveries } = await fanout(a, d, r.notifyChannels, "ESCALATED: ");
        const notified = deliveries.reduce((s, x) => s + x.count, 0);
        a.deliveries.sent += notified;
        a.deliveries.delivered += deliveries.reduce((s, x) => s + (x.status === "failed" ? 0 : x.count), 0);

        const ev: EscalationEvent = { id: nextId("esc"), at: new Date(now), orgId, ruleId: r.id, ruleName: r.name, alertId: a.id, districtId: d.id, from, to, metric: r.metric, observed, threshold: r.threshold, notified };
        gs.escalations.unshift(ev);
        events.push(ev);
        audit({ userId: "system", userName: "Escalation engine", action: "alert.escalate", entity: "climate_alert", entityId: a.id, details: `${r.name}: ${r.metric}=${observed} ≥ ${r.threshold} → ${from.toUpperCase()}→${to.toUpperCase()} (${notified} re-notified)` });
        const rt = { type: "alert.created" as const, alertId: a.id, districtId: d.id, severity: to, title: `Escalated: ${a.title}`, alertType: a.alertType };
        publish(`gov:${orgId}`, rt);
        publish(`district:${d.id}`, rt);
        break; // one escalation per alert per pass
      }
    }
  }
  return events;
}

/** Convenience for the platform scan job: scheduled sends + escalations + receipt progression. */
export async function runAlertMaintenance() {
  const scheduled = await processScheduledAlerts();
  const escalations = await evaluateEscalations({ force: true });
  refreshReceipts();
  return { scheduled, escalations: escalations.length };
}
