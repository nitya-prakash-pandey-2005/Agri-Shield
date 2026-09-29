"use client";

/**
 * Yield Forecast — portfolio overview: KPIs, industry "what it means", drivers
 * waterfall, week-by-week forecast evolution, map and breakdowns.
 */
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { BarChart3, Building2, Coins, Landmark, LineChart, Map as MapIcon, ShieldCheck, Sprout, Wheat } from "lucide-react";
import { Panel, Skeleton, SourceTag } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { Kpi, num, pct, usd, WhatThisMeans } from "@/components/insurance/kit";
import type { RouterOutputs } from "@/lib/trpc";
import { driverSentence, EvolutionChart, VsNormal, vsColor, Waterfall } from "./charts";

const LocationMap = dynamic(() => import("@/components/insurance/LocationMap"), { ssr: false, loading: () => <Skeleton className="h-[340px]" /> });

export type YieldBookT = RouterOutputs["sustainability"]["yield"]["book"];

export function industryMeaning(b: YieldBookT): { title: string; body: string; tone: "sky" | "amber" | "rose" | "emerald" } {
  const t = b.totals;
  const drivers = driverSentence(b.drivers);
  const tone = t.vsNormalPct <= -10 ? "rose" : t.vsNormalPct <= -3 ? "amber" : "emerald";
  const base = `Your ${t.assets} crop assets (${num(t.areaHa, 0)} ha) are on track for ${num(t.productionT.p50)} t this season — ${t.vsNormalPct >= 0 ? "+" : "−"}${Math.abs(t.vsNormalPct).toFixed(1)} % vs the 5-year normal (80 % range ${num(t.productionT.p10)}–${num(t.productionT.p90)} t). Main signals: ${drivers}.`;
  if (b.outlook.insurer) {
    const o = b.outlook.insurer;
    return {
      title: "For your insurance book",
      tone,
      body: `${base} Area-yield index units (${o.areaYieldUnits}) have an expected payout of ${usd(o.areaYieldExpectedPayoutUsd)} against ${usd(o.areaYieldPremiumUsd)} premium${o.expectedLossRatioPct != null ? ` — an expected loss ratio of ${o.expectedLossRatioPct.toFixed(0)} %` : ""}. ${o.unitsLikelyToPay} unit(s) have a ≥ 50 % chance of triggering at the 80 % threshold yield; reserve and reinsurance notices should start there.`,
    };
  }
  if (b.outlook.bank) {
    const o = b.outlook.bank;
    return {
      title: "For your loan book",
      tone: o.stress > o.loans * 0.25 ? "rose" : tone,
      body: `${base} Crop revenue covers this season's debt service ${o.medianCoverP50.toFixed(1)}× for the median borrower. ${o.stress} loan(s) (${usd(o.outstandingStressUsd)} outstanding) would not cover it in a bad (P10) outcome and ${o.watch} are on watch — candidates for rescheduling, input-credit top-ups or insurance before harvest.`,
    };
  }
  if (b.industry === "cooperative")
    return { title: "For your co-operative", tone, body: `${base} Plan procurement, storage and buyer contracts for about ${num(t.productionT.p50)} t, and keep a fallback for the P10 case of ${num(t.productionT.p10)} t (${num(t.productionT.p50 - t.productionT.p10)} t less).` };
  const src = b.outlook.sourcing.byDistrict;
  const tot = src.reduce((a, d) => ({ p10: a.p10 + d.p10, p50: a.p50 + d.p50, normal: a.normal + d.normal }), { p10: 0, p50: 0, normal: 0 });
  if (b.industry === "agribusiness")
    return { title: "For your sourcing", tone: tot.p50 < tot.normal * 0.95 ? "amber" : "emerald", body: `Your sourcing catchments (${src.length} districts) are forecast to harvest ${num(tot.p50)} t of their main crop (P10 ${num(tot.p10)} t) vs a normal ${num(tot.normal)} t. Lock in volumes early where the forecast is below normal and diversify origin where the P10 gap is largest.` };
  return { title: "For food security planning", tone: tot.p50 < tot.normal * 0.95 ? "amber" : "emerald", body: `Monitored districts are forecast to harvest ${num(tot.p50)} t of their main crop (P10 ${num(tot.p10)} t) vs a normal ${num(tot.normal)} t. Districts well below normal are candidates for early procurement, safety-net scale-up and seed support for the next season.` };
}

export default function Overview({ book, onOpenAsset, onOpenDistrict }: { book: YieldBookT; onOpenAsset: (id: string) => void; onOpenDistrict: (id: string) => void }) {
  const t = book.totals;
  const hasAssets = book.assets.length > 0;
  const meaning = industryMeaning(book);
  const [layer, setLayer] = useState<"assets" | "districts">(hasAssets ? "assets" : "districts");
  const normalByWeek = t.normalProductionT;
  const dots = useMemo(() => {
    if (layer === "assets") {
      const max = Math.max(1, ...book.assets.map((a) => a.productionT.p50));
      return book.assets.map((a) => ({ id: `a:${a.id}`, lat: a.lat, lon: a.lon, color: vsColor(a.forecast.vsNormalPct), radius: 3.5 + 8 * Math.sqrt(a.productionT.p50 / max), label: `${a.name} · ${a.cropLabel} · ${a.forecast.yieldTHa.p50.toFixed(2)} t/ha (${a.forecast.vsNormalPct > 0 ? "+" : ""}${a.forecast.vsNormalPct.toFixed(1)} %)` }));
    }
    const max = Math.max(1, ...book.districts.map((d) => d.productionT.p50));
    return book.districts.map((d) => ({ id: `d:${d.districtId}`, lat: d.lat, lon: d.lon, color: vsColor(d.forecast.vsNormalPct), radius: 7 + 14 * Math.sqrt(d.productionT.p50 / max), label: `${d.name} · ${d.crop} ${d.forecast.season.name} · ${d.forecast.yieldTHa.p50.toFixed(2)} t/ha (${d.forecast.vsNormalPct > 0 ? "+" : ""}${d.forecast.vsNormalPct.toFixed(1)} %)` }));
  }, [book, layer]);

  const evoTotal = hasAssets;
  const forecastPct = t.normalProductionT ? (t.productionT.p50 / t.normalProductionT) * 100 : 100;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {hasAssets ? (
          <>
            <Kpi label={<>Expected production</>} value={`${num(t.productionT.p50)} t`} sub={`P10–P90 ${num(t.productionT.p10)}–${num(t.productionT.p90)} t`} help={<Explain term="p90" />} />
            <Kpi label="vs 5-yr normal" value={<VsNormal pct={t.vsNormalPct} />} sub={`normal ${num(t.normalProductionT)} t`} tone={t.vsNormalPct <= -10 ? "bad" : t.vsNormalPct <= -3 ? "warn" : "good"} help={<Explain text="The FAOSTAT 2020-2024 average yield for the same crop, country and season, times your area." />} />
            <Kpi label="Crop value (farm-gate)" value={usd(t.valueUsd)} sub={`normal ${usd(t.normalValueUsd)}`} />
            <Kpi label="Assets > 5 % below normal" value={`${t.belowNormalAssets} / ${t.assets}`} tone={t.belowNormalAssets > t.assets / 3 ? "bad" : t.belowNormalAssets ? "warn" : "good"} />
            <Kpi label="Weather coverage" value={`${book.coverage.cellsWithHistory}/${book.coverage.cells} cells`} sub={book.coverage.providers.join(" · ") || "climatology fallback"} help={<Explain term="era5" />} />
          </>
        ) : (
          <>
            <Kpi label="Districts forecast" value={book.districts.length} sub="main crop per district" />
            <Kpi label="Expected production" value={`${num(book.districts.reduce((a, d) => a + d.productionT.p50, 0))} t`} sub="estimated cropped area" />
            <Kpi label="Districts below normal" value={book.districts.filter((d) => d.forecast.vsNormalPct < -5).length} tone="warn" />
            <Kpi label="Crop value (farm-gate)" value={usd(book.districts.reduce((a, d) => a + d.valueUsd, 0))} />
            <Kpi label="Weather coverage" value={`${book.coverage.cellsWithHistory}/${book.coverage.cells} cells`} sub={book.coverage.providers.join(" · ") || "climatology fallback"} />
          </>
        )}
      </div>

      <WhatThisMeans tone={meaning.tone}>
        <b className="text-slate-100">{meaning.title}: </b>
        {meaning.body}
      </WhatThisMeans>

      <div className="grid gap-4 xl:grid-cols-5">
        <Panel className="xl:col-span-3" title="Map — forecast vs normal" subtitle="Colour = % vs 5-yr normal · size = expected production · click for detail" icon={MapIcon} accent="cyan" actions={
          <div className="flex rounded-lg border border-slate-800 p-0.5 text-[11.5px]">
            {hasAssets && (
              <button className={`rounded-md px-2 py-0.5 ${layer === "assets" ? "bg-cyan-400/15 text-cyan-200" : "text-slate-400"}`} onClick={() => setLayer("assets")}>
                Assets
              </button>
            )}
            <button className={`rounded-md px-2 py-0.5 ${layer === "districts" ? "bg-cyan-400/15 text-cyan-200" : "text-slate-400"}`} onClick={() => setLayer("districts")}>
              Districts
            </button>
          </div>
        }>
          <LocationMap dots={dots} fit height={340} zoom={7} onDotClick={(id) => (id.startsWith("a:") ? onOpenAsset(id.slice(2)) : onOpenDistrict(id.slice(2)))} />
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
            {[-25, -12, -5, 0, 5, 12].map((v) => (
              <span key={v} className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: vsColor(v) }} />
                {v <= -20 ? "≤ −20 %" : v <= -10 ? "−20…−10 %" : v <= -3 ? "−10…−3 %" : v < 3 ? "±3 %" : v < 10 ? "+3…+10 %" : "≥ +10 %"}
              </span>
            ))}
          </div>
        </Panel>
        <Panel className="xl:col-span-2" title={<>What moves the forecast <Explain text="Each bar multiplies the previous one: the 5-yr normal, the long-run yield trend, then this season's water stress (FAO-33 Ky), heat at flowering, floods, salinity and satellite NDVI — production-weighted across your assets." /></>} subtitle="% of the 5-yr normal, production-weighted" icon={BarChart3} accent="amber">
          {book.drivers.length ? <Waterfall drivers={book.drivers} forecastPct={forecastPct} /> : <Waterfall drivers={book.districts[0]?.forecast.drivers ?? []} />}
          <p className="mt-1 text-[12px] text-slate-400">{driverSentence(book.drivers.length ? book.drivers : book.districts[0]?.forecast.drivers ?? [])}.</p>
        </Panel>
      </div>

      {evoTotal && (
        <Panel title="How the forecast evolved, week by week" subtitle="Portfolio production (t): P50 line, P10–P90 band — each week re-run with the weather, floods and NDVI known at that date" icon={LineChart} accent="cyan">
          <EvolutionChart data={book.evolution} normal={normalByWeek} unit="t" />
          <p className="mt-1 text-[12px] text-slate-400">
            Before sowing the forecast is the trend-adjusted normal with wide bands; it narrows as observed weather replaces climatology. Latest week: <VsNormal pct={book.evolution[book.evolution.length - 1]?.vsNormalPct ?? 0} /> vs normal, {Math.round((book.evolution[book.evolution.length - 1]?.observedFrac ?? 0) * 100)} % of the season observed.
          </p>
        </Panel>
      )}

      {book.outlook.insurer && <InsurerPanel book={book} onOpen={onOpenAsset} />}
      {book.outlook.bank && <BankPanel book={book} onOpen={onOpenAsset} />}

      <div className="grid gap-4 xl:grid-cols-2">
        {hasAssets && (
          <Panel title="By crop" icon={Sprout} accent="green" bodyClassName="px-0 pb-2">
            <GroupTable rows={book.byCrop} />
          </Panel>
        )}
        {hasAssets && (
          <Panel title="By district" icon={MapIcon} accent="green" bodyClassName="px-0 pb-2">
            <GroupTable rows={book.byDistrict} onClick={(k) => k !== "other" && onOpenDistrict(k)} />
          </Panel>
        )}
      </div>

      <Panel title={book.industry === "agribusiness" ? "Sourcing volume by district" : "District outlook — main crop"} subtitle="Estimated cropped area (census farms × mean holding × crop share) × forecast yield · click for weekly evolution" icon={book.industry === "agribusiness" ? Building2 : Wheat} accent="violet" bodyClassName="px-0 pb-2">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[12.5px]">
            <thead className="text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-1.5 font-medium">District</th>
                <th className="py-1.5 font-medium">Crop · season</th>
                <th className="py-1.5 text-right font-medium">Yield P50 (t/ha)</th>
                <th className="py-1.5 text-right font-medium">vs normal</th>
                <th className="py-1.5 text-right font-medium">Production P10–P90 (t)</th>
                <th className="px-4 py-1.5 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {book.districts.map((d) => (
                <tr key={d.districtId} className="cursor-pointer hover:bg-white/[0.03]" onClick={() => onOpenDistrict(d.districtId)}>
                  <td className="px-4 py-1.5 text-slate-200">
                    {d.name} <span className="text-slate-500">{d.country}</span>
                  </td>
                  <td className="py-1.5 capitalize text-slate-400">
                    {d.crop} · {d.forecast.season.name} <span className="text-slate-600">({d.forecast.season.stage})</span>
                  </td>
                  <td className="py-1.5 text-right telemetry text-slate-100">{d.forecast.yieldTHa.p50.toFixed(2)}</td>
                  <td className="py-1.5 text-right">
                    <VsNormal pct={d.forecast.vsNormalPct} />
                  </td>
                  <td className="py-1.5 text-right telemetry text-slate-300">
                    {num(d.productionT.p10)}–{num(d.productionT.p90)}
                  </td>
                  <td className="px-4 py-1.5 text-right telemetry text-slate-300">{usd(d.valueUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="flex flex-wrap gap-2">
        <SourceTag href="https://www.fao.org/faostat/en/#data/QCL">FAOSTAT QCL yields 2015-2024</SourceTag>
        <SourceTag href="https://www.fao.org/4/i2800e/i2800e.pdf">FAO-33/66 Ky · FAO-56 Kc</SourceTag>
        <SourceTag>{book.coverage.providers.length ? `${book.coverage.providers.join(" + ")} daily weather (cached)` : "Climatology fallback"}</SourceTag>
        <SourceTag href="https://open-meteo.com/en/docs/flood-api">GloFAS v4 flood episodes 2019→</SourceTag>
        <SourceTag href="https://modis.ornl.gov/data/modis_webservice.html">MODIS NDVI / field history</SourceTag>
        <SourceTag>Generated {new Date(book.generatedAt).toLocaleString("en-GB")}</SourceTag>
      </div>
    </div>
  );
}

function GroupTable({ rows, onClick }: { rows: YieldBookT["byCrop"]; onClick?: (key: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.productionT.p90));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-[12.5px]">
        <thead className="text-left text-[11px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-1.5 font-medium">Group</th>
            <th className="py-1.5 text-right font-medium">Area</th>
            <th className="py-1.5 text-right font-medium">t/ha</th>
            <th className="py-1.5 text-right font-medium">vs normal</th>
            <th className="px-4 py-1.5 font-medium">Production P10 · P50 · P90</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60">
          {rows.map((r) => (
            <tr key={r.key} className={onClick ? "cursor-pointer hover:bg-white/[0.03]" : ""} onClick={() => onClick?.(r.key)}>
              <td className="px-4 py-1.5 text-slate-200">
                {r.label} <span className="text-slate-500">· {r.assets}</span>
              </td>
              <td className="whitespace-nowrap py-1.5 text-right telemetry text-slate-400">{num(r.areaHa, r.areaHa < 100 ? 1 : 0)} ha</td>
              <td className="py-1.5 text-right telemetry text-slate-100">{r.yieldP50.toFixed(2)}</td>
              <td className="py-1.5 text-right">
                <VsNormal pct={r.vsNormalPct} />
              </td>
              <td className="px-4 py-1.5">
                <div className="flex items-center gap-2">
                  <div className="relative h-2 w-28 shrink-0 rounded-full bg-slate-800/80">
                    <div className="absolute h-2 rounded-full bg-sky-500/35" style={{ left: `${(r.productionT.p10 / max) * 100}%`, width: `${Math.max(1, ((r.productionT.p90 - r.productionT.p10) / max) * 100)}%` }} />
                    <div className="absolute top-[-2px] h-3 w-[3px] rounded bg-sky-300" style={{ left: `${(r.productionT.p50 / max) * 100}%` }} />
                    <div className="absolute top-[-3px] h-[14px] w-px bg-amber-300/80" style={{ left: `${Math.min(100, (r.normalProductionT / max) * 100)}%` }} title="normal" />
                  </div>
                  <span className="telemetry text-[11.5px] text-slate-300">{num(r.productionT.p50)} t</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InsurerPanel({ book, onOpen }: { book: YieldBookT; onOpen: (id: string) => void }) {
  const o = book.outlook.insurer!;
  const top = [...book.assets].filter((a) => a.outlook.insurer).sort((a, b) => b.outlook.insurer!.expectedPayoutUsd - a.outlook.insurer!.expectedPayoutUsd).slice(0, 10);
  return (
    <Panel title={<>Area-yield index payout outlook <Explain term="area_yield" /></>} subtitle="Threshold yield = 80 % of the 5-yr normal; payout = shortfall ÷ threshold × sum insured" icon={ShieldCheck} accent="violet" bodyClassName="pb-2">
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Expected payout (area-yield units)" value={usd(o.areaYieldExpectedPayoutUsd)} sub={`${o.areaYieldUnits} units`} />
        <Kpi label="Expected loss ratio" value={o.expectedLossRatioPct == null ? "—" : pct(o.expectedLossRatioPct, 0)} tone={(o.expectedLossRatioPct ?? 0) > 80 ? "bad" : (o.expectedLossRatioPct ?? 0) > 50 ? "warn" : "good"} help={<Explain term="loss_ratio" />} sub={`on ${usd(o.areaYieldPremiumUsd)} premium`} />
        <Kpi label="Units ≥ 50 % likely to pay" value={o.unitsLikelyToPay} />
        <Kpi label="Whole book if area-yield indexed" value={usd(o.expectedPayoutUsd)} sub="shadow payout — basis-risk check" help={<Explain term="basis_risk" />} />
      </div>
      <div className="-mx-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-[12.5px]">
          <thead className="text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-1.5 font-medium">Unit</th>
              <th className="py-1.5 font-medium">Product</th>
              <th className="py-1.5 text-right font-medium">Yield P50 / threshold</th>
              <th className="py-1.5 text-right font-medium">P(payout)</th>
              <th className="px-4 py-1.5 text-right font-medium">Expected payout</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {top.map((a) => (
              <tr key={a.id} className="cursor-pointer hover:bg-white/[0.03]" onClick={() => onOpen(a.id)}>
                <td className="px-4 py-1.5 text-slate-200">
                  {a.name} <span className="text-slate-500">· {a.district}</span>
                </td>
                <td className="py-1.5 text-slate-400">{a.outlook.insurer!.product}</td>
                <td className="py-1.5 text-right telemetry text-slate-300">
                  {a.forecast.yieldTHa.p50.toFixed(2)} / {a.outlook.insurer!.thresholdTHa.toFixed(2)}
                </td>
                <td className="py-1.5 text-right telemetry text-amber-200">{a.outlook.insurer!.payoutProbPct} %</td>
                <td className="px-4 py-1.5 text-right telemetry text-slate-100">{usd(a.outlook.insurer!.expectedPayoutUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function BankPanel({ book, onOpen }: { book: YieldBookT; onOpen: (id: string) => void }) {
  const o = book.outlook.bank!;
  const worst = [...book.assets].filter((a) => a.outlook.bank).sort((a, b) => a.outlook.bank!.coverP10 - b.outlook.bank!.coverP10).slice(0, 10);
  return (
    <Panel title="Repayment capacity from the harvest" subtitle="Crop revenue (yield × area × farm-gate price) ÷ debt service due this season" icon={Landmark} accent="violet" bodyClassName="pb-2">
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Median cover (P50)" value={`${o.medianCoverP50.toFixed(2)}×`} tone={o.medianCoverP50 < 1.2 ? "warn" : "good"} />
        <Kpi label="Stress (P10 cover < 1)" value={`${o.stress} loans`} sub={usd(o.outstandingStressUsd)} tone={o.stress ? "bad" : "good"} />
        <Kpi label="Watch (P50 cover < 1.5)" value={`${o.watch} loans`} tone={o.watch ? "warn" : "good"} />
        <Kpi label="Outstanding" value={usd(o.outstandingUsd)} sub={`${o.loans} crop loans`} />
      </div>
      <div className="-mx-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-[12.5px]">
          <thead className="text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-1.5 font-medium">Loan</th>
              <th className="py-1.5 text-right font-medium">Debt due</th>
              <th className="py-1.5 text-right font-medium">Revenue P10 / P50</th>
              <th className="px-4 py-1.5 text-right font-medium">Cover P10 / P50</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {worst.map((a) => (
              <tr key={a.id} className="cursor-pointer hover:bg-white/[0.03]" onClick={() => onOpen(a.id)}>
                <td className="px-4 py-1.5 text-slate-200">
                  {a.name} <span className="text-slate-500">· {a.externalRef}</span>
                </td>
                <td className="py-1.5 text-right telemetry text-slate-300">{usd(a.outlook.bank!.debtServiceUsd)}</td>
                <td className="py-1.5 text-right telemetry text-slate-300">
                  {usd(a.outlook.bank!.revenueP10Usd)} / {usd(a.outlook.bank!.revenueP50Usd)}
                </td>
                <td className={`px-4 py-1.5 text-right telemetry ${a.outlook.bank!.flag === "stress" ? "text-rose-300" : a.outlook.bank!.flag === "watch" ? "text-amber-200" : "text-emerald-300"}`}>
                  {a.outlook.bank!.coverP10.toFixed(2)}× / {a.outlook.bank!.coverP50.toFixed(2)}×
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11.5px] text-slate-500">
        <Coins size={11} className="mr-1 inline" />
        Smallholder households also earn off-farm income, so a cover below 1 is a signal for a conversation, not a default prediction. See Lending &amp; Finance for climate-adjusted PD.
      </p>
    </Panel>
  );
}
