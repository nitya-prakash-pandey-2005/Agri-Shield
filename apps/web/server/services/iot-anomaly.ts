/**
 * Sensors & IoT — anomaly detection (pure, unit-tested).
 *
 * Pipeline per metric series (irregular timestamps allowed):
 *   1. rolling median (centred, 7 samples) → residual r = x − median
 *   2. robust scale σ = 1.4826·MAD(r) (floored at the sensor noise floor)
 *      → robust z = r / σ
 *   3. SPIKE      |z| > 6 for ≤ 2 consecutive samples AND the jump is faster than
 *                 the metric's physically plausible rate → sensor fault
 *      OUTLIER    same, but a believable rate → "suspect"
 *   4. FLATLINE   identical readings for ≥ N hours on a sensor that normally
 *                 moves → stuck sensor (fault)
 *   5. CHANGE-POINT on the de-spiked series: fast vs slow EWMA (time-aware
 *                 α = 1 − e^(−Δt/τ)); a normalised gap |fast − slow|/σ > k that
 *                 persists ≥ 3 samples → level shift
 *   6. RAPID RISE (water level) — rise over a trailing 3 h window (monotonic
 *                 deque sliding min) ≥ threshold; EC SURGE (soil EC) — rise over
 *                 12 h ≥ max(1.5 dS/m, 60 % of baseline). Both are classified as
 *                 REAL EVENTS when a physical driver explains them (rain, high
 *                 river flow, tide/surge), otherwise "suspect — check device".
 *   7. GAPS       silence > 3× the reporting interval (packet loss / outage).
 */
import { METRIC_META, type Anomaly, type AnomalyClass, type AnomalyKind, type MetricKey } from "./iot-types";

export interface Sample {
  t: number;
  v: number;
}

export interface DetectContext {
  /** rain measured / forecast around the device in the 24 h before the event (mm) */
  rain24hMm?: number | null;
  /** forecast rain next 72 h (mm) */
  forecastRain72hMm?: number | null;
  /** GloFAS-style discharge ratio vs normal */
  dischargeRatio?: number | null;
  /** coastal / tidal site — EC surges are physically plausible */
  tidal?: boolean;
  /** measured rain (mm) between two instants from a nearby gauge, when one exists */
  rainBetween?: (from: number, to: number) => number | null;
}

export interface DetectOptions {
  deviceId: string;
  metric: MetricKey;
  intervalMs: number;
  zThreshold?: number;
  /** minimum flatline duration (h) */
  flatlineHours?: number;
  /** rapid-rise threshold (m in 3 h) for water level */
  riseThresholdM?: number;
  context?: DetectContext;
}

const H = 3_600_000;

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const a = [...xs].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

export function mad(xs: number[]): number {
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

/** Centred rolling median (window truncated at the edges). */
export function rollingMedian(xs: number[], window = 7): number[] {
  const half = window >> 1;
  const out = new Array<number>(xs.length);
  for (let i = 0; i < xs.length; i++) out[i] = median(xs.slice(Math.max(0, i - half), Math.min(xs.length, i + half + 1)));
  return out;
}

/** Robust z-scores of residuals vs rolling median. */
export function robustZ(xs: number[], window = 7, noiseFloor = 1e-6): { med: number[]; z: number[]; sigma: number } {
  const med = rollingMedian(xs, window);
  const r = xs.map((x, i) => x - med[i]!);
  const sigma = Math.max(1.4826 * mad(r), noiseFloor);
  return { med, z: r.map((x) => x / sigma), sigma };
}

function lowerIdx(arr: Sample[], t: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]!.t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Time-aware EWMA: α = 1 − exp(−Δt/τ). */
export function ewma(s: Sample[], tauMs: number): number[] {
  const out: number[] = [];
  let m = s[0]?.v ?? 0;
  for (let i = 0; i < s.length; i++) {
    if (i > 0) {
      const a = 1 - Math.exp(-Math.max(0, s[i]!.t - s[i - 1]!.t) / tauMs);
      m = m + a * (s[i]!.v - m);
    }
    out.push(m);
  }
  return out;
}

/** Largest rise x[i] − min(x over [t_i − win, t_i]) using a monotonic deque. */
export function trailingRise(s: Sample[], winMs: number): { rise: number; from: number }[] {
  const out: { rise: number; from: number }[] = [];
  const dq: number[] = [];
  let head = 0;
  for (let i = 0; i < s.length; i++) {
    while (dq.length > head && s[dq[dq.length - 1]!]!.v >= s[i]!.v) dq.pop();
    dq.push(i);
    while (s[dq[head]!]!.t < s[i]!.t - winMs) head++;
    const j = dq[head]!;
    out.push({ rise: s[i]!.v - s[j]!.v, from: j });
  }
  return out;
}

/** Sensor noise floor: resolution below which differences are meaningless. */
function noiseFloor(metric: MetricKey): number {
  switch (metric) {
    case "water_level_m":
    case "tide_level_m":
    case "groundwater_depth_m":
      return 0.004;
    case "soil_ec":
      return 0.02;
    case "soil_moisture":
      return 0.15;
    case "pressure_hpa":
      return 0.1;
    default:
      return 0.05;
  }
}

function mk(o: DetectOptions, kind: AnomalyKind, cls: AnomalyClass, severity: Anomaly["severity"], start: number, end: number, value: number, baseline: number, score: number, title: string, explanation: string): Anomaly {
  return { id: `${o.deviceId}:${o.metric}:${kind}:${start}`, deviceId: o.deviceId, metric: o.metric, kind, cls, severity, start, end, value, baseline, score, title, explanation };
}

const fmt = (metric: MetricKey, v: number) => `${v.toFixed(METRIC_META[metric].decimals)} ${METRIC_META[metric].unit}`;

export function detectAnomalies(series: Sample[], o: DetectOptions): Anomaly[] {
  const s = series.filter((p) => Number.isFinite(p.v)).sort((a, b) => a.t - b.t);
  const out: Anomaly[] = [];
  if (s.length < 8) return out;
  const meta = METRIC_META[o.metric];
  const label = meta.label.toLowerCase();
  const zThr = o.zThreshold ?? 6;
  const floor = noiseFloor(o.metric);
  const xs = s.map((p) => p.v);
  const ctx = o.context ?? {};

  // ── 7. gaps (packet loss / outage)
  const gapMs = Math.max(3 * o.intervalMs, 10 * 60_000);
  for (let i = 1; i < s.length; i++) {
    const dt = s[i]!.t - s[i - 1]!.t;
    if (dt > gapMs && dt > 45 * 60_000) {
      out.push(mk(o, "gap", "sensor_fault", dt > 6 * H ? "warning" : "info", s[i - 1]!.t, s[i]!.t, 0, 0, dt / o.intervalMs, `No data for ${(dt / H).toFixed(1)} h`, `The device missed about ${Math.round(dt / o.intervalMs)} reports. Usually radio interference, a flat battery or a gateway outage — the readings on either side are unaffected.`));
    }
  }

  // Rain is naturally bursty and mostly zero: only plausibility checks apply.
  if (meta.agg === "sum") {
    const perH = (v: number, i: number) => (i > 0 ? v / Math.max((s[i]!.t - s[i - 1]!.t) / H, o.intervalMs / H) : v / (o.intervalMs / H));
    for (let i = 0; i < s.length; i++) {
      const rate = perH(s[i]!.v, i);
      if (rate > 180) out.push(mk(o, "spike", "sensor_fault", "warning", s[i]!.t, s[i]!.t, s[i]!.v, 0, rate, "Implausible rain intensity", `${s[i]!.v.toFixed(1)} mm in one interval (${rate.toFixed(0)} mm/h) exceeds world-record intensities — typically a bucket bounce or wiring fault.`));
    }
    return out;
  }

  // ── 2-3. robust z, spikes & outliers
  const { med, z, sigma } = robustZ(xs, 7, floor);
  const isOut = z.map((v) => Math.abs(v) > zThr);
  const clean = xs.slice();
  for (let i = 0; i < s.length; ) {
    if (!isOut[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < s.length && isOut[j + 1]) j++;
    const len = j - i + 1;
    // at the live edge a fresh step looks like a spike — wait for two more samples before judging
    if (j >= s.length - 2) break;
    if (len <= 2) {
      let k = i;
      for (let q = i; q <= j; q++) if (Math.abs(z[q]!) > Math.abs(z[k]!)) k = q;
      const prev = i > 0 ? s[i - 1]! : null;
      const dtH = prev ? Math.max((s[k]!.t - prev.t) / H, 1 / 60) : o.intervalMs / H;
      const rate = prev ? Math.abs(s[k]!.v - prev.v) / dtH : Infinity;
      const implausible = rate > meta.maxRatePerHour || s[k]!.v < meta.min || s[k]!.v > meta.max;
      out.push(
        implausible
          ? mk(o, "spike", "sensor_fault", "warning", s[i]!.t, s[j]!.t, s[k]!.v, med[k]!, z[k]!, `Sensor spike: ${fmt(o.metric, s[k]!.v)}`, `A single reading jumped to ${fmt(o.metric, s[k]!.v)} against a baseline of ${fmt(o.metric, med[k]!)} and came straight back — faster than ${label} can physically change. Treated as a sensor glitch and excluded from alerts.`)
          : mk(o, "outlier", "suspect", "info", s[i]!.t, s[j]!.t, s[k]!.v, med[k]!, z[k]!, `Unusual reading: ${fmt(o.metric, s[k]!.v)}`, `A short-lived reading ${Math.abs(z[k]!).toFixed(1)} robust standard deviations from the local median. Physically possible, so kept, but not confirmed by later readings.`)
      );
      for (let q = i; q <= j; q++) clean[q] = med[q]!;
    }
    i = j + 1;
  }

  // ── 4. flatline
  const flatH = o.flatlineHours ?? (o.metric === "groundwater_depth_m" ? 24 : 3);
  const eps = floor * 0.01;
  // typical movement of the sensor when it is NOT stuck (non-zero steps only)
  const moving = xs.slice(1).map((x, i) => Math.abs(x - xs[i]!)).filter((d) => d > eps);
  const overallSpread = moving.length >= 8 ? median(moving) : 0;
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j + 1 < s.length && Math.abs(s[j + 1]!.v - s[i]!.v) <= eps) j++;
    const dur = s[j]!.t - s[i]!.t;
    if (j - i + 1 >= 8 && dur >= flatH * H && overallSpread > eps * 10) {
      out.push(mk(o, "flatline", "sensor_fault", "warning", s[i]!.t, s[j]!.t, s[i]!.v, s[i]!.v, dur / H, `Stuck sensor: flat for ${(dur / H).toFixed(1)} h`, `${meta.label} has reported exactly ${fmt(o.metric, s[i]!.v)} for ${(dur / H).toFixed(1)} hours. Real ${label} always fluctuates a little, so the probe is probably fouled, disconnected or frozen in firmware. Its data is excluded until it moves again.`));
    }
    i = j + 1;
  }

  const cs: Sample[] = s.map((p, i) => ({ t: p.t, v: clean[i]! }));
  /** physical drivers that could explain an event that started at `from` and peaked at `to` */
  const driversFor = (from: number, to: number): string[] => {
    const d: string[] = [];
    const measured = ctx.rainBetween?.(from - 24 * H, to);
    const rain = measured ?? ctx.rain24hMm ?? null;
    if (rain != null && rain >= 15) d.push(`${Math.round(rain)} mm of rain ${measured != null ? "measured nearby in the 24 h before and during the rise" : "in the previous 24 h"}`);
    if ((ctx.dischargeRatio ?? 0) >= 1.3) d.push(`river flow ${ctx.dischargeRatio!.toFixed(1)}× normal (GloFAS)`);
    if ((ctx.forecastRain72hMm ?? 0) >= 60 && to > Date.now() - 6 * H) d.push(`${Math.round(ctx.forecastRain72hMm!)} mm of rain forecast for the next 72 h`);
    return d;
  };

  // ── 6a. rapid rise (river / canal level)
  if (o.metric === "water_level_m") {
    const thr = o.riseThresholdM ?? 0.5;
    // Tidal reaches rise ~1 m every 6 h by nature: judge the rise of the de-tided
    // series y(t) = x(t) − x(t − 24.84 h) (two M2 cycles) instead of the raw stage.
    let rs: Sample[] = cs;
    let thrEff = thr;
    const lag = 2 * 12.4206012 * H;
    if (ctx.tidal && cs.length && cs[cs.length - 1]!.t - cs[0]!.t < lag + 3 * H) {
      // not enough history to remove the tide yet: judge the raw stage with a doubled threshold
      thrEff = 2 * thr;
    } else if (ctx.tidal) {
      rs = [];
      let j = 0;
      for (const p of cs) {
        const tl = p.t - lag;
        if (tl < cs[0]!.t) continue;
        while (j + 1 < cs.length && cs[j + 1]!.t <= tl) j++;
        const a = cs[j]!;
        const b = cs[Math.min(j + 1, cs.length - 1)]!;
        const past = b.t === a.t ? a.v : a.v + ((b.v - a.v) * (tl - a.t)) / (b.t - a.t);
        rs.push({ t: p.t, v: p.v - past });
      }
    }
    const tr = trailingRise(rs, 3 * H);
    for (let i = 0; i < rs.length; ) {
      if (tr[i]!.rise < thrEff) {
        i++;
        continue;
      }
      let j = i;
      let peak = i;
      while (j + 1 < rs.length && tr[j + 1]!.rise >= thrEff * 0.6) {
        j++;
        if (rs[j]!.v > rs[peak]!.v) peak = j;
      }
      const fromIdx = tr[i]!.from;
      const from = rs[fromIdx]!;
      const rise = rs[peak]!.v - from.v;
      const hours = Math.max((rs[peak]!.t - from.t) / H, 0.25);
      const levelAt = (t: number) => cs[Math.min(cs.length - 1, lowerIdx(cs, t))]!.v;
      const drivers = driversFor(from.t, rs[peak]!.t);
      const real = drivers.length > 0;
      const tidalNote = ctx.tidal ? " (after removing the normal tide)" : "";
      out.push(
        mk(o, "rapid_rise", real ? "real_event" : "suspect", real || rise >= 2 * thr ? "critical" : "warning", from.t, rs[j]!.t, levelAt(rs[peak]!.t), levelAt(from.t), rise / hours,
          `Rapid rise: +${rise.toFixed(2)} m in ${hours.toFixed(1)} h`,
          real
            ? `The water rose ${rise.toFixed(2)} m${tidalNote} (${(rise / hours).toFixed(2)} m/h). This is consistent with ${drivers.join(" and ")} — a real flood pulse, not a sensor fault. Check downstream assets and evacuation triggers.`
            : `The water rose ${rise.toFixed(2)} m${tidalNote} (${(rise / hours).toFixed(2)} m/h) with no rain or high river flow to explain it. Could be a local release (sluice/dam), debris under a radar sensor or a displaced pressure probe — check the device.`)
      );
      i = j + 1;
    }
  }

  // ── 6b. EC surge (soil salinity)
  if (o.metric === "soil_ec") {
    const tr = trailingRise(cs, 12 * H);
    for (let i = 0; i < cs.length; ) {
      const base = cs[tr[i]!.from]!.v;
      const need = Math.max(1.5, 0.6 * base);
      if (tr[i]!.rise < need) {
        i++;
        continue;
      }
      let j = i;
      let peak = i;
      while (j + 1 < cs.length && cs[j + 1]!.v - base >= need * 0.6) {
        j++;
        if (cs[j]!.v > cs[peak]!.v) peak = j;
      }
      const sustained = j - i + 1 >= 3;
      // rate over the steepest part: from the trough to the first sample reaching 90 % of the peak rise
      let k90 = i;
      while (k90 < peak && cs[k90]!.v - base < 0.9 * (cs[peak]!.v - base)) k90++;
      // …and back from there to the last sample still within 10 % of the baseline (onset of the rise)
      let k10 = k90;
      while (k10 > tr[i]!.from && cs[k10]!.v - base > 0.1 * (cs[peak]!.v - base)) k10--;
      const hours = Math.max((cs[k90]!.t - cs[k10]!.t) / H, o.intervalMs / H);
      const rate = (cs[k90]!.v - cs[k10]!.v) / hours;
      const physical = rate <= METRIC_META.soil_ec.maxRatePerHour;
      const cls: AnomalyClass = sustained && physical ? (ctx.tidal ? "real_event" : "suspect") : "sensor_fault";
      out.push(
        mk(o, "ec_surge", cls, cls === "real_event" ? "critical" : "warning", cs[tr[i]!.from]!.t, cs[j]!.t, cs[peak]!.v, base, rate,
          `Salinity surge: ${base.toFixed(1)} → ${cs[peak]!.v.toFixed(1)} dS/m`,
          cls === "real_event"
            ? `Root-zone salinity jumped from ${base.toFixed(1)} to ${cs[peak]!.v.toFixed(1)} dS/m and stayed high. At a tidal site this is the signature of saline water entering the field (spring tide, surge or a breached embankment). Stop irrigating from the canal and flush with fresh water if available.${cs[peak]!.v > 3 ? " Above 3 dS/m rice starts losing yield." : ""}`
            : cls === "suspect"
              ? `Salinity rose from ${base.toFixed(1)} to ${cs[peak]!.v.toFixed(1)} dS/m at an inland site with no tidal driver. Possible fertiliser application next to the probe or a calibration drift — verify with a hand-held EC meter.`
              : `EC changed faster than salt can move through soil (${rate.toFixed(1)} dS/m per hour) — most likely an electrode fault or water pooling on the probe head.`)
      );
      i = j + 1;
    }
  }

  // ── 5. EWMA change-point (level shifts) on the cleaned series
  if (o.metric !== "tide_level_m" && o.metric !== "battery_pct" && o.metric !== "rssi_dbm" && o.metric !== "snr_db") {
    const fast = ewma(cs, 30 * 60_000);
    const slow = ewma(cs, 18 * H);
    // judge the fast/slow gap against its own typical size, so periodic signals
    // (tides, diurnal cycles) do not read as change-points
    const gap = fast.map((v, i) => v - slow[i]!);
    const sig = Math.max(1.4826 * mad(gap), sigma, floor * 5);
    const k = 5;
    // change-points inside, or in the 18 h recession after, an explained event are part of that event
    const covered = (t: number) => out.some((a) => (a.kind === "rapid_rise" || a.kind === "ec_surge" || a.kind === "flatline") && t >= a.start && t <= a.end + (a.kind === "flatline" ? 0 : 18 * H));
    for (let i = 12; i < cs.length; ) {
      const g = (fast[i]! - slow[i]!) / sig;
      if (Math.abs(g) < k || covered(cs[i]!.t)) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < cs.length && Math.sign((fast[j + 1]! - slow[j + 1]!) / sig) === Math.sign(g) && Math.abs((fast[j + 1]! - slow[j + 1]!) / sig) >= k * 0.5) j++;
      if (j - i + 1 >= 3) {
        const up = g > 0;
        out.push(mk(o, "level_shift", "suspect", "info", cs[i]!.t, cs[j]!.t, cs[j]!.v, slow[i]!, g, `${up ? "Step up" : "Step down"} in ${label}`, `${meta.label} moved from about ${fmt(o.metric, slow[i]!)} to ${fmt(o.metric, cs[j]!.v)} and stayed there (EWMA change-point, ${Math.abs(g).toFixed(1)}σ). ${o.metric === "soil_moisture" ? (up ? "Usually rain or irrigation." : "Usually drying or drainage.") : "Worth a look if nothing on site explains it."}`));
      }
      i = j + 1;
    }
  }

  return out.sort((a, b) => b.start - a.start);
}
