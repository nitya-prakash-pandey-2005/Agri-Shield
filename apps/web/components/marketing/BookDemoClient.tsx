"use client";

/**
 * Book-a-demo flow: details → slot picker in the visitor's own timezone →
 * billing.submitLead (stored + emailed) → confirmation with a .ics download.
 */
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarDays, CalendarPlus, CheckCircle2, Clock, Globe2, Loader2, Send } from "lucide-react";
import { z } from "zod";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { COMPANY_SIZES, INDUSTRIES, USE_CASES, industryById, type IndustryId } from "./industries";
import { buildIcs, demoSlots } from "./ics";
import { DemoLoginButton } from "./DemoLoginButton";

const DURATION_MIN = 30;

const schema = z.object({
  name: z.string().trim().min(2, "Enter your name"),
  email: z.string().trim().email("Enter a valid work email"),
  organisation: z.string().trim().min(2, "Enter your organisation"),
  role: z.string().trim().max(80).optional(),
  country: z.string().trim().max(60).optional(),
  message: z.string().trim().max(2000).optional(),
});

function tzInfo() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  let offset = "";
  try {
    offset = new Intl.DateTimeFormat("en-US", { timeZoneName: "shortOffset" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    /* older browsers */
  }
  return { tz, offset };
}

const fmtDay = (d: Date) => d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const fmtTime = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const fmtFull = (d: Date) => d.toLocaleString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" });

function googleCalUrl(start: Date, title: string, details: string) {
  const z = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const end = new Date(start.getTime() + DURATION_MIN * 60_000);
  const q = new URLSearchParams({ action: "TEMPLATE", text: title, dates: `${z(start)}/${z(end)}`, details });
  return `https://calendar.google.com/calendar/render?${q}`;
}

export function BookDemoClient({ initialIndustry, plan }: { initialIndustry: IndustryId | null; plan: string | null }) {
  const [industry, setIndustry] = useState<IndustryId>(initialIndustry ?? "insurance");
  const [size, setSize] = useState(COMPANY_SIZES[2]!);
  const [useCase, setUseCase] = useState<string>(USE_CASES[initialIndustry ?? "insurance"][0]!);
  const [days, setDays] = useState<{ day: Date; slots: Date[] }[] | null>(null);
  const [dayIdx, setDayIdx] = useState(0);
  const [slot, setSlot] = useState<Date | null>(null);
  const [tz, setTz] = useState<{ tz: string; offset: string }>({ tz: "UTC", offset: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [contact, setContact] = useState<{ name: string; email: string; organisation: string } | null>(null);
  const submit = trpc.billing.submitLead.useMutation();

  // slots depend on the visitor's clock + timezone → compute on the client only
  useEffect(() => {
    setDays(demoSlots(new Date(), 10));
    setTz(tzInfo());
  }, []);

  useEffect(() => {
    setUseCase(USE_CASES[industry][0]!);
  }, [industry]);

  const ind = industryById(industry)!;
  const current = days?.[dayIdx];

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const raw = Object.fromEntries(["name", "email", "organisation", "role", "country", "message"].map((k) => [k, String(fd.get(k) ?? "")]));
    const parsed = schema.safeParse(raw);
    const errs: Record<string, string> = {};
    if (!parsed.success) for (const issue of parsed.error.issues) errs[String(issue.path[0])] = issue.message;
    if (!slot) errs.slot = "Pick a time that suits you";
    setErrors(errs);
    if (!parsed.success || !slot) {
      document.querySelector<HTMLElement>("[aria-invalid='true'], #slot-err")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setContact({ name: parsed.data.name, email: parsed.data.email, organisation: parsed.data.organisation });
    submit.mutate({
      name: parsed.data.name,
      email: parsed.data.email,
      organisation: parsed.data.organisation,
      role: parsed.data.role || undefined,
      country: parsed.data.country || undefined,
      message: [plan ? `Plan of interest: ${plan}` : "", parsed.data.message ?? ""].filter(Boolean).join("\n"),
      interest: "demo",
      source: "book-demo",
      industry,
      companySize: size,
      useCase,
      preferredSlot: slot.toISOString(),
      timezone: tz.tz,
      website: String(fd.get("website") ?? "") || undefined,
    });
  };

  const downloadIcs = () => {
    if (!slot || !submit.data) return;
    const ics = buildIcs({
      uid: `${submit.data.id}@agrishield.io`,
      start: slot,
      durationMinutes: DURATION_MIN,
      summary: "Agri-SHIELD demo",
      description: `${ind.title} walkthrough for ${contact?.organisation ?? "your team"} (${useCase}). Reference ${submit.data.id}. The video link follows by email.`,
      location: "Video call (link by email)",
      url: "https://agrishield.io/book-demo",
      organizerEmail: "partners@agrishield.io",
      organizerName: "Agri-SHIELD",
      attendeeEmail: contact?.email,
      attendeeName: contact?.name,
    });
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "agri-shield-demo.ics";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const input = (name: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block">
      <span className="mb-1.5 block text-xs text-slate-400">{label}</span>
      <input name={name} className="site-input" aria-invalid={!!errors[name]} aria-describedby={errors[name] ? `${name}-err` : undefined} {...props} />
      {errors[name] && (
        <span id={`${name}-err`} className="mt-1 block text-xs text-rose-300">
          {errors[name]}
        </span>
      )}
    </label>
  );

  const chip = (on: boolean) => cn("min-h-[40px] rounded-lg border px-3 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-emerald-400", on ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-100" : "border-white/10 text-slate-300 hover:border-white/25");

  return (
    <AnimatePresence mode="wait">
      {submit.isSuccess && slot ? (
        <motion.section key="done" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-2xl text-center" role="status" aria-live="polite">
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 240, damping: 14 }} className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-emerald-400/15 ring-1 ring-emerald-400/40">
            <CheckCircle2 size={40} className="text-emerald-300" />
          </motion.span>
          <h2 className="mt-6 font-display text-3xl font-semibold text-white sm:text-4xl">Your demo request is in</h2>
          <p className="mt-3 text-slate-400">We’ll confirm the video link by email within one business day. Nothing else to do.</p>
          <dl className="mx-auto mt-8 grid max-w-lg gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 text-left text-sm sm:grid-cols-2">
            {[
              ["When (your time)", fmtFull(slot)],
              ["Timezone", `${tz.tz}${tz.offset ? ` · ${tz.offset}` : ""}`],
              ["In UTC", slot.toISOString().replace("T", " ").slice(0, 16)],
              ["Duration", `${DURATION_MIN} minutes`],
              ["Focus", `${ind.title} · ${useCase}`],
              ["Reference", submit.data.id],
            ].map(([k, v]) => (
              <div key={k} className="bg-[#07101f] p-3">
                <dt className="text-xs text-slate-500">{k}</dt>
                <dd className="mt-0.5 text-slate-100">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <button type="button" onClick={downloadIcs} className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-emerald-500 px-6 font-semibold text-slate-950 hover:bg-emerald-400">
              <CalendarPlus size={17} aria-hidden /> Download .ics
            </button>
            <a
              href={googleCalUrl(slot, "Agri-SHIELD demo", `${ind.title} walkthrough. Reference ${submit.data.id}.`)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-white/15 px-6 text-white hover:border-white/35"
            >
              <CalendarDays size={17} aria-hidden /> Add to Google Calendar
            </a>
          </div>
          <div className="mt-10 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 text-left">
            <h3 className="font-display text-lg font-semibold text-white">While you wait</h3>
            <p className="mt-1 text-sm text-slate-400">Open the {ind.title.toLowerCase()} demo workspace, loaded with illustrative data, and look around.</p>
            <DemoLoginButton demo={ind.demo} label="Open the demo workspace" className="mt-4 w-full sm:w-auto" />
          </div>
        </motion.section>
      ) : (
        <motion.form key="form" onSubmit={onSubmit} noValidate aria-label="Book a demo" className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <div className="min-w-0 space-y-5">
            <fieldset>
              <legend className="mb-2 text-xs text-slate-400">Your organisation</legend>
              <div className="flex flex-wrap gap-1.5">
                {INDUSTRIES.map((i) => (
                  <label key={i.id} className={cn(chip(industry === i.id), "inline-flex cursor-pointer items-center")}>
                    <input type="radio" name="industry" value={i.id} checked={industry === i.id} onChange={() => setIndustry(i.id)} className="sr-only" />
                    {i.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              {input("name", "Full name", { autoComplete: "name", placeholder: "Your name" })}
              {input("email", "Work email", { type: "email", autoComplete: "email", placeholder: "you@company.com" })}
              {input("organisation", "Organisation", { autoComplete: "organization", placeholder: "Company, agency or NGO" })}
              {input("role", "Role (optional)", { placeholder: "e.g. Head of Underwriting" })}
              <label className="block">
                <span className="mb-1.5 block text-xs text-slate-400">Company size</span>
                <select value={size} onChange={(e) => setSize(e.target.value)} className="site-input">
                  {COMPANY_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s} people
                    </option>
                  ))}
                </select>
              </label>
              {input("country", "Country (optional)", { autoComplete: "country-name", placeholder: "Bangladesh, Vietnam, India…" })}
            </div>
            <fieldset>
              <legend className="mb-2 text-xs text-slate-400">Main use case</legend>
              <div className="flex flex-wrap gap-1.5">
                {USE_CASES[industry].map((u) => (
                  <label key={u} className={cn(chip(useCase === u), "inline-flex cursor-pointer items-center")}>
                    <input type="radio" name="useCase" value={u} checked={useCase === u} onChange={() => setUseCase(u)} className="sr-only" />
                    {u}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block">
              <span className="mb-1.5 block text-xs text-slate-400">Anything we should prepare? (optional)</span>
              <textarea name="message" rows={3} className="site-input resize-y" placeholder="Regions, number of assets, systems to integrate with…" />
            </label>
            <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
          </div>

          <div className="min-w-0 space-y-4">
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-white">
                  <Clock size={17} className="text-emerald-300" aria-hidden /> Pick a {DURATION_MIN}-minute slot
                </h2>
                <span className="inline-flex items-center gap-1.5 rounded-md bg-black/30 px-2 py-1 text-xs text-slate-300" title="Times are shown in your browser's timezone">
                  <Globe2 size={12} aria-hidden /> {tz.tz}
                  {tz.offset && <span className="text-slate-500">· {tz.offset}</span>}
                </span>
              </div>
              {!days ? (
                <div className="mt-4 h-40 animate-pulse rounded-xl bg-white/[0.03]" />
              ) : (
                <>
                  <div role="radiogroup" aria-label="Day" className="mt-4 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
                    {days.map((d, i) => (
                      <button
                        key={d.day.toISOString()}
                        type="button"
                        role="radio"
                        aria-checked={dayIdx === i}
                        onClick={() => {
                          setDayIdx(i);
                          setSlot(null);
                        }}
                        className={cn("min-h-[52px] min-w-[74px] shrink-0 rounded-xl border px-2 text-center text-xs transition-colors", dayIdx === i ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-100" : "border-white/10 text-slate-300 hover:border-white/25")}
                      >
                        {fmtDay(d.day)}
                      </button>
                    ))}
                  </div>
                  <div role="radiogroup" aria-label="Time" className="mt-3 grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                    {current?.slots.map((s) => {
                      const on = slot?.getTime() === s.getTime();
                      return (
                        <button key={s.toISOString()} type="button" role="radio" aria-checked={on} onClick={() => setSlot(s)} className={cn("telemetry min-h-[40px] rounded-lg border text-sm transition-colors", on ? "border-transparent bg-emerald-400 font-semibold text-slate-950" : "border-white/10 text-slate-200 hover:border-white/30")}>
                          {fmtTime(s)}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              {errors.slot && (
                <p id="slot-err" className="mt-2 text-xs text-rose-300" role="alert">
                  {errors.slot}
                </p>
              )}
              {slot && <p className="mt-3 text-sm text-slate-300">Selected: {fmtFull(slot)}</p>}
            </div>
            {submit.error && (
              <p className="text-sm text-rose-300" role="alert">
                {submit.error.message.includes("Rate limit") ? "Too many requests. Wait a minute and try again." : "Couldn’t send your request. Check the fields and try again."}
              </p>
            )}
            <button type="submit" disabled={submit.isPending} className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-6 text-[15px] font-semibold text-slate-950 transition-colors hover:bg-emerald-400 disabled:opacity-60">
              {submit.isPending ? <Loader2 size={17} className="animate-spin" /> : <Send size={16} />}
              Request this slot
            </button>
            <p className="text-[11px] text-slate-500">
              We use these details only to arrange the demo. See our{" "}
              <a href="/docs/privacy" className="underline underline-offset-2">
                privacy policy
              </a>
              .
            </p>
          </div>
        </motion.form>
      )}
    </AnimatePresence>
  );
}
