/**
 * portfolioRouter — portfolio & asset monitoring, alert-rule engine and the
 * workspace notification centre. Every procedure is scoped to ctx.user.orgId
 * (platform_admin may pass `orgId`). Reads need "use_workspace"; writes need
 * "manage_assets".
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { AssetType, CropType } from "@agri-shield/types";
import { permitted, router } from "../trpc";
import { audit, getStore, nextId, type AlertRuleRecord, type RuleMetric } from "../data/store";
import { assessLocation } from "../services/location-risk";
import { trackUsage } from "../services/usage";
import { searchPlaces } from "../live/portfolio-geocode";
import { ASSET_TYPES, ASSET_TYPE_LABEL, CROP_TYPES, CSV_TEMPLATE, assetsToCsv, assetsToGeoJson } from "../services/portfolio-io";
import { METRICS, OP_LABEL, RULE_METRICS, describeRule, evaluateConditions, evaluateRule, cooldownUntil } from "../services/rules";
import {
  PortfolioError,
  addNote,
  assetNotes,
  bulkTag,
  commitImport,
  createAsset,
  defaultAssetType,
  deleteNote,
  effectiveScore,
  ensureScored,
  evaluateWorkspaceRules,
  exportRows,
  filterAssets,
  findDuplicate,
  getWorkspaceAsset,
  listAssetRows,
  listTags,
  portfolioState,
  portfolioSummary,
  previewImport,
  renameTag,
  rescoreWorkspace,
  ruleFirings,
  safeOutboundUrl,
  sendWeeklyDigest,
  setTagMeta,
  snapshotForAsset,
  snapshotsFor,
  testRuleDraft,
  toRow,
  validCoords,
  valueAtRisk,
  valueAtRiskByHazard,
  webhookSecret,
  workspaceAssets,
  workspaceRules,
  MEAN_DAMAGE_RATIO,
} from "../services/portfolio";
import { listNotifications, markAllRead, markRead, unreadCount } from "../services/workspace-notifications";

const read = permitted("use_workspace");
const write = permitted("manage_assets");

type Ctx = { user: { id: string; name: string; role: string; orgId: string | null } };

function wsOf(ctx: Ctx, orgId?: string | null): string {
  if (orgId && ctx.user.role === "platform_admin") return orgId;
  if (!ctx.user.orgId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Your account is not attached to a workspace" });
  return ctx.user.orgId;
}

async function guard<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof PortfolioError) throw new TRPCError({ code: e.code, message: e.message, cause: e });
    throw e;
  }
}

const assetTypeZ = z.enum(ASSET_TYPES as [AssetType, ...AssetType[]]);
const cropZ = z.enum(CROP_TYPES as [CropType, ...CropType[]]);
const levelZ = z.enum(["low", "medium", "high", "critical"]);
const orgZ = z.string().max(80).optional();

const filtersZ = z.object({
  orgId: orgZ,
  types: z.array(assetTypeZ).max(10).optional(),
  tags: z.array(z.string().max(60)).max(30).optional(),
  countries: z.array(z.string().max(80)).max(30).optional(),
  levels: z.array(levelZ).max(4).optional(),
  search: z.string().max(120).optional(),
  status: z.enum(["active", "archived", "all"]).optional(),
  ids: z.array(z.string().max(40)).max(5000).optional(),
});

const metaZ = z.record(z.string().max(40), z.union([z.string().max(300), z.number(), z.boolean(), z.null()]));

const assetInputZ = z.object({
  name: z.string().trim().min(1).max(120),
  type: assetTypeZ,
  lat: z.number().min(-90).max(90).nullable().optional(),
  lon: z.number().min(-180).max(180).nullable().optional(),
  address: z.string().max(300).nullable().optional(),
  country: z.string().max(80).nullable().optional(),
  valueUsd: z.number().min(0).max(1e12).default(0),
  crop: cropZ.nullable().optional(),
  externalRef: z.string().max(80).nullable().optional(),
  tags: z.array(z.string().max(40)).max(20).default([]),
  areaHa: z.number().positive().max(1e6).nullable().optional(),
  meta: metaZ.optional(),
});

const metricZ = z.enum(RULE_METRICS as [RuleMetric, ...RuleMetric[]]);
const conditionZ = z.object({ metric: metricZ, op: z.enum([">", ">=", "<", "<="]), value: z.number().finite() });
const scopeZ = z.object({
  assetIds: z.array(z.string().max(40)).max(2000).optional(),
  tags: z.array(z.string().max(60)).max(30).optional(),
  types: z.array(assetTypeZ).max(10).optional(),
  countries: z.array(z.string().max(80)).max(30).optional(),
});
const channelZ = z.enum(["app", "email", "sms", "whatsapp", "webhook", "slack"]);
const ruleBodyZ = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().max(500).default(""),
  enabled: z.boolean().default(true),
  scope: scopeZ.default({}),
  conditions: z.array(conditionZ).min(1).max(8),
  match: z.enum(["all", "any"]).default("all"),
  severity: z.enum(["info", "warning", "critical"]).default("warning"),
  channels: z.array(channelZ).min(1).max(6),
  recipients: z.array(z.string().trim().max(200)).max(50).default([]),
  webhookUrl: z.string().url().max(500).nullable().default(null),
  slackUrl: z.string().url().max(500).nullable().optional(),
  cooldownHours: z.number().min(0).max(24 * 30).default(12),
});

function cleanScope(s: z.infer<typeof scopeZ>): AlertRuleRecord["scope"] {
  const out: AlertRuleRecord["scope"] = {};
  if (s.assetIds?.length) out.assetIds = s.assetIds;
  if (s.tags?.length) out.tags = s.tags.map((t) => t.toLowerCase());
  if (s.types?.length) out.types = s.types;
  if (s.countries?.length) out.countries = s.countries;
  return out;
}

function validateChannels(b: { channels: string[]; webhookUrl: string | null; slackUrl?: string | null }) {
  if (b.channels.includes("webhook") && !safeOutboundUrl(b.webhookUrl)) throw new TRPCError({ code: "BAD_REQUEST", message: "Webhook channel needs a valid https:// URL" });
  if (b.channels.includes("slack") && !safeOutboundUrl(b.slackUrl ?? (b.webhookUrl?.includes("hooks.slack.com") ? b.webhookUrl : null)))
    throw new TRPCError({ code: "BAD_REQUEST", message: "Slack channel needs an incoming-webhook URL (https://hooks.slack.com/services/…)" });
}

function ruleView(ws: string, r: AlertRuleRecord) {
  const assets = workspaceAssets(ws);
  const ev = evaluateRule(r, assets, snapshotsFor(assets), { ignoreEnabled: true, ignoreCooldown: true });
  return {
    ...r,
    slackUrl: portfolioState.ruleExtras.get(r.id)?.slackUrl ?? null,
    plain: describeRule(r),
    inScope: ev.inScope,
    matchingNow: ev.matches.length,
    cooldownUntil: cooldownUntil(r),
    lastFiring: ruleFirings(ws, { ruleId: r.id, limit: 1 })[0]?.at ?? null,
  };
}

function findRule(ws: string, id: string): AlertRuleRecord {
  const r = getStore().alertRules.find((x) => x.id === id && x.workspaceId === ws);
  if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Rule not found" });
  return r;
}

// ─── Notifications sub-router ─────────────────────────────────────────────

const notificationsRouter = router({
  list: read
    .input(z.object({ unreadOnly: z.boolean().optional(), kind: z.enum(["alert", "rule", "system", "report", "billing", "team"]).optional(), limit: z.number().int().min(1).max(100).default(20), cursor: z.string().nullish() }).optional())
    .query(({ ctx, input }) => {
      if (!ctx.user.orgId) return { items: [], nextCursor: null, total: 0 };
      return listNotifications(ctx.user.orgId, ctx.user.id, { unreadOnly: input?.unreadOnly, kind: input?.kind, limit: input?.limit ?? 20, cursor: input?.cursor ?? null });
    }),
  unreadCount: read.query(({ ctx }) => (ctx.user.orgId ? { count: unreadCount(ctx.user.orgId, ctx.user.id) } : { count: 0 })),
  markRead: read.input(z.object({ ids: z.array(z.string().max(60)).min(1).max(200) })).mutation(({ ctx, input }) => ({ updated: ctx.user.orgId ? markRead(ctx.user.orgId, ctx.user.id, input.ids) : 0 })),
  markAllRead: read.mutation(({ ctx }) => ({ updated: ctx.user.orgId ? markAllRead(ctx.user.orgId, ctx.user.id) : 0 })),
});

// ─── Router ───────────────────────────────────────────────────────────────

export const portfolioRouter = router({
  ping: read.query(() => ({ ok: true })),

  /** Static catalogue for forms (asset types, crops, metrics, damage ratios). */
  meta: read.query(({ ctx }) => ({
    assetTypes: ASSET_TYPES.map((t) => ({ value: t, label: ASSET_TYPE_LABEL[t] })),
    crops: CROP_TYPES,
    metrics: RULE_METRICS.map((m) => ({ value: m, ...METRICS[m] })),
    ops: Object.entries(OP_LABEL).map(([value, label]) => ({ value, label })),
    meanDamageRatio: MEAN_DAMAGE_RATIO,
    defaultType: ctx.user.orgId ? defaultAssetType(ctx.user.orgId) : "farm",
    canWrite: ["field_officer", "regional_admin", "national_admin", "supply_chain_analyst", "supply_chain_admin", "enterprise_analyst", "enterprise_admin", "platform_admin"].includes(ctx.user.role),
  })),

  summary: read.input(z.object({ orgId: orgZ }).optional()).query(({ ctx, input }) => {
    const ws = wsOf(ctx, input?.orgId);
    ensureScored(ws);
    return portfolioSummary(ws);
  }),

  listAssets: read
    .input(
      filtersZ.extend({
        sort: z.enum(["name", "composite", "value", "var", "change7d", "createdAt", "type", "country", "flood", "salinity", "drought", "heat"]).default("composite"),
        dir: z.enum(["asc", "desc"]).default("desc"),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(5).max(200).default(25),
      })
    )
    .query(({ ctx, input }) => {
      const ws = wsOf(ctx, input.orgId);
      ensureScored(ws);
      return listAssetRows(ws, input, { key: input.sort, dir: input.dir }, input.page, input.pageSize);
    }),

  /** Lightweight points for the portfolio map (all matching assets). */
  mapAssets: read.input(filtersZ.optional()).query(({ ctx, input }) => {
    const ws = wsOf(ctx, input?.orgId);
    return filterAssets(ws, input ?? {}).map((a) => {
      const e = effectiveScore(a);
      return { id: a.id, name: a.name, type: a.type, lat: a.lat, lon: a.lon, composite: e.composite, level: e.level, valueUsd: a.valueUsd, tags: a.tags, country: a.country, driver: e.drivers[0] ?? "" };
    });
  }),

  getAsset: read.input(z.object({ id: z.string().max(40), orgId: orgZ })).query(({ ctx, input }) =>
    guard(() => {
      const ws = wsOf(ctx, input.orgId);
      const a = getWorkspaceAsset(ws, input.id);
      const e = effectiveScore(a);
      const snap = snapshotForAsset(a);
      const s = getStore();
      const district = a.districtId ? s.districts.find((d) => d.id === a.districtId) ?? null : null;
      const since = Date.now() - 30 * 86_400_000;
      const quick = portfolioState.quick.get(a.id) ?? null;
      return {
        asset: a,
        row: toRow(a),
        score: e,
        metrics: RULE_METRICS.map((m) => ({ metric: m, label: METRICS[m].label, short: METRICS[m].short, unit: METRICS[m].unit, help: METRICS[m].help, value: snap[m] })),
        quick: quick ? { rain24hMm: quick.rain24hMm, rain72hMm: quick.rain72hMm, maxTempC: quick.maxTempC, dischargeRatio: quick.dischargeRatio, salinityEc: quick.salinityEc, floodProb24h: quick.floodProb24h, at: quick.at, source: quick.source } : null,
        varUsd: Math.round(valueAtRisk(a.valueUsd, e)),
        varByHazard: Object.fromEntries(Object.entries(valueAtRiskByHazard(a.valueUsd, e)).map(([k, v]) => [k, Math.round(v)])),
        history: a.history,
        notes: assetNotes(a.id),
        district: district ? { id: district.id, name: district.name, country: district.countryName, floodRisk: district.floodRisk, salinityRisk: district.salinityRisk, riskLevel: district.riskLevel } : null,
        relatedAlerts: a.districtId
          ? s.alerts
              .filter((x) => x.districtId === a.districtId && new Date(x.createdAt).getTime() > since)
              .sort((x, y) => new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime())
              .slice(0, 8)
              .map((x) => ({ id: x.id, title: x.title, alertType: x.alertType, severity: x.severity, createdAt: x.createdAt, isActive: x.isActive, source: x.source }))
          : [],
        rules: workspaceRules(ws)
          .filter((r) => evaluateRule(r, [a], new Map([[a.id, snap]]), { ignoreEnabled: true, ignoreCooldown: true }).inScope > 0)
          .map((r) => {
            const ev = evaluateConditions(r, snap);
            return { id: r.id, name: r.name, enabled: r.enabled, severity: r.severity, matched: ev.matched, results: ev.results, plain: describeRule(r) };
          }),
        firings: ruleFirings(ws, { assetId: a.id, limit: 15 }).map((f) => ({ id: f.id, ruleId: f.ruleId, ruleName: f.ruleName, at: f.at, severity: f.severity, reason: f.matches.find((m) => m.assetId === a.id)?.reason ?? "" })),
        canWrite: ["field_officer", "regional_admin", "national_admin", "supply_chain_analyst", "supply_chain_admin", "enterprise_analyst", "enterprise_admin", "platform_admin"].includes(ctx.user.role),
      };
    })
  ),

  /** Full location report (ML flood/salinity, forecast, river, hazards) — on demand. */
  assetReport: read.input(z.object({ id: z.string().max(40), orgId: orgZ })).query(({ ctx, input }) =>
    guard(async () => {
      const ws = wsOf(ctx, input.orgId);
      const a = getWorkspaceAsset(ws, input.id);
      trackUsage(ws, "assessments", 1);
      return assessLocation(a.lat, a.lon, { crop: a.crop ?? undefined, name: a.name });
    })
  ),

  searchPlaces: read.input(z.object({ q: z.string().min(2).max(160) })).query(({ input }) => searchPlaces(input.q)),

  checkDuplicate: read.input(z.object({ name: z.string().max(120), lat: z.number(), lon: z.number(), externalRef: z.string().max(80).nullish() })).query(({ ctx, input }) => {
    const ws = wsOf(ctx);
    if (!validCoords(input.lat, input.lon)) return null;
    const d = findDuplicate(ws, input);
    return d ? { id: d.id, name: d.name, externalRef: d.externalRef } : null;
  }),

  createAsset: write.input(assetInputZ.extend({ allowDuplicate: z.boolean().optional() })).mutation(({ ctx, input }) =>
    guard(async () => {
      const ws = wsOf(ctx);
      const a = await createAsset(ws, ctx.user, { ...input, meta: input.meta ?? {} }, { allowDuplicate: input.allowDuplicate });
      return toRow(a);
    })
  ),

  updateAsset: write
    .input(
      z.object({
        id: z.string().max(40),
        patch: assetInputZ.partial().extend({ lat: z.number().min(-90).max(90).optional(), lon: z.number().min(-180).max(180).optional() }),
      })
    )
    .mutation(({ ctx, input }) =>
      guard(async () => {
        const ws = wsOf(ctx);
        const a = getWorkspaceAsset(ws, input.id);
        const p = input.patch;
        const moved = (p.lat != null && p.lat !== a.lat) || (p.lon != null && p.lon !== a.lon);
        if (moved && !validCoords(p.lat ?? a.lat, p.lon ?? a.lon)) throw new PortfolioError("BAD_REQUEST", "Invalid coordinates");
        if (p.name !== undefined) a.name = p.name;
        if (p.type !== undefined) a.type = p.type;
        if (p.valueUsd !== undefined) a.valueUsd = p.valueUsd;
        if (p.crop !== undefined) a.crop = p.crop ?? null;
        if (p.externalRef !== undefined) a.externalRef = p.externalRef?.trim() || null;
        if (p.address !== undefined) a.address = p.address?.trim() || null;
        if (p.country !== undefined && p.country) a.country = p.country;
        if (p.areaHa !== undefined) a.areaHa = p.areaHa ?? null;
        if (p.tags !== undefined) a.tags = [...new Set(p.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
        if (p.meta !== undefined) a.meta = { ...a.meta, ...p.meta };
        if (moved) {
          a.lat = p.lat ?? a.lat;
          a.lon = p.lon ?? a.lon;
          a.lastAssessment = null;
          portfolioState.quick.delete(a.id);
          await rescoreWorkspace(ws, { assetIds: [a.id], trigger: "update", by: ctx.user.id }).catch(() => null);
        }
        audit({ userId: ctx.user.id, userName: ctx.user.name, action: "asset.update", entity: "asset", entityId: a.id, details: Object.keys(p).join(", ") });
        return toRow(a);
      })
    ),

  archiveAsset: write.input(z.object({ id: z.string().max(40), archived: z.boolean().default(true) })).mutation(({ ctx, input }) =>
    guard(() => {
      const ws = wsOf(ctx);
      const a = getWorkspaceAsset(ws, input.id);
      a.status = input.archived ? "archived" : "active";
      audit({ userId: ctx.user.id, userName: ctx.user.name, action: input.archived ? "asset.archive" : "asset.restore", entity: "asset", entityId: a.id, details: a.name });
      return { id: a.id, status: a.status };
    })
  ),

  bulkArchive: write.input(z.object({ ids: z.array(z.string().max(40)).min(1).max(5000), archived: z.boolean().default(true) })).mutation(({ ctx, input }) => {
    const ws = wsOf(ctx);
    const set = new Set(input.ids);
    let n = 0;
    for (const a of getStore().assets)
      if (a.workspaceId === ws && set.has(a.id)) {
        a.status = input.archived ? "archived" : "active";
        n++;
      }
    audit({ userId: ctx.user.id, userName: ctx.user.name, action: input.archived ? "asset.bulk_archive" : "asset.bulk_restore", entity: "workspace", entityId: ws, details: `${n} assets` });
    return { updated: n };
  }),

  bulkTag: write
    .input(z.object({ ids: z.array(z.string().max(40)).min(1).max(5000), add: z.array(z.string().trim().min(1).max(40)).max(10).default([]), remove: z.array(z.string().max(40)).max(10).default([]) }))
    .mutation(({ ctx, input }) => {
      const ws = wsOf(ctx);
      const n = bulkTag(ws, input.ids, input.add, input.remove);
      audit({ userId: ctx.user.id, userName: ctx.user.name, action: "asset.bulk_tag", entity: "workspace", entityId: ws, details: `${n} assets +[${input.add.join(",")}] -[${input.remove.join(",")}]` });
      return { updated: n };
    }),

  // ── Tags / groups ──
  listTags: read.input(z.object({ orgId: orgZ }).optional()).query(({ ctx, input }) => listTags(wsOf(ctx, input?.orgId))),
  renameTag: write.input(z.object({ from: z.string().max(40), to: z.string().trim().min(1).max(40) })).mutation(({ ctx, input }) => ({ updated: renameTag(wsOf(ctx), input.from, input.to) })),
  deleteTag: write.input(z.object({ tag: z.string().max(40) })).mutation(({ ctx, input }) => {
    const ws = wsOf(ctx);
    const ids = workspaceAssets(ws, true).filter((a) => a.tags.includes(input.tag)).map((a) => a.id);
    return { updated: ids.length ? bulkTag(ws, ids, [], [input.tag]) : 0 };
  }),
  setTagMeta: write
    .input(z.object({ tag: z.string().max(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), description: z.string().max(200).optional() }))
    .mutation(({ ctx, input }) => setTagMeta(wsOf(ctx), input.tag, input)),

  // ── Notes ──
  addNote: write.input(z.object({ assetId: z.string().max(40), text: z.string().trim().min(1).max(2000) })).mutation(({ ctx, input }) => guard(() => addNote(wsOf(ctx), input.assetId, ctx.user, input.text))),
  deleteNote: write.input(z.object({ assetId: z.string().max(40), noteId: z.string().max(60) })).mutation(({ ctx, input }) => guard(() => ({ ok: deleteNote(wsOf(ctx), input.assetId, input.noteId, ctx.user) }))),

  // ── Import / export ──
  importTemplate: read.query(() => ({ filename: "agri-shield-portfolio-template.csv", content: CSV_TEMPLATE, mime: "text/csv" })),

  importPreview: write
    .input(z.object({ text: z.string().min(1).max(5_000_000), format: z.enum(["csv", "geojson", "auto"]).default("auto"), defaultType: assetTypeZ.optional() }))
    .mutation(({ ctx, input }) => {
      const ws = wsOf(ctx);
      const res = previewImport(ws, input.text, input.format, input.defaultType);
      return { ...res, rows: res.rows.slice(0, 1000), truncated: res.rows.length > 1000 };
    }),

  importCommit: write
    .input(z.object({ text: z.string().min(1).max(5_000_000), format: z.enum(["csv", "geojson", "auto"]).default("auto"), defaultType: assetTypeZ.optional(), extraTags: z.array(z.string().max(40)).max(5).default([]), skipDuplicates: z.boolean().default(true) }))
    .mutation(({ ctx, input }) => guard(() => commitImport(wsOf(ctx), ctx.user, input.text, input))),

  exportAssets: read.input(filtersZ.extend({ format: z.enum(["csv", "geojson"]) })).mutation(({ ctx, input }) => {
    const ws = wsOf(ctx, input.orgId);
    const rows = exportRows(ws, input);
    const stamp = new Date().toISOString().slice(0, 10);
    const org = getStore().orgs.find((o) => o.id === ws);
    const slug = (org?.shortName ?? ws).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    audit({ userId: ctx.user.id, userName: ctx.user.name, action: "asset.export", entity: "workspace", entityId: ws, details: `${rows.length} assets as ${input.format}` });
    return input.format === "csv"
      ? { filename: `${slug}-portfolio-${stamp}.csv`, mime: "text/csv", content: assetsToCsv(rows), count: rows.length }
      : { filename: `${slug}-portfolio-${stamp}.geojson`, mime: "application/geo+json", content: JSON.stringify(assetsToGeoJson(rows, { workspace: org?.name ?? ws, varMethod: "value × composite/100 × hazard-weighted mean damage ratio" })), count: rows.length };
  }),

  rescore: write.input(z.object({ assetIds: z.array(z.string().max(40)).max(5000).optional(), evaluateRules: z.boolean().default(false) }).optional()).mutation(async ({ ctx, input }) => {
    const ws = wsOf(ctx);
    const r = await rescoreWorkspace(ws, { assetIds: input?.assetIds, trigger: "manual", by: ctx.user.id });
    const rules = input?.evaluateRules ? await evaluateWorkspaceRules(ws, { trigger: "rescore", by: ctx.user.id }) : [];
    return { ...r, rules };
  }),

  // ── Rules ──
  ruleOptions: read.query(({ ctx }) => {
    const ws = wsOf(ctx);
    const assets = workspaceAssets(ws);
    const members = getStore().users.filter((u) => u.orgId === ws && u.status !== "suspended").map((u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone }));
    return {
      tags: listTags(ws).map((t) => ({ value: t.tag, count: t.count })),
      types: [...new Set(assets.map((a) => a.type))].map((t) => ({ value: t, label: ASSET_TYPE_LABEL[t], count: assets.filter((a) => a.type === t).length })),
      countries: [...new Set(assets.map((a) => a.country))].map((c) => ({ value: c, count: assets.filter((a) => a.country === c).length })),
      assets: assets.map((a) => ({ id: a.id, name: a.name, type: a.type, country: a.country, district: a.districtId ? getStore().districts.find((d) => d.id === a.districtId)?.name ?? null : null, address: a.address })).slice(0, 2000),
      members,
      webhookSecret: ["enterprise_admin", "platform_admin", "national_admin", "supply_chain_admin"].includes(ctx.user.role) ? webhookSecret(ws) : null,
      signatureHeader: "X-AgriShield-Signature",
    };
  }),

  listRules: read.query(({ ctx }) => {
    const ws = wsOf(ctx);
    return workspaceRules(ws)
      .map((r) => ruleView(ws, r))
      .sort((a, b) => Number(b.enabled) - Number(a.enabled) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }),

  createRule: write.input(ruleBodyZ).mutation(({ ctx, input }) => {
    const ws = wsOf(ctx);
    validateChannels(input);
    const rule: AlertRuleRecord = {
      id: nextId("rule"),
      workspaceId: ws,
      name: input.name,
      description: input.description || describeRule({ ...input, scope: cleanScope(input.scope) }),
      enabled: input.enabled,
      scope: cleanScope(input.scope),
      conditions: input.conditions,
      match: input.match,
      severity: input.severity,
      channels: [...new Set(input.channels)],
      recipients: input.recipients.filter(Boolean),
      webhookUrl: input.webhookUrl,
      cooldownHours: input.cooldownHours,
      lastTriggeredAt: null,
      triggerCount: 0,
      createdBy: ctx.user.id,
      createdAt: new Date(),
    };
    getStore().alertRules.push(rule);
    if (input.slackUrl !== undefined) portfolioState.ruleExtras.set(rule.id, { slackUrl: input.slackUrl });
    audit({ userId: ctx.user.id, userName: ctx.user.name, action: "rule.create", entity: "alert_rule", entityId: rule.id, details: describeRule(rule) });
    return ruleView(ws, rule);
  }),

  updateRule: write.input(z.object({ id: z.string().max(40), patch: ruleBodyZ.partial() })).mutation(({ ctx, input }) => {
    const ws = wsOf(ctx);
    const r = findRule(ws, input.id);
    const p = input.patch;
    const next = { channels: p.channels ?? r.channels, webhookUrl: p.webhookUrl !== undefined ? p.webhookUrl : r.webhookUrl, slackUrl: p.slackUrl !== undefined ? p.slackUrl : portfolioState.ruleExtras.get(r.id)?.slackUrl ?? null };
    validateChannels(next);
    if (p.name !== undefined) r.name = p.name;
    if (p.description !== undefined) r.description = p.description;
    if (p.enabled !== undefined) r.enabled = p.enabled;
    if (p.scope !== undefined) r.scope = cleanScope(p.scope);
    if (p.conditions !== undefined) r.conditions = p.conditions;
    if (p.match !== undefined) r.match = p.match;
    if (p.severity !== undefined) r.severity = p.severity;
    if (p.channels !== undefined) r.channels = [...new Set(p.channels)];
    if (p.recipients !== undefined) r.recipients = p.recipients.filter(Boolean);
    if (p.webhookUrl !== undefined) r.webhookUrl = p.webhookUrl;
    if (p.cooldownHours !== undefined) r.cooldownHours = p.cooldownHours;
    if (p.slackUrl !== undefined) portfolioState.ruleExtras.set(r.id, { slackUrl: p.slackUrl });
    audit({ userId: ctx.user.id, userName: ctx.user.name, action: "rule.update", entity: "alert_rule", entityId: r.id, details: Object.keys(p).join(", ") });
    return ruleView(ws, r);
  }),

  toggleRule: write.input(z.object({ id: z.string().max(40), enabled: z.boolean() })).mutation(({ ctx, input }) => {
    const ws = wsOf(ctx);
    const r = findRule(ws, input.id);
    r.enabled = input.enabled;
    audit({ userId: ctx.user.id, userName: ctx.user.name, action: input.enabled ? "rule.enable" : "rule.disable", entity: "alert_rule", entityId: r.id, details: r.name });
    return { id: r.id, enabled: r.enabled };
  }),

  deleteRule: write.input(z.object({ id: z.string().max(40) })).mutation(({ ctx, input }) => {
    const ws = wsOf(ctx);
    const r = findRule(ws, input.id);
    const s = getStore();
    s.alertRules = s.alertRules.filter((x) => x.id !== r.id);
    portfolioState.ruleExtras.delete(r.id);
    audit({ userId: ctx.user.id, userName: ctx.user.name, action: "rule.delete", entity: "alert_rule", entityId: r.id, details: r.name });
    return { ok: true };
  }),

  /** Dry-run: which assets would fire right now and why (no dispatch). Accepts a saved rule id or a draft. */
  testRule: read
    .input(z.object({ id: z.string().max(40).optional(), draft: ruleBodyZ.pick({ scope: true, conditions: true, match: true }).extend({ cooldownHours: z.number().min(0).max(720).optional() }).optional() }))
    .query(({ ctx, input }) => {
      const ws = wsOf(ctx);
      const base = input.id ? findRule(ws, input.id) : null;
      if (!base && !input.draft) throw new TRPCError({ code: "BAD_REQUEST", message: "Pass a rule id or a draft" });
      const rule = base
        ? { ...base, ...(input.draft ? { scope: cleanScope(input.draft.scope), conditions: input.draft.conditions, match: input.draft.match } : {}) }
        : { id: "draft", enabled: true, lastTriggeredAt: null, cooldownHours: input.draft!.cooldownHours ?? 0, scope: cleanScope(input.draft!.scope), conditions: input.draft!.conditions, match: input.draft!.match };
      const ev = testRuleDraft(ws, rule);
      const byId = new Map(workspaceAssets(ws).map((a) => [a.id, a]));
      return {
        inScope: ev.inScope,
        withData: ev.withData,
        matchCount: ev.matches.length,
        wouldDispatch: base ? base.enabled && !(ev.blockedBy === "cooldown") && ev.matches.length > 0 : ev.matches.length > 0,
        blockedBy: ev.blockedBy,
        cooldownUntil: ev.cooldownUntil,
        exposureUsd: ev.matches.reduce((t, m) => t + (byId.get(m.assetId)?.valueUsd ?? 0), 0),
        matches: ev.matches.slice(0, 100).map((m) => {
          const a = byId.get(m.assetId);
          return { ...m, type: a?.type, valueUsd: a?.valueUsd ?? 0, level: a ? effectiveScore(a).level : "low", lat: a?.lat, lon: a?.lon };
        }),
      };
    }),

  /** Evaluate every enabled rule now and dispatch firings (what the monitor job does hourly). */
  runRules: write.input(z.object({ ruleIds: z.array(z.string().max(40)).max(100).optional(), ignoreCooldown: z.boolean().default(false) }).optional()).mutation(async ({ ctx, input }) => {
    const ws = wsOf(ctx);
    return evaluateWorkspaceRules(ws, { trigger: "manual", by: ctx.user.id, ruleIds: input?.ruleIds, ignoreCooldown: input?.ignoreCooldown });
  }),

  getRuleHistory: read.input(z.object({ ruleId: z.string().max(40).optional(), limit: z.number().int().min(1).max(500).default(100) }).optional()).query(({ ctx, input }) => {
    const ws = wsOf(ctx);
    const firings = ruleFirings(ws, { ruleId: input?.ruleId, limit: input?.limit ?? 100 });
    const seeded = workspaceRules(ws)
      .filter((r) => r.lastTriggeredAt && !firings.some((f) => f.ruleId === r.id) && (!input?.ruleId || r.id === input.ruleId))
      .map((r) => ({ ruleId: r.id, ruleName: r.name, at: r.lastTriggeredAt!, triggerCount: r.triggerCount }));
    return { firings, earlier: seeded };
  }),

  sendDigest: permitted("manage_workspace").mutation(({ ctx }) => ({ sent: sendWeeklyDigest(wsOf(ctx), true) })),

  notifications: notificationsRouter,
});
