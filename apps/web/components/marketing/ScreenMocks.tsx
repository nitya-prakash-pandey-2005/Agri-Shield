"use client";

/**
 * Faithful miniatures of the workspace screens, drawn with HTML/SVG (no
 * screenshots) and fed with this hour's district risk from the public API.
 * District values are live; asset names/rows are illustrative stand-ins for a
 * customer's own portfolio, and each frame says so.
 */
import { motion } from "framer-motion";
import { Bell, Bot, Check, Compass, HandHeart, Landmark, Layers, Search, ShieldCheck, Smartphone, Truck, Building2, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { riskColor } from "@/components/hud";
import type { ScreenKind } from "./industries";

type District = { id: string; name: string; country: string; countryCode: string; lat: number; lon: number; floodRisk: number; salinityRisk: number; floodProb72h: number; ecCurrent: number; rainfall72hMm: number; liveSource: string };

const FALLBACK: District[] = [
  { id: "f1", name: "Barisal", country: "Bangladesh", countryCode: "BD", lat: 22.7, lon: 90.35, floodRisk: 62, salinityRisk: 48, floodProb72h: 0.62, ecCurrent: 4.1, rainfall72hMm: 96, liveSource: "seed" },
  { id: "f2", name: "Satkhira", country: "Bangladesh", countryCode: "BD", lat: 22.7, lon: 89.07, floodRisk: 44, salinityRisk: 71, floodProb72h: 0.44, ecCurrent: 6.2, rainfall72hMm: 58, liveSource: "seed" },
  { id: "f3", name: "Bến Tre", country: "Vietnam", countryCode: "VN", lat: 10.24, lon: 106.37, floodRisk: 31, salinityRisk: 66, floodProb72h: 0.31, ecCurrent: 5.4, rainfall72hMm: 22, liveSource: "seed" },
  { id: "f4", name: "Kendrapara", country: "India", countryCode: "IN", lat: 20.5, lon: 86.42, floodRisk: 55, salinityRisk: 39, floodProb72h: 0.55, ecCurrent: 3.2, rainfall72hMm: 84, liveSource: "seed" },
  { id: "f5", name: "Pampanga", country: "Philippines", countryCode: "PH", lat: 15.05, lon: 120.66, floodRisk: 48, salinityRisk: 18, floodProb72h: 0.48, ecCurrent: 1.4, rainfall72hMm: 71, liveSource: "seed" },
  { id: "f6", name: "Demak", country: "Indonesia", countryCode: "ID", lat: -6.89, lon: 110.64, floodRisk: 29, salinityRisk: 52, floodProb72h: 0.29, ecCurrent: 3.9, rainfall72hMm: 35, liveSource: "seed" },
];

export type FeedMode = "live" | "baseline" | "sample";
const MODE_LABEL: Record<FeedMode, string> = { live: "● LIVE DATA", baseline: "○ MODEL BASELINE", sample: "○ SAMPLE DATA" };

export function useLiveDistricts() {
  const q = trpc.public.riskMap.useQuery(undefined, { staleTime: 5 * 60_000 });
  const list = (q.data as District[] | undefined) ?? [];
  const live = list.length > 0;
  const sorted = [...(live ? list : FALLBACK)].sort((a, b) => Math.max(b.floodRisk, b.salinityRisk) - Math.max(a.floodRisk, a.salinityRisk));
  const mode: FeedMode = !live ? "sample" : list.some((d) => d.liveSource === "open-meteo") ? "live" : "baseline";
  return { districts: sorted, mode };
}

const score = (d: District) => Math.round(Math.min(100, Math.max(d.floodRisk, d.salinityRisk * 0.9) + 0.25 * Math.min(d.floodRisk, d.salinityRisk * 0.9)));
const driver = (d: District) => (d.floodRisk >= d.salinityRisk ? `Rain ${Math.round(d.rainfall72hMm)} mm / 72 h` : `Salinity ${d.ecCurrent.toFixed(1)} dS/m`);

const ICON: Record<ScreenKind, { icon: LucideIcon; path: string }> = {
  portfolio: { icon: Layers, path: "/app/portfolio" },
  explorer: { icon: Compass, path: "/app/explorer" },
  rules: { icon: Bell, path: "/app/alerts" },
  insurance: { icon: ShieldCheck, path: "/app/insurance" },
  finance: { icon: Landmark, path: "/app/finance" },
  anticipatory: { icon: HandHeart, path: "/app/anticipatory" },
  copilot: { icon: Bot, path: "/app/copilot" },
  farmer: { icon: Smartphone, path: "/dashboard/farmer" },
  supply: { icon: Truck, path: "/dashboard/supply-chain" },
  government: { icon: Building2, path: "/dashboard/government" },
};

export function ScreenFrame({ kind, caption, mode, children }: { kind: ScreenKind; caption: string; mode: FeedMode; children: ReactNode }) {
  const { icon: Icon, path } = ICON[kind];
  return (
    <motion.figure initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.5 }} className="overflow-hidden rounded-2xl border border-white/10 bg-[#07101f] shadow-[0_30px_80px_-40px_rgba(56,189,248,0.35)]">
      <div className="flex items-center gap-2 border-b border-white/[0.06] bg-white/[0.02] px-3 py-2">
        <span className="flex gap-1" aria-hidden>
          <i className="h-2 w-2 rounded-full bg-rose-400/60" />
          <i className="h-2 w-2 rounded-full bg-amber-400/60" />
          <i className="h-2 w-2 rounded-full bg-emerald-400/60" />
        </span>
        <span className="telemetry ml-2 flex min-w-0 items-center gap-1.5 truncate rounded-md bg-black/30 px-2 py-0.5 text-[10px] text-slate-400">
          <Icon size={11} aria-hidden /> agrishield.io{path}
        </span>
        <span className={`telemetry ml-auto shrink-0 text-[9px] ${mode === "live" ? "text-emerald-300" : "text-slate-500"}`}>{MODE_LABEL[mode]}</span>
      </div>
      <div className="p-3 sm:p-4">{children}</div>
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] px-3 py-2 text-[11px] text-slate-400">
        <span className="text-slate-300">{caption}</span>
        <span className="text-slate-500">{mode === "sample" ? "Illustration · sample values" : "Illustration · district values from the platform, rows illustrative"}</span>
      </figcaption>
    </motion.figure>
  );
}

function Bar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
      <motion.div initial={{ width: 0 }} whileInView={{ width: `${Math.min(100, (value / max) * 100)}%` }} viewport={{ once: true }} transition={{ duration: 0.8 }} className="h-full rounded-full" style={{ background: color }} />
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="telemetry mt-0.5 text-sm font-semibold" style={{ color: tone ?? "#f1f5f9" }}>
        {value}
      </div>
    </div>
  );
}

function MiniMap({ districts }: { districts: District[] }) {
  // equirectangular over South & South-East Asia
  const x = (lon: number) => ((lon - 80) / (125 - 80)) * 100;
  const y = (lat: number) => ((26 - lat) / (26 + 9)) * 100;
  return (
    <svg viewBox="0 0 100 60" className="h-full w-full" aria-hidden>
      <rect width="100" height="60" fill="#050b16" />
      {Array.from({ length: 6 }).map((_, i) => (
        <line key={i} x1={0} x2={100} y1={i * 12} y2={i * 12} stroke="rgba(148,163,184,0.06)" strokeWidth="0.3" />
      ))}
      {districts.map((d) => {
        const c = riskColor(score(d));
        const cx = x(d.lon);
        const cy = y(d.lat) * 0.6;
        return (
          <g key={d.id}>
            <circle cx={cx} cy={cy} r={2.8} fill={c} opacity={0.18} />
            <circle cx={cx} cy={cy} r={1} fill={c} />
          </g>
        );
      })}
    </svg>
  );
}

// ─── Screens ───────────────────────────────────────────────────────────────

function Portfolio({ ds }: { ds: District[] }) {
  const top = ds.slice(0, 5);
  const atRisk = ds.filter((d) => score(d) >= 60).length;
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-3 gap-2">
        <Kpi label="Assets" value="140" />
        <Kpi label="Districts high+" value={`${atRisk}/${ds.length}`} tone="#f87171" />
        <Kpi label="Top risk" value={`${score(top[0]!)}/100`} tone={riskColor(score(top[0]!))} />
      </div>
      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
        <table className="w-full text-left text-[10.5px]">
          <thead className="text-slate-500">
            <tr>
              <th className="pb-1 font-normal">Asset</th>
              <th className="pb-1 font-normal">Risk</th>
              <th className="hidden pb-1 font-normal sm:table-cell">Driver</th>
            </tr>
          </thead>
          <tbody>
            {top.map((d, i) => (
              <tr key={d.id} className="border-t border-white/[0.05]">
                <td className="py-1.5 pr-2 text-slate-200">
                  {d.name} plot {String(12 + i * 17).padStart(3, "0")}
                  <div className="text-[9px] text-slate-500">{d.country}</div>
                </td>
                <td className="py-1.5 pr-2">
                  <span className="telemetry rounded px-1.5 py-0.5 text-[10px] font-semibold text-slate-950" style={{ background: riskColor(score(d)) }}>
                    {score(d)}
                  </span>
                </td>
                <td className="hidden py-1.5 text-slate-400 sm:table-cell">{driver(d)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="aspect-[5/3] overflow-hidden rounded-lg border border-white/[0.06] sm:aspect-auto">
          <MiniMap districts={ds} />
        </div>
      </div>
    </div>
  );
}

function Explorer({ ds }: { ds: District[] }) {
  const d = ds[0]!;
  const s = score(d);
  const hz = [
    { k: "Flood", v: d.floodRisk, c: "#38bdf8" },
    { k: "Salinity", v: d.salinityRisk, c: "#fbbf24" },
    { k: "Drought", v: Math.max(5, 40 - d.rainfall72hMm / 4), c: "#fb923c" },
    { k: "Heat", v: 18, c: "#f87171" },
  ];
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-[11px] text-slate-300">
        <Search size={12} className="text-slate-500" aria-hidden /> {d.name}, {d.country}
        <span className="telemetry ml-auto text-[9px] text-slate-500">
          {d.lat.toFixed(2)}, {d.lon.toFixed(2)}
        </span>
      </div>
      <div className="grid grid-cols-[auto_1fr] items-center gap-4">
        <div className="relative grid h-20 w-20 place-items-center rounded-full" style={{ background: `conic-gradient(${riskColor(s)} ${s * 3.6}deg, rgba(148,163,184,0.12) 0)` }}>
          <div className="grid h-16 w-16 place-items-center rounded-full bg-[#07101f]">
            <span className="telemetry text-lg font-semibold text-white">{s}</span>
          </div>
        </div>
        <div className="space-y-1.5">
          {hz.map((h) => (
            <div key={h.k} className="grid grid-cols-[52px_1fr_24px] items-center gap-2 text-[10px] text-slate-400">
              {h.k}
              <Bar value={h.v} color={h.c} />
              <span className="telemetry text-right text-slate-300">{Math.round(h.v)}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="rounded-lg border-l-2 bg-white/[0.03] px-2.5 py-2 text-[10.5px] leading-snug text-slate-300" style={{ borderColor: riskColor(s) }}>
        <b className="text-white">What this means:</b> {driver(d)} expected. {s >= 60 ? "Drain low fields and move stored inputs above flood level." : "No urgent action; keep watching the 72-hour outlook."}
      </p>
    </div>
  );
}

function Rules({ ds }: { ds: District[] }) {
  const above = ds.filter((d) => d.rainfall72hMm >= 60).length;
  const chip = (t: string, tone = "text-sky-200 border-sky-400/30 bg-sky-400/10") => <span className={`rounded-md border px-1.5 py-0.5 ${tone}`}>{t}</span>;
  return (
    <div className="space-y-2.5 text-[11px] text-slate-300">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-white">Parametric trigger watch — heavy rain</span>
        <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[9px] text-emerald-300">Enabled</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2">
        <span className="text-slate-500">IF</span> {chip("72 h rainfall")} {chip("≥")} {chip("120 mm")}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2">
        <span className="text-slate-500">ON</span> {chip("tag: parametric", "text-amber-200 border-amber-400/30 bg-amber-400/10")}
        <span className="text-slate-500">THEN</span> {["App", "Email", "SMS"].map((c) => <span key={c}>{chip(c, "text-emerald-200 border-emerald-400/30 bg-emerald-400/10")}</span>)}
      </div>
      <div className="flex items-center justify-between rounded-lg bg-black/20 px-2 py-1.5 text-[10px] text-slate-400">
        <span>Live preview: {above} monitored district{above === 1 ? "" : "s"} forecast ≥ 60 mm / 72 h</span>
        <span className="text-slate-500">cooldown 12 h</span>
      </div>
    </div>
  );
}

function Insurance({ ds }: { ds: District[] }) {
  const rows = [...ds].sort((a, b) => b.rainfall72hMm - a.rainfall72hMm).slice(0, 4);
  const trigger = 150;
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-3 gap-2">
        <Kpi label="Policies" value="140" />
        <Kpi label="Trigger" value="150 mm" />
        <Kpi label="Nearest" value={`${Math.round((rows[0]!.rainfall72hMm / trigger) * 100)}%`} tone={riskColor((rows[0]!.rainfall72hMm / trigger) * 100)} />
      </div>
      {rows.map((d) => {
        const pct = (d.rainfall72hMm / trigger) * 100;
        return (
          <div key={d.id} className="text-[10.5px]">
            <div className="flex justify-between text-slate-300">
              <span>{d.name} · weather-index cover</span>
              <span className="telemetry text-slate-400">{Math.round(d.rainfall72hMm)} / {trigger} mm</span>
            </div>
            <div className="mt-1">
              <Bar value={pct} color={riskColor(pct)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Finance({ ds }: { ds: District[] }) {
  const rows = ds.slice(0, 4);
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-3 gap-2">
        <Kpi label="Loans" value="160" />
        <Kpi label="Climate EL" value="1.8%" tone="#fbbf24" />
        <Kpi label="Watch-list" value={`${rows.filter((d) => score(d) >= 50).length + 7}`} tone="#f87171" />
      </div>
      <table className="w-full text-left text-[10.5px]">
        <thead className="text-slate-500">
          <tr>
            <th className="pb-1 font-normal">Borrower area</th>
            <th className="pb-1 font-normal">Hazard</th>
            <th className="pb-1 text-right font-normal">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id} className="border-t border-white/[0.05]">
              <td className="py-1.5 text-slate-200">Rice loan · {d.name}</td>
              <td className="py-1.5">
                <span className="telemetry" style={{ color: riskColor(score(d)) }}>
                  {score(d)}
                </span>{" "}
                <span className="text-slate-500">{d.floodRisk >= d.salinityRisk ? "flood" : "salinity"}</span>
              </td>
              <td className="py-1.5 text-right text-slate-400">{score(d) >= 60 ? "Call borrower" : score(d) >= 35 ? "Monitor" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Anticipatory({ ds }: { ds: District[] }) {
  const stages = [
    { k: "Monitoring", t: "< 50%", c: "#4ade80" },
    { k: "Readiness", t: "≥ 50%", c: "#fbbf24" },
    { k: "Activation", t: "≥ 70% in 72 h", c: "#f87171" },
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-1.5">
        {stages.map((s) => (
          <div key={s.k} className="rounded-lg border px-2 py-1.5 text-center" style={{ borderColor: `${s.c}55`, background: `${s.c}10` }}>
            <div className="text-[10px] font-semibold" style={{ color: s.c }}>
              {s.k}
            </div>
            <div className="telemetry text-[9px] text-slate-400">{s.t}</div>
          </div>
        ))}
      </div>
      {ds.slice(0, 4).map((d, i) => {
        const p = Math.round(d.floodProb72h * 100);
        const st = p >= 70 ? stages[2]! : p >= 50 ? stages[1]! : stages[0]!;
        return (
          <div key={d.id} className="flex items-center justify-between gap-2 border-t border-white/[0.05] pt-1.5 text-[10.5px]">
            <span className="truncate text-slate-200">
              {d.name} ward {i + 3} <span className="text-slate-500">· {(640 + i * 215).toLocaleString()} households</span>
            </span>
            <span className="telemetry shrink-0" style={{ color: st.c }}>
              {p}% · {st.k}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Copilot({ ds }: { ds: District[] }) {
  const top = ds.slice(0, 3);
  return (
    <div className="space-y-2.5 text-[11px]">
      <div className="ml-auto max-w-[85%] rounded-xl rounded-br-sm bg-sky-500/15 px-3 py-2 text-sky-50">Which of my assets face the highest risk this week, and why?</div>
      <div className="max-w-[92%] rounded-xl rounded-bl-sm border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-slate-300">
        <p>
          <b className="text-white">{top.length} areas stand out.</b> {top[0]!.name} is highest at <span className="telemetry text-white">{score(top[0]!)}/100</span>, driven by {driver(top[0]!).toLowerCase()}.
        </p>
        <ul className="mt-1.5 space-y-0.5">
          {top.map((d) => (
            <li key={d.id} className="flex justify-between gap-2">
              <span>{d.name}</span>
              <span className="telemetry" style={{ color: riskColor(score(d)) }}>
                {score(d)} · {driver(d)}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-[9.5px] text-slate-500">Sources: Open-Meteo forecast · Copilot answers only from your workspace data</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {["Create alert rule", "Open in Explorer", "Export CSV"].map((a) => (
          <span key={a} className="rounded-md border border-white/10 px-2 py-1 text-[10px] text-slate-300">
            {a}
          </span>
        ))}
      </div>
    </div>
  );
}

function Farmer({ ds }: { ds: District[] }) {
  const d = ds[0]!;
  const p = Math.round(d.floodProb72h * 100);
  const c = riskColor(p);
  return (
    <div className="mx-auto w-[200px] rounded-[26px] border border-white/10 bg-[#050b16] p-3">
      <div className="flex items-center justify-between text-[9px] text-slate-500">
        <span>{d.name} · North Paddy</span>
        <span className="telemetry">72h</span>
      </div>
      <div className="mx-auto mt-2 grid h-20 w-20 place-items-center rounded-full" style={{ background: `conic-gradient(${c} ${p * 3.6}deg, rgba(148,163,184,0.12) 0)` }}>
        <div className="grid h-16 w-16 place-items-center rounded-full bg-[#050b16]">
          <span className="telemetry text-base font-semibold text-white">{p}%</span>
        </div>
      </div>
      <div className="mt-1 text-center text-[9px] text-slate-400">flood probability</div>
      <div className="mt-2 rounded-lg border-l-2 bg-white/[0.04] p-2" style={{ borderColor: c }}>
        <div className="text-[10px] font-semibold text-white">{p >= 60 ? "Drain seedbeds today" : p >= 35 ? "Clear field drains this week" : "No flood action needed"}</div>
        <div className="text-[9px] text-slate-400">{Math.round(d.rainfall72hMm)} mm rain expected in 72 h</div>
      </div>
      <div className="mt-2 flex items-center gap-1 text-[9px] text-emerald-300">
        <Check size={10} aria-hidden /> Also sent by SMS
      </div>
    </div>
  );
}

function Supply({ ds }: { ds: District[] }) {
  const nodes = ds.slice(0, 5).map((d, i) => ({ d, x: 12 + i * 19, y: i % 2 ? 22 : 12 }));
  return (
    <div className="space-y-2">
      <svg viewBox="0 0 100 34" className="w-full" aria-hidden>
        {nodes.slice(1).map((n, i) => (
          <line key={n.d.id} x1={nodes[i]!.x} y1={nodes[i]!.y} x2={n.x} y2={n.y} stroke="rgba(148,163,184,0.35)" strokeWidth="0.5" className="site-flow" />
        ))}
        {nodes.map((n, i) => (
          <g key={n.d.id}>
            <rect x={n.x - 3} y={n.y - 3} width={6} height={6} rx={1.2} fill={riskColor(score(n.d))} opacity={0.9} />
            <text x={n.x} y={n.y + 8} textAnchor="middle" fontSize="2.6" fill="#94a3b8">
              {["Farm gate", "Mill", "Warehouse", "Port", "Retail"][i]}
            </text>
          </g>
        ))}
      </svg>
      {nodes.slice(0, 3).map((n, i) => (
        <div key={n.d.id} className="flex justify-between border-t border-white/[0.05] pt-1 text-[10.5px]">
          <span className="text-slate-200">
            {["Rice mill", "Warehouse", "River port"][i]} · {n.d.name}
          </span>
          <span className="telemetry" style={{ color: riskColor(score(n.d)) }}>
            {score(n.d)} · {driver(n.d)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Government({ ds }: { ds: District[] }) {
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-3 gap-2">
        <Kpi label="Districts" value={String(ds.length)} />
        <Kpi label="High+" value={String(ds.filter((d) => score(d) >= 60).length)} tone="#f87171" />
        <Kpi label="Alerts ready" value="SMS · App" />
      </div>
      {ds.slice(0, 5).map((d, i) => (
        <div key={d.id} className="grid grid-cols-[14px_1fr_60px_28px] items-center gap-2 text-[10.5px]">
          <span className="telemetry text-slate-500">{i + 1}</span>
          <span className="truncate text-slate-200">
            {d.name} <span className="text-slate-500">{d.countryCode}</span>
          </span>
          <Bar value={score(d)} color={riskColor(score(d))} />
          <span className="telemetry text-right text-slate-300">{score(d)}</span>
        </div>
      ))}
    </div>
  );
}

const SCREENS: Record<ScreenKind, (p: { ds: District[] }) => ReactNode> = {
  portfolio: Portfolio,
  explorer: Explorer,
  rules: Rules,
  insurance: Insurance,
  finance: Finance,
  anticipatory: Anticipatory,
  copilot: Copilot,
  farmer: Farmer,
  supply: Supply,
  government: Government,
};

export function ScreenMock({ kind, caption }: { kind: ScreenKind; caption: string }) {
  const { districts, mode } = useLiveDistricts();
  const S = SCREENS[kind];
  return (
    <ScreenFrame kind={kind} caption={caption} mode={mode}>
      <S ds={districts} />
    </ScreenFrame>
  );
}
