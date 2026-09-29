"use client";

/**
 * <PresenceAvatars room="incident:inc_123" />
 * Shows who is looking at the same thing right now. Sends a heartbeat every 20 s,
 * listens on the realtime channel `presence:<orgId>:<room>` (SSE / Socket.io), and
 * leaves the room on unmount. Reusable on any page (asset drawer, rule editor…).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Eye } from "lucide-react";
import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc";
import { useRoomEvents } from "./useRoomEvents";
import { Avatar } from "./Avatar";

export interface PresenceUser {
  userId: string;
  name: string;
  initials: string;
  color: string;
  since: string;
}

export const PRESENCE_HEARTBEAT_MS = 20_000;

/** Heartbeat + live list for a room; also exposes who is typing. */
export function usePresence(room: string, enabled = true) {
  const { data: session } = useSession();
  const orgId = session?.user?.orgId;
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [typing, setTyping] = useState<Record<string, { name: string; at: number }>>({});
  const hb = trpc.incidents.collab.heartbeat.useMutation();
  const leave = trpc.incidents.collab.leave.useMutation();
  const hbRef = useRef(hb.mutateAsync);
  hbRef.current = hb.mutateAsync;
  const leaveRef = useRef(leave.mutate);
  leaveRef.current = leave.mutate;

  useEffect(() => {
    if (!enabled || !orgId) return;
    let alive = true;
    const beat = () =>
      hbRef
        .current({ room })
        .then((r) => alive && setUsers(r.users))
        .catch(() => {});
    beat();
    const t = setInterval(beat, PRESENCE_HEARTBEAT_MS);
    const onVis = () => document.visibilityState === "visible" && beat();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
      leaveRef.current({ room });
    };
  }, [room, enabled, orgId]);

  const channel = orgId ? `presence:${orgId}:${room}` : "none";
  useRoomEvents([channel], (env) => {
    const ev = env.event as { type: string; room?: string; users?: PresenceUser[]; userId?: string; name?: string; typing?: boolean };
    if (ev.room !== room) return;
    if (ev.type === "presence.updated" && ev.users) setUsers(ev.users);
    if (ev.type === "presence.typing" && ev.userId && ev.userId !== session?.user?.id)
      setTyping((t) => {
        const next = { ...t };
        if (ev.typing) next[ev.userId!] = { name: ev.name ?? "Someone", at: Date.now() };
        else delete next[ev.userId!];
        return next;
      });
  });

  // Expire stale typing indicators (e.g. the other tab closed mid-sentence)
  useEffect(() => {
    const t = setInterval(() => setTyping((cur) => Object.fromEntries(Object.entries(cur).filter(([, v]) => Date.now() - v.at < 6000))), 2000);
    return () => clearInterval(t);
  }, []);

  return { users, typing: Object.values(typing).map((t) => t.name), me: session?.user?.id ?? null };
}

export function PresenceAvatars({ room, label = "viewing", max = 5, className }: { room: string; label?: string; max?: number; className?: string }) {
  const { users, me } = usePresence(room);
  const others = useMemo(() => users.filter((u) => u.userId !== me), [users, me]);
  const shown = users.slice(0, max);
  return (
    <div className={`inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/50 py-1 pl-1.5 pr-3 ${className ?? ""}`} aria-live="polite">
      <div className="flex items-center">
        <AnimatePresence initial={false}>
          {shown.map((u, i) => (
            <motion.span key={u.userId} initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }} className={i ? "-ml-2" : ""}>
              <Avatar user={u} size={24} ring pulse={u.userId !== me} title={`${u.name}${u.userId === me ? " (you)" : ""} — here since ${new Date(u.since).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`} />
            </motion.span>
          ))}
        </AnimatePresence>
        {users.length > max && <span className="-ml-2 grid h-6 w-6 place-items-center rounded-full bg-slate-800 text-[10px] text-slate-300 ring-2 ring-[#060b18]">+{users.length - max}</span>}
      </div>
      <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
        <Eye size={12} className="text-emerald-400" />
        {others.length ? (
          <>
            <span className="text-slate-200">{others.length === 1 ? others[0]!.name.split(" ")[0] : `${others.length} teammates`}</span> {label}
          </>
        ) : (
          <>Only you {label}</>
        )}
      </span>
    </div>
  );
}
