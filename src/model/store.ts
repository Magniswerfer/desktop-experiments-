import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { APPS, type AppState, type TerminalState } from '../apps/meta';
import {
  bbox, center, components, layoutRects, normalizeLayout, overlapRect,
} from './geometry';
import { seedDesktop } from './seed';
import type { AppKind, AsmModel, FocusModel, Ink, Rect, Relation, Side, Size, Vec, WinModel } from './types';
import { INKS } from './types';

export interface DesktopData {
  windows: Record<string, WinModel>;
  assemblies: Record<string, AsmModel>;
  apps: Record<string, AppState>;
  focus: FocusModel;
  /** Top-level object ids, back to front. */
  stack: string[];
  inkCursor: number;
  relations: Relation[];
}

export interface MergeParams {
  dragObj: string;
  targetObj: string;
  dragWin: string;
  targetWin: string;
  /** Side of the dragged window that touches the target window. */
  side: Side;
  align: 'start' | 'end' | 'center' | 'free';
  ratio: number;
  /** Normalized centre for the merged assembly. */
  anchor: Vec;
}

interface Actions {
  focusObject: (obj: string, win?: string | null) => void;
  focusPoint: (p: Vec) => void;
  moveObject: (obj: string, anchor: Vec) => void;
  merge: (p: MergeParams) => void;
  /** Remove a window from its assembly; rendered rects (px) + desktop size keep everything in place. */
  detach: (winId: string, rendered: Record<string, Rect>, V: Size) => void;
  release: (asmId: string, rendered: Record<string, Rect>, V: Size) => void;
  addWindow: (app: AppKind, anchor: Vec) => string;
  closeWindow: (winId: string, rendered: Record<string, Rect>, V: Size) => void;
  resizeWindow: (winId: string, size: Size, anchor?: Vec) => void;
  setLayout: (asmId: string, layout: Record<string, Vec>, anchor: Vec) => void;
  rename: (asmId: string, name: string | null) => void;
  setCollapsed: (asmId: string, collapsed: boolean) => void;
  updateApp: <T extends AppState>(winId: string, fn: (s: T) => Partial<T>) => void;
  reset: () => void;
}

export type DesktopStore = DesktopData & Actions;

const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`;
const norm = (p: Vec, V: Size): Vec => ({ x: p.x / Math.max(1, V.w), y: p.y / Math.max(1, V.h) });

export const isAsm = (id: string | null | undefined) => !!id && id.startsWith('a_');

/** Top-level object id that a window belongs to. */
export const objOf = (s: DesktopData, winId: string) => s.windows[winId]?.assemblyId ?? winId;

export const sizesOf = (s: DesktopData): Record<string, Size> => {
  const out: Record<string, Size> = {};
  for (const id in s.windows) out[id] = s.windows[id].size;
  return out;
};

/** Members of a top-level object with their full-unit positions. */
export function layoutOf(s: DesktopData, obj: string): Record<string, Vec> {
  if (isAsm(obj)) return s.assemblies[obj]?.layout ?? {};
  return { [obj]: { x: 0, y: 0 } };
}

const bump = (stack: string[], ...ids: string[]) => [...stack.filter((x) => !ids.includes(x)), ...ids];

export function inferName(s: DesktopData, asm: AsmModel): string {
  const ids = Object.keys(asm.layout);
  const apps = ids.map((id) => s.windows[id]?.app);
  const term = ids.find((id) => s.windows[id]?.app === 'terminal');
  if (term && apps.includes('editor')) {
    const cwd = (s.apps[term] as TerminalState | undefined)?.cwd ?? '';
    return cwd.split('/').filter(Boolean).pop() ?? 'Project';
  }
  if (apps.includes('editor')) return 'Project';
  if (apps.includes('messages') && apps.length === 2) {
    const other = apps.find((a) => a !== 'messages');
    return other ? `${APPS[other].name} & chat` : 'Conversation';
  }
  if (apps.includes('music') && apps.includes('notes')) return 'Writing session';
  if (apps.includes('browser') && apps.includes('notes')) return 'Research';
  if (ids.length === 2) return apps.map((a) => (a ? APPS[a].name : '')).join(' + ');
  return `${ids.length} windows`;
}

function nextInk(s: DesktopData): { ink: Ink; inkCursor: number } {
  const used = new Set(Object.values(s.assemblies).map((a) => a.ink));
  for (let k = 0; k < INKS.length; k++) {
    const ink = INKS[(s.inkCursor + k) % INKS.length];
    if (!used.has(ink)) return { ink, inkCursor: s.inkCursor + k + 1 };
  }
  return { ink: INKS[s.inkCursor % INKS.length], inkCursor: s.inkCursor + 1 };
}

/**
 * Re-forms the windows of an assembly after membership shrinks. Members that
 * no longer touch split into separate assemblies (or become free windows), so
 * cutting a link behaves physically.
 */
function reform(
  s: DesktopData,
  asmId: string,
  remaining: Record<string, Vec>,
  rendered: Record<string, Rect>,
  V: Size,
): Partial<DesktopData> {
  const asm = s.assemblies[asmId];
  const windows = { ...s.windows };
  const assemblies = { ...s.assemblies };
  delete assemblies[asmId];
  let inkCursor = s.inkCursor;
  const produced: string[] = [];
  const comps = components(layoutRects(remaining, sizesOf(s)));
  comps.forEach((comp, i) => {
    const anchorPx = center(bbox(comp.map((id) => rendered[id]).filter(Boolean)));
    const anchor = norm(anchorPx, V);
    if (comp.length === 1) {
      const id = comp[0];
      windows[id] = { ...windows[id], assemblyId: null, anchor };
      produced.push(id);
      return;
    }
    const layout: Record<string, Vec> = {};
    comp.forEach((id) => (layout[id] = remaining[id]));
    let id = asmId, ink = asm.ink, name = asm.name;
    if (i > 0) {
      const n = nextInk({ ...s, assemblies, inkCursor });
      id = uid('a'); ink = n.ink; inkCursor = n.inkCursor; name = null;
    }
    assemblies[id] = { ...asm, id, ink, name, layout: normalizeLayout(layout), anchor, collapsed: false };
    comp.forEach((w) => (windows[w] = { ...windows[w], assemblyId: id }));
    produced.push(id);
  });
  const idx = s.stack.indexOf(asmId);
  const stack = [...s.stack];
  stack.splice(idx < 0 ? stack.length : idx, idx < 0 ? 0 : 1, ...produced);
  return { windows, assemblies, inkCursor, stack };
}

export const useDesktop = create<DesktopStore>()(
  persist(
    (set, get) => ({
      ...seedDesktop(),

      focusObject: (obj, win = null) => {
        const s = get();
        const w = win ?? (s.focus.obj === obj ? s.focus.win : isAsm(obj) ? Object.keys(s.assemblies[obj]?.layout ?? {})[0] : obj);
        set({ focus: { ...s.focus, obj, win: w ?? null }, stack: bump(s.stack, obj) });
      },

      focusPoint: (p) => set({ focus: { obj: null, win: null, point: p } }),

      moveObject: (obj, anchor) =>
        set((s) => {
          const focus = s.focus.obj === obj ? { ...s.focus, point: anchor } : s.focus;
          if (isAsm(obj)) {
            const a = s.assemblies[obj];
            return a ? { assemblies: { ...s.assemblies, [obj]: { ...a, anchor } }, focus } : {};
          }
          const w = s.windows[obj];
          return w ? { windows: { ...s.windows, [obj]: { ...w, anchor } }, focus } : {};
        }),

      merge: (p) =>
        set((s) => {
          const sizes = sizesOf(s);
          const dL = layoutOf(s, p.dragObj), tL = layoutOf(s, p.targetObj);
          const dm = dL[p.dragWin], tm = tL[p.targetWin];
          if (!dm || !tm) return {};
          const Fd = sizes[p.dragWin], Ft = sizes[p.targetWin];
          const along = (start: number, tLen: number, dLen: number) =>
            p.align === 'start' ? start : p.align === 'end' ? start + tLen - dLen : p.align === 'center' ? start + (tLen - dLen) / 2 : start + p.ratio * tLen;
          let px = 0, py = 0;
          switch (p.side) {
            case 'right': px = tm.x - Fd.w; py = along(tm.y, Ft.h, Fd.h); break;
            case 'left': px = tm.x + Ft.w; py = along(tm.y, Ft.h, Fd.h); break;
            case 'bottom': py = tm.y - Fd.h; px = along(tm.x, Ft.w, Fd.w); break;
            case 'top': py = tm.y + Ft.h; px = along(tm.x, Ft.w, Fd.w); break;
          }
          let off = { x: px - dm.x, y: py - dm.y };
          // Resolve any interpenetration by sliding the dragged group outward.
          const tRects = Object.values(layoutRects(tL, sizes));
          for (let iter = 0; iter < 4; iter++) {
            let need = 0;
            for (const id in dL) {
              const r = { x: dL[id].x + off.x, y: dL[id].y + off.y, ...sizes[id] };
              for (const t of tRects) {
                const o = overlapRect(r, t);
                if (o.x > 1 && o.y > 1) need = Math.max(need, p.side === 'left' || p.side === 'right' ? o.x : o.y);
              }
            }
            if (!need) break;
            if (p.side === 'right') off = { ...off, x: off.x - need };
            if (p.side === 'left') off = { ...off, x: off.x + need };
            if (p.side === 'bottom') off = { ...off, y: off.y - need };
            if (p.side === 'top') off = { ...off, y: off.y + need };
          }
          const merged: Record<string, Vec> = { ...tL };
          for (const id in dL) merged[id] = { x: dL[id].x + off.x, y: dL[id].y + off.y };
          const layout = normalizeLayout(merged);

          const assemblies = { ...s.assemblies };
          const windows = { ...s.windows };
          let id: string, ink: Ink, name: string | null, createdAt = Date.now(), inkCursor = s.inkCursor;
          const tA = isAsm(p.targetObj) ? s.assemblies[p.targetObj] : null;
          const dA = isAsm(p.dragObj) ? s.assemblies[p.dragObj] : null;
          const keep = tA ?? dA;
          if (keep) {
            id = keep.id; ink = keep.ink; name = keep.name ?? (tA && dA ? dA.name : null); createdAt = keep.createdAt;
            if (tA && dA) delete assemblies[dA.id];
          } else {
            const n = nextInk(s);
            id = uid('a'); ink = n.ink; inkCursor = n.inkCursor; name = null;
          }
          assemblies[id] = { id, ink, name, layout, anchor: p.anchor, collapsed: false, createdAt };
          for (const w in layout) windows[w] = { ...windows[w], assemblyId: id };
          const stack = bump(s.stack.filter((x) => x !== p.dragObj && x !== p.targetObj), id);
          return { assemblies, windows, inkCursor, stack, focus: { obj: id, win: p.dragWin, point: p.anchor } };
        }),

      detach: (winId, rendered, V) =>
        set((s) => {
          const w = s.windows[winId];
          if (!w?.assemblyId) return {};
          const asm = s.assemblies[w.assemblyId];
          const remaining = { ...asm.layout };
          delete remaining[winId];
          const r = reform(s, asm.id, remaining, rendered, V);
          const windows = { ...r.windows! };
          windows[winId] = { ...w, assemblyId: null, anchor: norm(center(rendered[winId]), V) };
          return { ...r, windows, stack: bump(r.stack!, winId), focus: { obj: winId, win: winId, point: windows[winId].anchor } };
        }),

      release: (asmId, rendered, V) =>
        set((s) => {
          const asm = s.assemblies[asmId];
          if (!asm) return {};
          const windows = { ...s.windows };
          const assemblies = { ...s.assemblies };
          delete assemblies[asmId];
          const ids = Object.keys(asm.layout);
          const c = center(bbox(ids.map((id) => rendered[id]).filter(Boolean)));
          ids.forEach((id) => {
            const r = rendered[id];
            // Spread slightly away from the centre so the parts read as separate.
            const rc = r ? center(r) : c;
            const d = { x: rc.x - c.x, y: rc.y - c.y };
            const L = Math.hypot(d.x, d.y) || 1;
            windows[id] = { ...windows[id], assemblyId: null, anchor: norm({ x: rc.x + (d.x / L) * 28, y: rc.y + (d.y / L) * 28 }, V) };
          });
          const idx = s.stack.indexOf(asmId);
          const stack = [...s.stack];
          stack.splice(idx, 1, ...ids);
          return { windows, assemblies, stack, focus: s.focus.obj === asmId ? { ...s.focus, obj: s.focus.win } : s.focus };
        }),

      addWindow: (app, anchor) => {
        const id = uid('w');
        const meta = APPS[app];
        set((s) => ({
          windows: { ...s.windows, [id]: { id, app, size: { ...meta.full }, anchor, assemblyId: null, createdAt: Date.now() } },
          apps: { ...s.apps, [id]: meta.initial() },
          stack: [...s.stack, id],
          focus: { obj: id, win: id, point: anchor },
        }));
        return id;
      },

      closeWindow: (winId, rendered, V) =>
        set((s) => {
          const w = s.windows[winId];
          if (!w) return {};
          let base: Partial<DesktopData> = {};
          if (w.assemblyId) {
            const remaining = { ...s.assemblies[w.assemblyId].layout };
            delete remaining[winId];
            base = reform(s, w.assemblyId, remaining, rendered, V);
          }
          const windows = { ...(base.windows ?? s.windows) };
          delete windows[winId];
          const apps = { ...s.apps };
          delete apps[winId];
          const stack = (base.stack ?? s.stack).filter((x) => x !== winId);
          const focus = s.focus.win === winId || s.focus.obj === winId ? { obj: null, win: null, point: s.focus.point } : s.focus;
          return { ...base, windows, apps, stack, focus };
        }),

      resizeWindow: (winId, size, anchor) =>
        set((s) => {
          const w = s.windows[winId];
          if (!w) return {};
          return { windows: { ...s.windows, [winId]: { ...w, size, anchor: anchor ?? w.anchor } } };
        }),

      setLayout: (asmId, layout, anchor) =>
        set((s) => {
          const a = s.assemblies[asmId];
          return a ? { assemblies: { ...s.assemblies, [asmId]: { ...a, layout, anchor } } } : {};
        }),

      rename: (asmId, name) =>
        set((s) => {
          const a = s.assemblies[asmId];
          return a ? { assemblies: { ...s.assemblies, [asmId]: { ...a, name: name?.trim() || null } } } : {};
        }),

      setCollapsed: (asmId, collapsed) =>
        set((s) => {
          const a = s.assemblies[asmId];
          return a ? { assemblies: { ...s.assemblies, [asmId]: { ...a, collapsed } } } : {};
        }),

      updateApp: (winId, fn) =>
        set((s) => {
          const cur = s.apps[winId] as any;
          if (!cur) return {};
          return { apps: { ...s.apps, [winId]: { ...cur, ...fn(cur) } } };
        }),

      reset: () => set({ ...seedDesktop() }),
    }),
    {
      name: 'lodestone:desktop:v1',
      version: 1,
      partialize: (s): DesktopData => ({
        windows: s.windows, assemblies: s.assemblies, apps: s.apps, focus: s.focus,
        stack: s.stack, inkCursor: s.inkCursor, relations: s.relations,
      }),
    },
  ),
);
