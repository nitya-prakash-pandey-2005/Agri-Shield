/**
 * Creates a brand-new organisation workspace (enterprise self-serve sign-up
 * and platform-admin provisioning): org record with industry + settings,
 * 14-day Business trial subscription, the first admin user, a welcome
 * notification and a welcome email.
 */
import { TRPCError } from "@trpc/server";
import type { Industry, SupportedLanguage } from "@agri-shield/types";
import { audit, getStore, nextId, type OrgRecord, type UserRecord, type WorkspaceSettings } from "../data/store";
import { COUNTRIES } from "../data/geography";
import { sendEmail } from "../notify/channels";
import { monthStart } from "./usage";
import { notifyWorkspace } from "./workspace-notifications";
import { profileFor, workspaceShapeFor, wsState } from "./workspace-state";

export const TRIAL_DAYS = 14;

export const COUNTRY_DEFAULTS: Record<string, { tz: string; currency: string; locale: string; center: [number, number]; zoom: number }> = {
  Bangladesh: { tz: "Asia/Dhaka", currency: "BDT", locale: "en-BD", center: [23.7, 90.3], zoom: 7 },
  India: { tz: "Asia/Kolkata", currency: "INR", locale: "en-IN", center: [21.5, 82], zoom: 5 },
  Vietnam: { tz: "Asia/Ho_Chi_Minh", currency: "VND", locale: "vi-VN", center: [14.5, 106], zoom: 6 },
  Philippines: { tz: "Asia/Manila", currency: "PHP", locale: "en-PH", center: [12.8, 122], zoom: 6 },
  Indonesia: { tz: "Asia/Jakarta", currency: "IDR", locale: "id-ID", center: [-2.5, 118], zoom: 5 },
  "Sri Lanka": { tz: "Asia/Colombo", currency: "LKR", locale: "en-LK", center: [7.8, 80.7], zoom: 7 },
  Nepal: { tz: "Asia/Kathmandu", currency: "NPR", locale: "en-NP", center: [28.2, 84], zoom: 7 },
  Pakistan: { tz: "Asia/Karachi", currency: "PKR", locale: "en-PK", center: [29.5, 69.5], zoom: 5 },
  Thailand: { tz: "Asia/Bangkok", currency: "THB", locale: "th-TH", center: [15, 101], zoom: 6 },
  Myanmar: { tz: "Asia/Yangon", currency: "MMK", locale: "en-MM", center: [19.5, 96], zoom: 6 },
  Cambodia: { tz: "Asia/Phnom_Penh", currency: "KHR", locale: "en-KH", center: [12.5, 105], zoom: 7 },
  Singapore: { tz: "Asia/Singapore", currency: "SGD", locale: "en-SG", center: [1.35, 103.8], zoom: 10 },
  Kenya: { tz: "Africa/Nairobi", currency: "KES", locale: "en-KE", center: [0.2, 37.9], zoom: 6 },
  Nigeria: { tz: "Africa/Lagos", currency: "NGN", locale: "en-NG", center: [9, 8], zoom: 6 },
  Ethiopia: { tz: "Africa/Addis_Ababa", currency: "ETB", locale: "en-ET", center: [9, 39.5], zoom: 6 },
  Ghana: { tz: "Africa/Accra", currency: "GHS", locale: "en-GH", center: [7.9, -1], zoom: 7 },
  Brazil: { tz: "America/Sao_Paulo", currency: "BRL", locale: "pt-BR", center: [-12, -52], zoom: 4 },
  Mexico: { tz: "America/Mexico_City", currency: "MXN", locale: "es-MX", center: [23.5, -102], zoom: 5 },
  "United Kingdom": { tz: "Europe/London", currency: "GBP", locale: "en-GB", center: [54, -2.5], zoom: 6 },
  "United States": { tz: "America/New_York", currency: "USD", locale: "en-US", center: [39, -97], zoom: 4 },
};

export const SIGNUP_COUNTRIES = Object.keys(COUNTRY_DEFAULTS).concat("Other");

export function defaultSettings(country: string): WorkspaceSettings {
  const d = COUNTRY_DEFAULTS[country];
  const c = COUNTRIES.find((x) => x.name === country);
  return {
    units: country === "United States" ? "imperial" : "metric",
    timezone: d?.tz ?? "UTC",
    currency: d?.currency ?? "USD",
    locale: d?.locale ?? "en-US",
    defaultCenter: d?.center ?? c?.center ?? [15, 100],
    defaultZoom: d?.zoom ?? 4,
    riskThreshold: 60,
    weeklyDigest: true,
  };
}

export function shortNameFor(name: string): string {
  const words = name.split(/\s+/).filter((w) => w.length > 1 && !/^(ltd|llc|pte|jsc|inc|co|the|of|and)\.?$/i.test(w));
  if (words.length === 1) return words[0]!.slice(0, 12);
  return words.map((w) => w[0]).join("").slice(0, 6).toUpperCase();
}

export async function provisionWorkspace(input: {
  orgName: string;
  industry: Industry;
  country: string;
  name: string;
  email: string;
  password: string;
  title?: string;
  language?: SupportedLanguage;
}): Promise<{ org: OrgRecord; user: UserRecord }> {
  const s = getStore();
  const email = input.email.trim().toLowerCase();
  if (s.users.some((u) => u.email?.toLowerCase() === email)) throw new TRPCError({ code: "CONFLICT", message: "An account with this email already exists — sign in instead." });
  if (s.orgs.some((o) => o.name.trim().toLowerCase() === input.orgName.trim().toLowerCase())) throw new TRPCError({ code: "CONFLICT", message: "A workspace with this organisation name already exists. Ask its admin for an invite." });

  const now = new Date();
  const shape = workspaceShapeFor(input.industry);
  const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 86_400_000);
  const org: OrgRecord = {
    id: nextId("org"),
    name: input.orgName.trim(),
    shortName: shortNameFor(input.orgName.trim()),
    type: shape.type,
    country: input.country,
    region: null,
    verified: false,
    planTier: "business",
    createdAt: now,
    industry: input.industry,
    settings: defaultSettings(input.country),
    usage: { periodStart: monthStart(now), assessments: 0, apiCalls: 0, reports: 0, messages: 0 },
    trialEndsAt,
  };
  s.orgs.push(org);
  s.subscriptions.unshift({ id: nextId("sub"), userId: null, orgId: org.id, plan: "business", status: "trialing", mrrUsd: 0, currentPeriodEnd: trialEndsAt, provider: "none" });
  wsState().planEvents.push({ orgId: org.id, at: now, plan: "business", status: "trialing", note: `${TRIAL_DAYS}-day Business trial started at sign-up` });
  profileFor(org);

  const user: UserRecord = {
    id: nextId("user"),
    email,
    phone: null,
    name: input.name.trim(),
    role: shape.adminRole,
    language: input.language ?? "en",
    orgId: org.id,
    subscriptionTier: "business",
    status: "active",
    createdAt: now,
    lastActive: now,
    password: input.password,
    title: input.title?.trim() || "Workspace owner",
  };
  s.users.push(user);

  notifyWorkspace({
    workspaceId: org.id,
    userId: null,
    kind: "system",
    title: `Welcome to Agri-SHIELD, ${org.shortName}`,
    body: `Your ${TRIAL_DAYS}-day Business trial is active until ${trialEndsAt.toISOString().slice(0, 10)}. Follow the checklist on Home to get set up in 5 minutes.`,
    href: "/app",
    severity: "success",
  });
  audit({ userId: user.id, userName: user.name, action: "workspace.create", entity: "organization", entityId: org.id, details: `${org.name} (${input.industry}, ${input.country}) — Business trial` });
  await sendEmail(
    email,
    `Your Agri-SHIELD workspace for ${org.name} is ready`,
    `<p>Hi ${input.name.split(" ")[0]},</p><p>Your workspace <b>${org.name.replace(/</g, "&lt;")}</b> is ready with a ${TRIAL_DAYS}-day Business trial (no card needed).</p><p>Next steps: add your first assets, invite a teammate and set an alert rule.</p><p>— Nitya Prakash Pandey, Agri-SHIELD</p>`
  ).catch(() => undefined);
  return { org, user };
}
