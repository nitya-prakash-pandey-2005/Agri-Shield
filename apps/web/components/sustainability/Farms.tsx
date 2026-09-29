"use client";

/**
 * Farmer-level AWD adoption tracker + per-farm/per-unit MRV table.
 * Mark adoption (single or bulk), set verification status, and record known practice
 * (water regime, pre-season, organic amendment, N rate) that feeds the IPCC factors.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Download, Pencil, Search, Sprout, XCircle } from "lucide-react";
import { EmptyState, Panel } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { Btn, downloadFile, Field, inputCls, NumInput, num, Select, toCsv } from "@/components/insurance/kit";
import { trpc } from "@/lib/trpc";
import { Drawer } from "@/components/yield/Detail";
import type { ProgrammeT } from "./Programme";

type Row = ProgrammeT["rows"][number];

const STATUS_LABEL: Record<string, string> = { self_reported: "Self-reported", field_verified: "Field-verified", remote_sensed: "Remote-sensed" };
const REGIME_LABEL: Record<string, string> = {
  continuously_flooded: "Continuously flooded (1.00)",
  single_drainage: "Single drainage (0.71)",
  multiple_drainage: "Multiple drainage / AWD (0.55)",
  regular_rainfed: "Rain-fed regular (0.54)",
  drought_prone: "Rain-fed drought-prone (0.16)",
  deep_water: "Deep water (0.06)",
  upland: "Upland (0)",
};
const PRE_LABEL: Record<string, string> = { non_flooded_lt180: "Non-flooded < 180 d (1.00)", non_flooded_gt180: "Non-flooded > 180 d (0.89)", flooded_gt30: "Flooded > 30 d (2.41)", non_flooded_gt365: "Non-flooded > 365 d (0.59)" };
const ORG_LABEL: Record<string, string> = { none: "None", straw_short: "Straw < 30 d before (CFOA 1.00)", straw_long: "Straw > 30 d before (0.19)", compost: "Compost (0.17)", fym: "Farmyard manure (0.21)", green_manure: "Green manure (0.45)" };

const m3 = (v: number) => (v >= 10_000 ? `${num(v / 1000, 1)}k m³` : `${num(v)} m³`);

export function mrvCsv(p: ProgrammeT) {
  return toCsv(
    p.rows.map((r) => ({
      id: r.id,
      name: r.name,
      external_ref: r.externalRef,
      crop: r.crop,
      district: r.district,
      country: r.country,
      lat: r.lat,
      lon: r.lon,
      area_ha: r.areaHa,
      farmers: r.farmers,
      season: r.season,
      season_days: r.seasonDays,
      irrigation: r.practice.irrigationLabel,
      awd_eligible: r.practice.eligible,
      awd_adopted: r.practice.awd,
      awd_status: r.practice.awdStatus ?? "",
      awd_since: r.practice.awdSince ?? "",
      water_regime: r.practice.regime,
      baseline_regime: r.practice.baselineRegime,
      preseason: r.practice.preseason,
      organic: r.practice.organic,
      organic_t_ha: r.practice.organicT,
      n_kg_ha: r.practice.nKgHa,
      efc_kg_ch4_ha_day: r.efc,
      baseline_tco2e_season: r.baseline.tCo2e.toFixed(3),
      actual_tco2e_season: r.actual.tCo2e.toFixed(3),
      ch4_kg: r.actual.ch4Kg.toFixed(1),
      n2o_kg: r.actual.n2oKg.toFixed(2),
      urea_co2_kg: r.actual.co2Kg.toFixed(1),
      avoided_tco2e_season: r.avoidedTCo2e,
      potential_avoided_tco2e_season: r.potentialAvoidedTCo2e,
      seasons_per_year: r.practice.seasonsPerYear,
      production_t: r.productionT,
      intensity_tco2e_per_t: r.intensity ?? "",
      water_withdrawal_m3: r.water?.withdrawalM3 ?? "",
      water_footprint_m3_t: r.water?.wfM3PerT ?? "",
      awd_water_saved_m3: r.awdWaterSavedM3,
    }))
  );
}

export default function Farms({ p, canEdit, onExport }: { p: ProgrammeT; canEdit: boolean; onExport: () => void }) {
  const utils = trpc.useUtils();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"rice" | "eligible" | "adopted" | "not_adopted" | "all">("eligible");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<Row | null>(null);
  const [bulkStatus, setBulkStatus] = useState<"self_reported" | "field_verified" | "remote_sensed">("field_verified");
  const setAdoption = trpc.sustainability.carbon.setAdoption.useMutation({
    onSuccess: (r) => {
      toast.success(`${r.changed} asset(s) updated${r.skipped.length ? ` · ${r.skipped.length} skipped (${r.skipped[0]!.reason})` : ""}`);
      setSel(new Set());
      void utils.sustainability.carbon.programme.invalidate();
      void utils.sustainability.esg.summary.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return p.rows
      .filter((r) => (filter === "all" ? true : filter === "rice" ? r.crop === "rice" : filter === "eligible" ? r.practice.eligible : filter === "adopted" ? r.practice.awd : r.practice.eligible && !r.practice.awd))
      .filter((r) => !ql || `${r.name} ${r.externalRef ?? ""} ${r.district ?? ""}`.toLowerCase().includes(ql))
      .sort((a, b) => Number(b.practice.awd) - Number(a.practice.awd) || b.potentialAvoidedTCo2e - a.potentialAvoidedTCo2e);
  }, [p.rows, q, filter]);
  const allSel = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const toggle = (id: string) => setSel((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));

  if (!p.rows.length)
    return (
      <EmptyState icon={Sprout} title="No crop assets with an area">
        MRV needs crop assets (farms, insured plots or loans) with a crop and area. Import them in Portfolio.
      </EmptyState>
    );

  return (
    <>
      <Panel
        title="Adoption tracker & per-farm MRV"
        subtitle={`${p.totals.adoptedAssets} of ${p.totals.eligibleAssets} eligible rice assets on AWD · seasonal t CO2e per asset · click the pencil to record field practice`}
        icon={Sprout}
        accent="green"
        bodyClassName="px-0 pb-2"
        actions={
          <Btn variant="outline" onClick={() => (downloadFile(`mrv-farms-${new Date().toISOString().slice(0, 10)}.csv`, mrvCsv(p)), onExport())}>
            <Download size={13} /> CSV
          </Btn>
        }
      >
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
          <div className="relative min-w-[180px] flex-1">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input className={`${inputCls} pl-8`} placeholder="Search farm, reference, district…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search farms" />
          </div>
          <Select
            ariaLabel="Filter"
            className="w-44"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "eligible", label: "AWD-eligible rice" },
              { value: "not_adopted", label: "Eligible, not adopted" },
              { value: "adopted", label: "Adopted" },
              { value: "rice", label: "All rice" },
              { value: "all", label: "All crop assets" },
            ]}
          />
          {canEdit && sel.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-cyan-400/20 bg-cyan-400/[0.05] px-2 py-1">
              <span className="text-[12px] text-cyan-100">{sel.size} selected</span>
              <Select ariaLabel="Verification status" className="h-8 w-36" value={bulkStatus} onChange={setBulkStatus} options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value: value as typeof bulkStatus, label }))} />
              <Btn className="h-8 py-1" loading={setAdoption.isPending} onClick={() => setAdoption.mutate({ assetIds: [...sel], adopted: true, status: bulkStatus })}>
                <CheckCircle2 size={13} /> Mark adopted
              </Btn>
              <Btn variant="outline" className="h-8 py-1" loading={setAdoption.isPending} onClick={() => setAdoption.mutate({ assetIds: [...sel], adopted: false })}>
                <XCircle size={13} /> Unmark
              </Btn>
            </div>
          )}
        </div>
        <div className="max-h-[620px] overflow-auto">
          <table className="w-full min-w-[980px] text-[12.5px]">
            <thead className="sticky top-0 z-10 bg-[#070d1c] text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                {canEdit && (
                  <th className="w-8 pl-4">
                    <input type="checkbox" aria-label="Select all" className="accent-cyan-400" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(rows.map((r) => r.id)))} />
                  </th>
                )}
                <th className="px-3 py-1.5 font-medium">Farm / unit</th>
                <th className="py-1.5 font-medium">Water</th>
                <th className="py-1.5 font-medium">AWD</th>
                <th className="py-1.5 text-right font-medium">Area · farmers</th>
                <th className="py-1.5 text-right font-medium">
                  Baseline <Explain text="Season t CO2e with the baseline water regime (no AWD): rice CH4 + fertiliser N2O + urea CO2." />
                </th>
                <th className="py-1.5 text-right font-medium">Now</th>
                <th className="py-1.5 text-right font-medium">Avoided / potential</th>
                <th className="py-1.5 text-right font-medium">Water saved</th>
                <th className="w-10 pr-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {rows.map((r) => (
                <tr key={r.id} className={sel.has(r.id) ? "bg-cyan-400/[0.04]" : "hover:bg-white/[0.03]"}>
                  {canEdit && (
                    <td className="pl-4">
                      <input type="checkbox" aria-label={`Select ${r.name}`} className="accent-cyan-400" checked={sel.has(r.id)} onChange={() => toggle(r.id)} />
                    </td>
                  )}
                  <td className="max-w-[240px] px-3 py-1.5">
                    <div className="truncate text-slate-200">{r.name}</div>
                    <div className="truncate text-[11px] capitalize text-slate-500">
                      {r.crop} · {r.district ?? r.country} · {r.season}
                    </div>
                  </td>
                  <td className="py-1.5 text-[11.5px] text-slate-400">
                    <div>{r.practice.irrigationLabel}</div>
                    <div className="text-slate-500">{REGIME_LABEL[r.practice.regime]?.split(" (")[0]}</div>
                  </td>
                  <td className="py-1.5">
                    {r.practice.awd ? (
                      <span className="inline-flex flex-col">
                        <span className="inline-flex items-center gap-1 text-emerald-300">
                          <CheckCircle2 size={12} /> Adopted
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {STATUS_LABEL[r.practice.awdStatus ?? "self_reported"]}
                          {r.practice.awdSince ? ` · since ${r.practice.awdSince}` : ""}
                        </span>
                      </span>
                    ) : r.practice.eligible ? (
                      canEdit ? (
                        <button className="text-[12px] text-cyan-300 hover:underline" onClick={() => setAdoption.mutate({ assetIds: [r.id], adopted: true, status: "self_reported" })}>
                          Mark adopted
                        </button>
                      ) : (
                        <span className="text-[12px] text-sky-300">Eligible</span>
                      )
                    ) : (
                      <span className="text-[11.5px] text-slate-500" title="AWD needs water control (irrigated, flooded paddy)">
                        {r.crop === "rice" ? "Not eligible" : "—"}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-right telemetry text-slate-300">
                    {num(r.areaHa, r.areaHa < 10 ? 2 : 0)} ha
                    <div className="text-[11px] text-slate-500">{num(r.farmers)} farmers</div>
                  </td>
                  <td className="py-1.5 text-right telemetry text-slate-300">{r.baseline.tCo2e.toFixed(r.baseline.tCo2e < 10 ? 2 : 0)}</td>
                  <td className="py-1.5 text-right telemetry text-slate-100">{r.actual.tCo2e.toFixed(r.actual.tCo2e < 10 ? 2 : 0)}</td>
                  <td className="py-1.5 text-right telemetry">
                    <span className="text-emerald-300">{r.avoidedTCo2e.toFixed(2)}</span>
                    <span className="text-slate-500"> / {r.potentialAvoidedTCo2e.toFixed(2)}</span>
                  </td>
                  <td className="py-1.5 text-right telemetry text-sky-300">{r.practice.eligible ? m3((r.practice.awd ? r.awdWaterSavedM3 : r.potentialWaterSavedM3)) : "—"}</td>
                  <td className="pr-4 text-right">
                    {canEdit && (
                      <button className="rounded p-1 text-slate-400 hover:bg-white/5 hover:text-white" aria-label={`Edit practice for ${r.name}`} onClick={() => setEdit(r)}>
                        <Pencil size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <div className="px-4 py-6 text-center text-[13px] text-slate-500">No assets match this filter.</div>}
        </div>
        <p className="px-4 pt-2 text-[11.5px] text-slate-500">Values are per season (t CO2e). Water saved = irrigation withdrawal × AWD saving (25–30 %). {!canEdit && "Your role can view but not change adoption."}</p>
      </Panel>
      <PracticeEditor row={edit} onClose={() => setEdit(null)} />
    </>
  );
}

function PracticeEditor({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState<{ regime: string; preseason: string; organic: string; organicT: number; nKgHa: number; seasonsPerYear: number; status: string; since: string; note: string } | null>(null);
  const init = row
    ? { regime: row.practice.baselineRegime, preseason: row.practice.preseason, organic: row.practice.organic, organicT: row.practice.organicT, nKgHa: row.practice.nKgHa, seasonsPerYear: row.practice.seasonsPerYear, status: row.practice.awdStatus ?? "self_reported", since: row.practice.awdSince ?? new Date().toISOString().slice(0, 10), note: row.practice.note ?? "" }
    : null;
  const d = draft ?? init;
  const done = () => {
    setDraft(null);
    onClose();
    void utils.sustainability.carbon.programme.invalidate();
    void utils.sustainability.esg.summary.invalidate();
  };
  const setPractice = trpc.sustainability.carbon.setPractice.useMutation({ onError: (e) => toast.error(e.message) });
  const setAdoption = trpc.sustainability.carbon.setAdoption.useMutation({ onError: (e) => toast.error(e.message) });
  const up = (k: keyof NonNullable<typeof d>, v: string | number) => setDraft({ ...(d as NonNullable<typeof d>), [k]: v });
  const save = async () => {
    if (!row || !d) return;
    await setPractice.mutateAsync({ assetId: row.id, regime: d.regime, preseason: d.preseason, organic: d.organic, organicT: d.organicT, nKgHa: d.nKgHa, seasonsPerYear: d.seasonsPerYear });
    if (row.practice.awd) await setAdoption.mutateAsync({ assetIds: [row.id], adopted: true, status: d.status as "self_reported", since: d.since, note: d.note || undefined });
    toast.success("Practice saved — emissions recomputed");
    done();
  };
  const reset = async () => {
    if (!row) return;
    await setPractice.mutateAsync({ assetId: row.id, reset: true });
    toast.success("Reset to IPCC / national defaults");
    done();
  };
  return (
    <Drawer eyebrow="Carbon MRV" open={!!row} onClose={() => (setDraft(null), onClose())} title={row ? `Field practice · ${row.name}` : ""} subtitle="These inputs set the IPCC scaling factors for this asset">
      {row && d && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={<>Baseline water regime <Explain text="IPCC 2019 Table 5.12 scaling factor SF_w for the water regime during cultivation, before any AWD." /></>}>
              <Select ariaLabel="Water regime" value={d.regime} onChange={(v) => up("regime", v)} options={Object.entries(REGIME_LABEL).map(([value, label]) => ({ value, label }))} />
            </Field>
            <Field label="Pre-season water regime (SF_p)">
              <Select ariaLabel="Pre-season" value={d.preseason} onChange={(v) => up("preseason", v)} options={Object.entries(PRE_LABEL).map(([value, label]) => ({ value, label }))} />
            </Field>
            <Field label="Organic amendment (CFOA)">
              <Select ariaLabel="Organic amendment" value={d.organic} onChange={(v) => up("organic", v)} options={Object.entries(ORG_LABEL).map(([value, label]) => ({ value, label }))} />
            </Field>
            <Field label="Amendment rate" hint="t dry matter/ha for straw, t fresh weight/ha otherwise">
              <NumInput ariaLabel="Amendment rate" value={d.organicT} onChange={(v) => up("organicT", v)} min={0} max={30} suffix="t/ha" />
            </Field>
            <Field label="Synthetic N" hint="kg N/ha per season (assumed applied as urea)">
              <NumInput ariaLabel="N rate" value={d.nKgHa} onChange={(v) => up("nKgHa", v)} min={0} max={400} suffix="kg N/ha" />
            </Field>
            <Field label="Rice seasons per year">
              <NumInput ariaLabel="Seasons per year" value={d.seasonsPerYear} onChange={(v) => up("seasonsPerYear", v)} min={1} max={3} />
            </Field>
          </div>
          {row.practice.awd && (
            <div className="grid gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-3 md:grid-cols-3">
              <Field label="Verification">
                <Select ariaLabel="Verification" value={d.status} onChange={(v) => up("status", v)} options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))} />
              </Field>
              <Field label="Adopted since">
                <input type="date" className={inputCls} value={d.since} onChange={(e) => up("since", e.target.value)} aria-label="Adopted since" />
              </Field>
              <Field label="Evidence note">
                <input className={inputCls} value={d.note} maxLength={280} onChange={(e) => up("note", e.target.value)} placeholder="e.g. field tube readings 3×/wk" aria-label="Evidence note" />
              </Field>
            </div>
          )}
          <div className="flex flex-wrap justify-between gap-2">
            <Btn variant="ghost" onClick={reset} loading={setPractice.isPending}>
              Reset to defaults
            </Btn>
            <div className="flex gap-2">
              <Btn variant="outline" onClick={() => (setDraft(null), onClose())}>
                Cancel
              </Btn>
              <Btn onClick={save} loading={setPractice.isPending || setAdoption.isPending}>
                Save practice
              </Btn>
            </div>
          </div>
          <p className="text-[11.5px] text-slate-500">
            Current season: baseline {row.baseline.tCo2e.toFixed(2)} t CO2e → now {row.actual.tCo2e.toFixed(2)} t CO2e (CH4 {num(row.actual.ch4Kg, 0)} kg, N2O {row.actual.n2oKg.toFixed(1)} kg, urea CO2 {num(row.actual.co2Kg, 0)} kg). {row.practice.nDefault && "N rate is the national default."}
          </p>
        </div>
      )}
    </Drawer>
  );
}
