"use client";

/**
 * 12-column dashboard canvas with pointer-event drag-to-move and
 * drag-to-resize (snap to grid, live reflow preview), keyboard editing
 * (arrows move, Shift+arrows resize, Delete removes, Enter configures) and a
 * stacked single-column layout on phones. No drag-and-drop library.
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { COLS, GAP, ROW_HEIGHT, bottom, moveItem, nudge, nudgeSize, resizeItem, snapPosition, snapSize, stackForMobile, toPixels } from "./grid";
import type { Widget } from "./catalog";

export interface HandleProps {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
}

export interface RenderState {
  editing: boolean;
  selected: boolean;
  dragging: boolean;
  compact: boolean;
  moveHandle: HandleProps;
  resizeHandle: HandleProps;
}

interface DragState {
  id: string;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  orig: { left: number; top: number; width: number; height: number };
  base: Widget[];
  preview: Widget[];
  cur: { left: number; top: number; width: number; height: number };
}

export const MOBILE_BREAKPOINT = 640;

export function GridCanvas({
  widgets,
  editing,
  onChange,
  onConfigure,
  onRemove,
  renderWidget,
  rowHeight = ROW_HEIGHT,
  selectedId,
  onSelect,
  className,
}: {
  widgets: Widget[];
  editing: boolean;
  onChange: (next: Widget[]) => void;
  onConfigure?: (id: string) => void;
  onRemove?: (id: string) => void;
  renderWidget: (w: Widget, s: RenderState) => ReactNode;
  rowHeight?: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [announce, setAnnounce] = useState("");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const mobile = width > 0 && width < MOBILE_BREAKPOINT;
  const metrics = { width: width || 1200, gap: mobile ? 10 : GAP, rowHeight };
  const canDrag = editing && !mobile;
  const layout = drag ? drag.preview : mobile ? stackForMobile(widgets) : widgets;
  const byId = new Map(layout.map((w) => [w.id, w]));
  const rows = bottom(layout) + (canDrag ? 2 : 0);
  const height = Math.max(rows, 1) * (rowHeight + metrics.gap) - metrics.gap;

  useEffect(() => {
    if (!editing) setDrag(null);
  }, [editing]);

  const handles = (id: string, mode: "move" | "resize"): HandleProps => ({
    onPointerDown: (e) => {
      if (!canDrag || e.button !== 0) return;
      const w = widgets.find((x) => x.id === id);
      if (!w) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const px = toPixels(w, metrics);
      onSelect(id);
      setDrag({ id, mode, startX: e.clientX, startY: e.clientY, orig: px, base: widgets, preview: widgets, cur: px });
    },
    onPointerMove: (e) => {
      if (!drag || drag.id !== id || drag.mode !== mode) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (mode === "move") {
        const left = Math.max(-20, Math.min(metrics.width - drag.orig.width + 20, drag.orig.left + dx));
        const top = Math.max(-10, drag.orig.top + dy);
        const s = snapPosition(left, top, metrics);
        const preview = moveItem(drag.base, id, s.x, s.y);
        setDrag({ ...drag, preview, cur: { ...drag.orig, left, top } });
      } else {
        const width = Math.max(60, drag.orig.width + dx);
        const height = Math.max(60, drag.orig.height + dy);
        const s = snapSize(width, height, metrics);
        const preview = resizeItem(drag.base, id, s.w, s.h);
        setDrag({ ...drag, preview, cur: { ...drag.orig, width: Math.min(width, metrics.width - drag.orig.left), height } });
      }
    },
    onPointerUp: (e) => {
      if (!drag || drag.id !== id) return;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      const moved = drag.preview.some((w, i) => {
        const b = drag.base[i]!;
        return w.x !== b.x || w.y !== b.y || w.w !== b.w || w.h !== b.h;
      });
      if (moved) {
        onChange(drag.preview);
        const it = drag.preview.find((w) => w.id === id)!;
        setAnnounce(mode === "move" ? `Moved to column ${it.x + 1}, row ${it.y + 1}` : `Resized to ${it.w} columns by ${it.h} rows`);
      }
      setDrag(null);
    },
    onPointerCancel: () => setDrag(null),
  });

  const onKey = (e: KeyboardEvent<HTMLDivElement>, w: Widget) => {
    if (!editing || e.target !== e.currentTarget) return;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const a = arrows[e.key];
    if (a && !mobile) {
      e.preventDefault();
      const next = e.shiftKey ? nudgeSize(widgets, w.id, a[0], a[1]) : nudge(widgets, w.id, a[0], a[1]);
      if (next !== widgets) {
        onChange(next);
        const it = next.find((x) => x.id === w.id)!;
        setAnnounce(e.shiftKey ? `${w.title}: ${it.w} columns by ${it.h} rows` : `${w.title}: column ${it.x + 1}, row ${it.y + 1}`);
      }
    } else if ((e.key === "Delete" || e.key === "Backspace") && onRemove) {
      e.preventDefault();
      onRemove(w.id);
    } else if (e.key === "Enter" && onConfigure) {
      e.preventDefault();
      onConfigure(w.id);
    } else if (e.key === "Escape") onSelect(null);
  };

  const draggingItem = drag ? byId.get(drag.id) : null;
  const placeholder = draggingItem ? toPixels(draggingItem, metrics) : null;

  return (
    <div
      ref={ref}
      className={cn("relative w-full", className)}
      style={{ height }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onSelect(null);
      }}
    >
      {canDrag && width > 0 && (
        <div aria-hidden data-export-hide className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)`, columnGap: metrics.gap }}>
          {Array.from({ length: COLS }, (_, i) => (
            <div key={i} className="rounded-md border border-dashed border-sky-400/[0.07] bg-sky-400/[0.015]" />
          ))}
        </div>
      )}
      {placeholder && <div aria-hidden className="absolute rounded-xl border-2 border-dashed border-sky-400/60 bg-sky-400/[0.06] transition-all duration-150" style={placeholder} />}
      {width > 0 &&
        widgets.map((w) => {
          const it = byId.get(w.id) ?? w;
          const isDragging = drag?.id === w.id;
          const pos = isDragging ? drag!.cur : toPixels(it, metrics);
          const selected = selectedId === w.id;
          return (
            <div
              key={w.id}
              role={editing ? "group" : undefined}
              tabIndex={editing ? 0 : undefined}
              aria-label={editing ? `${w.title}. Column ${it.x + 1}, row ${it.y + 1}, ${it.w} by ${it.h}. Arrow keys move, Shift plus arrows resize, Enter configures, Delete removes.` : undefined}
              onKeyDown={(e) => onKey(e, w)}
              onFocus={(e) => editing && e.target === e.currentTarget && onSelect(w.id)}
              onPointerDown={() => editing && onSelect(w.id)}
              className={cn("absolute outline-none", !isDragging && "transition-[left,top,width,height] duration-200 ease-out", isDragging && "z-30 opacity-95", selected && editing && "z-20 rounded-xl ring-2 ring-sky-400/70 ring-offset-2 ring-offset-[#050914]")}
              style={{ left: pos.left, top: pos.top, width: pos.width, height: pos.height }}
            >
              {renderWidget(w, { editing, selected, dragging: isDragging, compact: it.h <= 2, moveHandle: handles(w.id, "move"), resizeHandle: handles(w.id, "resize") })}
            </div>
          );
        })}
      <div aria-live="polite" className="sr-only">
        {announce}
      </div>
    </div>
  );
}
