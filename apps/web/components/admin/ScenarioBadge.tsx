"use client";

import Link from "next/link";
import { Radar } from "lucide-react";
import { trpc } from "@/lib/trpc";

const LABEL: Record<string, string> = {
  live: "LIVE DATA",
  monsoon_surge: "DRILL · MONSOON SURGE",
  cyclone_landfall: "DRILL · CYCLONE LANDFALL",
  dry_season_salinity: "DRILL · DRY-SEASON SALINITY",
};

/** Top-bar indicator of the active data scenario (live vs injected drill). */
export function ScenarioBadge() {
  const { data } = trpc.admin.scenario.useQuery(undefined, { refetchInterval: 30_000 });
  const mode = data?.scenario.mode ?? "live";
  const live = mode === "live";
  return (
    <Link
      href="/admin/scenario"
      className="hidden sm:inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] telemetry tracking-widest"
      style={{ borderColor: live ? "rgba(34,197,94,0.35)" : "rgba(245,158,11,0.5)", color: live ? "#4ade80" : "#fbbf24", background: live ? "rgba(34,197,94,0.06)" : "rgba(245,158,11,0.08)" }}
      title="Scenario control"
    >
      <Radar size={12} />
      {LABEL[mode] ?? mode}
      {!live && data && <span className="text-slate-400">· {Math.round(data.scenario.intensity * 100)}%</span>}
    </Link>
  );
}
