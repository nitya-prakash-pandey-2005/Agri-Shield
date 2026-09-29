/**
 * Dashboard grid maths: collision, compaction, move/resize with push-down and
 * swap, keyboard nudges, slot finding and pixel ↔ grid snapping.
 */
import { describe, expect, it } from "vitest";
import {
  COLS,
  addItem,
  clampItem,
  collides,
  compact,
  findSlot,
  isValidLayout,
  moveItem,
  nudge,
  nudgeSize,
  removeItem,
  resizeItem,
  snapPosition,
  snapSize,
  stackForMobile,
  toPixels,
  type GridItem,
} from "@/components/dashboards/grid";

const it_ = (id: string, x: number, y: number, w: number, h: number, extra: Partial<GridItem> = {}): GridItem => ({ id, x, y, w, h, ...extra });
const pos = (items: GridItem[]) => Object.fromEntries(items.map((i) => [i.id, [i.x, i.y, i.w, i.h]]));

describe("collision", () => {
  it("detects overlap and ignores touching edges", () => {
    expect(collides(it_("a", 0, 0, 2, 2), it_("b", 1, 1, 2, 2))).toBe(true);
    expect(collides(it_("a", 0, 0, 2, 2), it_("b", 2, 0, 2, 2))).toBe(false);
    expect(collides(it_("a", 0, 0, 2, 2), it_("b", 0, 2, 2, 2))).toBe(false);
    expect(collides(it_("a", 0, 0, 2, 2), it_("a", 0, 0, 2, 2))).toBe(false); // same id
  });
});

describe("clamp", () => {
  it("keeps items inside the 12 columns and above min size", () => {
    expect(clampItem(it_("a", 11, -3, 4, 1, { minH: 2 }))).toMatchObject({ x: 8, y: 0, w: 4, h: 2 });
    expect(clampItem(it_("a", 0, 0, 20, 2))).toMatchObject({ w: COLS, x: 0 });
    expect(clampItem(it_("a", 0, 0, 1, 1, { minW: 3 }))).toMatchObject({ w: 3 });
    expect(clampItem(it_("a", 2.6, 1.4, 3.2, 2.5))).toMatchObject({ x: 3, y: 1, w: 3, h: 3 });
  });
});

describe("compaction", () => {
  it("floats items up and removes holes, preserving input order", () => {
    const out = compact([it_("a", 0, 5, 6, 2), it_("b", 6, 9, 6, 2), it_("c", 0, 12, 12, 1)]);
    expect(out.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(pos(out)).toEqual({ a: [0, 0, 6, 2], b: [6, 0, 6, 2], c: [0, 2, 12, 1] });
    expect(isValidLayout(out)).toBe(true);
  });

  it("resolves overlapping input by pushing later items down", () => {
    const out = compact([it_("a", 0, 0, 6, 3), it_("b", 3, 1, 6, 2)]);
    expect(isValidLayout(out)).toBe(true);
    expect(out.find((i) => i.id === "b")!.y).toBe(3);
  });
});

describe("move", () => {
  const base = [it_("a", 0, 0, 6, 2), it_("b", 0, 2, 6, 2), it_("c", 6, 0, 6, 4)];

  it("dragging an item down onto its neighbour swaps them", () => {
    const out = moveItem(base, "a", 0, 2);
    expect(pos(out).b).toEqual([0, 0, 6, 2]);
    expect(pos(out).a).toEqual([0, 2, 6, 2]);
    expect(isValidLayout(out)).toBe(true);
  });

  it("dragging an item up pushes the one above down", () => {
    const out = moveItem(base, "b", 0, 0);
    expect(pos(out).b).toEqual([0, 0, 6, 2]);
    expect(pos(out).a).toEqual([0, 2, 6, 2]);
  });

  it("moving sideways onto another column pushes that item down (cascade)", () => {
    const out = moveItem(base, "a", 6, 0);
    expect(pos(out).a).toEqual([6, 0, 6, 2]);
    expect(pos(out).c).toEqual([6, 2, 6, 4]);
    expect(pos(out).b).toEqual([0, 0, 6, 2]); // b floats up into the hole
    expect(isValidLayout(out)).toBe(true);
  });

  it("dropping a tile onto a same-size neighbour in the row swaps them", () => {
    const row = [it_("k1", 0, 0, 3, 2), it_("k2", 3, 0, 3, 2), it_("k3", 6, 0, 3, 2)];
    const out = moveItem(row, "k2", 0, 0);
    expect(pos(out)).toEqual({ k1: [3, 0, 3, 2], k2: [0, 0, 3, 2], k3: [6, 0, 3, 2] });
  });

  it("clamps drops outside the grid", () => {
    const out = moveItem(base, "a", 40, -5);
    expect(pos(out).a[0]).toBe(6);
    expect(isValidLayout(out)).toBe(true);
  });

  it("never produces overlaps for random moves", () => {
    let items: GridItem[] = Array.from({ length: 10 }, (_, i) => it_(`w${i}`, (i * 3) % 12, i, 2 + (i % 4), 1 + (i % 3)));
    items = compact(items);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 200; k++) {
      const t = items[Math.floor(rnd() * items.length)]!;
      items = rnd() < 0.6 ? moveItem(items, t.id, Math.floor(rnd() * 12), Math.floor(rnd() * 12)) : resizeItem(items, t.id, 1 + Math.floor(rnd() * 8), 1 + Math.floor(rnd() * 4));
      expect(isValidLayout(items)).toBe(true);
    }
  });
});

describe("resize", () => {
  it("growing pushes the item below down; respects min size", () => {
    const out = resizeItem([it_("a", 0, 0, 6, 2), it_("b", 0, 2, 6, 2)], "a", 6, 4);
    expect(pos(out)).toEqual({ a: [0, 0, 6, 4], b: [0, 4, 6, 2] });
    const small = resizeItem([it_("a", 0, 0, 6, 2, { minW: 3, minH: 2 })], "a", 1, 1);
    expect(pos(small).a).toEqual([0, 0, 3, 2]);
  });
});

describe("keyboard nudges", () => {
  const base = [it_("a", 0, 0, 6, 2), it_("b", 0, 2, 6, 3)];
  it("ArrowDown hops over the neighbour instead of snapping back", () => {
    const out = nudge(base, "a", 0, 1);
    expect(pos(out).a).toEqual([0, 3, 6, 2]);
    expect(pos(out).b).toEqual([0, 0, 6, 3]);
  });
  it("ArrowUp moves above the neighbour", () => {
    const out = nudge(base, "b", 0, -1);
    expect(pos(out).b[1]).toBe(0);
    expect(pos(out).a[1]).toBe(3);
  });
  it("ArrowRight moves one column; at the edge nothing changes", () => {
    expect(pos(nudge(base, "a", 1, 0)).a[0]).toBe(1);
    const edge = [it_("a", 6, 0, 6, 2)];
    expect(pos(nudge(edge, "a", 1, 0)).a[0]).toBe(6);
  });
  it("Shift+arrows resize", () => {
    expect(pos(nudgeSize(base, "a", 2, 1)).a).toEqual([0, 0, 8, 3]);
    expect(pos(nudgeSize(base, "a", 2, 1)).b).toEqual([0, 3, 6, 3]);
  });
  it("ArrowDown on the last item is a no-op", () => {
    expect(pos(nudge(base, "b", 0, 1))).toEqual(pos(base));
  });
});

describe("slots, add, remove", () => {
  it("finds the first free top-left slot", () => {
    const items = [it_("a", 0, 0, 6, 2), it_("b", 6, 0, 3, 2)];
    expect(findSlot(items, 3, 2)).toEqual({ x: 9, y: 0 });
    expect(findSlot(items, 4, 2)).toEqual({ x: 0, y: 2 });
  });
  it("add then remove keeps the layout valid and compact", () => {
    let items = [it_("a", 0, 0, 12, 2)];
    items = addItem(items, it_("b", 0, 0, 4, 3));
    expect(pos(items).b).toEqual([0, 2, 4, 3]);
    items = removeItem(items, "a");
    expect(pos(items).b).toEqual([0, 0, 4, 3]);
  });
});

describe("pixel ↔ grid", () => {
  const m = { width: 1200 - 11 * 12 + 11 * 12, gap: 12, rowHeight: 72 }; // 1200 px wide
  it("toPixels and snap are inverse for grid-aligned rects", () => {
    const px = toPixels({ x: 3, y: 2, w: 4, h: 3 }, m);
    expect(snapPosition(px.left, px.top, m)).toEqual({ x: 3, y: 2 });
    expect(snapSize(px.width, px.height, m)).toEqual({ w: 4, h: 3 });
  });
  it("snaps to the nearest cell", () => {
    const cw = (1200 - 12 * 11) / 12; // 89
    expect(snapPosition(cw * 0.6, 50, m)).toEqual({ x: 1, y: 1 });
    expect(snapPosition(10, 10, m)).toEqual({ x: 0, y: 0 });
  });
  it("stacks to one column for phones in reading order", () => {
    const out = stackForMobile([it_("b", 6, 0, 6, 2), it_("a", 0, 0, 6, 3), it_("c", 0, 3, 12, 1)]);
    expect(out.map((i) => [i.id, i.x, i.y, i.w])).toEqual([
      ["a", 0, 0, 12],
      ["b", 0, 3, 12],
      ["c", 0, 5, 12],
    ]);
  });
});
