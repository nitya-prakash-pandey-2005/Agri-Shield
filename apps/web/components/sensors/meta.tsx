"use client";

/**
 * Sensors & IoT — small shared UI pieces: type icons, status / verdict / class
 * pills, value formatting, time-ago.
 */
import { Anchor, ArrowDownToLine, CheckCircle2, CircleSlash, CloudRain, HelpCircle, Sprout, TriangleAlert, Waves, Wind, Wrench, Zap, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEVICE_TYPES, METRIC_META, STATUS_META, type AnomalyClass, type DeviceStatus, type DeviceType, type MetricKey } from "@/server/services/iot-types";

export const TYPE_ICON: Record<DeviceType, LucideIcon> = {
  river_gauge: Waves,
  soil_probe: Sprout,
  tide_gauge: Anchor,
  rain_gauge: CloudRain,
  weather_station: Wind,
  piezometer: ArrowDownToLine,
};

export function TypeIcon({ type, size = 14, className }: { type: DeviceType; size?: number; className?: string }) {
  const I = TYPE_ICON[type];
  return <I size={size} className={className} style={{ color: DEVICE_TYPES[type].color }} aria-label={DEVICE_TYPES[type].short} />;
}

export function StatusPill({ status, className }: { status: DeviceStatus; className?: string }) {
  const m = STATUS_META[status];
  return (
    <span title={m.help} className={cn("inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider telemetry", className)} style={{ background: `${m.color}1f`, color: m.color }}>
      <span className="relative flex h-1.5 w-1.5">
        {status === "online" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70" style={{ background: m.color }} />}
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: m.color }} />
      </span>
      {m.label}
    </span>
  );
}

export const CLASS_META: Record<AnomalyClass, { label: string; color: string; icon: LucideIcon; help: string }> = {
  real_event: { label: "Real event", color: "#f87171", icon: Zap, help: "A genuine change in the environment, backed by a physical driver (rain, river flow, tide)." },
  suspect: { label: "Check device", color: "#fbbf24", icon: HelpCircle, help: "Physically possible but nothing explains it — verify on site before acting." },
  sensor_fault: { label: "Sensor fault", color: "#94a3b8", icon: Wrench, help: "Behaviour a real environment cannot produce (stuck value, impossible jump, silence). Excluded from alerts." },
};

export function ClassPill({ cls }: { cls: AnomalyClass }) {
  const m = CLASS_META[cls];
  const I = m.icon;
  return (
    <span title={m.help} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold telemetry uppercase tracking-wider" style={{ background: `${m.color}1c`, color: m.color }}>
      <I size={10} />
      {m.label}
    </span>
  );
}

export const VERDICT_META: Record<string, { label: string; color: string; icon: LucideIcon }> = {
  confirms: { label: "Confirms forecast", color: "#4ade80", icon: CheckCircle2 },
  calm: { label: "Consistent · calm", color: "#38bdf8", icon: CheckCircle2 },
  ahead: { label: "Sees more than forecast", color: "#fb923c", icon: TriangleAlert },
  disagrees: { label: "Disagrees — check", color: "#fbbf24", icon: HelpCircle },
  insufficient: { label: "No comparison", color: "#64748b", icon: CircleSlash },
};

export function VerdictPill({ verdict, className }: { verdict: string; className?: string }) {
  const m = VERDICT_META[verdict] ?? VERDICT_META.insufficient!;
  const I = m.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium", className)} style={{ background: `${m.color}18`, color: m.color }}>
      <I size={11} />
      {m.label}
    </span>
  );
}

export function fmtMetric(metric: MetricKey, v: number | null | undefined, withUnit = true): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const m = METRIC_META[metric];
  return `${v.toFixed(m.decimals)}${withUnit ? ` ${m.unit}` : ""}`;
}

export function ago(d: Date | string | number | null | undefined, now = Date.now()): string {
  if (d == null) return "never";
  const t = typeof d === "number" ? d : new Date(d).getTime();
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${(s / 3600).toFixed(s < 36_000 ? 1 : 0)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

export function SevDot({ severity }: { severity: string }) {
  const c = severity === "critical" ? "#f87171" : severity === "warning" ? "#fbbf24" : "#38bdf8";
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: c, boxShadow: `0 0 8px ${c}` }} aria-label={severity} />;
}
