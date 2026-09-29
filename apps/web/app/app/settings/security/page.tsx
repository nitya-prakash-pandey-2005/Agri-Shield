"use client";

/**
 * Settings → Security. Personal (2-step verification, sessions) for everyone;
 * workspace controls (score card, 2FA policy, members & sessions, custom roles,
 * SSO, IP allow-list, audit export, data export/deletion) for admins.
 */
import { Suspense, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import { motion } from "framer-motion";
import { Database, Fingerprint, Gauge, Globe2, ShieldCheck, UserCog, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Skeleton } from "@/components/hud";
import { cn } from "@/lib/utils";
import { ScoreCard } from "./_components/ScoreCard";
import { SessionsPanel, TwoFactorPanel } from "./_components/AccountPanel";
import { MembersPanel, PolicyPanel } from "./_components/MembersPanel";
import { RolesPanel } from "./_components/RolesPanel";
import { SsoPanel } from "./_components/SsoPanel";
import { AuditExportPanel, IpAllowlistPanel } from "./_components/NetworkPanel";
import { DataPanel } from "./_components/DataPanel";

const VIEWS = [
  { id: "overview", label: "Overview", icon: Gauge, admin: true },
  { id: "account", label: "Your account", icon: ShieldCheck, admin: false },
  { id: "members", label: "Members & 2FA", icon: Users, admin: true },
  { id: "roles", label: "Roles", icon: UserCog, admin: true },
  { id: "sso", label: "Single sign-on", icon: Fingerprint, admin: true },
  { id: "network", label: "Network & audit", icon: Globe2, admin: true },
  { id: "data", label: "Data", icon: Database, admin: false },
] as const;

function SecurityInner() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const utils = trpc.useUtils();
  const ov = trpc.developer.security.overview.useQuery(undefined, { refetchInterval: 30_000 });
  const canManage = !!ov.data?.canManage;
  const score = trpc.developer.security.score.useQuery(undefined, { enabled: canManage });

  // A revoked session gets UNAUTHORIZED on its next request → send it to sign-in
  useEffect(() => {
    const code = (ov.error?.data as { code?: string } | undefined)?.code;
    if (code === "UNAUTHORIZED") void signOut({ callbackUrl: `/auth/signin?callbackUrl=${encodeURIComponent(pathname)}` });
  }, [ov.error, pathname]);

  const views = VIEWS.filter((v) => canManage || !v.admin);
  const requested = params?.get("view");
  const view = views.find((v) => v.id === requested)?.id ?? (canManage ? "overview" : "account");
  const go = (v: string) => {
    if (v === "api") return router.push("/app/developers?tab=keys");
    router.replace(`${pathname}?view=${v}`, { scroll: false });
  };
  const refresh = () => {
    void utils.developer.security.overview.invalidate();
    void utils.developer.security.score.invalidate();
  };

  if (ov.error && (ov.error.data as { code?: string } | undefined)?.code === "FORBIDDEN")
    return <div className="hud-panel p-5 text-sm text-rose-200">{ov.error.message}</div>;
  const d = ov.data;
  if (!d) return <div className="grid gap-4 lg:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-56" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <p className="max-w-3xl text-[13px] leading-relaxed text-slate-400">
          <b className="text-slate-200">What this means for you:</b> {canManage ? "control who can get into this workspace and how — 2-step verification, company single sign-on, network restrictions and exactly what each role can do. Every change is recorded in the audit log." : "protect your own account with an authenticator app and see every device you're signed in on. Your workspace admins manage the rest."}
        </p>
      </div>

      <nav aria-label="Security sections" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {views.map((v) => (
          <button
            key={v.id}
            onClick={() => go(v.id)}
            className={cn("relative flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] transition-colors", view === v.id ? "text-slate-950" : "text-slate-400 hover:bg-white/5 hover:text-slate-200")}
            aria-current={view === v.id ? "page" : undefined}
          >
            {view === v.id && <motion.span layoutId="sec-view" className="absolute inset-0 rounded-lg bg-cyan-400" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
            <v.icon size={13} className="relative" />
            <span className="relative">{v.label}</span>
          </button>
        ))}
      </nav>

      <motion.div key={view} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="space-y-4">
        {view === "overview" && (
          <>
            {score.data ? <ScoreCard score={score.data} onNavigate={go} /> : <Skeleton className="h-56" />}
            <div className="grid gap-4 lg:grid-cols-2">
              <TwoFactorPanel d={d} refresh={refresh} />
              <PolicyPanel require2fa={d.policy.require2fa} since={d.policy.require2faSince} members={score.data?.members ?? 0} enrolled={score.data?.enrolled ?? 0} onChanged={refresh} />
            </div>
          </>
        )}
        {view === "account" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <TwoFactorPanel d={d} refresh={refresh} />
            <SessionsPanel d={d} refresh={refresh} />
          </div>
        )}
        {view === "members" && (
          <>
            <PolicyPanel require2fa={d.policy.require2fa} since={d.policy.require2faSince} members={score.data?.members ?? 0} enrolled={score.data?.enrolled ?? 0} onChanged={refresh} />
            <MembersPanel onChanged={refresh} />
          </>
        )}
        {view === "roles" && <RolesPanel onChanged={refresh} />}
        {view === "sso" && <SsoPanel orgShort={d.org?.name.split(" ")[0] ?? "company"} onChanged={refresh} />}
        {view === "network" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <IpAllowlistPanel policy={d.policy.ipAllowlist} currentIp={d.currentIp} onChanged={refresh} />
            <AuditExportPanel />
          </div>
        )}
        {view === "data" && <DataPanel />}
      </motion.div>
    </div>
  );
}

export default function SecuritySettings() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <SecurityInner />
    </Suspense>
  );
}
