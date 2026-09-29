/**
 * Dashboard grid maths (pure — shared by the builder UI, the server-side
 * sanitiser and the unit tests).
 *
 * Model: a 12-column grid, rows of fixed height, items addressed in grid
 * units {x, y, w, h}. Layouts are "vertically compacted" (every item floats
 * up until it touches another item or the top), the same mental model as
 * Grafana / react-grid-layout, so a dashboard never has holes.
 *
 *   moveItem()   – place an item at (x, y); whatever it lands on is pushed
 *                  down (cascading), then the layout is compacted. Dragging an
 *                  item below its neighbour therefore swaps them.
 *   resizeItem() – same collision handling for a new w/h.
 *   findSlot()   – first free position for a new widget (top-left scan).
 */

export const COLS = 12;
export const ROW_HEIGHT = 72; // px
export const GAP = 12; // px

export interface GridItem {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

const int = (v: number, fallback = 0) => (Number.isFinite(v) ? Math.round(v) : fallback);

export function collides(a: GridItem, b: GridItem): boolean {
  if (a.id === b.id) return false;
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Keep an item inside the grid and above its minimum size. */
export function clampItem<T extends GridItem>(item: T, cols = COLS): T {
  const minW = Math.max(1, Math.min(cols, int(item.minW ?? 1, 1)));
  const minH = Math.max(1, int(item.minH ?? 1, 1));
  const w = Math.max(minW, Math.min(cols, int(item.w, minW)));
  const h = Math.max(minH, Math.min(24, int(item.h, minH)));
  const x = Math.max(0, Math.min(cols - w, int(item.x)));
  const y = Math.max(0, int(item.y));
  return { ...item, x, y, w, h };
}

export function bottom(items: GridItem[]): number {
  return items.reduce((m, it) => Math.max(m, it.y + it.h), 0);
}

const byRowCol = (a: GridItem, b: GridItem) => a.y - b.y || a.x - b.x;

/**
 * Vertical compaction: process items top-to-bottom, left-to-right and move
 * each one up as far as it can go without overlapping an already-placed item.
 * Returns items in the ORIGINAL order (stable for React keys / undo stacks).
 */
export function compact<T extends GridItem>(items: T[], cols = COLS, pinnedId?: string): T[] {
  const clamped = items.map((it) => clampItem(it, cols));
  const placed: T[] = [];
  const out = new Map<string, T>();
  // The item being dragged keeps its row priority: it is placed first among equals.
  const order = [...clamped].sort((a, b) => byRowCol(a, b) || (a.id === pinnedId ? -1 : b.id === pinnedId ? 1 : 0));
  for (const it of order) {
    let y = it.y;
    const cand = { ...it };
    // float up
    while (y > 0) {
      cand.y = y - 1;
      if (placed.some((p) => collides(cand, p))) break;
      y--;
    }
    cand.y = y;
    // if (because of clamping) it still overlaps, push it down until free
    while (placed.some((p) => collides(cand, p))) cand.y++;
    placed.push(cand);
    out.set(it.id, cand);
  }
  return clamped.map((it) => out.get(it.id)!);
}

/** Push every item that collides with `moved` below it, cascading. */
function pushDown<T extends GridItem>(items: T[], moved: T, depth = 0): void {
  if (depth > items.length + 2) return;
  const hits = items.filter((it) => collides(it, moved)).sort(byRowCol);
  for (const hit of hits) {
    hit.y = moved.y + moved.h;
    pushDown(items, hit, depth + 1);
  }
}

function applyChange<T extends GridItem>(items: T[], id: string, patch: Partial<GridItem>, cols: number): T[] {
  const work = items.map((it) => ({ ...it }));
  const target = work.find((it) => it.id === id);
  if (!target) return compact(work, cols);
  const prev = { x: target.x, y: target.y };
  Object.assign(target, clampItem({ ...target, ...patch }, cols));
  const isMove = patch.x !== undefined || patch.y !== undefined;
  if (isMove) {
    // Whatever we land on moves into the space we vacated (a swap) when it
    // fits there — straight up (same column) first, then our old slot;
    // otherwise it gets pushed down below us.
    for (const hit of work.filter((it) => collides(it, target)).sort(byRowCol)) {
      const candidates = target.y > prev.y ? [{ x: hit.x, y: prev.y }, prev] : [prev];
      for (const c of candidates) {
        const moved = { ...hit, ...c };
        if (!work.some((o) => o.id !== hit.id && collides(moved, o))) {
          hit.x = c.x;
          hit.y = c.y;
          break;
        }
      }
    }
  }
  pushDown(work, target);
  return compact(work, cols, id);
}

const sameLayout = (a: GridItem[], b: GridItem[]) => a.every((it, i) => it.x === b[i]!.x && it.y === b[i]!.y && it.w === b[i]!.w && it.h === b[i]!.h);

/**
 * Keyboard nudge (arrow keys). Because the grid compacts upwards, "one row
 * down" can snap straight back; we keep stepping until the layout actually
 * changes (i.e. the item hops over its neighbour) or we reach the bottom.
 */
export function nudge<T extends GridItem>(items: T[], id: string, dx: number, dy: number, cols = COLS): T[] {
  const it = items.find((i) => i.id === id);
  if (!it) return items;
  if (dy <= 0) {
    const next = moveItem(items, id, it.x + dx, it.y + dy, cols);
    return next;
  }
  const limit = bottom(items) + 1;
  for (let step = dy; it.y + step <= limit; step++) {
    const next = moveItem(items, id, it.x + dx, it.y + step, cols);
    if (!sameLayout(next, items)) return next;
  }
  return items;
}

/** Keyboard resize (Shift + arrows): same stepping idea, sizes never shrink below min. */
export function nudgeSize<T extends GridItem>(items: T[], id: string, dw: number, dh: number, cols = COLS): T[] {
  const it = items.find((i) => i.id === id);
  if (!it) return items;
  return resizeItem(items, id, it.w + dw, it.h + dh, cols);
}

export function moveItem<T extends GridItem>(items: T[], id: string, x: number, y: number, cols = COLS): T[] {
  return applyChange(items, id, { x, y }, cols);
}

export function resizeItem<T extends GridItem>(items: T[], id: string, w: number, h: number, cols = COLS): T[] {
  return applyChange(items, id, { w, h }, cols);
}

/** First free top-left position for a w×h item (row-major scan); falls back to the bottom. */
export function findSlot(items: GridItem[], w: number, h: number, cols = COLS): { x: number; y: number } {
  const ww = Math.max(1, Math.min(cols, w));
  const maxY = bottom(items);
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= cols - ww; x++) {
      const cand: GridItem = { id: "__probe__", x, y, w: ww, h };
      if (!items.some((it) => collides(cand, it))) return { x, y };
    }
  }
  return { x: 0, y: maxY };
}

export function addItem<T extends GridItem>(items: T[], item: T, cols = COLS): T[] {
  const slot = findSlot(items, item.w, item.h, cols);
  return compact([...items, { ...item, ...slot }], cols);
}

export function removeItem<T extends GridItem>(items: T[], id: string, cols = COLS): T[] {
  return compact(
    items.filter((it) => it.id !== id),
    cols
  );
}

/** True when no two items overlap and all are inside the grid. */
export function isValidLayout(items: GridItem[], cols = COLS): boolean {
  for (let i = 0; i < items.length; i++) {
    const a = items[i]!;
    if (a.x < 0 || a.y < 0 || a.w < 1 || a.h < 1 || a.x + a.w > cols) return false;
    for (let j = i + 1; j < items.length; j++) if (collides(a, items[j]!)) return false;
  }
  return true;
}

// ─── Pixel ↔ grid conversions (pointer drag / resize) ─────────────────────

export interface GridMetrics {
  width: number;
  cols?: number;
  rowHeight?: number;
  gap?: number;
}

export function colWidth(m: GridMetrics): number {
  const cols = m.cols ?? COLS;
  const gap = m.gap ?? GAP;
  return Math.max(1, (m.width - gap * (cols - 1)) / cols);
}

/** Grid rect → pixel rect (left/top/width/height) inside the canvas. */
export function toPixels(it: Pick<GridItem, "x" | "y" | "w" | "h">, m: GridMetrics) {
  const cw = colWidth(m);
  const gap = m.gap ?? GAP;
  const rh = m.rowHeight ?? ROW_HEIGHT;
  return { left: it.x * (cw + gap), top: it.y * (rh + gap), width: it.w * cw + (it.w - 1) * gap, height: it.h * rh + (it.h - 1) * gap };
}

/** Pixel offset (from the canvas' top-left) → nearest grid cell (snap). */
export function snapPosition(left: number, top: number, m: GridMetrics): { x: number; y: number } {
  const cw = colWidth(m);
  const gap = m.gap ?? GAP;
  const rh = m.rowHeight ?? ROW_HEIGHT;
  return { x: Math.round(left / (cw + gap)), y: Math.max(0, Math.round(top / (rh + gap))) };
}

/** Pixel size → nearest grid size (snap). */
export function snapSize(width: number, height: number, m: GridMetrics): { w: number; h: number } {
  const cw = colWidth(m);
  const gap = m.gap ?? GAP;
  const rh = m.rowHeight ?? ROW_HEIGHT;
  return { w: Math.max(1, Math.round((width + gap) / (cw + gap))), h: Math.max(1, Math.round((height + gap) / (rh + gap))) };
}

/**
 * Single-column "stacked" layout for phones: order by (y, x), full width,
 * heights kept. Used for display only — the saved desktop layout is untouched.
 */
export function stackForMobile<T extends GridItem>(items: T[], cols = COLS): T[] {
  let y = 0;
  return [...items].sort(byRowCol).map((it) => {
    const out = { ...it, x: 0, w: cols, y };
    y += it.h;
    return out;
  });
}
