/**
 * Server-Sent Events stream of realtime events (fallback when Socket.io
 * custom server isn't running). Client: hooks/useRealtime.ts
 */
import { bus, type RealtimeEnvelope } from "@/server/realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const rooms = new Set((new URL(req.url).searchParams.get("rooms") ?? "global").split(","));
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (env: RealtimeEnvelope) => {
        if (rooms.has(env.room) || rooms.has("global")) controller.enqueue(encoder.encode(`data: ${JSON.stringify(env)}\n\n`));
      };
      const ping = setInterval(() => controller.enqueue(encoder.encode(`: ping\n\n`)), 25_000);
      bus.on("event", send);
      controller.enqueue(encoder.encode(`: connected\n\n`));
      cleanup = () => {
        clearInterval(ping);
        bus.off("event", send);
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try { controller.close(); } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
