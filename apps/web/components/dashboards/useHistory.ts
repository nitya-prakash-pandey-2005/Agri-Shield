"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Undo/redo stack. `set(next, coalesceKey)` merges rapid edits that share a
 * key (e.g. typing in one config field) into a single undo step.
 */
export function useHistory<T>(initial: T, limit = 100) {
  const [state, setState] = useState<{ past: T[]; present: T; future: T[] }>({ past: [], present: initial, future: [] });
  const last = useRef<{ key: string | null; at: number }>({ key: null, at: 0 });

  const set = useCallback(
    (next: T | ((prev: T) => T), coalesceKey: string | null = null) => {
      setState((s) => {
        const value = typeof next === "function" ? (next as (p: T) => T)(s.present) : next;
        if (Object.is(value, s.present)) return s;
        const now = Date.now();
        const merge = coalesceKey !== null && last.current.key === coalesceKey && now - last.current.at < 1200;
        last.current = { key: coalesceKey, at: now };
        if (merge) return { past: s.past, present: value, future: [] };
        return { past: [...s.past, s.present].slice(-limit), present: value, future: [] };
      });
    },
    [limit]
  );

  const undo = useCallback(() => {
    last.current.key = null;
    setState((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1]!, future: [s.present, ...s.future] } : s));
  }, []);

  const redo = useCallback(() => {
    last.current.key = null;
    setState((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0]!, future: s.future.slice(1) } : s));
  }, []);

  /** Replace everything (e.g. after loading another dashboard) — clears the stacks. */
  const reset = useCallback((value: T) => {
    last.current.key = null;
    setState({ past: [], present: value, future: [] });
  }, []);

  return { value: state.present, set, undo, redo, reset, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}
