/**
 * Persistence layer (server/persist): config resolution, file driver
 * round-trip (Dates / Maps / Sets), change detection, version-mismatch and
 * corrupt-snapshot fallback, atomic writes, and an end-to-end restart of the
 * core store.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanStaleTempFiles, createFileDriver, decodeSnapshot, encodeSnapshot } from "@/server/persist/file-driver";
import {
  configurePersistence,
  flushPersistence,
  flushPersistenceSync,
  markDirty,
  persistenceMode,
  persistenceStatus,
  resolvePersistConfig,
  restore,
  restoreInto,
  track,
  untrack,
} from "@/server/persist";

// router modules import the NextAuth handler; its runtime is not needed here
vi.mock("@/auth", () => ({ auth: async () => null, signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "agri-persist-"));
  dirs.push(d);
  return d;
};

afterEach(() => {
  for (const k of persistenceStatus().keys) if (k.key.startsWith("t.")) untrack(k.key);
  configurePersistence({ mode: "off" });
});
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("configuration", () => {
  it("is off under vitest by default", () => {
    configurePersistence(); // back to the environment's configuration
    expect(process.env.VITEST).toBeTruthy();
    expect(persistenceMode()).toBe("off");
    expect(restore("anything", 1)).toBeUndefined();
    expect(persistenceStatus().reason).toMatch(/vitest/);
  });

  it("resolves the driver from the environment", () => {
    const base = { VITEST: "true" };
    expect(resolvePersistConfig(base).mode).toBe("off");
    expect(resolvePersistConfig({ ...base, AGRI_PERSIST: "file" }).mode).toBe("file");
    expect(resolvePersistConfig({ ...base, AGRI_PERSIST: "on", DATABASE_URL: "postgres://x@h/db" }).mode).toBe("postgres");
    expect(resolvePersistConfig({ DATABASE_URL: "postgres://x@h/db" }).mode).toBe("postgres");
    expect(resolvePersistConfig({}).mode).toBe("file");
    expect(resolvePersistConfig({ AGRI_PERSIST: "off", DATABASE_URL: "postgres://x@h/db" }).mode).toBe("off");
    expect(resolvePersistConfig({ NEXT_PHASE: "phase-production-build" }).mode).toBe("off");
    expect(resolvePersistConfig({ AGRI_DATA_DIR: "/srv/agri" }).dir).toBe("/srv/agri");
    expect(resolvePersistConfig({}).dir).toBe(join(process.cwd(), ".data"));
    expect(resolvePersistConfig({ AGRI_PERSIST_INTERVAL_MS: "50" }).intervalMs).toBe(1000);
  });
});

describe("file driver", () => {
  let dir: string;
  beforeEach(() => {
    dir = tempDir();
  });

  it("round-trips Dates, Maps and Sets across a restart", async () => {
    const at = new Date("2026-07-01T06:30:00.000Z");
    const g = { value: { at, byId: new Map([["a", { n: 1, seen: new Set(["x", "y"]) }]]), list: [1, 2, 3] } };
    configurePersistence({ mode: "file", dir });
    track("t.roundtrip", 1, () => g.value);
    const res = await flushPersistence();
    expect(res.written).toEqual(["t.roundtrip"]);
    expect(existsSync(join(dir, "t.roundtrip.json"))).toBe(true);

    configurePersistence({ mode: "file", dir }); // simulated restart
    const back = restore<typeof g.value>("t.roundtrip", 1);
    expect(back).toBeDefined();
    expect(back!.at).toBeInstanceOf(Date);
    expect(back!.at.getTime()).toBe(at.getTime());
    expect(back!.byId).toBeInstanceOf(Map);
    expect(back!.byId.get("a")!.seen).toBeInstanceOf(Set);
    expect([...back!.byId.get("a")!.seen]).toEqual(["x", "y"]);
    expect(back!.list).toEqual([1, 2, 3]);
    expect(persistenceStatus().keys.find((k) => k.key === "t.roundtrip")?.restored).toBe(true);
  });

  it("writes only when the serialized state changed", async () => {
    const state = { n: 1 };
    configurePersistence({ mode: "file", dir });
    track("t.changes", 1, () => state);
    expect((await flushPersistence()).written).toEqual(["t.changes"]);
    expect((await flushPersistence()).written).toEqual([]);
    state.n = 2;
    expect((await flushPersistence()).written).toEqual(["t.changes"]);

    // after a restart, restoring the same content does not trigger a rewrite
    configurePersistence({ mode: "file", dir });
    const back = restore<{ n: number }>("t.changes", 1)!;
    track("t.changes", 1, () => back);
    expect((await flushPersistence()).written).toEqual([]);
  });

  it("leaves a store's snapshot alone when the store was never created this run", async () => {
    let state: { v: number } | undefined = { v: 7 };
    configurePersistence({ mode: "file", dir });
    track("t.untouched", 1, () => state);
    await flushPersistence();
    configurePersistence({ mode: "file", dir });
    state = undefined;
    expect((await flushPersistence()).written).toEqual([]);
    expect(restore<{ v: number }>("t.untouched", 1)).toEqual({ v: 7 });
  });

  it("falls back to the seed on a version mismatch, then saves the new version", async () => {
    let state = { shape: "old" };
    configurePersistence({ mode: "file", dir });
    track("t.version", 1, () => state);
    await flushPersistence();

    configurePersistence({ mode: "file", dir });
    const restored = restore<{ shape: string }>("t.version", 2);
    expect(restored).toBeUndefined();
    expect(persistenceStatus().keys.find((k) => k.key === "t.version")?.fallback).toMatch(/version 1/);
    state = { shape: "new" };
    track("t.version", 2, () => state);
    expect((await flushPersistence()).written).toEqual(["t.version"]);

    configurePersistence({ mode: "file", dir });
    expect(restore<{ shape: string }>("t.version", 2)).toEqual({ shape: "new" });
  });

  it("falls back to the seed when a shape check fails", async () => {
    const state = { items: "not-an-array" };
    configurePersistence({ mode: "file", dir });
    track("t.shape", 1, () => state);
    await flushPersistence();
    configurePersistence({ mode: "file", dir });
    expect(restore("t.shape", 1, (v) => Array.isArray((v as { items: unknown }).items))).toBeUndefined();
  });

  it("moves a corrupt snapshot aside and falls back to the seed", () => {
    writeFileSync(join(dir, "t.corrupt.json"), '{"format":"agri-shield-state","key":"t.corrupt","version":1,"savedAt":"2026-01-01T00:00:00Z"}\n{"json":{"a":1');
    writeFileSync(join(dir, "t.garbage.json"), "\u0000\u0001 not json at all");
    configurePersistence({ mode: "file", dir });
    expect(restore("t.corrupt", 1)).toBeUndefined();
    expect(restore("t.garbage", 1)).toBeUndefined();
    const st = persistenceStatus();
    expect(st.keys.find((k) => k.key === "t.corrupt")?.fallback).toMatch(/corrupt/);
    expect(st.keys.find((k) => k.key === "t.garbage")?.fallback).toMatch(/unreadable/);
    const names = readdirSync(dir);
    expect(names.some((n) => n.startsWith("t.corrupt.corrupt-"))).toBe(true);
    expect(names.some((n) => n.startsWith("t.garbage.corrupt-"))).toBe(true);
    expect(names).not.toContain("t.corrupt.json");
  });

  it("writes atomically: temp file + rename, no leftovers, old snapshot intact until replaced", () => {
    const drv = createFileDriver(dir);
    drv.writeSync!("t.atomic", { version: 1, savedAt: new Date(), data: '{"json":{"v":1}}' });
    // a crashed writer leaves only a temp file behind: the real snapshot is untouched
    writeFileSync(join(dir, "t.atomic.json.999.0.tmp"), "partial");
    expect(drv.readSync!("t.atomic")!.data).toBe('{"json":{"v":1}}');
    drv.writeSync!("t.atomic", { version: 1, savedAt: new Date(), data: '{"json":{"v":2}}' });
    expect(drv.readSync!("t.atomic")!.data).toBe('{"json":{"v":2}}');
    expect(readdirSync(dir).filter((n) => n.endsWith(".tmp") && !n.includes(".999."))).toEqual([]);
    // stale temp files are swept at boot
    const old = new Date(Date.now() - 5 * 60_000);
    utimesSync(join(dir, "t.atomic.json.999.0.tmp"), old, old);
    cleanStaleTempFiles(dir);
    expect(readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    // file format: one header line, then the superjson document verbatim
    const raw = readFileSync(join(dir, "t.atomic.json"), "utf8");
    expect(raw.split("\n")).toHaveLength(2);
    expect(decodeSnapshot(encodeSnapshot("k", { version: 3, savedAt: new Date(0), data: "{}" }))).toMatchObject({ version: 3, data: "{}" });
    expect(() => drv.readSync!("../escape")).toThrow(/invalid persistence key/);
  });

  it("explicit stores are only serialized after markDirty", async () => {
    const state = new Map([["r1", { views: 0 }]]);
    configurePersistence({ mode: "file", dir });
    track("t.explicit", 1, () => state, { explicit: true });
    expect((await flushPersistence()).written).toEqual(["t.explicit"]); // first save
    state.get("r1")!.views++;
    expect((await flushPersistence()).written).toEqual([]);
    markDirty("t.explicit");
    expect((await flushPersistence()).written).toEqual(["t.explicit"]);
  });

  it("flushes synchronously for the exit hook", () => {
    configurePersistence({ mode: "file", dir });
    track("t.sync", 1, () => ({ ok: true }));
    expect(flushPersistenceSync().written).toEqual(["t.sync"]);
    configurePersistence({ mode: "file", dir });
    expect(restore("t.sync", 1)).toEqual({ ok: true });
  });

  it("restoreInto keeps new defaults and skips fields whose kind changed", async () => {
    configurePersistence({ mode: "file", dir });
    const old = { a: [1], b: { legacy: true }, gone: 1 };
    track("t.merge", 1, () => old);
    await flushPersistence();
    configurePersistence({ mode: "file", dir });
    const merged = restoreInto("t.merge", 1, { a: [] as number[], b: new Map<string, number>(), added: "default" });
    expect(merged.a).toEqual([1]);
    expect(merged.b).toBeInstanceOf(Map); // was a plain object in the snapshot → default kept
    expect(merged.added).toBe("default");
    expect("gone" in merged).toBe(false);
  });
});

describe("postgres mode before boot", () => {
  it("never saves a store that initialised before snapshots were loaded", async () => {
    configurePersistence({ mode: "postgres" });
    expect(restore("t.pg", 1)).toBeUndefined();
    track("t.pg", 1, () => ({ seeded: true }));
    expect((await flushPersistence()).written).toEqual([]);
    expect(persistenceStatus().keys.find((k) => k.key === "t.pg")?.fallback).toMatch(/before the Postgres snapshot/);
  });
});

describe("core store survives a restart", () => {
  it("saves users and alerts, then re-hydrates them from the snapshot", async () => {
    const dir = tempDir();
    const { getStore, resetStore } = await import("@/server/data/store");
    const gs = globalThis as unknown as { __agriStore?: unknown };

    configurePersistence({ mode: "file", dir });
    resetStore();
    const s = getStore();
    const t0 = performance.now();
    const user = { ...s.users[0]!, id: "user-persist-test", name: "Persisted Person", email: "persisted@example.org", createdAt: new Date("2026-05-05T05:05:05Z") };
    s.users.push(user);
    const alert = { ...s.alerts[0]!, id: "alert-persist-test", title: "Persisted alert" };
    s.alerts.unshift(alert);
    const res = await flushPersistence();
    const ms = performance.now() - t0;
    expect(res.written).toContain("core");
    expect(ms).toBeLessThan(5000);
    expect(persistenceStatus().keys.find((k) => k.key === "core")!.bytes).toBeGreaterThan(10_000);

    // simulated restart: drop the in-memory store and the persistence bookkeeping
    gs.__agriStore = undefined;
    configurePersistence({ mode: "file", dir });
    const back = getStore();
    expect(back).not.toBe(s);
    const u = back.users.find((x) => x.id === "user-persist-test");
    expect(u?.name).toBe("Persisted Person");
    expect(u?.createdAt).toBeInstanceOf(Date);
    expect(u?.createdAt.toISOString()).toBe("2026-05-05T05:05:05.000Z");
    expect(back.alerts[0]!.id).toBe("alert-persist-test");
    expect(back.seededAt).toBeInstanceOf(Date);
    expect(back.seededAt.getTime()).toBe(s.seededAt.getTime());
    expect(persistenceStatus().keys.find((k) => k.key === "core")?.restored).toBe(true);

    // an unchanged restored store is not rewritten
    expect((await flushPersistence()).written).not.toContain("core");

    // farmer tools restored alongside keep their data (seededAt compared by time, not identity)
    const { farmTools } = await import("@/server/data/farmer-tools-store");
    const ft = farmTools();
    ft.questions.push({ ...ft.questions[0]!, id: "q-persist-test" });
    await flushPersistence();
    (globalThis as unknown as { __agriFarmTools?: unknown }).__agriFarmTools = undefined;
    gs.__agriStore = undefined;
    configurePersistence({ mode: "file", dir });
    expect(farmTools().questions.some((q) => q.id === "q-persist-test")).toBe(true);

    // clean up for any later test in this file
    configurePersistence({ mode: "off" });
    resetStore();
  });
});

describe("every persisted store serializes and restores", () => {
  it("round-trips the seeded state of each store without errors", async () => {
    const dir = tempDir();
    configurePersistence({ mode: "file", dir });
    const { getStore } = await import("@/server/data/store");
    const { wsState } = await import("@/server/services/workspace-state");
    const { devState } = await import("@/server/services/developer-platform");
    const { secState } = await import("@/server/auth/security-state");
    const { govState } = await import("@/server/data/gov-store");
    const { farmTools } = await import("@/server/data/farmer-tools-store");
    const { scState } = await import("@/server/data/sc-state");
    await import("@/server/services/portfolio");
    const { ensureSeeded } = await import("@/server/services/incidents");
    await import("@/server/services/collab");
    await import("@/server/services/iot-store");
    const { listDashboards } = await import("@/server/services/dashboards");
    const { listProducts } = await import("@/server/services/parametric");
    await import("@/server/services/claims");
    await import("@/server/services/usage");
    await import("@/server/services/explorer-reports");
    await import("@/server/routers/billing");
    await import("@/server/routers/admin");
    await import("@/server/routers/simulate");
    await import("@/server/sms/handler");
    await import("@/server/services/copilot");

    const org = getStore().orgs[0]!.id;
    wsState();
    devState();
    secState();
    govState();
    farmTools();
    scState();
    ensureSeeded();
    listDashboards(org);
    listProducts("org-ins-deltamutual");

    const res = await flushPersistence();
    const st = persistenceStatus();
    const tracked = st.keys.filter((k) => k.tracked && !k.key.startsWith("t."));
    expect(res.failed).toEqual([]);
    expect(tracked.filter((k) => k.error)).toEqual([]);
    for (const key of ["core", "workspace", "developer-platform", "security", "gov", "farmer-tools", "supply-chain", "portfolio", "incidents", "collab", "iot", "dashboards", "parametric", "billing", "admin.org-reviews", "simulate.library", "sms", "copilot.history", "usage", "explorer.reports"]) {
      expect(tracked.map((k) => k.key)).toContain(key);
    }
    for (const key of res.written) expect(existsSync(join(dir, `${key}.json`))).toBe(true);

    configurePersistence({ mode: "file", dir });
    for (const k of tracked) {
      if (!res.written.includes(k.key)) continue;
      expect(restore(k.key, k.version!), k.key).toBeDefined();
    }
    configurePersistence({ mode: "off" });
  });
});
