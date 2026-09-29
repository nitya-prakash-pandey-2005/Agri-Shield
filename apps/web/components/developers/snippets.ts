/**
 * Code snippet generators shared by the in-app API explorer and the public
 * developer portal. Pure functions — no React, no secrets (keys are masked
 * unless the caller passes one explicitly).
 */
export type Lang = "curl" | "python" | "javascript" | "go";

export const LANGS: { id: Lang; label: string }[] = [
  { id: "curl", label: "curl" },
  { id: "python", label: "Python" },
  { id: "javascript", label: "JavaScript" },
  { id: "go", label: "Go" },
];

export function snippet(lang: Lang, p: { method: string; url: string; apiKey?: string | null }): string {
  const key = p.apiKey || "$AGRISHIELD_API_KEY";
  const envKey = p.apiKey ? `"${p.apiKey}"` : null;
  switch (lang) {
    case "curl":
      return [`curl -sS${p.method !== "GET" ? ` -X ${p.method}` : ""} "${p.url}" \\`, `  -H "X-API-Key: ${key}" \\`, `  -H "Accept: application/json"`].join("\n");
    case "python":
      return [
        "import os, requests",
        "",
        `API_KEY = ${envKey ?? 'os.environ["AGRISHIELD_API_KEY"]'}`,
        `resp = requests.${p.method.toLowerCase()}(`,
        `    "${p.url}",`,
        `    headers={"X-API-Key": API_KEY, "Accept": "application/json"},`,
        "    timeout=30,",
        ")",
        "resp.raise_for_status()  # 401 bad key · 403 missing scope · 429 rate limited",
        "print(resp.json())",
      ].join("\n");
    case "javascript":
      return [
        `const res = await fetch("${p.url}", {`,
        `  method: "${p.method}",`,
        `  headers: { "X-API-Key": ${envKey ?? "process.env.AGRISHIELD_API_KEY"}, Accept: "application/json" },`,
        "});",
        'if (!res.ok) throw new Error(`Agri-SHIELD ${res.status}: ${(await res.json()).error?.message}`);',
        "const data = await res.json();",
        "console.log(data);",
      ].join("\n");
    case "go":
      return [
        "package main",
        "",
        "import (",
        '\t"fmt"',
        '\t"io"',
        '\t"net/http"',
        '\t"os"',
        ")",
        "",
        "func main() {",
        `\treq, _ := http.NewRequest("${p.method}", "${p.url}", nil)`,
        `\treq.Header.Set("X-API-Key", ${envKey ?? 'os.Getenv("AGRISHIELD_API_KEY")'})`,
        '\treq.Header.Set("Accept", "application/json")',
        "\tres, err := http.DefaultClient.Do(req)",
        "\tif err != nil {",
        "\t\tpanic(err)",
        "\t}",
        "\tdefer res.Body.Close()",
        "\tbody, _ := io.ReadAll(res.Body)",
        '\tfmt.Println(res.Status, string(body))',
        "}",
      ].join("\n");
  }
}

/** Webhook signature verification examples (X-AgriShield-Signature = hex HMAC-SHA256 of the raw body). */
export const WEBHOOK_VERIFY: Record<Lang, string> = {
  curl: [
    "# Compute the expected signature of a saved payload and compare with the header",
    'printf \'%s\' "$(cat payload.json)" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET"',
  ].join("\n"),
  python: [
    "import hmac, hashlib",
    "",
    "def verify(raw_body: bytes, header_sig: str, secret: str) -> bool:",
    "    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()",
    '    return hmac.compare_digest(expected, header_sig.removeprefix("sha256="))',
  ].join("\n"),
  javascript: [
    'import { createHmac, timingSafeEqual } from "node:crypto";',
    "",
    "export function verify(rawBody, headerSig, secret) {",
    '  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");',
    '  const got = headerSig.replace(/^sha256=/, "");',
    "  return got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));",
    "}",
  ].join("\n"),
  go: [
    "func verify(rawBody []byte, headerSig, secret string) bool {",
    "\tmac := hmac.New(sha256.New, []byte(secret))",
    "\tmac.Write(rawBody)",
    "\texpected := hex.EncodeToString(mac.Sum(nil))",
    '\treturn hmac.Equal([]byte(expected), []byte(strings.TrimPrefix(headerSig, "sha256=")))',
    "}",
  ].join("\n"),
};
