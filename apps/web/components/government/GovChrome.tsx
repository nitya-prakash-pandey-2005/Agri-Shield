"use client";

/**
 * Top-bar extras + realtime sync for the government portal:
 *  - LiveDataBadge: scenario mode + live overlay freshness (store.scenario + liveRiskStatus)
 *  - CountrySelector: jurisdiction switcher for platform admins
 *  - RealtimeSync: invalidates government.* queries on realtime events and feeds the ops feed
 */
import { useEffect } from "react";
import { Globe2, Radio } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useRealtime } from "@/hooks/useRealtime";
import { useGovInput, useGovStore } from "./scope";
import { ago } from "./ui";

const SCENARIO_LABEL: Record<string, string> = {
  live: "LIVE OBSERVATIONS",
  monsoon_surge: "SCENARIO · MONSOON SURGE",
  cyclone_landfall: "SCENARIO · CYCLONE LANDFALL",
  dry_season_salinity: "SCENARIO · DRY-SEASON SALINITY",
};

export function LiveDataBadge() {
  const input = useGovInput();
  const { data } = trpc.government.getContext.useQuery(input, { refetchInterval: 60_000 });
  if (!data) return null;
  const live = data.scenario.mode === "live";
  const color = live ? "#10b981" : "#f59e0b";
  return (
    <div
      className="hidden md:flex items-center gap-2 rounded-lg border px-2.5 py-1"
      style={{ borderColor: `${color}55`, background: `${color}12` }}
      title={`Live overlay: ${data.liveDistricts}/${data.districts.length} districts on Open-Meteo + GloFAS. Last refresh ${data.live.lastRefresh ? ago(data.live.lastRefresh) : "pending"}${data.live.refreshing ? " (refreshing)" : ""}`}
    >
      <Radio size={12} style={{ color }} className={data.live.refreshing ? "animate-pulse" : ""} />
      <span className="telemetry text-[10px] tracking-wider" style={{ color }}>
        {SCENARIO_LABEL[data.scenario.mode] ?? data.scenario.mode.toUpperCase()}
        {!live && ` ${Math.round(data.scenario.intensity * 100)}%`}
      </span>
      <span className="telemetry text-[10px] text-slate-500">
        {data.liveDistricts}/{data.districts.length} LIVE
      </span>
    </div>
  );
}

export function CountrySelector() {
  const { country, setCountry } = useGovStore();
  const input = useGovInput();
  const { data } = trpc.government.getContext.useQuery(input);
  if (!data?.countries) return null;
  return (
    <label className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#060a16]/80 px-2 py-1">
      <Globe2 size={12} className="text-emerald-400" />
      <select
        value={country ?? data.countryCode}
        onChange={(e) => setCountry(e.target.value)}
        className="bg-transparent text-[11px] telemetry text-slate-200 outline-none"
        aria-label="Jurisdiction"
      >
        {data.countries.map((c) => (
          <option key={c.code} value={c.code} className="bg-slate-900">
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function RealtimeSync({ rooms }: { rooms: string[] }) {
  const utils = trpc.useUtils();
  const push = useGovStore((s) => s.pushEvent);
  useRealtime(rooms, (env) => {
    push(env);
    const t = env.event.type;
    if (t === "resource.updated") {
      void utils.government.getResourceRequests.invalidate();
      void utils.government.getResourceInventory.invalidate();
      void utils.government.getShortages.invalidate();
      void utils.government.getOverview.invalidate();
      void utils.government.getContext.invalidate();
      void utils.government.getDistrict.invalidate();
      void utils.government.getOpsFeed.invalidate();
    }
    if (t === "alert.created" || t === "alert.actioned") {
      void utils.government.getAlertHistory.invalidate();
      void utils.government.getOverview.invalidate();
      void utils.government.getRegionMap.invalidate();
      void utils.government.getContext.invalidate();
      void utils.government.getOpsFeed.invalidate();
      void utils.government.getEscalationRules.invalidate();
    }
    if (t === "risk.updated" || t === "scan.completed") void utils.government.invalidate();
  });
  // periodic refresh of live-derived views (Open-Meteo overlay refreshes every 20 min server-side)
  useEffect(() => {
    const id = setInterval(() => {
      void utils.government.getOverview.invalidate();
      void utils.government.getRegionMap.invalidate();
    }, 5 * 60_000);
    return () => clearInterval(id);
  }, [utils]);
  return null;
}
