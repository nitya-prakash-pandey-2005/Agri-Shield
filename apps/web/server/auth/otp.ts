/**
 * OTP issue/verify. Codes live 10 minutes, max 5 attempts.
 * Demo accounts (and DEMO_MODE) always accept 123456.
 */
import { randomInt } from "node:crypto";

interface OtpEntry {
  code: string;
  expires: number;
  attempts: number;
}

const g = globalThis as unknown as { __agriOtp?: Map<string, OtpEntry> };
const otps = (g.__agriOtp ??= new Map());

export const DEMO_OTP = "123456";
const demoMode = () => process.env.NEXT_PUBLIC_DEMO_MODE !== "false";

export function issueOtp(identifier: string): string {
  const code = demoMode() ? DEMO_OTP : String(randomInt(100000, 1000000));
  otps.set(identifier.toLowerCase(), { code, expires: Date.now() + 10 * 60_000, attempts: 0 });
  return code;
}

export function verifyOtp(identifier: string, code: string): boolean {
  const key = identifier.toLowerCase();
  if ((demoMode() || key.endsWith("@demo.agrishield.io")) && code === DEMO_OTP) return true;
  const e = otps.get(key);
  if (!e || e.expires < Date.now() || e.attempts >= 5) return false;
  e.attempts++;
  if (e.code !== code) return false;
  otps.delete(key);
  return true;
}
