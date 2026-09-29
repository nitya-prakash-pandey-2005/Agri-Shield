"use client";

/**
 * Invite redemption — /invite/<token>. Shows who invited you to which
 * workspace, then creates your account inside it and signs you in.
 */
import Link from "next/link";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn, signOut, useSession } from "next-auth/react";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Loader2, MailCheck, Shield } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { inputCls } from "@/components/workspace/ui";

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const { data: session } = useSession();
  const info = trpc.workspace.inviteInfo.useQuery({ token }, { retry: false });
  const accept = trpc.workspace.acceptInvite.useMutation();
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!info.data?.valid) return;
    if (name.trim().length < 2) return setError("Enter your full name");
    if (pw.length < 8) return setError("Password must be at least 8 characters");
    if (pw !== pw2) return setError("Passwords don't match");
    setError(null);
    setJoining(true);
    try {
      const r = await accept.mutateAsync({ token, name: name.trim(), password: pw, title: title.trim() || undefined });
      const res = await signIn("credentials", { mode: "password", email: r.email, password: pw, redirect: false });
      if (!res || res.error) throw new Error("Account created — please sign in.");
      router.push("/app?welcome=1");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setJoining(false);
    }
  };

  const d = info.data;
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden hud-bg px-4 py-10 text-slate-200">
      <div className="pointer-events-none absolute -left-40 -top-40 h-[480px] w-[480px] rounded-full bg-cyan-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-[520px] w-[520px] rounded-full bg-emerald-500/10 blur-3xl" />
      <Link href="/" className="absolute left-4 top-4 flex items-center gap-2 sm:left-8">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600">
          <Shield size={17} className="text-slate-950" />
        </span>
        <span className="font-display text-lg font-semibold text-white">
          Agri<span className="text-emerald-400">-SHIELD</span>
        </span>
      </Link>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="hud-panel relative w-full max-w-md p-6">
        {info.isLoading ? (
          <div className="py-12 text-center">
            <Loader2 className="mx-auto animate-spin text-cyan-300" />
          </div>
        ) : !d || !d.valid ? (
          <div className="py-4 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-500/15">
              <AlertTriangle className="text-amber-300" />
            </div>
            <h1 className="mt-4 font-display text-xl font-semibold text-white">This invite can't be used</h1>
            <p className="mt-2 text-sm text-slate-400">{d && !d.valid ? d.reason : info.error?.message ?? "Invalid link."}</p>
            <div className="mt-5 flex justify-center gap-2">
              <Link href="/auth/signin" className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:border-cyan-400/50">
                Sign in
              </Link>
              <Link href="/help#contact" className="rounded-lg bg-cyan-400 px-3 py-2 text-sm font-semibold text-slate-950">
                Contact support
              </Link>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-xl font-display text-lg font-bold text-slate-950" style={{ background: d.logoColor }}>
                {d.logoInitials}
              </span>
              <div className="min-w-0">
                <div className="hud-label text-cyan-300/80">You're invited</div>
                <div className="truncate font-display text-lg font-semibold text-white">{d.orgName}</div>
                <div className="text-[12px] text-slate-500">{d.industry} workspace</div>
              </div>
            </div>
            <p className="mt-4 text-sm text-slate-300">
              <b className="text-white">{d.invitedByName}</b> invited <b className="text-white">{d.email}</b> to join as <b className="text-cyan-300">{d.roleLabel}</b>. The invite expires {new Date(d.expiresAt).toISOString().slice(0, 10)}.
            </p>

            {session?.user ? (
              <div className="mt-5 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-sm text-amber-100">
                You're signed in as {session.user.email ?? session.user.name}. Sign out first to accept this invite as {d.email}.
                <button onClick={() => signOut({ redirect: false }).then(() => router.refresh())} className="mt-2 block rounded-md bg-amber-400 px-3 py-1.5 text-xs font-semibold text-slate-950">
                  Sign out
                </button>
              </div>
            ) : (
              <form onSubmit={submit} className="mt-5 space-y-3" noValidate>
                {error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</div>}
                <label className="block">
                  <span className="mb-1.5 block text-[13px] text-slate-300">Email</span>
                  <input className={cn(inputCls, "h-11 opacity-70")} value={d.email} disabled />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[13px] text-slate-300">Full name</span>
                  <input className={cn(inputCls, "h-11")} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[13px] text-slate-300">
                    Job title <span className="text-slate-500">(optional)</span>
                  </span>
                  <input className={cn(inputCls, "h-11")} value={title} onChange={(e) => setTitle(e.target.value)} />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="mb-1.5 block text-[13px] text-slate-300">Password</span>
                    <input type="password" className={cn(inputCls, "h-11")} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" placeholder="8+ characters" />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[13px] text-slate-300">Confirm</span>
                    <input type="password" className={cn(inputCls, "h-11")} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
                  </label>
                </div>
                <button type="submit" disabled={joining} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 font-semibold text-slate-950 shadow-[0_0_24px_-6px_rgba(56,189,248,0.9)] disabled:opacity-60">
                  {joining ? <Loader2 size={17} className="animate-spin" /> : <MailCheck size={17} />} Join {d.orgShort}
                  {!joining && <ArrowRight size={16} />}
                </button>
                <p className="text-center text-[11.5px] text-slate-500">
                  By joining you agree to the <Link href="/docs/terms" className="text-cyan-300">terms</Link> and <Link href="/docs/privacy" className="text-cyan-300">privacy policy</Link>.
                </p>
              </form>
            )}
          </>
        )}
      </motion.div>
    </div>
  );
}
