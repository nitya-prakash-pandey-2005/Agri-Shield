/**
 * Shareable Risk Explorer report snapshots (in-memory, owned by a workspace).
 * A snapshot freezes the full LocationRiskReport (+ climate / outlook when
 * computed) so `/r/<id>` shows exactly what the analyst saw, even as live
 * data changes. Ids are unguessable (random, 12 chars) — the link is the key.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LocationRiskReport } from "./location-risk";
import type { ClimateHistory, ClimateProjection, DroughtIndex, SeasonalOutlook } from "../live/climate";

import type { AssetType } from "@agri-shield/types";
export type { AssetType };

export interface SavedReport {
  id: string;
  orgId: string;
  orgName: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: Date;
  title: string;
  note: string | null;
  assetType: AssetType;
  crop: string | null;
  report: LocationRiskReport;
  climate: ClimateHistory | null;
  drought: DroughtIndex | null;
  seasonal: SeasonalOutlook | null;
  projection: ClimateProjection | null;
  views: number;
}

const g = globalThis as unknown as { __agriSharedReports?: Map<string, SavedReport>; __agriSharedLoaded?: boolean };
const reports: Map<string, SavedReport> = (g.__agriSharedReports ??= new Map());

// Snapshots are also written to disk so links survive a server restart (swap for the DB in production).
const DIR = join(process.env.AGRI_CACHE_DIR ?? join(tmpdir(), "agri-shield-cache"), "shared-reports");
const revive = (raw: SavedReport): SavedReport => ({ ...raw, createdAt: new Date(raw.createdAt) });
function loadFromDisk() {
  if (g.__agriSharedLoaded || process.env.AGRI_OFFLINE === "true") return;
  g.__agriSharedLoaded = true;
  try {
    for (const f of readdirSync(DIR)) {
      if (!f.endsWith(".json")) continue;
      try {
        const r = revive(JSON.parse(readFileSync(join(DIR, f), "utf8")) as SavedReport);
        if (!reports.has(r.id)) reports.set(r.id, r);
      } catch {
        /* skip corrupt file */
      }
    }
  } catch {
    /* no directory yet */
  }
}
function persist(r: SavedReport) {
  if (process.env.AGRI_OFFLINE === "true") return;
  try {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(join(DIR, `${r.id}.json`), JSON.stringify(r));
  } catch {
    /* read-only FS: memory only */
  }
}

export function newReportId(): string {
  return randomBytes(9).toString("base64url").slice(0, 12);
}

export function saveSnapshot(r: Omit<SavedReport, "id" | "createdAt" | "views">): SavedReport {
  const rec: SavedReport = { ...r, id: newReportId(), createdAt: new Date(), views: 0 };
  reports.set(rec.id, rec);
  persist(rec);
  // bound memory: keep the newest 2 000 snapshots
  if (reports.size > 2000) reports.delete(reports.keys().next().value!);
  return rec;
}

export function getSnapshot(id: string, countView = false): SavedReport | null {
  loadFromDisk();
  const r = reports.get(id) ?? null;
  if (r && countView) r.views++;
  return r;
}

export function listSnapshots(orgId: string): SavedReport[] {
  loadFromDisk();
  return [...reports.values()].filter((r) => r.orgId === orgId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function deleteSnapshot(orgId: string, id: string): boolean {
  const r = reports.get(id);
  if (!r || r.orgId !== orgId) return false;
  try {
    unlinkSync(join(DIR, `${id}.json`));
  } catch {
    /* not on disk */
  }
  return reports.delete(id);
}

// ─── Anonymous (public /explore) quota: N reports per hour per IP ────────
const gq = globalThis as unknown as { __agriExploreQuota?: Map<string, number[]> };
const quota: Map<string, number[]> = (gq.__agriExploreQuota ??= new Map());

export function takePublicQuota(ip: string, limitPerHour = 5, now = Date.now()): { ok: boolean; remaining: number; resetInMin: number } {
  const arr = (quota.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (arr.length >= limitPerHour) {
    quota.set(ip, arr);
    return { ok: false, remaining: 0, resetInMin: Math.ceil((arr[0]! + 3600_000 - now) / 60_000) };
  }
  arr.push(now);
  quota.set(ip, arr);
  return { ok: true, remaining: limitPerHour - arr.length, resetInMin: Math.ceil((arr[0]! + 3600_000 - now) / 60_000) };
}

export function peekPublicQuota(ip: string, limitPerHour = 5, now = Date.now()): number {
  return Math.max(0, limitPerHour - (quota.get(ip) ?? []).filter((t) => now - t < 3600_000).length);
}
