import { APPS } from '../apps/meta';
import {
  applyTree, bbox, center, clamp, deriveTree, layoutRects, normalizeLayout, rectAt, rectPath, shift, touchSide, unionOutline,
} from '../model/geometry';
import { usePresentation } from '../model/presentation';
import { isAsm, sizesOf, useDesktop } from '../model/store';
import { useTuning, type Tuning } from '../model/tuning';
import type { AsmPresentation, Presentation, Rect, Side, Size, Vec } from '../model/types';
import {
  CARD, assemblyScale, effectiveRadius, falloff, nextAsmPresentation, nextPresentation, windowSize,
} from './attention';
import { findSnap, neckPath, seamPath, type Snap, type TargetRect } from './magnet';

// ─── Engine ──────────────────────────────────────────────────────────────────
// Model (zustand) → engine (attention, layout, magnetism, springs; rAF) → DOM.
// React renders structure and semantic presentation; the engine writes
// geometry straight to registered elements every frame so motion never
// re-renders application content.

export const TAB = 22;
const MARGIN = 8;
const MIN_SIZE: Size = { w: 280, h: 170 };
const MAX_SIZE: Size = { w: 1100, h: 900 };

interface RS { x: number; y: number; w: number; h: number; vx: number; vy: number; vw: number; vh: number }
interface AsmEls {
  svg?: SVGSVGElement | null; outline?: SVGPathElement | null; hit?: SVGPathElement | null;
  clip?: SVGPathElement | null; tab?: HTMLElement | null; card?: HTMLElement | null;
}
interface OverlayEls { neck?: SVGPathElement | null; seam?: SVGPathElement | null; ring?: SVGCircleElement | null }

const winEls = new Map<string, HTMLElement>();
const attEls = new Map<string, HTMLElement>();
const asmEls = new Map<string, AsmEls>();
const overlay: OverlayEls = {};
let desktop: HTMLElement | null = null;

export const registerWin = (id: string, el: HTMLElement | null) => { if (el) winEls.set(id, el); else winEls.delete(id); };
export const registerAtt = (id: string, el: HTMLElement | null) => { if (el) attEls.set(id, el); else attEls.delete(id); };
export function registerAsm<K extends keyof AsmEls>(id: string, part: K, el: AsmEls[K]) {
  const e = asmEls.get(id) ?? {};
  e[part] = el;
  asmEls.set(id, e);
}
export function registerOverlay<K extends keyof OverlayEls>(part: K, el: OverlayEls[K]) { overlay[part] = el; }

// ─── Engine state ────────────────────────────────────────────────────────────
const rs = new Map<string, RS>();
const collapse = new Map<string, { c: number; v: number }>();
const presWin = new Map<string, Presentation>();
const presAsm = new Map<string, AsmPresentation>();
const attention = new Map<string, number>();
const focusS = { x: 0, y: 0, vx: 0, vy: 0, init: false };
let V: Size = { w: 1, h: 1 };
let rendered: Record<string, Rect> = {};
let bodies: Record<string, Rect> = {};
let raf = 0;
let lastT = 0;
const mqReduced = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

type Drag =
  | { kind: 'object'; obj: string; start: Vec; cur: Vec; startAnchor: Vec; moved: boolean; onClick?: () => void }
  | { kind: 'member'; asm: string; win: string; start: Vec; cur: Vec; moved: boolean }
  | {
      kind: 'resize'; win: string; start: Vec; cur: Vec; moved: boolean; startSize: Size; k: number;
      asm: string | null; startAnchor: Vec; tree?: ReturnType<typeof deriveTree>; root?: string;
      startLayout?: Record<string, Vec>; topLeft: Vec;
    };
let drag: Drag | null = null;
let snap: Snap | null = null;

export const isReduced = () => {
  const m = useTuning.getState().motion;
  return m === 'reduced' || (m === 'auto' && !!mqReduced?.matches);
};
export const desktopSize = () => V;
export const renderedRects = () => rendered;
export const isDragging = () => !!drag?.moved;

const local = (e: { clientX: number; clientY: number }): Vec => {
  const b = desktop?.getBoundingClientRect();
  return { x: e.clientX - (b?.left ?? 0), y: e.clientY - (b?.top ?? 0) };
};
const toNorm = (p: Vec): Vec => ({ x: clamp(p.x / V.w, 0, 1), y: clamp(p.y / V.h, 0, 1) });

function anchorOf(id: string): Vec {
  const s = useDesktop.getState();
  const a = isAsm(id) ? s.assemblies[id]?.anchor : s.windows[id]?.anchor;
  return a ? { x: a.x * V.w, y: a.y * V.h } : { x: V.w / 2, y: V.h / 2 };
}

// ─── Pointer interactions ────────────────────────────────────────────────────

function listen() {
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  document.body.classList.add('is-pressing');
}
function unlisten() {
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', onUp);
  document.body.classList.remove('is-pressing', 'is-dragging');
}

export function beginObjectDrag(obj: string, e: React.PointerEvent | PointerEvent, onClick?: () => void) {
  if (drag) return;
  const p = local(e);
  const b = bodies[obj];
  drag = { kind: 'object', obj, start: p, cur: p, startAnchor: b ? center(b) : anchorOf(obj), moved: false, onClick };
  listen();
}

export function beginMemberDrag(asm: string, win: string, e: React.PointerEvent | PointerEvent) {
  if (drag) return;
  const p = local(e);
  drag = { kind: 'member', asm, win, start: p, cur: p, moved: false };
  listen();
}

export function beginResize(win: string, e: React.PointerEvent | PointerEvent) {
  if (drag) return;
  const s = useDesktop.getState();
  const w = s.windows[win];
  const r = rendered[win];
  if (!w || !r) return;
  const p = local(e);
  const k = r.w / w.size.w;
  const base = { kind: 'resize' as const, win, start: p, cur: p, moved: true, startSize: { ...w.size }, k, topLeft: { x: r.x, y: r.y } };
  if (w.assemblyId) {
    const asm = s.assemblies[w.assemblyId];
    const rects = layoutRects(asm.layout, sizesOf(s));
    drag = { ...base, asm: asm.id, startAnchor: anchorOf(asm.id), tree: deriveTree(rects, win), root: win, startLayout: { ...asm.layout } };
  } else {
    drag = { ...base, asm: null, startAnchor: anchorOf(win) };
  }
  listen();
}

function onMove(e: PointerEvent) {
  if (!drag) return;
  drag.cur = local(e);
  const dx = drag.cur.x - drag.start.x, dy = drag.cur.y - drag.start.y;
  if (!drag.moved && Math.hypot(dx, dy) > 3) {
    drag.moved = true;
    document.body.classList.add('is-dragging');
  }
  if (drag.kind === 'member' && drag.moved) {
    const T = useTuning.getState();
    if (Math.hypot(dx, dy) >= T.detachDistance) {
      // Tear free: the window leaves the assembly and keeps following the hand.
      const win = drag.win;
      const r = rendered[win];
      useDesktop.getState().detach(win, rendered, V);
      drag = { kind: 'object', obj: win, start: drag.cur, cur: drag.cur, startAnchor: r ? center(r) : drag.cur, moved: true };
      document.body.classList.add('is-dragging');
    }
  }
  if (drag.kind === 'resize') applyResize(drag);
}

function applyResize(d: Extract<Drag, { kind: 'resize' }>) {
  const s = useDesktop.getState();
  const size: Size = {
    w: Math.round(clamp(d.startSize.w + (d.cur.x - d.start.x) / d.k, MIN_SIZE.w, MAX_SIZE.w)),
    h: Math.round(clamp(d.startSize.h + (d.cur.y - d.start.y) / d.k, MIN_SIZE.h, MAX_SIZE.h)),
  };
  if (!d.asm) {
    const a = {
      x: d.startAnchor.x + ((size.w - d.startSize.w) * d.k) / 2,
      y: d.startAnchor.y + ((size.h - d.startSize.h) * d.k) / 2,
    };
    s.resizeWindow(d.win, size, toNorm(a));
    return;
  }
  const sizes = { ...sizesOf(s), [d.win]: size };
  const raw = applyTree(d.tree!, d.root!, d.startLayout![d.root!], sizes, d.startLayout!);
  const layout = normalizeLayout(raw);
  const bb = bbox(Object.values(layoutRects(layout, sizes)));
  const c = { x: bb.x + bb.w / 2, y: bb.y + bb.h / 2 };
  const pos = layout[d.win];
  // keep the resized window's top-left pinned under the hand
  const A = { x: d.topLeft.x - (pos.x - c.x) * d.k, y: d.topLeft.y - (pos.y - c.y) * d.k };
  s.resizeWindow(d.win, size);
  s.setLayout(d.asm, layout, toNorm(A));
}

function onUp() {
  const d = drag;
  drag = null;
  unlisten();
  if (!d) return;
  const s = useDesktop.getState();
  if (d.kind === 'object') {
    if (!d.moved) { d.onClick?.(); snap = null; return; }
    const sn = snap;
    snap = null;
    if (sn?.ready) {
      const dragMembers = Object.keys(isAsm(d.obj) ? s.assemblies[d.obj]?.layout ?? {} : { [d.obj]: 1 });
      const targetMembers = Object.keys(isAsm(sn.targetObj) ? s.assemblies[sn.targetObj]?.layout ?? {} : { [sn.targetObj]: 1 });
      const all = [...dragMembers.map((id) => lastTargets[id]), ...targetMembers.map((id) => rendered[id])].filter(Boolean);
      s.merge({
        dragObj: d.obj, targetObj: sn.targetObj, dragWin: sn.dragWin, targetWin: sn.targetWin,
        side: sn.side, align: sn.align, ratio: sn.ratio, anchor: toNorm(center(bbox(all))),
      });
      return;
    }
    const b = bodies[d.obj];
    s.moveObject(d.obj, toNorm(b ? center(b) : dragAnchor(d)));
  }
}

const dragAnchor = (d: Extract<Drag, { kind: 'object' }>): Vec => ({
  x: clamp(d.startAnchor.x + d.cur.x - d.start.x, 0, V.w),
  y: clamp(d.startAnchor.y + d.cur.y - d.start.y, 0, V.h),
});

// ─── Placement ───────────────────────────────────────────────────────────────

/** Normalized point that is as far as possible from everything already open. */
export function findFreeSpot(): Vec {
  const rects = Object.values(bodies);
  let best: Vec = { x: 0.5, y: 0.5 }, bestScore = -Infinity;
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 5; j++) {
      const p = { x: (0.14 + (0.72 * i) / 8) * V.w, y: (0.18 + (0.64 * j) / 5) * V.h };
      let m = Infinity;
      for (const r of rects) {
        const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
        const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
        m = Math.min(m, Math.hypot(dx, dy));
      }
      const score = m - Math.hypot(p.x - V.w / 2, p.y - V.h / 2) * 0.05;
      if (score > bestScore) { bestScore = score; best = p; }
    }
  }
  return toNorm(best);
}

// ─── Frame ───────────────────────────────────────────────────────────────────

interface Obj {
  id: string;
  asm: boolean;
  a: number;
  members: Record<string, Rect>;
  body: Rect;
  disp: Vec;
  topPad: number;
  collapsed: boolean;
}

let lastTargets: Record<string, Rect> = {};

function makeRoom(objs: Obj[], maxPush: number) {
  const order = [...objs].sort((p, q) => q.a - p.a);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < order.length; i++) {
      const A = order[i];
      if (A.a < 0.25) break;
      const ra = shift(A.body, A.disp);
      for (let j = i + 1; j < order.length; j++) {
        const B = order[j];
        if (A.a - B.a < 0.02) continue;
        const rb = shift(B.body, B.disp);
        const ox = Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x) + 14;
        const oy = Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y) + 14;
        if (ox <= 14 || oy <= 14) continue;
        let dx = rb.x + rb.w / 2 - (ra.x + ra.w / 2), dy = rb.y + rb.h / 2 - (ra.y + ra.h / 2);
        const L = Math.hypot(dx, dy);
        if (L < 1) { dx = 0; dy = 1; } else { dx /= L; dy /= L; }
        const t = Math.min(Math.abs(dx) > 0.05 ? ox / Math.abs(dx) : Infinity, Math.abs(dy) > 0.05 ? oy / Math.abs(dy) : Infinity);
        if (!isFinite(t)) continue;
        // Peripheral objects yield more readily than semi-prominent ones.
        const yieldK = clamp(1.25 - B.a, 0.3, 1);
        B.disp = { x: B.disp.x + dx * t * yieldK, y: B.disp.y + dy * t * yieldK };
        const m = Math.hypot(B.disp.x, B.disp.y);
        if (m > maxPush) B.disp = { x: (B.disp.x / m) * maxPush, y: (B.disp.y / m) * maxPush };
      }
    }
  }
}

/**
 * Centre · push: every object overlapping the centred one takes the shortest
 * of the four axis escapes that keeps it on screen.
 */
function pushClear(objs: Obj[], fromId: string) {
  const A = objs.find((o) => o.id === fromId);
  if (!A) return;
  const a = A.body, g = 12;
  for (const B of objs) {
    if (B === A) continue;
    const b = B.body;
    if (b.x >= a.x + a.w + g || b.x + b.w <= a.x - g || b.y >= a.y + a.h + g || b.y + b.h <= a.y - g) continue;
    const lo = { x: MARGIN, y: MARGIN + B.topPad }, hi = { x: V.w - MARGIN, y: V.h - MARGIN };
    const opts: Vec[] = [
      { x: a.x - g - (b.x + b.w), y: 0 },
      { x: a.x + a.w + g - b.x, y: 0 },
      { x: 0, y: a.y - g - (b.y + b.h) },
      { x: 0, y: a.y + a.h + g - b.y },
    ];
    // Only the moved axis matters: the screen clamp settles the other one.
    const fits = (d: Vec) => (d.x ? b.x + d.x >= lo.x - 0.5 && b.x + b.w + d.x <= hi.x + 0.5 : b.y + d.y >= lo.y - 0.5 && b.y + b.h + d.y <= hi.y + 0.5);
    const ok = opts.filter(fits).sort((p, q) => Math.hypot(p.x, p.y) - Math.hypot(q.x, q.y));
    // nothing fits: take the shortest escape anyway; the screen clamp will limit it
    const d = ok[0] ?? opts.sort((p, q) => Math.hypot(p.x, p.y) - Math.hypot(q.x, q.y))[0];
    B.disp = { x: B.disp.x + d.x, y: B.disp.y + d.y };
  }
}

const clampShift = (x: number, w: number, lo: number, hi: number) =>
  w > hi - lo ? lo - x : x < lo ? lo - x : x + w > hi ? hi - (x + w) : 0;

function stepSpring(s: RS, t: Rect, k: number, c: number, dt: number) {
  const n = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    s.vx += (-k * (s.x - t.x) - c * s.vx) * h; s.x += s.vx * h;
    s.vy += (-k * (s.y - t.y) - c * s.vy) * h; s.y += s.vy * h;
    s.vw += (-k * (s.w - t.w) - c * s.vw) * h; s.w += s.vw * h;
    s.vh += (-k * (s.h - t.h) - c * s.vh) * h; s.h += s.vh * h;
  }
}

function frame(now: number) {
  raf = requestAnimationFrame(frame);
  if (!desktop) return;
  const dt = Math.min(1 / 30, Math.max(0.001, (now - lastT) / 1000));
  lastT = now;
  const st = useDesktop.getState();
  const T: Tuning = useTuning.getState();
  V = { w: desktop.clientWidth || 1, h: desktop.clientHeight || 1 };
  const reduced = isReduced();

  // Top-level objects in stacking order (back → front).
  const objIds = st.stack.filter((id) => (isAsm(id) ? !!st.assemblies[id] : !!st.windows[id] && !st.windows[id].assemblyId));
  for (const id in st.windows) if (!st.windows[id].assemblyId && !objIds.includes(id)) objIds.unshift(id);
  for (const id in st.assemblies) if (!objIds.includes(id)) objIds.unshift(id);

  const dragObj = drag?.kind === 'object' ? drag.obj : null;
  const anchors = new Map<string, Vec>();
  for (const id of objIds) anchors.set(id, drag?.kind === 'object' && drag.obj === id && drag.moved ? dragAnchor(drag) : anchorOf(id));

  // Test modes: instead of the field travelling, the focused object travels to
  // the centre of the screen. Its stored home anchor is untouched, so it goes
  // back when attention leaves it.
  const centred = T.focusMode !== 'field';
  const centre: Vec = { x: V.w / 2, y: V.h / 2 };
  const centredId = centred && st.focus.obj && anchors.has(st.focus.obj) && !(drag?.kind === 'object' && drag.obj === st.focus.obj && drag.moved) ? st.focus.obj : null;
  if (centredId) anchors.set(centredId, centre);

  // ── Focus field ──
  let ft: Vec;
  if (drag?.kind === 'object' && drag.moved) ft = anchors.get(drag.obj)!;
  else if (centred) ft = centre; // the lens is fixed; windows come to it
  else if (st.focus.obj && anchors.has(st.focus.obj)) ft = anchors.get(st.focus.obj)!;
  else ft = { x: st.focus.point.x * V.w, y: st.focus.point.y * V.h };
  if (!focusS.init || reduced) {
    focusS.x = ft.x; focusS.y = ft.y; focusS.vx = focusS.vy = 0; focusS.init = true;
  } else {
    const k = 95 * T.focusSpeed * T.focusSpeed * (drag?.moved ? 2.2 : 1);
    const c = 2 * Math.sqrt(k) * 1.0;
    const n = Math.ceil(dt / (1 / 120)), h = dt / n;
    for (let i = 0; i < n; i++) {
      focusS.vx += (-k * (focusS.x - ft.x) - c * focusS.vx) * h; focusS.x += focusS.vx * h;
      focusS.vy += (-k * (focusS.y - ft.y) - c * focusS.vy) * h; focusS.y += focusS.vy * h;
    }
  }
  // A large focused object claims space: the field tightens around it so its
  // neighbours recede further instead of piling up against it.
  const focalId = drag?.kind === 'object' && drag.moved ? drag.obj : st.focus.obj;
  let focalArea = 0;
  if (focalId && isAsm(focalId) && st.assemblies[focalId]) {
    const fb = bbox(Object.values(layoutRects(st.assemblies[focalId].layout, sizesOf(st))));
    focalArea = fb.w * fb.h;
  } else if (focalId && st.windows[focalId]) focalArea = st.windows[focalId].size.w * st.windows[focalId].size.h;
  const R = effectiveRadius(V, T, objIds.length) * Math.sqrt(1 - 0.75 * Math.min(0.8, focalArea / (V.w * V.h)));
  const fit: Size = { w: V.w - 2 * MARGIN, h: V.h - 2 * MARGIN - TAB };
  const sizes = sizesOf(st);

  // ── Attention → presentation → target geometry ──
  const objs: Obj[] = [];
  for (const id of objIds) {
    const A = anchors.get(id)!;
    const a = falloff(Math.hypot(A.x - focusS.x, A.y - focusS.y) / R, T.curve, T.sharpness) * (focalId && focalId !== id ? T.neighbours : 1);
    attention.set(id, a);
    if (!isAsm(id)) {
      const w = st.windows[id];
      const meta = APPS[w.app];
      const p = nextPresentation(presWin.get(id), a, T);
      presWin.set(id, p);
      const r = rectAt(A, windowSize(p, a, w.size, meta.compact, meta.widget, T, fit));
      objs.push({ id, asm: false, a, members: { [id]: r }, body: r, disp: { x: 0, y: 0 }, topPad: 0, collapsed: false });
    } else {
      const asm = st.assemblies[id];
      const lr = layoutRects(asm.layout, sizes);
      const bb = bbox(Object.values(lr));
      const auto = nextAsmPresentation(presAsm.get(id), a, T);
      const p: AsmPresentation = asm.collapsed && !(drag?.kind === 'member' && drag.asm === id) ? 'collapsed' : auto;
      presAsm.set(id, p);
      const members: Record<string, Rect> = {};
      if (p === 'collapsed') {
        const card = rectAt(A, CARD);
        for (const wid in lr) members[wid] = card;
      } else {
        const s = Math.min(assemblyScale(p, a, T), fit.w / bb.w, fit.h / bb.h);
        for (const wid in lr) {
          const r = lr[wid];
          members[wid] = { x: A.x + (r.x - bb.x - bb.w / 2) * s, y: A.y + (r.y - bb.y - bb.h / 2) * s, w: r.w * s, h: r.h * s };
        }
      }
      for (const wid in lr) presWin.set(wid, p === 'full' ? 'full' : 'compact');
      objs.push({ id, asm: true, a, members, body: bbox(Object.values(members)), disp: { x: 0, y: 0 }, topPad: p === 'collapsed' ? 0 : TAB, collapsed: p === 'collapsed' });
    }
  }

  // ── Spatial stability: nudge (never relocate), then keep inside the screen ──
  if (!drag) {
    if (T.focusMode === 'field' && T.makeRoom > 0) makeRoom(objs, T.makeRoom);
    // centre · push: only the centred object displaces others, far enough to clear it
    if (T.focusMode === 'center-push' && centredId) pushClear(objs, centredId);
    // centre · overlap: nothing else moves at all
  }
  for (const o of objs) {
    const b = shift(o.body, o.disp);
    o.disp = {
      x: o.disp.x + clampShift(b.x, b.w, MARGIN, V.w - MARGIN),
      y: o.disp.y + clampShift(b.y, b.h, MARGIN + o.topPad, V.h - MARGIN),
    };
    for (const wid in o.members) o.members[wid] = shift(o.members[wid], o.disp);
    o.body = shift(o.body, o.disp);
  }

  // ── Magnetism ──
  let neck = '', seam = '', neckOpacity = 0;
  snap = null;
  if (drag?.kind === 'object' && drag.moved) {
    const dragId = drag.obj;
    const o = objs.find((x) => x.id === dragId);
    if (o && !o.collapsed) {
      const targets: TargetRect[] = [];
      for (const other of objs) {
        if (other.id === o.id || other.collapsed) continue;
        for (const wid in other.members) targets.push({ obj: other.id, id: wid, rect: rendered[wid] ?? other.members[wid] });
      }
      snap = findSnap(Object.entries(o.members).map(([id, rect]) => ({ id, rect })), targets, T);
      if (snap) {
        for (const wid in o.members) o.members[wid] = shift(o.members[wid], snap.shift);
        o.body = shift(o.body, snap.shift);
        const dR = o.members[snap.dragWin];
        const tR = targets.find((t) => t.id === snap!.targetWin)!.rect;
        if (snap.ready) seam = seamPath(dR, tR, snap.side);
        else {
          neck = neckPath(dR, tR, snap.side, 1 - snap.strength * 0.6);
          neckOpacity = 0.1 + snap.strength * 0.22;
        }
      }
    }
  }
  // Pulling a member: elastic resistance and a stretching neck to its neighbours.
  if (drag?.kind === 'member' && drag.moved) {
    const o = objs.find((x) => x.id === (drag as { asm: string }).asm);
    const asm = st.assemblies[drag.asm];
    if (o && asm && o.members[drag.win]) {
      const dx = drag.cur.x - drag.start.x, dy = drag.cur.y - drag.start.y;
      const L = Math.hypot(dx, dy);
      const tension = clamp(L / T.detachDistance, 0, 1);
      const k = 0.42 * (1 - 0.25 * tension);
      o.members[drag.win] = shift(o.members[drag.win], { x: dx * k, y: dy * k });
      const lr = layoutRects(asm.layout, sizes);
      for (const nb in lr) {
        if (nb === drag.win) continue;
        const side: Side | null = touchSide(lr[drag.win], lr[nb]);
        if (!side) continue;
        neck += neckPath(o.members[drag.win], o.members[nb], side, 0.3 + tension * 0.9);
      }
      neckOpacity = 0.12 + tension * 0.3;
    }
  }

  // ── Springs ──
  const baseK = T.stiffness;
  const baseC = 2 * Math.sqrt(baseK) * T.dampingRatio;
  const dragK = 1600, dragC = 2 * Math.sqrt(dragK) * 0.95;
  const nextRendered: Record<string, Rect> = {};
  const nextBodies: Record<string, Rect> = {};
  const targetsOut: Record<string, Rect> = {};
  for (const o of objs) {
    nextBodies[o.id] = o.body;
    const isDragged = o.id === dragObj && drag?.moved;
    for (const wid in o.members) {
      const t = o.members[wid];
      targetsOut[wid] = t;
      let s = rs.get(wid);
      if (!s) {
        s = { x: t.x + t.w * 0.04, y: t.y + t.h * 0.04, w: t.w * 0.92, h: t.h * 0.92, vx: 0, vy: 0, vw: 0, vh: 0 };
        rs.set(wid, s);
      }
      if (reduced) { s.x = t.x; s.y = t.y; s.w = t.w; s.h = t.h; s.vx = s.vy = s.vw = s.vh = 0; }
      else {
        const memberDragged = drag?.kind === 'member' && drag.win === wid;
        stepSpring(s, t, isDragged || memberDragged ? dragK : baseK, isDragged || memberDragged ? dragC : baseC, dt);
      }
      nextRendered[wid] = { x: s.x, y: s.y, w: Math.max(1, s.w), h: Math.max(1, s.h) };
    }
    if (o.asm) {
      let c = collapse.get(o.id);
      const target = o.collapsed ? 1 : 0;
      if (!c) { c = { c: target, v: 0 }; collapse.set(o.id, c); }
      if (reduced) { c.c = target; c.v = 0; }
      else {
        const k = baseK, d = 2 * Math.sqrt(k);
        const n = Math.ceil(dt / (1 / 120)), h = dt / n;
        for (let i = 0; i < n; i++) { c.v += (-k * (c.c - target) - d * c.v) * h; c.c += c.v * h; }
      }
    }
  }
  rendered = nextRendered;
  bodies = nextBodies;
  lastTargets = targetsOut;

  // ── Write DOM ──
  const top = objs.length + 4;
  objs.forEach((o, idx) => {
    const zi = o.id === dragObj || (drag?.kind === 'member' && drag.asm === o.id) ? top : idx;
    const base = 10 + zi * 10;
    const c = o.asm ? clamp(collapse.get(o.id)!.c, 0, 1) : 0;
    const memberOpacity = 1 - clamp((c - 0.1) / 0.45, 0, 1);
    for (const wid in o.members) {
      const el = winEls.get(wid);
      const r = rendered[wid];
      if (!el || !r) continue;
      el.style.transform = `translate3d(${r.x.toFixed(2)}px,${r.y.toFixed(2)}px,0)`;
      el.style.width = `${r.w.toFixed(2)}px`;
      el.style.height = `${r.h.toFixed(2)}px`;
      el.style.zIndex = String(base + 1);
      el.style.opacity = o.asm ? String(memberOpacity) : '';
      el.style.pointerEvents = c > 0.3 ? 'none' : '';
      const att = attEls.get(wid);
      if (att && T.showAttention) att.textContent = `${(attention.get(o.id) ?? 0).toFixed(2)} · ${o.asm ? presAsm.get(o.id) : presWin.get(wid)}`;
    }
    if (o.asm) {
      const els = asmEls.get(o.id);
      if (!els) return;
      const rects = Object.keys(o.members).map((w) => rendered[w]).filter(Boolean);
      const bb = bbox(rects);
      const focused = st.focus.obj === o.id;
      const sw = focused ? 2 : 1;
      if (els.svg) els.svg.style.zIndex = String(base + 2);
      if (els.outline) { els.outline.setAttribute('d', unionOutline(rects, sw / 2)); els.outline.setAttribute('stroke-width', String(sw)); }
      if (els.hit) {
        els.hit.setAttribute('d', c < 0.05 ? unionOutline(rects, 0) : '');
      }
      if (els.clip) els.clip.setAttribute('d', `M-50 -50H${V.w + 50}V${V.h + 50}H-50Z` + rects.map(rectPath).join(''));
      if (els.tab) {
        // The identity tab sits on the topmost (then leftmost) member's edge.
        let host = rects[0];
        for (const r of rects) if (r.y < host.y - 1 || (Math.abs(r.y - host.y) <= 1 && r.x < host.x)) host = r;
        els.tab.style.transform = `translate3d(${host.x.toFixed(2)}px,${(host.y - TAB + 1).toFixed(2)}px,0)`;
        els.tab.style.opacity = String(1 - clamp(c * 2.2, 0, 1));
        els.tab.style.pointerEvents = c > 0.2 ? 'none' : '';
        els.tab.style.zIndex = String(base + 3);
        els.tab.style.maxWidth = `${Math.max(120, host.w)}px`;
      }
      if (els.card) {
        els.card.style.transform = `translate3d(${bb.x.toFixed(2)}px,${bb.y.toFixed(2)}px,0)`;
        els.card.style.width = `${bb.w.toFixed(2)}px`;
        els.card.style.height = `${bb.h.toFixed(2)}px`;
        els.card.style.opacity = String(clamp((c - 0.4) / 0.6, 0, 1));
        els.card.style.pointerEvents = c > 0.5 ? 'auto' : 'none';
        els.card.style.zIndex = String(base + 4);
      }
    }
  });

  desktop.style.setProperty('--fx', `${focusS.x.toFixed(1)}px`);
  desktop.style.setProperty('--fy', `${focusS.y.toFixed(1)}px`);
  desktop.style.setProperty('--fr', `${R.toFixed(0)}px`);
  desktop.classList.toggle('show-att', T.showAttention);
  if (overlay.neck) { overlay.neck.setAttribute('d', neck); overlay.neck.setAttribute('fill-opacity', neckOpacity.toFixed(3)); }
  if (overlay.seam) overlay.seam.setAttribute('d', seam);
  if (overlay.ring) {
    overlay.ring.setAttribute('cx', focusS.x.toFixed(1));
    overlay.ring.setAttribute('cy', focusS.y.toFixed(1));
    overlay.ring.setAttribute('r', R.toFixed(0));
    overlay.ring.style.display = T.showLens ? '' : 'none';
  }
  desktop.classList.toggle('snap-ready', !!snap?.ready);

  // ── Commit semantic state changes to React ──
  const ps = usePresentation.getState();
  let dw: Record<string, Presentation> | null = null, da: Record<string, AsmPresentation> | null = null;
  for (const [id, p] of presWin) if (ps.win[id] !== p) (dw ??= {})[id] = p;
  for (const [id, p] of presAsm) if (ps.asm[id] !== p) (da ??= {})[id] = p;
  if (dw || da) ps.apply(dw ?? {}, da ?? {});

  // prune state for objects that no longer exist
  if (Math.random() < 0.02) {
    for (const id of rs.keys()) if (!st.windows[id]) { rs.delete(id); presWin.delete(id); }
    for (const id of collapse.keys()) if (!st.assemblies[id]) { collapse.delete(id); presAsm.delete(id); }
  }
}

export function startEngine(el: HTMLElement) {
  desktop = el;
  lastT = performance.now();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(raf); desktop = null; };
}

/** Restart the focus spring etc. after a reset. */
export function resetEngine() {
  rs.clear(); collapse.clear(); presWin.clear(); presAsm.clear(); focusS.init = false;
}

export const attentionOf = (id: string) => attention.get(id) ?? 0;

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__lodestone = { snap: () => snap, rendered: () => rendered, drag: () => drag, attention: () => Object.fromEntries(attention) };
}
