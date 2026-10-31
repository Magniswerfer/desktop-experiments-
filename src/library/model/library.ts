import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { effectiveAvailability } from './providers';
import { seedLibrary } from './seed';
import { useLibStore, type LibUserState } from './store';
import type {
  Collection, LibAssembly, LibItem, Provider, ProviderId, Relation, SeedData, Tag, UsageEvent,
} from './types';

// ─── The derived library index ───────────────────────────────────────────────
// Seed data + the user's overlay → one queryable index. Recomputed when the
// overlay changes; cheap at a few thousand items. A real system would keep
// this in a local index service (SQLite + FTS + embeddings) and stream it.

export interface FolderStats { count: number; files: number; size: number; last: number; reps: string[] }

export interface LibIndex {
  now: number;
  providers: Record<ProviderId, Provider>;
  items: Map<string, LibItem>;
  all: LibItem[];
  children: Map<string | null, string[]>;
  tags: Map<string, Tag>;
  usage: UsageEvent[];
  byItem: Map<string, UsageEvent[]>;
  lastOpened: Map<string, number>;
  openCount: Map<string, number>;
  /** Co-usage counts: how often two items were opened in the same session. */
  together: Map<string, Map<string, number>>;
  relations: Relation[];
  relOf: Map<string, Relation[]>;
  collections: Collection[];
  seedCollections: Collection[];
  assemblies: LibAssembly[];
  asm: Map<string, LibAssembly>;
  folderStats: (id: string) => FolderStats;
  /** Personal and approved tags (explicit), plus AI-suggested topic tags still pending. */
  personalTags: (id: string) => string[];
  suggestedTags: (id: string) => { id: string; state: 'pending' | 'approved' }[];
  kept: (id: string) => boolean;
  collectionsOf: (id: string) => Collection[];
  assembliesOf: (id: string) => LibAssembly[];
}

let seedCache: { epoch: number; data: SeedData } | null = null;
export function getSeed(epoch: number): SeedData {
  if (!seedCache || seedCache.epoch !== epoch) seedCache = { epoch, data: seedLibrary(epoch) };
  return seedCache.data;
}

// Deterministic large-library generator, used to test the interface at scale.
let stressCache: { epoch: number; items: LibItem[] } | null = null;
function stressItems(epoch: number): LibItem[] {
  if (stressCache?.epoch === epoch) return stressCache.items;
  let x = 0x9e3779b9;
  const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 1e6) / 1e6; };
  const D = 864e5;
  const items: LibItem[] = [];
  const years = [2023, 2024, 2025];
  const folders: LibItem[] = years.map((y) => ({
    id: `d_stress_${y}`, kind: 'folder', name: `Photo library ${y}`, ext: '', path: `nextcloud://studio/Archive/Photo library ${y}`,
    parentId: null, provider: 'nextcloud', availability: 'cloud-online', size: 0, added: epoch - (2026 - y) * 300 * D, modified: epoch - (2026 - y) * 300 * D,
    origin: 'existing', tags: [], aiTags: ['t_photography'], content: null,
  }));
  items.push(...folders);
  for (let i = 0; i < 5000; i++) {
    const f = folders[i % 3];
    const t = epoch - (40 + rnd() * 1000) * D;
    const photo = rnd() < 0.86;
    const n = 1000 + i;
    items.push({
      id: `f_stress_${i}`, kind: photo ? 'image' : 'pdf', name: photo ? `IMG_${n}.jpg` : `scan-${n}.pdf`, ext: photo ? 'jpg' : 'pdf',
      path: `${f.path}/${photo ? `IMG_${n}.jpg` : `scan-${n}.pdf`}`, parentId: f.id, provider: 'nextcloud',
      availability: rnd() < 0.7 ? 'cloud-online' : 'cloud-downloaded', size: Math.round(photo ? 2e6 + rnd() * 4e6 : 2e5 + rnd() * 9e5),
      added: t, modified: t, origin: 'existing', tags: [], aiTags: photo ? ['t_photography'] : [],
      content: photo
        ? { t: 'image', art: { style: 'photo', hue: Math.round(rnd() * 360), seed: i, w: 4032, h: 3024 } }
        : { t: 'pdf', pages: [{ blocks: [{ k: 'title', text: `Scanned document ${n}` }, { k: 'p', text: 'Scanned page. No text layer.' }] }] },
    });
  }
  stressCache = { epoch, items };
  return items;
}

function build(s: Pick<LibUserState, 'epoch' | 'meta' | 'customTags' | 'created' | 'usage' | 'collections' | 'attach' | 'relations' | 'providers' | 'ai'> & { stress: boolean }): LibIndex {
  const seed = getSeed(s.epoch);
  const now = Date.now();
  const providers = {} as Record<ProviderId, Provider>;
  for (const p of seed.providers) providers[p.id] = { ...p, connected: s.providers[p.id]?.connected ?? p.connected };

  const items = new Map<string, LibItem>();
  const raw = [...seed.items, ...(s.stress ? stressItems(s.epoch) : []), ...s.created];
  for (const it0 of raw) {
    const m = s.meta[it0.id];
    let it = it0;
    if (m) {
      it = { ...it0 };
      if (m.name) it.name = m.name;
      if (m.tags) it.tags = m.tags;
      if (m.moved) { it.parentId = m.moved.parentId; it.path = m.moved.path; it.provider = m.moved.provider; it.availability = m.moved.provider === 'nextcloud' ? 'cloud-downloaded' : m.moved.provider === 'git-orbit' ? 'git' : 'local'; }
      if (m.downloaded && it.availability === 'cloud-online') it.availability = 'cloud-downloaded';
    }
    const av = effectiveAvailability(it, providers[it.provider]);
    if (av !== it.availability) it = { ...it, availability: av };
    items.set(it.id, it);
  }
  const all = [...items.values()];

  const children = new Map<string | null, string[]>();
  for (const it of all) {
    const k = it.parentId;
    if (!children.has(k)) children.set(k, []);
    children.get(k)!.push(it.id);
  }

  const tags = new Map<string, Tag>();
  for (const t of [...seed.tags, ...s.customTags]) tags.set(t.id, t);

  const usage = [...seed.usage, ...s.usage].filter((e) => items.has(e.item)).sort((a, b) => a.at - b.at);
  const byItem = new Map<string, UsageEvent[]>();
  const lastOpened = new Map<string, number>();
  const openCount = new Map<string, number>();
  for (const e of usage) {
    if (!byItem.has(e.item)) byItem.set(e.item, []);
    byItem.get(e.item)!.push(e);
    if (e.action === 'download') continue;
    lastOpened.set(e.item, Math.max(lastOpened.get(e.item) ?? 0, e.at));
    openCount.set(e.item, (openCount.get(e.item) ?? 0) + 1);
  }

  // Sessions: consecutive events in the same assembly less than 90 min apart.
  const together = new Map<string, Map<string, number>>();
  const bump = (a: string, b: string) => {
    if (a === b) return;
    if (!together.has(a)) together.set(a, new Map());
    const m = together.get(a)!;
    m.set(b, (m.get(b) ?? 0) + 1);
  };
  let session: Set<string> = new Set();
  let lastAt = 0, lastAsm: string | null = '__';
  const flush = () => { const ids = [...session]; for (const a of ids) for (const b of ids) bump(a, b); session = new Set(); };
  for (const e of usage) {
    if (e.action === 'download') continue;
    if (e.at - lastAt > 90 * 60e3 || e.assembly !== lastAsm) flush();
    session.add(e.item); lastAt = e.at; lastAsm = e.assembly;
  }
  flush();

  const relations = [...seed.relations, ...s.relations].filter((r) => items.has(r.from) && items.has(r.to));
  const relOf = new Map<string, Relation[]>();
  for (const r of relations) {
    for (const k of [r.from, r.to]) { if (!relOf.has(k)) relOf.set(k, []); relOf.get(k)!.push(r); }
  }

  const collections = (s.collections ?? seed.collections).map((c) => ({ ...c, items: c.items.filter((i) => items.has(i)) }));
  const assemblies = seed.assemblies.map((a) => ({ ...a, attached: (s.attach[a.id] ?? a.attached).filter((i) => items.has(i)) }));
  const asm = new Map(assemblies.map((a) => [a.id, a]));

  const statsCache = new Map<string, FolderStats>();
  const folderStats = (id: string): FolderStats => {
    const c = statsCache.get(id);
    if (c) return c;
    const out: FolderStats = { count: 0, files: 0, size: 0, last: items.get(id)?.modified ?? 0, reps: [] };
    const walk = (fid: string, depth: number) => {
      for (const cid of children.get(fid) ?? []) {
        const it = items.get(cid)!;
        out.count += depth === 0 ? 1 : 0;
        out.last = Math.max(out.last, it.modified, lastOpened.get(cid) ?? 0);
        if (it.kind === 'folder') walk(cid, depth + 1);
        else {
          out.files++; out.size += it.size;
          if (out.reps.length < 4 && (it.kind === 'image' || it.kind === 'pdf' || it.kind === 'slides' || it.kind === 'code' || it.kind === 'markdown')) out.reps.push(cid);
        }
      }
    };
    walk(id, 0);
    statsCache.set(id, out);
    return out;
  };

  const personalTags = (id: string) => {
    const it = items.get(id);
    if (!it) return [];
    const m = s.meta[id];
    return [...it.tags, ...(m?.aiApproved ?? [])].filter((t, i, a) => tags.has(t) && a.indexOf(t) === i);
  };
  const suggestedTags = (id: string) => {
    const it = items.get(id);
    if (!it) return [];
    const m = s.meta[id];
    const own = new Set(it.tags);
    const src = [...it.aiTags, ...(s.ai[id]?.tags ?? [])];
    return src
      .filter((t, i, a) => a.indexOf(t) === i && tags.has(t) && !own.has(t) && !(m?.aiRejected ?? []).includes(t))
      .map((t) => ({ id: t, state: (m?.aiApproved ?? []).includes(t) ? 'approved' as const : 'pending' as const }));
  };
  const kept = (id: string) => {
    const it = items.get(id);
    if (!it) return false;
    if (it.origin !== 'received') return true;
    return s.meta[id]?.kept ?? it.kept ?? false;
  };
  const collectionsOf = (id: string) => collections.filter((c) => c.items.includes(id));
  const assembliesOf = (id: string) => assemblies.filter((a) => a.attached.includes(id));

  return {
    now, providers, items, all, children, tags, usage, byItem, lastOpened, openCount, together, relations, relOf,
    collections, seedCollections: seed.collections, assemblies, asm, folderStats, personalTags, suggestedTags, kept, collectionsOf, assembliesOf,
  };
}

export function useLibrary(): LibIndex {
  const s = useLibStore(useShallow((st) => ({
    epoch: st.epoch, meta: st.meta, customTags: st.customTags, created: st.created, usage: st.usage,
    collections: st.collections, attach: st.attach, relations: st.relations, providers: st.providers, ai: st.ai, stress: st.prefs.stress,
  })));
  return useMemo(() => (latest = build(s)), [s.epoch, s.meta, s.customTags, s.created, s.usage, s.collections, s.attach, s.relations, s.providers, s.ai, s.stress]);
}

let latest: LibIndex | null = null;
/** Non-hook access for event handlers: the index most recently rendered. */
export function libraryNow(): LibIndex {
  if (latest) return latest;
  const st = useLibStore.getState();
  return (latest = build({ ...st, stress: st.prefs.stress }));
}
