"use client";

import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import {
  Waves,
  Droplets,
  Wind,
  Thermometer,
  AlertTriangle,
  ChevronRight,
  Clock,
  CheckCircle2,
} from "lucide-react";
import type { ClimateAlert } from "@agri-shield/types";

interface AlertCardProps {
  alert: ClimateAlert;
  onAction?: (alertId: string) => void;
  onDismiss?: (alertId: string) => void;
  compact?: boolean;
  className?: string;
}

const ALERT_CONFIG = {
  flood: {
    icon: Waves,
    color: "#3b82f6",
    bg: "rgba(59, 130, 246, 0.08)",
    border: "rgba(59, 130, 246, 0.4)",
    label: "Flood",
  },
  salinity: {
    icon: Droplets,
    color: "#f59e0b",
    bg: "rgba(245, 158, 11, 0.08)",
    border: "rgba(245, 158, 11, 0.4)",
    label: "Salinity",
  },
  drought: {
    icon: Thermometer,
    color: "#ef4444",
    bg: "rgba(239, 68, 68, 0.08)",
    border: "rgba(239, 68, 68, 0.4)",
    label: "Drought",
  },
  storm: {
    icon: Wind,
    color: "#7c3aed",
    bg: "rgba(124, 58, 237, 0.08)",
    border: "rgba(124, 58, 237, 0.4)",
    label: "Storm",
  },
  frost: {
    icon: Thermometer,
    color: "#06b6d4",
    bg: "rgba(6, 182, 212, 0.08)",
    border: "rgba(6, 182, 212, 0.4)",
    label: "Frost",
  },
};

const SEVERITY_CONFIG = {
  watch: {
    label: "Watch",
    color: "#f59e0b",
    bg: "rgba(245, 158, 11, 0.15)",
    pulse: false,
  },
  warning: {
    label: "Warning",
    color: "#ef4444",
    bg: "rgba(239, 68, 68, 0.15)",
    pulse: false,
  },
  emergency: {
    label: "Emergency",
    color: "#7c3aed",
    bg: "rgba(124, 58, 237, 0.15)",
    pulse: true,
  },
};

function getTimeRemaining(validUntil: Date): string {
  const now = new Date();
  const diff = new Date(validUntil).getTime() - now.getTime();
  if (diff <= 0) return "Expired";
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function AlertCard({
  alert,
  onAction,
  onDismiss,
  compact = false,
  className,
}: AlertCardProps) {
  const typeConfig = ALERT_CONFIG[alert.alertType] ?? ALERT_CONFIG.flood;
  const severityConfig =
    SEVERITY_CONFIG[alert.severity] ?? SEVERITY_CONFIG.watch;
  const Icon = typeConfig.icon;
  const timeRemaining = getTimeRemaining(alert.validUntil);

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className={cn(
        "relative rounded-xl p-4 border-l-4 transition-all duration-200 group cursor-pointer",
        "hover:shadow-lg hover:scale-[1.01]",
        className
      )}
      style={{
        background: typeConfig.bg,
        borderLeftColor: typeConfig.color,
        border: `1px solid ${typeConfig.border}`,
        borderLeft: `4px solid ${typeConfig.color}`,
      }}
    >
      {/* Pulse ring for emergency */}
      {severityConfig.pulse && (
        <span className="absolute -top-1 -right-1 flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-500 opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-violet-600" />
        </span>
      )}

      <div className="flex items-start gap-3">
        {/* Icon */}
        <div
          className="flex-shrink-0 rounded-xl p-2"
          style={{ background: `${typeConfig.color}20` }}
        >
          <Icon size={18} style={{ color: typeConfig.color }} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {/* Type badge */}
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded-full"
              style={{
                background: `${typeConfig.color}20`,
                color: typeConfig.color,
              }}
            >
              {typeConfig.label}
            </span>

            {/* Severity badge */}
            <span
              className="text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wide"
              style={{
                background: severityConfig.bg,
                color: severityConfig.color,
              }}
            >
              {severityConfig.label}
            </span>
          </div>

          <h4 className="font-semibold text-sm text-white leading-tight mb-1">
            {alert.title}
          </h4>

          {!compact && (
            <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
              {alert.description}
            </p>
          )}

          {/* Actions */}
          {!compact &&
            Array.isArray(alert.recommendedActions) &&
            alert.recommendedActions.length > 0 && (
              <div className="space-y-1 mb-3">
                {(alert.recommendedActions as string[])
                  .slice(0, 2)
                  .map((action, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-xs text-muted-foreground"
                    >
                      <CheckCircle2 size={12} className="text-green-500 flex-shrink-0" />
                      <span>{action}</span>
                    </div>
                  ))}
              </div>
            )}

          {/* Footer row */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock size={11} />
              <span>{timeRemaining} remaining</span>
            </div>

            {onAction && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAction(alert.id);
                }}
                className="flex items-center gap-1 text-xs font-semibold rounded-lg px-2.5 py-1 transition-all"
                style={{
                  background: `${typeConfig.color}20`,
                  color: typeConfig.color,
                }}
              >
                Take Action
                <ChevronRight size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Expand icon */}
        <AlertTriangle
          size={14}
          className="flex-shrink-0 opacity-40 group-hover:opacity-70 transition-opacity mt-1"
          style={{ color: typeConfig.color }}
        />
      </div>
    </motion.div>
  );
}

// Skeleton loader for alerts
export function AlertCardSkeleton() {
  return (
    <div className="rounded-xl p-4 border border-white/5 bg-white/3 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-white/10 flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="flex gap-2">
            <div className="w-16 h-5 rounded-full bg-white/10" />
            <div className="w-20 h-5 rounded-full bg-white/10" />
          </div>
          <div className="w-3/4 h-4 rounded bg-white/10" />
          <div className="w-full h-3 rounded bg-white/10" />
          <div className="w-2/3 h-3 rounded bg-white/10" />
        </div>
      </div>
    </div>
  );
}
