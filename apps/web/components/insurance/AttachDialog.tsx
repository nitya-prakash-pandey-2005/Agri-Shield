"use client";

/** Attach / detach a parametric product to insured plots (tags them "parametric"). */
import { AnimatePresence, motion } from "framer-motion";
import { Check, Link2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Btn, inputCls, Select, usd } from "./kit";

export default function AttachDialog({ open, onClose, productId, productName }: { open: boolean; onClose: () => void; productId: string | null; productName: string }) {
  const utils = trpc.useUtils();
  const plots = trpc.insurance.plots.useQuery(undefined, { enabled: open });
  const [district, setDistrict] = useState("");
  const [kind, setKind] = useState<"all" | "weather" | "unattached">("all");
  const [search, setSearch] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (open && plots.data) setSel(new Set(plots.data.filter((p) => p.productId === productId && productId).map((p) => p.id)));
  }, [open, plots.data, productId]);
  const attach = trpc.insurance.attach.useMutation({
    onSuccess: (r, v) => {
      toast.success(v.productId ? `Attached to ${r.updated} insured units` : `Detached ${r.updated} insured units`);
      utils.insurance.plots.invalidate();
      utils.insurance.products.invalidate();
      utils.insurance.monitor.invalidate();
      utils.insurance.book.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const districts = useMemo(() => [...new Set((plots.data ?? []).map((p) => p.district))].sort(), [plots.data]);
  const rows = (plots.data ?? []).filter(
    (p) => (!district || p.district === district) && (kind === "all" || (kind === "weather" ? p.product.startsWith("Weather") : !p.productId)) && (!search || `${p.name} ${p.ref}`.toLowerCase().includes(search.toLowerCase()))
  );
  const selectedSi = (plots.data ?? []).filter((p) => sel.has(p.id)).reduce((t, p) => t + p.sumInsuredUsd, 0);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[1000] grid place-items-center bg-black/60 p-3 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div role="dialog" aria-modal className="hud-panel flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden" initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 16, opacity: 0 }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <div>
                <div className="font-display text-[15px] font-semibold text-white">Attach “{productName}”</div>
                <div className="text-[12px] text-slate-400">Selected plots get this cover, the “parametric” tag and appear in the live trigger monitor.</div>
              </div>
              <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-slate-400 hover:bg-white/5">
                <X size={16} />
              </button>
            </div>
            <div className="grid gap-2 border-b border-slate-800 px-4 py-2.5 sm:grid-cols-3">
              <Select value={district} onChange={setDistrict} options={[{ value: "", label: "All districts" }, ...districts.map((d) => ({ value: d, label: d }))]} ariaLabel="District" />
              <Select value={kind} onChange={setKind} options={[{ value: "all", label: "All insured units" }, { value: "weather", label: "Weather-index policies" }, { value: "unattached", label: "No parametric cover yet" }]} ariaLabel="Insured unit filter" />
              <input className={inputCls} placeholder="Search name / policy no." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="flex items-center justify-between px-4 py-1.5 text-[12px] text-slate-400">
              <span>
                {rows.length} shown · <b className="text-slate-200">{sel.size}</b> selected ({usd(selectedSi)} insured)
              </span>
              <span className="flex gap-3">
                <button className="hover:text-white" onClick={() => setSel((s) => new Set([...s, ...rows.map((r) => r.id)]))}>
                  Select shown
                </button>
                <button className="hover:text-white" onClick={() => setSel(new Set())}>
                  Clear
                </button>
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-2">
              <table className="w-full text-[12.5px]">
                <tbody>
                  {rows.map((p) => {
                    const on = sel.has(p.id);
                    return (
                      <tr key={p.id} className={cn("cursor-pointer border-b border-slate-800/60 hover:bg-white/[0.03]", on && "bg-cyan-400/[0.06]")} onClick={() => setSel((s) => (s.has(p.id) ? (s.delete(p.id), new Set(s)) : new Set(s.add(p.id))))}>
                        <td className="w-8 py-1.5 pl-2">
                          <span className={cn("grid h-4 w-4 place-items-center rounded border", on ? "border-cyan-400 bg-cyan-400 text-slate-950" : "border-slate-600")}>{on && <Check size={11} />}</span>
                        </td>
                        <td className="py-1.5">
                          <div className="text-slate-200">{p.name}</div>
                          <div className="text-[11px] text-slate-500">
                            {p.ref} · {p.district}, {p.country} · {p.crop}
                          </div>
                        </td>
                        <td className="hidden py-1.5 text-slate-400 sm:table-cell">{p.productName ?? p.product}</td>
                        <td className="py-1.5 pr-2 text-right telemetry text-slate-300">{usd(p.sumInsuredUsd)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-800 px-4 py-3">
              <Btn variant="outline" disabled={!sel.size || attach.isPending} onClick={() => attach.mutate({ productId: null, assetIds: [...sel] })}>
                Detach selected
              </Btn>
              <Btn loading={attach.isPending} disabled={!sel.size || !productId} onClick={() => productId && attach.mutate({ productId, assetIds: [...sel] })}>
                <Link2 size={13} /> Attach to {sel.size} plots
              </Btn>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
