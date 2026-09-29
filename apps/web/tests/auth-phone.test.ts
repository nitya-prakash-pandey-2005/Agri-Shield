import { describe, expect, it } from "vitest";
import { isPhoneLike, normalizePhone, phoneDigits, phonesMatch } from "@/server/auth/phone";

describe("phone normalisation", () => {
  it("recognises phone vs email input", () => {
    expect(isPhoneLike("+880 1711-000000")).toBe(true);
    expect(isPhoneLike("(0917) 123-4567")).toBe(true);
    expect(isPhoneLike("farmer@demo.agrishield.io")).toBe(false);
    expect(isPhoneLike("12345")).toBe(false);
  });

  it("canonicalises digits", () => {
    expect(phoneDigits("+880 1711-000000")).toBe("8801711000000");
    expect(phoneDigits("00880 1711 000000")).toBe("8801711000000");
    expect(phoneDigits("01711000000")).toBe("1711000000");
    expect(normalizePhone("+91 98765 43210")).toBe("+919876543210");
    expect(normalizePhone("09171234567")).toBe("9171234567");
  });

  it("matches the same number typed different ways", () => {
    const stored = "+8801711000000";
    for (const typed of ["+8801711000000", "8801711000000", "01711000000", "+880 1711-000000", "00880-1711-000000", "1711000000"]) {
      expect(phonesMatch(stored, typed), typed).toBe(true);
    }
  });

  it("does not match different numbers", () => {
    expect(phonesMatch("+8801711000000", "+8801711000001")).toBe(false);
    expect(phonesMatch("+8801711000000", "000000")).toBe(false);
    expect(phonesMatch(null, "01711000000")).toBe(false);
  });
});
