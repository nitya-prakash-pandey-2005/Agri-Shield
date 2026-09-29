"use client";

/**
 * Activity — one stream of everything that happened in the workspace: incidents, rule
 * firings, comments & mentions, official alerts, reports, imports, asset edits, team and
 * settings changes. Day-grouped, filterable, deep-linked, and live (new events slide in).
 */
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, BellRing, FileText, FileWarning, FlaskConical, Layers, MessageSquare, Search, Settings, Siren, Upload, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { EmptyState, LiveDot, Panel, Skeleton, SourceTag } from "@/components/hud";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Chip, PageTitle, PfButton, QueryError, Segmented } from "@/components/portfolio/ui";
import { Avatar } from "@/components/collab/Avatar";
import { clockTime, groupByDay, relTime } from "@/components/collab/shared";
import { useRoomEvents } from "@/components/collab/useRoomEvents";

type Item = RouterOutputs["incidents"]["activity"]["feed"]["items"][number];
type Category = Item["category"];

const CATS: { id: Category; label: string; icon: LucideIcon; color: string }[] = [
  { id: "incident", label: "Incidents", icon: Siren, color: "#f43f5e" },
  { id: "rule", label: "Rule firings", icon: BellRing, color: "#fbbf24" },
  { id: "comment", label: "Comments", icon: MessageSquare, color: "#38bdf8" },
  { id: "alert", label: "Official alerts", icon: FileWarning, color: "#fb923c" },
  { id: "report", label: "Reports", icon: FileText, color: "#a78bfa" },
  { id: "import", label: "Imports", icon: Upload, color: "#34d399" },
  { id: "asset", label: "Assets", icon: Layers, color: "#22d3ee" },
  { id: "team", label: "Team", icon: Users, color: "#f472b6" },
  { id: "settings", label: "Settings", icon: Settings, color: "#94a3b8" },
  { id: "scenario", label: "Scenarios", icon: FlaskConical, color: "#c084fc" },
];
const CAT = Object.fromEntries(CATS.map((c) => [c.id, c])) as Record<Category, (typeof CATS)[number]>;
const SEV_DOT: Record<string, string> = { critical: "#f43f5e", warning: "#fbbf24", success: "#34d399", info: "transparent" };

export default function ActivityPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[600px]" />}>
      <ActivityInner />
    </Suspense>
  );
}

function ActivityInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { data: session } = useSession();
  const orgId = session?.user?.orgId;
  const initialCat = params.get("category");
  const [cats, setCats] = useState<Category[]>(initialCat && CAT[initialCat as Category] ? [initialCat as Category] : []);
  const [actor, setActor] = useState<string>(params.get("actor") ?? "");
  const [q, setQ] = useState("");
  const [range, setRange] = useState<"7" | "30" | "90">("30");
  const [pages, setPages] = useState<Item[][]>([]);
  const [cursor, setCursor] = useState<Date | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [liveCount, setLiveCount] = useState(0);
  const me = trpc.workspace.me.useQuery(undefined, { staleTime: 60_000 });
  const tz = (me.data?.org?.settings?.timezone as string | undefined) ?? "UTC";

  const input = { categories: cats.length ? cats : undefined, actorId: actor || null, q: q || null, sinceDays: +range, limit: 40 };
  const first = trpc.incidents.activity.feed.useQuery(input, { placeholderData: (p) => p });
  const more = trpc.incidents.activity.feed.useQuery({ ...input, before: cursor }, { enabled: !!cursor });

  // Reset extra pages whenever filters change
  useEffect(() => {
    setPages([]);
    setCursor(null);
  }, [cats.join(","), actor, q, range]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (more.data && cursor) setPages((p) => (p.some((pg) => pg[0]?.id === more.data!.items[0]?.id) ? p : [...p, more.data!.items]));
  }, [more.data, cursor]);

  // Realtime: refetch the head of the stream and highlight what's new
  const [prevIds, setPrevIds] = useState<Set<string> | null>(null);
  useRoomEvents([orgId ? `ws:${orgId}` : "none"], (env) => {
    const t = env.event.type;
    if (t.startsWith("incident.") || t === "comment.created" || t === "rule.fired" || t === "notification.created" || t === "portfolio.rescored") {
      setPrevIds(new Set((first.data?.items ?? []).map((i) => i.id)));
      void first.refetch();
    }
  });
  useEffect(() => {
    if (!prevIds || !first.data) return;
    const added = first.data.items.filter((i) => !prevIds.has(i.id)).map((i) => i.id);
    if (added.length) {
      setFresh((f) => new Set([...f, ...added]));
      setLiveCount((c) => c + added.length);
      setTimeout(() => setFresh((f) => new Set([...f].filter((x) => !added.includes(x)))), 6000);
    }
    setPrevIds(null);
  }, [first.data, prevIds]);

  const items = useMemo(() => {
    const seen = new Set<string>();
    return [...(first.data?.items ?? []), ...pages.flat()].filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
  }, [first.data, pages]);
  const groups = useMemo(() => groupByDay(items, tz), [items, tz]);
  const counts = first.data?.counts ?? {};
  const actors = first.data?.actors ?? [];
  const nextBefore = (cursor ? more.data?.nextBefore : first.data?.nextBefore) ?? null;

  return (
    <div className="space-y-5">
      <PageTitle
        eyebrow="Insights · Audit & collaboration"
        title="Activity"
        description="Everything your team and the platform did in this workspace — incidents, rule firings, comments, official alerts, reports and imports — newest first. Click any line to jump to it."
        actions={<LiveDot label={liveCount ? `LIVE · ${liveCount} new` : "LIVE"} />}
      />

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search activity…" className="w-full rounded-lg border border-slate-700/80 bg-slate-950/60 py-1.5 pl-8 pr-3 text-xs text-slate-100 placeholder:text-slate-600 focus:border-sky-400/70 focus:outline-none" aria-label="Search activity" />
        </label>
        <select value={actor} onChange={(e) => setActor(e.target.value)} className="rounded-lg border border-slate-700/80 bg-slate-950/60 px-2 py-1.5 text-xs text-slate-200" aria-label="Filter by person">
          <option value="">Everyone</option>
          {actors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <Segmented value={range} onChange={setRange} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Chip active={!cats.length} onClick={() => setCats([])}>
          All <span className="telemetry text-slate-500">{Object.values(counts).reduce((s, n) => s + (n ?? 0), 0)}</span>
        </Chip>
        {CATS.map((c) => (
          <Chip key={c.id} active={cats.includes(c.id)} color={c.color} onClick={() => setCats((cur) => (cur.includes(c.id) ? cur.filter((x) => x !== c.id) : [...cur, c.id]))}>
            {c.label} <span className="telemetry text-slate-500">{counts[c.id] ?? 0}</span>
          </Chip>
        ))}
      </div>

      <QueryError error={first.error} onRetry={() => first.refetch()} />

      <Panel title="Workspace stream" subtitle={first.data ? `${first.data.total} events · times in ${tz}` : undefined} icon={Activity} accent="cyan" live>
        {first.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : !items.length ? (
          <EmptyState icon={Activity} title="Nothing here yet">
            {cats.length || actor || q ? "No events match these filters — clear one to see more." : "Activity appears as your team imports assets, creates rules, opens incidents and comments."}
          </EmptyState>
        ) : (
          <div className="space-y-5">
            {groups.map((g) => (
              <section key={g.day}>
                <div className="sticky top-0 z-10 -mx-1 mb-2 flex items-center gap-2 bg-[#070d1c]/90 px-1 py-1 backdrop-blur">
                  <span className="hud-label text-sky-300/90">{g.label}</span>
                  <span className="h-px flex-1 bg-white/5" />
                  <span className="telemetry text-[10px] text-slate-500">{g.items.length}</span>
                </div>
                <ol className="space-y-1">
                  <AnimatePresence initial={false}>
                    {g.items.map((it) => {
                      const c = CAT[it.category];
                      const Icon = c.icon;
                      const row = (
                        <div className={cn("group flex items-start gap-3 rounded-lg px-2 py-2 transition", fresh.has(it.id) ? "bg-sky-400/10 ring-1 ring-sky-400/40" : "hover:bg-white/[0.03]")}>
                          <div className="relative">
                            <Avatar user={it.actor} size={30} title={it.actor?.name ?? it.actorLabel} />
                            <span className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full border border-[#070d1c]" style={{ background: c.color }}>
                              <Icon size={9} className="text-slate-950" />
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[12.5px] leading-snug text-slate-300">
                              <b className="font-semibold text-slate-100">{it.actor?.name ?? it.actorLabel}</b> {it.verb}
                              {it.severity && it.severity !== "info" && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: SEV_DOT[it.severity] }} />}
                            </div>
                            <div className="truncate text-[13px] text-slate-100 group-hover:text-sky-200">{it.title}</div>
                            {it.detail && <div className="line-clamp-2 text-[11.5px] text-slate-500">{it.detail}</div>}
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="telemetry text-[11px] text-slate-400">{clockTime(it.at, tz)}</div>
                            <div className="text-[10px] text-slate-600">{relTime(it.at)}</div>
                          </div>
                        </div>
                      );
                      return (
                        <motion.li key={it.id} layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                          {it.href ? (
                            <Link href={it.href} className="block">
                              {row}
                            </Link>
                          ) : (
                            row
                          )}
                        </motion.li>
                      );
                    })}
                  </AnimatePresence>
                </ol>
              </section>
            ))}
            {nextBefore && (
              <div className="flex justify-center">
                <PfButton variant="outline" size="sm" loading={more.isFetching} onClick={() => setCursor(new Date(nextBefore))}>
                  Load older
                </PfButton>
              </div>
            )}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/5 pt-3 text-[10.5px] text-slate-500">
          <SourceTag>audit trail</SourceTag>
          <SourceTag>rule engine</SourceTag>
          <SourceTag>incidents</SourceTag>
          <SourceTag>GDACS · national agencies</SourceTag>
          <button className="ml-auto underline-offset-2 hover:text-slate-300 hover:underline" onClick={() => router.push("/app/incidents")}>
            Go to incidents →
          </button>
        </div>
      </Panel>
    </div>
  );
}
