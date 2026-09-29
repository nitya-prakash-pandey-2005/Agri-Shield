"use client";

/**
 * Stakeholder updates: draft → publish to the public status page (/s/<slug>) and optionally
 * e-mail / SMS subscribers. Shows when the next update is due for the incident's severity.
 */
import { useEffect, useState } from "react";
import { Copy, ExternalLink, Globe, Mail, Megaphone, MessageSquareText, Send, Sparkles, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { PfButton, Toggle } from "@/components/portfolio/ui";
import { relTime } from "@/components/collab/shared";
import { Explain } from "@/components/help/Explain";
import { STATUS_META, SEVERITY_META } from "./meta";

type Detail = RouterOutputs["incidents"]["get"];

export function StakeholderComms({ inc, readOnly }: { inc: Detail; readOnly?: boolean }) {
  const utils = trpc.useUtils();
  const refresh = () => utils.incidents.get.invalidate({ id: inc.id });
  const save = trpc.incidents.saveUpdate.useMutation();
  const publish = trpc.incidents.publishUpdate.useMutation();
  const delDraft = trpc.incidents.deleteDraft.useMutation();
  const setPublic = trpc.incidents.setPublic.useMutation();
  const addSub = trpc.incidents.addSubscriber.useMutation();
  const draft = inc.updates.find((u) => u.state === "draft");
  const [title, setTitle] = useState(draft?.title ?? "");
  const [body, setBody] = useState(draft?.body ?? "");
  const [channels, setChannels] = useState<("page" | "email" | "sms")[]>(draft?.channels ?? ["page", "email"]);
  const [suggest, setSuggest] = useState(false);
  const [subAddr, setSubAddr] = useState("");
  const suggestion = trpc.incidents.suggestUpdate.useQuery({ id: inc.id }, { enabled: suggest });

  useEffect(() => {
    if (suggestion.data && suggest) {
      setTitle(suggestion.data.title);
      setBody(suggestion.data.body);
      setSuggest(false);
    }
  }, [suggestion.data, suggest]);

  const published = inc.updates.filter((u) => u.state === "published").sort((a, b) => new Date(b.publishedAt!).getTime() - new Date(a.publishedAt!).getTime());
  const url = typeof window !== "undefined" ? `${window.location.origin}${inc.publicPath}` : inc.publicPath;
  const dueIn = inc.nextUpdateDueAt ? new Date(inc.nextUpdateDueAt).getTime() - Date.now() : null;

  const toggle = (c: "page" | "email" | "sms") => setChannels((cur) => (c === "page" ? cur : cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));

  const doSave = async () => {
    const u = await save.mutateAsync({ id: inc.id, updateId: draft?.id ?? null, title, body, channels: ["page", ...channels.filter((c) => c !== "page")] });
    void refresh();
    return u;
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/5 bg-slate-950/40 px-3 py-2 text-xs">
        <Globe size={14} className={inc.publicEnabled ? "text-emerald-400" : "text-slate-500"} />
        <span className="min-w-0 flex-1">
          <span className="block text-slate-200">
            Public status page{" "}
            <Explain text="A read-only page anyone with the link can open — partners, regulators, farmer groups. It shows the status, affected area and your published updates only: no asset names, values, people or internal notes." />
          </span>
          <a href={inc.publicPath} target="_blank" rel="noreferrer" className="telemetry truncate text-[10.5px] text-sky-300 hover:underline">
            {inc.publicPath}
          </a>
        </span>
        <button
          className="rounded p-1 text-slate-400 hover:text-white"
          aria-label="Copy link"
          onClick={() => {
            void navigator.clipboard?.writeText(url);
            toast.success("Status page link copied");
          }}
        >
          <Copy size={13} />
        </button>
        <a href={inc.publicPath} target="_blank" rel="noreferrer" className="rounded p-1 text-slate-400 hover:text-white" aria-label="Open status page">
          <ExternalLink size={13} />
        </a>
        <Toggle
          checked={inc.publicEnabled}
          disabled={readOnly}
          label="Public page"
          onChange={async (v) => {
            await setPublic.mutateAsync({ id: inc.id, enabled: v }).catch((e) => toast.error(e.message));
            void refresh();
          }}
        />
      </div>

      {dueIn != null && (
        <p className={cn("text-[11px]", dueIn < 0 ? "text-rose-300" : "text-slate-500")}>
          <Megaphone size={11} className="mr-1 inline" />
          {inc.severity} cadence: an update every {SEVERITY_META[inc.severity].updateEveryHours} h —{" "}
          {dueIn < 0 ? `next update is ${Math.round(-dueIn / 3_600_000)} h overdue` : `next due in ${Math.max(1, Math.round(dueIn / 3_600_000))} h`}.
        </p>
      )}

      {!readOnly && (
        <div className="space-y-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.03] p-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-amber-200/90">{draft ? "Draft update" : "New update"}</span>
            <button onClick={() => setSuggest(true)} className="ml-auto inline-flex items-center gap-1 text-[11px] text-amber-200/80 hover:text-amber-100" disabled={suggestion.isFetching}>
              <Sparkles size={11} /> {suggestion.isFetching ? "Drafting…" : "Draft from incident"}
            </button>
          </div>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`${STATUS_META[inc.status].label}: short headline`} className="w-full rounded-lg border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-amber-300/60 focus:outline-none" aria-label="Update headline" />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} placeholder="What we know · what we're doing · what people should do · when the next update comes" className="w-full rounded-lg border border-slate-700/80 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-amber-300/60 focus:outline-none" aria-label="Update body" />
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1 text-emerald-300">
              <Globe size={11} /> Status page
            </span>
            <label className="inline-flex cursor-pointer items-center gap-1">
              <input type="checkbox" checked={channels.includes("email")} onChange={() => toggle("email")} className="accent-sky-400" />
              <Mail size={11} /> E-mail ({inc.subscriberCounts.email})
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1">
              <input type="checkbox" checked={channels.includes("sms")} onChange={() => toggle("sms")} className="accent-sky-400" />
              <MessageSquareText size={11} /> SMS ({inc.subscriberCounts.sms})
            </label>
            <span className="ml-auto flex gap-2">
              {draft && (
                <button
                  aria-label="Discard draft"
                  className="text-slate-500 hover:text-rose-300"
                  onClick={async () => {
                    await delDraft.mutateAsync({ id: inc.id, updateId: draft.id }).catch(() => null);
                    setTitle("");
                    setBody("");
                    void refresh();
                  }}
                >
                  <Trash2 size={13} />
                </button>
              )}
              <PfButton size="sm" variant="outline" disabled={!body.trim()} loading={save.isPending} onClick={() => void doSave().then(() => toast.success("Draft saved")).catch((e) => toast.error(e.message))}>
                Save draft
              </PfButton>
              <PfButton
                size="sm"
                disabled={!body.trim()}
                loading={publish.isPending}
                onClick={async () => {
                  try {
                    const u = await doSave();
                    const p = await publish.mutateAsync({ id: inc.id, updateId: u.id });
                    toast.success("Update published", { description: `Live on the status page${p.deliveries.email + p.deliveries.sms ? ` · sent to ${p.deliveries.email} e-mail / ${p.deliveries.sms} SMS` : ""}` });
                    setTitle("");
                    setBody("");
                    void refresh();
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
              >
                <Send size={12} /> Publish
              </PfButton>
            </span>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {published.map((u) => (
          <div key={u.id} className="rounded-lg border border-white/5 bg-slate-950/40 p-3">
            <div className="flex flex-wrap items-center gap-2 text-[10.5px] text-slate-500">
              <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: `${STATUS_META[u.status].color}1f`, color: STATUS_META[u.status].color }}>
                {STATUS_META[u.status].label}
              </span>
              <span>{relTime(u.publishedAt!)}</span>
              <span>by {u.createdByName}</span>
              {u.deliveries.email + u.deliveries.sms > 0 && (
                <span className="ml-auto">
                  ✉ {u.deliveries.email} · SMS {u.deliveries.sms}
                </span>
              )}
            </div>
            <div className="mt-1 text-[13px] font-medium text-slate-100">{u.title}</div>
            <p className="mt-0.5 line-clamp-4 whitespace-pre-line text-xs text-slate-400">{u.body}</p>
          </div>
        ))}
        {!published.length && <p className="text-xs text-slate-500">Nothing published yet. SEV1/SEV2 incidents should publish a first update within the hour.</p>}
      </div>

      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const a = subAddr.trim();
          if (!a) return;
          try {
            await addSub.mutateAsync({ id: inc.id, kind: a.includes("@") ? "email" : "sms", address: a });
            setSubAddr("");
            toast.success("Subscriber added");
            void refresh();
          } catch (err) {
            toast.error((err as Error).message);
          }
        }}
      >
        <input value={subAddr} onChange={(e) => setSubAddr(e.target.value)} placeholder="Add subscriber: e-mail or +phone" className="min-w-0 flex-1 rounded-lg border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-sky-400/70 focus:outline-none" aria-label="Subscriber e-mail or phone" disabled={readOnly} />
        <PfButton size="sm" variant="outline" type="submit" disabled={readOnly || !subAddr.trim()} loading={addSub.isPending}>
          <UserPlus size={12} /> Add
        </PfButton>
      </form>
      {inc.subscribers.length > 0 && <p className="text-[10.5px] text-slate-500">Subscribers: {inc.subscribers.map((s) => s.address).join(", ")}</p>}
    </div>
  );
}
