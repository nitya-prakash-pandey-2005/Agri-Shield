"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Lock, Minus, Plus, Trash2, UserCog } from "lucide-react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { EmptyState, Panel, Skeleton } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { Btn, Field, Modal, inputCls } from "@/components/workspace/ui";
import { Hint, Pill, toastErr } from "./shared";
import { cn } from "@/lib/utils";

type Roles = RouterOutputs["developer"]["security"]["roles"];
type Perm = Roles["permissions"][number]["id"];

function Cell({ on, locked, editable, onToggle, label }: { on: boolean; locked?: boolean; editable: boolean; onToggle?: () => void; label: string }) {
  if (!editable || locked)
    return (
      <span className={cn("mx-auto grid h-6 w-6 place-items-center rounded-md", on ? "bg-emerald-400/10 text-emerald-300" : "text-slate-600")} aria-label={`${label}: ${on ? "allowed" : "not allowed"}`}>
        {locked && on ? <Lock size={11} /> : on ? <Check size={13} /> : <Minus size={12} />}
      </span>
    );
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={cn("mx-auto grid h-6 w-6 place-items-center rounded-md border transition-all", on ? "border-cyan-400/60 bg-cyan-400/20 text-cyan-200 shadow-[0_0_10px_-2px_rgba(56,189,248,0.7)]" : "border-slate-600 text-transparent hover:border-cyan-400/50")}
    >
      <Check size={13} />
    </button>
  );
}

export function RolesPanel({ onChanged }: { onChanged: () => void }) {
  const utils = trpc.useUtils();
  const q = trpc.developer.security.roles.useQuery();
  const update = trpc.developer.security.updateRole.useMutation();
  const del = trpc.developer.security.deleteRole.useMutation();
  const create = trpc.developer.security.createRole.useMutation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [clone, setClone] = useState("");
  const refresh = () => {
    void utils.developer.security.roles.invalidate();
    void utils.developer.security.members.invalidate();
    onChanged();
  };

  const d = q.data;
  if (!d) return <Skeleton className="h-72" />;

  const toggle = async (roleId: string, kind: "perm" | "module", id: string, current: string[]) => {
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    try {
      await update.mutateAsync(kind === "perm" ? { id: roleId, permissions: next as Perm[] } : { id: roleId, modules: next });
      refresh();
    } catch (e) {
      toastErr(e);
    }
  };

  const columns = [...d.builtIn.map((r) => ({ ...r, custom: false as const, baseLabel: "", membersList: [] as { id: string; name: string }[] })), ...d.custom.map((r) => ({ id: r.id, name: r.name, description: r.description, admin: false, permissions: r.permissions as string[], modules: r.modules, members: r.members.length, custom: true as const, baseLabel: r.baseLabel, membersList: r.members }))];

  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          Roles &amp; permissions <Explain text="Built-in roles are fixed. Clone one to make a custom role, then toggle exactly which permissions and workspace modules it includes. Enforced on the server for every API call, not just hidden in the menu." title="Custom roles" />
        </span>
      }
      subtitle={`${d.builtIn.length} built-in · ${d.custom.length} custom`}
      icon={UserCog}
      accent="violet"
      actions={
        <Btn className="h-8 px-2.5 py-0 text-xs" onClick={() => (setName(""), setDesc(""), setClone(d.builtIn.find((r) => !r.admin)?.id ?? d.builtIn[0]!.id), setOpen(true))}>
          <Plus size={13} /> New role
        </Btn>
      }
    >
      <div className="-mx-4 overflow-x-auto px-4 pb-1">
        <table className="w-full min-w-[640px] border-separate border-spacing-0 text-[12.5px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 w-56 bg-[#0b1325] lg:static lg:bg-transparent py-2 pr-3 text-left align-bottom font-normal text-slate-500">
                <span className="hud-label">Capability</span>
              </th>
              {columns.map((c) => (
                <th key={c.id} className={cn("min-w-[112px] px-2 py-2 text-center align-bottom font-normal", c.custom && "rounded-t-lg bg-violet-500/[0.06]")}>
                  <div className="text-[12.5px] font-medium text-slate-100">{c.name}</div>
                  <div className="mt-0.5 flex flex-wrap justify-center gap-1">
                    {c.custom ? <Pill tone="violet">from {c.baseLabel}</Pill> : <Pill>{c.admin ? "built-in · admin" : "built-in"}</Pill>}
                  </div>
                  <div className="mt-1 text-[10.5px] text-slate-500">
                    {c.members} member{c.members === 1 ? "" : "s"}
                  </div>
                  {c.custom && (
                    <button
                      className="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-slate-500 hover:bg-rose-500/10 hover:text-rose-300"
                      onClick={async () => {
                        if (!window.confirm(`Delete "${c.name}"? ${c.members} member(s) go back to their built-in role.`)) return;
                        try {
                          const r = await del.mutateAsync({ id: c.id });
                          toast.success(`Role deleted · ${r.reverted} member(s) reverted`);
                          refresh();
                        } catch (e) {
                          toastErr(e);
                        }
                      }}
                    >
                      <Trash2 size={10} /> Delete
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={columns.length + 1} className="hud-label pb-1 pt-3 text-cyan-300/70">
                Permissions
              </td>
            </tr>
            {d.permissions.map((p) => (
              <tr key={p.id} className="group">
                <td className="sticky left-0 z-10 border-t border-white/5 bg-[#0b1325] lg:static lg:bg-transparent py-2 pr-3">
                  <div className="text-slate-200">{p.label}</div>
                  <div className="text-[10.5px] leading-snug text-slate-500">{p.description}</div>
                </td>
                {columns.map((c) => (
                  <td key={c.id} className={cn("border-t border-white/5 px-2 py-2 text-center", c.custom && "bg-violet-500/[0.06]")}>
                    <Cell on={c.permissions.includes(p.id)} locked={!!p.locked} editable={c.custom} label={`${c.name} · ${p.label}`} onToggle={() => toggle(c.id, "perm", p.id, c.permissions)} />
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td colSpan={columns.length + 1} className="hud-label pb-1 pt-4 text-cyan-300/70">
                Workspace modules
              </td>
            </tr>
            {d.modules.map((m) => (
              <tr key={m.id}>
                <td className="sticky left-0 z-10 border-t border-white/5 bg-[#0b1325] lg:static lg:bg-transparent py-1.5 pr-3 text-slate-200">{m.label}</td>
                {columns.map((c) => (
                  <td key={c.id} className={cn("border-t border-white/5 px-2 py-1.5 text-center", c.custom && "bg-violet-500/[0.06]")}>
                    <Cell on={c.modules.includes(m.id)} editable={c.custom} label={`${c.name} · ${m.label}`} onToggle={() => toggle(c.id, "module", m.id, c.modules)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {d.custom.length === 0 && (
        <div className="mt-3">
          <EmptyState icon={Copy} title="No custom roles yet">
            Example: clone “Analyst” into a <b>Claims reviewer</b> that can use Portfolio and Insurance but not Lending, or a read-only <b>Auditor</b> without asset management.
          </EmptyState>
        </div>
      )}
      <div className="mt-3">
        <Hint>A custom role can never grant more than this workspace's own admin role (for example, government permissions can't be given inside a bank workspace). “Use the workspace” is always on. Assign roles in the Members table.</Hint>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New custom role"
        footer={
          <>
            <Btn variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Btn>
            <Btn
              disabled={name.trim().length < 2 || create.isPending}
              onClick={async () => {
                try {
                  await create.mutateAsync({ name: name.trim(), description: desc.trim(), cloneFrom: clone });
                  toast.success(`Role “${name.trim()}” created — toggle its permissions in the matrix`);
                  setOpen(false);
                  refresh();
                } catch (e) {
                  toastErr(e);
                }
              }}
            >
              <Plus size={14} /> Create role
            </Btn>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Role name">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Claims reviewer" autoFocus maxLength={40} />
          </Field>
          <Field label="Start from (clone)" hint="The new role starts with exactly the same permissions and modules; you then switch off what it shouldn't have.">
            <select className={inputCls} value={clone} onChange={(e) => setClone(e.target.value)}>
              <optgroup label="Built-in">
                {d.builtIn.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </optgroup>
              {d.custom.length > 0 && (
                <optgroup label="Custom">
                  {d.custom.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </Field>
          <Field label="Description (optional)">
            <input className={inputCls} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={200} placeholder="What this role is for" />
          </Field>
        </div>
      </Modal>
    </Panel>
  );
}
