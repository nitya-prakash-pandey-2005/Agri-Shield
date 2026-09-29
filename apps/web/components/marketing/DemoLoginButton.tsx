"use client";

/**
 * One-click sign-in to the seeded demo workspace for an industry
 * (password demo2026 / farmer OTP 123456 — both published on the sign-in page).
 */
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState } from "react";
import { ArrowRight, Loader2, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { DemoLogin } from "./industries";

export function DemoLoginButton({ demo, label = "Open the live demo workspace", className, variant = "primary" }: { demo: DemoLogin; label?: string; className?: string; variant?: "primary" | "ghost" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const creds = demo.mode === "otp" ? { mode: "otp", identifier: demo.email, otp: "123456" } : { mode: "password", email: demo.email, password: "demo2026" };
      const res = await signIn("credentials", { ...creds, redirect: false });
      if (!res || res.error) throw new Error(res?.error ?? "Sign-in failed");
      router.push(demo.home);
      router.refresh();
    } catch (e) {
      toast.error("Couldn’t open the demo", { description: (e as Error).message });
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={go}
      disabled={busy}
      title={`Signs in as ${demo.email}`}
      className={cn(
        "group inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-6 text-[15px] font-semibold transition-all active:scale-[0.98] disabled:opacity-70",
        variant === "primary" ? "bg-emerald-500 text-slate-950 shadow-[0_10px_40px_-12px_rgba(16,185,129,0.9)] hover:bg-emerald-400" : "border border-slate-600/70 bg-slate-950/40 text-slate-100 hover:border-slate-400",
        className
      )}
    >
      {busy ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <PlayCircle size={17} aria-hidden />}
      {label}
      {!busy && <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" aria-hidden />}
    </button>
  );
}
