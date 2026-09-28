"use client";

import { useEffect, useRef } from "react";
import type { RealtimeEnvelope } from "@/server/realtime";

/**
 * Subscribe to realtime events.
 * SSE (/api/realtime) is always on — it works under `next dev`, `next start`
 * and serverless. When the custom Socket.io server (pnpm dev:custom) is
 * running, a WebSocket is layered on top; duplicates are dropped.
 */
export function useRealtime(rooms: string[], onEvent: (env: RealtimeEnvelope) => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const key = rooms.join(",");

  useEffect(() => {
    let closed = false;
    const seen = new Set<string>();
    const deliver = (env: RealtimeEnvelope) => {
      const id = `${env.at}|${env.event.type}|${JSON.stringify(env.event).length}`;
      if (seen.has(id)) return;
      seen.add(id);
      if (seen.size > 200) seen.clear();
      handler.current(env);
    };

    const es = new EventSource(`/api/realtime?rooms=${encodeURIComponent(key)}`);
    es.onmessage = (m) => {
      try {
        deliver(JSON.parse(m.data));
      } catch {}
    };

    let socket: { disconnect(): void } | null = null;
    import("socket.io-client")
      .then(({ io }) => {
        if (closed) return;
        const s = io({ transports: ["websocket"], timeout: 2500, reconnectionAttempts: 1 });
        socket = s;
        s.on("connect", () => key.split(",").forEach((room) => s.emit("join_room", room)));
        s.on("agri:event", deliver);
        s.on("connect_error", () => s.disconnect());
      })
      .catch(() => {});

    return () => {
      closed = true;
      es.close();
      socket?.disconnect();
    };
  }, [key]);
}
