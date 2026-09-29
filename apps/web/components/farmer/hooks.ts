"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { toast } from "sonner";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { useI18n } from "@/lib/i18n/I18nProvider";

export type FarmerAlert = RouterOutputs["farmer"]["getAlerts"]["active"][number];
export type FarmerField = RouterOutputs["farmer"]["getFields"][number];
export type FarmerRisk = RouterOutputs["farmer"]["getCurrentRisk"];
export type FarmerWeather = RouterOutputs["farmer"]["getWeather"];

/**
 * "Mark as actioned" with optimistic UI across every cached getAlerts query,
 * rollback on error, and server reconciliation afterwards.
 */
export function useMarkActioned() {
  const qc = useQueryClient();
  const utils = trpc.useUtils();
  const { t } = useI18n();
  const key = getQueryKey(trpc.farmer.getAlerts);
  const m = trpc.farmer.markAlertActioned.useMutation({
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueriesData({ queryKey: key });
      qc.setQueriesData<RouterOutputs["farmer"]["getAlerts"]>({ queryKey: key }, (old) =>
        old
          ? {
              ...old,
              active: old.active.map((a) =>
                a.id === vars.id ? { ...a, actioned: true, myAction: { actionTaken: (vars.actions ?? []).join("; ") || "Acknowledged", actionDate: new Date(), outcome: null, cropSavedPct: null } } : a
              ),
            }
          : old
      );
      return { prev };
    },
    onError: (e, _v, ctx) => {
      ctx?.prev.forEach(([k, d]) => qc.setQueryData(k, d));
      toast.error(e.message);
    },
    onSuccess: () => toast.success(t("alerts.actionedToast")),
    onSettled: () => {
      void utils.farmer.getAlerts.invalidate();
      void utils.farmer.getProfile.invalidate();
      void utils.farmer.getRecommendations.invalidate();
    },
  });
  return (alert: { id: string; kind?: string }, actions: string[], note?: string) =>
    m.mutateAsync({ id: alert.id, kind: (alert.kind as "alert" | "advisory" | "hazard") ?? "alert", actions, note });
}

const trCache = new Map<string, string>();

/**
 * Translate dynamic strings (alert text, advice) into the UI language via the
 * server translator (DeepL → MyMemory). Cached per session; English is a no-op.
 */
export function useTranslated(texts: string[]) {
  const { locale } = useI18n();
  const mut = trpc.farmer.translateText.useMutation();
  const [, force] = useState(0);
  const inflight = useRef(new Set<string>());
  const sig = texts.join("\u0001");

  useEffect(() => {
    if (locale === "en") return;
    const missing = Array.from(new Set(texts.filter((x) => x && !trCache.has(`${locale}|${x}`) && !inflight.current.has(`${locale}|${x}`)))).slice(0, 20);
    if (!missing.length) return;
    missing.forEach((x) => inflight.current.add(`${locale}|${x}`));
    mut
      .mutateAsync({ texts: missing, target: locale })
      .then((res) => {
        res.forEach((r) => trCache.set(`${locale}|${r.original}`, r.text));
        force((n) => n + 1);
      })
      .catch(() => {})
      .finally(() => missing.forEach((x) => inflight.current.delete(`${locale}|${x}`)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, locale]);

  return useMemo(() => {
    const get = (x: string) => (locale === "en" ? x : trCache.get(`${locale}|${x}`) ?? null);
    const pending = locale !== "en" && texts.some((x) => x && !trCache.has(`${locale}|${x}`));
    return { get, pending, active: locale !== "en" };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, locale, mut.status, mut.data]);
}

/** ticking clock (ms) for countdowns; null until mounted to avoid hydration mismatch */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
