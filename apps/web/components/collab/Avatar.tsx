"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface AvatarUser {
  id?: string;
  userId?: string;
  name: string;
  initials: string;
  color: string;
}

export function Avatar({ user, size = 28, ring, pulse, className, title }: { user: AvatarUser | null | undefined; size?: number; ring?: boolean; pulse?: boolean; className?: string; title?: string }) {
  if (!user)
    return (
      <span className={cn("inline-grid shrink-0 place-items-center rounded-full border border-dashed border-slate-600 text-slate-500", className)} style={{ width: size, height: size, fontSize: size * 0.36 }} title={title ?? "System"}>
        ⚙
      </span>
    );
  return (
    <span className={cn("relative inline-grid shrink-0 place-items-center rounded-full font-semibold text-slate-950 telemetry", ring && "ring-2 ring-[#060b18]", className)} style={{ width: size, height: size, fontSize: Math.max(9, size * 0.38), background: user.color, boxShadow: `0 0 12px -3px ${user.color}` }} title={title ?? user.name}>
      {user.initials}
      {pulse && (
        <motion.span className="absolute inset-0 rounded-full" style={{ border: `2px solid ${user.color}` }} animate={{ scale: [1, 1.35], opacity: [0.7, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }} />
      )}
    </span>
  );
}

export function AvatarStack({ users, max = 4, size = 26 }: { users: AvatarUser[]; max?: number; size?: number }) {
  const shown = users.slice(0, max);
  const extra = users.length - shown.length;
  return (
    <span className="inline-flex items-center">
      {shown.map((u, i) => (
        <Avatar key={u.id ?? u.userId ?? i} user={u} size={size} ring className={i ? "-ml-2" : ""} />
      ))}
      {extra > 0 && (
        <span className="-ml-2 inline-grid place-items-center rounded-full bg-slate-800 text-[10px] text-slate-300 ring-2 ring-[#060b18] telemetry" style={{ width: size, height: size }}>
          +{extra}
        </span>
      )}
    </span>
  );
}
