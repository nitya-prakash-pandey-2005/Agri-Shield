"use client";

/**
 * Alerts & Rules — the workspace alert-rule engine and notification centre:
 *   Rules    · plain-language rule cards, enable/disable, dry-run, run now, edit, delete
 *   History  · every firing with per-channel delivery receipts
 *   Inbox    · all notifications (rule firings, imports, reports, billing, team)
 */
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, CheckCheck, ChevronDown, Clock, FlaskConical, History, Inbox, Pencil, Play, Plus, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, Panel, RiskPill, Skeleton, StatTile } from "@/components/hud";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { useRealtime } from "@/hooks/useRealtime";
import { cn } from "@/lib/utils";
import { RuleBuilder, type RulePrefill } from "@/components/portfolio/rules/RuleBuilder";
import { fmtUsd, timeAgo } from "@/components/portfolio/format";
import { PageTitle, PfButton, QueryError, Segmented, Toggle } from "@/components/portfolio/ui";
import { KIND_ICON, SEVERITY_STYLE } from "@/components/notifications/NotificationBell";

type Rule = RouterOutputs["portfolio"]["listRules"][number];
type Tab = "rules" | "history" | "inbox";

export default function AlertsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[480px]" />}>
      <AlertsInner />
    </Suspense>
  );
}

const SEV_COLOR: Record<string, string> = { info: "#38bdf8", warning: "#fbbf24", critical: "#f87171" };

function AlertsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: session } = useSession();
  const orgId = session?.user?.orgId ?? null;
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "rules");
  const [builder, setBuilder] = useState<{ open: boolean; rule: Rule | null }>({ open: params.get("new") === "1", rule: null });
  const meta = trpc.portfolio.meta.useQuery(undefined, { staleTime: 3600_000 });
  // Deep link: /app/alerts?new=1&metric=flood_prob_72h&op=>&value=60&tags=coastal|types=|countries=|assetIds=|place=
  const prefill = useMemo<RulePrefill | null>(() => {
    if (params.get("new") !== "1") return null;
    const list = (k: string) => (params.get(k) ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    const v = params.get("value");
    return {
      metric: params.get("metric") ?? undefined,
      op: params.get("op") ?? undefined,
      value: v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined,
      tags: list("tags").concat(list("tag")),
      types: list("types"),
      countries: list("countries"),
      assetIds: list("assetIds"),
      place: params.get("place") ?? undefined,
      name: params.get("name") ?? undefined,
      severity: params.get("severity") ?? undefined,
    };
  }, [params]);
  const rules = trpc.portfolio.listRules.useQuery();
  const history = trpc.portfolio.getRuleHistory.useQuery({ limit: 200 });
  const unread = trpc.portfolio.notifications.unreadCount.useQuery();
  const canWrite = meta.data?.canWrite ?? false;

  useEffect(() => {
    const t = params.get("tab") as Tab | null;
    if (t && t !== tab) setTab(t);
    if (params.get("new") === "1") setBuilder((b) => (b.open ? b : { open: true, rule: null }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  useRealtime(orgId ? [`ws:${orgId}`] : [], (env) => {
    const t = (env.event as unknown as { type: string }).type;
    if (t === "rule.fired") {
      utils.portfolio.getRuleHistory.invalidate();
      utils.portfolio.listRules.invalidate();
    }
    if (t === "portfolio.rescored") utils.portfolio.listRules.invalidate();
    if (t === "notification.created") utils.portfolio.notifications.invalidate();
  });

  const switchTab = (t: Tab) => {
    setTab(t);
    router.replace(`/app/alerts?tab=${t}`, { scroll: false });
  };

  const runAll = trpc.portfolio.runRules.useMutation({
    onSuccess: (r) => {
      const fired = r.filter((x) => x.fired);
      if (fired.length) toast.success(`${fired.length} rule(s) fired`, { description: fired.map((f) => `${f.name}: ${f.matchCount} assets`).join(" · ") });
      else toast.message("No rule fired", { description: r.map((x) => `${x.name}: ${x.blockedBy === "cooldown" ? "in quiet period" : x.blockedBy === "disabled" ? "disabled" : "no asset over threshold"}`).slice(0, 4).join(" · ") });
      utils.portfolio.getRuleHistory.invalidate();
      utils.portfolio.listRules.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const stats = useMemo(() => {
    const list = rules.data ?? [];
    const week = (history.data?.firings ?? []).filter((f) => Date.now() - new Date(f.at).getTime() < 7 * 86_400_000);
    return { active: list.filter((r) => r.enabled).length, total: list.length, matching: list.filter((r) => r.enabled && r.matchingNow > 0).length, week: week.length };
  }, [rules.data, history.data]);

  return (
    <div>
      <PageTitle
        eyebrow="Alerts & rules"
        title="Alert rules & notifications"
        description="Tell Agri-SHIELD what matters — “flood probability over 60 % on any coastal policy” — and who to tell. Rules are checked against every asset after each hourly re-score."
        actions={
          canWrite && (
            <>
              <PfButton variant="outline" onClick={() => runAll.mutate({})} loading={runAll.isPending}>
                {!runAll.isPending && <Play size={14} />} Run all rules now
              </PfButton>
              <PfButton onClick={() => setBuilder({ open: true, rule: null })}>
                <Plus size={14} /> New rule
              </PfButton>
            </>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Active rules" value={stats.active} icon={Zap} accent="cyan" delta={`${stats.total} total`} deltaGood />
        <StatTile label="Matching now" value={stats.matching} icon={FlaskConical} accent={stats.matching ? "red" : "green"} delta={stats.matching ? "rules with assets over threshold" : "nothing over threshold"} deltaGood={!stats.matching} />
        <StatTile label="Firings (7 days)" value={stats.week} icon={History} accent="amber" delta="from the portfolio monitor + manual runs" deltaGood />
        <StatTile label="Unread notifications" value={unread.data?.count ?? 0} icon={Inbox} accent="violet" delta="for you" deltaGood={!unread.data?.count} />
      </div>

      <div className="mb-4 mt-5">
        <Segmented
          value={tab}
          onChange={switchTab}
          options={[
            { value: "rules", label: "Rules", count: rules.data?.length },
            { value: "history", label: "Firing history", count: history.data?.firings.length },
            { value: "inbox", label: "Inbox", count: unread.data?.count || undefined },
          ]}
        />
      </div>

      {tab === "rules" && <RulesTab rules={rules} canWrite={canWrite} onEdit={(r) => setBuilder({ open: true, rule: r })} onNew={() => setBuilder({ open: true, rule: null })} />}
      {tab === "history" && <HistoryTab data={history.data} loading={history.isLoading} highlight={params.get("firing")} />}
      {tab === "inbox" && <InboxTab />}

      <RuleBuilder open={builder.open} rule={builder.rule} prefill={builder.rule ? null : prefill} onClose={() => { setBuilder({ open: false, rule: null }); if (params.get("new")) router.replace(`/app/alerts?tab=${tab}`, { scroll: false }); }} />
    </div>
  );
}

function RulesTab({ rules, canWrite, onEdit, onNew }: { rules: { data?: Rule[]; error: { message: string } | null; refetch: () => unknown }; canWrite: boolean; onEdit: (r: Rule) => void; onNew: () => void }) {
  const utils = trpc.useUtils();
  const [testing, setTesting] = useState<string | null>(null);
  const toggle = trpc.portfolio.toggleRule.useMutation({ onSuccess: () => utils.portfolio.listRules.invalidate(), onError: (e) => toast.error(e.message) });
  const del = trpc.portfolio.deleteRule.useMutation({
    onSuccess: () => {
      toast.success("Rule deleted");
      utils.portfolio.listRules.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const run = trpc.portfolio.runRules.useMutation({
    onSuccess: (r) => {
      const x = r[0];
      if (!x) return;
      if (x.fired) toast.success(`${x.name} fired`, { description: `${x.matchCount} assets · notifications sent` });
      else toast.message(`${x.name} did not fire`, { description: x.blockedBy === "cooldown" ? "It is in its quiet period — use “Fire now (ignore quiet period)”." : x.blockedBy === "disabled" ? "The rule is disabled." : "No asset crosses the threshold right now." });
      utils.portfolio.getRuleHistory.invalidate();
      utils.portfolio.listRules.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  if (rules.error) return <QueryError error={rules.error} onRetry={() => rules.refetch()} />;
  if (!rules.data) return <Skeleton className="h-[360px]" />;
  if (!rules.data.length)
    return (
      <div className="hud-panel p-10 text-center" style={{ ["--hud-accent" as string]: "56 189 248" }}>
        <Zap size={26} className="mx-auto text-sky-300" />
        <h2 className="mt-3 font-display text-lg font-semibold text-white">No alert rules yet</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">Start from a template — heavy rain near a parametric trigger, flood likely within 3 days, salinity above rice tolerance — and see instantly which assets it would catch.</p>
        {canWrite && (
          <PfButton className="mt-4" onClick={onNew}>
            <Plus size={14} /> Create your first rule
          </PfButton>
        )}
      </div>
    );

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {rules.data.map((r, i) => (
        <motion.div key={r.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className={cn("hud-panel p-4", !r.enabled && "opacity-60")} style={{ ["--hud-accent" as string]: r.severity === "critical" ? "239 68 68" : r.severity === "warning" ? "245 158 11" : "56 189 248" }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SEV_COLOR[r.severity] }} />
                <h3 className="truncate font-display text-sm font-semibold text-white">{r.name}</h3>
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-slate-300">{r.plain}</p>
              {r.description && r.description !== r.plain && <p className="mt-1 text-[11px] text-slate-500">{r.description}</p>}
            </div>
            <Toggle checked={r.enabled} onChange={(v) => toggle.mutate({ id: r.id, enabled: v })} label={`Enable ${r.name}`} disabled={!canWrite} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
            <span>
              <b className={cn("telemetry", r.matchingNow ? "text-rose-300" : "text-emerald-300")}>{r.matchingNow}</b> of {r.inScope} assets match now
            </span>
            <span>
              fired <b className="telemetry text-slate-200">{r.triggerCount}</b>× · last {timeAgo(r.lastTriggeredAt)}
            </span>
            {r.cooldownUntil && new Date(r.cooldownUntil).getTime() > Date.now() && (
              <span className="inline-flex items-center gap-1 text-amber-300/80">
                <Clock size={11} /> quiet for {Math.max(1, Math.round((new Date(r.cooldownUntil).getTime() - Date.now()) / 3_600_000))} h more
              </span>
            )}
            <span className="uppercase tracking-wider text-slate-500">{r.channels.join(" · ")}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <PfButton size="sm" variant="outline" onClick={() => setTesting(testing === r.id ? null : r.id)}>
              <FlaskConical size={12} /> Test <ChevronDown size={11} className={cn("transition-transform", testing === r.id && "rotate-180")} />
            </PfButton>
            {canWrite && (
              <>
                <PfButton size="sm" variant="outline" loading={run.isPending && run.variables?.ruleIds?.[0] === r.id && !run.variables?.ignoreCooldown} onClick={() => run.mutate({ ruleIds: [r.id] })}>
                  <Play size={12} /> Run now
                </PfButton>
                <PfButton size="sm" variant="ghost" onClick={() => onEdit(r)}>
                  <Pencil size={12} /> Edit
                </PfButton>
                <PfButton size="sm" variant="ghost" className="text-rose-300 hover:text-rose-200" onClick={() => confirm(`Delete rule “${r.name}”?`) && del.mutate({ id: r.id })}>
                  <Trash2 size={12} />
                </PfButton>
              </>
            )}
          </div>
          <AnimatePresence>{testing === r.id && <RuleTest rule={r} canWrite={canWrite} onFire={() => run.mutate({ ruleIds: [r.id], ignoreCooldown: true })} firing={run.isPending} />}</AnimatePresence>
        </motion.div>
      ))}
    </div>
  );
}

function RuleTest({ rule, canWrite, onFire, firing }: { rule: Rule; canWrite: boolean; onFire: () => void; firing: boolean }) {
  const t = trpc.portfolio.testRule.useQuery({ id: rule.id });
  return (
    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
      <div className="mt-3 rounded-lg border border-white/5 bg-slate-950/40 p-3">
        {!t.data ? (
          <Skeleton className="h-16" />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-slate-300">
                Dry run: <b className={t.data.matchCount ? "text-rose-300" : "text-emerald-300"}>{t.data.matchCount}</b> of {t.data.inScope} assets would fire ({fmtUsd(t.data.exposureUsd)} exposure).{" "}
                {t.data.blockedBy === "cooldown" ? <span className="text-amber-300">Currently in its quiet period — it would not dispatch yet.</span> : t.data.wouldDispatch ? <span className="text-rose-300">It would dispatch now.</span> : null}
              </span>
              {canWrite && t.data.matchCount > 0 && (
                <PfButton size="sm" variant="danger" loading={firing} onClick={onFire}>
                  <Zap size={12} /> Fire now (ignore quiet period)
                </PfButton>
              )}
            </div>
            <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
              {t.data.matches.slice(0, 30).map((m) => (
                <li key={m.assetId} className="flex items-center justify-between gap-2 text-[11.5px]">
                  <Link href={`/app/portfolio/${m.assetId}`} className="min-w-0 truncate text-slate-200 hover:text-sky-300">
                    {m.name}
                  </Link>
                  <span className="telemetry shrink-0 text-slate-400">{m.reason}</span>
                </li>
              ))}
              {!t.data.matches.length && <li className="text-[11.5px] text-slate-500">No asset meets the conditions with today’s data. Lower the threshold to see what would be caught.</li>}
            </ul>
          </>
        )}
      </div>
    </motion.div>
  );
}

function HistoryTab({ data, loading, highlight }: { data: RouterOutputs["portfolio"]["getRuleHistory"] | undefined; loading: boolean; highlight: string | null }) {
  const [open, setOpen] = useState<string | null>(highlight);
  if (loading || !data) return <Skeleton className="h-[360px]" />;
  if (!data.firings.length && !data.earlier.length) return <EmptyState icon={History} title="No firings yet">When a rule fires, every delivery (in-app, e-mail, SMS, webhook, Slack) is recorded here with its status.</EmptyState>;
  return (
    <Panel title="Firing history" subtitle="Newest first · click a firing to see matched assets and delivery receipts" icon={History} accent="amber">
      <ul className="divide-y divide-white/5">
        {data.firings.map((f) => (
          <li key={f.id} className={cn(highlight === f.id && "rounded-lg bg-sky-400/[0.05]")}>
            <button onClick={() => setOpen(open === f.id ? null : f.id)} className="flex w-full items-center gap-3 px-1 py-2.5 text-left">
              <Zap size={14} style={{ color: SEV_COLOR[f.severity] }} className="shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-slate-100">{f.ruleName}</span>
                <span className="block text-[11px] text-slate-500">
                  {new Date(f.at).toISOString().replace("T", " ").slice(0, 16)} UTC · {f.trigger} · {f.matchCount} asset{f.matchCount === 1 ? "" : "s"} · {f.deliveries.filter((d) => d.status === "sent" || d.status === "simulated").length}/{f.deliveries.length} delivered
                </span>
              </span>
              <ChevronDown size={14} className={cn("shrink-0 text-slate-500 transition-transform", open === f.id && "rotate-180")} />
            </button>
            <AnimatePresence>
              {open === f.id && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="grid gap-3 px-1 pb-3 md:grid-cols-2">
                    <div>
                      <div className="hud-label mb-1">Matched assets</div>
                      <ul className="max-h-48 space-y-1 overflow-y-auto text-[11.5px]">
                        {f.matches.map((m) => (
                          <li key={m.assetId} className="flex justify-between gap-2">
                            <Link href={`/app/portfolio/${m.assetId}`} className="truncate text-slate-200 hover:text-sky-300">
                              {m.name}
                            </Link>
                            <span className="telemetry shrink-0 text-slate-400">{m.reason}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <div className="hud-label mb-1">Deliveries</div>
                      <ul className="space-y-1 text-[11.5px]">
                        {f.deliveries.map((d, i) => (
                          <li key={i} className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-slate-300">
                              <b className="uppercase text-slate-400">{d.channel}</b> → {d.to}
                            </span>
                            <span
                              className={cn(
                                "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                                d.status === "sent" ? "bg-emerald-500/15 text-emerald-300" : d.status === "simulated" ? "bg-sky-500/15 text-sky-300" : d.status === "failed" ? "bg-rose-500/15 text-rose-300" : "bg-slate-700/50 text-slate-400"
                              )}
                              title={d.detail}
                            >
                              {d.status}
                              {d.httpStatus ? ` ${d.httpStatus}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2 text-[10px] text-slate-500">“Simulated” = no e-mail/SMS provider key configured; the message is in the delivery outbox.</p>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </li>
        ))}
        {data.earlier.map((e) => (
          <li key={e.ruleId} className="flex items-center gap-3 px-1 py-2.5 text-xs text-slate-500">
            <Clock size={13} /> {e.ruleName} — last fired {timeAgo(e.at)} ({e.triggerCount} firings before this server session; receipts not retained)
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function InboxTab() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<"all" | "unread" | "rule" | "system" | "report" | "billing">("all");
  const input = { limit: 50, unreadOnly: filter === "unread" || undefined, kind: filter !== "all" && filter !== "unread" ? filter : undefined };
  const list = trpc.portfolio.notifications.list.useInfiniteQuery(input, { getNextPageParam: (p) => p.nextCursor ?? undefined });
  const inv = () => utils.portfolio.notifications.invalidate();
  const markRead = trpc.portfolio.notifications.markRead.useMutation({ onSuccess: inv });
  const markAll = trpc.portfolio.notifications.markAllRead.useMutation({ onSuccess: inv });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Panel
      title="Notification inbox"
      subtitle="Everything the workspace told you — newest first"
      icon={Inbox}
      accent="violet"
      actions={
        <PfButton size="sm" variant="outline" onClick={() => markAll.mutate()} loading={markAll.isPending}>
          <CheckCheck size={12} /> Mark all read
        </PfButton>
      }
    >
      <div className="mb-3 flex flex-wrap gap-1.5">
        {(["all", "unread", "rule", "system", "report", "billing"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cn("rounded-full border px-2.5 py-1 text-[11px] capitalize", filter === f ? "border-sky-400/60 bg-sky-400/10 text-white" : "border-slate-700/70 text-slate-400 hover:text-white")}>
            {f === "rule" ? "rule firings" : f}
          </button>
        ))}
      </div>
      {list.isLoading ? (
        <Skeleton className="h-[300px]" />
      ) : !items.length ? (
        <EmptyState icon={Bell} title="Nothing here">Notifications from rule firings, imports, weekly digests and billing appear here.</EmptyState>
      ) : (
        <ul className="divide-y divide-white/5">
          {items.map((n) => {
            const sev = SEVERITY_STYLE[n.severity] ?? SEVERITY_STYLE.info!;
            const KIcon = KIND_ICON[n.kind] ?? Bell;
            return (
              <li key={n.id} className={cn("flex gap-3 py-3", !n.read && "bg-sky-400/[0.03]")}>
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: `${sev.color}1f`, color: sev.color }}>
                  <KIcon size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("text-sm", n.read ? "text-slate-300" : "font-medium text-white")}>{n.title}</span>
                    <RiskPill level={n.severity === "critical" ? "critical" : n.severity === "warning" ? "warning" : "low"} className={n.severity === "info" || n.severity === "success" ? "hidden" : ""} />
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400">{n.body}</p>
                  <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-500">
                    <span>{timeAgo(n.createdAt)}</span>
                    <span className="capitalize">{n.kind}</span>
                    {n.href && (
                      <button
                        className="text-sky-300 hover:underline"
                        onClick={() => {
                          if (!n.read) markRead.mutate({ ids: [n.id] });
                          router.push(n.href!);
                        }}
                      >
                        Open →
                      </button>
                    )}
                    {!n.read && (
                      <button className="hover:text-white" onClick={() => markRead.mutate({ ids: [n.id] })}>
                        Mark read
                      </button>
                    )}
                  </div>
                </div>
                {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-sky-400" />}
              </li>
            );
          })}
        </ul>
      )}
      {list.hasNextPage && (
        <div className="mt-3 text-center">
          <PfButton size="sm" variant="outline" onClick={() => list.fetchNextPage()} loading={list.isFetchingNextPage}>
            Load more
          </PfButton>
        </div>
      )}
    </Panel>
  );
}
