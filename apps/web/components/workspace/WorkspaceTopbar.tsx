"use client";

/**
 * Workspace top-bar extras: workspace badge, trial countdown, help menu
 * (help centre, restart tour, status) and the notifications bell.
 */
import * as Popover from "@radix-ui/react-popover";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, CircleHelp, Compass, Activity, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";


export function WorkspaceBadge() {
  const me = trpc.workspace.me.useQuery(undefined, { staleTime: 60_000 });
  const org = me.data?.org;
  if (!org) return null;
  return (
    <Link href="/app/settings" className="hidden md:flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-2 py-1 hover:border-white/15" title={`${org.name} · ${org.industryLabel}`}>
      <span className="grid h-6 w-6 place-items-center rounded-md text-[10px] font-bold text-slate-950" style={{ background: org.logoColor }}>
        {org.logoInitials}
      </span>
      <span className="max-w-[140px] truncate text-xs text-slate-200">{org.shortName}</span>
      <span className="telemetry text-[9px] uppercase text-slate-500">{org.planLabel}</span>
    </Link>
  );
}

export function TrialChip() {
  const me = trpc.workspace.me.useQuery(undefined, { staleTime: 60_000 });
  const t = me.data?.trial;
  if (!t || (!t.trialing && !t.expired)) return null;
  return (
    <Link
      href="/app/settings/billing"
      className={cn("hidden sm:inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium", t.expired ? "bg-rose-500/15 text-rose-300" : (t.daysLeft ?? 0) <= 3 ? "bg-amber-500/15 text-amber-300" : "bg-cyan-500/10 text-cyan-300")}
    >
      <Sparkles size={12} />
      {t.expired ? "Trial ended · choose a plan" : `Trial · ${t.daysLeft} day${t.daysLeft === 1 ? "" : "s"} left`}
    </Link>
  );
}

export function HelpMenu() {
  const router = useRouter();
  const setTour = trpc.workspace.setTour.useMutation();
  const utils = trpc.useUtils();
  const restart = async () => {
    await setTour.mutateAsync({ action: "reset" });
    await utils.workspace.tourState.invalidate();
    router.push("/app?tour=1");
  };
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="hidden h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white sm:grid" aria-label="Help" data-tour="help">
          <CircleHelp size={17} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="z-[120] w-60 rounded-xl border border-white/10 bg-[#081022]/95 p-1.5 shadow-2xl backdrop-blur-xl">
          <Link href="/help" className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-slate-200 hover:bg-white/5">
            <BookOpen size={15} className="text-cyan-300" /> Help centre
          </Link>
          <button onClick={restart} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-slate-200 hover:bg-white/5">
            <Compass size={15} className="text-emerald-300" /> Restart product tour
          </button>
          <Link href="/help/glossary" className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-slate-200 hover:bg-white/5">
            <BookOpen size={15} className="text-violet-300" /> Glossary of terms
          </Link>
          <Link href="/status" className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-slate-200 hover:bg-white/5">
            <Activity size={15} className="text-emerald-300" /> System status
          </Link>
          <Link href="/help#contact" className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-slate-200 hover:bg-white/5">
            <CircleHelp size={15} className="text-amber-300" /> Contact support
          </Link>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
