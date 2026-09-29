"use client";

/**
 * Government-portal client state:
 *  - `country` — jurisdiction override for platform admins (others are org-scoped server-side)
 *  - `events`  — rolling buffer of realtime events for the ops feed
 */
import { create } from "zustand";
import type { RealtimeEnvelope } from "@/server/realtime";

interface GovClientState {
  country: string | undefined;
  setCountry: (c: string | undefined) => void;
  events: RealtimeEnvelope[];
  pushEvent: (e: RealtimeEnvelope) => void;
}

export const useGovStore = create<GovClientState>((set) => ({
  country: undefined,
  setCountry: (country) => set({ country }),
  events: [],
  pushEvent: (e) => set((s) => ({ events: [e, ...s.events].slice(0, 50) })),
}));

/** Spread into every government.* query/mutation input. */
export function useGovInput(): { country?: string } {
  const country = useGovStore((s) => s.country);
  return country ? { country } : {};
}
