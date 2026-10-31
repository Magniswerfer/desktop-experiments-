import { create } from 'zustand';

// Transient UI state (not persisted): selection, Quick Look, search, toasts.

export type QLTab = 'preview' | 'info' | 'tags' | 'activity' | 'related';
export type Panel = null | { t: 'organize'; ids: string[] } | { t: 'collection'; ids: string[] } | { t: 'help' } | { t: 'settings' };

export interface Toast { id: number; text: string; detail?: string; undo?: () => void }

interface UIState {
  sel: string | null;
  /** Multi-selection (always includes sel when non-empty). */
  multi: string[];
  /** Quick Look: open state + a preview stack for related-item exploration (does not move the list selection). */
  ql: { open: boolean; stack: string[]; tab: QLTab };
  /** Folder preview navigation inside Quick Look: folder id → current sub-folder path stack. */
  qlFolder: string[];
  query: string;
  /** Usage after this moment doesn't reorder the list until you ask (or reload). */
  orderAt: number;
  panel: Panel;
  toasts: Toast[];
  /** Created document currently being edited inline. */
  editing: string | null;
  select: (id: string | null, opts?: { extend?: boolean; toggle?: boolean; ids?: string[] }) => void;
  openQL: (id?: string) => void;
  closeQL: () => void;
  pushQL: (id: string) => void;
  popQL: () => void;
  setTab: (t: QLTab) => void;
  setQlFolder: (s: string[]) => void;
  setQuery: (q: string) => void;
  refreshOrder: () => void;
  setPanel: (p: Panel) => void;
  toast: (t: Omit<Toast, 'id'>) => void;
  dropToast: (id: number) => void;
  setEditing: (id: string | null) => void;
}

let tid = 1;

export const useLibUI = create<UIState>()((set, get) => ({
  sel: null,
  multi: [],
  ql: { open: false, stack: [], tab: 'preview' },
  qlFolder: [],
  query: '',
  orderAt: Date.now(),
  panel: null,
  toasts: [],
  editing: null,
  select: (id, opts) => set((s) => {
    if (!id) return { sel: null, multi: [] };
    let multi: string[] = [];
    if (opts?.toggle) multi = s.multi.includes(id) ? s.multi.filter((x) => x !== id) : [...(s.multi.length ? s.multi : s.sel ? [s.sel] : []), id];
    else if (opts?.extend && s.sel && opts.ids) {
      const a = opts.ids.indexOf(s.multi[0] ?? s.sel), b = opts.ids.indexOf(id);
      if (a >= 0 && b >= 0) multi = opts.ids.slice(Math.min(a, b), Math.max(a, b) + 1);
      if (a >= 0 && b >= 0 && a > b) multi.reverse();
    }
    const ql = s.ql.open ? { ...s.ql, stack: [id] } : s.ql;
    return { sel: id, multi: multi.length > 1 ? multi : [], ql, qlFolder: [] };
  }),
  openQL: (id) => {
    const s = get();
    const target = id ?? s.sel;
    if (!target) return;
    set({ ql: { open: true, stack: [target], tab: s.ql.tab === 'preview' ? 'preview' : s.ql.tab }, qlFolder: [] });
  },
  closeQL: () => set((s) => ({ ql: { ...s.ql, open: false, stack: [] }, qlFolder: [], editing: null })),
  pushQL: (id) => set((s) => ({ ql: { ...s.ql, open: true, stack: [...s.ql.stack, id], tab: 'preview' }, qlFolder: [] })),
  popQL: () => set((s) => ({ ql: { ...s.ql, stack: s.ql.stack.length > 1 ? s.ql.stack.slice(0, -1) : s.ql.stack }, qlFolder: [] })),
  setTab: (tab) => set((s) => ({ ql: { ...s.ql, tab } })),
  setQlFolder: (qlFolder) => set({ qlFolder }),
  setQuery: (query) => set({ query }),
  refreshOrder: () => set({ orderAt: Date.now() }),
  setPanel: (panel) => set({ panel }),
  toast: (t) => {
    const id = tid++;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { ...t, id }] }));
    setTimeout(() => get().dropToast(id), t.undo ? 6000 : 3800);
  },
  dropToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
  setEditing: (editing) => set({ editing }),
}));
