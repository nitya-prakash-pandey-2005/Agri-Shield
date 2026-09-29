"use client";

import { useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import { motion } from "framer-motion";
import { KeyRound, Laptop, LogOut, RefreshCw, ShieldCheck, ShieldOff, ShieldAlert } from "lucide-react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { EmptyState, Panel } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { Btn, Modal } from "@/components/workspace/ui";
import { RecoveryCodes } from "@/app/auth/two-factor/_components/RecoveryCodes";
import { EnrolModal } from "./EnrolModal";
import { ReauthModal } from "./ReauthModal";
import { DeviceIcon, Hint, METHOD_LABEL, Pill, errMsg, toastErr } from "./shared";
import { cn } from "@/lib/utils";

type Overview = RouterOutputs["developer"]["security"]["overview"];

const ago = (d: Date | string | null) => (d ? formatDistanceToNowStrict(new Date(d), { addSuffix: true }) : "—");

export function TwoFactorPanel({ d, refresh }: { d: Overview; refresh: () => void }) {
  const [enrolOpen, setEnrolOpen] = useState(false);
  const [mode, setMode] = useState<"disable" | "regen" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const disable = trpc.developer.security.disable2fa.useMutation();
  const regen = trpc.developer.security.regenerateRecovery.useMutation();
  const tf = d.twoFactor;
  const required = d.policy.require2fa;

  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          2-step verification <Explain text="After your password, Agri-SHIELD asks for a 6-digit code from an app on your phone (TOTP, RFC 6238). A stolen password alone can no longer open your account." title="2-step verification" />
        </span>
      }
      subtitle="Authenticator app (TOTP) + 10 single-use recovery codes"
      icon={ShieldCheck}
      accent="emerald"
      sweep={!tf.enrolled}
    >
      <div className={cn("flex items-start gap-3 rounded-xl border px-3.5 py-3", tf.enrolled ? "border-emerald-400/25 bg-emerald-400/[0.05]" : "border-amber-400/25 bg-amber-400/[0.05]")}>
        <motion.span initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", tf.enrolled ? "bg-emerald-400/15 text-emerald-300" : "bg-amber-400/15 text-amber-300")}>
          {tf.enrolled ? <ShieldCheck size={19} /> : <ShieldAlert size={19} />}
        </motion.span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-white">
            {tf.enrolled ? "On — authenticator app" : "Off"}
            {required && <Pill tone="cyan">Required by {d.org?.name ?? "workspace"}</Pill>}
          </div>
          <p className="mt-0.5 text-[12px] text-slate-400">
            {tf.enrolled ? (
              <>
                Enabled {ago(tf.since)} · last used {ago(tf.lastUsedAt)} ·{" "}
                <span className={tf.recoveryLeft <= 3 ? "text-amber-300" : ""}>{tf.recoveryLeft} of 10 recovery codes left</span>
              </>
            ) : (
              "Anyone with your password can sign in. Turn this on — it takes about a minute."
            )}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {tf.enrolled ? (
          <>
            <Btn variant="outline" onClick={() => (setErr(null), setMode("regen"))}>
              <RefreshCw size={14} /> New recovery codes
            </Btn>
            <Btn variant="ghost" className="text-rose-300 hover:bg-rose-500/10" disabled={required} title={required ? "Your workspace requires 2-step verification" : undefined} onClick={() => (setErr(null), setMode("disable"))}>
              <ShieldOff size={14} /> Turn off
            </Btn>
          </>
        ) : (
          <Btn onClick={() => setEnrolOpen(true)}>
            <KeyRound size={14} /> Set up authenticator app
          </Btn>
        )}
      </div>
      <div className="mt-3">
        <Hint>
          <b className="text-slate-300">What this means:</b> codes change every 30 seconds and each can be used once. Sign-in accepts the code before and after the current one to allow for clock drift. After 5 wrong codes sign-in pauses for 15 minutes.
        </Hint>
      </div>

      <EnrolModal open={enrolOpen} onClose={() => setEnrolOpen(false)} account={d.user.email ?? d.user.name} onDone={refresh} />
      <ReauthModal
        open={mode === "disable"}
        onClose={() => setMode(null)}
        title="Turn off 2-step verification?"
        description="Confirm it's you. Your account will be protected by your password only."
        confirmLabel="Turn off"
        danger
        hasPassword={d.user.hasPassword}
        busy={disable.isPending}
        error={err}
        onSubmit={async (v) => {
          try {
            await disable.mutateAsync(v);
            toast.success("2-step verification turned off");
            setMode(null);
            refresh();
          } catch (e) {
            setErr(errMsg(e));
          }
        }}
      />
      <ReauthModal
        open={mode === "regen"}
        onClose={() => setMode(null)}
        title="Generate new recovery codes"
        description="Your current recovery codes stop working immediately."
        confirmLabel="Generate"
        hasPassword={d.user.hasPassword}
        busy={regen.isPending}
        error={err}
        onSubmit={async (v) => {
          try {
            const r = await regen.mutateAsync(v);
            setMode(null);
            setNewCodes(r.recoveryCodes);
            refresh();
          } catch (e) {
            setErr(errMsg(e));
          }
        }}
      />
      <Modal open={!!newCodes} onClose={() => setNewCodes(null)} title="Your new recovery codes" wide footer={<Btn onClick={() => setNewCodes(null)}>Done</Btn>}>
        {newCodes && <RecoveryCodes codes={newCodes} account={d.user.email ?? d.user.name} />}
      </Modal>
    </Panel>
  );
}

export function SessionsPanel({ d, refresh }: { d: Overview; refresh: () => void }) {
  const revoke = trpc.developer.security.revokeSession.useMutation();
  const others = trpc.developer.security.revokeOtherSessions.useMutation();
  const active = d.sessions.filter((s) => !s.revokedAt);
  const otherActive = active.filter((s) => !s.current).length;
  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          Where you're signed in <Explain text="Each sign-in creates a server-side session. Revoking one signs that browser or device out on its very next request — it doesn't wait for the 7-day token to expire." title="Sessions" />
        </span>
      }
      subtitle={`${active.length} active session${active.length === 1 ? "" : "s"}`}
      icon={Laptop}
      accent="cyan"
      live
      actions={
        otherActive > 0 && (
          <Btn
            variant="outline"
            className="h-8 px-2.5 py-0 text-xs"
            disabled={others.isPending}
            onClick={async () => {
              if (!window.confirm(`Sign out ${otherActive} other session(s)? Those devices will need to sign in again.`)) return;
              try {
                const r = await others.mutateAsync();
                toast.success(`Signed out ${r.revoked} other session(s)`);
                refresh();
              } catch (e) {
                toastErr(e);
              }
            }}
          >
            <LogOut size={13} /> Sign out all others
          </Btn>
        )
      }
    >
      {d.sessions.length === 0 ? (
        <EmptyState icon={Laptop} title="No tracked sessions yet">
          Sessions appear here after you sign in.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-white/5">
          {d.sessions.map((s) => (
            <li key={s.id} className={cn("flex items-center gap-3 py-2.5", s.revokedAt && "opacity-50")}>
              <DeviceIcon kind={s.device.kind} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-slate-100">
                  {s.device.label}
                  {s.current && <Pill tone="emerald">This device</Pill>}
                  {s.mfa && <Pill tone="cyan">2-step</Pill>}
                  {s.revokedAt && <Pill tone="slate">Signed out {ago(s.revokedAt)}</Pill>}
                </div>
                <div className="telemetry truncate text-[11px] text-slate-500">
                  IP {s.ip} · via {METHOD_LABEL[s.method] ?? s.method} · signed in {ago(s.createdAt)} · active {ago(s.lastSeen)}
                </div>
              </div>
              {!s.current && !s.revokedAt && (
                <button
                  onClick={async () => {
                    try {
                      await revoke.mutateAsync({ id: s.id });
                      toast.success("Session revoked — that device is signed out");
                      refresh();
                    } catch (e) {
                      toastErr(e);
                    }
                  }}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-slate-400 hover:bg-rose-500/10 hover:text-rose-300"
                >
                  <LogOut size={12} /> Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
