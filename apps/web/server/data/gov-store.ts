/**
 * Government-portal state that lives alongside the core store:
 *  - per-recipient alert deliveries (receipts, read / actioned timestamps)
 *  - escalation rules (per org) + escalation log
 *  - scheduled ("send later") alerts
 *  - dispatch metadata (depot, vehicle, ETA) for resource requests
 *
 * Kept on globalThis so hot-reload doesn't wipe operator actions, exactly like
 * the core store. Listens on the realtime bus so a farmer acknowledging an
 * alert in the farmer portal (alert.actioned) is reflected in gov receipts.
 */
import type { AlertChannel, AlertSeverity, AlertType, SupportedLanguage } from "@agri-shield/types";
import { bus, type RealtimeEnvelope } from "../realtime";
import { getStore } from "./store";

export interface DeliveryRecord {
  id: string;
  alertId: string;
  /** farmer profile id for farmers, user id for officers, roster id for bulk lists */
  recipientId: string;
  recipientKind: "farmer" | "officer" | "roster";
  recipientName: string;
  districtId: string;
  channel: AlertChannel;
  language: SupportedLanguage;
  to: string;
  body: string;
  /** number of recipients represented (1 except for roster bulk sends) */
  count: number;
  status: "sent" | "simulated" | "failed";
  provider: string;
  messageId: string | null;
  sentAt: Date;
  deliveredAt: Date | null;
  readAt: Date | null;
  actionedAt: Date | null;
}

export type EscalationMetric = "floodProb72h" | "floodProb24h" | "floodRisk" | "salinityRisk" | "ecCurrent" | "rainfall72hMm";

export interface EscalationRule {
  id: string;
  name: string;
  enabled: boolean;
  alertTypes: AlertType[];
  metric: EscalationMetric;
  /** comparison threshold in the metric's natural unit (probabilities 0-1) */
  threshold: number;
  /** hours after issue at which the rule is checked (spec: T+6h) */
  afterHours: number;
  /** escalate one step, or straight to emergency */
  mode: "step" | "emergency";
  notifyChannels: AlertChannel[];
  updatedAt: Date;
  updatedBy: string;
}

export interface EscalationEvent {
  id: string;
  at: Date;
  orgId: string;
  ruleId: string;
  ruleName: string;
  alertId: string;
  districtId: string;
  from: AlertSeverity;
  to: AlertSeverity;
  metric: EscalationMetric;
  observed: number;
  threshold: number;
  notified: number;
}

export interface ScheduledAlert {
  id: string;
  orgId: string;
  sendAt: Date;
  createdAt: Date;
  createdBy: string;
  createdByName: string;
  status: "scheduled" | "sent" | "cancelled" | "failed";
  sentAlertIds: string[];
  payload: {
    alertType: AlertType;
    severity: AlertSeverity;
    districtIds: string[];
    title: string;
    description: string;
    recommendedActions: string[];
    channels: AlertChannel[];
    validHours: number;
  };
}

export interface DispatchMeta {
  requestId: string;
  depotName: string;
  depotLat: number;
  depotLon: number;
  vehicleId: string;
  vehicleLabel: string;
  etaHours: number;
  distanceKm: number;
  dispatchedAt: Date;
}

interface GovState {
  deliveries: DeliveryRecord[];
  rules: Record<string, EscalationRule[]>;
  escalations: EscalationEvent[];
  scheduled: ScheduledAlert[];
  dispatch: Record<string, DispatchMeta>;
  /** alertId → last escalation time (one escalation per window) */
  escalatedAt: Record<string, number>;
  lastEscalationRun: Record<string, number>;
  listening: boolean;
}

const g = globalThis as unknown as { __agriGov?: GovState };

export function govState(): GovState {
  if (!g.__agriGov) {
    g.__agriGov = { deliveries: [], rules: {}, escalations: [], scheduled: [], dispatch: {}, escalatedAt: {}, lastEscalationRun: {}, listening: false };
  }
  const s = g.__agriGov;
  if (!s.listening) {
    s.listening = true;
    bus.on("event", (env: RealtimeEnvelope) => {
      // The farmer portal owns the aggregate counters; we only stamp our receipts.
      if (env.event.type === "alert.actioned") markDeliveryActioned(env.event.alertId, env.event.farmerId, false);
    });
  }
  return s;
}

/** Default rules — mirror spec §4.5 "auto-escalate severity if risk threshold is crossed at T+6h". */
export function defaultRules(orgId: string): EscalationRule[] {
  const now = new Date();
  return [
    { id: `${orgId}-esc-flood72`, name: "Flood probability ≥ 75% at T+6h", enabled: true, alertTypes: ["flood", "storm"], metric: "floodProb72h", threshold: 0.75, afterHours: 6, mode: "step", notifyChannels: ["app", "sms", "whatsapp"], updatedAt: now, updatedBy: "system" },
    { id: `${orgId}-esc-flood24`, name: "Imminent flood (24h ≥ 85%) → Emergency", enabled: true, alertTypes: ["flood", "storm"], metric: "floodProb24h", threshold: 0.85, afterHours: 6, mode: "emergency", notifyChannels: ["app", "sms", "whatsapp", "email"], updatedAt: now, updatedBy: "system" },
    { id: `${orgId}-esc-ec`, name: "Salinity EC ≥ 6 dS/m at T+6h", enabled: true, alertTypes: ["salinity"], metric: "ecCurrent", threshold: 6, afterHours: 6, mode: "step", notifyChannels: ["app", "sms"], updatedAt: now, updatedBy: "system" },
  ];
}

export function rulesFor(orgId: string): EscalationRule[] {
  const s = govState();
  return (s.rules[orgId] ??= defaultRules(orgId));
}

export function deliveriesFor(alertId: string): DeliveryRecord[] {
  return govState().deliveries.filter((d) => d.alertId === alertId);
}

/** Farmer-side receipts: exported so the farmer portal can mark alerts read. */
export function markDeliveryRead(alertId: string, farmerId: string, touchCounts = true): number {
  const now = new Date();
  let n = 0;
  for (const d of govState().deliveries) {
    if (d.alertId === alertId && d.recipientId === farmerId && !d.readAt) {
      d.readAt = now;
      n++;
    }
  }
  if (n && touchCounts) {
    const a = getStore().alerts.find((x) => x.id === alertId);
    if (a) a.deliveries.read += 1;
  }
  return n;
}

export function markDeliveryActioned(alertId: string, farmerId: string, touchCounts = true): number {
  const now = new Date();
  let n = 0;
  for (const d of govState().deliveries) {
    if (d.alertId === alertId && d.recipientId === farmerId && !d.actionedAt) {
      d.readAt ??= now;
      d.actionedAt = now;
      n++;
    }
  }
  if (n && touchCounts) {
    const a = getStore().alerts.find((x) => x.id === alertId);
    if (a) a.deliveries.actioned += 1;
  }
  return n;
}

export function getDeliveriesForFarmer(farmerId: string): DeliveryRecord[] {
  return govState().deliveries.filter((d) => d.recipientId === farmerId);
}
