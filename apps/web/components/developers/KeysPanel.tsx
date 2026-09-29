"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import { FlaskConical, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { EmptyState, Panel, Skeleton } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { Btn, Modal, inputCls } from "@/components/workspace/ui";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./CodeBlock";
import { rememberKey, rememberedKeys } from "./ApiExplorer";

export function KeysPanel() {
  const utils = trpc.useUtils();
  const q = trpc.developer.keys.useQuery();
  const create = trpc.developer.createSandboxKey.useMutation();
  const revoke = trpc.developer.revokeKey.useMutation();
  const [name, setName] = useState("");
  const [revealed, setRevealed] = useState<{ key: string; prefix: string; expiresAt: Date | string } | null>(null);
  const [known, setKnown] = useState<Record<string, string>>({});
  useEffect(() => setKnown(rememberedKeys()), [revealed]);

  const d = q.data;
  if (!d) return <Skeleton className="h-80" />;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr,1fr]">
      <Panel
        title={
          <span className="flex items-center gap-1.5">
            API keys <Explain text="Live keys (ags_live_…) are for production integrations and are managed by admins in Settings → API & integrations. Sandbox keys (ags_test_…) are read-only, expire automatically after 30 days and are meant for trying the API." title="API keys" />
          </span>
        }
        subtitle={`${d.keys.length} key(s) · ${d.keys.filter((k) => k.sandbox).length} sandbox`}
        icon={KeyRound}
        accent="cyan"
        actions={
          <Link href="/app/settings/api" className="text-[11.5px] text-cyan-300 hover:underline">
            Manage live keys →
          </Link>
        }
      >
        {d.keys.length === 0 ? (
          <EmptyState icon={KeyRound} title="No API keys yet">
            Create a sandbox key on the right to try the API in minutes.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-white/5">
            {d.keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-3 py-2.5">
                {k.sandbox ? <FlaskConical size={15} className="text-amber-300" /> : <KeyRound size={15} className="text-emerald-300" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-slate-100">
                    {k.name}
                    {k.sandbox && <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">sandbox</span>}
                    {known[k.id] && <span className="rounded-full bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-300">usable in this browser</span>}
                    {!k.sandbox && k.ageDays > 90 && <span className="rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-300">rotate · {k.ageDays} days old</span>}
                  </div>
                  <div className="text-[11.5px] text-slate-500">
                    <span className="telemetry text-slate-400">{k.prefix}…</span> · {k.scopes.join(", ")} · {k.calls7d} calls in 7 d · {k.lastUsed ? `used ${formatDistanceToNowStrict(new Date(k.lastUsed), { addSuffix: true })}` : "never used"}
                    {k.expiresAt && ` · expires ${new Date(k.expiresAt).toISOString().slice(0, 10)}`}
                  </div>
                </div>
                {(k.sandbox || d.canManage) && (
                  <button
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-slate-400 hover:bg-rose-500/10 hover:text-rose-300"
                    onClick={async () => {
                      if (!window.confirm(`Revoke "${k.name}"? Anything using it stops working immediately.`)) return;
                      try {
                        await revoke.mutateAsync({ id: k.id });
                        rememberKey(k.id, null);
                        setKnown(rememberedKeys());
                        toast.success("Key revoked");
                        await utils.developer.keys.invalidate();
                      } catch (e) {
                        toast.error((e as Error).message);
                      }
                    }}
                  >
                    <Trash2 size={12} /> Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Create a sandbox key" icon={FlaskConical} accent="amber">
        <p className="text-[12.5px] text-slate-400">
          Read-only scopes (<span className="telemetry">{d.sandboxScopes.join(", ")}</span>), expires after {d.sandboxTtlDays} days. Any member can create one; it's shown once and remembered only in this browser for the explorer.
        </p>
        <div className="mt-3 flex gap-2">
          <input className={inputCls} placeholder="e.g. Jupyter notebook" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          <Btn
            disabled={name.trim().length < 2 || create.isPending}
            onClick={async () => {
              try {
                const r = await create.mutateAsync({ name: name.trim() });
                rememberKey(r.id, r.key);
                setRevealed({ key: r.key, prefix: r.prefix, expiresAt: r.expiresAt });
                setName("");
                await utils.developer.keys.invalidate();
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            {create.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create
          </Btn>
        </div>
      </Panel>

      <Modal open={!!revealed} onClose={() => setRevealed(null)} title="Your sandbox key" wide footer={<Btn onClick={() => setRevealed(null)}>Done</Btn>}>
        {revealed && (
          <div className="space-y-3">
            <p className="text-[12.5px] text-amber-100">Copy it now — we only store a SHA-256 hash and can't show it again. Expires {new Date(revealed.expiresAt).toISOString().slice(0, 10)}.</p>
            <CodeBlock code={revealed.key} title="X-API-Key" />
            <CodeBlock code={`curl -H "X-API-Key: ${revealed.key}" \\\n  "${typeof window !== "undefined" ? window.location.origin : ""}/api/v1/risk?lat=10.03&lon=105.78&type=salinity"`} title="try it" className={cn("text-[11px]")} />
          </div>
        )}
      </Modal>
    </div>
  );
}
