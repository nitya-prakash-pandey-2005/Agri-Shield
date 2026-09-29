"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDeferredValue, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import {
  Activity,
  ArrowRight,
  BookOpen,
  Building2,
  ChevronDown,
  Code2,
  Compass,
  CreditCard,
  Gauge,
  HandHeart,
  Landmark,
  LifeBuoy,
  Loader2,
  Megaphone,
  Search,
  Send,
  ShieldCheck,
  Users,
  Wheat,
  type LucideIcon,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { FAQS, HELP_ARTICLES } from "@/components/help/articles";
import { GLOSSARY, searchGlossary } from "@/components/help/glossary";
import { cn } from "@/lib/utils";

const AUDIENCE_ICON: Record<string, LucideIcon> = { insurance: ShieldCheck, banking: Landmark, ngo: HandHeart, cooperative: Users, agribusiness: Wheat, government: Building2 };
const CAT_ICON: Record<string, LucideIcon> = { "Understanding risk": Gauge, "Using the workspace": Compass, "Account & billing": CreditCard, Developers: Code2 };
const field = "h-11 w-full rounded-xl border border-slate-700/80 bg-slate-950/60 px-3.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400/60 focus:outline-none focus:ring-2 focus:ring-cyan-400/15";

function ContactForm() {
  const { data: session } = useSession();
  const submit = trpc.workspace.submitTicket.useMutation();
  const [v, setV] = useState({ name: "", email: "", topic: "getting_started" as string, subject: "", message: "", website: "" });
  const [done, setDone] = useState<{ id: string; priority: string } | null>(null);
  const name = v.name || session?.user?.name || "";
  const email = v.email || session?.user?.email || "";
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await submit.mutateAsync({ name, email, topic: v.topic as "other", subject: v.subject, message: v.message, website: v.website || undefined });
      setDone({ id: r.id, priority: r.priority });
    } catch (err) {
      const z = (err as { data?: { zodError?: { fieldErrors?: Record<string, string[]> } } }).data?.zodError?.fieldErrors;
      toast.error(z ? `Please check: ${Object.keys(z).join(", ")}` : (err as Error).message);
    }
  };
  if (done)
    return (
      <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-emerald-500/15">
          <Send className="text-emerald-300" />
        </div>
        <h3 className="mt-3 font-display text-lg font-semibold text-white">Ticket {done.id} is open</h3>
        <p className="mt-1 text-sm text-slate-400">We've emailed a confirmation to {email}. Expect a reply within {done.priority === "high" ? "4 business hours" : "1 business day"}.</p>
        <button onClick={() => (setDone(null), setV((x) => ({ ...x, subject: "", message: "" })))} className="mt-4 text-sm text-cyan-300 hover:underline">
          Send another request
        </button>
      </motion.div>
    );
  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
      <label className="block">
        <span className="mb-1.5 block text-sm text-slate-300">Name</span>
        <input className={field} value={name} onChange={(e) => setV((x) => ({ ...x, name: e.target.value }))} required minLength={2} autoComplete="name" />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm text-slate-300">Email</span>
        <input type="email" className={field} value={email} onChange={(e) => setV((x) => ({ ...x, email: e.target.value }))} required autoComplete="email" />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm text-slate-300">Topic</span>
        <select className={field} value={v.topic} onChange={(e) => setV((x) => ({ ...x, topic: e.target.value }))}>
          <option value="getting_started">Getting started</option>
          <option value="data">Data & scores</option>
          <option value="billing">Plans & billing</option>
          <option value="api">API & integrations</option>
          <option value="bug">Something's broken</option>
          <option value="security">Security</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm text-slate-300">Subject</span>
        <input className={field} value={v.subject} onChange={(e) => setV((x) => ({ ...x, subject: e.target.value }))} required minLength={4} maxLength={140} />
      </label>
      <label className="block sm:col-span-2">
        <span className="mb-1.5 block text-sm text-slate-300">How can we help?</span>
        <textarea className={cn(field, "h-32 py-2.5")} value={v.message} onChange={(e) => setV((x) => ({ ...x, message: e.target.value }))} required minLength={10} maxLength={4000} />
      </label>
      <input tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" value={v.website} onChange={(e) => setV((x) => ({ ...x, website: e.target.value }))} />
      <div className="flex items-center justify-between gap-3 sm:col-span-2">
        <span className="text-xs text-slate-500">{session?.user ? "Signed in — we'll link this to your workspace." : "No account needed."}</span>
        <button type="submit" disabled={submit.isPending} className="inline-flex h-11 items-center gap-2 rounded-xl bg-cyan-400 px-5 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-60">
          {submit.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Send to support
        </button>
      </div>
    </form>
  );
}

export default function HelpHome() {
  const router = useRouter();
  const { data: session } = useSession();
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q.trim().toLowerCase());
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const setTour = trpc.workspace.setTour.useMutation();
  const inWorkspace = !!session?.user && session.user.role !== "farmer";

  const results = useMemo(() => {
    if (!dq) return null;
    const arts = HELP_ARTICLES.filter((a) => `${a.title} ${a.summary} ${a.body.map((b) => [b.h, b.p, ...(b.list ?? []), ...(b.steps ?? []), b.tip].join(" ")).join(" ")}`.toLowerCase().includes(dq));
    const faqs = FAQS.filter((f) => `${f.q} ${f.a}`.toLowerCase().includes(dq));
    const terms = searchGlossary(dq).slice(0, 8);
    return { arts, faqs, terms };
  }, [dq]);

  const restartTour = async () => {
    try {
      await setTour.mutateAsync({ action: "reset" });
      router.push("/app?tour=1");
    } catch {
      router.push("/auth/signin?callbackUrl=%2Fapp%3Ftour%3D1");
    }
  };

  const industries = HELP_ARTICLES.filter((a) => a.category === "Getting started");
  const categories = ["Understanding risk", "Using the workspace", "Account & billing", "Developers"] as const;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-20 pt-12 sm:px-6">
      {/* Hero + search */}
      <div className="mx-auto max-w-2xl text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/25 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200">
          <LifeBuoy size={13} /> Help centre
        </div>
        <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">How can we help?</h1>
        <p className="mt-2 text-slate-400">Guides for every team, plain-language explanations of every score, and a real person when you need one.</p>
        <label className="relative mt-6 block">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search e.g. ‘return period’, ‘invite’, ‘API key’, ‘salinity’" className="h-14 w-full rounded-2xl border border-slate-700 bg-slate-950/80 pl-12 pr-4 text-[15px] text-white placeholder:text-slate-500 shadow-[0_0_40px_-16px_rgba(56,189,248,0.6)] focus:border-cyan-400/60 focus:outline-none" aria-label="Search help" />
        </label>
      </div>

      <AnimatePresence mode="wait">
        {results ? (
          <motion.div key="results" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mx-auto mt-8 max-w-3xl space-y-6">
            {results.arts.length + results.faqs.length + results.terms.length === 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center text-sm text-slate-400">
                Nothing matched “{q}”.{" "}
                <a href="#contact" className="text-cyan-300 hover:underline">
                  Ask support
                </a>{" "}
                — we answer within one business day.
              </div>
            )}
            {results.terms.length > 0 && (
              <section>
                <div className="hud-label mb-2">Glossary</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {results.terms.map((t) => (
                    <Link key={t.key} href={`/help/glossary#${t.key}`} className="rounded-xl border border-white/10 bg-white/[0.02] p-3 hover:border-cyan-400/40">
                      <div className="text-sm font-medium text-white">{t.title}</div>
                      <div className="mt-0.5 text-[12.5px] text-slate-400 line-clamp-2">{t.short}</div>
                    </Link>
                  ))}
                </div>
              </section>
            )}
            {results.arts.length > 0 && (
              <section>
                <div className="hud-label mb-2">Guides</div>
                <div className="space-y-2">
                  {results.arts.map((a) => (
                    <Link key={a.slug} href={`/help/${a.slug}`} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 hover:border-cyan-400/40">
                      <BookOpen size={16} className="text-cyan-300" />
                      <span className="flex-1">
                        <span className="block text-sm font-medium text-white">{a.title}</span>
                        <span className="block text-[12.5px] text-slate-400">{a.summary}</span>
                      </span>
                      <ArrowRight size={15} className="text-slate-500" />
                    </Link>
                  ))}
                </div>
              </section>
            )}
            {results.faqs.length > 0 && (
              <section>
                <div className="hud-label mb-2">FAQs</div>
                <div className="space-y-2">
                  {results.faqs.map((f) => (
                    <div key={f.q} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                      <div className="text-sm font-medium text-white">{f.q}</div>
                      <div className="mt-1 text-[13px] text-slate-400">{f.a}</div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </motion.div>
        ) : (
          <motion.div key="home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {/* Quick links */}
            <div className="mx-auto mt-8 flex max-w-3xl flex-wrap justify-center gap-2">
              {inWorkspace && (
                <button onClick={restartTour} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3.5 py-1.5 text-sm text-emerald-200 hover:border-emerald-300">
                  <Compass size={14} /> Restart product tour
                </button>
              )}
              <Link href="/help/glossary" className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-sm text-slate-200 hover:border-cyan-400/40">
                <BookOpen size={14} /> Glossary
              </Link>
              <Link href="/status" className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-sm text-slate-200 hover:border-cyan-400/40">
                <Activity size={14} /> System status
              </Link>
              <Link href="/changelog" className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-sm text-slate-200 hover:border-cyan-400/40">
                <Megaphone size={14} /> What's new
              </Link>
              <Link href="/trust" className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-sm text-slate-200 hover:border-cyan-400/40">
                <ShieldCheck size={14} /> Trust centre
              </Link>
            </div>

            {/* Getting started per industry */}
            <section className="mt-12">
              <h2 className="font-display text-xl font-semibold text-white">Getting started — pick your team</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {industries.map((a, i) => {
                  const Icon = AUDIENCE_ICON[a.audience ?? ""] ?? BookOpen;
                  return (
                    <motion.div key={a.slug} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.04 }}>
                      <Link href={`/help/${a.slug}`} className="group flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-4 transition-colors hover:border-cyan-400/40">
                        <span className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-500/10">
                          <Icon size={18} className="text-cyan-300" />
                        </span>
                        <span className="mt-3 font-medium text-white">{a.title.replace("Getting started for ", "For ")}</span>
                        <span className="mt-1 flex-1 text-[13px] text-slate-400">{a.summary}</span>
                        <span className="mt-3 inline-flex items-center gap-1 text-[12.5px] text-cyan-300">
                          {a.minutes}-minute read <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
                        </span>
                      </Link>
                    </motion.div>
                  );
                })}
              </div>
            </section>

            {/* Categories */}
            <section className="mt-12 grid gap-4 md:grid-cols-2">
              {categories.map((c) => {
                const Icon = CAT_ICON[c] ?? BookOpen;
                return (
                  <div key={c} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                    <div className="flex items-center gap-2">
                      <Icon size={17} className="text-violet-300" />
                      <h3 className="font-display text-base font-semibold text-white">{c}</h3>
                    </div>
                    <ul className="mt-3 space-y-1">
                      {HELP_ARTICLES.filter((a) => a.category === c).map((a) => (
                        <li key={a.slug}>
                          <Link href={`/help/${a.slug}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[13.5px] text-slate-300 hover:bg-white/[0.04] hover:text-white">
                            {a.title} <ArrowRight size={13} className="shrink-0 text-slate-600" />
                          </Link>
                        </li>
                      ))}
                      {c === "Understanding risk" && (
                        <li>
                          <Link href="/help/glossary" className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[13.5px] text-slate-300 hover:bg-white/[0.04] hover:text-white">
                            Glossary — {Object.keys(GLOSSARY).length} terms in plain language <ArrowRight size={13} className="shrink-0 text-slate-600" />
                          </Link>
                        </li>
                      )}
                    </ul>
                  </div>
                );
              })}
            </section>

            {/* FAQs */}
            <section className="mt-12">
              <h2 className="font-display text-xl font-semibold text-white">Frequently asked questions</h2>
              <div className="mt-4 divide-y divide-white/[0.06] rounded-2xl border border-white/10 bg-white/[0.02]">
                {FAQS.map((f, i) => (
                  <div key={f.q}>
                    <button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left" aria-expanded={openFaq === i}>
                      <span className="hidden w-20 shrink-0 text-[11px] uppercase tracking-wider text-slate-500 sm:block">{f.category}</span>
                      <span className="flex-1 text-[14px] text-slate-100">{f.q}</span>
                      <ChevronDown size={16} className={cn("shrink-0 text-slate-500 transition-transform", openFaq === i && "rotate-180")} />
                    </button>
                    <AnimatePresence initial={false}>
                      {openFaq === i && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                          <p className="px-4 pb-4 text-[13.5px] leading-relaxed text-slate-400 sm:pl-[104px]">{f.a}</p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}
              </div>
            </section>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Contact */}
      <section id="contact" className="mt-14 scroll-mt-24 rounded-3xl border border-cyan-400/20 bg-gradient-to-br from-cyan-500/[0.06] to-violet-500/[0.04] p-5 sm:p-8">
        <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
          <div>
            <h2 className="font-display text-xl font-semibold text-white">Contact support</h2>
            <p className="mt-2 text-sm text-slate-400">A person reads every request. Normal requests: within 1 business day. Bugs and security: within 4 business hours.</p>
            <ul className="mt-4 space-y-2 text-[13px] text-slate-400">
              <li>• Include the workspace, asset or report name if it's about specific data.</li>
              <li>• For security issues, choose the Security topic.</li>
              <li>
                • Check the{" "}
                <Link href="/status" className="text-cyan-300 hover:underline">
                  status page
                </Link>{" "}
                first if data looks stale.
              </li>
            </ul>
          </div>
          <ContactForm />
        </div>
      </section>
    </div>
  );
}
