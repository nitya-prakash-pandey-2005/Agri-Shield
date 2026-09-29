"use client";

/**
 * Shared Simulation Lab UI: method explanations, save dialog, exports
 * (CSV / PDF), "create incident" hand-off, caveats and provenance.
 */
import { useCallback, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type * as Leaflet from "leaflet";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, BookmarkPlus, ChevronDown, FileDown, FileText, Siren, X } from "lucide-react";
import { toast } from "sonner";
import { SourceTag } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { Btn, downloadFile, Field, inputCls, pdfText, toCsv } from "@/components/insurance/kit";
import { trpc } from "@/lib/trpc";

// ─── Method explanations (Explain popovers) ───────────────────────────────

export const METHOD_TEXT = {
  bathtub: {
    title: "Connectivity-aware bathtub model",
    text: "We raise the water level by h metres at the sea and/or the rivers and let it spread over the real terrain (SRTM elevation, ~35 m pixels). Unlike a simple 'everything below h floods' map, water can only reach land that is connected to the source through ground lower than the water — a 2 m embankment keeps a 1 m rise out. One calculation answers every level from 0 to 5 m, which is why the slider is instant.",
  },
  hand: {
    title: "Reference level (HAND)",
    text: "Rise is measured from today's normal water level: mean sea level at the coast, and the bank-full level of each river (never above the dry land next to it). This is the 'Height Above Nearest Drainage' convention used in rapid flood mapping, so +1 m means one metre above normal conditions.",
  },
  depthDamage: {
    title: "Depth–damage curves (JRC 2017)",
    text: "The European Commission's Joint Research Centre published global flood depth–damage functions (Huizinga et al. 2017). For Asia, 1 m of water destroys ~37 % of an agricultural crop's value, ~49 % of a house's and ~48 % of an industrial building's; 2 m destroys ~56 %, 72 % and 72 %. We average the damage over each asset's footprint and multiply by its value on record.",
  },
  ponding: {
    title: "Rainfall ponding",
    text: "Heavy rain that cannot soak in (the 'excess') collects in closed hollows. We find every hollow in the terrain and fill it with the excess rain falling on it and its surroundings (catchment ratio), up to the level where it would spill over.",
  },
  holland: {
    title: "Holland (1980) wind model",
    text: "Cyclone winds are rebuilt from the official best track (position, central pressure, max wind every 6 h) with Holland's parametric vortex: wind rises steeply to a peak at the radius of maximum winds (Rmax, typically 20–50 km) and decays outward. The shape parameter B is tuned so the peak matches the recorded wind; the storm's forward speed adds to winds on the right-hand side (northern hemisphere). Each place keeps the strongest wind it felt — the footprint.",
  },
  surge: {
    title: "Storm-surge index",
    text: "Two effects push sea water ashore: low pressure lifts the sea ~1 cm per hPa (inverse barometer) and onshore wind piles water against the coast (wind set-up ∝ wind² × shelf width ÷ depth). Shallow, wide shelves like the northern Bay of Bengal amplify it. This index ranks coastlines; it ignores tides and waves, so treat it as an order of magnitude.",
  },
  fragility: {
    title: "Wind fragility curves",
    text: "Share of value destroyed as a function of sustained wind (Emanuel 2011 S-curve): nothing below a threshold, 50 % at the 'half-damage' speed, near-total above. Standing crops lodge at 15–20 m/s, rural houses fail around 45–55 m/s, engineered buildings later.",
  },
  ky: {
    title: "Yield response factor Ky (FAO-33)",
    text: "FAO's classic rule: relative yield loss = Ky × relative shortfall in crop water use. Ky > 1 means yield falls faster than water (maize 1.25, sugarcane 1.2, rice ~1.1); Ky < 1 means the crop is tolerant. Irrigation covers part of a rain deficit, and every +1 °C of warming adds a direct heat penalty (rice −3.2 %, wheat −6 %, maize −7.4 % per °C, Zhao et al. 2017).",
  },
} as const;

export function MethodExplain({ k, children }: { k: keyof typeof METHOD_TEXT; children?: ReactNode }) {
  const m = METHOD_TEXT[k];
  return (
    <Explain title={m.title} text={m.text}>
      {children}
    </Explain>
  );
}

// ─── Leaflet handle ───────────────────────────────────────────────────────

export function useMapHandle() {
  const [h, setH] = useState<{ map: Leaflet.Map; L: typeof Leaflet } | null>(null);
  const onReady = useCallback((map: Leaflet.Map, L: typeof Leaflet) => {
    setH({ map, L });
    return () => setH(null);
  }, []);
  return { handle: h, onReady };
}

// ─── Caveats + provenance ─────────────────────────────────────────────────

export function Caveats({ items, sources }: { items: string[]; sources?: { label: string; href?: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-amber-400/15 bg-amber-400/[0.03]">
      <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-amber-200" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <AlertTriangle size={13} /> Uncertainty & limitations ({items.length})
        <ChevronDown size={13} className={`ml-auto transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <ul className="list-disc space-y-1 px-8 pb-3 text-[12px] text-slate-300">
              {items.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
      {sources && (
        <div className="flex flex-wrap gap-1.5 border-t border-amber-400/10 px-3 py-2">
          {sources.map((s) => (
            <SourceTag key={s.label} href={s.href}>
              {s.label.length > 70 ? `${s.label.slice(0, 68)}…` : s.label}
            </SourceTag>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Exports ──────────────────────────────────────────────────────────────

export interface PdfSpec {
  title: string;
  subtitle: string;
  narrative: string;
  kpis: [string, string][];
  table: { head: string[]; body: (string | number)[][] };
  caveats: string[];
  sources: { label: string }[];
  image?: string | null;
}

export async function exportPdf(spec: PdfSpec, filename: string) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(6, 10, 22);
  doc.rect(0, 0, W, 64, "F");
  doc.setTextColor(103, 232, 249);
  doc.setFontSize(9);
  doc.text("AGRI-SHIELD · SIMULATION LAB", 36, 24);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text(pdfText(spec.title), 36, 46);
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(9);
  doc.text(pdfText(spec.subtitle), 36, 82);
  let y = 100;
  doc.setFontSize(10);
  doc.setTextColor(20, 20, 20);
  const lines = doc.splitTextToSize(pdfText(spec.narrative), W - 72);
  doc.text(lines, 36, y);
  y += lines.length * 13 + 8;
  autoTable(doc, { startY: y, head: [["Indicator", "Value"]], body: spec.kpis.map(([a, b]) => [pdfText(a), pdfText(b)]), theme: "grid", styles: { fontSize: 9 }, headStyles: { fillColor: [8, 145, 178] }, margin: { left: 36, right: 36 } });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;
  if (spec.image) {
    try {
      const h = 220;
      doc.addImage(spec.image, "PNG", 36, y, W - 72, h);
      y += h + 12;
    } catch {
      /* image optional */
    }
  }
  autoTable(doc, { startY: y, head: [spec.table.head.map(pdfText)], body: spec.table.body.map((r) => r.map((c) => pdfText(c))), theme: "striped", styles: { fontSize: 8 }, headStyles: { fillColor: [30, 41, 59] }, margin: { left: 36, right: 36 } });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;
  if (y > 700) {
    doc.addPage();
    y = 48;
  }
  doc.setFontSize(9);
  doc.setTextColor(120, 80, 0);
  doc.text("Uncertainty & limitations", 36, y);
  y += 12;
  doc.setTextColor(60, 60, 60);
  for (const c of spec.caveats) {
    const l = doc.splitTextToSize(`- ${pdfText(c)}`, W - 72);
    if (y + l.length * 11 > 800) {
      doc.addPage();
      y = 48;
    }
    doc.text(l, 36, y);
    y += l.length * 11 + 2;
  }
  y += 6;
  doc.setTextColor(100, 100, 100);
  const src = doc.splitTextToSize(`Sources: ${spec.sources.map((s) => pdfText(s.label)).join(" | ")}`, W - 72);
  if (y + src.length * 11 > 800) {
    doc.addPage();
    y = 48;
  }
  doc.text(src, 36, y);
  doc.save(filename);
}

export function exportCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) {
    toast.info("Nothing to export yet");
    return;
  }
  downloadFile(filename, toCsv(rows));
}

// ─── Result action bar ────────────────────────────────────────────────────

export function ResultActions({
  simId,
  defaultName,
  riseM,
  csv,
  pdf,
  incident,
}: {
  simId: string;
  defaultName: string;
  riseM?: number;
  csv: () => void;
  pdf: () => Promise<void>;
  incident: { title: string; summary: string };
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [notes, setNotes] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const utils = trpc.useUtils();
  const save = trpc.simulate.library.save.useMutation({
    onSuccess: () => {
      toast.success("Scenario saved to the library");
      setOpen(false);
      void utils.simulate.library.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const nameRef = useRef<HTMLInputElement>(null);
  const href = `/app/incidents?new=1&title=${encodeURIComponent(incident.title)}&summary=${encodeURIComponent(incident.summary.slice(0, 600))}&source=simulation&simId=${encodeURIComponent(simId)}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Btn
        variant="outline"
        onClick={() => {
          setName(defaultName);
          setOpen(true);
          setTimeout(() => nameRef.current?.select(), 50);
        }}
      >
        <BookmarkPlus size={14} /> Save scenario
      </Btn>
      <Btn variant="outline" onClick={csv}>
        <FileDown size={14} /> CSV
      </Btn>
      <Btn
        variant="outline"
        loading={pdfBusy}
        onClick={async () => {
          setPdfBusy(true);
          try {
            await pdf();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "PDF export failed");
          } finally {
            setPdfBusy(false);
          }
        }}
      >
        <FileText size={14} /> PDF
      </Btn>
      <Link href={href} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[13px] font-medium text-rose-200 transition hover:bg-rose-500/20">
        <Siren size={14} /> Create incident
      </Link>
      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-[1200] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)}>
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Save scenario"
              className="hud-panel w-full max-w-md p-5"
              initial={{ scale: 0.96, y: 8 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 8 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-display text-sm font-semibold text-white">Save to scenario library</h3>
                <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white" aria-label="Close">
                  <X size={16} />
                </button>
              </div>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (name.trim()) save.mutate({ simId, name: name.trim(), notes, riseM });
                }}
              >
                <Field label="Name">
                  <input ref={nameRef} className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
                </Field>
                <Field label="Notes (optional)" hint="Who asked for it, assumptions, next steps…">
                  <textarea className={`${inputCls} h-20 py-2`} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
                </Field>
                <div className="flex justify-end gap-2">
                  <Btn type="button" variant="ghost" onClick={() => setOpen(false)}>
                    Cancel
                  </Btn>
                  <Btn type="submit" loading={save.isPending}>
                    Save
                  </Btn>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Small formatting helpers ─────────────────────────────────────────────

export const ha = (v: number | null | undefined) => (v == null ? "—" : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M ha` : v >= 1e4 ? `${Math.round(v / 1e3).toLocaleString("en-US")}K ha` : `${Math.round(v).toLocaleString("en-US")} ha`);
export const people = (v: number | null | undefined) => (v == null ? "—" : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `${Math.round(v / 1e3)}K` : Math.round(v).toLocaleString("en-US"));
export const TYPE_LABEL: Record<string, string> = {
  farm: "Farm",
  field: "Field",
  warehouse: "Warehouse",
  processing_plant: "Processing plant",
  port: "Port",
  retail_outlet: "Retail outlet",
  insured_plot: "Insured plot",
  loan: "Loan",
  community: "Community",
  office: "Office",
};

export function Chip({ active, onClick, children, title }: { active?: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1.5 text-[12px] transition ${active ? "border-cyan-400/60 bg-cyan-400/15 text-cyan-100" : "border-slate-700/80 text-slate-300 hover:border-slate-500 hover:text-white"}`}
    >
      {children}
    </button>
  );
}
