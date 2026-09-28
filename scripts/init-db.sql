-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- Note: TimescaleDB and pgvector are enabled via Supabase dashboard in cloud
-- For local dev, basic hypertable-like setup via partitioning is used
