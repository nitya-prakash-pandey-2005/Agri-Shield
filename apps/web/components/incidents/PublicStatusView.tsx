"use client";

/**
 * Public stakeholder status page (/s/<slug>): status, severity in plain words, affected
 * area, every published update (newest first), e-mail/SMS subscription. Live: a new update
 * appears without refresh (realtime room `status:<slug>`, plus a 60 s poll fallback).
 * Shows no asset names, values, people or internal notes.
 */
import dynamic from "next/dynamic";
import { useState } from "react";
import { motion } from "framer-motion";
import { Bell, CheckCircle2, Clock, Loader2, Mail, MapPin, MessageSquareText, Radio } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useRoomEvents } from "@/components/collab/useRoomEvents";
import { STATUSES, STATUS_META, statusIndex } from "./meta";

const IncidentMap = dynamic(() => import("./IncidentMap"), { ssr: false, loading: () => <div className="skeleton h-[260px] rounded-xl" /> });

const fmt = (d: Date | string) => new Date(d).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });

export function PublicStatusView({ slug }: { slug: string }) {
  const q = trpc.incidents.status.get.useQuery({ slug }, { retry: false, refetchInterval: 60_000 });
  const sub = trpc.incidents.status.subscribe.useMutation();
  const [addr, setAddr] = useState("");
  const [kind, setKind] = useState<"email" | "sms">("email");
  const [fresh, setFresh] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useRoomEvents([`status:${slug}`], (env) => {
    const ev = env.event as { type: string; updateId?: string };
    if (ev.type === "incident.update_published") {
      setFresh(ev.updateId ?? null);
      void q.refetch();
    }
  });

  if (q.isLoading)
    return (
      <div className="grid min-h-screen place-items-center hud-bg text-slate-400">
        <Loader2 className="animate-spin" />
      </div>
    );
  if (q.error || !q.data)
    return (
      <div className="grid min-h-screen place-items-center hud-bg px-6 text-center">
        <div>
          <div className="font-display text-xl font-semibold text-white">Status page not available</div>
          <p className="mt-1 text-sm text-slate-400">{q.error?.message ?? "This link is invalid or the page is no longer public."}</p>
        </div>
      </div>
    );

  const s = q.data;
  const idx = statusIndex(s.status);
  const resolved = s.status === "resolved";
  const c = s.statusMeta.color;
  const center: [number, number] = s.area ? (s.area.type === "circle" ? [s.area.lat, s.area.lon] : s.area.coords[0]!) : [22, 90];

  return (
    <div className="min-h-screen hud-bg px-4 pb-16 pt-8 text-slate-200">
      <div className="mx-auto max-w-3xl">
        <header className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-sky-400/15 font-bold text-sky-300">{(s.org.shortName || s.org.name).slice(0, 2).toUpperCase()}</span>
          {s.org.name} · Incident status
          {s.demo && <span className="ml-auto rounded bg-slate-800 px-1.5 py-0.5 text-[9px] text-slate-300">Demo scenario</span>}
        </header>

        <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="hud-panel mt-4 p-5" style={{ ["--hud-accent" as string]: resolved ? "52 211 153" : "244 63 94" }}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: `${c}22`, color: c }}>
              {resolved ? <CheckCircle2 size={13} /> : <Radio size={13} className="animate-pulse" />}
              {s.statusMeta.label}
            </span>
            <span className="rounded-md px-2 py-1 text-xs" style={{ background: `${s.severityMeta.color}1f`, color: s.severityMeta.color }}>
              {s.severityMeta.label}
            </span>
            <span className="text-xs text-slate-400">{s.hazard}</span>
          </div>
          <h1 className="mt-3 font-display text-2xl font-semibold leading-tight text-white md:text-3xl">{s.title}</h1>
          <p className="mt-2 text-sm text-slate-300">{s.statusMeta.meaning}</p>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1">
              <Clock size={12} /> Started {fmt(s.startedAt)}
            </span>
            {s.resolvedAt && (
              <span className="inline-flex items-center gap-1 text-emerald-300">
                <CheckCircle2 size={12} /> Resolved {fmt(s.resolvedAt)}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <MapPin size={12} /> {s.sitesAffected} monitored sites in the affected area
            </span>
            <span>Last updated {fmt(s.lastUpdatedAt)}</span>
          </div>

          <ol className="mt-5 grid grid-cols-5 gap-1" aria-label="Progress">
            {STATUSES.map((st, i) => (
              <li key={st} className="text-center">
                <div className={cn("h-1.5 rounded-full", i <= idx ? "" : "bg-slate-800")} style={i <= idx ? { background: STATUS_META[st].color, boxShadow: i === idx ? `0 0 10px ${STATUS_META[st].color}` : undefined } : undefined} />
                <div className={cn("mt-1 text-[10px]", i === idx ? "text-white" : "text-slate-500")}>{STATUS_META[st].label}</div>
              </li>
            ))}
          </ol>
        </motion.section>

        {s.area && (
          <section className="mt-4">
            <IncidentMap center={center} zoom={8} height={260} areas={[{ id: "a", area: s.area, color: s.severityMeta.color, label: "Affected area" }]} fitKey={s.slug} />
          </section>
        )}

        <section className="mt-6">
          <h2 className="hud-label mb-3">Updates</h2>
          <ol className="relative space-y-4 border-l border-white/10 pl-5">
            {s.updates.map((u, i) => (
              <motion.li key={u.id} initial={u.id === fresh ? { opacity: 0, x: -10 } : false} animate={{ opacity: 1, x: 0 }} className={cn("relative rounded-xl border p-4", u.id === fresh ? "border-sky-400/50 bg-sky-400/5" : "border-white/5 bg-slate-950/40")}>
                <span className="absolute -left-[27px] top-5 h-3 w-3 rounded-full border-2 border-[#050a16]" style={{ background: STATUS_META[u.status].color }} />
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                  <span className="font-medium" style={{ color: STATUS_META[u.status].color }}>
                    {u.statusLabel}
                  </span>
                  <span>{fmt(u.publishedAt)}</span>
                  {i === 0 && <span className="rounded bg-sky-400/15 px-1.5 text-[10px] text-sky-200">Latest</span>}
                </div>
                <h3 className="mt-1 text-base font-medium leading-snug text-white">{u.title}</h3>
                <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-300">{u.body}</p>
              </motion.li>
            ))}
            {!s.updates.length && <li className="text-sm text-slate-500">No updates published yet.</li>}
          </ol>
        </section>

        {!resolved && (
          <section className="hud-panel mt-6 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <Bell size={15} className="text-sky-300" /> Get updates
            </div>
            <p className="mt-1 text-xs text-slate-400">We will send each new update to your inbox or phone. Your address is only used for this incident.</p>
            {done ? (
              <p className="mt-3 flex items-center gap-1.5 text-sm text-emerald-300">
                <CheckCircle2 size={14} /> Subscribed — you'll get the next update.
              </p>
            ) : (
              <form
                className="mt-3 flex flex-wrap gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await sub.mutateAsync({ slug, kind, address: addr });
                    setDone(true);
                  } catch (err) {
                    toast.error((err as Error).message);
                  }
                }}
              >
                <div className="inline-flex rounded-lg border border-slate-700 p-0.5">
                  {(["email", "sms"] as const).map((k) => (
                    <button key={k} type="button" onClick={() => setKind(k)} className={cn("inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs", kind === k ? "bg-sky-400 text-slate-950" : "text-slate-400")}>
                      {k === "email" ? <Mail size={12} /> : <MessageSquareText size={12} />}
                      {k === "email" ? "E-mail" : "SMS"}
                    </button>
                  ))}
                </div>
                <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder={kind === "email" ? "you@organisation.org" : "+8801XXXXXXXXX"} className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-1.5 text-sm text-white placeholder:text-slate-600 focus:border-sky-400 focus:outline-none" aria-label={kind === "email" ? "E-mail address" : "Phone number"} required />
                <button type="submit" disabled={sub.isPending} className="rounded-lg bg-sky-400 px-4 py-1.5 text-sm font-semibold text-slate-950 hover:bg-sky-300 disabled:opacity-50">
                  Subscribe
                </button>
              </form>
            )}
            <p className="mt-2 text-[10.5px] text-slate-500">{s.subscribers} subscriber{s.subscribers === 1 ? "" : "s"}</p>
          </section>
        )}

        <footer className="mt-10 text-center text-[11px] text-slate-600">Status page powered by Agri-SHIELD climate incident command · times shown in your local time zone</footer>
      </div>
    </div>
  );
}
