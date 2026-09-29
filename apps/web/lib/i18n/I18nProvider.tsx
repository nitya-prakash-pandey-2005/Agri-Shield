"use client";

/**
 * Lightweight i18n runtime for the farmer app, onboarding and auth.
 *  - initial locale resolved on the server (cookie → profile → Accept-Language)
 *    so the first paint is already in the right language
 *  - switching persists to localStorage + cookie + user profile (auth.setLanguage)
 *  - bundles are code-split per locale and fall back to English per key
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc";
import {
  DEFAULT_LOCALE,
  ENGLISH_MESSAGES,
  LOCALE_COOKIE,
  LOCALE_STORAGE_KEY,
  isLocale,
  loadMessages,
  localeMeta,
  matchLocale,
  type Locale,
  type Messages,
} from "./config";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
  formatRelative,
  formatTime,
  interpolate,
  lookup,
  type MessageKey,
  type TVars,
} from "./format";

export interface I18nValue {
  locale: Locale;
  messages: Messages;
  switching: boolean;
  setLocale: (l: Locale) => Promise<void>;
  t: (key: MessageKey, vars?: TVars) => string;
  /** dynamic keys, e.g. tx(`crops.${crop}`) — falls back to `fallback` or the key */
  tx: (key: string, vars?: TVars, fallback?: string) => string;
  fmt: {
    number: (v: number, o?: Intl.NumberFormatOptions) => string;
    percent: (fraction: number, digits?: number) => string;
    currency: (amount: number, country?: string | null, currency?: string) => string;
    date: (d: Date | string | number, o?: Intl.DateTimeFormatOptions) => string;
    time: (d: Date | string | number) => string;
    dateTime: (d: Date | string | number) => string;
    relative: (d: Date | string | number) => string;
    duration: (ms: number) => string;
  };
}

const I18nContext = createContext<I18nValue | null>(null);

export function persistLocaleClient(l: Locale) {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, l);
  } catch {}
  document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
  document.documentElement.lang = l;
  document.documentElement.dir = localeMeta(l).rtl ? "rtl" : "ltr";
}

export function I18nProvider({
  initialLocale = DEFAULT_LOCALE,
  initialMessages,
  children,
}: {
  initialLocale?: Locale;
  initialMessages?: Messages;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const [messages, setMessages] = useState<Messages>(initialMessages ?? ENGLISH_MESSAGES);
  const [switching, setSwitching] = useState(false);
  const { data: session, update } = useSession();
  const setLanguage = trpc.auth.setLanguage.useMutation();

  const apply = useCallback(async (l: Locale) => {
    setSwitching(true);
    const m = await loadMessages(l);
    setMessages(m);
    setLocaleState(l);
    setSwitching(false);
  }, []);

  // Client-side reconciliation: a stored explicit choice wins; otherwise the
  // browser preference is used when the server had nothing better than the default.
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    } catch {}
    const preferred = isLocale(stored) ? stored : null;
    const hasCookie = document.cookie.includes(`${LOCALE_COOKIE}=`);
    const target = preferred ?? (!hasCookie && initialLocale === DEFAULT_LOCALE ? matchLocale(navigator.languages) : null);
    if (target && target !== locale) void apply(target);
    document.documentElement.lang = target ?? locale;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLocale = useCallback(
    async (l: Locale) => {
      if (!isLocale(l)) return;
      persistLocaleClient(l);
      await apply(l);
      if (session?.user?.id) {
        setLanguage.mutate({ language: l });
        void update({ language: l }).catch(() => {});
      }
    },
    [apply, session?.user?.id, setLanguage, update]
  );

  const value = useMemo<I18nValue>(() => {
    const tx = (key: string, vars?: TVars, fallback?: string) => {
      const s = lookup(messages, ENGLISH_MESSAGES, key);
      return interpolate(s === key && fallback !== undefined ? fallback : s, vars);
    };
    return {
      locale,
      messages,
      switching,
      setLocale,
      t: (key, vars) => tx(key, vars),
      tx,
      fmt: {
        number: (v, o) => formatNumber(locale, v, o),
        percent: (f, d) => formatPercent(locale, f, d),
        currency: (a, c, cur) => formatCurrency(locale, a, c, cur),
        date: (d, o) => formatDate(locale, d, o),
        time: (d) => formatTime(locale, d),
        dateTime: (d) => formatDateTime(locale, d),
        relative: (d) => formatRelative(locale, d),
        duration: (ms) => formatDuration(locale, ms),
      },
    };
  }, [locale, messages, switching, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Full i18n context. Outside a provider it degrades to English. */
export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;
  return FALLBACK;
}

/** Optional access — null when no provider is mounted (used by LanguageSwitcher). */
export function useI18nOptional(): I18nValue | null {
  return useContext(I18nContext);
}

export function useT() {
  return useI18n().t;
}

const FALLBACK: I18nValue = (() => {
  const tx = (key: string, vars?: TVars, fallback?: string) => {
    const s = lookup(ENGLISH_MESSAGES, ENGLISH_MESSAGES, key);
    return interpolate(s === key && fallback !== undefined ? fallback : s, vars);
  };
  const l: Locale = "en";
  return {
    locale: l,
    messages: ENGLISH_MESSAGES,
    switching: false,
    setLocale: async (x: Locale) => persistLocaleClient(x),
    t: (k, v) => tx(k, v),
    tx,
    fmt: {
      number: (v, o) => formatNumber(l, v, o),
      percent: (f, d) => formatPercent(l, f, d),
      currency: (a, c, cur) => formatCurrency(l, a, c, cur),
      date: (d, o) => formatDate(l, d, o),
      time: (d) => formatTime(l, d),
      dateTime: (d) => formatDateTime(l, d),
      relative: (d) => formatRelative(l, d),
      duration: (ms) => formatDuration(l, ms),
    },
  };
})();
