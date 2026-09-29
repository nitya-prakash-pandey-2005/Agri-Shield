/**
 * drizzle-kit config — `pnpm db:generate` / `pnpm db:migrate`.
 * Author: Nitya Prakash Pandey
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://agrishield:agrishield_dev_password@localhost:5432/agrishield",
  },
  // PostGIS owns spatial_ref_sys & friends — never diff/drop them
  extensionsFilters: ["postgis"],
  schemaFilter: ["public"],
  migrations: { table: "__drizzle_migrations", schema: "public" },
  strict: true,
  verbose: true,
});
