"use client";

/**
 * Import wizard: upload / paste CSV or GeoJSON → preview with per-row
 * validation → confirm → live re-score with progress.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardPaste, Download, FileSpreadsheet, FileUp, Loader2, MapPin, RefreshCw, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";
import { Panel, SourceTag } from "@/components/hud";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { TYPE_LABEL, downloadText, fmtUsd } from "@/components/portfolio/format";
import { Field, Help, PageTitle, PfButton, QueryError, Segmented, inputCls } from "@/components/portfolio/ui";
import { cn } from "@/lib/utils";

type Preview = RouterOutputs["portfolio"]["importPreview"];
type Step = "source" | "preview" | "scoring" | "done";

/** Ten real coastal agricultural locations (Bangladesh, Vietnam, India) for a quick trial. */
const SAMPLE = `name,lat,lon,value_usd,crop,ref,tags
Barisal Sadar paddy,22.7010,90.3535,5200,rice,DEMO-001,trial;coastal
Khulna Dumuria shrimp-rice,22.8081,89.4247,7400,rice,DEMO-002,trial;coastal
Shyamnagar Satkhira,22.3319,89.1020,3900,rice,DEMO-003,trial;salinity
Kalapara Patuakhali,21.9870,90.2410,4600,rice,DEMO-004,trial;coastal
Bhola Sadar,22.6859,90.6482,3100,jute,DEMO-005,trial;flood-plain
Cai Rang Can Tho,10.0452,105.7469,8800,rice,DEMO-006,trial;mekong
Ben Tre coconut,10.2434,106.3756,6300,coconut,DEMO-007,trial;mekong
Soc Trang Tran De,9.5170,106.1970,5700,rice,DEMO-008,trial;mekong
Kendrapara Odisha,20.5022,86.4228,2900,rice,DEMO-009,trial;odisha
Jagatsinghpur Odisha,20.2548,86.1706,3300,vegetables,DEMO-010,trial;odisha`;

export default function ImportPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const meta = trpc.portfolio.meta.useQuery(undefined, { staleTime: 3600_000 });
  const template = trpc.portfolio.importTemplate.useQuery(undefined, { staleTime: Infinity });
  const [step, setStep] = useState<Step>("source");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [format, setFormat] = useState<"auto" | "csv" | "geojson">("auto");
  const [defaultType, setDefaultType] = useState<string>("");
  const [extraTag, setExtraTag] = useState(() => `import-${new Date().toISOString().slice(0, 10)}`);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [show, setShow] = useState<"all" | "errors" | "warnings">("all");
  const [progress, setProgress] = useState({ done: 0, total: 0, live: 0 });
  const [result, setResult] = useState<{ created: string[]; skipped: { row: number; reason: string }[]; geocoded: number; firings: number } | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const previewM = trpc.portfolio.importPreview.useMutation({
    onSuccess: (p) => {
      setPreview(p);
      if (!p.fatal) setStep("preview");
    },
    onError: (e) => toast.error(e.message),
  });
  const commitM = trpc.portfolio.importCommit.useMutation({ onError: (e) => toast.error(e.message) });
  const rescoreM = trpc.portfolio.rescore.useMutation();
  const rulesM = trpc.portfolio.runRules.useMutation();

  const loadFile = useCallback((f: File) => {
    if (f.size > 5_000_000) return toast.error("File is larger than 5 MB — split it into smaller batches.");
    f.text().then((t) => {
      setText(t);
      setFileName(f.name);
      if (/\.(geo)?json$/i.test(f.name)) setFormat("geojson");
      else if (/\.csv$/i.test(f.name) || /\.txt$/i.test(f.name)) setFormat("csv");
    });
  }, []);

  const runPreview = () => previewM.mutate({ text, format, defaultType: (defaultType || undefined) as never });

  const commit = async () => {
    if (!preview) return;
    try {
      const res = await commitM.mutateAsync({ text, format, defaultType: (defaultType || undefined) as never, extraTags: extraTag.trim() ? [extraTag.trim()] : [], skipDuplicates: true });
      setStep("scoring");
      const ids = res.created;
      setProgress({ done: 0, total: ids.length, live: 0 });
      let live = 0;
      for (let i = 0; i < ids.length; i += 20) {
        const batch = ids.slice(i, i + 20);
        try {
          const r = await rescoreM.mutateAsync({ assetIds: batch });
          live += r.live;
        } catch {
          /* keep going — baseline scores remain */
        }
        setProgress({ done: Math.min(ids.length, i + batch.length), total: ids.length, live });
      }
      let firings = 0;
      try {
        const rr = await rulesM.mutateAsync({});
        firings = rr.filter((x) => x.fired).length;
      } catch {
        /* rules are optional here */
      }
      setResult({ ...res, firings });
      setStep("done");
      utils.portfolio.invalidate();
    } catch {
      /* toast shown by onError */
    }
  };

  const rows = useMemo(() => {
    if (!preview) return [];
    return preview.rows.filter((r) => (show === "errors" ? r.errors.length : show === "warnings" ? r.warnings.length && !r.errors.length : true));
  }, [preview, show]);

  const steps: { id: Step; label: string }[] = [
    { id: "source", label: "Upload" },
    { id: "preview", label: "Check" },
    { id: "scoring", label: "Import & score" },
    { id: "done", label: "Done" },
  ];
  const stepIdx = steps.findIndex((s) => s.id === step);

  return (
    <div>
      <PageTitle
        eyebrow="Portfolio · import"
        title="Import assets"
        description="Bring in policies, loans, farms or facilities from a spreadsheet. We recognise common column names, check every row, geocode addresses, and score everything against live forecasts."
        actions={
          <Link href="/app/portfolio">
            <PfButton variant="ghost">
              <ArrowLeft size={14} /> Back to portfolio
            </PfButton>
          </Link>
        }
      />

      <ol className="mb-5 flex flex-wrap items-center gap-2 text-xs">
        {steps.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2">
            <span className={cn("grid h-6 w-6 place-items-center rounded-full telemetry text-[11px]", i < stepIdx ? "bg-emerald-500/20 text-emerald-300" : i === stepIdx ? "bg-sky-400 text-slate-950" : "bg-white/5 text-slate-500")}>{i < stepIdx ? "✓" : i + 1}</span>
            <span className={i === stepIdx ? "text-white" : "text-slate-500"}>{s.label}</span>
            {i < steps.length - 1 && <span className="mx-1 h-px w-6 bg-white/10" />}
          </li>
        ))}
      </ol>

      <AnimatePresence mode="wait">
        {step === "source" && (
          <motion.div key="source" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="grid gap-4 lg:grid-cols-3">
            <Panel title="1 · Your file" subtitle="CSV (comma, semicolon or tab) or GeoJSON · up to 5,000 rows" icon={FileUp} accent="cyan" className="lg:col-span-2">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDrag(false);
                  const f = e.dataTransfer.files[0];
                  if (f) loadFile(f);
                }}
                onClick={() => fileRef.current?.click()}
                className={cn("grid cursor-pointer place-items-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors", drag ? "border-sky-400 bg-sky-400/10" : "border-slate-700 hover:border-sky-400/60")}
              >
                <Upload size={24} className="mb-2 text-sky-300" />
                <div className="text-sm text-slate-200">{fileName ? <>Loaded <b>{fileName}</b> — click to choose another</> : "Drop a file here or click to browse"}</div>
                <div className="mt-1 text-[11px] text-slate-500">.csv · .geojson · .json</div>
                <input ref={fileRef} type="file" accept=".csv,.txt,.geojson,.json,text/csv,application/json" className="hidden" onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
              </div>
              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-400">
                    <ClipboardPaste size={12} /> …or paste rows
                  </span>
                  <button className="inline-flex items-center gap-1 text-[11px] text-sky-300 hover:underline" onClick={() => { setText(SAMPLE); setFileName("sample-10-sites.csv"); setFormat("csv"); }}>
                    <Sparkles size={11} /> Load 10 real sample sites
                  </button>
                </div>
                <textarea
                  className={cn(inputCls, "telemetry h-48 resize-y text-xs")}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setFileName(null);
                  }}
                  placeholder={"name,lat,lon,value_usd,crop,ref,tags\nNorth block,22.701,90.3535,12500,rice,POL-1,coastal"}
                  spellCheck={false}
                />
              </div>
              {preview?.fatal && (
                <div className="mt-3 flex gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-300">
                  <AlertTriangle size={14} className="shrink-0" />
                  {preview.fatal}
                </div>
              )}
              <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                <PfButton onClick={runPreview} disabled={!text.trim()} loading={previewM.isPending}>
                  Check rows →
                </PfButton>
              </div>
            </Panel>

            <div className="space-y-4">
              <Panel title="Options" icon={FileSpreadsheet} accent="cyan">
                <div className="space-y-3">
                  <Field label="File format">
                    <Segmented value={format} onChange={setFormat} options={[{ value: "auto", label: "Auto" }, { value: "csv", label: "CSV" }, { value: "geojson", label: "GeoJSON" }]} />
                  </Field>
                  <Field label="Default asset type" hint="Used for rows without a type column">
                    <select className={inputCls} value={defaultType} onChange={(e) => setDefaultType(e.target.value)}>
                      <option value="">Workspace default ({TYPE_LABEL[meta.data?.defaultType ?? "farm"]})</option>
                      {meta.data?.assetTypes.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Tag every imported asset" hint="Makes this batch easy to filter, alert on, or undo">
                    <input className={inputCls} value={extraTag} onChange={(e) => setExtraTag(e.target.value)} maxLength={40} />
                  </Field>
                </div>
              </Panel>
              <Panel title="Columns we understand" icon={Sparkles} accent="violet">
                <ul className="space-y-1.5 text-[11.5px] text-slate-400">
                  <li><b className="text-slate-200">Location</b> — lat/latitude + lon/lng/longitude, a “coordinates” column, or an address (geocoded with OpenStreetMap)</li>
                  <li><b className="text-slate-200">name</b>, <b className="text-slate-200">value</b> (sum insured, outstanding, exposure — $ , k, M ok)</li>
                  <li><b className="text-slate-200">type</b> (farm, insured_plot, loan, warehouse, community…), <b className="text-slate-200">crop</b>, <b className="text-slate-200">ref</b> (policy / loan no.), <b className="text-slate-200">tags</b> (a;b;c), <b className="text-slate-200">area_ha</b></li>
                  <li>Any other column is kept as custom data on the asset.</li>
                </ul>
                <PfButton size="sm" variant="outline" className="mt-3" onClick={() => template.data && downloadText(template.data.filename, template.data.content, template.data.mime)}>
                  <Download size={12} /> Download CSV template
                </PfButton>
              </Panel>
            </div>
          </motion.div>
        )}

        {step === "preview" && preview && (
          <motion.div key="preview" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {[
                { l: "Rows read", v: preview.rows.length, c: "text-white" },
                { l: "Ready to import", v: preview.validCount - preview.duplicatesInWorkspace.length, c: "text-emerald-300" },
                { l: "With errors", v: preview.errorCount, c: preview.errorCount ? "text-rose-300" : "text-slate-400" },
                { l: "Addresses to geocode", v: preview.geocodeCount, c: "text-sky-300" },
                { l: "Already in portfolio", v: preview.duplicatesInWorkspace.length, c: preview.duplicatesInWorkspace.length ? "text-amber-300" : "text-slate-400" },
              ].map((k) => (
                <div key={k.l} className="hud-panel p-3" style={{ ["--hud-accent" as string]: "56 189 248" }}>
                  <div className="hud-label">{k.l}</div>
                  <div className={cn("telemetry mt-1 text-2xl", k.c)}>{k.v}</div>
                </div>
              ))}
            </div>

            <Panel
              title="Column mapping"
              subtitle={`${preview.format.toUpperCase()}${preview.delimiter ? ` · delimiter “${preview.delimiter === "\t" ? "tab" : preview.delimiter}”` : ""}`}
              icon={FileSpreadsheet}
              accent="cyan"
              className="mt-4"
            >
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(preview.mapping).map(([h, f]) => (
                  <span key={h} className={cn("rounded-md border px-2 py-1 text-[11px]", f ? "border-sky-400/40 bg-sky-400/10 text-sky-100" : "border-white/10 text-slate-500")}>
                    {h} {f ? <>→ <b>{f}</b></> : "→ kept as custom data"}
                  </span>
                ))}
                {!Object.keys(preview.mapping).length && <span className="text-xs text-slate-500">GeoJSON geometry used for location.</span>}
              </div>
            </Panel>

            <Panel
              title="Row check"
              subtitle="Fix errors in your file and re-upload, or import the valid rows now — rows with errors are skipped."
              icon={CheckCircle2}
              accent="cyan"
              className="mt-4"
              actions={<Segmented value={show} onChange={setShow} options={[{ value: "all", label: "All", count: preview.rows.length }, { value: "errors", label: "Errors", count: preview.errorCount }, { value: "warnings", label: "Warnings", count: preview.rows.filter((r) => r.warnings.length && !r.errors.length).length }]} />}
            >
              <div className="max-h-[480px] overflow-auto rounded-xl border border-white/5">
                <table className="w-full min-w-[820px] text-xs">
                  <thead className="sticky top-0 bg-[#0a1122]">
                    <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                      <th className="px-3 py-2">Row</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Location</th>
                      <th className="px-3 py-2 text-right">Value</th>
                      <th className="px-3 py-2">Type · crop</th>
                      <th className="px-3 py-2">Tags</th>
                      <th className="px-3 py-2">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {rows.map((r) => (
                      <tr key={r.row} className={r.errors.length ? "bg-rose-500/[0.04]" : ""}>
                        <td className="telemetry px-3 py-2 text-slate-500">{r.row}</td>
                        <td className="px-3 py-2">
                          {r.errors.length ? <span className="text-rose-300">✕ error</span> : r.needsGeocode ? <span className="text-sky-300">◎ geocode</span> : r.warnings.length ? <span className="text-amber-300">! check</span> : <span className="text-emerald-300">✓ ok</span>}
                        </td>
                        <td className="max-w-[200px] truncate px-3 py-2 text-slate-200">{r.asset.name}</td>
                        <td className="telemetry px-3 py-2 text-slate-400">{r.asset.lat != null ? `${r.asset.lat.toFixed(4)}, ${r.asset.lon!.toFixed(4)}` : r.asset.address ?? "—"}</td>
                        <td className="telemetry px-3 py-2 text-right text-slate-300">{fmtUsd(r.asset.valueUsd)}</td>
                        <td className="px-3 py-2 text-slate-400">{TYPE_LABEL[r.asset.type]}{r.asset.crop ? ` · ${r.asset.crop}` : ""}</td>
                        <td className="max-w-[140px] truncate px-3 py-2 text-slate-400">{r.asset.tags.join(", ")}</td>
                        <td className="max-w-[320px] px-3 py-2">
                          {r.errors.map((e) => <div key={e} className="text-rose-300">{e}</div>)}
                          {r.warnings.map((w) => <div key={w} className="text-amber-300/80">{w}</div>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!rows.length && <div className="p-6 text-center text-xs text-slate-500">Nothing to show for this filter.</div>}
              </div>
              {preview.truncated && <p className="mt-2 text-[11px] text-slate-500">Showing the first 1,000 rows; all rows will be imported.</p>}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <PfButton variant="ghost" onClick={() => setStep("source")}>
                  <ArrowLeft size={14} /> Back
                </PfButton>
                <div className="flex items-center gap-3">
                  {preview.geocodeCount > 0 && <span className="text-[11px] text-slate-500">Geocoding runs at 1 address/second (OpenStreetMap policy).</span>}
                  <PfButton onClick={commit} loading={commitM.isPending} disabled={preview.validCount - preview.duplicatesInWorkspace.length <= 0}>
                    Import {Math.max(0, preview.validCount - preview.duplicatesInWorkspace.length)} assets →
                  </PfButton>
                </div>
              </div>
            </Panel>
            <QueryError error={commitM.error} />
          </motion.div>
        )}

        {step === "scoring" && (
          <motion.div key="scoring" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="hud-panel mx-auto max-w-xl p-8 text-center" style={{ ["--hud-accent" as string]: "56 189 248" }}>
            <Loader2 size={28} className="mx-auto animate-spin text-sky-300" />
            <h2 className="mt-3 font-display text-lg font-semibold text-white">Scoring against live forecasts…</h2>
            <p className="mt-1 text-xs text-slate-400">Pulling Open-Meteo rain/temperature/soil moisture and GloFAS river discharge for each site.</p>
            <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-800">
              <motion.div className="h-full rounded-full bg-sky-400" animate={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 5}%` }} />
            </div>
            <div className="telemetry mt-2 text-xs text-slate-400">
              {progress.done} / {progress.total} assets · {progress.live} on live data
            </div>
          </motion.div>
        )}

        {step === "done" && result && (
          <motion.div key="done" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="hud-panel mx-auto max-w-2xl p-8" style={{ ["--hud-accent" as string]: "34 197 94" }}>
            <div className="text-center">
              <CheckCircle2 size={32} className="mx-auto text-emerald-400" />
              <h2 className="mt-3 font-display text-xl font-semibold text-white">Imported {result.created.length} asset{result.created.length === 1 ? "" : "s"}</h2>
              <p className="mt-1 text-sm text-slate-400">
                {progress.live} scored on live data{result.geocoded ? ` · ${result.geocoded} addresses geocoded` : ""}
                {result.skipped.length ? ` · ${result.skipped.length} rows skipped` : ""}
                {result.firings ? ` · ${result.firings} alert rule(s) fired` : ""}
              </p>
              <div className="mt-2 flex justify-center gap-1.5">
                <SourceTag href="https://open-meteo.com">Open-Meteo</SourceTag>
                <SourceTag href="https://open-meteo.com/en/docs/flood-api">GloFAS</SourceTag>
                {result.geocoded > 0 && <SourceTag href="https://nominatim.org">OSM Nominatim</SourceTag>}
              </div>
            </div>
            {result.skipped.length > 0 && (
              <div className="mt-5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs">
                <div className="mb-1 flex items-center justify-between font-medium text-amber-200">
                  Skipped rows
                  <button className="text-[11px] text-sky-300 hover:underline" onClick={() => downloadText("import-skipped-rows.csv", ["row,reason", ...result.skipped.map((s) => `${s.row},"${s.reason.replace(/"/g, '""')}"`)].join("\n"), "text/csv")}>
                    Download list
                  </button>
                </div>
                <ul className="max-h-40 space-y-0.5 overflow-auto text-slate-300">
                  {result.skipped.slice(0, 50).map((s) => (
                    <li key={s.row}>
                      <span className="telemetry text-slate-500">row {s.row}</span> — {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <PfButton onClick={() => router.push(`/app/portfolio`)}>
                <MapPin size={14} /> View portfolio
              </PfButton>
              {result.created[0] && (
                <PfButton variant="outline" onClick={() => router.push(`/app/portfolio/${result.created[0]}`)}>
                  Open first asset
                </PfButton>
              )}
              <PfButton variant="outline" onClick={() => router.push(`/app/alerts?new=1`)}>
                Create an alert rule
              </PfButton>
              <PfButton
                variant="ghost"
                onClick={() => {
                  setStep("source");
                  setText("");
                  setPreview(null);
                  setResult(null);
                  setFileName(null);
                }}
              >
                <RefreshCw size={14} /> Import another file
              </PfButton>
            </div>
            <p className="mt-4 text-center text-[11px] text-slate-500">
              Tagged <b className="text-slate-300">{extraTag}</b> — filter by it on the portfolio to review this batch. <Help text="The portfolio monitor re-scores every asset hourly and evaluates your alert rules automatically." />
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
