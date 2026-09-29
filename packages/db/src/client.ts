/**
 * Lazy Postgres client (postgres-js + Drizzle).
 * Importing this module never opens a connection — the pool is created on the
 * first query. The web app runs on the in-memory store unless DATABASE_URL is
 * set; this client is the production path (Supabase / managed Postgres).
 */
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export const DEFAULT_DATABASE_URL = "postgresql://agrishield:agrishield_dev_password@localhost:5432/agrishield";

export type DrizzleDB = PostgresJsDatabase<typeof schema>;

const g = globalThis as unknown as { __agriSql?: postgres.Sql; __agriDb?: DrizzleDB };

export function getSql(url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL): postgres.Sql {
  if (!g.__agriSql) {
    g.__agriSql = postgres(url, {
      max: Number(process.env.DB_POOL_MAX ?? 10),
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {},
      // Supabase pooler (pgbouncer transaction mode) does not support prepared statements
      prepare: !/pooler\.supabase\.com|:6543\//.test(url),
    });
  }
  return g.__agriSql;
}

export function getDb(): DrizzleDB {
  if (!g.__agriDb) g.__agriDb = drizzle(getSql(), { schema });
  return g.__agriDb;
}

/** Proxy so `db.select()…` works without eagerly connecting at import time. */
export const db: DrizzleDB = new Proxy({} as DrizzleDB, {
  get(_t, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const v = real[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(real) : v;
  },
});

export async function closeDb(): Promise<void> {
  await g.__agriSql?.end({ timeout: 5 });
  g.__agriSql = undefined;
  g.__agriDb = undefined;
}

export const isDatabaseConfigured = () => !!process.env.DATABASE_URL;
