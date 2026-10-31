import type { Rect, Side, Size, Vec } from './types';

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerpRect = (a: Rect, b: Rect, t: number): Rect => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  w: lerp(a.w, b.w, t),
  h: lerp(a.h, b.h, t),
});
export const center = (r: Rect): Vec => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
export const rectAt = (c: Vec, s: Size): Rect => ({ x: c.x - s.w / 2, y: c.y - s.h / 2, w: s.w, h: s.h });
export const shift = (r: Rect, d: Vec): Rect => ({ ...r, x: r.x + d.x, y: r.y + d.y });

export function bbox(rects: Rect[]): Rect {
  if (!rects.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function overlap1D(a0: number, al: number, b0: number, bl: number) {
  return Math.min(a0 + al, b0 + bl) - Math.max(a0, b0);
}

export function overlapRect(a: Rect, b: Rect) {
  return { x: overlap1D(a.x, a.w, b.x, b.w), y: overlap1D(a.y, a.h, b.y, b.h) };
}

const EPS = 0.75;

/** Which side of `a` touches `b` (edge contact with real overlap), or null. */
export function touchSide(a: Rect, b: Rect): Side | null {
  const oy = overlap1D(a.y, a.h, b.y, b.h);
  const ox = overlap1D(a.x, a.w, b.x, b.w);
  if (oy > EPS && Math.abs(a.x + a.w - b.x) < EPS) return 'right';
  if (oy > EPS && Math.abs(b.x + b.w - a.x) < EPS) return 'left';
  if (ox > EPS && Math.abs(a.y + a.h - b.y) < EPS) return 'bottom';
  if (ox > EPS && Math.abs(b.y + b.h - a.y) < EPS) return 'top';
  return null;
}

export function layoutRects(layout: Record<string, Vec>, sizes: Record<string, Size>): Record<string, Rect> {
  const out: Record<string, Rect> = {};
  for (const id in layout) {
    const p = layout[id];
    const s = sizes[id] ?? { w: 300, h: 200 };
    out[id] = { x: p.x, y: p.y, w: s.w, h: s.h };
  }
  return out;
}

export function normalizeLayout(layout: Record<string, Vec>): Record<string, Vec> {
  let mx = Infinity, my = Infinity;
  for (const id in layout) { mx = Math.min(mx, layout[id].x); my = Math.min(my, layout[id].y); }
  const out: Record<string, Vec> = {};
  for (const id in layout) out[id] = { x: Math.round(layout[id].x - mx), y: Math.round(layout[id].y - my) };
  return out;
}

/** Connected components of rects by edge contact. */
export function components(rects: Record<string, Rect>): string[][] {
  const ids = Object.keys(rects);
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const comp: string[] = [];
    const q = [id];
    seen.add(id);
    while (q.length) {
      const cur = q.shift()!;
      comp.push(cur);
      for (const o of ids) {
        if (!seen.has(o) && touchSide(rects[cur], rects[o])) { seen.add(o); q.push(o); }
      }
    }
    out.push(comp);
  }
  return out.sort((a, b) => b.length - a.length);
}

// ─── Attachment tree ─────────────────────────────────────────────────────────
// An Assembly's arrangement is stored as positions, but when a member is
// resized we re-derive the attachment tree (who hangs off whom, along which
// edge, at which offset) and re-apply it so neighbours stay in contact.

export interface Attach { id: string; parent: string; side: Side; offset: number }

export function deriveTree(rects: Record<string, Rect>, root: string): Attach[] {
  const ids = Object.keys(rects);
  const seen = new Set([root]);
  const q = [root];
  const out: Attach[] = [];
  while (q.length) {
    const p = q.shift()!;
    const pr = rects[p];
    for (const c of ids) {
      if (seen.has(c)) continue;
      const side = touchSide(pr, rects[c]); // side of parent that child sits on
      if (!side) continue;
      const cr = rects[c];
      const offset = side === 'left' || side === 'right' ? cr.y - pr.y : cr.x - pr.x;
      out.push({ id: c, parent: p, side, offset });
      seen.add(c);
      q.push(c);
    }
  }
  return out;
}

export function applyTree(
  tree: Attach[],
  root: string,
  rootPos: Vec,
  sizes: Record<string, Size>,
  existing: Record<string, Vec>,
): Record<string, Vec> {
  const pos: Record<string, Vec> = { ...existing, [root]: rootPos };
  for (const a of tree) {
    const p = pos[a.parent];
    const ps = sizes[a.parent];
    const cs = sizes[a.id];
    switch (a.side) {
      case 'right': pos[a.id] = { x: p.x + ps.w, y: p.y + a.offset }; break;
      case 'left': pos[a.id] = { x: p.x - cs.w, y: p.y + a.offset }; break;
      case 'bottom': pos[a.id] = { x: p.x + a.offset, y: p.y + ps.h }; break;
      case 'top': pos[a.id] = { x: p.x + a.offset, y: p.y - cs.h }; break;
    }
  }
  return pos;
}

// ─── Union silhouette ────────────────────────────────────────────────────────
// Builds the outer outline of a set of axis-aligned rectangles via coordinate
// compression. Each boundary run is offset inward by `inset` so a stroke of
// width 2*inset sits exactly on the outermost pixels of the windows.

export function unionOutline(rects: Rect[], inset = 0.5): string {
  if (!rects.length) return '';
  const q = (v: number) => Math.round(v * 4) / 4;
  const xsS = new Set<number>(), ysS = new Set<number>();
  const R = rects.map((r) => ({ x0: q(r.x), y0: q(r.y), x1: q(r.x + r.w), y1: q(r.y + r.h) }));
  for (const r of R) { xsS.add(r.x0); xsS.add(r.x1); ysS.add(r.y0); ysS.add(r.y1); }
  const xs = [...xsS].sort((a, b) => a - b);
  const ys = [...ysS].sort((a, b) => a - b);
  const nx = xs.length - 1, ny = ys.length - 1;
  if (nx <= 0 || ny <= 0) return '';
  const cov = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const cy = (ys[j] + ys[j + 1]) / 2;
    for (let i = 0; i < nx; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      for (const r of R) {
        if (cx > r.x0 && cx < r.x1 && cy > r.y0 && cy < r.y1) { cov[j * nx + i] = 1; break; }
      }
    }
  }
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= nx || j >= ny ? 0 : cov[j * nx + i]);
  const f = (v: number) => Math.round(v * 100) / 100;
  let d = '';
  // Horizontal runs. dir: +1 → inside is below, -1 → inside is above.
  for (let j = 0; j <= ny; j++) {
    let start = -1, dir = 0;
    for (let i = 0; i <= nx; i++) {
      const above = at(i, j - 1), below = at(i, j);
      const cur = i < nx && above !== below ? (below ? 1 : -1) : 0;
      if (start >= 0 && cur !== dir) {
        const y = ys[j] + dir * inset;
        d += `M${f(xs[start] + inset)} ${f(y)}H${f(xs[i] - inset)}`;
        start = -1;
      }
      if (cur !== 0 && start < 0) { start = i; dir = cur; }
    }
  }
  for (let i = 0; i <= nx; i++) {
    let start = -1, dir = 0;
    for (let j = 0; j <= ny; j++) {
      const left = at(i - 1, j), right = at(i, j);
      const cur = j < ny && left !== right ? (right ? 1 : -1) : 0;
      if (start >= 0 && cur !== dir) {
        const x = xs[i] + dir * inset;
        d += `M${f(x)} ${f(ys[start] + inset)}V${f(ys[j] - inset)}`;
        start = -1;
      }
      if (cur !== 0 && start < 0) { start = j; dir = cur; }
    }
  }
  return d;
}

export const rectPath = (r: Rect) => `M${r.x} ${r.y}h${r.w}v${r.h}h${-r.w}Z`;
