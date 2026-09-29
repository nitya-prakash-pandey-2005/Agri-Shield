/**
 * File persistence driver: one `<key>.json` per store in a data directory.
 *
 * File format: a one-line JSON header, a newline, then the superjson document
 * verbatim (superjson output never contains a raw newline). Writes go to a
 * temp file in the same directory and are renamed over the target, so a crash
 * mid-write leaves either the old or the new snapshot — never a torn file.
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PersistDriver, StoredSnapshot } from "./types";

const FORMAT = "agri-shield-state";
const KEY_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

interface Header {
  format: string;
  key: string;
  version: number;
  savedAt: string;
}

/** Synchronous short pause (used only between rename retries). */
function pause(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** rename() can fail transiently on Windows while a scanner/indexer holds the target open. */
function renameWithRetry(from: string, to: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt >= 5 || !(code === "EPERM" || code === "EACCES" || code === "EBUSY")) throw e;
      pause(15 * (attempt + 1));
    }
  }
}

export function encodeSnapshot(key: string, snap: StoredSnapshot): string {
  const header: Header = { format: FORMAT, key, version: snap.version, savedAt: snap.savedAt.toISOString() };
  return `${JSON.stringify(header)}\n${snap.data}`;
}

export function decodeSnapshot(raw: string): StoredSnapshot {
  const nl = raw.indexOf("\n");
  if (nl < 0) throw new Error("missing header");
  const header = JSON.parse(raw.slice(0, nl)) as Partial<Header>;
  if (header.format !== FORMAT || typeof header.version !== "number" || typeof header.savedAt !== "string") throw new Error("bad header");
  return { version: header.version, savedAt: new Date(header.savedAt), data: raw.slice(nl + 1) };
}

export function createFileDriver(dir: string): PersistDriver {
  const fileFor = (key: string) => {
    if (!KEY_RE.test(key)) throw new Error(`invalid persistence key "${key}"`);
    return join(dir, `${key}.json`);
  };
  let tmpSeq = 0;

  const writeSync = (key: string, snap: StoredSnapshot) => {
    const file = fileFor(key);
    mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.${(tmpSeq++).toString(36)}.tmp`;
    try {
      writeFileSync(tmp, encodeSnapshot(key, snap), "utf8");
      renameWithRetry(tmp, file);
    } catch (e) {
      try {
        unlinkSync(tmp);
      } catch {
        /* already gone */
      }
      throw e;
    }
  };

  const readSync = (key: string): StoredSnapshot | null => {
    let raw: string;
    try {
      raw = readFileSync(fileFor(key), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
    return decodeSnapshot(raw);
  };

  return {
    kind: "file",
    location: dir,
    readSync,
    writeSync,
    async loadAll() {
      const out = new Map<string, StoredSnapshot>();
      let names: string[] = [];
      try {
        names = readdirSync(dir);
      } catch {
        return out;
      }
      for (const n of names) {
        if (!n.endsWith(".json") || n.includes(".corrupt-")) continue;
        const key = n.slice(0, -5);
        try {
          const s = readSync(key);
          if (s) out.set(key, s);
        } catch {
          /* unreadable: reported when the owning store restores it */
        }
      }
      return out;
    },
    async write(key, snap) {
      writeSync(key, snap);
    },
    async remove(key) {
      try {
        unlinkSync(fileFor(key));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    },
    quarantine(key) {
      const file = fileFor(key);
      const dest = join(dir, `${key}.corrupt-${Date.now()}.json`);
      try {
        renameWithRetry(file, dest);
        return dest;
      } catch {
        return null;
      }
    },
  };
}

/** Remove temp files (older than a minute) left behind by a process that died mid-write. */
export function cleanStaleTempFiles(dir: string, olderThanMs = 60_000) {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return; // no directory yet
  }
  for (const n of names) {
    if (!n.endsWith(".tmp")) continue;
    try {
      const p = join(dir, n);
      if (Date.now() - statSync(p).mtimeMs > olderThanMs) unlinkSync(p);
    } catch {
      /* raced with its writer */
    }
  }
}
