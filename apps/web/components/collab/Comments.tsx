"use client";

/**
 * <Comments entityType="incident" entityId={id} />
 *
 * Reusable discussion thread for any workspace entity ("incident" | "asset" | "rule" |
 * "scenario" | "report" | "firing"). Type "@" to mention a teammate — they get an in-app
 * notification (bell) with a deep link back here. Live: new comments from teammates appear
 * without refresh, and "Sharmin is typing…" shows while someone writes.
 *
 * Portfolio / Alerts can embed it as-is, e.g. in the asset drawer:
 *   import { Comments } from "@/components/collab";
 *   <Comments entityType="asset" entityId={asset.id} title="Team notes" />
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AtSign, MessageSquare, Pencil, Send, Trash2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { useRoomEvents } from "./useRoomEvents";
import { cn } from "@/lib/utils";
import { Avatar } from "./Avatar";
import { relTime, splitMentions } from "./shared";

type EntityType = "incident" | "asset" | "rule" | "scenario" | "report" | "firing";
type Member = RouterOutputs["incidents"]["collab"]["members"][number];

export function CommentBody({ body, meId }: { body: string; meId?: string | null }) {
  return (
    <span className="whitespace-pre-wrap break-words">
      {splitMentions(body).map((p, i) =>
        p.kind === "text" ? (
          <span key={i}>{p.text}</span>
        ) : (
          <span key={i} className={cn("rounded px-1 font-medium", p.userId === meId ? "bg-amber-400/20 text-amber-200" : "bg-sky-400/15 text-sky-200")}>
            @{p.name}
          </span>
        )
      )}
    </span>
  );
}

function useTyping(room: string, meId: string | null | undefined, orgId: string | null | undefined) {
  const [typers, setTypers] = useState<Record<string, { name: string; at: number }>>({});
  useRoomEvents([orgId ? `presence:${orgId}:${room}` : "none"], (env) => {
    const ev = env.event as { type: string; room?: string; userId?: string; name?: string; typing?: boolean };
    if (ev.type !== "presence.typing" || ev.room !== room || !ev.userId || ev.userId === meId) return;
    setTypers((t) => {
      const n = { ...t };
      if (ev.typing) n[ev.userId!] = { name: ev.name ?? "Someone", at: Date.now() };
      else delete n[ev.userId!];
      return n;
    });
  });
  useEffect(() => {
    const t = setInterval(() => setTypers((cur) => Object.fromEntries(Object.entries(cur).filter(([, v]) => Date.now() - v.at < 6000))), 2000);
    return () => clearInterval(t);
  }, []);
  return Object.values(typers).map((t) => t.name.split(" ")[0]);
}

export function Comments({ entityType, entityId, title = "Discussion", placeholder, className, maxHeight = 420 }: { entityType: EntityType; entityId: string; title?: string; placeholder?: string; className?: string; maxHeight?: number }) {
  const { data: session } = useSession();
  const meId = session?.user?.id;
  const orgId = session?.user?.orgId;
  const room = `${entityType}:${entityId}`;
  const utils = trpc.useUtils();
  const list = trpc.incidents.collab.comments.useQuery({ entityType, entityId }, { enabled: !!entityId });
  const members = trpc.incidents.collab.members.useQuery(undefined, { staleTime: 300_000 });
  const add = trpc.incidents.collab.addComment.useMutation();
  const edit = trpc.incidents.collab.editComment.useMutation();
  const del = trpc.incidents.collab.deleteComment.useMutation();
  const typingM = trpc.incidents.collab.typing.useMutation();
  const typers = useTyping(room, meId, orgId);

  const [text, setText] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [menu, setMenu] = useState<{ query: string; start: number; index: number } | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const lastTyping = useRef(0);
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  useRoomEvents([orgId ? `ws:${orgId}` : "none"], (env) => {
    const ev = env.event as { type: string; entityType?: string; entityId?: string; commentId?: string; authorId?: string };
    if ((ev.type === "comment.created" || ev.type === "comment.changed") && ev.entityType === entityType && ev.entityId === entityId) {
      if (ev.type === "comment.created" && ev.authorId !== meId && ev.commentId) setFresh((s) => new Set(s).add(ev.commentId!));
      void utils.incidents.collab.comments.invalidate({ entityType, entityId });
    }
  });

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [list.data?.length]);

  const options = useMemo(() => {
    if (!menu || !members.data) return [];
    const q = menu.query.toLowerCase();
    return members.data.filter((m) => m.id !== meId && (!q || m.name.toLowerCase().includes(q) || m.handle.includes(q))).slice(0, 6);
  }, [menu, members.data, meId]);

  const sendTyping = (typing: boolean) => {
    const now = Date.now();
    if (typing && now - lastTyping.current < 3000) return;
    lastTyping.current = typing ? now : 0;
    typingM.mutate({ room, typing });
  };

  const onChange = (v: string) => {
    setText(v);
    const pos = ta.current?.selectionStart ?? v.length;
    const before = v.slice(0, pos);
    const m = /(^|\s)@([\p{L}\p{N}._-]{0,30})$/u.exec(before);
    setMenu(m ? { query: m[2]!, start: pos - m[2]!.length - 1, index: 0 } : null);
    if (v.trim()) sendTyping(true);
  };

  const pick = (m: Member) => {
    if (!menu) return;
    const pos = ta.current?.selectionStart ?? text.length;
    const token = `@[${m.name}](${m.id}) `;
    const next = text.slice(0, menu.start) + token + text.slice(pos);
    setText(next);
    setMenu(null);
    requestAnimationFrame(() => {
      ta.current?.focus();
      const c = menu.start + token.length;
      ta.current?.setSelectionRange(c, c);
    });
  };

  const submit = async () => {
    const body = text.trim();
    if (!body) return;
    try {
      const c = await add.mutateAsync({ entityType, entityId, body });
      setText("");
      sendTyping(false);
      if (c.mentions.length) toast.success(`Mentioned ${c.mentions.length} teammate${c.mentions.length === 1 ? "" : "s"} — they've been notified`);
      void utils.incidents.collab.comments.invalidate({ entityType, entityId });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menu && options.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMenu({ ...menu, index: (menu.index + 1) % options.length });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMenu({ ...menu, index: (menu.index - 1 + options.length) % options.length });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(options[menu.index]!);
        return;
      }
      if (e.key === "Escape") {
        setMenu(null);
        return;
      }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  const comments = list.data ?? [];
  return (
    <div className={cn("flex flex-col", className)} id="discussion">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-100">
          <MessageSquare size={14} className="text-sky-300" />
          {title}
          <span className="telemetry rounded bg-white/5 px-1.5 text-[10px] text-slate-400">{comments.length}</span>
        </div>
        <span className="text-[10px] text-slate-500">Type @ to mention · Ctrl+Enter to send</span>
      </div>
      <div ref={scroller} className="space-y-3 overflow-y-auto pr-1" style={{ maxHeight }}>
        {list.isLoading && <div className="skeleton h-16 rounded-lg" />}
        {!list.isLoading && !comments.length && <p className="rounded-lg border border-dashed border-slate-700/70 px-3 py-4 text-center text-xs text-slate-500">No comments yet. Start the conversation — @mention a teammate to pull them in.</p>}
        <AnimatePresence initial={false}>
          {comments.map((c) => {
            const mine = c.authorId === meId;
            return (
              <motion.div key={c.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={cn("group flex gap-2.5 rounded-lg p-2 transition-colors", fresh.has(c.id) && "bg-sky-400/[0.07] ring-1 ring-sky-400/30")}>
                <Avatar user={c.author} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
                    <span className="font-semibold text-slate-100">{c.authorName}</span>
                    <span className="text-slate-500" title={new Date(c.createdAt).toLocaleString()}>
                      {relTime(c.createdAt)}
                    </span>
                    {c.editedAt && <span className="text-slate-600">(edited)</span>}
                    {c.demo && <span className="rounded bg-slate-800 px-1 text-[9px] uppercase tracking-wider text-slate-400">demo</span>}
                    {mine && editing?.id !== c.id && (
                      <span className="ml-auto hidden gap-1 group-hover:inline-flex">
                        <button className="rounded p-0.5 text-slate-500 hover:text-sky-300" aria-label="Edit comment" onClick={() => setEditing({ id: c.id, body: c.body })}>
                          <Pencil size={11} />
                        </button>
                        <button
                          className="rounded p-0.5 text-slate-500 hover:text-rose-300"
                          aria-label="Delete comment"
                          onClick={async () => {
                            await del.mutateAsync({ id: c.id }).catch((e) => toast.error(e.message));
                            void utils.incidents.collab.comments.invalidate({ entityType, entityId });
                          }}
                        >
                          <Trash2 size={11} />
                        </button>
                      </span>
                    )}
                  </div>
                  {editing?.id === c.id ? (
                    <div className="mt-1 space-y-1.5">
                      <textarea value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} rows={3} className="w-full rounded-lg border border-slate-700 bg-slate-950/70 p-2 text-sm text-slate-100 focus:border-sky-400/70 focus:outline-none" />
                      <div className="flex gap-2 text-xs">
                        <button
                          className="rounded bg-sky-400 px-2 py-1 font-medium text-slate-950"
                          onClick={async () => {
                            await edit.mutateAsync({ id: c.id, body: editing.body }).catch((e) => toast.error(e.message));
                            setEditing(null);
                            void utils.incidents.collab.comments.invalidate({ entityType, entityId });
                          }}
                        >
                          Save
                        </button>
                        <button className="text-slate-400" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-0.5 text-[13px] leading-relaxed text-slate-300">
                      <CommentBody body={c.body} meId={meId} />
                    </p>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      <div className="h-5 pt-1 text-[11px] text-sky-300/80" aria-live="polite">
        {typers.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex gap-0.5">
              {[0, 1, 2].map((i) => (
                <motion.span key={i} className="h-1 w-1 rounded-full bg-sky-300" animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }} />
              ))}
            </span>
            {typers.join(", ")} {typers.length === 1 ? "is" : "are"} typing…
          </span>
        )}
      </div>
      <div className="relative">
        <textarea
          ref={ta}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => {
            setTimeout(() => setMenu(null), 150);
            if (lastTyping.current) sendTyping(false);
          }}
          rows={2}
          placeholder={placeholder ?? "Write an update or question… use @ to mention"}
          aria-label="Write a comment"
          className="w-full resize-y rounded-lg border border-slate-700/80 bg-slate-950/60 px-3 py-2 pr-11 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-400/70 focus:outline-none focus:ring-1 focus:ring-sky-400/40"
        />
        <button onClick={() => void submit()} disabled={!text.trim() || add.isPending} className="absolute bottom-3 right-2 grid h-7 w-7 place-items-center rounded-md bg-sky-400 text-slate-950 transition hover:bg-sky-300 disabled:opacity-30" aria-label="Send comment">
          <Send size={13} />
        </button>
        <AnimatePresence>
          {menu && options.length > 0 && (
            <motion.ul initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute bottom-full left-0 z-50 mb-1 w-72 overflow-hidden rounded-lg border border-sky-400/30 bg-[#081225] py-1 shadow-2xl" role="listbox">
              <li className="flex items-center gap-1 px-3 pb-1 pt-0.5 text-[10px] uppercase tracking-wider text-slate-500">
                <AtSign size={10} /> Mention a teammate
              </li>
              {options.map((m, i) => (
                <li key={m.id} role="option" aria-selected={i === menu.index}>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(m)} className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left", i === menu.index ? "bg-sky-400/15" : "hover:bg-white/5")}>
                    <Avatar user={m} size={22} />
                    <span className="min-w-0">
                      <span className="block truncate text-xs text-slate-100">{m.name}</span>
                      <span className="block truncate text-[10px] text-slate-500">
                        @{m.handle}
                        {m.title ? ` · ${m.title}` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
