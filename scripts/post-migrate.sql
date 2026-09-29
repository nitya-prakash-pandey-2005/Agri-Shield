-- ============================================================================
-- Agri-SHIELD — post-migration steps (run after `drizzle-kit migrate`).
-- Executed automatically by scripts/seed.ts; safe to run repeatedly.
-- Author: Nitya Prakash Pandey
-- ============================================================================

-- TimescaleDB: turn weather_readings into a hypertable (7-day chunks) with
-- compression after 30 days — only when the extension is installed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM create_hypertable('weather_readings', 'time',
      chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE, migrate_data => TRUE);
    BEGIN
      EXECUTE 'ALTER TABLE weather_readings SET (timescaledb.compress, timescaledb.compress_segmentby = ''station_id'')';
      PERFORM add_compression_policy('weather_readings', INTERVAL '30 days', if_not_exists => TRUE);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'compression policy skipped: %', SQLERRM;
    END;
    RAISE NOTICE 'weather_readings is a TimescaleDB hypertable';
  ELSE
    RAISE NOTICE 'timescaledb not installed — weather_readings remains a regular table (BRIN-friendly time index present)';
  END IF;
END
$$;

-- Keep planner statistics fresh for the spatial indexes after bulk loads.
ANALYZE government_regions;
ANALYZE farmer_profiles;
ANALYZE farm_fields;
ANALYZE weather_readings;
