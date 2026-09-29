"use client";

/**
 * Top-bar notification bell for workspace users: live unread badge (realtime
 * `notification.created` on ws:<orgId>), dropdown list, mark read / mark all
 * read, click-through. Renders nothing for users without a workspace.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { AlertOctagon, AlertTriangle, Bell, BellRing, CheckCheck, CheckCircle2, FileText, Info, Users, Wallet, Zap } from "lucide-react";
import { toast } from "sonner";
import { can } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { useRealtime } from "@/hooks/useRealtime";

export const SEVERITY_STYLE: Record<string, { color: string; icon: typeof Info }> = {
  critical: { color: "#f87171", icon: AlertOctagon },
  warning: { color: "#fbbf24", icon: AlertTriangle },
  success: { color: "#4ade80", icon: CheckCircle2 },
  info: { color: "#38bdf8", icon: Info },
};
export const KIND_ICON: Record<string, typeof Info> = { alert: AlertTriangle, rule: Zap, system: Info, report: FileText, billing: Wallet, team: Users };

export function ago(d: Date | string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function NotificationBell() {
  const { data: session } = useSession();
  const orgId = session?.user?.orgId ?? null;
  const enabled = !!orgId && can(session?.user?.role, "use_workspace");
  if (!enabled) return null;
  return <BellInner orgId={orgId!} />;
}

function BellInner({ orgId }: { orgId: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [pulse, setPulse] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const count = trpc.portfolio.notifications.unreadCount.useQuery(undefined, { refetchInterval: 120_000, retry: false });
  const list = trpc.portfolio.notifications.list.useQuery({ limit: 15, unreadOnly }, { enabled: open, retry: false });
  const invalidate = () => {
    utils.portfolio.notifications.unreadCount.invalidate();
    utils.portfolio.notifications.list.invalidate();
  };
  const markRead = trpc.portfolio.notifications.markRead.useMutation({ onSuccess: invalidate });
  const markAll = trpc.portfolio.notifications.markAllRead.useMutation({ onSuccess: invalidate });

  useRealtime([`ws:${orgId}`], (env) => {
    const e = env.event as unknown as { type: string; title?: string; body?: string; severity?: string; href?: string | null; userId?: string | null };
    if (e.type !== "notification.created") return;
    invalidate();
    setPulse((p) => p + 1);
    const fn = e.severity === "critical" ? toast.error : e.severity === "warning" ? toast.warning : e.severity === "success" ? toast.success : toast.info;
    fn(e.title ?? "New notification", { description: e.body?.slice(0, 140), action: e.href ? { label: "Open", onClick: () => router.push(e.href!) } : undefined });
  });

  useEffect(() => {
    if (!open) return;
    const close = (ev: MouseEvent) => !ref.current?.contains(ev.target as Node) && setOpen(false);
    const esc = (ev: KeyboardEvent) => ev.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const n = count.data?.count ?? 0;
  const Icon = n > 0 ? BellRing : Bell;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn("relative grid h-9 w-9 place-items-center rounded-lg text-slate-300 transition-colors hover:bg-white/5 hover:text-white", open && "bg-white/5 text-white")}
        aria-label={`Notifications${n ? ` (${n} unread)` : ""}`}
        aria-expanded={open}
        data-testid="notification-bell"
      >
        <motion.span key={pulse} initial={pulse ? { rotate: -18 } : false} animate={{ rotate: [0, 14, -10, 6, 0] }} transition={{ duration: 0.6 }}>
          <Icon size={18} />
        </motion.span>
        <AnimatePresence>
          {n > 0 && (
            <motion.span
              key="badge"
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              className="telemetry absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-rose-500 px-1 text-center text-[10px] font-semibold leading-[18px] text-white shadow-[0_0_12px_rgba(244,63,94,0.7)]"
              data-testid="notification-count"
            >
              <motion.span key={n} className="inline-block" initial={{ scale: 1.6 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 18 }}>
                {n > 99 ? "99+" : n}
              </motion.span>
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="fixed left-2 right-2 top-14 z-[1100] origin-top-right overflow-hidden rounded-xl border border-white/10 bg-[#070d1c]/95 shadow-2xl backdrop-blur-xl sm:absolute sm:left-auto sm:right-0 sm:top-11 sm:w-[380px]"
            role="menu"
          >
            <div className="flex items-center justify-between gap-2 border-b border-white/5 px-4 py-3">
              <div>
                <div className="font-display text-sm font-semibold text-white">Notifications</div>
                <div className="text-[11px] text-slate-500">{n ? `${n} unread` : "You're all caught up"}</div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setUnreadOnly((u) => !u)} className={cn("rounded-md px-2 py-1 text-[11px]", unreadOnly ? "bg-sky-400/15 text-sky-300" : "text-slate-400 hover:text-white")}>
                  Unread
                </button>
                <button onClick={() => markAll.mutate()} disabled={!n || markAll.isPending} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-slate-400 hover:text-white disabled:opacity-40" title="Mark all as read">
                  <CheckCheck size={13} /> All read
                </button>
              </div>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {list.isLoading ? (
                <div className="space-y-2 p-4">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="skeleton h-12 rounded-lg" />
                  ))}
                </div>
              ) : !list.data?.items.length ? (
                <div className="px-6 py-10 text-center">
                  <Bell size={22} className="mx-auto mb-2 text-slate-600" />
                  <div className="text-sm text-slate-300">{unreadOnly ? "No unread notifications" : "No notifications yet"}</div>
                  <div className="mt-1 text-xs text-slate-500">Rule firings, imports, reports and billing notices appear here in real time.</div>
                </div>
              ) : (
                <ul className="divide-y divide-white/5">
                  {list.data.items.map((it) => {
                    const sev = SEVERITY_STYLE[it.severity] ?? SEVERITY_STYLE.info!;
                    const KIcon = KIND_ICON[it.kind] ?? Info;
                    return (
                      <li key={it.id}>
                        <button
                          onClick={() => {
                            if (!it.read) markRead.mutate({ ids: [it.id] });
                            setOpen(false);
                            if (it.href) router.push(it.href);
                          }}
                          className={cn("flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.03]", !it.read && "bg-sky-400/[0.04]")}
                        >
                          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg" style={{ background: `${sev.color}1f`, color: sev.color }}>
                            <KIcon size={14} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-start gap-2">
                              <span className={cn("line-clamp-2 flex-1 text-[13px] leading-snug", it.read ? "text-slate-300" : "font-medium text-white")}>{it.title}</span>
                              <span className="telemetry shrink-0 text-[10px] text-slate-500">{ago(it.createdAt)}</span>
                            </span>
                            <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-slate-400">{it.body}</span>
                          </span>
                          {!it.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-sky-400" aria-label="unread" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <Link href="/app/alerts?tab=inbox" onClick={() => setOpen(false)} className="block border-t border-white/5 px-4 py-2.5 text-center text-xs text-sky-300 hover:bg-white/[0.03]">
              Open notification inbox →
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default NotificationBell;
