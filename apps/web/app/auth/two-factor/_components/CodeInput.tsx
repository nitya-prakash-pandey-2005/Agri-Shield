"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/utils";

/**
 * One-time code field: 6-digit TOTP (numeric keypad, OS autofill) or a
 * recovery code (xxxxx-xxxxx) when `recovery` is set.
 */
export const CodeInput = forwardRef<HTMLInputElement, { value: string; onChange: (v: string) => void; recovery?: boolean; invalid?: boolean; disabled?: boolean; autoFocus?: boolean; id?: string }>(function CodeInput({ value, onChange, recovery, invalid, disabled, autoFocus, id }, ref) {
  return (
    <input
      ref={ref}
      id={id}
      value={value}
      disabled={disabled}
      autoFocus={autoFocus}
      onChange={(e) => onChange(recovery ? e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 11) : e.target.value.replace(/\D/g, "").slice(0, 6))}
      inputMode={recovery ? "text" : "numeric"}
      autoComplete="one-time-code"
      spellCheck={false}
      placeholder={recovery ? "xxxxx-xxxxx" : "000000"}
      aria-label={recovery ? "Recovery code" : "6-digit code from your authenticator app"}
      aria-invalid={invalid}
      className={cn(
        "telemetry h-14 w-full rounded-xl border bg-slate-950/70 text-center text-2xl tracking-[0.45em] text-white placeholder:text-slate-700 focus:outline-none focus:ring-2 disabled:opacity-60",
        recovery && "text-xl tracking-[0.2em]",
        invalid ? "border-rose-500/70 focus:ring-rose-500/20" : "border-slate-700 focus:border-cyan-400/70 focus:ring-cyan-400/20"
      )}
    />
  );
});
