/**
 * Realtime event bus.
 * - When running the custom server (server.js) Socket.io is attached to
 *   globalThis.__agriIO and events are broadcast to rooms.
 * - Always also emitted on an in-process EventEmitter that backs the
 *   Server-Sent-Events endpoint (/api/realtime), so `next dev` works too.
 *
 * Rooms: "global", "gov:<orgId>", "farmer:<farmerId>", "district:<id>", "sc:<orgId>"
 */
import { EventEmitter } from "node:events";

export type RealtimeEvent =
  | { type: "alert.created"; alertId: string; districtId: string; severity: string; title: string; alertType: string }
  | { type: "alert.actioned"; alertId: string; farmerId: string }
  | { type: "alert.escalated"; alertId: string; districtId: string; from: string; to: string; title: string }
  | { type: "resource.updated"; requestId: string; status: string }
  | { type: "risk.updated"; districtIds: string[]; at: string }
  | { type: "scan.completed"; alertsCreated: number; at: string }
  | { type: "sms.inbound"; from: string; command: string };

export interface RealtimeEnvelope {
  room: string;
  event: RealtimeEvent;
  at: string;
}

interface IOLike {
  to(room: string): { emit(event: string, payload: unknown): void };
}

const g = globalThis as unknown as { __agriBus?: EventEmitter; __agriIO?: IOLike };
export const bus = (g.__agriBus ??= new EventEmitter().setMaxListeners(500));

export function publish(room: string, event: RealtimeEvent) {
  const env: RealtimeEnvelope = { room, event, at: new Date().toISOString() };
  bus.emit("event", env);
  g.__agriIO?.to(room).emit("agri:event", env);
  if (room !== "global") g.__agriIO?.to("global").emit("agri:event", env);
}
