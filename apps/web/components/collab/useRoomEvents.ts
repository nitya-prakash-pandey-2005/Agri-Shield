"use client";

/**
 * Multiplexed realtime subscription for the collaboration & incident screens.
 * Every component that calls useRoomEvents() shares ONE EventSource whose room list
 * is the union of all subscribers (browsers allow only ~6 HTTP/1.1 connections per
 * origin, so one stream per widget would starve normal requests). Events are
 * delivered only to the subscribers of the event's room.
 */
import { useEffect, useRef } from "react";
import type { RealtimeEnvelope } from "@/server/realtime";

type Sub = { rooms: Set<string>; fn: (env: RealtimeEnvelope) => void };

const subs = new Map<number, Sub>();
let seq = 0;
let es: EventSource | null = null;
let currentKey = "";
let timer: ReturnType<typeof setTimeout> | null = null;
const seen: string[] = [];

function dispatch(env: RealtimeEnvelope) {
  const id = `${env.at}|${env.room}|${env.event.type}|${JSON.stringify(env.event).length}`;
  if (seen.includes(id)) return;
  seen.push(id);
  if (seen.length > 200) seen.shift();
  for (const s of subs.values()) if (s.rooms.has(env.room)) s.fn(env);
}

function reconcile() {
  timer = null;
  const rooms = new Set<string>();
  for (const s of subs.values()) s.rooms.forEach((r) => r && r !== "none" && rooms.add(r));
  const key = [...rooms].sort().join(",");
  if (key === currentKey) return;
  currentKey = key;
  es?.close();
  es = null;
  if (!key) return;
  const src = new EventSource(`/api/realtime?rooms=${encodeURIComponent(key)}`);
  src.onmessage = (m) => {
    try {
      dispatch(JSON.parse(m.data));
    } catch {}
  };
  es = src;
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(reconcile, 60);
}

export function useRoomEvents(rooms: string[], onEvent: (env: RealtimeEnvelope) => void) {
  const fn = useRef(onEvent);
  fn.current = onEvent;
  const key = rooms.filter(Boolean).sort().join(",");
  useEffect(() => {
    const id = ++seq;
    subs.set(id, { rooms: new Set(key.split(",").filter(Boolean)), fn: (e) => fn.current(e) });
    schedule();
    return () => {
      subs.delete(id);
      schedule();
    };
  }, [key]);
}
