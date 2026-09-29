/**
 * Provisioning QR encoder: version selection, finder/timing patterns, limits.
 * (Decodability of v1-v10 output was verified with OpenCV's QRCodeDetector.)
 */
import { describe, expect, it } from "vitest";
import { encodeQr, qrSvgPath } from "@/components/sensors/qr";

const finderOk = (m: boolean[][], x0: number, y0: number) => {
  for (let y = 0; y < 7; y++)
    for (let x = 0; x < 7; x++) {
      const d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
      if (m[y0 + y]![x0 + x] !== (d !== 2)) return false;
    }
  return true;
};

describe("encodeQr", () => {
  it("picks the smallest version (byte mode, ECC L)", () => {
    expect(encodeQr("HELLO")).toHaveLength(21); // v1
    expect(encodeQr("x".repeat(60))).toHaveLength(33); // v4
    expect(encodeQr("x".repeat(200))).toHaveLength(53); // v9
    expect(encodeQr("x".repeat(260))).toHaveLength(57); // v10
    expect(() => encodeQr("x".repeat(300))).toThrow(/too long/);
  });

  it("draws the three finder patterns, timing lines and the dark module", () => {
    const m = encodeQr("agrishield://provision?v=1&d=dev_ngobrac_01&o=org-ngo-brac&t=river_gauge&u=https%3A%2F%2Fapp.example%2Fapi%2Fv1%2Ftelemetry&k=dk_bXecK8kzq8eZIbF9roesydgXvolWMPGr");
    const n = m.length;
    expect(finderOk(m, 0, 0) && finderOk(m, n - 7, 0) && finderOk(m, 0, n - 7)).toBe(true);
    for (let i = 8; i < n - 8; i++) {
      expect(m[6]![i]).toBe(i % 2 === 0);
      expect(m[i]![6]).toBe(i % 2 === 0);
    }
    expect(m[n - 8]![8]).toBe(true);
  });

  it("is deterministic and renders to an SVG path with a quiet zone", () => {
    expect(encodeQr("abc")).toEqual(encodeQr("abc"));
    const { size, path } = qrSvgPath(encodeQr("abc"));
    expect(size).toBe(29);
    expect(path.startsWith("M4 4h1v1h-1z")).toBe(true);
  });
});
