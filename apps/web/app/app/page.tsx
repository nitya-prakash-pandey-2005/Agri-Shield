"use client";

/**
 * Workspace Home — industry-aware dashboard: greeting + plain-language risk
 * briefing, KPI tiles from the live portfolio, mini map, top risks, setup
 * checklist, quick actions, latest notifications and live hazards nearby.
 */
import Link from "next/link";
import { motion } from "framer-motion";
import { formatDistanceToNowStrict } from "date-fns";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  Bot,
  CheckCircle2,
  Compass,
  FileText,
  HandHeart,
  Info,
  Landmark,
  Layers,
  MapPin,
  Radar,
  RefreshCw,
  ShieldCheck,
  Sunrise,
  Waves,
  type LucideIcon,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { AnimatedNumber, EmptyState, Panel, RiskPill, Skeleton, SourceTag, riskColor } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { MiniMap } from "@/components/workspace/MiniMap";
import { OnboardingChecklist } from "@/components/workspace/OnboardingChecklist";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = { shield: ShieldCheck, compass: Compass, layers: Layers, file: FileText, landmark: Landmark, bell: Bell, hand: HandHeart, bot: Bot, radar: Radar };
const TONE: Record<string, { color: string; icon: LucideIcon }> = {
  critical: { color: "#f87171", icon: AlertTriangle },
  warning: { color: "#fbbf24", icon: AlertTriangle },
  ok: { color: "#34d399", icon: CheckCircle2 },
  info: { color: "#38bdf8", icon: Info },
};
const SEV: Record<string, string> = { critical: "#f87171", warning: "#fbbf24", success: "#34d399", info: "#38bdf8" };

type Kpi = { key: string; label: string; value: number; format: "int" | "usd" | "pct" | "ha" | "t"; hint: string; term: string };

function KpiTile({ k, i }: { k: Kpi; i: number }) {
  const accent = ["#38bdf8", "#10b981", "#f87171", "#a78bfa", "#fbbf24"][i % 5]!;
  const big = k.format === "usd" && k.value >= 1e6;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} whileHover={{ y: -2 }} className="hud-panel p-4" title={k.hint}>
      <div className="flex items-center justify-between gap-2">
        <span className="hud-label truncate">{k.label}</span>
        <Explain term={k.term} text={k.hint} />
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        {k.format === "usd" ? (
          <AnimatedNumber value={big ? k.value / 1e6 : k.value >= 1e3 ? k.value / 1e3 : k.value} decimals={big ? 1 : 0} prefix="$" suffix={big ? "M" : k.value >= 1e3 ? "K" : ""} className="text-2xl font-semibold text-white" />
        ) : k.format === "pct" ? (
          <AnimatedNumber value={k.value} decimals={1} suffix="%" className="text-2xl font-semibold text-white" />
        ) : (
          <AnimatedNumber value={k.value} decimals={k.format === "ha" ? 1 : 0} className="text-2xl font-semibold text-white" />
        )}
        {k.format === "ha" && <span className="text-xs text-slate-400">ha</span>}
        {k.format === "t" && <span className="text-xs text-slate-400">t</span>}
      </div>
      <div className="mt-1.5 h-0.5 w-10 rounded-full" style={{ background: accent }} />
      <div className="mt-1.5 text-[11px] leading-snug text-slate-500 line-clamp-2">{k.hint}</div>
    </motion.div>
  );
}

export default function WorkspaceHome() {
  const utils = trpc.useUtils();
  const home = trpc.workspace.home.useQuery(undefined, { refetchInterval: 5 * 60_000 });
  const mark = trpc.workspace.markNotificationsRead.useMutation({ onSuccess: () => void utils.workspace.home.invalidate() });
  const d = home.data;

  if (home.error)
    return (
      <Panel title="Home" icon={AlertTriangle} accent="red">
        <EmptyState icon={AlertTriangle} title="We couldn't load your workspace">
          {home.error.message}
        </EmptyState>
      </Panel>
    );

  const levels = d?.metrics.levels;
  const total = d?.metrics.total ?? 0;
  const showChecklist = d && !d.onboarding.dismissed;

  return (
    <div className="min-w-0 space-y-5">
      {/* Greeting */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="hud-label mb-1 flex items-center gap-2 text-cyan-300/80">
            <Sunrise size={12} /> {d ? `${d.today} · ${d.org.industryLabel}` : "Loading workspace…"}
          </div>
          {d ? (
            <h1 className="font-display text-2xl md:text-[28px] font-semibold tracking-tight text-white">
              {d.greeting}, {d.firstName}
            </h1>
          ) : (
            <Skeleton className="h-8 w-72" />
          )}
          <p className="mt-1 text-sm text-slate-400">{d ? `Here's what matters for ${d.org.name} today.` : " "}</p>
        </div>
        <div className="flex items-center gap-2">
          {d && (
            <SourceTag>
              Scored {formatDistanceToNowStrict(new Date(d.source.scoredAt), { addSuffix: true })} · {Object.keys(d.source.mix).join(" + ") || "no assets"}
            </SourceTag>
          )}
          <Link href="/help" className="grid h-8 w-8 place-items-center rounded-lg border border-slate-700/70 text-slate-400 hover:text-white sm:hidden" aria-label="Help centre" title="Help">
            <Info size={14} />
          </Link>
          <button onClick={() => home.refetch()} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-700/70 text-slate-400 hover:text-white" aria-label="Refresh" title="Refresh">
            <RefreshCw size={14} className={cn(home.isFetching && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Briefing + checklist / quick actions */}
      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <div data-tour="briefing" className="lg:col-span-2">
          <Panel title="Today's risk briefing" subtitle="Plain-language summary of your portfolio against the latest forecasts" icon={Radar} accent="cyan" live sweep className="h-full">
            {!d ? (
              <div className="space-y-2">
                <Skeleton className="h-7 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-4/6" />
              </div>
            ) : (
              <>
                <p className="font-display text-lg md:text-xl leading-snug text-white">{d.briefing.headline}</p>
                <ul className="mt-3 space-y-2">
                  {d.briefing.lines.map((l, i) => {
                    const t = TONE[l.tone]!;
                    return (
                      <motion.li key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.06 }} className="flex gap-2.5 text-[13.5px] leading-relaxed text-slate-300">
                        <t.icon size={15} className="mt-0.5 shrink-0" style={{ color: t.color }} />
                        <span>{l.text}</span>
                      </motion.li>
                    );
                  })}
                </ul>
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">
                  <Link href="/app/portfolio" className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-400 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-300">
                    {total ? <>See affected {d.metrics.noun.many}</> : <>Add your first {d.metrics.noun.one}</>} <ArrowRight size={13} />
                  </Link>
                  {total > 0 && <Link href="/app/reports?type=portfolio_summary" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:border-cyan-400/50">
                    <FileText size={13} /> Export as PDF
                  </Link>}
                  <span className="ml-auto text-[11px] text-slate-500">
                    What does &ldquo;risk&rdquo; mean? <Explain term="composite_score">Composite score</Explain>
                  </span>
                </div>
              </>
            )}
          </Panel>
        </div>
        {showChecklist ? (
          <OnboardingChecklist data={d.onboarding} />
        ) : (
          <QuickActions actions={d?.quickActions} />
        )}
      </div>

      {/* KPIs */}
      <div data-tour="kpis" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5 [&>*]:min-w-0">
        {d ? d.kpis.map((k, i) => <KpiTile key={k.key} k={k as Kpi} i={i} />) : Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-[118px]" />)}
      </div>

      {/* Map + distribution + top risks */}
      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <div data-tour="map" className="lg:col-span-2">
          <Panel
            title="Where your risk is"
            subtitle={d ? `${total} ${d.metrics.noun.many} · dot colour = composite risk, size = value` : "Loading map…"}
            icon={MapPin}
            accent="cyan"
            actions={
              <Link href="/app/portfolio" className="text-[11px] text-cyan-300 hover:underline">
                Open portfolio →
              </Link>
            }
            bodyClassName="p-0 px-0 pb-0"
          >
            <div className="relative h-[320px] md:h-[380px]">
              {d ? <MiniMap points={d.points} center={d.mapCenter as [number, number]} zoom={d.mapZoom} className="h-full w-full" /> : <Skeleton className="h-full w-full rounded-none" />}
              <div className="pointer-events-none absolute right-2 top-2 z-[500] flex gap-2 rounded-lg bg-slate-950/80 px-2 py-1 text-[10px] telemetry text-slate-300 backdrop-blur">
                {[
                  ["Low", 20],
                  ["Medium", 45],
                  ["High", 70],
                  ["Critical", 90],
                ].map(([l, v]) => (
                  <span key={l as string} className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full" style={{ background: riskColor(v as number) }} />
                    {l}
                  </span>
                ))}
              </div>
            </div>
          </Panel>
        </div>
        <Panel title="Highest risk right now" subtitle={d ? `Threshold ${d.metrics.threshold}/100 · change it in Settings` : undefined} icon={AlertTriangle} accent="red">
          {levels && total > 0 && (
            <div className="mb-3">
              <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-800">
                {(["critical", "high", "medium", "low"] as const).map((l) => (
                  <div key={l} style={{ width: `${(levels[l] / total) * 100}%`, background: riskColor({ critical: 90, high: 70, medium: 45, low: 20 }[l]) }} title={`${l}: ${levels[l]}`} />
                ))}
              </div>
              <div className="mt-1.5 flex justify-between text-[10.5px] telemetry text-slate-500">
                <span>{levels.critical} critical</span>
                <span>{levels.high} high</span>
                <span>{levels.medium} medium</span>
                <span>{levels.low} low</span>
              </div>
            </div>
          )}
          {!d ? (
            <div className="space-y-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : d.top.length === 0 ? (
            <EmptyState icon={Layers} title="No assets yet">
              <Link href="/app/portfolio" className="text-cyan-300 hover:underline">
                Add your first asset
              </Link>{" "}
              — a plot, loan, farm or site — and we'll score it within seconds.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-white/5">
              {d.top.map((t) => (
                <li key={t.id}>
                  <Link href={`/app/portfolio?asset=${t.id}`} className="flex items-center gap-3 py-2 hover:bg-white/[0.02]">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg telemetry text-sm font-semibold" style={{ background: `${riskColor(t.composite)}1f`, color: riskColor(t.composite) }}>
                      {t.composite}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-slate-100">{t.name}</span>
                      <span className="block truncate text-[11px] text-slate-500">
                        {t.district ?? "—"} · {t.driver}
                      </span>
                    </span>
                    <RiskPill level={t.level} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* Quick actions (when checklist shown above) + notifications + hazards */}
      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        {showChecklist && <QuickActions actions={d?.quickActions} />}
        <Panel
          title="Latest notifications"
          icon={Bell}
          accent="amber"
          actions={
            d && d.notifications.some((n) => !n.read) ? (
              <button onClick={() => mark.mutate({})} className="text-[11px] text-cyan-300 hover:underline">
                Mark all read
              </button>
            ) : null
          }
        >
          {!d ? (
            <div className="space-y-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : d.notifications.length === 0 ? (
            <EmptyState icon={Bell} title="Nothing yet">
              Rule alerts, finished reports and team changes will show up here.
            </EmptyState>
          ) : (
            <ul className="space-y-1">
              {d.notifications.map((n) => (
                <li key={n.id}>
                  <Link href={n.href ?? "/app"} onClick={() => !n.read && mark.mutate({ ids: [n.id] })} className="flex gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-white/[0.03]">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: n.read ? "#334155" : SEV[n.severity] }} />
                    <span className="min-w-0">
                      <span className={cn("block truncate text-[13px]", n.read ? "text-slate-400" : "text-slate-100")}>{n.title}</span>
                      <span className="block truncate text-[11px] text-slate-500">
                        {formatDistanceToNowStrict(new Date(n.createdAt), { addSuffix: true })} · {n.body}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Live hazards near your assets" subtitle="GDACS & NASA EONET events within 300 km" icon={Waves} accent="violet" live className={showChecklist ? "" : "lg:col-span-2"}>
          {!d ? (
            <div className="space-y-2">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : d.hazards.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="No live disasters near your assets">
              We check the UN GDACS and NASA EONET feeds every 30 minutes.
            </EmptyState>
          ) : (
            <ul className="space-y-1.5">
              {d.hazards.map((h) => (
                <li key={h.id} className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.015] px-2.5 py-2">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: h.alertLevel === "red" ? "#f871711f" : "#fbbf241f" }}>
                    <Activity size={14} style={{ color: h.alertLevel === "red" ? "#f87171" : "#fbbf24" }} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-slate-100">{h.title}</span>
                    <span className="block text-[11px] text-slate-500">
                      {h.source} · {h.distanceKm} km from nearest asset · {h.assetsWithin} within 300 km
                    </span>
                  </span>
                  {h.url && (
                    <a href={h.url} target="_blank" rel="noreferrer" className="text-[11px] text-cyan-300 hover:underline">
                      Source
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <SourceTag href="https://www.gdacs.org/">GDACS · NASA EONET</SourceTag>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function QuickActions({ actions }: { actions?: { label: string; description: string; href: string; icon: string }[] }) {
  return (
    <Panel title="Quick actions" subtitle="Most-used tools for your industry" icon={Compass} accent="emerald" className="h-full">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1">
        {!actions
          ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-14" />)
          : actions.map((a) => {
              const Icon = ICONS[a.icon] ?? Compass;
              return (
                <Link key={a.label} href={a.href} className="group flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.015] px-3 py-2.5 transition-colors hover:border-emerald-400/40">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-500/10">
                    <Icon size={15} className="text-emerald-300" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-slate-100">{a.label}</span>
                    <span className="block truncate text-[11px] text-slate-500">{a.description}</span>
                  </span>
                  <ArrowRight size={14} className="text-slate-600 transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-300" />
                </Link>
              );
            })}
      </div>
    </Panel>
  );
}
