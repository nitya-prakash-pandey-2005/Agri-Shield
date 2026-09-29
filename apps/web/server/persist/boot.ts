/**
 * Server-start hook for persistence (called from instrumentation.ts before
 * anything touches a store): loads snapshots, starts the flusher, and adopts
 * the stores whose modules only declare an empty `globalThis` slot.
 */
import { adoptGlobal, bootPersistence, persistenceStatus } from "./index";

export async function startPersistence() {
  await bootPersistence();
  // server/notify/channels.ts: `g.__agriOutbox ??= []` picks up the restored array.
  adoptGlobal("notify.outbox", 1, "__agriOutbox", Array.isArray);
  return persistenceStatus();
}
