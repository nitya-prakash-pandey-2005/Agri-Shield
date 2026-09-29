/** Shared types for the persistence layer (see ./index.ts). */

export type PersistMode = "off" | "file" | "postgres";

/** One stored store snapshot: `data` is the superjson document exactly as written. */
export interface StoredSnapshot {
  version: number;
  savedAt: Date;
  data: string;
}

export interface PersistDriver {
  kind: Exclude<PersistMode, "off">;
  /** Human-readable target (directory, or table @ host/db with credentials removed). */
  location: string;
  /** Synchronous read — file driver only (lets stores hydrate lazily without a boot step). */
  readSync?(key: string): StoredSnapshot | null;
  /** Every stored snapshot — used by the Postgres driver at boot. */
  loadAll(): Promise<Map<string, StoredSnapshot>>;
  write(key: string, snap: StoredSnapshot): Promise<void>;
  /** Synchronous write for the process `exit` hook — file driver only. */
  writeSync?(key: string, snap: StoredSnapshot): void;
  remove(key: string): Promise<void>;
  /** Move an unreadable snapshot aside so it is not overwritten (file driver). */
  quarantine?(key: string): string | null;
}
