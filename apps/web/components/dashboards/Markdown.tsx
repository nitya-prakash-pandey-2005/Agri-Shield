"use client";

/**
 * Tiny, safe Markdown renderer for note widgets (no HTML, no deps):
 * # headings, - / * / 1. lists, **bold**, *italic*, `code`, [links](https://… or /path), paragraphs.
 */
import Link from "next/link";
import type { ReactNode } from "react";

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${key}-${i++}`;
    if (tok.startsWith("**")) out.push(<strong key={k} className="font-semibold text-white">{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={k} className="rounded bg-white/5 px-1 telemetry text-[0.92em] text-cyan-200">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("[")) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!;
      const href = lm[2]!;
      if (href.startsWith("/")) out.push(<Link key={k} href={href} className="text-sky-300 underline underline-offset-2 hover:text-sky-200">{lm[1]}</Link>);
      else if (/^https?:\/\//.test(href)) out.push(<a key={k} href={href} target="_blank" rel="noreferrer noopener" className="text-sky-300 underline underline-offset-2 hover:text-sky-200">{lm[1]}</a>);
      else out.push(lm[1]);
    } else out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push(<p key={`p${blocks.length}`} className="leading-relaxed">{inline(para.join(" "), `p${blocks.length}`)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={`l${blocks.length}`} className={list.ordered ? "list-decimal space-y-1 pl-5" : "list-disc space-y-1 pl-5 marker:text-cyan-400"}>
        {list.items.map((it, i) => (
          <li key={i}>{inline(it, `l${blocks.length}-${i}`)}</li>
        ))}
      </Tag>
    );
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      const lvl = h[1]!.length;
      blocks.push(
        <div key={`h${blocks.length}`} className={lvl === 1 ? "font-display text-base font-semibold text-white" : lvl === 2 ? "font-display text-sm font-semibold text-white" : "hud-label text-cyan-300/90"}>
          {inline(h[2]!, `h${blocks.length}`)}
        </div>
      );
    } else if (ul || ol) {
      flushPara();
      const ordered = !!ol;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((ul ?? ol)![1]!);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return <div className={className ?? "space-y-2 text-[13px] text-slate-300"}>{blocks}</div>;
}
