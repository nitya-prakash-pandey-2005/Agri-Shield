/**
 * Phone-number normalisation for sign-in, sign-up and the SMS bot.
 *
 * Farmers type numbers many ways — "+880 1711-000000", "8801711000000",
 * "01711000000", "00880 1711 000000". We compare on digits only:
 *   • strip punctuation/spaces, and a leading "00" international prefix
 *   • drop a national trunk "0" (BD 017…, VN 09…, PH 09…, ID 08…)
 *   • two numbers match when they are equal, or when the shorter one
 *     (national form, ≥ 8 digits) is the tail of the longer one (with
 *     country code).
 */

/** True when the input looks like a phone number rather than an email. */
export function isPhoneLike(raw: string): boolean {
  if (raw.includes("@")) return false;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 && /^[+\d\s().-]+$/.test(raw.trim());
}

/** Digits-only canonical form (no "+", no "00", no trunk "0"). */
export function phoneDigits(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  return d;
}

/** Storage form: "+<digits>" when a country code was given, otherwise the national digits. */
export function normalizePhone(raw: string): string {
  const hadCountry = raw.trim().startsWith("+") || raw.replace(/\D/g, "").startsWith("00");
  const d = phoneDigits(raw);
  return hadCountry ? `+${d}` : d;
}

export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = phoneDigits(a);
  const y = phoneDigits(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 8 && long.endsWith(short);
}
