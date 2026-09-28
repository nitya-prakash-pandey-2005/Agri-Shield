"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface RiskMeterProps {
  value: number; // 0-100
  label?: string;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
  animated?: boolean;
}

const SIZES = {
  sm: { svg: 64, stroke: 5, fontSize: 14, labelSize: 8 },
  md: { svg: 120, stroke: 8, fontSize: 24, labelSize: 10 },
  lg: { svg: 200, stroke: 12, fontSize: 40, labelSize: 13 },
};

function getRiskColor(value: number): string {
  if (value < 30) return "#22c55e";   // green — low
  if (value < 60) return "#f59e0b";   // amber — medium
  if (value < 80) return "#ef4444";   // red — high
  return "#7c3aed";                   // violet — critical
}

function getRiskLabel(value: number): string {
  if (value < 30) return "Low";
  if (value < 60) return "Medium";
  if (value < 80) return "High";
  return "Critical";
}

export function RiskMeter({
  value,
  label,
  size = "md",
  showLabel = true,
  className,
  animated = true,
}: RiskMeterProps) {
  const [displayValue, setDisplayValue] = useState(animated ? 0 : value);
  const animRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!animated) {
      setDisplayValue(value);
      return;
    }
    const start = displayValue;
    const end = Math.min(Math.max(value, 0), 100);
    const duration = 1000;
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Spring-like easing
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.round(start + (end - start) * eased));
      if (progress < 1) {
        animRef.current = requestAnimationFrame(animate);
      }
    };

    animRef.current = requestAnimationFrame(animate);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, animated]);

  const { svg, stroke, fontSize, labelSize } = SIZES[size];
  const center = svg / 2;
  const radius = center - stroke * 1.5;
  const circumference = Math.PI * radius; // half circle arc
  const color = getRiskColor(displayValue);
  const riskLabel = getRiskLabel(displayValue);

  // Arc: start at 180deg (left), sweep 180deg (right) = half circle at bottom
  const startAngle = -Math.PI;
  const endAngle = 0;
  const clampedVal = Math.min(Math.max(displayValue, 0), 100) / 100;

  // SVG arc path for half-circle
  const describeArc = (
    cx: number,
    cy: number,
    r: number,
    startA: number,
    endA: number
  ) => {
    const x1 = cx + r * Math.cos(startA);
    const y1 = cy + r * Math.sin(startA);
    const x2 = cx + r * Math.cos(endA);
    const y2 = cy + r * Math.sin(endA);
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
  };

  // Progress arc: from -PI to (-PI + clampedVal * PI)
  const progressEndAngle = startAngle + clampedVal * Math.PI;

  const trackPath = describeArc(center, center, radius, startAngle, endAngle);
  const progressPath = describeArc(
    center,
    center,
    radius,
    startAngle,
    progressEndAngle
  );

  const pathLength = circumference;

  return (
    <div className={cn("flex flex-col items-center gap-1", className)}>
      <div className="relative" style={{ width: svg, height: svg / 2 + stroke * 2 }}>
        <svg
          width={svg}
          height={svg}
          viewBox={`0 0 ${svg} ${svg}`}
          className="overflow-visible"
        >
          {/* Track */}
          <path
            d={trackPath}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={stroke}
            strokeLinecap="round"
          />

          {/* Glow layer */}
          <path
            d={progressPath}
            fill="none"
            stroke={color}
            strokeWidth={stroke + 4}
            strokeLinecap="round"
            opacity={0.2}
            style={{ filter: `drop-shadow(0 0 ${stroke * 2}px ${color})` }}
          />

          {/* Progress */}
          <path
            d={progressPath}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            style={{
              transition: "d 0.05s linear",
            }}
          />

          {/* Needle dot */}
          {displayValue > 0 && (
            <>
              {(() => {
                const needleAngle = startAngle + clampedVal * Math.PI;
                const nx = center + radius * Math.cos(needleAngle);
                const ny = center + radius * Math.sin(needleAngle);
                return (
                  <circle
                    cx={nx}
                    cy={ny}
                    r={stroke / 1.2}
                    fill={color}
                    style={{
                      filter: `drop-shadow(0 0 6px ${color})`,
                    }}
                  />
                );
              })()}
            </>
          )}

          {/* Percentage text — positioned at bottom center of arc */}
          <text
            x={center}
            y={center + 4}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="white"
            fontSize={fontSize}
            fontWeight="800"
            fontFamily="Inter, sans-serif"
          >
            {displayValue}%
          </text>

          {/* Risk label */}
          {showLabel && (
            <text
              x={center}
              y={center + fontSize * 0.85}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={color}
              fontSize={labelSize}
              fontWeight="600"
              fontFamily="Inter, sans-serif"
              style={{ textTransform: "uppercase" }}
              letterSpacing="1"
            >
              {riskLabel}
            </text>
          )}
        </svg>
      </div>
      {label && (
        <p
          className="text-muted-foreground font-medium"
          style={{ fontSize: labelSize + 2 }}
        >
          {label}
        </p>
      )}
    </div>
  );
}
