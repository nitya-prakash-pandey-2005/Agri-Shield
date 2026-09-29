/**
 * Tiny, dependency-free Markdown renderer for the docs (server-renderable).
 * Supports: ## / ### headings (with ids), paragraphs, - and 1. lists, ```lang fences,
 * | tables |, > quotes and > [!NOTE]/[!WARNING] callouts, ---, and inline `code`,
 * **bold**, *em*, [links](url). Content is authored in-repo, never user input.
 */
import type { ReactNode } from "react";
import { CodeBlock } from "./CodeBlock";

export function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

export function headings(md: string) {
  const out: { level: 2 | 3; text: string; id: string }[] = [];
  let inFence = false;
  for (const line of md.split("\n")) {
    if (line.startsWith("```")) inFence = !inFence;
    if (inFence) continue;
    const m = line.match(/^(##|###) (.+)$/);
    if (m) out.push({ level: m[1] === "##" ? 2 : 3, text: m[2]!.replace(/`/g, ""), id: slugify(m[2]!) });
  }
  return out;
}

function inline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${keyBase}-${i++}`;
    if (tok.startsWith("`")) nodes.push(<code key={k}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("**")) nodes.push(<strong key={k}>{inline(tok.slice(2, -2), k)}</strong>);
    else if (tok.startsWith("*")) nodes.push(<em key={k}>{inline(tok.slice(1, -1), k)}</em>);
    else {
      const lm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/)!;
      const href = lm[2]!;
      const ext = /^https?:/.test(href);
      nodes.push(
        <a key={k} href={href} {...(ext ? { target: "_blank", rel: "noreferrer" } : {})}>
          {inline(lm[1]!, k)}
        </a>
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  const k = () => `b${key++}`;

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    // code fence
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) buf.push(lines[i++]!);
      i++;
      blocks.push(<CodeBlock key={k()} lang={lang} code={buf.join("\n")} />);
      continue;
    }
    const h = line.match(/^(##|###) (.+)$/);
    if (h) {
      const id = slugify(h[2]!);
      blocks.push(
        h[1] === "##" ? (
          <h2 key={k()} id={id}>
            <a href={`#${id}`} className="!no-underline !text-inherit">
              {inline(h[2]!, id)}
            </a>
          </h2>
        ) : (
          <h3 key={k()} id={id}>
            {inline(h[2]!, id)}
          </h3>
        )
      );
      i++;
      continue;
    }
    if (line.trim() === "---") {
      blocks.push(<hr key={k()} />);
      i++;
      continue;
    }
    // table
    if (line.trim().startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) {
        const cells = lines[i]!.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      const tk = k();
      blocks.push(
        <div key={tk} className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                {head!.map((c, j) => (
                  <th key={j} scope="col">
                    {inline(c, `${tk}h${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, j) => (
                    <td key={j}>{inline(c, `${tk}${ri}-${j}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }
    // quote / callout
    if (line.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">")) buf.push(lines[i++]!.replace(/^>\s?/, ""));
      const kind = buf[0]?.match(/^\[!(NOTE|WARNING|TIP)\]/)?.[1];
      const text = kind ? buf.slice(1).join(" ") : buf.join(" ");
      const tk = k();
      if (kind) {
        const tone = kind === "WARNING" ? "border-amber-400/40 bg-amber-400/[0.06] text-amber-50" : kind === "TIP" ? "border-emerald-400/40 bg-emerald-400/[0.06] text-emerald-50" : "border-sky-400/40 bg-sky-400/[0.06] text-sky-50";
        blocks.push(
          <div key={tk} role="note" className={`my-5 rounded-xl border px-4 py-3 text-[14px] leading-relaxed ${tone}`}>
            <strong className="mr-1.5 !text-inherit">{kind === "WARNING" ? "Warning." : kind === "TIP" ? "Tip." : "Note."}</strong>
            {inline(text, tk)}
          </div>
        );
      } else blocks.push(<blockquote key={tk}>{inline(text, tk)}</blockquote>);
      continue;
    }
    // lists
    if (/^(\s*)(-|\d+\.) /.test(line)) {
      const ordered = /^\s*\d+\. /.test(line);
      const items: string[] = [];
      while (i < lines.length && /^(\s*)(-|\d+\.) /.test(lines[i]!)) {
        let item = lines[i]!.replace(/^\s*(-|\d+\.) /, "");
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]!) && !/^\s*(-|\d+\.) /.test(lines[i]!)) item += " " + lines[i++]!.trim();
        items.push(item);
      }
      const tk = k();
      const Tag = ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={tk}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, `${tk}${j}`)}</li>
          ))}
        </Tag>
      );
      continue;
    }
    // paragraph
    const buf: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(##|###) |^```|^>|^\||^(\s*)(-|\d+\.) |^---$/.test(lines[i]!)) buf.push(lines[i++]!.trim());
    const tk = k();
    blocks.push(<p key={tk}>{inline(buf.join(" "), tk)}</p>);
  }
  return <div className="docs-prose">{blocks}</div>;
}
