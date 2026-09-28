/**
 * Dynamic-content translation.
 * Priority: DeepL (if DEEPL_API_KEY) → MyMemory free API (no key, ~5k chars/day).
 * Static UI strings use packages/i18n; this is for alerts & AI output.
 */
import { cached, fetchJson } from "./http";

const LANG_MAP: Record<string, string> = { en: "en", hi: "hi", bn: "bn", vi: "vi", fil: "tl", id: "id", ta: "ta", si: "si" };

export async function translate(text: string, target: string): Promise<{ text: string; provider: string }> {
  if (!text.trim() || target === "en" || !LANG_MAP[target]) return { text, provider: "none" };
  const key = `tr:${target}:${text}`;
  return cached(key, 7 * 24 * 3600_000, async () => {
    if (process.env.DEEPL_API_KEY) {
      const r = await fetchJson<{ translations: { text: string }[] }>("https://api-free.deepl.com/v2/translate", 8000, {
        method: "POST",
        headers: { Authorization: `DeepL-Auth-Key ${process.env.DEEPL_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text: [text], target_lang: target.toUpperCase() }),
      });
      return { text: r.translations[0]!.text, provider: "deepl" };
    }
    // MyMemory caps q at 500 bytes — translate paragraph by paragraph.
    const parts = text.split(/\n+/).filter(Boolean);
    const out: string[] = [];
    for (const part of parts) {
      const chunk = part.slice(0, 480);
      const r = await fetchJson<{ responseData: { translatedText: string }; responseStatus: number }>(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=en|${LANG_MAP[target]}`,
        8000
      );
      out.push(r.responseStatus === 200 ? r.responseData.translatedText : chunk);
    }
    return { text: out.join("\n\n"), provider: "mymemory" };
  }).catch(() => ({ text, provider: "none" }));
}
