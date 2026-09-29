/**
 * Farmer tools API (spread into `farmerRouter` in server/routers/farmer.ts):
 * irrigation scheduler, season planner, WFP market prices + price alerts,
 * Crop Doctor cases, farm ledger + fertiliser calculator + crop insurance,
 * rain nowcast/radar, "ask an expert" questions and the Today's-actions card.
 *
 * Every number carries its source; every live call has a timeout and a fallback.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { UserRole } from "@agri-shield/types";
import { CROP_EC_THRESHOLDS } from "@agri-shield/types";
import { permitted } from "../trpc";
import { audit, DAY, getStore, nextId } from "../data/store";
import { countryByCode } from "../data/geography";
import { farmerFields, resolveFarmer } from "../data/farmer-context";
import { farmTools, EXPENSE_CATEGORIES, INCOME_CATEGORIES, type LedgerCategory } from "../data/farmer-tools-store";
import { depletionFromMoisture, planIrrigation, type IrrigationPlan } from "./farm-irrigation";
import { getNowcast, getRadarFrames, getWaterBalanceFeed, type WaterBalanceFeed } from "./farm-weather";
import { CALENDARS, getSeasonalOutlook, pickSowingWindow, suggestVarieties, type OutlookMonth } from "./farm-season";
import { getUsdRate, getWfpPrices, peekWfp, type WfpCountryData } from "../live/market-prices";
import { alertHit, analyseMarkets, type CommodityAnalysis } from "./farm-market";
import { causeById, diagnose, type DoctorContext } from "./farm-doctor";
import { DEFAULT_PRICES, NUTRIENT_TARGETS, insuranceBook, ledgerSummary, seasonLabel } from "./farm-finance";
import { notifyWorkspace } from "./workspace-notifications";
import { GOV_ROLES } from "@/lib/rbac";

const proc = permitted("view_farm_data");
const govProc = permitted("view_gov_dashboard");

const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

type U = { id: string; role: UserRole; name?: string | null; orgId?: string | null };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const photoSchema = z
  .string()
  .max(700_000)
  .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, "photo must be a JPEG/PNG/WebP data URL");

// ─── Irrigation ───────────────────────────────────────────────────────────

async function irrigationFor(user: U, onlyFieldId?: string) {
  const { farmer, district } = resolveFarmer(user);
  const fields = farmerFields(farmer.id).filter((f) => !onlyFieldId || f.id === onlyFieldId);
  const feed = await withTimeout<WaterBalanceFeed | null>(getWaterBalanceFeed(farmer.lat, farmer.lon), 12000, null);
  const logs = farmTools().irrigationLogs.filter((l) => l.farmerId === farmer.id);
  const today = feed?.today ?? iso(new Date());
  const plans = fields.map((f) => {
    const plan: IrrigationPlan | null = feed
      ? planIrrigation({
          crop: f.cropType,
          soil: f.soilType,
          irrigationType: f.irrigationType,
          plantingDate: iso(f.plantingDate),
          harvestDate: iso(f.expectedHarvest),
          areaHa: f.areaHa,
          today,
          days: feed.daily,
          logs: logs.filter((l) => l.fieldId === f.id),
          initialDepletionFrac: depletionFromMoisture(feed.soilMoisture.first, f.soilType),
        })
      : null;
    return {
      field: { id: f.id, name: f.name, crop: f.cropType, areaHa: f.areaHa, soil: f.soilType, irrigation: f.irrigationType, plantingDate: iso(f.plantingDate), harvestDate: iso(f.expectedHarvest) },
      plan,
      logs: logs.filter((l) => l.fieldId === f.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10),
    };
  });
  return { farmer, district, today, feed, plans, available: !!feed, source: feed?.source ?? null };
}

// ─── Doctor context ───────────────────────────────────────────────────────

async function doctorContextFor(user: U): Promise<DoctorContext & { basis: string[] }> {
  const { farmer, district } = resolveFarmer(user);
  const fields = farmerFields(farmer.id);
  const feed = await withTimeout<WaterBalanceFeed | null>(getWaterBalanceFeed(farmer.lat, farmer.lon), 8000, null);
  const past = feed ? feed.daily.filter((d) => !d.forecast).slice(-7) : [];
  const next = feed ? feed.daily.filter((d) => d.forecast).slice(0, 3) : [];
  const rain7 = past.reduce((s, d) => s + d.rainMm, 0);
  const wetDays = [...past.slice(-3), ...next].filter((d) => d.rainMm >= 2 || (d.rainProb ?? 0) >= 70).length;
  const maxT = Math.max(-99, ...next.map((d) => d.tMax ?? -99));
  const ecOver = fields.some((f) => f.soilEc >= (CROP_EC_THRESHOLDS[f.cropType]?.sensitive ?? 3));
  const ctx: DoctorContext = {
    humid: wetDays >= 3,
    flood: district.floodProb72h >= 0.4 || fields.some((f) => f.floodRisk >= 60),
    salinity: ecOver || fields.some((f) => f.salinityRisk >= 55),
    dry: feed ? rain7 < 5 && next.every((d) => d.rainMm < 3) : false,
    hot: maxT >= 34,
  };
  const basis = [
    `${Math.round(rain7)} mm rain in the last 7 days; ${wetDays} wet days around today`,
    `Flood chance 72h ${Math.round(district.floodProb72h * 100)}%`,
    `Soil EC ${fields.length ? Math.max(...fields.map((f) => f.soilEc)).toFixed(1) : district.ecCurrent.toFixed(1)} dS/m`,
    maxT > -99 ? `Max temperature next 3 days ${Math.round(maxT)} °C` : "",
  ].filter(Boolean);
  return { ...ctx, basis };
}

// ─── Market ───────────────────────────────────────────────────────────────

function evaluateAlerts(farmerId: string, analysis: CommodityAnalysis[]) {
  const st = farmTools();
  return st.priceAlerts
    .filter((a) => a.farmerId === farmerId)
    .map((a) => {
      const c = analysis.find((x) => x.key === a.commodity);
      const price = c?.latest?.price ?? null;
      const hit = a.active && alertHit(a.direction, a.target, price);
      if (hit && !a.triggeredAt) a.triggeredAt = new Date();
      if (!hit && a.triggeredAt && price != null && !alertHit(a.direction, a.target, price)) a.triggeredAt = null;
      a.lastPrice = price;
      return { ...a, hit, month: c?.latest?.month ?? null, market: c?.latest?.market ?? null };
    });
}

const analysisCache = new Map<string, { at: string; data: CommodityAnalysis[] }>();
function analysisFor(data: WfpCountryData, farmerId: string, farm: { lat: number; lon: number }, crops: string[]) {
  const key = `${farmerId}:${data.fetchedAt}:${crops.join(",")}`;
  const hit = analysisCache.get(key);
  if (hit) return hit.data;
  const out = analyseMarkets(data, farm, crops);
  analysisCache.set(key, { at: data.fetchedAt, data: out });
  if (analysisCache.size > 200) analysisCache.delete(analysisCache.keys().next().value!);
  return out;
}

// ─── Questions ────────────────────────────────────────────────────────────

function questionView(q: ReturnType<typeof farmTools>["questions"][number]) {
  const s = getStore();
  const d = s.districts.find((x) => x.id === q.districtId);
  return { ...q, districtName: d?.name ?? q.districtId, countryName: d?.countryName ?? "" };
}

// ─── Procedures ───────────────────────────────────────────────────────────

export const farmToolProcedures = {
  /** FAO-56 irrigation plan for every field (or one), with logged irrigations. */
  irrigationPlan: proc.input(z.object({ fieldId: z.string().max(40).optional() }).optional()).query(async ({ ctx, input }) => {
    const r = await irrigationFor(ctx.user, input?.fieldId);
    return { today: r.today, available: r.available, source: r.source, soilMoisture: r.feed?.soilMoisture ?? null, fields: r.plans, updatedAt: new Date() };
  }),

  logIrrigation: proc
    .input(z.object({ fieldId: z.string().max(40), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), mm: z.number().min(1).max(300), note: z.string().trim().max(200).optional() }))
    .mutation(({ ctx, input }) => {
      const { farmer } = resolveFarmer(ctx.user);
      if (!farmerFields(farmer.id).some((f) => f.id === input.fieldId)) throw new TRPCError({ code: "NOT_FOUND", message: "Field not found" });
      if (input.date > iso(new Date(Date.now() + DAY))) throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot log a future irrigation" });
      const rec = { id: nextId("irr"), farmerId: farmer.id, fieldId: input.fieldId, date: input.date, mm: input.mm, note: input.note ?? null, createdAt: new Date() };
      farmTools().irrigationLogs.unshift(rec);
      return rec;
    }),

  deleteIrrigationLog: proc.input(z.object({ id: z.string().max(40) })).mutation(({ ctx, input }) => {
    const { farmer } = resolveFarmer(ctx.user);
    const st = farmTools();
    const i = st.irrigationLogs.findIndex((l) => l.id === input.id && l.farmerId === farmer.id);
    if (i < 0) throw new TRPCError({ code: "NOT_FOUND", message: "Log not found" });
    st.irrigationLogs.splice(i, 1);
    return { ok: true };
  }),

  /** Rain nowcast for the farm (15-minutely) + RainViewer radar frames. */
  nowcast: proc.query(async ({ ctx }) => {
    const { farmer } = resolveFarmer(ctx.user);
    const [nc, radar] = await Promise.all([withTimeout(getNowcast(farmer.lat, farmer.lon), 9000, null), withTimeout(getRadarFrames(), 8000, null)]);
    return { nowcast: nc, radar, center: { lat: farmer.lat, lon: farmer.lon }, updatedAt: new Date() };
  }),

  /** Crop calendar + seasonal outlook → best sowing window, varieties, expected harvest. */
  seasonPlanner: proc.input(z.object({ crop: z.string().max(20).optional() }).optional()).query(async ({ ctx, input }) => {
    const { farmer, district } = resolveFarmer(ctx.user);
    const fields = farmerFields(farmer.id);
    const cal = CALENDARS[district.country] ?? CALENDARS.BD!;
    const crops = Object.keys(cal.crops);
    const own = [...new Set(fields.map((f) => f.cropType as string))].filter((c) => crops.includes(c));
    const crop = input?.crop && crops.includes(input.crop) ? input.crop : own[0] ?? crops[0]!;
    const outlook = await withTimeout<{ months: OutlookMonth[]; source: string } | null>(getSeasonalOutlook(farmer.lat, farmer.lon), 15000, null);
    const cropFields = fields.filter((f) => f.cropType === crop);
    const floodRisk = cropFields.length ? Math.max(...cropFields.map((f) => f.floodRisk)) : district.floodRisk;
    const salinityRisk = cropFields.length ? Math.max(...cropFields.map((f) => f.salinityRisk)) : district.salinityRisk;
    const soilEc = cropFields.length ? Math.max(...cropFields.map((f) => f.soilEc)) : district.ecCurrent;
    const irrigated = cropFields.some((f) => f.irrigationType !== "rainfed");
    const plan = pickSowingWindow({ crop, country: district.country, today: new Date(), outlook: outlook?.months ?? [], floodRisk, salinityRisk, irrigated });
    const months = outlook?.months ?? [];
    const droughtSignal = months.slice(0, 4).some((m) => (m.rainAnomalyPct ?? 0) <= -25);
    const heatSignal = months.slice(0, 6).some((m) => (m.tempAnomalyC ?? 0) >= 1.2);
    const varieties = plan.plans.map((p) => ({
      seasonId: p.season.id,
      list: suggestVarieties({ crop, country: district.country, seasonId: p.season.id, floodRisk, salinityRisk, soilEc, droughtSignal, heatSignal }),
    }));
    return {
      crop,
      crops,
      ownCrops: own,
      country: district.country,
      outlook: months,
      outlookSource: outlook?.source ?? null,
      plans: plan.plans,
      bestSeasonId: plan.best?.season.id ?? null,
      varieties,
      risk: { floodRisk, salinityRisk, soilEc: Math.round(soilEc * 10) / 10, droughtSignal, heatSignal },
      calendarSource: plan.source,
      currentFields: cropFields.map((f) => ({ id: f.id, name: f.name, plantingDate: iso(f.plantingDate), harvestDate: iso(f.expectedHarvest) })),
    };
  }),

  /** WFP market prices near the farm (real data, 24 h cache). */
  marketPrices: proc.query(async ({ ctx }) => {
    const { farmer, district } = resolveFarmer(ctx.user);
    const c = countryByCode(district.country);
    const crops = [...new Set(farmerFields(farmer.id).map((f) => f.cropType as string).concat(farmer.primaryCrops))];
    let data: WfpCountryData | null = peekWfp(district.country);
    if (!data) {
      const errBox: { msg: string | null } = { msg: null };
      const res = await withTimeout<WfpCountryData | "timeout" | "error">(
        getWfpPrices(district.country).catch((e: Error) => {
          errBox.msg = e.message;
          return "error" as const;
        }),
        25000,
        "timeout"
      );
      const error = errBox.msg;
      if (res === "timeout") return { status: "loading" as const, country: c?.name ?? district.country, currency: c?.currency ?? "USD", commodities: [], alerts: [], lastDate: null, fetchedAt: null, source: "WFP VAM via HDX", error: null, csvUrl: null, missingCrops: [] as string[] };
      if (res === "error") return { status: "unavailable" as const, country: c?.name ?? district.country, currency: c?.currency ?? "USD", commodities: [], alerts: [], lastDate: null, fetchedAt: null, source: "WFP VAM via HDX", error, csvUrl: null, missingCrops: [] as string[] };
      data = res;
    }
    const analysis = analysisFor(data, farmer.id, { lat: farmer.lat, lon: farmer.lon }, crops);
    return {
      status: "ready" as const,
      country: c?.name ?? district.country,
      currency: analysis[0]?.currency ?? c?.currency ?? "USD",
      commodities: analysis,
      alerts: evaluateAlerts(farmer.id, analysis),
      lastDate: data.lastDate,
      fetchedAt: data.fetchedAt,
      source: data.source,
      error: null as string | null,
      csvUrl: data.csvUrl as string | null,
      /** farmer crops with no WFP price series in this country (e.g. jute) */
      missingCrops: crops.filter((cr) => !analysis.some((a) => a.forCrops.includes(cr))),
    };
  }),

  setPriceAlert: proc
    .input(z.object({ commodity: z.string().max(20), direction: z.enum(["above", "below"]), target: z.number().positive().max(1e9), unit: z.string().max(20) }))
    .mutation(({ ctx, input }) => {
      const { farmer } = resolveFarmer(ctx.user);
      const st = farmTools();
      if (st.priceAlerts.filter((a) => a.farmerId === farmer.id).length >= 20) throw new TRPCError({ code: "BAD_REQUEST", message: "Maximum 20 price alerts" });
      const rec = { id: nextId("pal"), farmerId: farmer.id, commodity: input.commodity, direction: input.direction, target: input.target, unit: input.unit, createdAt: new Date(), triggeredAt: null, lastPrice: null, active: true };
      st.priceAlerts.unshift(rec);
      return rec;
    }),

  deletePriceAlert: proc.input(z.object({ id: z.string().max(40) })).mutation(({ ctx, input }) => {
    const { farmer } = resolveFarmer(ctx.user);
    const st = farmTools();
    st.priceAlerts = st.priceAlerts.filter((a) => !(a.id === input.id && a.farmerId === farmer.id));
    return { ok: true };
  }),

  /** Weather/farm context used to weight Crop Doctor causes. */
  doctorContext: proc.query(({ ctx }) => doctorContextFor(ctx.user)),

  saveDoctorCase: proc
    .input(
      z.object({
        fieldId: z.string().max(40).nullable().optional(),
        crop: z.string().max(20),
        part: z.enum(["leaf", "stem", "root", "grain", "whole"]),
        symptoms: z.array(z.string().max(40)).min(1).max(10),
        photo: photoSchema.nullable().optional(),
        note: z.string().trim().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { farmer } = resolveFarmer(ctx.user);
      const dctx = await doctorContextFor(ctx.user);
      const results = diagnose(input.crop, input.symptoms, dctx).map((r) => ({ causeId: r.cause.id, score: r.score }));
      const rec = { id: nextId("dcs"), farmerId: farmer.id, fieldId: input.fieldId ?? null, crop: input.crop, part: input.part, symptoms: input.symptoms, results, photo: input.photo ?? null, note: input.note ?? null, status: "open" as const, createdAt: new Date() };
      const st = farmTools();
      st.doctorCases.unshift(rec);
      // cap photos per farmer to keep memory bounded
      const mine = st.doctorCases.filter((c) => c.farmerId === farmer.id && c.photo);
      for (const old of mine.slice(12)) old.photo = null;
      return { id: rec.id, results };
    }),

  listDoctorCases: proc.query(({ ctx }) => {
    const { farmer } = resolveFarmer(ctx.user);
    return farmTools()
      .doctorCases.filter((c) => c.farmerId === farmer.id)
      .slice(0, 30)
      .map((c) => ({ ...c, top: c.results[0] ? { ...c.results[0], name: causeById(c.results[0].causeId)?.name ?? c.results[0].causeId } : null }));
  }),

  updateDoctorCase: proc.input(z.object({ id: z.string().max(40), status: z.enum(["open", "treated", "resolved"]).optional(), remove: z.boolean().optional() })).mutation(({ ctx, input }) => {
    const { farmer } = resolveFarmer(ctx.user);
    const st = farmTools();
    const i = st.doctorCases.findIndex((c) => c.id === input.id && c.farmerId === farmer.id);
    if (i < 0) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
    if (input.remove) st.doctorCases.splice(i, 1);
    else if (input.status) st.doctorCases[i]!.status = input.status;
    return { ok: true };
  }),

  /** Season ledger with profit per field and category totals. */
  ledger: proc.query(({ ctx }) => {
    const { farmer, district } = resolveFarmer(ctx.user);
    const fields = farmerFields(farmer.id);
    const entries = farmTools().ledger.filter((e) => e.farmerId === farmer.id).sort((a, b) => b.date.localeCompare(a.date));
    const c = countryByCode(district.country);
    const suggestions = [...new Set(fields.map((f) => seasonLabel(district.country, f.cropType, f.plantingDate)))];
    return {
      currency: c?.currency ?? "USD",
      country: district.country,
      entries,
      summary: ledgerSummary(entries, fields.map((f) => ({ id: f.id, name: f.name, areaHa: f.areaHa, cropType: f.cropType }))),
      seasonSuggestions: [...new Set([...suggestions, ...entries.map((e) => e.season)])],
      fields: fields.map((f) => ({ id: f.id, name: f.name, crop: f.cropType, areaHa: f.areaHa })),
      categories: { expense: EXPENSE_CATEGORIES, income: INCOME_CATEGORIES },
      fertiliser: { prices: DEFAULT_PRICES[district.country] ?? DEFAULT_PRICES.BD!, crops: Object.keys(NUTRIENT_TARGETS) },
    };
  }),

  addLedgerEntry: proc
    .input(
      z.object({
        season: z.string().trim().min(2).max(40),
        fieldId: z.string().max(40).nullable(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        kind: z.enum(["expense", "income"]),
        category: z.enum([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES] as [LedgerCategory, ...LedgerCategory[]]),
        amount: z.number().positive().max(1e12),
        note: z.string().trim().max(200).optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      const { farmer } = resolveFarmer(ctx.user);
      if (input.fieldId && !farmerFields(farmer.id).some((f) => f.id === input.fieldId)) throw new TRPCError({ code: "NOT_FOUND", message: "Field not found" });
      const ok = input.kind === "expense" ? (EXPENSE_CATEGORIES as readonly string[]).includes(input.category) : (INCOME_CATEGORIES as readonly string[]).includes(input.category);
      if (!ok) throw new TRPCError({ code: "BAD_REQUEST", message: "Category does not match entry type" });
      const rec = { id: nextId("led"), farmerId: farmer.id, ...input, note: input.note ?? null, sample: false, createdAt: new Date() };
      farmTools().ledger.unshift(rec);
      return rec;
    }),

  deleteLedgerEntry: proc.input(z.object({ id: z.string().max(40) })).mutation(({ ctx, input }) => {
    const { farmer } = resolveFarmer(ctx.user);
    const st = farmTools();
    const n = st.ledger.length;
    st.ledger = st.ledger.filter((e) => !(e.id === input.id && e.farmerId === farmer.id));
    if (st.ledger.length === n) throw new TRPCError({ code: "NOT_FOUND", message: "Entry not found" });
    return { ok: true };
  }),

  /** Weather-index insurance offer derived from the insurer's live book. */
  insuranceOffer: proc.query(async ({ ctx }) => {
    const { farmer, district } = resolveFarmer(ctx.user);
    const s = getStore();
    const org = s.orgs.find((o) => o.id === "org-ins-deltamutual");
    const book = org ? insuranceBook(s.assets, org.id, org.name, district.id) : null;
    const c = countryByCode(district.country);
    const fx = c ? await withTimeout(getUsdRate(c.currency), 6000, null) : null;
    const fields = farmerFields(farmer.id).map((f) => {
      const perHa = book?.sumInsuredPerHaUsd[f.cropType] ?? null;
      const sumUsd = perHa ? Math.round(perHa * f.areaHa) : null;
      return { id: f.id, name: f.name, crop: f.cropType, areaHa: f.areaHa, sumInsuredUsd: sumUsd, premiumUsd: sumUsd && book ? Math.round(sumUsd * book.premiumRate) : null };
    });
    const requests = farmTools().insuranceRequests.filter((r) => r.farmerId === farmer.id);
    return {
      available: !!book && ["BD", "IN"].includes(district.country),
      book,
      fx: fx ? { currency: c!.currency, perUsd: fx, source: "open.er-api.com" } : null,
      fields,
      hasInsurance: farmer.hasInsurance,
      requests,
    };
  }),

  requestInsurance: proc
    .input(z.object({ fieldIds: z.array(z.string().max(40)).min(1).max(20), phone: z.string().trim().max(30).optional() }))
    .mutation(({ ctx, input }) => {
      const { farmer, district } = resolveFarmer(ctx.user);
      const s = getStore();
      const org = s.orgs.find((o) => o.id === "org-ins-deltamutual");
      const book = org ? insuranceBook(s.assets, org.id, org.name, district.id) : null;
      if (!org || !book) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No insurance product available in your area" });
      const fields = farmerFields(farmer.id).filter((f) => input.fieldIds.includes(f.id));
      if (!fields.length) throw new TRPCError({ code: "NOT_FOUND", message: "Field not found" });
      const st = farmTools();
      const dup = st.insuranceRequests.find((r) => r.farmerId === farmer.id && r.status === "requested" && r.fieldIds.some((id) => input.fieldIds.includes(id)));
      if (dup) throw new TRPCError({ code: "CONFLICT", message: "Enrolment already requested for this field" });
      const areaHa = Math.round(fields.reduce((a, f) => a + f.areaHa, 0) * 10) / 10;
      const sumUsd = Math.round(fields.reduce((a, f) => a + (book.sumInsuredPerHaUsd[f.cropType] ?? 900) * f.areaHa, 0));
      const premiumUsd = Math.round(sumUsd * book.premiumRate);
      const u = s.users.find((x) => x.id === farmer.userId);
      const crops = [...new Set(fields.map((f) => f.cropType))].join(", ");
      const n = notifyWorkspace({
        workspaceId: org.id,
        kind: "system",
        severity: "info",
        title: `Enrolment request: ${u?.name ?? "Farmer"} (${district.name})`,
        body: `${u?.name ?? "A farmer"} requests ${book.product} cover for ${fields.length} field(s) — ${crops}, ${areaHa} ha near ${farmer.lat.toFixed(3)}, ${farmer.lon.toFixed(3)}. Indicative sum insured USD ${sumUsd.toLocaleString("en")}, premium USD ${premiumUsd} (${(book.premiumRate * 100).toFixed(1)}%). Contact: ${input.phone || u?.phone || u?.email || "via Agri-SHIELD"}.`,
        href: "/app/insurance",
      });
      const rec = { id: nextId("ins"), farmerId: farmer.id, workspaceId: org.id, fieldIds: fields.map((f) => f.id), crop: crops, areaHa, sumInsuredUsd: sumUsd, premiumUsd, phone: input.phone ?? u?.phone ?? null, status: "requested" as const, notificationId: n.id, createdAt: new Date() };
      st.insuranceRequests.unshift(rec);
      audit({ userId: ctx.user.id, userName: ctx.user.name ?? "farmer", action: "insurance.enrolment_requested", entity: "insurance_request", entityId: rec.id, details: `${org.name} · ${areaHa} ha · USD ${sumUsd}` });
      return rec;
    }),

  /** Farmer asks the district extension officer. */
  askQuestion: proc
    .input(z.object({ text: z.string().trim().min(8).max(1000), crop: z.string().max(20).nullable().optional(), photo: photoSchema.nullable().optional() }))
    .mutation(({ ctx, input }) => {
      const { farmer, district, isDemoFallback } = resolveFarmer(ctx.user);
      if (isDemoFallback) throw new TRPCError({ code: "FORBIDDEN", message: "Preview accounts cannot post questions" });
      const s = getStore();
      const u = s.users.find((x) => x.id === farmer.userId);
      const rec = { id: nextId("qst"), farmerId: farmer.id, farmerName: u?.name ?? "Farmer", districtId: district.id, orgId: district.orgId, crop: input.crop ?? null, text: input.text, photo: input.photo ?? null, createdAt: new Date(), status: "open" as const, answers: [] };
      farmTools().questions.unshift(rec);
      notifyWorkspace({ workspaceId: district.orgId, kind: "system", severity: "info", title: `Farmer question · ${district.name}`, body: `${rec.farmerName}: ${input.text.slice(0, 280)}`, href: "/dashboard/government" });
      audit({ userId: ctx.user.id, userName: rec.farmerName, action: "farmer.question_asked", entity: "question", entityId: rec.id, details: district.name });
      return questionView(rec);
    }),

  /** Farmers: their own questions. Government roles: questions from their organisation's districts. */
  listQuestions: proc.input(z.object({ status: z.enum(["open", "answered", "all"]).default("all"), districtId: z.string().max(40).optional() }).optional()).query(({ ctx, input }) => {
    const st = farmTools();
    const role = ctx.user.role as UserRole;
    let list = st.questions;
    if (role === "farmer") {
      const { farmer } = resolveFarmer(ctx.user);
      list = list.filter((q) => q.farmerId === farmer.id);
    } else if (GOV_ROLES.includes(role)) {
      const orgId = (ctx.user as U).orgId ?? null;
      list = list.filter((q) => q.orgId === orgId);
    }
    if (input?.districtId) list = list.filter((q) => q.districtId === input.districtId);
    if (input?.status && input.status !== "all") list = list.filter((q) => q.status === input.status);
    return [...list].sort((a, b) => (a.status === b.status ? b.createdAt.getTime() - a.createdAt.getTime() : a.status === "open" ? -1 : 1)).slice(0, 100).map(questionView);
  }),

  /** Extension officers answer (government roles only, within their organisation). */
  answerQuestion: govProc.input(z.object({ id: z.string().max(40), text: z.string().trim().min(4).max(2000) })).mutation(({ ctx, input }) => {
    const q = farmTools().questions.find((x) => x.id === input.id);
    if (!q) throw new TRPCError({ code: "NOT_FOUND", message: "Question not found" });
    const orgId = (ctx.user as U).orgId ?? null;
    if (ctx.user.role !== "platform_admin" && q.orgId !== orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Question belongs to another organisation" });
    const s = getStore();
    const u = s.users.find((x) => x.id === ctx.user.id);
    q.answers.push({ id: nextId("ans"), by: ctx.user.id, byName: u?.name ?? ctx.user.name ?? "Officer", role: ctx.user.role, text: input.text, at: new Date() });
    q.status = "answered";
    audit({ userId: ctx.user.id, userName: u?.name ?? "officer", action: "farmer.question_answered", entity: "question", entityId: q.id, details: q.districtId });
    return questionView(q);
  }),

  /** One-glance "Today's actions": most important item from each tool. */
  todayActions: proc.query(async ({ ctx }) => {
    const { farmer, district } = resolveFarmer(ctx.user);
    const fields = farmerFields(farmer.id);
    const s = getStore();
    const [irr, nc] = await Promise.all([withTimeout(irrigationFor(ctx.user), 12000, null), withTimeout(getNowcast(farmer.lat, farmer.lon), 6000, null)]);
    type Item = { tool: "irrigation" | "alert" | "price" | "disease" | "rain" | "question"; priority: number; code: string; vars: Record<string, string | number>; href: string; source: string };
    const items: Item[] = [];

    // Irrigation — the most urgent field
    if (irr?.plans.length) {
      const ranked = irr.plans
        .filter((p) => p.plan)
        .map((p) => ({ p, n: p.plan!.next }))
        .sort((a, b) => (a.n.kind === "irrigate" ? (b.n.kind === "irrigate" ? a.n.date.localeCompare(b.n.date) : -1) : b.n.kind === "irrigate" ? 1 : 0));
      const top = ranked[0];
      if (top) {
        const n = top.n;
        const base = { field: top.p.field.name, crop: top.p.field.crop };
        if (n.kind === "irrigate") items.push({ tool: "irrigation", priority: n.date === irr.today ? 90 : 60, code: n.date === irr.today ? "irrigateToday" : "irrigateOn", vars: { ...base, mm: n.mm, date: n.date, m3: n.m3 }, href: "/dashboard/farmer/tools/irrigation", source: "FAO-56 · Open-Meteo" });
        else if (n.kind === "rain") items.push({ tool: "irrigation", priority: 30, code: "noIrrigationRain", vars: { ...base, date: n.date ?? "", mm: n.rainMm }, href: "/dashboard/farmer/tools/irrigation", source: "FAO-56 · Open-Meteo" });
        else if (n.kind === "drain") items.push({ tool: "irrigation", priority: 55, code: "drainBeforeHarvest", vars: base, href: "/dashboard/farmer/tools/irrigation", source: "IRRI AWD" });
        else items.push({ tool: "irrigation", priority: 20, code: "noIrrigation", vars: base, href: "/dashboard/farmer/tools/irrigation", source: "FAO-56 · Open-Meteo" });
      }
    }

    // Alerts — the most severe active district alert
    const now = Date.now();
    const rank: Record<string, number> = { emergency: 3, warning: 2, watch: 1 };
    const active = s.alerts.filter((a) => a.districtId === district.id && a.isActive && a.validUntil.getTime() > now).sort((a, b) => (rank[b.severity] ?? 0) - (rank[a.severity] ?? 0));
    if (active[0]) items.push({ tool: "alert", priority: 50 + (rank[active[0].severity] ?? 0) * 12, code: "alertActive", vars: { title: active[0].title, severity: active[0].severity, count: active.length }, href: "/dashboard/farmer/alerts", source: "Agri-SHIELD alerts" });

    // Rain nowcast
    if (nc && nc.rainInMinutes != null) items.push({ tool: "rain", priority: nc.raining ? 45 : nc.rainInMinutes <= 60 ? 70 : 35, code: nc.raining ? "rainNow" : "rainSoon", vars: { minutes: nc.rainInMinutes, mm: nc.totalMm }, href: "/dashboard/farmer/map?radar=1", source: nc.source });

    // Price — from cached WFP data only (never blocks the home screen)
    const wfp = peekWfp(district.country);
    if (wfp) {
      const crops = [...new Set(fields.map((f) => f.cropType as string).concat(farmer.primaryCrops))];
      const an = analysisFor(wfp, farmer.id, { lat: farmer.lat, lon: farmer.lon }, crops);
      const alerts = evaluateAlerts(farmer.id, an).filter((a) => a.hit);
      const main = an.find((c) => c.forCrops.length) ?? an[0];
      if (alerts[0]) items.push({ tool: "price", priority: 75, code: "priceAlertHit", vars: { commodity: alerts[0].commodity, price: alerts[0].lastPrice ?? 0, target: alerts[0].target, direction: alerts[0].direction }, href: "/dashboard/farmer/tools/market", source: wfp.source });
      else if (main?.latest) items.push({ tool: "price", priority: 25, code: main.advice.kind === "store" ? "priceStore" : main.advice.kind === "wait_short" ? "priceWait" : "priceSell", vars: { commodity: main.key, price: main.latest.price, unit: main.unit, currency: main.currency, market: main.latest.market, month: main.latest.month, gain: main.advice.expectedGainPct ?? 0 }, href: "/dashboard/farmer/tools/market", source: `WFP · ${main.latest.month}` });
    }

    // Disease weather risk (humid spell on a susceptible crop stage)
    if (irr?.feed) {
      const next5 = irr.feed.daily.filter((d) => d.forecast).slice(0, 5);
      const wet = next5.filter((d) => (d.rainMm >= 2 || (d.rainProb ?? 0) >= 60) && (d.tMin ?? 0) >= 18 && (d.tMin ?? 0) <= 28).length;
      const rice = irr.plans.find((p) => p.field.crop === "rice" && p.plan && ["development", "mid"].includes(p.plan.stage));
      const cropAtRisk = rice ?? irr.plans.find((p) => p.plan && ["development", "mid"].includes(p.plan.stage));
      if (cropAtRisk && wet >= 2) items.push({ tool: "disease", priority: wet >= 3 ? 65 : 40, code: wet >= 3 ? "diseaseHigh" : "diseaseMedium", vars: { field: cropAtRisk.field.name, crop: cropAtRisk.field.crop, days: wet, disease: cropAtRisk.field.crop === "rice" ? "blast / bacterial blight" : "leaf diseases" }, href: "/dashboard/farmer/tools/doctor", source: "Open-Meteo · heuristic" });
      else if (cropAtRisk) items.push({ tool: "disease", priority: 10, code: "diseaseLow", vars: { field: cropAtRisk.field.name, crop: cropAtRisk.field.crop }, href: "/dashboard/farmer/tools/doctor", source: "Open-Meteo · heuristic" });
    }

    // Answered question not yet seen
    const ans = farmTools().questions.find((q) => q.farmerId === farmer.id && q.status === "answered" && now - (q.answers[q.answers.length - 1]?.at.getTime() ?? 0) < 14 * DAY);
    if (ans) items.push({ tool: "question", priority: 35, code: "questionAnswered", vars: { officer: ans.answers[ans.answers.length - 1]!.byName }, href: "/dashboard/farmer/tools/ask", source: "Extension officer" });

    return { items: items.sort((a, b) => b.priority - a.priority), today: irr?.today ?? iso(new Date()), marketLoaded: !!wfp, updatedAt: new Date() };
  }),
};
