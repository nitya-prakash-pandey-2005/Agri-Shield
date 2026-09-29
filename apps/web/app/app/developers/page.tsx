"use client";

/** Developers module: API explorer, usage analytics, webhook inspector, sandbox keys. */
import { Suspense, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import { motion } from "framer-motion";
import { BarChart3, BookOpen, KeyRound, Terminal, Webhook } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { SectionHeader, Skeleton } from "@/components/hud";
import { ApiExplorer } from "@/components/developers/ApiExplorer";
import { UsagePanel } from "@/components/developers/UsagePanel";
import { WebhookInspector } from "@/components/developers/WebhookInspector";
import { KeysPanel } from "@/components/developers/KeysPanel";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "explorer", label: "API explorer", icon: Terminal },
  { id: "usage", label: "Usage", icon: BarChart3 },
  { id: "webhooks", label: "Webhooks", icon: Webhook },
  { id: "keys", label: "Keys & sandbox", icon: KeyRound },
] as const;

function Developers() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = TABS.find((t) => t.id === params?.get("tab"))?.id ?? "explorer";
  const ping = trpc.developer.ping.useQuery(undefined, { retry: false });
  useEffect(() => {
    const code = (ping.error?.data as { code?: string } | undefined)?.code;
    if (code === "UNAUTHORIZED") void signOut({ callbackUrl: `/auth/signin?callbackUrl=${encodeURIComponent(pathname)}` });
  }, [ping.error, pathname]);

  return (
    <div>
      <SectionHeader
        eyebrow="Workspace"
        title="Developers"
        description={
          <>
            Build on Agri-SHIELD: try every REST endpoint live, watch your integration's usage and webhook deliveries, and create sandbox keys. New here? Read the{" "}
            <Link href="/developers" className="text-cyan-300 hover:underline">
              developer portal
            </Link>
            .
          </>
        }
        actions={
          <Link href="/developers" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-[13px] text-slate-200 hover:border-cyan-400/50">
            <BookOpen size={14} /> Docs &amp; quickstarts
          </Link>
        }
      />
      {ping.error && (ping.error.data as { code?: string } | undefined)?.code === "FORBIDDEN" ? (
        <div className="hud-panel p-5 text-sm text-rose-200">{ping.error.message}</div>
      ) : (
        <>
          <nav className="-mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-white/5 px-1 pb-px" aria-label="Developer sections">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => router.replace(`${pathname}?tab=${t.id}`, { scroll: false })} className={cn("relative flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-sm transition-colors", tab === t.id ? "text-white" : "text-slate-400 hover:text-slate-200")}>
                <t.icon size={14} className={tab === t.id ? "text-cyan-300" : ""} />
                {t.label}
                {tab === t.id && <motion.span layoutId="dev-tab" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-cyan-400" />}
              </button>
            ))}
          </nav>
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
            {tab === "explorer" && <ApiExplorer initialOp={params?.get("op")} />}
            {tab === "usage" && <UsagePanel />}
            {tab === "webhooks" && <WebhookInspector />}
            {tab === "keys" && <KeysPanel />}
          </motion.div>
        </>
      )}
    </div>
  );
}

export default function DevelopersPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Developers />
    </Suspense>
  );
}
