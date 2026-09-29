-- Durable snapshots of the web app's in-process stores (apps/web/server/persist).
-- IF NOT EXISTS: the web app also creates this table on demand, so the
-- migration must be a no-op when the app got there first.
CREATE TABLE IF NOT EXISTS "app_state" (
	"key" varchar(128) PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"value" text NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
