/**
 * Thin adapter over the shared domain services (alert broadcasting,
 * escalation, supply-chain webhooks). Loaded lazily so the job system never
 * takes a hard import-time dependency on them, and with a minimal local
 * fallback so a scan still records alerts if a service fails to load.
 */
import type { AlertChannel, AlertSeverity, AlertType } from "@agri-shield/types";
import { getStore, nextId, type AlertRecord } from "../data/store";
import { publish } from "../realtime";
import { recordAppPush } from "../notify/channels";
import { firePushToUser } from "../notify/webpush";

export interface BroadcastInput {
  alertType: AlertType;
  severity: AlertSeverity;
  districtIds: string[];
  title: string;
  description: string;
  recommendedActions: string[];
  channels: AlertChannel[];
  createdBy: string;
  source: AlertRecord["source"];
  validHours: number;
}

type BroadcastFn = (i: BroadcastInput) => AlertRecord[] | Promise<AlertRecord[]>;
type VoidFn = () => unknown;

type AlertsMod = { broadcastAlert?: BroadcastFn; evaluateEscalations?: VoidFn; runAlertMaintenance?: VoidFn };

async function alertsModule(): Promise<AlertsMod | null> {
  try {
    return (await import("../services/alerts")) as unknown as AlertsMod;
  } catch (e) {
    console.warn("[jobs] services/alerts unavailable:", (e as Error).message);
    return null;
  }
}

async function supplyModule(): Promise<{ evaluateWebhooks?: VoidFn; computeCommodityRisks?: VoidFn } | null> {
  try {
    return (await import("../services/supply-chain")) as unknown as { evaluateWebhooks?: VoidFn; computeCommodityRisks?: VoidFn };
  } catch (e) {
    console.warn("[jobs] services/supply-chain unavailable:", (e as Error).message);
    return null;
  }
}

/** Local fallback: persist + realtime + in-app push only. */
function fallbackBroadcast(i: BroadcastInput): AlertRecord[] {
  const s = getStore();
  const now = new Date();
  return i.districtIds.map((did) => {
    const d = s.districts.find((x) => x.id === did);
    const farmers = s.farmers.filter((f) => f.districtId === did);
    const prob = i.alertType === "flood" ? d?.floodProb72h ?? 0.5 : (d?.salinityRisk ?? 50) / 100;
    const alert: AlertRecord = {
      id: nextId("alr"),
      alertType: i.alertType,
      severity: i.severity,
      districtId: did,
      title: i.title,
      description: i.description,
      predictedImpact: {
        farmsAffected: Math.round((d?.totalFarms ?? 1000) * prob * 0.18),
        areaHa: Math.round((d?.totalFarms ?? 1000) * prob * 0.23),
        estLossUsd: Math.round((d?.totalFarms ?? 1000) * prob * 0.23 * 620),
        probability: Math.round(prob * 100) / 100,
      },
      recommendedActions: i.recommendedActions,
      channels: i.channels,
      validFrom: now,
      validUntil: new Date(now.getTime() + i.validHours * 3_600_000),
      createdAt: now,
      createdBy: i.createdBy,
      source: i.source,
      isActive: true,
      deliveries: { sent: farmers.length, delivered: farmers.length, read: 0, actioned: 0 },
    };
    s.alerts.unshift(alert);
    for (const f of farmers) {
      recordAppPush(f.userId, `${i.title}: ${i.recommendedActions[0] ?? ""}`);
      firePushToUser(f.userId, { title: i.title, body: i.recommendedActions[0] ?? i.description, severity: i.severity, tag: alert.id, alertId: alert.id, url: "/dashboard/farmer/alerts" });
    }
    publish(`district:${did}`, { type: "alert.created", alertId: alert.id, districtId: did, severity: i.severity, title: i.title, alertType: i.alertType });
    return alert;
  });
}

export async function broadcast(i: BroadcastInput): Promise<{ alerts: AlertRecord[]; via: "service" | "fallback" }> {
  const mod = await alertsModule();
  if (mod?.broadcastAlert) {
    const alerts = await mod.broadcastAlert(i);
    return { alerts: Array.isArray(alerts) ? alerts : [], via: "service" };
  }
  return { alerts: fallbackBroadcast(i), via: "fallback" };
}

/**
 * Scheduled sends + severity escalation + delivery-receipt progression.
 * Returns whatever the service returns, normalised to a short string.
 */
export async function runEscalations(): Promise<string> {
  const mod = await alertsModule();
  if (mod?.runAlertMaintenance) {
    const r = (await mod.runAlertMaintenance()) as { scheduled?: number; escalations?: number } | undefined;
    return r && typeof r === "object" ? `${r.escalations ?? 0} escalated, ${r.scheduled ?? 0} scheduled sent` : describe(r);
  }
  if (!mod?.evaluateEscalations) return "unavailable";
  return `${describe(await mod.evaluateEscalations())} escalated`;
}

export async function runWebhooks(): Promise<string> {
  const mod = await supplyModule();
  if (!mod?.evaluateWebhooks) return "unavailable";
  const r = (await mod.evaluateWebhooks()) as { evaluated?: number; fired?: number } | undefined;
  return r && typeof r === "object" && "fired" in r ? `${r.fired} fired / ${r.evaluated} evaluated` : describe(r);
}

export async function runCommodityRisks(): Promise<string> {
  const mod = await supplyModule();
  if (!mod?.computeCommodityRisks) return "unavailable";
  return describe(await mod.computeCommodityRisks());
}

function describe(v: unknown): string {
  if (v == null) return "ok";
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return `${v.length}`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["escalated", "count", "fired", "delivered", "sent", "total"]) {
      if (typeof o[k] === "number") return `${o[k]}`;
      if (Array.isArray(o[k])) return `${(o[k] as unknown[]).length}`;
    }
    return "ok";
  }
  return String(v);
}
