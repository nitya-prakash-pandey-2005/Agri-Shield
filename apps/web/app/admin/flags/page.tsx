"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Flag, ToggleRight } from "lucide-react";
import { EmptyState, Meter, Panel, SectionHeader, Skeleton } from "@/components/hud";
import { ErrorNote, StatusBadge, Toggle } from "@/components/admin/ui";
import { trpc, type RouterOutputs } from "@/lib/trpc";

type FlagRow = RouterOutputs["admin"]["flags"][number];

function FlagCard({ flag, onSave, saving }: { flag: FlagRow; onSave: (p: { enabled?: boolean; rolloutPct?: number }) => void; saving: boolean }) {
  const [pct, setPct] = useState(flag.rolloutPct);
  useEffect(() => setPct(flag.rolloutPct), [flag.rolloutPct]);
  const commit = () => pct !== flag.rolloutPct && onSave({ rolloutPct: pct });

  return (
    <Panel
      title={<span className="telemetry">{flag.key}</span>}
      subtitle={flag.description}
      icon={Flag}
      accent={flag.enabled ? "violet" : "cyan"}
      actions={<Toggle checked={flag.enabled} disabled={saving} onChange={(v) => onSave({ enabled: v })} label={`Toggle ${flag.key}`} />}
    >
      <div className="flex items-center justify-between text-[11px] mb-1.5">
        <span className="hud-label">Rollout</span>
        <span className="telemetry text-slate-100">{pct}%</span>
      </div>
      <Meter value={flag.enabled ? pct : 0} color={flag.enabled ? "#8b5cf6" : "#475569"} />
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={pct}
        disabled={saving}
        aria-label={`Rollout percentage for ${flag.key}`}
        onChange={(e) => setPct(Number(e.target.value))}
        onMouseUp={commit}
        onTouchEnd={commit}
        onKeyUp={commit}
        className="mt-3 w-full accent-violet-500"
      />
      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
        <StatusBadge status={flag.enabled ? (flag.rolloutPct >= 100 ? "active" : "partial") : "skipped"} label={flag.enabled ? (flag.rolloutPct >= 100 ? "fully on" : "canary") : "off"} />
        <span>{flag.enabled ? `${flag.rolloutPct}% of users (hash-bucketed)` : "disabled for everyone"}</span>
      </div>
    </Panel>
  );
}

export default function AdminFlagsPage() {
  const utils = trpc.useUtils();
  const flags = trpc.admin.flags.useQuery();
  const update = trpc.admin.updateFlag.useMutation({
    onSuccess: (f) => {
      toast.success(`${f.key}: ${f.enabled ? "on" : "off"} · ${f.rolloutPct}%`, { description: "Change written to the audit log" });
      void utils.admin.flags.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <SectionHeader eyebrow="Release control" title="Feature flags" description="Toggle features and stage percentage rollouts without a deploy. Every change is audited with your name and the before/after state." />
      <ErrorNote error={flags.error} />
      {!flags.data ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : flags.data.length === 0 ? (
        <Panel>
          <EmptyState icon={ToggleRight} title="No feature flags defined" />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {flags.data.map((f) => (
            <FlagCard key={f.key} flag={f} saving={update.isPending && update.variables?.key === f.key} onSave={(p) => update.mutate({ key: f.key, ...p })} />
          ))}
        </div>
      )}
    </div>
  );
}
