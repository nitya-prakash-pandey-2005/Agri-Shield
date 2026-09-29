/**
 * Postgres persistence driver: one row per store in `app_state`
 * (packages/db/drizzle/0002_app_state.sql). The table is also created on
 * demand so a deployment works before migrations have been run — keep this
 * DDL identical to the migration / packages/db/src/schema.ts `appState`.
 */
import type { PersistDriver, StoredSnapshot } from "./types";

const DDL = `CREATE TABLE IF NOT EXISTS "app_state" (
  "key" varchar(128) PRIMARY KEY NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "value" text NOT NULL,
  "bytes" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
)`;

/** host/db of a connection string, credentials stripped. */
export function describeDatabaseUrl(url: string | undefined): string {
  if (!url) return "postgres";
  try {
    const u = new URL(url);
    return `postgres ${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
  } catch {
    return "postgres";
  }
}

export async function createPgDriver(): Promise<PersistDriver> {
  const { getSql } = await import("@agri-shield/db/client");
  const sql = getSql();
  await sql.unsafe(DDL);
  return {
    kind: "postgres",
    location: `app_state @ ${describeDatabaseUrl(process.env.DATABASE_URL)}`,
    async loadAll() {
      const rows = await sql<{ key: string; version: number; value: string; updated_at: Date }[]>`
        SELECT key, version, value, updated_at FROM app_state`;
      const out = new Map<string, StoredSnapshot>();
      for (const r of rows) out.set(r.key, { version: Number(r.version), savedAt: new Date(r.updated_at), data: r.value });
      return out;
    },
    async write(key, snap) {
      await sql`
        INSERT INTO app_state (key, version, value, bytes, updated_at)
        VALUES (${key}, ${snap.version}, ${snap.data}, ${Buffer.byteLength(snap.data)}, ${snap.savedAt})
        ON CONFLICT (key) DO UPDATE
          SET version = EXCLUDED.version, value = EXCLUDED.value, bytes = EXCLUDED.bytes, updated_at = EXCLUDED.updated_at`;
    },
    async remove(key) {
      await sql`DELETE FROM app_state WHERE key = ${key}`;
    },
  };
}
