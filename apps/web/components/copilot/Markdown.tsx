"use client";

/**
 * Minimal, safe markdown renderer for Copilot answers (no HTML injection):
 * paragraphs, headings, bullet / numbered lists (one nesting level), **bold**,
 * _italic_, `code` and [links](/internal-or-https).
 */
import Link from "next/link";
import { Fragment, type ReactNode } from "react";

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|(?<![\p{L}\p{N}])_[^_]+_(?![\p{L}\p{N}]))/gu;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${keyBase}-${i++}`;
    if (tok.startsWith("**")) out.push(<strong key={k} className="font-semibold text-white">{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={k} className="rounded bg-slate-800/80 px-1 py-0.5 text-[0.85em] text-cyan-200 telemetry">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("[")) {
      const mm = tok.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)!;
      const href = mm[2]!;
      const safe = href.startsWith("/") || href.startsWith("https://");
      out.push(
        safe ? (
          href.startsWith("/") ? (
            <Link key={k} href={href} className="text-cyan-300 underline decoration-cyan-500/40 underline-offset-2 hover:text-cyan-200">
              {mm[1]}
            </Link>
          ) : (
            <a key={k} href={href} target="_blank" rel="noreferrer" className="text-cyan-300 underline decoration-cyan-500/40 underline-offset-2">
              {mm[1]}
            </a>
          )
        ) : (
          mm[1]
        )
      );
    } else out.push(<em key={k} className="text-slate-400">{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block = { kind: "p" | "h" | "ul" | "ol"; lines: { text: string; depth: number }[] };

function parse(md: string): Block[] {
  const blocks: Block[] = [];
  let cur: Block | null = null;
  const flush = () => {
    if (cur) blocks.push(cur);
    cur = null;
  };
  for (const raw of md.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = line.match(/^#{1,4}\s+(.*)$/);
    const ul = line.match(/^(\s*)[-*•]\s+(.*)$/);
    const ol = line.match(/^(\s*)\d+[.)]\s+(.*)$/);
    if (h) {
      flush();
      blocks.push({ kind: "h", lines: [{ text: h[1]!, depth: 0 }] });
    } else if (ul || ol) {
      const kind = ul ? "ul" : "ol";
      const m = (ul ?? ol)!;
      const depth = m[1]!.length >= 2 ? 1 : 0;
      if (!cur || (cur.kind !== kind && depth === 0)) {
        flush();
        cur = { kind, lines: [] };
      }
      cur.lines.push({ text: m[2]!, depth });
    } else {
      if (!cur || cur.kind !== "p") {
        flush();
        cur = { kind: "p", lines: [] };
      }
      cur.lines.push({ text: line, depth: 0 });
    }
  }
  flush();
  return blocks;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = parse(text);
  return (
    <div className={className}>
      {blocks.map((b, i) => {
        const k = `b${i}`;
        if (b.kind === "h") return <h4 key={k} className="mt-3 mb-1 font-display text-sm font-semibold text-white">{inline(b.lines[0]!.text, k)}</h4>;
        if (b.kind === "p")
          return (
            <p key={k} className="my-1.5 leading-relaxed">
              {b.lines.map((l, j) => (
                <Fragment key={j}>
                  {j > 0 && <br />}
                  {inline(l.text, `${k}-${j}`)}
                </Fragment>
              ))}
            </p>
          );
        const Tag = b.kind === "ul" ? "ul" : "ol";
        return (
          <Tag key={k} className={`my-1.5 space-y-1 ${b.kind === "ul" ? "list-none" : "list-decimal pl-5 marker:text-slate-500"}`}>
            {b.lines.map((l, j) => (
              <li key={j} className={`${b.kind === "ul" ? "relative pl-4" : "pl-1"} ${l.depth ? "ml-4 text-[0.95em] text-slate-400" : ""} leading-relaxed`}>
                {b.kind === "ul" && <span className="absolute left-0 top-[0.62em] h-1.5 w-1.5 rounded-full bg-cyan-400/70" />}
                {inline(l.text, `${k}-${j}`)}
              </li>
            ))}
          </Tag>
        );
      })}
    </div>
  );
}
