"use client";

/** Yield Forecast — per-asset table with filters, sorting and CSV export. */
import { useMemo, useState } from "react";
import { ArrowDownUp, Download, Search, Wheat } from "lucide-react";
import { EmptyState, Panel } from "@/components/hud";
import { Btn, downloadFile, inputCls, num, Select, toCsv, usd } from "@/components/insurance/kit";
import { driverSentence, VsNormal } from "./charts";
import type { YieldBookT } from "./Overview";

type SortKey = "name" | "yield" | "vs" | "production" | "value" | "risk";

export function yieldCsv(book: YieldBookT) {
  return toCsv(
    book.assets.map((a) => ({
      id: a.id,
      name: a.name,
      external_ref: a.externalRef,
      type: a.type,
      crop: a.crop,
      district: a.district,
      country: a.country,
      lat: a.lat,
      lon: a.lon,
      area_ha: a.areaHa,
      season: a.forecast.season.name,
      stage: a.forecast.season.stage,
      yield_p10_t_ha: a.forecast.yieldTHa.p10,
      yield_p50_t_ha: a.forecast.yieldTHa.p50,
      yield_p90_t_ha: a.forecast.yieldTHa.p90,
      normal_t_ha: a.forecast.baseline.normalTHa,
      vs_normal_pct: a.forecast.vsNormalPct,
      prob_below_normal_pct: a.forecast.probBelowNormalPct,
      production_p50_t: a.productionT.p50,
      price_usd_t: a.priceUsdT,
      value_usd: a.grossValueUsd,
      driver_water_pct: a.forecast.drivers.find((d) => d.key === "water")?.pct,
      driver_heat_pct: a.forecast.drivers.find((d) => d.key === "heat")?.pct,
      driver_flood_pct: a.forecast.drivers.find((d) => d.key === "flood")?.pct,
      driver_salinity_pct: a.forecast.drivers.find((d) => d.key === "salinity")?.pct,
      driver_ndvi_pct: a.forecast.drivers.find((d) => d.key === "ndvi")?.pct,
      irrigation: a.forecast.irrigation.label,
      weather_source: a.forecast.weather.source,
      expected_payout_usd: a.outlook.insurer?.expectedPayoutUsd ?? "",
      repayment_cover_p50: a.outlook.bank?.coverP50 ?? "",
      repayment_cover_p10: a.outlook.bank?.coverP10 ?? "",
    }))
  );
}

export default function Assets({ book, onOpen, onExport }: { book: YieldBookT; onOpen: (id: string) => void; onExport: () => void }) {
  const [q, setQ] = useState("");
  const [crop, setCrop] = useState("all");
  const [district, setDistrict] = useState("all");
  const [below, setBelow] = useState(false);
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: "vs", dir: 1 });
  const crops = useMemo(() => [...new Set(book.assets.map((a) => a.crop))].sort(), [book]);
  const districts = useMemo(() => [...new Map(book.assets.filter((a) => a.districtId).map((a) => [a.districtId!, a.district!])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [book]);
  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const f = book.assets.filter((a) => (crop === "all" || a.crop === crop) && (district === "all" || a.districtId === district) && (!below || a.forecast.vsNormalPct < -5) && (!ql || `${a.name} ${a.externalRef ?? ""} ${a.district ?? ""}`.toLowerCase().includes(ql)));
    const val = (a: (typeof f)[number]): number | string => {
      switch (sort.k) {
        case "name":
          return a.name;
        case "yield":
          return a.forecast.yieldTHa.p50;
        case "vs":
          return a.forecast.vsNormalPct;
        case "production":
          return a.productionT.p50;
        case "value":
          return a.grossValueUsd;
        case "risk":
          return a.outlook.insurer ? -a.outlook.insurer.expectedPayoutUsd : a.outlook.bank ? a.outlook.bank.coverP10 : a.forecast.probBelowNormalPct * -1;
      }
    };
    return [...f].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number)) * sort.dir;
    });
  }, [book, q, crop, district, below, sort]);
  const industryCol = book.outlook.insurer ? "Exp. payout" : book.outlook.bank ? "Cover P10/P50" : "P(below normal)";
  const th = (k: SortKey, label: string, right = true) => (
    <th className={`py-1.5 font-medium ${right ? "text-right" : "text-left"}`}>
      <button className="inline-flex items-center gap-1 hover:text-slate-200" onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : k === "name" ? 1 : -1 }))}>
        {label}
        {sort.k === k && <ArrowDownUp size={10} />}
      </button>
    </th>
  );
  if (!book.assets.length)
    return (
      <EmptyState icon={Wheat} title="No crop assets in this workspace">
        Yield forecasts are made for insured plots, loans and farms that record a crop and an area (ha). Add or import them in Portfolio — district forecasts are on the Overview and Districts tabs meanwhile.
        {book.skipped.length > 0 && <div className="mt-2 text-[12px] text-slate-500">{book.skipped.length} asset(s) skipped: {book.skipped.slice(0, 3).map((s) => `${s.name} (${s.reason})`).join("; ")}</div>}
      </EmptyState>
    );
  return (
    <Panel title={`Crop assets · ${rows.length} of ${book.assets.length}`} subtitle="Click a row for the drivers waterfall, week-by-week evolution, NDVI and flood evidence" icon={Wheat} accent="green" bodyClassName="px-0 pb-2" actions={
      <Btn variant="outline" onClick={() => (downloadFile(`yield-forecast-${book.asOf}.csv`, yieldCsv(book)), onExport())}>
        <Download size={13} /> CSV
      </Btn>
    }>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
        <div className="relative min-w-[180px] flex-1">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input className={`${inputCls} pl-8`} placeholder="Search name, reference, district…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search assets" />
        </div>
        <Select ariaLabel="Crop" className="w-36" value={crop} onChange={setCrop} options={[{ value: "all", label: "All crops" }, ...crops.map((c) => ({ value: c, label: c }))]} />
        <Select ariaLabel="District" className="w-40" value={district} onChange={setDistrict} options={[{ value: "all", label: "All districts" }, ...districts.map(([id, n]) => ({ value: id, label: n }))]} />
        <label className="flex items-center gap-1.5 text-[12px] text-slate-400">
          <input type="checkbox" checked={below} onChange={(e) => setBelow(e.target.checked)} className="accent-cyan-400" /> &gt; 5 % below normal
        </label>
      </div>
      <div className="max-h-[640px] overflow-auto">
        <table className="w-full min-w-[900px] text-[12.5px]">
          <thead className="sticky top-0 z-10 bg-[#070d1c] text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-1.5 text-left font-medium">
                <button className="inline-flex items-center gap-1 hover:text-slate-200" onClick={() => setSort((s) => ({ k: "name", dir: s.k === "name" ? (s.dir === 1 ? -1 : 1) : 1 }))}>
                  Asset {sort.k === "name" && <ArrowDownUp size={10} />}
                </button>
              </th>
              <th className="py-1.5 text-left font-medium">Crop · stage</th>
              {th("yield", "t/ha P10–P90")}
              {th("vs", "vs normal")}
              {th("production", "Production")}
              {th("value", "Value")}
              <th className="py-1.5 pl-3 text-left font-medium">Main signals</th>
              {th("risk", industryCol)}
              <th className="w-4" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {rows.map((a) => (
              <tr key={a.id} className="cursor-pointer hover:bg-white/[0.03]" onClick={() => onOpen(a.id)}>
                <td className="max-w-[240px] px-4 py-1.5">
                  <div className="truncate text-slate-200">{a.name}</div>
                  <div className="truncate text-[11px] text-slate-500">
                    {a.district ?? a.country} · {num(a.areaHa, a.areaHa < 10 ? 2 : 0)} ha · {a.forecast.irrigation.label}
                  </div>
                </td>
                <td className="py-1.5 text-slate-400">
                  <div className="capitalize">{a.crop} · {a.forecast.season.name}</div>
                  <div className="text-[11px] text-slate-500">{a.forecast.season.stage}</div>
                </td>
                <td className="py-1.5 text-right telemetry">
                  <span className="text-slate-100">{a.forecast.yieldTHa.p50.toFixed(2)}</span>
                  <div className="text-[11px] text-slate-500">
                    {a.forecast.yieldTHa.p10.toFixed(2)}–{a.forecast.yieldTHa.p90.toFixed(2)}
                  </div>
                </td>
                <td className="py-1.5 text-right">
                  <VsNormal pct={a.forecast.vsNormalPct} />
                </td>
                <td className="py-1.5 text-right telemetry text-slate-300">{num(a.productionT.p50, a.productionT.p50 < 10 ? 1 : 0)} t</td>
                <td className="py-1.5 text-right telemetry text-slate-300">{usd(a.grossValueUsd)}</td>
                <td className="max-w-[260px] truncate py-1.5 pl-3 text-[11.5px] text-slate-400" title={driverSentence(a.forecast.drivers)}>
                  {driverSentence(a.forecast.drivers, 1)}
                </td>
                <td className="py-1.5 text-right telemetry">
                  {a.outlook.insurer ? (
                    <span className={a.outlook.insurer.expectedPayoutUsd > 0 ? "text-amber-200" : "text-slate-500"}>{usd(a.outlook.insurer.expectedPayoutUsd)}</span>
                  ) : a.outlook.bank ? (
                    <span className={a.outlook.bank.flag === "stress" ? "text-rose-300" : a.outlook.bank.flag === "watch" ? "text-amber-200" : "text-emerald-300"}>
                      {a.outlook.bank.coverP10.toFixed(1)}× / {a.outlook.bank.coverP50.toFixed(1)}×
                    </span>
                  ) : (
                    <span className="text-slate-300">{a.forecast.probBelowNormalPct} %</span>
                  )}
                </td>
                <td />
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="px-4 py-6 text-center text-[13px] text-slate-500">No assets match these filters.</div>}
      </div>
    </Panel>
  );
}
