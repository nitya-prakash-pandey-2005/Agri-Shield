"use client";

import type { ReactNode } from "react";
import { Laptop, Server, Smartphone, TerminalSquare } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const errMsg = (e: unknown) => (e as Error)?.message ?? "Something went wrong";
export const toastErr = (e: unknown) => toast.error(errMsg(e));

export function Pill({ tone = "slate", children, className }: { tone?: "emerald" | "amber" | "rose" | "cyan" | "slate" | "violet"; children: ReactNode; className?: string }) {
  const tones = {
    emerald: "bg-emerald-500/10 text-emerald-300 ring-emerald-400/20",
    amber: "bg-amber-500/10 text-amber-300 ring-amber-400/20",
    rose: "bg-rose-500/10 text-rose-300 ring-rose-400/20",
    cyan: "bg-cyan-500/10 text-cyan-300 ring-cyan-400/20",
    violet: "bg-violet-500/10 text-violet-300 ring-violet-400/20",
    slate: "bg-slate-700/40 text-slate-300 ring-white/10",
  } as const;
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-medium ring-1", tones[tone], className)}>{children}</span>;
}

export function DeviceIcon({ kind, className }: { kind: string; className?: string }) {
  const I = kind === "mobile" ? Smartphone : kind === "api" ? TerminalSquare : kind === "desktop" ? Laptop : Server;
  return <I size={16} className={cn("shrink-0 text-slate-400", className)} />;
}

export const METHOD_LABEL: Record<string, string> = {
  password: "password",
  otp: "e-mail/SMS code",
  "password+totp": "password + authenticator",
  "password+recovery": "password + recovery code",
  "otp+totp": "code + authenticator",
  "otp+recovery": "code + recovery code",
  sso: "single sign-on",
  restored: "earlier sign-in",
};

export function Hint({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-white/5 bg-slate-900/50 px-3 py-2 text-[11.5px] leading-relaxed text-slate-400">{children}</p>;
}
