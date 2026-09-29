/**
 * Tiny, safe Markdown renderer for advisor answers. Produces React elements
 * only — no dangerouslySetInnerHTML — so model or user text can never inject
 * markup. Supports: headings (#..###), paragraphs, ordered/unordered lists,
 * **bold**, *italic*, `code`, [links](https://…) (http/https only).
 */
import { Fragment, type ReactNode } from "react";

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${keyBase}-${i++}`;
    if (tok.startsWith("**")) out.push(<strong key={k} className="font-semibold text-white">{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={k} className="rounded bg-slate-800 px-1 py-0.5 text-[0.85em] telemetry text-emerald-300">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("[")) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok) ?? [];
      if (href && /^https?:\/\//i.test(href))
        out.push(
          <a key={k} href={href} target="_blank" rel="noopener noreferrer" className="text-cyan-400 underline underline-offset-2">
            {label}
          </a>
        );
      else out.push(label ?? tok);
    } else out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      const k = `p${blocks.length}`;
      blocks.push(
        <p key={k} className="leading-relaxed">
          {para.map((l, i) => (
            <Fragment key={i}>
              {i > 0 && <br />}
              {inline(l, `${k}-${i}`)}
            </Fragment>
          ))}
        </p>
      );
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const k = `l${blocks.length}`;
      const Tag = list.ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={k} className={list.ordered ? "list-decimal space-y-1 pl-5 marker:text-emerald-400 marker:telemetry" : "list-disc space-y-1 pl-5 marker:text-emerald-400"}>
          {list.items.map((it, i) => (
            <li key={i} className="leading-relaxed pl-0.5">
              {inline(it, `${k}-${i}`)}
            </li>
          ))}
        </Tag>
      );
      list = null;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (h) {
      flushPara();
      flushList();
      blocks.push(
        <div key={`h${blocks.length}`} className="font-display font-semibold text-white">
          {inline(h[2]!, `h${blocks.length}`)}
        </div>
      );
    } else if (ol || ul) {
      flushPara();
      const ordered = !!ol;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((ol ?? ul)![1]!);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return <div className={className ?? "space-y-2 text-sm text-slate-200"}>{blocks}</div>;
}
