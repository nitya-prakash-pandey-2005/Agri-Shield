/**
 * Two-tier cache for expensive, slowly-changing open data (40-year ERA5
 * climatologies, GloFAS records, CMIP6 projections, soil profiles).
 *
 *   memory (cached(), shared in-flight promises)  →  JSON file in the OS temp dir
 *
 * The file tier survives dev-server restarts and serverless cold starts on the
 * same host, which keeps us far below Open-Meteo's fair-use limits (a single
 * 40-year request is weighted as ~200 API calls). Failures are negatively
 * cached for a few minutes so a flaky upstream is not hammered.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cached } from "./http";

const DIR = process.env.AGRI_CACHE_DIR ?? join(tmpdir(), "agri-shield-cache");
const g = globalThis as unknown as { __agriNeg?: Map<string, { until: number; message: string }> };
const negative: Map<string, { until: number; message: string }> = (g.__agriNeg ??= new Map());

const fileFor = (key: string) => join(DIR, `${createHash("sha1").update(key).digest("hex").slice(0, 24)}.json`);

async function readDisk<T>(key: string): Promise<{ value: T; savedAt: number } | null> {
  try {
    const raw = JSON.parse(await readFile(fileFor(key), "utf8")) as { key: string; savedAt: number; value: T };
    return raw.key === key ? { value: raw.value, savedAt: raw.savedAt } : null;
  } catch {
    return null;
  }
}

async function writeDisk<T>(key: string, value: T): Promise<void> {
  try {
    await mkdir(DIR, { recursive: true });
    await writeFile(fileFor(key), JSON.stringify({ key, savedAt: Date.now(), value }));
  } catch {
    /* read-only FS — memory tier still works */
  }
}

export async function persisted<T>(key: string, ttlMs: number, loader: () => Promise<T>, opts: { negativeTtlMs?: number } = {}): Promise<T> {
  return cached(`disk:${key}`, Math.min(ttlMs, 6 * 3600_000), async () => {
    const disk = process.env.AGRI_OFFLINE === "true" ? null : await readDisk<T>(key);
    if (disk && Date.now() - disk.savedAt < ttlMs) return disk.value;
    const neg = negative.get(key);
    if (neg && neg.until > Date.now()) {
      if (disk) return disk.value;
      throw new Error(neg.message);
    }
    try {
      const value = await loader();
      void writeDisk(key, value);
      return value;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      negative.set(key, { until: Date.now() + (opts.negativeTtlMs ?? 5 * 60_000), message });
      if (disk) return disk.value; // stale-while-error
      throw err;
    }
  });
}

/** Resolve within `ms` or reject — the underlying work keeps running and fills the cache. */
export function within<T>(p: Promise<T>, ms: number, label = "task"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} still computing (>${Math.round(ms / 1000)} s)`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/** Return a persisted value only if it is already on disk and fresh — never calls upstream. */
export async function peekPersisted<T>(key: string, ttlMs: number): Promise<T | null> {
  const disk = await readDisk<T>(key);
  return disk && Date.now() - disk.savedAt < ttlMs ? disk.value : null;
}
