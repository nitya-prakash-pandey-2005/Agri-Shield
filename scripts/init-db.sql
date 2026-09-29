-- ============================================================================
-- Agri-SHIELD — database bootstrap (runs once, before Drizzle migrations)
-- Author: Nitya Prakash Pandey
--
-- Local:    mounted into /docker-entrypoint-initdb.d by docker-compose
-- Manual:   psql "$DATABASE_URL" -f scripts/init-db.sql      (idempotent)
-- Supabase: extensions are enabled from the dashboard; the auth shim below
--           is skipped automatically because auth.uid() already exists.
--
-- Order:  init-db.sql → drizzle-kit migrate → scripts/rls-policies.sql
--         → scripts/seed.ts (which also runs the post-migrate hypertable step)
-- ============================================================================

-- ─── Required extensions ────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;      -- gen_random_uuid(), digest()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;       -- fuzzy search on names

-- ─── Optional extensions (enabled only when the image ships them) ──────────
-- TimescaleDB → weather_readings hypertable; pgvector → RAG embeddings.
-- The plain postgis/postgis image has neither; timescale/timescaledb-ha:pg16
-- (or Supabase) has both. Everything degrades gracefully without them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS timescaledb;
      RAISE NOTICE 'timescaledb enabled';
    EXCEPTION WHEN OTHERS THEN
      -- e.g. not in shared_preload_libraries
      RAISE NOTICE 'timescaledb available but could not be enabled: %', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'timescaledb not available — weather_readings stays a plain table';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    CREATE EXTENSION IF NOT EXISTS vector;
    RAISE NOTICE 'pgvector enabled';
  ELSE
    RAISE NOTICE 'pgvector not available — rag_documents.embedding falls back to float8[]';
  END IF;
END
$$;

-- ─── Supabase-compatible auth shim ─────────────────────────────────────────
-- On Supabase these objects already exist. On plain Postgres we recreate the
-- minimum surface the RLS policies need: roles `anon` / `authenticated` and
-- auth.uid() reading the JWT subject from a GUC, e.g.
--   SET LOCAL request.jwt.claim.sub = '<user uuid>';
--   SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS auth;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth' AND p.proname = 'uid'
  ) THEN
    EXECUTE $fn$
      CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
      AS $body$
        SELECT NULLIF(
          COALESCE(
            current_setting('request.jwt.claim.sub', true),
            (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
          ),
          ''
        )::uuid
      $body$
    $fn$;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Tables created later by migrations inherit these grants (RLS still applies).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
