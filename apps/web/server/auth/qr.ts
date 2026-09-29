/**
 * Minimal QR Code encoder (ISO/IEC 18004) — byte mode, error-correction level M,
 * versions 1–40, automatic mask selection. Dependency-free and isomorphic
 * (no node APIs) so it can render the authenticator enrolment QR anywhere.
 *
 * Pipeline: UTF-8 bytes → bit stream (mode, length, data, terminator, pad) →
 * Reed–Solomon ECC per block over GF(256)/0x11D → interleave → place function
 * patterns (finders, timing, alignment, dark module, format & version info) →
 * zig-zag data placement → try the 8 masks, keep the lowest penalty.
 */

export interface QrMatrix {
  version: number;
  size: number;
  mask: number;
  /** modules[y][x] — true = dark */
  modules: boolean[][];
}

// Level-M tables indexed by version (index 0 unused)
const ECC_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const NUM_BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
const ECL_M_FORMAT_BITS = 0; // L=1, M=0, Q=3, H=2

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

/** Number of data+ECC modules available in a symbol of this version. */
export function rawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

export const dataCodewordsM = (ver: number) => Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK_M[ver]! * NUM_BLOCKS_M[ver]!;

// ─── GF(256) Reed–Solomon ────────────────────────────────────────────────

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

export function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j]!, root);
      if (j + 1 < result.length) result[j]! ^= result[j + 1]!;
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

export function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    divisor.forEach((coef, i) => (result[i]! ^= gfMul(coef, factor)));
  }
  return result;
}

// ─── Codewords ───────────────────────────────────────────────────────────

function utf8(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

function buildCodewords(bytes: number[], ver: number): number[] {
  const bits: number[] = [];
  const push = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capacity = dataCodewordsM(ver) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; out.length < dataCodewordsM(ver); pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

function addEccAndInterleave(data: number[], ver: number): number[] {
  const numBlocks = NUM_BLOCKS_M[ver]!;
  const eccLen = ECC_PER_BLOCK_M[ver]!;
  const rawCodewords = Math.floor(rawDataModules(ver) / 8);
  const numShort = numBlocks - (rawCodewords % numBlocks);
  const shortLen = Math.floor(rawCodewords / numBlocks);
  const div = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const result: number[] = [];
  for (let i = 0; i < blocks[0]!.length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= numShort) result.push(block[i]!);
    });
  }
  return result;
}

// ─── Matrix ──────────────────────────────────────────────────────────────

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const size = ver * 4 + 17;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

class Grid {
  readonly size: number;
  modules: boolean[][];
  isFn: boolean[][];
  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.isFn = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }
  setFn(x: number, y: number, dark: boolean) {
    this.modules[y]![x] = dark;
    this.isFn[y]![x] = true;
  }
  drawFunctionPatterns() {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      this.setFn(6, i, i % 2 === 0);
      this.setFn(i, 6, i % 2 === 0);
    }
    this.finder(3, 3);
    this.finder(n - 4, 3);
    this.finder(3, n - 4);
    const pos = alignmentPositions(this.version);
    const k = pos.length;
    for (let i = 0; i < k; i++)
      for (let j = 0; j < k; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === k - 1) || (i === k - 1 && j === 0)) continue;
        this.alignment(pos[i]!, pos[j]!);
      }
    this.drawFormatBits(0); // reserve; real bits drawn after masking
    this.drawVersion();
  }
  finder(cx: number, cy: number) {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < this.size && y >= 0 && y < this.size) this.setFn(x, y, dist !== 2 && dist !== 4);
      }
  }
  alignment(cx: number, cy: number) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  drawFormatBits(mask: number) {
    const data = (ECL_M_FORMAT_BITS << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const n = this.size;
    for (let i = 0; i <= 5; i++) this.setFn(8, i, bit(bits, i));
    this.setFn(8, 7, bit(bits, 6));
    this.setFn(8, 8, bit(bits, 7));
    this.setFn(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) this.setFn(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) this.setFn(n - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) this.setFn(8, n - 15 + i, bit(bits, i));
    this.setFn(8, n - 8, true); // dark module
  }
  drawVersion() {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const b = bit(bits, i);
      const a = this.size - 11 + (i % 3);
      const c = Math.floor(i / 3);
      this.setFn(a, c, b);
      this.setFn(c, a, b);
    }
  }
  drawCodewords(data: number[]) {
    const n = this.size;
    let i = 0;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < n; vert++)
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? n - 1 - vert : vert;
          if (!this.isFn[y]![x] && i < data.length * 8) {
            this.modules[y]![x] = bit(data[i >>> 3]!, 7 - (i & 7));
            i++;
          }
        }
    }
  }
  applyMask(mask: number) {
    const n = this.size;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (this.isFn[y]![x]) continue;
        let invert: boolean;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        }
        if (invert) this.modules[y]![x] = !this.modules[y]![x];
      }
  }
  penalty(): number {
    const n = this.size;
    const m = this.modules;
    let score = 0;
    const line = (get: (i: number) => boolean) => {
      let s = 0;
      let run = 1;
      for (let i = 1; i <= n; i++) {
        if (i < n && get(i) === get(i - 1)) run++;
        else {
          if (run >= 5) s += 3 + (run - 5);
          run = 1;
        }
      }
      // finder-like 1:1:3:1:1 with 4 light modules on one side
      const pat = [true, false, true, true, true, false, true];
      for (let i = 0; i + 7 <= n; i++) {
        if (!pat.every((p, k) => get(i + k) === p)) continue;
        const before = i >= 4 && [1, 2, 3, 4].every((k) => !get(i - k));
        const after = i + 11 <= n && [7, 8, 9, 10].every((k) => !get(i + k));
        if (before || after) s += 40;
      }
      return s;
    };
    for (let y = 0; y < n; y++) score += line((x) => m[y]![x]!);
    for (let x = 0; x < n; x++) score += line((y) => m[y]![x]!);
    for (let y = 0; y < n - 1; y++)
      for (let x = 0; x < n - 1; x++) {
        const c = m[y]![x];
        if (c === m[y]![x + 1] && c === m[y + 1]![x] && c === m[y + 1]![x + 1]) score += 3;
      }
    const dark = m.reduce((a, row) => a + row.filter(Boolean).length, 0);
    score += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
    return score;
  }
}

/** Smallest version whose level-M byte capacity fits `byteLength`. */
export function pickVersion(byteLength: number): number {
  for (let v = 1; v <= 40; v++) {
    const needed = 4 + (v <= 9 ? 8 : 16) + 8 * byteLength;
    if (needed <= dataCodewordsM(v) * 8) return v;
  }
  throw new Error("Data too long for a QR code");
}

export function encodeQr(text: string, forceMask?: number): QrMatrix {
  const bytes = utf8(text);
  const version = pickVersion(bytes.length);
  const codewords = addEccAndInterleave(buildCodewords(bytes, version), version);
  let best: { mask: number; modules: boolean[][]; score: number } | null = null;
  const masks = forceMask !== undefined ? [forceMask] : [0, 1, 2, 3, 4, 5, 6, 7];
  for (const mask of masks) {
    const g = new Grid(version);
    g.drawFunctionPatterns();
    g.drawCodewords(codewords);
    g.applyMask(mask);
    g.drawFormatBits(mask);
    const score = g.penalty();
    if (!best || score < best.score) best = { mask, modules: g.modules, score };
  }
  return { version, size: version * 4 + 17, mask: best!.mask, modules: best!.modules };
}

/** One SVG path ("M x y h1 v1 h-1 z" per dark module) with a quiet zone. */
export function qrSvgPath(qr: QrMatrix, border = 4): { path: string; viewBox: number } {
  let d = "";
  qr.modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) d += `M${x + border} ${y + border}h1v1h-1z`;
    })
  );
  return { path: d, viewBox: qr.size + border * 2 };
}

export function qrSvg(text: string, opts: { border?: number; dark?: string; light?: string; px?: number } = {}): string {
  const qr = encodeQr(text);
  const { path, viewBox } = qrSvgPath(qr, opts.border ?? 4);
  const px = opts.px ?? 220;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBox} ${viewBox}" width="${px}" height="${px}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="${opts.light ?? "#fff"}"/><path d="${path}" fill="${opts.dark ?? "#000"}"/></svg>`;
}
