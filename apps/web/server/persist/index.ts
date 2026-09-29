/**
 * Durable persistence for the in-process stores.
 *
 * Every business store lives on `globalThis` and is created lazily
 * (`g.__x ??= seed()`). This module lets each store:
 *   1. hydrate from its last snapshot in that initializer —
 *      `g.__x ??= restore<X>("key", VERSION) ?? seed()` — and
 *   2. register a getter with `track("key", VERSION, () => g.__x)` so the
 *      flusher can save it.
 *
 * Drivers: Postgres (`app_state` table) when DATABASE_URL is set, otherwise a
 * local directory (AGRI_DATA_DIR, default `<cwd>/.data`). AGRI_PERSIST=off
 * disables persistence; it is also off under vitest unless a test opts in
 * via `configurePersistence()` or AGRI_PERSIST=file|postgres|on.
 *
 * Hydration is synchronous from the stores' point of view. The file driver
 * reads a key's file on first use; the Postgres driver loads every row in
 * `bootPersistence()`, which instrumentation.ts awaits before anything else
 * touches a store. A key restored before that load completes is marked
 * `blocked` and never written, so a seeded store cannot overwrite real data.
 *
 * Saving: stores are mutated in place all over the codebase, so a periodic
 * flush (AGRI_PERSIST_INTERVAL_MS, default 10 s) serializes each tracked store
 * with superjson, hashes it and writes only when the hash changed. Large,
 * rarely-changing stores can opt into `explicit` mode and call `markDirty()`
 * instead. A final flush runs on SIGINT/SIGTERM/beforeExit, and synchronously
 * on `exit` for the file driver (Postgres is best-effort on shutdown: at most
 * one interval of changes can be lost).
 *
 * Every snapshot carries its store's schema VERSION: a mismatch, an unreadable
 * file or a failed shape check falls back to the store's seed (the bad file is
 * moved aside as `<key>.corrupt-<ts>.json`), and the fresh state is saved on
 * the next flush.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import superjson from "superjson";
import { cleanStaleTempFiles, createFileDriver } from "./file-driver";
import type { PersistDriver, PersistMode, StoredSnapshot } from "./types";

export type { PersistMode, StoredSnapshot, PersistDriver } from "./types";

interface Slot {
  key: string;
  version: number | null;
  get: (() => unknown) | null;
  explicit: boolean;
  /** Hash of what storage currently holds (loaded or last written). */
  lastHash: string | null;
  dirty: boolean;
  restored: boolean;
  /** Why a stored snapshot was not used (version mismatch, corrupt, …). */
  fallback: string | null;
  /** Never write: the store initialised before its snapshot could be loaded. */
  blocked: boolean;
  bytes: number;
  savedAt: Date | null;
  error: string | null;
}

interface PersistState {
  mode: PersistMode;
  reason: string;
  dir: string | null;
  /** Directory used if Postgres is unreachable at boot (auto mode). */
  fallbackDir: string | null;
  intervalMs: number;
  debounceMs: number;
  driver: PersistDriver | null;
  /** Postgres: every row, loaded at boot (null until then). */
  preloaded: Map<string, StoredSnapshot> | null;
  slots: Map<string, Slot>;
  booted: boolean;
  booting: Promise<void> | null;
  timer: ReturnType<typeof setInterval> | null;
  debounce: ReturnType<typeof setTimeout> | null;
  flushing: Promise<FlushResult> | null;
  lastFlushAt: Date | null;
  lastFlushMs: number | null;
  lastError: string | null;
  writes: number;
  warned: Set<string>;
}

export interface FlushResult {
  written: string[];
  failed: string[];
}

export interface PersistOptions {
  mode?: PersistMode;
  dir?: string;
  intervalMs?: number;
  debounceMs?: number;
}

const g = globalThis as unknown as { __agriPersist?: PersistState; __agriPersistHooked?: boolean };

const OFF_WORDS = new Set(["off", "false", "0", "no", "none", "disabled"]);
const ON_WORDS = new Set(["on", "true", "1", "yes"]);

/** Resolve the mode from the environment (pure — exported for tests). */
export function resolvePersistConfig(env: Record<string, string | undefined> = process.env): { mode: PersistMode; reason: string; dir: string; intervalMs: number } {
  const raw = (env.AGRI_PERSIST ?? "auto").trim().toLowerCase();
  const dir = env.AGRI_DATA_DIR?.trim() || join(process.cwd(), ".data");
  const iv = Number(env.AGRI_PERSIST_INTERVAL_MS);
  const intervalMs = Number.isFinite(iv) && iv > 0 ? Math.min(Math.max(iv, 1000), 600_000) : 10_000;
  const base = { dir, intervalMs };
  if (OFF_WORDS.has(raw)) return { ...base, mode: "off", reason: "AGRI_PERSIST=off" };
  if (env.NEXT_PHASE === "phase-production-build") return { ...base, mode: "off", reason: "next build" };
  const explicit = raw === "file" || raw === "postgres" || ON_WORDS.has(raw);
  if (env.VITEST && !explicit) return { ...base, mode: "off", reason: "disabled under vitest" };
  if (raw === "file") return { ...base, mode: "file", reason: "AGRI_PERSIST=file" };
  if (env.DATABASE_URL) return { ...base, mode: "postgres", reason: "DATABASE_URL is set" };
  return { ...base, mode: "file", reason: raw === "postgres" ? "AGRI_PERSIST=postgres but DATABASE_URL is not set" : "no DATABASE_URL" };
}

function freshState(opts: PersistOptions = {}): PersistState {
  const env = resolvePersistConfig();
  const mode = opts.mode ?? env.mode;
  const dir = opts.dir ?? env.dir;
  return {
    mode,
    reason: opts.mode ? "configured" : env.reason,
    dir: mode === "file" ? dir : null,
    fallbackDir: dir,
    intervalMs: opts.intervalMs ?? env.intervalMs,
    debounceMs: opts.debounceMs ?? 1500,
    driver: mode === "file" ? createFileDriver(dir) : null,
    preloaded: null,
    slots: new Map(),
    booted: false,
    booting: null,
    timer: null,
    debounce: null,
    flushing: null,
    lastFlushAt: null,
    lastFlushMs: null,
    lastError: null,
    writes: 0,
    warned: new Set(),
  };
}

const st = (): PersistState => (g.__agriPersist ??= freshState());

function stopTimers(s: PersistState) {
  if (s.timer) clearInterval(s.timer);
  if (s.debounce) clearTimeout(s.debounce);
  s.timer = null;
  s.debounce = null;
}

/**
 * (Re)configure persistence — used by tests to opt in with a temp directory,
 * or to reset to the environment's configuration when called with no options.
 * Tracked stores stay registered; restore/save bookkeeping starts over (as
 * after a process restart).
 */
export function configurePersistence(opts: PersistOptions = {}) {
  const prev = g.__agriPersist;
  if (prev) stopTimers(prev);
  const next = freshState(opts);
  for (const old of prev?.slots.values() ?? []) {
    if (!old.get || old.version == null) continue;
    const slot = slotOf(next, old.key);
    slot.version = old.version;
    slot.get = old.get;
    slot.explicit = old.explicit;
  }
  g.__agriPersist = next;
  return persistenceStatus();
}

export const persistenceMode = (): PersistMode => st().mode;
export const persistenceEnabled = () => st().mode !== "off";

const hashOf = (data: string) => createHash("sha1").update(data).digest("hex");
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function warnOnce(s: PersistState, id: string, msg: string) {
  if (s.warned.has(id)) return;
  s.warned.add(id);
  console.warn(`[persist] ${msg}`);
}

function slotOf(s: PersistState, key: string): Slot {
  let slot = s.slots.get(key);
  if (!slot) {
    slot = { key, version: null, get: null, explicit: false, lastHash: null, dirty: false, restored: false, fallback: null, blocked: false, bytes: 0, savedAt: null, error: null };
    s.slots.set(key, slot);
  }
  return slot;
}

/**
 * Last saved state for `key`, or undefined (persistence off, nothing saved,
 * version mismatch, unreadable, or `validate` rejected it) — the caller then
 * seeds as usual. Call it once, from the store's lazy initializer.
 */
export function restore<T>(key: string, version: number, validate?: (value: unknown) => boolean): T | undefined {
  const s = st();
  if (s.mode === "off") return undefined;
  const slot = slotOf(s, key);
  let snap: StoredSnapshot | null;
  try {
    if (s.mode === "postgres") {
      if (!s.preloaded) {
        slot.blocked = true;
        slot.fallback = "initialised before the Postgres snapshot was loaded — not saved this run";
        // Only a race with an in-flight boot is a bug; processes that never boot (the standalone
        // worker, scripts) simply run on seeded in-memory state and never write.
        if (s.booting) warnOnce(s, `blocked:${key}`, `store "${key}" initialised before bootPersistence() finished; it will not be saved this run`);
        return undefined;
      }
      snap = s.preloaded.get(key) ?? null;
    } else {
      snap = s.driver?.readSync?.(key) ?? null;
    }
  } catch (e) {
    const moved = s.driver?.quarantine?.(key);
    slot.fallback = `unreadable snapshot (${errMsg(e)}) — re-seeded${moved ? `; moved to ${moved}` : ""}`;
    console.warn(`[persist] ${key}: ${slot.fallback}`);
    return undefined;
  }
  if (!snap) return undefined;
  slot.bytes = Buffer.byteLength(snap.data);
  slot.savedAt = snap.savedAt;
  slot.lastHash = hashOf(snap.data);
  if (snap.version !== version) {
    slot.fallback = `stored version ${snap.version} ≠ current ${version} — re-seeded`;
    console.warn(`[persist] ${key}: ${slot.fallback}`);
    return undefined;
  }
  try {
    const value = superjson.parse<T>(snap.data);
    if (value == null || (validate && !validate(value))) throw new Error("failed shape check");
    slot.restored = true;
    slot.fallback = null;
    return value;
  } catch (e) {
    const moved = s.driver?.quarantine?.(key);
    slot.fallback = `corrupt snapshot (${errMsg(e)}) — re-seeded${moved ? `; moved to ${moved}` : ""}`;
    console.warn(`[persist] ${key}: ${slot.fallback}`);
    return undefined;
  }
}

const kindOf = (v: unknown) => (v instanceof Map ? "map" : v instanceof Set ? "set" : v instanceof Date ? "date" : Array.isArray(v) ? "array" : v === null ? "null" : typeof v);

/**
 * `restore()` for object-shaped state: copies the snapshot's fields over
 * `fresh` (optionally only `only`), skipping fields whose kind changed (Map vs
 * array, …) — so a field added to the store later keeps its default.
 */
export function restoreInto<T extends object>(key: string, version: number, fresh: T, only?: readonly (keyof T)[]): T {
  const saved = restore<Record<string, unknown>>(key, version, (v) => kindOf(v) === "object");
  if (!saved) return fresh;
  const target = fresh as Record<string, unknown>;
  for (const k of Object.keys(target)) {
    if (only && !only.includes(k as keyof T)) continue;
    const v = saved[k];
    if (v === undefined) continue;
    const want = kindOf(target[k]);
    if (want !== "null" && want !== "undefined" && kindOf(v) !== want && kindOf(v) !== "null") continue;
    target[k] = v;
  }
  return fresh;
}

/** Shallow copy without `keys` — for tracking a store minus its runtime-only fields. */
export function omitKeys<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Omit<T, K> {
  const out = { ...obj };
  for (const k of keys) delete out[k];
  return out;
}

/**
 * Register a store for saving. `get` returns the value to persist (or
 * undefined while the store has not been created in this process — its
 * previous snapshot is then left untouched). With `explicit`, the store is
 * only serialized after `markDirty(key)` (for large, rarely-changing stores).
 */
export function track(key: string, version: number, get: () => unknown, opts: { explicit?: boolean } = {}) {
  const slot = slotOf(st(), key);
  slot.version = version;
  slot.get = get;
  slot.explicit = !!opts.explicit;
}

/**
 * Persist a `globalThis` slot owned by a module that initialises it as
 * `g[name] ??= <empty>`: hydrate the slot (if still unset) and track it.
 * Must run after `bootPersistence()` and before the owning module is imported.
 */
export function adoptGlobal(key: string, version: number, name: string, validate?: (value: unknown) => boolean) {
  const slots = globalThis as unknown as Record<string, unknown>;
  track(key, version, () => slots[name]);
  if (slots[name] === undefined) {
    const saved = restore(key, version, validate);
    if (saved !== undefined) slots[name] = saved;
  }
}

/** Stop saving a store (its snapshot is kept). */
export function untrack(key: string) {
  st().slots.delete(key);
}

/** Flag a store as changed and schedule a debounced flush. */
export function markDirty(key: string) {
  const s = st();
  if (s.mode === "off") return;
  slotOf(s, key).dirty = true;
  requestFlush();
}

/** Debounced flush of every store (no-op until `bootPersistence()` ran). */
export function requestFlush() {
  const s = st();
  if (s.mode === "off" || !s.booted || s.debounce) return;
  s.debounce = setTimeout(() => {
    s.debounce = null;
    void flushPersistence().catch(() => {});
  }, s.debounceMs);
  s.debounce.unref?.();
}

interface Job {
  slot: Slot;
  snap: StoredSnapshot;
  hash: string;
}

/** Serialize a slot if it changed since the last save. */
function prepare(slot: Slot, now: Date): Job | null {
  if (!slot.get || slot.version == null || slot.blocked) return null;
  if (slot.explicit && !slot.dirty && slot.lastHash !== null) return null;
  const value = slot.get();
  if (value === undefined) return null;
  let data: string;
  try {
    data = superjson.stringify(value);
  } catch (e) {
    slot.error = `serialize failed: ${errMsg(e)}`;
    return null;
  }
  slot.dirty = false;
  const hash = hashOf(data);
  if (hash === slot.lastHash) return null;
  return { slot, snap: { version: slot.version, savedAt: now, data }, hash };
}

function commit(s: PersistState, job: Job) {
  job.slot.lastHash = job.hash;
  job.slot.bytes = Buffer.byteLength(job.snap.data);
  job.slot.savedAt = job.snap.savedAt;
  job.slot.error = null;
  s.writes++;
}

function fail(s: PersistState, job: Job, e: unknown) {
  job.slot.error = errMsg(e);
  if (job.slot.explicit) job.slot.dirty = true;
  s.lastError = `${job.slot.key}: ${errMsg(e)}`;
  warnOnce(s, `write:${job.slot.key}:${errMsg(e)}`, `saving "${job.slot.key}" failed: ${errMsg(e)}`);
}

/** Save every changed store now. Concurrent calls share one in-flight flush. */
export function flushPersistence(): Promise<FlushResult> {
  const s = st();
  const driver = s.driver;
  if (s.mode === "off" || !driver) return Promise.resolve({ written: [], failed: [] });
  if (s.flushing) return s.flushing;
  const run = async (): Promise<FlushResult> => {
    const t0 = Date.now();
    const now = new Date();
    const res: FlushResult = { written: [], failed: [] };
    for (const slot of s.slots.values()) {
      const job = prepare(slot, now);
      if (!job) continue;
      try {
        await driver.write(slot.key, job.snap);
        commit(s, job);
        res.written.push(slot.key);
      } catch (e) {
        fail(s, job, e);
        res.failed.push(slot.key);
      }
    }
    s.lastFlushAt = now;
    s.lastFlushMs = Date.now() - t0;
    if (!res.failed.length) s.lastError = null;
    return res;
  };
  const p = run().finally(() => {
    if (s.flushing === p) s.flushing = null;
  });
  s.flushing = p;
  return p;
}

/** Synchronous flush for the `exit` hook — file driver only (Postgres cannot block). */
export function flushPersistenceSync(): FlushResult {
  const s = st();
  const res: FlushResult = { written: [], failed: [] };
  const writeSync = s.driver?.writeSync;
  if (s.mode === "off" || !writeSync) return res;
  const now = new Date();
  for (const slot of s.slots.values()) {
    const job = prepare(slot, now);
    if (!job) continue;
    try {
      writeSync(slot.key, job.snap);
      commit(s, job);
      res.written.push(slot.key);
    } catch (e) {
      fail(s, job, e);
      res.failed.push(slot.key);
    }
  }
  s.lastFlushAt = now;
  return res;
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    t.unref?.();
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e: unknown) => (clearTimeout(t), reject(e))
    );
  });
}

function hookProcessExit() {
  if (g.__agriPersistHooked) return;
  g.__agriPersistHooked = true;
  process.on("exit", () => {
    try {
      flushPersistenceSync();
    } catch {
      /* exiting anyway */
    }
  });
  process.once("beforeExit", () => void flushPersistence().catch(() => {}));
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      // Someone else (Next.js) handles this signal → just save; otherwise exit ourselves afterwards.
      const others = process.listenerCount(sig) > 0;
      const done = () => {
        if (!others) process.exit(sig === "SIGINT" ? 130 : 143);
      };
      try {
        flushPersistenceSync();
      } catch {
        /* best effort */
      }
      if (st().mode === "postgres") void withTimeout(flushPersistence(), 4000, "final flush").catch(() => {}).finally(done);
      else done();
    });
  }
}

/**
 * Start persistence for this server process: load Postgres snapshots (so the
 * stores can hydrate synchronously), start the periodic flush and hook process
 * exit. Idempotent. Await it before anything touches a store.
 */
export async function bootPersistence(): Promise<PersistenceStatus> {
  const s = st();
  if (s.mode === "off" || s.booted) return persistenceStatus();
  if (!s.booting) {
    s.booting = (async () => {
      if (s.mode === "postgres") {
        try {
          const { createPgDriver } = await import("./pg-driver");
          const driver = await withTimeout(createPgDriver(), 15_000, "postgres connect");
          s.preloaded = await withTimeout(driver.loadAll(), 30_000, "loading app_state");
          s.driver = driver;
        } catch (e) {
          // Never seed-and-save over rows we could not read. With AGRI_PERSIST=postgres stay
          // in memory; in auto mode fall back to the local directory so a demo box that
          // copied .env.example without running Postgres still keeps its data.
          s.lastError = errMsg(e);
          const strict = (process.env.AGRI_PERSIST ?? "").trim().toLowerCase() === "postgres";
          if (strict || !s.fallbackDir) {
            s.mode = "off";
            s.reason = `postgres unavailable at boot (${errMsg(e)}) — running in memory`;
            console.error(`[persist] ${s.reason}`);
            return;
          }
          s.mode = "file";
          s.dir = s.fallbackDir;
          s.driver = createFileDriver(s.fallbackDir);
          s.preloaded = null;
          s.reason = `postgres unavailable at boot (${errMsg(e)}) — using ${s.fallbackDir}`;
          console.warn(`[persist] ${s.reason}`);
        }
      } else if (s.dir) {
        cleanStaleTempFiles(s.dir);
      }
      s.timer = setInterval(() => void flushPersistence().catch(() => {}), s.intervalMs);
      s.timer.unref?.();
      hookProcessExit();
      s.booted = true;
      const restoredKeys = s.preloaded ? s.preloaded.size : null;
      console.log(`[persist] ${s.mode} persistence on (${s.driver?.location ?? s.dir})${restoredKeys != null ? `, ${restoredKeys} snapshot(s) loaded` : ""}; flush every ${Math.round(s.intervalMs / 1000)} s`);
    })();
  }
  await s.booting;
  return persistenceStatus();
}

export interface PersistenceStatus {
  enabled: boolean;
  driver: PersistMode;
  reason: string;
  location: string | null;
  booted: boolean;
  intervalMs: number;
  lastSaveAt: Date | null;
  lastFlushMs: number | null;
  lastError: string | null;
  writes: number;
  totalBytes: number;
  keys: { key: string; version: number | null; bytes: number; savedAt: Date | null; restored: boolean; tracked: boolean; fallback: string | null; error: string | null }[];
}

/** Compact form for the public health endpoint (no paths or hosts). */
export function persistenceSummary() {
  const s = persistenceStatus();
  return {
    driver: s.driver,
    enabled: s.enabled,
    reason: s.enabled ? undefined : s.reason,
    lastSaveAt: s.lastSaveAt,
    intervalSec: Math.round(s.intervalMs / 1000),
    keys: s.keys.filter((k) => k.tracked).length,
    restored: s.keys.filter((k) => k.restored).length,
    bytes: s.totalBytes,
    fallbacks: s.keys.filter((k) => k.fallback).map((k) => k.key),
    lastError: s.lastError,
  };
}

export function persistenceStatus(): PersistenceStatus {
  const s = st();
  const keys = [...s.slots.values()]
    .map((x) => ({ key: x.key, version: x.version, bytes: x.bytes, savedAt: x.savedAt, restored: x.restored, tracked: !!x.get, fallback: x.fallback, error: x.error }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return {
    enabled: s.mode !== "off",
    driver: s.mode,
    reason: s.reason,
    location: s.driver?.location ?? null,
    booted: s.booted,
    intervalMs: s.intervalMs,
    lastSaveAt: keys.reduce<Date | null>((m, k) => (k.savedAt && (!m || k.savedAt > m) ? k.savedAt : m), null),
    lastFlushMs: s.lastFlushMs,
    lastError: s.lastError,
    writes: s.writes,
    totalBytes: keys.reduce((n, k) => n + k.bytes, 0),
    keys,
  };
}
