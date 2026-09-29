-- ============================================================================
-- Agri-SHIELD — Row-Level Security policies (spec §11 + least privilege)
-- Author: Nitya Prakash Pandey
--
-- Apply after migrations:   pnpm db:rls
--   (or) psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/rls-policies.sql
-- Idempotent: every policy is dropped and re-created.
--
-- Identity comes from auth.uid() (Supabase, or the shim in init-db.sql which
-- reads `request.jwt.claim.sub`). The table owner / service_role bypass RLS,
-- which is what the seeder and trusted backend jobs use.
--
-- Try it locally:
--   BEGIN;
--   SET LOCAL ROLE authenticated;
--   SELECT set_config('request.jwt.claim.sub', '<users.id>', true);
--   SELECT count(*) FROM farm_fields;     -- only that farmer's fields
--   ROLLBACK;
-- ============================================================================

SET client_min_messages = warning;

-- ─── Helper functions (SECURITY DEFINER → no policy recursion) ─────────────

CREATE OR REPLACE FUNCTION public.app_is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth.uid() AND u.role = 'platform_admin' AND u.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.app_user_role() RETURNS user_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.role FROM users u WHERE u.id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.app_user_org_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT uo.org_id FROM user_organizations uo WHERE uo.user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.app_farmer_profile_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT fp.id FROM farmer_profiles fp WHERE fp.user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.app_user_status() RETURNS user_status
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.status FROM users u WHERE u.id = auth.uid();
$$;

/** Users sharing at least one organisation with the caller. */
CREATE OR REPLACE FUNCTION public.app_org_colleague_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT o.user_id FROM user_organizations o
  WHERE o.org_id IN (SELECT m.org_id FROM user_organizations m WHERE m.user_id = auth.uid());
$$;

/** Alerts that were delivered to the caller (breaks alerts <-> deliveries policy recursion). */
CREATE OR REPLACE FUNCTION public.app_my_alert_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT d.alert_id FROM alert_deliveries d WHERE d.user_id = auth.uid();
$$;

/** Government officer's jurisdiction: regions owned by their org(s). */
CREATE OR REPLACE FUNCTION public.app_gov_region_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT gr.id
  FROM government_regions gr
  JOIN user_organizations uo ON uo.org_id = gr.org_id
  JOIN users u ON u.id = uo.user_id
  WHERE uo.user_id = auth.uid()
    AND u.role IN ('field_officer', 'regional_admin', 'national_admin');
$$;

REVOKE ALL ON FUNCTION public.app_is_platform_admin(), public.app_user_role(), public.app_user_status(),
  public.app_user_org_ids(), public.app_org_colleague_ids(), public.app_my_alert_ids(),
  public.app_farmer_profile_id(), public.app_gov_region_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_is_platform_admin(), public.app_user_role(), public.app_user_status(),
  public.app_user_org_ids(), public.app_org_colleague_ids(), public.app_my_alert_ids(),
  public.app_farmer_profile_id(), public.app_gov_region_ids() TO anon, authenticated, service_role;

-- ─── Grants (RLS decides which rows) ───────────────────────────────────────
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
-- audit_log is append-only for everyone except the owner
REVOKE UPDATE, DELETE ON audit_log FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON job_runs FROM authenticated;
REVOKE ALL ON "__drizzle_migrations" FROM anon, authenticated;

-- ─── Enable RLS + platform-admin bypass on every application table ─────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','organizations','user_organizations','farmer_profiles','farm_fields','government_regions',
    'supply_chain_nodes','weather_readings','flood_risk_zones','salinity_risk_zones','climate_forecasts',
    'satellite_scenes','climate_alerts','alert_deliveries','farm_recommendations','resource_inventory',
    'resource_requests','supply_chain_risks','farmer_actions','usage_events','subscriptions','webhooks',
    'api_keys','audit_log','feature_flags','supply_chain_flows','commodities','commodity_prices',
    'rag_documents','job_runs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_platform_admin', t);
    IF t = 'audit_log' THEN
      -- even admins cannot rewrite history: read + append only
      EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (public.app_is_platform_admin())', t || '_platform_admin', t);
    ELSE
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL TO authenticated USING (public.app_is_platform_admin()) WITH CHECK (public.app_is_platform_admin())',
        t || '_platform_admin', t);
    END IF;
  END LOOP;
END
$$;

-- ─── users ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS users_self_read ON users;
CREATE POLICY users_self_read ON users FOR SELECT TO authenticated USING (id = auth.uid());

DROP POLICY IF EXISTS users_self_update ON users;
-- users may edit their own profile but never escalate role / status / tier
CREATE POLICY users_self_update ON users FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role = public.app_user_role()
    AND status = public.app_user_status()
  );

DROP POLICY IF EXISTS users_org_colleagues ON users;
CREATE POLICY users_org_colleagues ON users FOR SELECT TO authenticated USING (id IN (SELECT public.app_org_colleague_ids()));

-- ─── organizations & membership ────────────────────────────────────────────
DROP POLICY IF EXISTS orgs_member_read ON organizations;
CREATE POLICY orgs_member_read ON organizations FOR SELECT TO authenticated USING (id IN (SELECT public.app_user_org_ids()));

DROP POLICY IF EXISTS orgs_verified_public ON organizations;
CREATE POLICY orgs_verified_public ON organizations FOR SELECT TO anon, authenticated USING (verified);

DROP POLICY IF EXISTS user_orgs_self_read ON user_organizations;
CREATE POLICY user_orgs_self_read ON user_organizations FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ─── farmer_profiles (spec §11) ────────────────────────────────────────────
DROP POLICY IF EXISTS farmers_own_profile ON farmer_profiles;
CREATE POLICY farmers_own_profile ON farmer_profiles FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Government officers can read data within their region (spatial containment)
DROP POLICY IF EXISTS gov_regional_access ON farmer_profiles;
CREATE POLICY gov_regional_access ON farmer_profiles FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM government_regions gr
    JOIN user_organizations uo ON uo.org_id = gr.org_id
    WHERE uo.user_id = auth.uid()
      AND ST_Within(farmer_profiles.location, gr.geometry)
  )
  OR farmer_profiles.region_id IN (SELECT public.app_gov_region_ids())
);

-- ─── farm_fields (spec §11: farmers can only read their own data) ──────────
DROP POLICY IF EXISTS farmers_own_data ON farm_fields;
CREATE POLICY farmers_own_data ON farm_fields FOR ALL TO authenticated
  USING (farmer_id = public.app_farmer_profile_id())
  WITH CHECK (farmer_id = public.app_farmer_profile_id());

DROP POLICY IF EXISTS gov_fields_in_region ON farm_fields;
CREATE POLICY gov_fields_in_region ON farm_fields FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM government_regions gr
    WHERE gr.id IN (SELECT public.app_gov_region_ids())
      AND ST_Intersects(farm_fields.geometry, gr.geometry)
  )
);

-- ─── recommendations / actions / deliveries ────────────────────────────────
DROP POLICY IF EXISTS farmer_own_recommendations ON farm_recommendations;
CREATE POLICY farmer_own_recommendations ON farm_recommendations FOR SELECT TO authenticated USING (
  farm_field_id IN (SELECT f.id FROM farm_fields f WHERE f.farmer_id = public.app_farmer_profile_id())
);

DROP POLICY IF EXISTS farmer_recommendation_feedback ON farm_recommendations;
CREATE POLICY farmer_recommendation_feedback ON farm_recommendations FOR UPDATE TO authenticated
  USING (farm_field_id IN (SELECT f.id FROM farm_fields f WHERE f.farmer_id = public.app_farmer_profile_id()))
  WITH CHECK (farm_field_id IN (SELECT f.id FROM farm_fields f WHERE f.farmer_id = public.app_farmer_profile_id()));

DROP POLICY IF EXISTS farmer_own_actions ON farmer_actions;
CREATE POLICY farmer_own_actions ON farmer_actions FOR ALL TO authenticated
  USING (farmer_id = public.app_farmer_profile_id())
  WITH CHECK (farmer_id = public.app_farmer_profile_id());

DROP POLICY IF EXISTS gov_actions_in_region ON farmer_actions;
CREATE POLICY gov_actions_in_region ON farmer_actions FOR SELECT TO authenticated USING (
  farmer_id IN (SELECT fp.id FROM farmer_profiles fp WHERE fp.region_id IN (SELECT public.app_gov_region_ids()))
);

DROP POLICY IF EXISTS deliveries_own_read ON alert_deliveries;
CREATE POLICY deliveries_own_read ON alert_deliveries FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS deliveries_own_ack ON alert_deliveries;
CREATE POLICY deliveries_own_ack ON alert_deliveries FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS deliveries_gov_read ON alert_deliveries;
CREATE POLICY deliveries_gov_read ON alert_deliveries FOR SELECT TO authenticated USING (
  alert_id IN (SELECT a.id FROM climate_alerts a WHERE a.region_id IN (SELECT public.app_gov_region_ids()))
);

-- ─── government_regions & alerts ───────────────────────────────────────────
DROP POLICY IF EXISTS regions_public_read ON government_regions;
CREATE POLICY regions_public_read ON government_regions FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS alerts_public_active ON climate_alerts;
CREATE POLICY alerts_public_active ON climate_alerts FOR SELECT TO anon, authenticated
  USING (is_active AND valid_until > now());

DROP POLICY IF EXISTS alerts_gov_region_read ON climate_alerts;
CREATE POLICY alerts_gov_region_read ON climate_alerts FOR SELECT TO authenticated
  USING (region_id IN (SELECT public.app_gov_region_ids()));

DROP POLICY IF EXISTS alerts_farmer_history ON climate_alerts;
CREATE POLICY alerts_farmer_history ON climate_alerts FOR SELECT TO authenticated USING (id IN (SELECT public.app_my_alert_ids()));

-- create_alert permission: field officers and above, only inside their jurisdiction
DROP POLICY IF EXISTS alerts_gov_create ON climate_alerts;
CREATE POLICY alerts_gov_create ON climate_alerts FOR INSERT TO authenticated
  WITH CHECK (region_id IN (SELECT public.app_gov_region_ids()) AND created_by = auth.uid());

DROP POLICY IF EXISTS alerts_gov_update ON climate_alerts;
CREATE POLICY alerts_gov_update ON climate_alerts FOR UPDATE TO authenticated
  USING (region_id IN (SELECT public.app_gov_region_ids()))
  WITH CHECK (region_id IN (SELECT public.app_gov_region_ids()));

-- ─── resources (government orgs) ───────────────────────────────────────────
DROP POLICY IF EXISTS inventory_org_read ON resource_inventory;
CREATE POLICY inventory_org_read ON resource_inventory FOR SELECT TO authenticated USING (org_id IN (SELECT public.app_user_org_ids()));

DROP POLICY IF EXISTS inventory_org_update ON resource_inventory;
CREATE POLICY inventory_org_update ON resource_inventory FOR UPDATE TO authenticated
  USING (org_id IN (SELECT public.app_user_org_ids()) AND public.app_user_role() IN ('regional_admin', 'national_admin'))
  WITH CHECK (org_id IN (SELECT public.app_user_org_ids()));

DROP POLICY IF EXISTS requests_org_read ON resource_requests;
CREATE POLICY requests_org_read ON resource_requests FOR SELECT TO authenticated USING (org_id IN (SELECT public.app_user_org_ids()));

DROP POLICY IF EXISTS requests_org_create ON resource_requests;
CREATE POLICY requests_org_create ON resource_requests FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT public.app_user_org_ids()) AND requested_by = auth.uid());

-- approve_resources permission: regional / national admins only
DROP POLICY IF EXISTS requests_org_approve ON resource_requests;
CREATE POLICY requests_org_approve ON resource_requests FOR UPDATE TO authenticated
  USING (org_id IN (SELECT public.app_user_org_ids()) AND public.app_user_role() IN ('regional_admin', 'national_admin'))
  WITH CHECK (org_id IN (SELECT public.app_user_org_ids()));

-- ─── supply chain (org scoped) ─────────────────────────────────────────────
DROP POLICY IF EXISTS sc_nodes_org ON supply_chain_nodes;
CREATE POLICY sc_nodes_org ON supply_chain_nodes FOR ALL TO authenticated
  USING (org_id IN (SELECT public.app_user_org_ids()))
  WITH CHECK (org_id IN (SELECT public.app_user_org_ids()));

DROP POLICY IF EXISTS sc_flows_org ON supply_chain_flows;
CREATE POLICY sc_flows_org ON supply_chain_flows FOR SELECT TO authenticated USING (
  from_node_id IN (SELECT n.id FROM supply_chain_nodes n WHERE n.org_id IN (SELECT public.app_user_org_ids()))
  OR to_node_id IN (SELECT n.id FROM supply_chain_nodes n WHERE n.org_id IN (SELECT public.app_user_org_ids()))
);

DROP POLICY IF EXISTS sc_risks_org ON supply_chain_risks;
CREATE POLICY sc_risks_org ON supply_chain_risks FOR SELECT TO authenticated USING (
  node_id IN (SELECT n.id FROM supply_chain_nodes n WHERE n.org_id IN (SELECT public.app_user_org_ids()))
);

-- manage_integrations permission: supply_chain_admin
DROP POLICY IF EXISTS webhooks_org ON webhooks;
CREATE POLICY webhooks_org ON webhooks FOR ALL TO authenticated
  USING (org_id IN (SELECT public.app_user_org_ids()) AND public.app_user_role() = 'supply_chain_admin')
  WITH CHECK (org_id IN (SELECT public.app_user_org_ids()) AND public.app_user_role() = 'supply_chain_admin');

DROP POLICY IF EXISTS api_keys_org ON api_keys;
CREATE POLICY api_keys_org ON api_keys FOR ALL TO authenticated
  USING (org_id IN (SELECT public.app_user_org_ids()) AND public.app_user_role() = 'supply_chain_admin')
  WITH CHECK (org_id IN (SELECT public.app_user_org_ids()) AND public.app_user_role() = 'supply_chain_admin');

-- ─── public open data (risk layers, weather, markets) ──────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['flood_risk_zones','salinity_risk_zones','weather_readings','climate_forecasts',
                           'satellite_scenes','commodities','commodity_prices'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_public_read', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO anon, authenticated USING (true)', t || '_public_read', t);
  END LOOP;
END
$$;

DROP POLICY IF EXISTS rag_documents_read ON rag_documents;
CREATE POLICY rag_documents_read ON rag_documents FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS feature_flags_read ON feature_flags;
CREATE POLICY feature_flags_read ON feature_flags FOR SELECT TO anon, authenticated USING (true);

-- ─── billing ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS subscriptions_own ON subscriptions;
CREATE POLICY subscriptions_own ON subscriptions FOR SELECT TO authenticated USING (
  user_id = auth.uid() OR org_id IN (SELECT public.app_user_org_ids())
);

-- ─── audit & analytics (append-only) ───────────────────────────────────────
DROP POLICY IF EXISTS audit_log_append ON audit_log;
CREATE POLICY audit_log_append ON audit_log FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS usage_events_append ON usage_events;
CREATE POLICY usage_events_append ON usage_events FOR INSERT TO anon, authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- job_runs: platform admins only (covered by job_runs_platform_admin)
