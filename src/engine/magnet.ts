import { overlap1D, overlapRect } from '../model/geometry';
import type { Tuning } from '../model/tuning';
import type { Rect, Side, Vec } from '../model/types';

// ─── Magnetic attachment ─────────────────────────────────────────────────────
// Every frame of a drag, the dragged object's window rects are tested against
// the rendered window rects of everything else. Inside `magnetRange` the
// dragged object is gently pulled toward the nearest edge; inside
// `snapDistance` it locks into contact (and aligns flush if near an edge
// line). Releasing while locked fuses.

export interface DragRect { id: string; rect: Rect }
export interface TargetRect { obj: string; id: string; rect: Rect }

export interface Snap {
  dragWin: string;
  targetObj: string;
  targetWin: string;
  side: Side; // side of the dragged window facing the target
  align: 'start' | 'end' | 'center' | 'free';
  ratio: number;
  gap: number;
  /** 0..1 how strongly attracted (1 = locked). */
  strength: number;
  ready: boolean;
  shift: Vec;
}

const SIDES: Side[] = ['right', 'left', 'bottom', 'top'];

export function findSnap(drag: DragRect[], targets: TargetRect[], T: Tuning): Snap | null {
  const cands: (Snap & { score: number })[] = [];
  for (const d of drag) {
    const D = d.rect;
    for (const t of targets) {
      const R = t.rect;
      for (const side of SIDES) {
        const horiz = side === 'left' || side === 'right';
        let gap: number;
        if (side === 'right') gap = R.x - (D.x + D.w);
        else if (side === 'left') gap = D.x - (R.x + R.w);
        else if (side === 'bottom') gap = R.y - (D.y + D.h);
        else gap = D.y - (R.y + R.h);
        const ov = horiz ? overlap1D(D.y, D.h, R.y, R.h) : overlap1D(D.x, D.w, R.x, R.w);
        const minLen = horiz ? Math.min(D.h, R.h) : Math.min(D.w, R.w);
        if (ov < Math.max(20, minLen * 0.22)) continue;
        const depth = horiz ? Math.min(D.w, R.w) : Math.min(D.h, R.h);
        if (gap > T.magnetRange || gap < -depth * 0.4) continue;
        // centre ordering must match the side, so we never snap "through" a window
        const dc = horiz ? D.x + D.w / 2 : D.y + D.h / 2;
        const rc = horiz ? R.x + R.w / 2 : R.y + R.h / 2;
        if ((side === 'right' || side === 'bottom') && dc >= rc) continue;
        if ((side === 'left' || side === 'top') && dc <= rc) continue;

        const ready = Math.abs(gap) <= T.snapDistance;
        const ds = horiz ? D.y : D.x, dl = horiz ? D.h : D.w;
        const ts = horiz ? R.y : R.x, tl = horiz ? R.h : R.w;
        const opts: [Snap['align'], number][] = [
          ['start', ts - ds],
          ['end', ts + tl - (ds + dl)],
          ['center', ts + tl / 2 - (ds + dl / 2)],
        ];
        let align: Snap['align'] = 'free', alignShift = 0, best = T.alignRange;
        for (const [a, v] of opts) if (Math.abs(v) <= best) { best = Math.abs(v); align = a; alignShift = v; }

        const strength = ready ? 1 : Math.pow(Math.max(0, 1 - Math.max(0, gap) / Math.max(1, T.magnetRange)), 1.6);
        const n = ready ? gap : gap * T.pull * 0.45 * strength;
        const p = ready ? alignShift : 0;
        const shift: Vec =
          side === 'right' ? { x: n, y: p } :
          side === 'left' ? { x: -n, y: p } :
          side === 'bottom' ? { x: p, y: n } : { x: p, y: -n };
        const ratio = ((horiz ? D.y + shift.y : D.x + shift.x) - ts) / tl;
        cands.push({ dragWin: d.id, targetObj: t.obj, targetWin: t.id, side, align, ratio, gap, strength, ready, shift, score: Math.abs(gap) - (ready ? 1000 : 0) });
      }
    }
  }
  cands.sort((a, b) => a.score - b.score);
  for (const c of cands) {
    if (!c.ready) return c;
    // A locked position must not interpenetrate anything.
    let ok = true;
    for (const d of drag) {
      const r = { ...d.rect, x: d.rect.x + c.shift.x, y: d.rect.y + c.shift.y };
      for (const t of targets) {
        if (t.obj !== c.targetObj) continue; // overlapping unrelated windows is fine
        const o = overlapRect(r, t.rect);
        if (o.x > 3 && o.y > 3) { ok = false; break; }
      }
      if (!ok) break;
    }
    if (ok) return c;
  }
  return null;
}

/**
 * The "neck" between two facing edges: a pinched bridge that reads as surface
 * tension. Used both while attracting and while being pulled apart.
 */
export function neckPath(a: Rect, b: Rect, side: Side, pinch: number): string {
  if (side === 'left') return neckPath(b, a, 'right', pinch);
  if (side === 'top') return neckPath(b, a, 'bottom', pinch);
  const f = (v: number) => Math.round(v * 10) / 10;
  if (side === 'right') {
    const x1 = a.x + a.w, x2 = b.x;
    const y1 = Math.max(a.y, b.y), y2 = Math.min(a.y + a.h, b.y + b.h);
    if (y2 - y1 < 2 || x2 - x1 < 0.5) return '';
    const p = Math.min((x2 - x1) * 0.7, (y2 - y1) * 0.42) * pinch;
    const mx = (x1 + x2) / 2;
    return `M${f(x1)} ${f(y1)}Q${f(mx)} ${f(y1 + p)} ${f(x2)} ${f(y1)}L${f(x2)} ${f(y2)}Q${f(mx)} ${f(y2 - p)} ${f(x1)} ${f(y2)}Z`;
  }
  const y1 = a.y + a.h, y2 = b.y;
  const x1 = Math.max(a.x, b.x), x2 = Math.min(a.x + a.w, b.x + b.w);
  if (x2 - x1 < 2 || y2 - y1 < 0.5) return '';
  const p = Math.min((y2 - y1) * 0.7, (x2 - x1) * 0.42) * pinch;
  const my = (y1 + y2) / 2;
  return `M${f(x1)} ${f(y1)}Q${f(x1 + p)} ${f(my)} ${f(x1)} ${f(y2)}L${f(x2)} ${f(y2)}Q${f(x2 - p)} ${f(my)} ${f(x2)} ${f(y1)}Z`;
}

/** The contact seam where two windows are about to fuse. */
export function seamPath(a: Rect, b: Rect, side: Side): string {
  const horiz = side === 'left' || side === 'right';
  if (horiz) {
    const x = side === 'right' ? a.x + a.w : a.x;
    const y1 = Math.max(a.y, b.y), y2 = Math.min(a.y + a.h, b.y + b.h);
    return y2 > y1 ? `M${x} ${y1}V${y2}` : '';
  }
  const y = side === 'bottom' ? a.y + a.h : a.y;
  const x1 = Math.max(a.x, b.x), x2 = Math.min(a.x + a.w, b.x + b.w);
  return x2 > x1 ? `M${x1} ${y}H${x2}` : '';
}
