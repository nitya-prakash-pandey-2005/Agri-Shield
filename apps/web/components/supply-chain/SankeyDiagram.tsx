"use client";

/**
 * d3-sankey diagram with animated link draw-in, hover focus and tooltips.
 * Used for the commodity flow network (overview) and the impact cascade (scenarios).
 */
import { motion } from "framer-motion";
import { sankey, sankeyJustify, sankeyLeft, sankeyLinkHorizontal, type SankeyGraph, type SankeyLink, type SankeyNode } from "d3-sankey";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { INK } from "./theme";

export interface SNode {
  id: string;
  name: string;
  color: string;
  sub?: string;
  column?: number;
}
export interface SLink {
  source: string;
  target: string;
  value: number;
  color: string;
  label?: ReactNode;
  opacity?: number;
}

type N = SankeyNode<SNode, SLink>;
type L = SankeyLink<SNode, SLink>;

export default function SankeyDiagram({
  nodes,
  links,
  height = 420,
  align = "justify",
  nodeWidth = 10,
  renderTip,
  valueFormat = (v: number) => v.toLocaleString(),
  minWidth = 760,
}: {
  nodes: SNode[];
  links: SLink[];
  height?: number;
  align?: "justify" | "left";
  nodeWidth?: number;
  renderTip?: (x: { kind: "node"; node: SNode; value: number } | { kind: "link"; link: SLink; source: SNode; target: SNode }) => ReactNode;
  valueFormat?: (v: number) => string;
  minWidth?: number;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<{ x: number; y: number; content: ReactNode; focus: string } | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setWidth(Math.floor(e[0]!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const graph = useMemo(() => {
    if (!width || !nodes.length || !links.length) return null;
    const ids = new Set(nodes.map((n) => n.id));
    const safeLinks = links.filter((l) => ids.has(l.source) && ids.has(l.target) && l.value > 0);
    const labelRoom = Math.min(170, width * 0.2);
    try {
      const gen = sankey<SNode, SLink>()
        .nodeId((d) => d.id)
        .nodeAlign(align === "left" ? sankeyLeft : sankeyJustify)
        .nodeWidth(nodeWidth)
        .nodePadding(Math.max(6, Math.min(16, height / (nodes.length + 4))))
        .extent([
          [4, 8],
          [width - labelRoom, height - 8],
        ]);
      return gen({ nodes: nodes.map((n) => ({ ...n })), links: safeLinks.map((l) => ({ ...l })) } as SankeyGraph<SNode, SLink>);
    } catch {
      return null;
    }
  }, [nodes, links, width, height, align, nodeWidth]);

  const path = sankeyLinkHorizontal();
  const focusIds = (id: string) => {
    if (!graph) return new Set<string>();
    const s = new Set<string>([id]);
    for (const l of graph.links as L[]) {
      const a = (l.source as N).id;
      const b = (l.target as N).id;
      if (a === id || b === id) {
        s.add(a);
        s.add(b);
        s.add(`${a}>${b}`);
      }
    }
    return s;
  };
  const focus = hover ? focusIds(hover.focus) : null;
  const move = (e: React.MouseEvent, content: ReactNode, focusId: string) => {
    const r = wrap.current!.getBoundingClientRect();
    setHover({ x: e.clientX - r.left, y: e.clientY - r.top, content, focus: focusId });
  };

  return (
    <div className="w-full overflow-x-auto overflow-y-hidden">
    <div ref={wrap} className="relative w-full" style={{ height, minWidth }}>
      {graph && (
        <svg width={width} height={height} className="overflow-visible" role="img" aria-label="Flow diagram">
          <g fill="none">
            {(graph.links as L[]).map((l, i) => {
              const s = l.source as N;
              const t = l.target as N;
              const key = `${s.id}>${t.id}`;
              const dim = focus && !focus.has(key);
              return (
                <motion.path
                  key={key + i}
                  d={path(l) ?? undefined}
                  stroke={l.color}
                  strokeWidth={Math.max(1, l.width ?? 1)}
                  strokeOpacity={dim ? 0.06 : l.opacity ?? 0.42}
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 1.1, delay: 0.02 * i, ease: [0.16, 1, 0.3, 1] }}
                  onMouseMove={(e) => move(e, renderTip ? renderTip({ kind: "link", link: l as unknown as SLink, source: s, target: t }) : `${s.name} → ${t.name}: ${valueFormat(l.value)}`, s.id)}
                  onMouseLeave={() => setHover(null)}
                  style={{ cursor: "pointer", transition: "stroke-opacity .2s" }}
                />
              );
            })}
          </g>
          {(graph.nodes as N[]).map((n) => {
            const h = Math.max(2, (n.y1 ?? 0) - (n.y0 ?? 0));
            const dim = focus && !focus.has(n.id);
            const right = (n.x0 ?? 0) > width * 0.55;
            return (
              <g key={n.id} opacity={dim ? 0.3 : 1} style={{ transition: "opacity .2s" }} onMouseMove={(e) => move(e, renderTip ? renderTip({ kind: "node", node: n, value: n.value ?? 0 }) : `${n.name}: ${valueFormat(n.value ?? 0)}`, n.id)} onMouseLeave={() => setHover(null)}>
                <rect x={n.x0} y={n.y0} width={(n.x1 ?? 0) - (n.x0 ?? 0)} height={h} rx={2} fill={n.color} stroke="#060a16" strokeWidth={1} />
                <text x={right ? (n.x1 ?? 0) + 6 : (n.x1 ?? 0) + 6} y={((n.y0 ?? 0) + (n.y1 ?? 0)) / 2} dy="0.32em" fontSize={10.5} fill={INK.primary} style={{ pointerEvents: "none" }}>
                  {n.name.length > 30 ? `${n.name.slice(0, 29)}…` : n.name}
                  {n.sub && (
                    <tspan fill={INK.muted} fontSize={9.5} fontFamily="var(--font-mono)">
                      {"  "}
                      {n.sub}
                    </tspan>
                  )}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      {hover && (
        <div className="pointer-events-none absolute z-20 max-w-xs rounded-lg border border-slate-700/80 bg-[#060c1c]/95 px-3 py-2 text-xs text-slate-200 shadow-xl backdrop-blur" style={{ left: Math.min(hover.x + 14, width - 240), top: hover.y + 12 }}>
          {hover.content}
        </div>
      )}
    </div>
    </div>
  );
}
