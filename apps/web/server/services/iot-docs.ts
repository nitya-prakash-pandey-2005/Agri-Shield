/**
 * Sensors & IoT — integration docs: the machine-readable telemetry contract
 * (served by GET /api/v1/telemetry), the OpenAPI fragment for the platform
 * spec, and copy-paste device snippets (curl, Arduino/ESP32, Python,
 * The Things Stack, MQTT). Pure — imported by the server and the UI.
 */
import { DEVICE_TYPES, METRIC_META, type DeviceType, type MetricKey } from "./iot-types";

export const UNITS_ACCEPTED: Partial<Record<MetricKey, string[]>> = {
  water_level_m: ["m", "cm", "mm", "ft", "in"],
  tide_level_m: ["m", "cm", "mm", "ft"],
  groundwater_depth_m: ["m", "cm", "mm", "ft"],
  soil_ec: ["dS/m", "mS/cm", "µS/cm (us/cm)", "S/m", "mS/m"],
  soil_moisture: ["%", "m3/m3", "fraction"],
  soil_temp_c: ["C", "F", "K"],
  air_temp_c: ["C", "F", "K"],
  rain_mm: ["mm", "cm", "in", "tips (0.2 mm bucket)"],
  humidity_pct: ["%", "fraction"],
  wind_ms: ["m/s", "km/h", "mph", "kn"],
  pressure_hpa: ["hPa", "mbar", "kPa", "Pa", "inHg"],
  battery_pct: ["%", "V (Li-ion 3.0-4.2 V or Li-SOCl₂ 3.0-3.6 V)", "mV"],
  rssi_dbm: ["dBm"],
  snr_db: ["dB"],
};

export const MQTT_CONVENTION = {
  broker: "mqtts://mqtt.<your-host>:8883 (planned — REST and LoRaWAN are live today)",
  username: "<deviceId>",
  password: "<device key dk_…>",
  topics: {
    up: "agrishield/<orgId>/<deviceId>/up — telemetry, payload identical to the REST body (QoS 1)",
    status: "agrishield/<orgId>/<deviceId>/status — retained 'online' / last-will 'offline'",
    down: "agrishield/<orgId>/<deviceId>/down — configuration pushed to the device (interval, thresholds)",
  },
};

export function telemetryContract(origin: string) {
  return {
    endpoints: {
      rest: { method: "POST", url: `${origin}/api/v1/telemetry`, auth: "X-Device-Key: dk_… (or Authorization: Bearer dk_…)", limits: { bodyBytes: 256_000, batch: 500, perDevicePerMin: 120, perIpPerMin: 600 } },
      lorawan: { method: "POST", url: `${origin}/api/v1/telemetry/lorawan`, auth: "X-Device-Key header added in the TTN webhook", format: "The Things Stack v3 uplink message (decoded_payload required)" },
      mqtt: MQTT_CONVENTION,
    },
    reading: {
      ts: "ISO-8601, epoch seconds or epoch milliseconds; optional (server time); must be within [now − 7 d, now + 5 min]",
      values: "{ <metric>: number | { value, unit } } — or flat keys with unit suffixes (water_level_cm, soil_ec_us_cm, battery_v)",
      dedupe: "a reading whose timestamp already exists for the device is ignored",
    },
    metrics: Object.fromEntries(
      (Object.keys(METRIC_META) as MetricKey[]).map((k) => [k, { label: METRIC_META[k].label, canonicalUnit: METRIC_META[k].unit, acceptedUnits: UNITS_ACCEPTED[k] ?? [METRIC_META[k].unit], plausibleRange: [METRIC_META[k].min, METRIC_META[k].max] }])
    ),
    aliases: {
      water_level_m: ["water_level", "level", "stage", "river_level", "wl", "gauge_height"],
      soil_ec: ["ec", "conductivity", "soil_conductivity", "ec_bulk"],
      soil_moisture: ["moisture", "vwc", "soil_water"],
      air_temp_c: ["temperature", "temp"],
      humidity_pct: ["humidity", "rh"],
      rain_mm: ["rain", "rainfall", "precipitation"],
      battery_pct: ["battery", "bat", "BatV (volts)", "vbat (volts)"],
    },
    deviceTypes: Object.fromEntries((Object.keys(DEVICE_TYPES) as DeviceType[]).map((t) => [t, { label: DEVICE_TYPES[t].label, metrics: DEVICE_TYPES[t].metrics, defaultIntervalSec: DEVICE_TYPES[t].intervalSec }])),
    responses: { 202: "accepted (see accepted / duplicates / rejected[] / warnings[] / anomalies[])", 401: "missing or unknown device key", 403: "device_id in body does not match the key", 413: "body too large", 422: "nothing valid in the payload", 429: "rate limited (Retry-After: 60)" },
  };
}

/** OpenAPI 3.1 fragment for the platform spec owner to merge into server/api/openapi.ts. */
export const OPENAPI_FRAGMENT = {
  paths: {
    "/api/v1/telemetry": {
      post: {
        operationId: "ingestTelemetry",
        tags: ["Sensors & IoT"],
        summary: "Ingest device telemetry (single reading or batch ≤ 500)",
        security: [{ deviceKey: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { oneOf: [{ $ref: "#/components/schemas/TelemetryReading" }, { type: "object", required: ["readings"], properties: { device_id: { type: "string" }, readings: { type: "array", maxItems: 500, items: { $ref: "#/components/schemas/TelemetryReading" } } } }, { type: "array", maxItems: 500, items: { $ref: "#/components/schemas/TelemetryReading" } }] },
              example: { ts: "2026-09-29T10:00:00Z", values: { water_level: { value: 342, unit: "cm" }, battery: 87 } },
            },
          },
        },
        responses: {
          "202": { description: "Accepted", content: { "application/json": { schema: { $ref: "#/components/schemas/TelemetryResult" } } } },
          "401": { description: "Missing / unknown device key" },
          "403": { description: "device_id does not match the key" },
          "413": { description: "Body > 256 KB" },
          "422": { description: "No valid reading" },
          "429": { description: "Rate limited (120/min per device, 600/min per IP)" },
        },
      },
      get: { operationId: "getTelemetryContract", tags: ["Sensors & IoT"], summary: "Machine-readable telemetry contract (metrics, units, aliases, MQTT topics)", responses: { "200": { description: "Contract" } } },
    },
    "/api/v1/telemetry/lorawan": {
      post: {
        operationId: "ingestLorawanUplink",
        tags: ["Sensors & IoT"],
        summary: "The Things Stack v3 uplink webhook",
        security: [{ deviceKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["end_device_ids", "uplink_message"], properties: { end_device_ids: { type: "object" }, received_at: { type: "string", format: "date-time" }, uplink_message: { type: "object", properties: { decoded_payload: { type: "object" }, rx_metadata: { type: "array" } } } } } } } },
        responses: { "202": { description: "Accepted" }, "401": { description: "Missing X-Device-Key" }, "409": { description: "dev_eui mismatch" }, "422": { description: "Not a TTN uplink / no decoded_payload" } },
      },
    },
  },
  components: {
    securitySchemes: { deviceKey: { type: "apiKey", in: "header", name: "X-Device-Key", description: "Per-device key dk_… (shown once at provisioning; SHA-256 stored). Authorization: Bearer dk_… also accepted." } },
    schemas: {
      TelemetryReading: {
        type: "object",
        properties: {
          ts: { oneOf: [{ type: "string", format: "date-time" }, { type: "number", description: "epoch s or ms" }] },
          values: { type: "object", additionalProperties: { oneOf: [{ type: "number" }, { type: "object", properties: { value: { type: "number" }, unit: { type: "string" } }, required: ["value"] }] } },
        },
        additionalProperties: { type: "number", description: "flat metric keys, optionally with a unit suffix (water_level_cm)" },
      },
      TelemetryResult: {
        type: "object",
        properties: {
          accepted: { type: "integer" },
          duplicates: { type: "integer" },
          rejected: { type: "array", items: { type: "object", properties: { index: { type: "integer" }, reason: { type: "string" } } } },
          warnings: { type: "array", items: { type: "object", properties: { index: { type: "integer" }, warning: { type: "string" } } } },
          lastTs: { type: ["string", "null"] },
          anomalies: { type: "array", items: { type: "object" } },
          device: { type: "object", properties: { id: { type: "string" }, status: { type: "string", enum: ["online", "stale", "offline", "never"] }, lastSeen: { type: ["string", "null"] } } },
        },
      },
    },
  },
};

// ─── Device snippets ─────────────────────────────────────────────────────

export type SnippetLang = "curl" | "python" | "esp32" | "arduino" | "ttn" | "mqtt";

/** Example payload for a device type, in the flat form with realistic values. */
export function examplePayload(type: DeviceType): Record<string, number> {
  switch (type) {
    case "river_gauge":
      return { water_level_cm: 342, battery_v: 3.58 };
    case "tide_gauge":
      return { tide_level_m: 1.12, battery: 91 };
    case "soil_probe":
      return { soil_ec_us_cm: 2850, soil_moisture: 31.5, soil_temp_c: 28.4, battery_v: 3.55 };
    case "rain_gauge":
      return { rain_tips: 6, battery_v: 3.57 };
    case "weather_station":
      return { air_temp_c: 31.2, humidity: 78, rain_mm: 0.4, wind_kmh: 12.6, pressure_hpa: 1006.8, battery: 88 };
    case "piezometer":
      return { groundwater_depth_m: 4.73, battery_v: 3.6 };
  }
}

export function deviceSnippet(lang: SnippetLang, opts: { origin: string; deviceId: string; orgId: string; key: string; type: DeviceType; intervalSec: number }): string {
  const url = `${opts.origin}/api/v1/telemetry`;
  const p = examplePayload(opts.type);
  const pj = JSON.stringify(p);
  const keys = Object.keys(p);
  switch (lang) {
    case "curl":
      return `curl -X POST ${url} \\
  -H "Content-Type: application/json" \\
  -H "X-Device-Key: ${opts.key}" \\
  -d '${JSON.stringify({ ts: "2026-09-29T10:00:00Z", ...p })}'

# batch (≤ 500 readings, e.g. after a connectivity outage)
curl -X POST ${url} -H "Content-Type: application/json" -H "X-Device-Key: ${opts.key}" \\
  -d '{"readings":[${JSON.stringify({ ts: 1790654400, ...p })},${JSON.stringify({ ts: 1790654460, ...p })}]}'`;
    case "python":
      return `# pip install requests
import time, requests

URL = "${url}"
KEY = "${opts.key}"   # store in a secrets file, not in git

def read_sensors():
    # replace with your driver calls
    return ${pj.replace(/"(\w+)":/g, '"$1": ')}

buffer = []
while True:
    buffer.append({"ts": int(time.time()), **read_sensors()})
    try:
        r = requests.post(URL, json={"readings": buffer}, headers={"X-Device-Key": KEY}, timeout=10)
        if r.status_code in (202, 422):
            buffer.clear()          # accepted (or permanently invalid)
        print(r.status_code, r.json().get("accepted"))
    except requests.RequestException as e:
        print("offline, keeping", len(buffer), "readings:", e)   # retried next loop, deduped by ts
    time.sleep(${opts.intervalSec})`;
    case "esp32":
      return `// ESP32 (Arduino core) — WiFi + HTTPS POST every ${opts.intervalSec} s
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <time.h>

const char* SSID = "your-wifi";
const char* PASS = "your-password";
const char* URL  = "${url}";
const char* KEY  = "${opts.key}";

void setup() {
  Serial.begin(115200);
  WiFi.begin(SSID, PASS);
  while (WiFi.status() != WL_CONNECTED) delay(500);
  configTime(0, 0, "pool.ntp.org");            // real timestamps → server-side dedupe works
}

void loop() {
${keys.map((k) => `  float ${k} = ${p[k]};                  // TODO: read your sensor`).join("\n")}
  char body[256];
  snprintf(body, sizeof body, "{\\"ts\\":%ld,${keys.map((k) => `\\"${k}\\":%.2f`).join(",")}}", (long)time(nullptr), ${keys.join(", ")});

  WiFiClientSecure tls; tls.setInsecure();     // pin the CA certificate in production
  HTTPClient http;
  http.begin(tls, URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", KEY);
  int code = http.POST(body);
  Serial.printf("POST %d\\n", code);            // 202 = accepted
  http.end();
  esp_sleep_enable_timer_wakeup(${opts.intervalSec}ULL * 1000000ULL);
  esp_deep_sleep_start();                      // saves battery between readings
}`;
    case "arduino":
      return `// Arduino MKR / Nano 33 IoT (WiFiNINA + ArduinoHttpClient)
#include <WiFiNINA.h>
#include <ArduinoHttpClient.h>

const char HOST[] = "${new URL(opts.origin).hostname}";
const int  PORT   = ${new URL(opts.origin).port || (opts.origin.startsWith("https") ? 443 : 80)};
const char KEY[]  = "${opts.key}";

${opts.origin.startsWith("https") ? "WiFiSSLClient" : "WiFiClient"} net;
HttpClient http(net, HOST, PORT);

void setup() { WiFi.begin("your-wifi", "your-password"); while (WiFi.status() != WL_CONNECTED) delay(500); }

void loop() {
  String body = String("{") +
${keys.map((k, i) => `    "\\"${k}\\":" + String(${p[k]}, 2)${i < keys.length - 1 ? ' + ","' : ""} +`).join("\n")}
    "}";                                       // ts omitted → server time
  http.beginRequest();
  http.post("/api/v1/telemetry");
  http.sendHeader("Content-Type", "application/json");
  http.sendHeader("X-Device-Key", KEY);
  http.sendHeader("Content-Length", body.length());
  http.beginBody(); http.print(body); http.endRequest();
  Serial.println(http.responseStatusCode());   // 202 = accepted
  delay(${opts.intervalSec * 1000}UL);
}`;
    case "ttn":
      return `// The Things Stack console → Applications → <app> → Integrations → Webhooks → + Add webhook → Custom
//   Webhook format:  JSON
//   Base URL:        ${opts.origin}/api/v1/telemetry/lorawan
//   Additional headers:  X-Device-Key: ${opts.key}
//   Enabled messages:    Uplink message
//
// Payload formatter (Applications → <app> → Payload formatters → Uplink → Custom Javascript):
function decodeUplink(input) {
  var b = input.bytes;
  return {
    data: {
${keys.map((k, i) => `      ${k}: ((b[${i * 2}] << 8) | b[${i * 2 + 1}]) / 100${i < keys.length - 1 ? "," : ""}`).join("\n")}
    }
  };
}
// decoded_payload keys go through the same alias + unit normaliser as the REST API;
// the best gateway RSSI / SNR are stored automatically as link-quality metrics.`;
    case "mqtt":
      return `# MQTT topic convention (broker planned — use REST or LoRaWAN today)
#   publish  agrishield/${opts.orgId}/${opts.deviceId}/up      payload = REST body (QoS 1)
#   status   agrishield/${opts.orgId}/${opts.deviceId}/status  retained "online", last-will "offline"
#   config   agrishield/${opts.orgId}/${opts.deviceId}/down    subscribe for interval / threshold updates
# username = ${opts.deviceId}   password = device key

mosquitto_pub -h mqtt.<your-host> -p 8883 --capath /etc/ssl/certs \\
  -u ${opts.deviceId} -P ${opts.key} -q 1 \\
  -t agrishield/${opts.orgId}/${opts.deviceId}/up \\
  -m '${pj}'`;
  }
}
