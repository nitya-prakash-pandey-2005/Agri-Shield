/**
 * Server-side locale resolution for layouts:
 *   cookie (explicit choice) → signed-in user's profile language → Accept-Language → English
 * Wrap a layout's children with <LocaleRoot> to get SSR in the right language.
 */
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";
import { auth } from "@/auth";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, loadMessages, matchLocale, type Locale, type Messages } from "./config";
import { I18nProvider } from "./I18nProvider";

export async function getRequestLocale(): Promise<{ locale: Locale; messages: Messages }> {
  let locale: Locale = DEFAULT_LOCALE;
  try {
    const c = (await cookies()).get(LOCALE_COOKIE)?.value;
    if (isLocale(c)) locale = c;
    else {
      const session = await auth().catch(() => null);
      const profile = session?.user?.language;
      if (isLocale(profile) && profile !== DEFAULT_LOCALE) locale = profile;
      else locale = matchLocale((await headers()).get("accept-language")) ?? DEFAULT_LOCALE;
    }
  } catch {
    locale = DEFAULT_LOCALE;
  }
  return { locale, messages: await loadMessages(locale) };
}

export async function LocaleRoot({ children }: { children: ReactNode }) {
  const { locale, messages } = await getRequestLocale();
  return (
    <I18nProvider initialLocale={locale} initialMessages={messages}>
      {children}
    </I18nProvider>
  );
}
