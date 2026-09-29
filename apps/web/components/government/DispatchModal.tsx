"use client";

/**
 * Dispatch wizard: select resources → destination & source depot → vehicle → confirm.
 * Works for an existing approved request or a fast-track dispatch from a district.
 * Users without approve_resources get a "Submit request" final step instead.
 */
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Check, ChevronLeft, ChevronRight, MapPin, Package, Send, Truck, Warehouse } from "lucide-react";
import { toast } from "sonner";
import type { ResourceType } from "@agri-shield/types";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { HudButton, Skeleton } from "@/components/hud";
import { cn } from "@/lib/utils";
import { useGovInput } from "./scope";
import { ErrorNote, Field, fmtInt, inputCls, KeyValue, Modal, RESOURCE_COLOR, RESOURCE_ICON, selectCls } from "./ui";

type RequestRow = RouterOutputs["government"]["getResourceRequests"][number];

export type DispatchTarget =
  | { kind: "request"; request: RequestRow }
  | { kind: "new"; districtId: string; resourceType?: ResourceType; suggested?: Partial<Record<ResourceType, number>> };

const STEPS = [
  { key: "res", label: "Resources", icon: Package },
  { key: "dest", label: "Destination", icon: MapPin },
  { key: "veh", label: "Vehicle", icon: Truck },
  { key: "ok", label: "Confirm", icon: Check },
] as const;

const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

export function DispatchModal({ open, onClose, target }: { open: boolean; onClose: () => void; target: DispatchTarget | null }) {
  const scope = useGovInput();
  const utils = trpc.useUtils();
  const ctx = trpc.government.getContext.useQuery(scope, { enabled: open });
  const inv = trpc.government.getResourceInventory.useQuery(scope, { enabled: open });
  const canApprove = ctx.data?.permissions.approveResources ?? false;

  const [step, setStep] = useState(0);
  const [type, setType] = useState<ResourceType>("pumps");
  const [qty, setQty] = useState(10);
  const [districtId, setDistrictId] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "critical">("high");
  const [depotName, setDepotName] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [notes, setNotes] = useState("");

  // Reset only when the modal opens or the target identity changes (not on every parent render)
  const targetKey = !target ? "" : target.kind === "request" ? `req:${target.request.id}` : `new:${target.districtId}:${target.resourceType ?? ""}`;
  useEffect(() => {
    if (!open || !target) return;
    setStep(0);
    setVehicleId("");
    setDepotName("");
    setNotes("");
    if (target.kind === "request") {
      setType(target.request.resourceType);
      setQty(target.request.quantity);
      setDistrictId(target.request.targetDistrictId);
      setPriority(target.request.priority);
    } else {
      const t = target.resourceType ?? "pumps";
      setType(t);
      setQty(Math.max(1, target.suggested?.[t] ?? 10));
      setDistrictId(target.districtId);
      setPriority("high");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, targetKey]);

  const row = inv.data?.rows.find((r) => r.type === type);
  const dest = ctx.data?.districts.find((d) => d.id === districtId);
  const depots = useMemo(() => {
    if (!row || !dest) return [];
    return row.depots.map((d) => ({ ...d, km: Math.round(km(d, dest) * 1.3 + 4) })).sort((a, b) => Number(b.quantity >= qty) - Number(a.quantity >= qty) || a.km - b.km);
  }, [row, dest, qty]);
  useEffect(() => {
    if (depots.length && !depots.some((d) => d.name === depotName)) setDepotName(depots.find((d) => d.quantity >= qty)?.name ?? "");
  }, [depots, depotName, qty]);
  const depot = depots.find((d) => d.name === depotName);
  const fleet = useMemo(() => {
    const f = inv.data?.fleet ?? [];
    return [...f].sort((a, b) => Number(!!a.busyWith) - Number(!!b.busyWith) || Number(b.homeDistrictId === depot?.districtId) - Number(a.homeDistrictId === depot?.districtId));
  }, [inv.data, depot]);
  const vehicle = fleet.find((v) => v.id === vehicleId);
  const eta = depot && vehicle ? Math.round((depot.km / vehicle.speedKmh + 0.75) * 10) / 10 : null;

  const invalidate = () => {
    void utils.government.getResourceRequests.invalidate();
    void utils.government.getResourceInventory.invalidate();
    void utils.government.getShortages.invalidate();
    void utils.government.getOverview.invalidate();
    void utils.government.getDistrict.invalidate();
    void utils.government.getContext.invalidate();
  };
  const dispatch = trpc.government.dispatchResources.useMutation({
    onSuccess: (r) => {
      toast.success(`Dispatched ${r.request.quantity} ${row?.label ?? type} → ${dest?.name}`, { description: `${r.distanceKm} km · ETA ${r.etaHours} h · ${r.request.vehicle}` });
      invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const request = trpc.government.requestResources.useMutation({
    onSuccess: (r) => {
      toast.success(`Request ${r.id} submitted for approval`);
      invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const locked = target?.kind === "request";
  const canNext = [qty > 0 && !!row, !!dest && (!canApprove || !!depot), !canApprove || (!!vehicle && !vehicle.busyWith), true][step];

  const submit = () => {
    if (!target) return;
    if (!canApprove) {
      request.mutate({ ...scope, resourceType: type, quantity: qty, targetDistrictId: districtId, priority, notes: notes || undefined });
      return;
    }
    dispatch.mutate({
      ...scope,
      depotName,
      vehicleId,
      ...(target.kind === "request" ? { requestId: target.request.id } : { create: { resourceType: type, quantity: qty, targetDistrictId: districtId, priority, notes: notes || undefined } }),
    });
  };

  const Icon = RESOURCE_ICON[type] ?? Package;
  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-3xl"
      title={target?.kind === "request" ? `Dispatch request ${target.request.id}` : "Dispatch resources"}
      subtitle={canApprove ? "Select resources → destination → vehicle → confirm. Inventory moves to deployed on confirm." : "You can submit a request; a regional or national admin approves dispatch."}
      footer={
        <>
          <HudButton variant="ghost" onClick={() => (step ? setStep(step - 1) : onClose())}>
            <ChevronLeft size={14} /> {step ? "Back" : "Cancel"}
          </HudButton>
          {step < STEPS.length - 1 ? (
            <HudButton onClick={() => setStep(step + 1)} disabled={!canNext}>
              Next <ChevronRight size={14} />
            </HudButton>
          ) : (
            <HudButton onClick={submit} disabled={dispatch.isPending || request.isPending}>
              <Send size={14} /> {canApprove ? (dispatch.isPending ? "Dispatching…" : "Confirm dispatch") : request.isPending ? "Submitting…" : "Submit request"}
            </HudButton>
          )}
        </>
      }
    >
      {/* Stepper */}
      <ol className="mb-5 grid grid-cols-4 gap-2">
        {STEPS.map((s, i) => {
          const SIcon = s.icon;
          const done = i < step;
          const active = i === step;
          return (
            <li key={s.key} className="relative">
              <div className={cn("flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[11px]", active ? "border-emerald-500/60 bg-emerald-500/10 text-white" : done ? "border-emerald-500/20 text-emerald-300" : "border-white/5 text-slate-500")}>
                <span className={cn("grid h-5 w-5 place-items-center rounded-full text-[10px]", active || done ? "bg-emerald-500 text-slate-950" : "bg-slate-800")}>
                  {done ? <Check size={11} /> : <SIcon size={11} />}
                </span>
                <span className="hidden sm:inline telemetry uppercase tracking-wider">{s.label}</span>
              </div>
              {active && <motion.div layoutId="dispatch-step" className="absolute -bottom-1 left-3 right-3 h-0.5 rounded bg-emerald-400" />}
            </li>
          );
        })}
      </ol>

      {!inv.data || !ctx.data ? (
        <div className="space-y-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-24" />
        </div>
      ) : (
        <motion.div key={step} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }}>
          {step === 0 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {inv.data.rows.map((r) => {
                  const RI = RESOURCE_ICON[r.type] ?? Package;
                  const sel = r.type === type;
                  return (
                    <button
                      key={r.type}
                      disabled={locked}
                      onClick={() => {
                        setType(r.type);
                        if (target?.kind === "new") setQty(Math.max(1, target.suggested?.[r.type] ?? qty));
                      }}
                      className={cn("rounded-xl border p-3 text-left transition", sel ? "border-emerald-500/60 bg-emerald-500/10" : "border-white/5 hover:border-white/20", locked && !sel && "opacity-30")}
                    >
                      <RI size={16} style={{ color: RESOURCE_COLOR[r.type] }} />
                      <div className="mt-2 text-xs font-medium text-slate-100">{r.label}</div>
                      <div className="telemetry text-[10px] text-slate-400">
                        {fmtInt(r.available)} {r.unit} free
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label={`Quantity (${row?.unit ?? "units"})`} hint={target?.kind === "new" && target.suggested?.[type] ? `Modelled gap for this district: ${fmtInt(target.suggested[type])}` : undefined}>
                  <input type="number" min={1} value={qty} disabled={locked} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} className={inputCls} />
                </Field>
                <Field label="Priority">
                  <select value={priority} disabled={locked} onChange={(e) => setPriority(e.target.value as typeof priority)} className={selectCls}>
                    {["low", "medium", "high", "critical"].map((p) => (
                      <option key={p} value={p} className="bg-slate-900">
                        {p}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              {row && qty > row.available && <ErrorNote error={{ message: `Only ${fmtInt(row.available)} ${row.unit} available organisation-wide — consider a partial dispatch.` }} />}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <Field label="Destination district">
                <select value={districtId} disabled={locked || target?.kind === "new"} onChange={(e) => setDistrictId(e.target.value)} className={selectCls}>
                  {ctx.data.districts.map((d) => (
                    <option key={d.id} value={d.id} className="bg-slate-900">
                      {d.name} — {d.riskLevel}
                    </option>
                  ))}
                </select>
              </Field>
              {canApprove && (
                <div>
                  <div className="hud-label mb-2">Source depot (sorted by stock sufficiency, then road distance)</div>
                  <div className="space-y-1.5">
                    {depots.map((d) => {
                      const ok = d.quantity >= qty;
                      const sel = d.name === depotName;
                      return (
                        <button
                          key={d.name}
                          disabled={!ok}
                          onClick={() => setDepotName(d.name)}
                          className={cn("flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-xs transition", sel ? "border-emerald-500/60 bg-emerald-500/10" : "border-white/5 hover:border-white/20", !ok && "opacity-40")}
                        >
                          <Warehouse size={14} className="text-emerald-400" />
                          <span className="flex-1 text-slate-100">{d.name}</span>
                          <span className="telemetry text-slate-400">{d.km} km</span>
                          <span className={cn("telemetry w-28 text-right", ok ? "text-emerald-300" : "text-rose-300")}>
                            {fmtInt(d.quantity)} {row?.unit}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {!depots.some((d) => d.quantity >= qty) && <ErrorNote className="mt-2" error={{ message: "No single depot holds this quantity — reduce the quantity or split the dispatch." }} />}
                </div>
              )}
              <Field label="Notes (optional)">
                <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Deliver to Union Parishad office, Babuganj" className={inputCls} />
              </Field>
            </div>
          )}

          {step === 2 &&
            (canApprove ? (
              <div className="grid sm:grid-cols-2 gap-2">
                {fleet.map((v) => {
                  const sel = v.id === vehicleId;
                  return (
                    <button
                      key={v.id}
                      disabled={!!v.busyWith}
                      onClick={() => setVehicleId(v.id)}
                      className={cn("rounded-lg border px-3 py-2.5 text-left text-xs transition", sel ? "border-emerald-500/60 bg-emerald-500/10" : "border-white/5 hover:border-white/20", v.busyWith && "opacity-40")}
                    >
                      <div className="flex items-center gap-2">
                        <Truck size={13} className="text-cyan-400" />
                        <span className="font-medium text-slate-100">{v.label}</span>
                      </div>
                      <div className="mt-1 flex justify-between telemetry text-[10px] text-slate-400">
                        <span>
                          {v.homeDistrict} · {v.capacity}
                        </span>
                        <span className={v.busyWith ? "text-amber-300" : "text-emerald-300"}>{v.busyWith ? `ON ${v.busyWith}` : `${v.speedKmh} km/h`}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-400">Vehicle assignment is done by the approving officer after your request is approved.</p>
            ))}

          {step === 3 && (
            <div className="grid sm:grid-cols-[auto,1fr] gap-5">
              <div className="grid h-24 w-24 place-items-center rounded-2xl" style={{ background: `${RESOURCE_COLOR[type]}1a` }}>
                <Icon size={36} style={{ color: RESOURCE_COLOR[type] }} />
              </div>
              <div className="space-y-2">
                <KeyValue k="Resource" v={`${fmtInt(qty)} ${row?.unit} · ${row?.label}`} />
                <KeyValue k="Destination" v={dest?.name} />
                <KeyValue k="Priority" v={priority.toUpperCase()} />
                {canApprove && (
                  <>
                    <KeyValue k="From depot" v={depot ? `${depot.name} (${fmtInt(depot.quantity)} → ${fmtInt(depot.quantity - qty)})` : "—"} />
                    <KeyValue k="Vehicle" v={vehicle?.label ?? "—"} />
                    <KeyValue k="Road distance · ETA" v={depot && eta ? `${depot.km} km · ${eta} h` : "—"} />
                    <KeyValue k="Org inventory after" v={row ? `${fmtInt(row.available - qty)} ${row.unit} free (${Math.round(((row.available - qty) / Math.max(1, row.total)) * 100)}%)` : "—"} />
                  </>
                )}
                {notes && <KeyValue k="Notes" v={notes} />}
                <ErrorNote error={dispatch.error ?? request.error} />
              </div>
            </div>
          )}
        </motion.div>
      )}
    </Modal>
  );
}
