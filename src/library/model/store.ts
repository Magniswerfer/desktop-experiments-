import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AppId, Collection, Content, LibItem, ProviderId, Relation, Tag, UsageEvent,
} from './types';

// ─── Persisted user state ────────────────────────────────────────────────────
// The seed is regenerated deterministically from `epoch` on every load; this
// store only holds what the *user* changed, as an overlay. That keeps the
// boundary honest: everything here is user-created state that must survive a
// reload, and nothing here claims to have touched a real disk.

export interface ItemMeta {
  /** Personal tags (replaces seed list when set). */
  tags?: string[];
  /** Suggested topic tags the user rejected. */
  aiRejected?: string[];
  /** Suggested topic tags the user approved (they stay visibly AI-derived). */
  aiApproved?: string[];
  name?: string;
  kept?: boolean;
  keptAt?: number;
  /** Simulated move into a real folder: new parent + path. */
  moved?: { parentId: string | null; path: string; provider: ProviderId };
  /** Cloud file downloaded on demand during this prototype. */
  downloaded?: boolean;
}

export interface AiResult { tags: string[]; summary: string; engine: 'simulated' | 'ollama'; model?: string; at: number }

export type SortKey = 'recent' | 'added' | 'modified' | 'name' | 'kind';
export type Scope =
  | { t: 'all' }
  | { t: 'inbox' }
  | { t: 'created' }
  | { t: 'folder'; id: string }
  | { t: 'provider'; id: ProviderId }
  | { t: 'collection'; id: string }
  | { t: 'tag'; id: string };

export interface LibContext {
  /** Simulated (switcher) or live (follows the Lodestone desk). */
  source: 'simulated' | 'desk';
  assembly: string | null;
  app: AppId | null;
}

export interface Prefs {
  sort: SortKey;
  view: 'list' | 'grid';
  theme: 'system' | 'light' | 'dark';
  docked: boolean;
  scope: Scope;
  ctx: LibContext;
  suggestions: boolean;
  stress: boolean;
  shelf: boolean;
  ai: { engine: 'simulated' | 'ollama'; model: string };
}

export interface LibUserState {
  epoch: number;
  meta: Record<string, ItemMeta>;
  customTags: Tag[];
  created: LibItem[];
  usage: UsageEvent[];
  /** null until the user changes collections; then the full list. */
  collections: Collection[] | null;
  /** Assembly → explicitly attached item ids. null entries fall back to seed. */
  attach: Record<string, string[]>;
  /** Context key → pinned item / collection ids. */
  pins: Record<string, string[]>;
  dismissed: Record<string, string[]>;
  relations: Relation[];
  providers: Partial<Record<ProviderId, { connected: boolean }>>;
  ai: Record<string, AiResult>;
  prefs: Prefs;
}

interface Actions {
  setPrefs: (p: Partial<Prefs>) => void;
  setCtx: (c: Partial<LibContext>) => void;
  patchMeta: (id: string, fn: (m: ItemMeta) => ItemMeta) => void;
  addTag: (label: string, kind: Tag['kind']) => Tag;
  logUsage: (e: UsageEvent) => void;
  setCollections: (fn: (c: Collection[]) => Collection[], seed: Collection[]) => void;
  setAttach: (asm: string, ids: string[]) => void;
  togglePin: (ctxKey: string, id: string) => void;
  dismiss: (ctxKey: string, id: string) => void;
  undismissAll: (ctxKey: string) => void;
  createItem: (it: LibItem) => void;
  updateCreated: (id: string, fn: (it: LibItem) => LibItem) => void;
  addRelation: (r: Relation) => void;
  setProvider: (id: ProviderId, connected: boolean) => void;
  setAi: (id: string, r: AiResult | null) => void;
  reset: () => void;
}

const freshState = (): LibUserState => ({
  epoch: Date.now(),
  meta: {}, customTags: [], created: [], usage: [], collections: null, attach: {},
  pins: {}, dismissed: {}, relations: [], providers: {}, ai: {},
  prefs: {
    sort: 'recent', view: 'list', theme: 'system', docked: false, scope: { t: 'all' },
    ctx: { source: 'simulated', assembly: 'a_research', app: 'reader' },
    suggestions: true, stress: false, shelf: true,
    ai: { engine: 'simulated', model: 'llama3.2' },
  },
});

export const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 9)}`;

export const useLibStore = create<LibUserState & Actions>()(
  persist(
    (set) => ({
      ...freshState(),
      setPrefs: (p) => set((s) => ({ prefs: { ...s.prefs, ...p } })),
      setCtx: (c) => set((s) => ({ prefs: { ...s.prefs, ctx: { ...s.prefs.ctx, ...c } } })),
      patchMeta: (id, fn) => set((s) => ({ meta: { ...s.meta, [id]: fn(s.meta[id] ?? {}) } })),
      addTag: (label, kind) => {
        const tag: Tag = { id: uid(kind === 'personal' ? 'p' : 't'), label: label.trim(), kind };
        set((s) => ({ customTags: [...s.customTags, tag] }));
        return tag;
      },
      logUsage: (e) => set((s) => ({ usage: [...s.usage, e].slice(-2000) })),
      setCollections: (fn, seed) => set((s) => ({ collections: fn(s.collections ?? seed) })),
      setAttach: (asm, ids) => set((s) => ({ attach: { ...s.attach, [asm]: ids } })),
      togglePin: (k, id) => set((s) => {
        const cur = s.pins[k] ?? [];
        return { pins: { ...s.pins, [k]: cur.includes(id) ? cur.filter((x) => x !== id) : [id, ...cur] } };
      }),
      dismiss: (k, id) => set((s) => ({
        dismissed: { ...s.dismissed, [k]: [...(s.dismissed[k] ?? []), id] },
        pins: { ...s.pins, [k]: (s.pins[k] ?? []).filter((x) => x !== id) },
      })),
      undismissAll: (k) => set((s) => ({ dismissed: { ...s.dismissed, [k]: [] } })),
      createItem: (it) => set((s) => ({ created: [...s.created, it] })),
      updateCreated: (id, fn) => set((s) => ({ created: s.created.map((x) => (x.id === id ? fn(x) : x)) })),
      addRelation: (r) => set((s) => ({ relations: [...s.relations.filter((x) => !(x.from === r.from && x.to === r.to && x.kind === r.kind)), r] })),
      setProvider: (id, connected) => set((s) => ({ providers: { ...s.providers, [id]: { connected } } })),
      setAi: (id, r) => set((s) => {
        const ai = { ...s.ai };
        if (r) ai[id] = r; else delete ai[id];
        return { ai };
      }),
      reset: () => set((s) => ({ ...freshState(), prefs: { ...freshState().prefs, theme: s.prefs.theme } })),
    }),
    { name: 'lodestone:library:v1', version: 1 },
  ),
);

/** Edits to created documents: coalesce autosaves within a minute into one version. */
export function autosaveVersions(it: LibItem, note = 'Autosaved'): LibItem['versions'] {
  const v = [...(it.versions ?? [])];
  const now = Date.now();
  const last = v[v.length - 1];
  if (last && last.note === note && now - last.at < 60e3) v[v.length - 1] = { at: now, note };
  else v.push({ at: now, note });
  return v.slice(-30);
}

export const contentText = (c: Content | null): string => {
  if (!c) return '';
  switch (c.t) {
    case 'markdown': case 'text': case 'code': return c.text;
    case 'pdf': return c.pages.flatMap((p) => p.blocks.map((b) => ('text' in b ? b.text : 'caption' in b ? b.caption : 'items' in b ? b.items.join(' ') : 'rows' in b ? b.rows.flat().join(' ') : ''))).join('\n');
    case 'doc': return c.blocks.map((b) => ('text' in b ? b.text : b.rows.flat().join(' '))).join('\n');
    case 'sheet': return [c.columns.join(' '), ...c.rows.map((r) => r.join(' '))].join('\n');
    case 'slides': return c.slides.map((s) => [s.title, ...(s.bullets ?? [])].join('\n')).join('\n');
    case 'archive': return c.entries.map((e) => e.path).join('\n');
    case 'image': return c.art.label ?? '';
    case 'media': return [c.artist, c.note].filter(Boolean).join(' ');
  }
};
