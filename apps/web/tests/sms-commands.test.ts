import { describe, expect, it } from "vitest";
import {
  HELP_TEXT,
  buildAdviceReply,
  buildAlertReply,
  buildStatusReply,
  fitSegments,
  isGsm7,
  languageForPhone,
  maskPhone,
  needsCompact,
  normalizePhone,
  parseLanguage,
  parseSms,
  smsSegments,
  twiml,
} from "@/server/sms/commands";

describe("parseSms", () => {
  it.each([
    ["STATUS", "STATUS"],
    ["status", "STATUS"],
    ["  Status please ", "STATUS"],
    ["1", "STATUS"],
    ["ALERT", "ALERT"],
    ["alerts", "ALERT"],
    ["2", "ALERT"],
    ["ADVICE", "ADVICE"],
    ["3", "ADVICE"],
    ["HELP", "HELP"],
    ["?", "HELP"],
    ["", "HELP"],
    ["STOP", "STOP"],
    ["START", "START"],
    ["banana", "UNKNOWN"],
  ])("%j → %s", (body, cmd) => {
    expect(parseSms(body).command).toBe(cmd);
  });

  it.each([
    ["অবস্থা", "STATUS", "bn"],
    ["সতর্কতা", "ALERT", "bn"],
    ["परामर्श", "UNKNOWN", null],
    ["सलाह", "ADVICE", "hi"],
    ["मदद", "HELP", "hi"],
    ["TRẠNG THÁI", "STATUS", "vi"],
    ["trang thai", "STATUS", "vi"],
    ["Cảnh báo", "ALERT", "vi"],
    ["KALAGAYAN", "STATUS", "fil"],
    ["payo", "ADVICE", "fil"],
    ["PERINGATAN", "ALERT", "id"],
    ["saran", "ADVICE", "id"],
    ["நிலை", "STATUS", "ta"],
    ["උදව්", "HELP", "si"],
  ])("local keyword %s → %s (%s)", (body, cmd, lang) => {
    const p = parseSms(body);
    expect(p.command).toBe(cmd);
    expect(p.detectedLang).toBe(lang);
  });

  it("parses LANG arguments by code and name", () => {
    expect(parseSms("LANG bn").langArg).toBe("bn");
    expect(parseSms("lang Bangla").langArg).toBe("bn");
    expect(parseSms("LANG tagalog").langArg).toBe("fil");
    expect(parseSms("LANGUAGE vi").langArg).toBe("vi");
    expect(parseSms("LANG klingon").langArg).toBeNull();
    expect(parseSms("ভাষা en").langArg).toBe("en");
    expect(parseLanguage("বাংলা")).toBe("bn");
  });

  it("ignores punctuation and caps raw length", () => {
    expect(parseSms("STATUS!!!").command).toBe("STATUS");
    expect(parseSms("x".repeat(2000)).raw.length).toBeLessThanOrEqual(480);
  });
});

describe("phones", () => {
  it("normalises Twilio / WhatsApp formats", () => {
    expect(normalizePhone("whatsapp:+880 1711-000000")).toBe("+8801711000000");
    expect(normalizePhone("008801711000000")).toBe("+8801711000000");
    expect(normalizePhone("8801711000000")).toBe("+8801711000000");
    expect(normalizePhone(null)).toBe("");
  });
  it("guesses language from calling code", () => {
    expect(languageForPhone("+8801711000000")).toBe("bn");
    expect(languageForPhone("+84901234567")).toBe("vi");
    expect(languageForPhone("+639171234567")).toBe("fil");
    expect(languageForPhone("+6281234567")).toBe("id");
    expect(languageForPhone("+919876543210")).toBe("hi");
    expect(languageForPhone("+14155550100")).toBe("en");
  });
  it("masks numbers", () => {
    expect(maskPhone("+8801711000000")).toBe("+8801711****00");
  });
});

describe("SMS segments", () => {
  it("counts GSM-7 and UCS-2 correctly", () => {
    expect(isGsm7("Hello farmer, rain 45mm")).toBe(true);
    expect(isGsm7("বন্যা")).toBe(false);
    expect(smsSegments("a".repeat(160))).toMatchObject({ encoding: "GSM-7", segments: 1 });
    expect(smsSegments("a".repeat(161)).segments).toBe(2);
    expect(smsSegments("ক".repeat(70))).toMatchObject({ encoding: "UCS-2", segments: 1 });
    expect(smsSegments("ক".repeat(71)).segments).toBe(2);
    expect(smsSegments("€".repeat(80)).length).toBe(160); // extension table = 2 septets
  });
  it("fits any text into ≤ 2 segments", () => {
    for (const t of ["word ".repeat(200), "বন্যার ঝুঁকি ".repeat(60), "Nguy cơ lũ lụt ".repeat(50)]) {
      const out = fitSegments(t, 2);
      expect(smsSegments(out).segments).toBeLessThanOrEqual(2);
    }
    expect(fitSegments("short")).toBe("short");
  });
  it("marks UCS-2 languages for compact replies", () => {
    expect(needsCompact("bn")).toBe(true);
    expect(needsCompact("vi")).toBe(true);
    expect(needsCompact("en")).toBe(false);
    expect(needsCompact("id")).toBe(false);
  });
  it("curated HELP menus fit in 2 segments", () => {
    for (const [lang, text] of Object.entries(HELP_TEXT)) expect(smsSegments(text!).segments, lang).toBeLessThanOrEqual(2);
  });
});

describe("reply builders", () => {
  const ctx = {
    farmerName: "Ratan Das",
    district: "Barisal",
    fields: [
      { name: "North Paddy Field", crop: "rice", floodRisk: 82, salinityRisk: 40, soilEc: 2.1 },
      { name: "South Jute Plot", crop: "jute", floodRisk: 55, salinityRisk: 30, soilEc: 1.8 },
    ],
    floodProb72h: 0.78,
    rainfall72hMm: 142.4,
    ecCurrent: 2.3,
    riskLevel: "high",
  };
  it("STATUS includes district, probability and worst field", () => {
    const r = buildStatusReply(ctx);
    expect(r).toContain("Barisal");
    expect(r).toContain("78%");
    expect(r).toContain("North Paddy Field");
    expect(smsSegments(fitSegments(r)).segments).toBeLessThanOrEqual(2);
    expect(buildStatusReply(ctx, true).length).toBeLessThan(r.length);
  });
  it("ALERT lists most severe first, or says none", () => {
    const until = new Date("2026-10-01T06:00:00Z");
    const r = buildAlertReply("Khulna", [
      { severity: "watch", alertType: "salinity", title: "Salinity Watch", validUntil: until },
      { severity: "emergency", alertType: "flood", title: "Flood Emergency", validUntil: until, firstAction: "Move livestock to raised ground" },
    ]);
    expect(r.indexOf("EMERGENCY")).toBeLessThan(r.indexOf("WATCH"));
    expect(r).toContain("Move livestock");
    expect(buildAlertReply("Khulna", [])).toContain("No active alerts");
  });
  it("ADVICE returns top 3 by priority", () => {
    const r = buildAdviceReply([
      { title: "Low thing", priority: "low" },
      { title: "Urgent thing", priority: "urgent" },
      { title: "High thing", priority: "high" },
      { title: "Medium thing", priority: "medium" },
    ]);
    expect(r.split("\n")).toEqual(["1) Urgent thing", "2) High thing", "3) Medium thing"]);
  });
  it("TwiML escapes XML", () => {
    expect(twiml("a < b & c")).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Message>a &lt; b &amp; c</Message></Response>');
  });
});
