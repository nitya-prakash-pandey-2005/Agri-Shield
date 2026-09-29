"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Building2, Globe2, Loader2, Map as MapIcon, Palette, Rocket, Save, SlidersHorizontal } from "lucide-react";
import type * as Leaflet from "leaflet";
import { trpc } from "@/lib/trpc";
import { Panel, Skeleton, riskColor } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { Btn, Field, Toggle, inputCls } from "@/components/workspace/ui";

const BaseMap = dynamic(() => import("@/components/maps/BaseMap"), { ssr: false, loading: () => <div className="skeleton h-full w-full" /> });

const INDUSTRIES = [
  ["insurance", "Insurance"],
  ["banking", "Banking & MFI"],
  ["agribusiness", "Agribusiness & food"],
  ["government", "Government"],
  ["ngo", "NGO / humanitarian"],
  ["cooperative", "Farmer co-operative"],
] as const;
const CURRENCIES = ["USD", "EUR", "GBP", "INR", "BDT", "VND", "PHP", "IDR", "LKR", "NPR", "PKR", "THB", "KES", "NGN", "BRL", "SGD"];
const LOCALES = ["en-US", "en-GB", "en-IN", "en-BD", "en-PH", "vi-VN", "id-ID", "bn-BD", "hi-IN", "fil-PH", "ta-IN", "si-LK"];
const COLORS = ["#38bdf8", "#10b981", "#f59e0b", "#a78bfa", "#f472b6", "#22d3ee", "#fb7185", "#84cc16"];
const FALLBACK_TZ = ["UTC", "Asia/Dhaka", "Asia/Kolkata", "Asia/Ho_Chi_Minh", "Asia/Manila", "Asia/Jakarta", "Asia/Colombo", "Asia/Singapore", "Asia/Bangkok", "Africa/Nairobi", "Europe/London", "America/New_York"];

type Form = {
  name: string;
  shortName: string;
  logoInitials: string;
  logoColor: string;
  industry: (typeof INDUSTRIES)[number][0];
  units: "metric" | "imperial";
  timezone: string;
  currency: string;
  locale: string;
  center: [number, number];
  zoom: number;
  riskThreshold: number;
  weeklyDigest: boolean;
};

export default function GeneralSettings() {
  const utils = trpc.useUtils();
  const q = trpc.workspace.getSettings.useQuery();
  const home = trpc.workspace.home.useQuery(undefined, { staleTime: 5 * 60_000 });
  const ob = trpc.workspace.onboarding.useQuery();
  const save = trpc.workspace.updateSettings.useMutation();
  const restoreChecklist = trpc.workspace.setOnboardingDismissed.useMutation({ onSuccess: () => (void utils.workspace.onboarding.invalidate(), void utils.workspace.home.invalidate(), toast.success("Setup checklist is back on Home")) });
  const [f, setF] = useState<Form | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);

  useEffect(() => {
    if (!q.data || f) return;
    const s = q.data.settings;
    setF({ name: q.data.name, shortName: q.data.shortName, logoInitials: q.data.logoInitials, logoColor: q.data.logoColor, industry: q.data.industry, units: s.units, timezone: s.timezone, currency: s.currency, locale: s.locale, center: s.defaultCenter, zoom: s.defaultZoom, riskThreshold: s.riskThreshold, weeklyDigest: s.weeklyDigest });
  }, [q.data, f]);

  const tzs = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? FALLBACK_TZ;
    } catch {
      return FALLBACK_TZ;
    }
  }, []);

  const scores = home.data?.points.map((p) => p.composite) ?? [];
  const wouldBeAtRisk = f ? scores.filter((s) => s >= f.riskThreshold).length : 0;
  const canEdit = q.data?.canEdit ?? false;

  if (!f || !q.data) return <div className="grid gap-4 lg:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-64" />)}</div>;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => (x ? { ...x, [k]: v } : x));

  const onSave = async () => {
    try {
      const r = await save.mutateAsync({
        name: f.name,
        shortName: f.shortName,
        logoInitials: f.logoInitials,
        logoColor: f.logoColor,
        industry: f.industry,
        settings: { units: f.units, timezone: f.timezone, currency: f.currency, locale: f.locale, defaultCenter: [Math.round(f.center[0] * 1000) / 1000, Math.round(f.center[1] * 1000) / 1000], defaultZoom: f.zoom, riskThreshold: f.riskThreshold, weeklyDigest: f.weeklyDigest },
      });
      toast.success(r.changes.length ? `Saved: ${r.changes.slice(0, 4).join(", ")}${r.changes.length > 4 ? "…" : ""}` : "Nothing changed");
      await Promise.all([utils.workspace.getSettings.invalidate(), utils.workspace.me.invalidate(), utils.workspace.home.invalidate()]);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-4 pb-20">
      {!canEdit && <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">You can view these settings; only workspace admins can change them.</div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Organisation" icon={Building2} accent="cyan">
          <div className="space-y-3">
            <Field label="Organisation name">
              <input className={inputCls} value={f.name} disabled={!canEdit} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Short name" hint="Shown in the top bar and reports">
                <input className={inputCls} value={f.shortName} maxLength={24} disabled={!canEdit} onChange={(e) => set("shortName", e.target.value)} />
              </Field>
              <Field label="Industry" hint="Changes your Home KPIs and menu order">
                <select className={inputCls} value={f.industry} disabled={!canEdit} onChange={(e) => set("industry", e.target.value as Form["industry"])}>
                  {INDUSTRIES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="text-[11px] text-slate-500">
              Workspace ID <span className="telemetry text-slate-400">{q.data.id}</span> · created {new Date(q.data.createdAt).toISOString().slice(0, 10)} · {q.data.verified ? "verified organisation" : "verification pending"}
            </div>
          </div>
        </Panel>

        <Panel title="Logo" icon={Palette} accent="violet">
          <div className="flex items-center gap-4">
            <div className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl font-display text-2xl font-bold text-slate-950 shadow-lg" style={{ background: f.logoColor, boxShadow: `0 0 32px -8px ${f.logoColor}` }}>
              {f.logoInitials || "?"}
            </div>
            <div className="flex-1 space-y-3">
              <Field label="Initials (1–3 letters)">
                <input className={inputCls} value={f.logoInitials} maxLength={3} disabled={!canEdit} onChange={(e) => set("logoInitials", e.target.value.toUpperCase())} />
              </Field>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Logo colour">
                {COLORS.map((c) => (
                  <button key={c} role="radio" aria-checked={f.logoColor === c} aria-label={c} disabled={!canEdit} onClick={() => set("logoColor", c)} className="h-7 w-7 rounded-full ring-offset-2 ring-offset-[#0a1020] transition-transform hover:scale-110" style={{ background: c, boxShadow: f.logoColor === c ? `0 0 0 2px #0a1020, 0 0 0 4px ${c}` : undefined }} />
                ))}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Regional preferences" icon={Globe2} accent="emerald">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Units">
              <select className={inputCls} value={f.units} disabled={!canEdit} onChange={(e) => set("units", e.target.value as Form["units"])}>
                <option value="metric">Metric (mm, °C, ha)</option>
                <option value="imperial">Imperial (in, °F, acres)</option>
              </select>
            </Field>
            <Field label="Currency">
              <select className={inputCls} value={f.currency} disabled={!canEdit} onChange={(e) => set("currency", e.target.value)}>
                {[...new Set([f.currency, ...CURRENCIES])].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Time zone" hint={`Now: ${(() => { try { return new Intl.DateTimeFormat("en-GB", { timeStyle: "short", timeZone: f.timezone }).format(new Date()); } catch { return "—"; } })()}`}>
              <select className={inputCls} value={f.timezone} disabled={!canEdit} onChange={(e) => set("timezone", e.target.value)}>
                {[...new Set([f.timezone, ...tzs])].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="Locale" hint={`e.g. ${(() => { try { return new Intl.NumberFormat(f.locale, { style: "currency", currency: f.currency }).format(1234567.8); } catch { return "—"; } })()}`}>
              <select className={inputCls} value={f.locale} disabled={!canEdit} onChange={(e) => set("locale", e.target.value)}>
                {[...new Set([f.locale, ...LOCALES])].map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </Field>
          </div>
        </Panel>

        <Panel title="Risk & notifications" icon={SlidersHorizontal} accent="amber">
          <Field
            label={
              <>
                At-risk threshold <Explain term="risk_threshold" />
              </>
            }
          >
            <div className="flex items-center gap-3">
              <input type="range" min={20} max={90} step={1} value={f.riskThreshold} disabled={!canEdit} onChange={(e) => set("riskThreshold", Number(e.target.value))} className="flex-1 accent-cyan-400" aria-label="At-risk threshold" />
              <span className="telemetry w-14 rounded-md px-2 py-1 text-center text-sm font-semibold" style={{ background: `${riskColor(f.riskThreshold)}22`, color: riskColor(f.riskThreshold) }}>
                {f.riskThreshold}
              </span>
            </div>
          </Field>
          <p className="mt-2 text-[12.5px] text-slate-300">
            {home.data ? (
              <>
                With this threshold, <b className="text-white">{wouldBeAtRisk}</b> of your {scores.length} assets would count as <b>at risk</b> today ({scores.length ? Math.round((wouldBeAtRisk / scores.length) * 100) : 0}%).
              </>
            ) : (
              "Calculating how many assets this affects…"
            )}
          </p>
          <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2.5">
            <div>
              <div className="text-[13px] text-slate-100">Weekly digest email</div>
              <div className="text-[11.5px] text-slate-500">Monday summary of changes, fired rules and hazards for every member</div>
            </div>
            <Toggle checked={f.weeklyDigest} onChange={(v) => set("weeklyDigest", v)} label="Weekly digest" disabled={!canEdit} />
          </div>
          {ob.data?.dismissed && (
            <button onClick={() => restoreChecklist.mutate({ dismissed: false })} className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-cyan-300 hover:underline">
              <Rocket size={12} /> Show the setup checklist on Home again ({ob.data.done}/{ob.data.total} done)
            </button>
          )}
        </Panel>

        <Panel title="Default map view" subtitle="Pan and zoom — every map in the workspace opens here" icon={MapIcon} accent="cyan" className="lg:col-span-2" bodyClassName="px-0 pb-0">
          <div className="relative h-72">
            <BaseMap
              center={f.center}
              zoom={f.zoom}
              showBasemapSwitcher={false}
              className="h-full w-full"
              onReady={(map) => {
                mapRef.current = map;
                const upd = () => {
                  const c = map.getCenter();
                  setF((x) => (x ? { ...x, center: [c.lat, c.lng], zoom: map.getZoom() } : x));
                };
                map.on("moveend", upd);
                return () => map.off("moveend", upd);
              }}
            />
            <div className="pointer-events-none absolute left-1/2 top-1/2 z-[500] h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-300 shadow-[0_0_12px_rgba(56,189,248,0.8)]" />
            <div className="absolute right-2 top-2 z-[500] rounded-md bg-slate-950/85 px-2 py-1 text-[11px] telemetry text-slate-300">
              {f.center[0].toFixed(3)}, {f.center[1].toFixed(3)} · zoom {f.zoom}
            </div>
          </div>
        </Panel>
      </div>

      {canEdit && (
        <div className="sticky bottom-3 z-30 flex items-center justify-start gap-3 sm:pr-48">
          <Btn onClick={onSave} disabled={save.isPending} className="shadow-[0_8px_30px_-6px_rgba(56,189,248,0.6)]">
            {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save changes
          </Btn>
        </div>
      )}
    </div>
  );
}
