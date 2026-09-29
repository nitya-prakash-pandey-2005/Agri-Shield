/**
 * Registration + OTP issuing. Sign-in itself goes through NextAuth credentials.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, protectedProcedure, router } from "../trpc";
import { getStore, nextId, audit, type UserRecord } from "../data/store";
import { issueOtp } from "../auth/otp";
import { normalizePhone, phonesMatch } from "../auth/phone";
import { sendSms } from "../notify/channels";
import { provisionWorkspace } from "../services/workspace-provision";

const LANGS = ["en", "hi", "bn", "vi", "fil", "id", "ta", "si"] as const;

export const authRouter = router({
  requestOtp: publicProcedure
    .input(z.object({ identifier: z.string().min(5).max(128) }))
    .mutation(async ({ input }) => {
      const id = input.identifier.replace(/\s/g, "").toLowerCase();
      const code = issueOtp(id);
      if (!id.includes("@")) await sendSms(normalizePhone(input.identifier), `Your Agri-SHIELD code is ${code}. Valid 10 minutes.`);
      const demo = process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
      return { sent: true, channel: id.includes("@") ? "email" : "sms", demoHint: demo ? "Demo mode: use 123456" : null };
    }),

  register: publicProcedure
    .input(
      z.object({
        name: z.string().min(2).max(80),
        role: z.enum(["farmer", "field_officer", "supply_chain_analyst"]),
        email: z.string().email().optional(),
        phone: z.string().min(7).max(20).optional(),
        password: z.string().min(8).max(128).optional(),
        organization: z.string().min(2).max(120).optional(),
        country: z.string().max(60).optional(),
        language: z.enum(LANGS).default("en"),
        referralCode: z.string().max(32).optional(),
      })
    )
    .mutation(({ input }) => {
      const s = getStore();
      if (!input.email && !input.phone) throw new TRPCError({ code: "BAD_REQUEST", message: "Email or phone required" });
      const exists = s.users.find(
        (u) => (input.email && u.email?.toLowerCase() === input.email.toLowerCase()) || (input.phone && phonesMatch(u.phone, input.phone))
      );
      if (exists) throw new TRPCError({ code: "CONFLICT", message: "An account with this email/phone already exists" });

      let orgId: string | null = null;
      if (input.role !== "farmer" && input.organization) {
        orgId = nextId("org");
        s.orgs.push({
          id: orgId,
          name: input.organization,
          shortName: input.organization.split(" ").map((w) => w[0]).join("").slice(0, 6).toUpperCase(),
          type: input.role === "field_officer" ? "government" : "supply_chain",
          country: input.country ?? "—",
          region: null,
          verified: false,
          planTier: input.role === "field_officer" ? "gov_basic" : "supply_chain",
          createdAt: new Date(),
        });
      }
      const user: UserRecord = {
        id: nextId("user"),
        email: input.email?.toLowerCase() ?? null,
        phone: input.phone ? normalizePhone(input.phone) : null,
        name: input.name,
        role: input.role,
        language: input.language,
        orgId,
        subscriptionTier: input.role === "farmer" ? "free" : input.role === "field_officer" ? "gov_basic" : "supply_chain",
        status: input.role === "farmer" ? "active" : "pending_verification",
        createdAt: new Date(),
        lastActive: new Date(),
        password: input.password,
      };
      // Org users can explore their dashboard while verification is pending (trial)
      if (user.status === "pending_verification") user.status = "active";
      s.users.push(user);
      if (input.referralCode) {
        const referrer = s.farmers.find((f) => f.referralCode.toLowerCase() === input.referralCode!.toLowerCase());
        if (referrer) referrer.referrals += 1;
      }
      audit({ userId: user.id, userName: user.name, action: "user.register", entity: "user", entityId: user.id, details: `Registered as ${user.role}` });
      return { userId: user.id, requiresVerification: input.role !== "farmer", orgId };
    }),

  /**
   * Enterprise self-serve sign-up: creates an organisation workspace
   * (industry, settings, 14-day Business trial) with the caller as its admin.
   */
  registerWorkspace: publicProcedure
    .input(
      z.object({
        orgName: z.string().trim().min(2).max(120),
        industry: z.enum(["insurance", "banking", "agribusiness", "government", "ngo", "cooperative"]),
        country: z.string().trim().min(2).max(60),
        name: z.string().trim().min(2).max(80),
        title: z.string().trim().max(80).optional(),
        email: z.string().trim().email().max(120),
        password: z.string().min(8).max(128),
        language: z.enum(LANGS).default("en"),
        website: z.string().max(0).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { org, user } = await provisionWorkspace(input);
      return { userId: user.id, orgId: org.id, role: user.role, trialEndsAt: org.trialEndsAt ?? null };
    }),

  me: protectedProcedure.query(({ ctx }) => {
    const s = getStore();
    const u = s.users.find((x) => x.id === ctx.user.id);
    const org = u?.orgId ? s.orgs.find((o) => o.id === u.orgId) : null;
    return u ? { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, language: u.language, subscriptionTier: u.subscriptionTier, org } : null;
  }),

  setLanguage: protectedProcedure.input(z.object({ language: z.enum(LANGS) })).mutation(({ ctx, input }) => {
    const u = getStore().users.find((x) => x.id === ctx.user.id);
    if (u) u.language = input.language;
    return { ok: true };
  }),
});
