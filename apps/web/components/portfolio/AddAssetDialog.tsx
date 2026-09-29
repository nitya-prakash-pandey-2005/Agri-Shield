"use client";

/**
 * "Add an asset" — three ways to locate it: search a place, click the map,
 * or type coordinates. Validates, warns about duplicates, scores on save.
 */
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Crosshair, MapPin, Search } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/hud";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { Field, Help, Modal, PfButton, Segmented, TagPill, inputCls } from "./ui";
import type { MapPoint } from "./PortfolioMap";

const PortfolioMap = dynamic(() => import("./PortfolioMap"), { ssr: false, loading: () => <Skeleton className="h-[260px]" /> });

type Mode = "search" | "map" | "coords";

export function AddAssetDialog({
  open,
  onClose,
  initialMode = "search",
  points = [],
  center,
}: {
  open: boolean;
  onClose: () => void;
  initialMode?: Mode;
  points?: MapPoint[];
  center?: [number, number] | null;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const meta = trpc.portfolio.meta.useQuery(undefined, { staleTime: 3600_000 });
  const [mode, setMode] = useState<Mode>(initialMode);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loc, setLoc] = useState<{ lat: number; lon: number; label?: string; country?: string | null } | null>(null);
  const [latText, setLatText] = useState("");
  const [lonText, setLonText] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("");
  const [value, setValue] = useState("");
  const [crop, setCrop] = useState("");
  const [ref, setRef] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagText, setTagText] = useState("");
  const [dup, setDup] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setDup(null);
    }
  }, [open, initialMode]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (!type && meta.data) setType(meta.data.defaultType);
  }, [meta.data, type]);

  const search = trpc.portfolio.searchPlaces.useQuery({ q: debounced }, { enabled: open && mode === "search" && debounced.length >= 2, staleTime: 600_000 });

  const create = trpc.portfolio.createAsset.useMutation({
    onSuccess: (row) => {
      toast.success(`${row.name} added`, { description: `Scored ${row.composite}/100 (${row.level}). Open it to see the full report.` });
      utils.portfolio.invalidate();
      reset();
      onClose();
      router.push(`/app/portfolio/${row.id}`);
    },
    onError: (e) => {
      if (e.data?.code === "CONFLICT") setDup({ id: "", name: e.message });
      else toast.error(e.message);
    },
  });

  const reset = () => {
    setQ("");
    setLoc(null);
    setLatText("");
    setLonText("");
    setName("");
    setValue("");
    setCrop("");
    setRef("");
    setTags([]);
    setDup(null);
  };

  const coordLat = Number(latText.replace(",", "."));
  const coordLon = Number(lonText.replace(",", "."));
  const coordErr =
    mode === "coords" && (latText || lonText)
      ? !Number.isFinite(coordLat) || Math.abs(coordLat) > 90
        ? "Latitude must be between −90 and 90"
        : !Number.isFinite(coordLon) || Math.abs(coordLon) > 180
          ? "Longitude must be between −180 and 180"
          : coordLat === 0 && coordLon === 0
            ? "0,0 is in the ocean — check the numbers"
            : null
      : null;
  const point = mode === "coords" ? (latText && lonText && !coordErr ? { lat: coordLat, lon: coordLon } : null) : loc;
  const canSave = !!point && name.trim().length > 0 && !!type && !create.isPending;

  const addTag = () => {
    const t = tagText.trim().toLowerCase().replace(/\s+/g, "-");
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagText("");
  };

  const submit = (allowDuplicate = false) => {
    if (!point) return;
    create.mutate({
      name: name.trim(),
      type: type as never,
      lat: point.lat,
      lon: point.lon,
      address: mode === "search" ? loc?.label ?? null : null,
      country: loc?.country ?? null,
      valueUsd: Number(value.replace(/[^0-9.]/g, "")) || 0,
      crop: (crop || null) as never,
      externalRef: ref || null,
      tags,
      allowDuplicate,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Add an asset"
      subtitle="Anything you want monitored: a field, an insured plot, a loan's collateral farm, a warehouse, a community. We score it against live forecasts the moment you save."
      footer={
        <>
          {dup && (
            <span className="mr-auto text-xs text-amber-300">
              {dup.name}{" "}
              <button className="underline underline-offset-2" onClick={() => submit(true)}>
                Add anyway
              </button>
            </span>
          )}
          <PfButton variant="ghost" onClick={onClose}>
            Cancel
          </PfButton>
          <PfButton onClick={() => submit(false)} disabled={!canSave} loading={create.isPending}>
            <MapPin size={14} /> Save & score
          </PfButton>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[1.1fr_1fr]">
        <div className="min-w-0 space-y-3">
          <Segmented
            value={mode}
            onChange={(m) => setMode(m)}
            options={[
              { value: "search", label: "Search a place" },
              { value: "map", label: "Pick on map" },
              { value: "coords", label: "Coordinates" },
            ]}
          />
          {mode === "search" && (
            <div className="space-y-2">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input autoFocus className={cn(inputCls, "pl-9")} placeholder="Village, town, district or full address…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {search.isFetching && <Skeleton className="h-10" />}
                {search.data?.map((h, i) => (
                  <button
                    key={`${h.lat},${h.lon},${i}`}
                    onClick={() => {
                      setLoc(h);
                      if (!name) setName(h.label.split(",")[0]!);
                    }}
                    className={`block w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors ${loc?.lat === h.lat && loc?.lon === h.lon ? "border-sky-400/60 bg-sky-400/10 text-white" : "border-white/5 text-slate-300 hover:border-slate-600"}`}
                  >
                    <div className="truncate">{h.label}</div>
                    <div className="telemetry text-[10px] text-slate-500">
                      {h.lat.toFixed(4)}, {h.lon.toFixed(4)} · {h.source === "nominatim" ? "OpenStreetMap" : "Open-Meteo geocoding"}
                    </div>
                  </button>
                ))}
                {debounced.length >= 2 && !search.isFetching && !search.data?.length && <div className="px-1 py-3 text-xs text-slate-500">No places found. Try a nearby town, or switch to “Pick on map”.</div>}
              </div>
            </div>
          )}
          {mode === "map" && (
            <div>
              <PortfolioMap points={points} center={center} zoom={6} height={300} pickMode picked={loc} onPick={(lat, lon) => setLoc({ lat, lon })} />
              <p className="mt-1.5 text-[11px] text-slate-500">{loc ? `Selected ${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)} — click again to move it.` : "Existing assets are shown for reference. Zoom in for precision."}</p>
            </div>
          )}
          {mode === "coords" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Latitude" hint="Decimal degrees, e.g. 22.7010 (north is +)">
                <input className={inputCls} inputMode="decimal" value={latText} onChange={(e) => setLatText(e.target.value)} placeholder="22.7010" />
              </Field>
              <Field label="Longitude" hint="e.g. 90.3535 (east is +)">
                <input className={inputCls} inputMode="decimal" value={lonText} onChange={(e) => setLonText(e.target.value)} placeholder="90.3535" />
              </Field>
              {coordErr && <p className="col-span-2 text-xs text-rose-400">{coordErr}</p>}
              <p className="col-span-2 text-[11px] text-slate-500">Tip: in Google Maps, right-click a spot and click the numbers to copy “lat, lon”. Paste into Latitude and we will split it.</p>
            </div>
          )}
          {mode === "coords" && latText.includes(",") && !lonText && (
            <PfButton
              size="sm"
              variant="outline"
              onClick={() => {
                const [a, b] = latText.split(",").map((s) => s.trim());
                setLatText(a ?? "");
                setLonText(b ?? "");
              }}
            >
              <Crosshair size={12} /> Split “{latText}” into lat / lon
            </PfButton>
          )}
        </div>

        <div className="min-w-0 space-y-3">
          <Field label="Name">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gabura plot 014" maxLength={120} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
                {meta.data?.assetTypes.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Crop (optional)">
              <select className={inputCls} value={crop} onChange={(e) => setCrop(e.target.value)}>
                <option value="">—</option>
                {meta.data?.crops.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={
                <>
                  Value (USD) <Help text="Your financial exposure at this site: sum insured, loan outstanding, stock or replacement value. Used for value-at-risk." />
                </>
              }
            >
              <input className={inputCls} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder="12,500" />
            </Field>
            <Field label="Your reference">
              <input className={inputCls} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Policy / loan no." maxLength={80} />
            </Field>
          </div>
          <Field label="Tags" hint="Group assets for filters and alert rules (press Enter)">
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-950/60 px-2 py-1.5">
              {tags.map((t) => (
                <TagPill key={t} tag={t} onRemove={() => setTags(tags.filter((x) => x !== t))} />
              ))}
              <input
                className="min-w-[80px] flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
                value={tagText}
                onChange={(e) => setTagText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                onBlur={addTag}
                placeholder={tags.length ? "" : "coastal, parametric…"}
              />
            </div>
          </Field>
          <div className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-[11px] text-slate-400">
            {point ? (
              <>
                Location <span className="telemetry text-slate-200">{point.lat.toFixed(5)}, {point.lon.toFixed(5)}</span>
                {loc?.label && mode === "search" ? <span className="block truncate text-slate-500">{loc.label}</span> : null}
              </>
            ) : (
              "Choose a location on the left."
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
