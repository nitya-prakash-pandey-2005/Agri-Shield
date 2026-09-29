"use client";

/**
 * RiskMeter — circular 270° gauge (spec §8): grey track, green→amber→red→violet
 * fill, centre percentage + risk label, spring animation on value change,
 * tick marks every 10%. Sizes sm 64 / md 120 / lg 200 px.
 * Backward compatible with the original props (value, label, size, showLabel, animated).
 */
import { useEffect, useId, useState } from "react";
import { motion, useSpring, useTransform } from "framer-motion";
import { cn } from "@/lib/utils";

interface RiskMeterProps {
  value: number; // 0-100
  label?: string;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
  animated?: boolean;
  /** override the level text under the number (e.g. translated) */
  levelLabel?: string;
  /** small caption inside the gauge under the level (e.g. "EC 3.2 dS/m") */
  caption?: string;
}

const SIZES = {
  sm: { px: 64, stroke: 5, font: 15, level: 7, ticks: false },
  md: { px: 120, stroke: 8, font: 26, level: 9, ticks: true },
  lg: { px: 200, stroke: 12, font: 44, level: 12, ticks: true },
};

export function riskMeterColor(v: number): string {
  if (v < 35) return "#22c55e";
  if (v < 60) return "#f59e0b";
  if (v < 80) return "#ef4444";
  return "#8b5cf6";
}

export function riskMeterLabel(v: number): string {
  if (v < 35) return "Low";
  if (v < 60) return "Medium";
  if (v < 80) return "High";
  return "Critical";
}

const SWEEP = 270;
const START = 135; // degrees, measured clockwise from +x

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function arcPath(cx: number, cy: number, r: number, from: number, to: number) {
  const s = polar(cx, cy, r, from);
  const e = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}

export function RiskMeter({ value, label, size = "md", showLabel = true, className, animated = true, levelLabel, caption }: RiskMeterProps) {
  const target = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  const spring = useSpring(animated ? 0 : target, { stiffness: 70, damping: 16, mass: 0.9 });
  const [shown, setShown] = useState(animated ? 0 : target);
  const gid = useId().replace(/:/g, "");

  useEffect(() => {
    spring.set(target);
  }, [spring, target]);
  useEffect(() => spring.on("change", (v) => setShown(v)), [spring]);

  const { px, stroke, font, level, ticks } = SIZES[size];
  const c = px / 2;
  const r = c - stroke - (ticks ? stroke * 0.9 : 1);
  const len = (Math.PI * 2 * r * SWEEP) / 360;
  const dash = useTransform(spring, (v) => `${(Math.max(0, v) / 100) * len} ${len}`);
  const color = riskMeterColor(shown);
  const track = arcPath(c, c, r, START, START + SWEEP);
  const needle = polar(c, c, r, START + (SWEEP * shown) / 100);

  return (
    <div className={cn("flex flex-col items-center gap-1", className)} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(target)} aria-label={label ?? "Risk"}>
      <div className="relative" style={{ width: px, height: px }}>
        <svg width={px} height={px} viewBox={`0 0 ${px} ${px}`} className="overflow-visible">
          <defs>
            <linearGradient id={`rm-${gid}`} x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="#22c55e" />
              <stop offset="45%" stopColor="#f59e0b" />
              <stop offset="75%" stopColor="#ef4444" />
              <stop offset="100%" stopColor="#8b5cf6" />
            </linearGradient>
          </defs>
          {ticks &&
            Array.from({ length: 11 }, (_, i) => {
              const deg = START + (SWEEP * i) / 10;
              const a = polar(c, c, r + stroke * 0.95, deg);
              const b = polar(c, c, r + stroke * 1.55, deg);
              return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={i * 10 <= shown ? color : "rgba(148,163,184,0.25)"} strokeWidth={i % 5 === 0 ? 1.6 : 1} strokeLinecap="round" />;
            })}
          <path d={track} fill="none" stroke="rgba(148,163,184,0.12)" strokeWidth={stroke} strokeLinecap="round" />
          <motion.path d={track} fill="none" stroke={`url(#rm-${gid})`} strokeWidth={stroke} strokeLinecap="round" style={{ strokeDasharray: dash, filter: `drop-shadow(0 0 ${stroke}px ${color}66)` }} />
          {shown > 0.5 && <circle cx={needle.x} cy={needle.y} r={stroke * 0.62} fill="#0b1120" stroke={color} strokeWidth={Math.max(1.5, stroke / 3.5)} />}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
          <span className="telemetry font-semibold text-white leading-none" style={{ fontSize: font }}>
            {Math.round(shown)}
            <span className="text-slate-400" style={{ fontSize: font * 0.45 }}>%</span>
          </span>
          {showLabel && (
            <span className="telemetry uppercase tracking-[0.16em] font-semibold mt-1" style={{ fontSize: level, color }}>
              {levelLabel ?? riskMeterLabel(shown)}
            </span>
          )}
          {caption && size !== "sm" && (
            <span className="telemetry text-slate-400 mt-0.5" style={{ fontSize: level }}>
              {caption}
            </span>
          )}
        </div>
      </div>
      {label && <p className="text-xs font-medium text-slate-300 text-center">{label}</p>}
    </div>
  );
}

export default RiskMeter;
