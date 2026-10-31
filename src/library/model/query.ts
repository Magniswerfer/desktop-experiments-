import { KIND_LABEL } from './apps';
import { dayGroup } from './format';
import type { LibIndex } from './library';
import type { Scope, SortKey } from './store';
import { contentText } from './store';
import type { LibItem } from './types';

export type Row = { t: 'h'; label: string; key: string } | { t: 'i'; id: string };

const textCache = new WeakMap<LibItem, string>();
export function searchText(L: LibIndex, it: LibItem): string {
  let s = textCache.get(it);
  if (s === undefined) {
    const tags = [...it.tags, ...it.aiTags].map((t) => L.tags.get(t)?.label ?? '').join(' ');
    s = `${it.name}\n${it.path}\n${tags}\n${it.summary ?? ''}\n${it.source ?? ''}\n${KIND_LABEL[it.kind]}\n${contentText(it.content).slice(0, 6000)}`.toLowerCase();
    textCache.set(it, s);
  }
  return s;
}

/** Last activity as of `orderAt`, so the list doesn't reshuffle while you work. */
export function activityAt(L: LibIndex, it: LibItem, orderAt: number): number {
  const ev = L.byItem.get(it.id);
  let last = 0;
  if (ev) for (let i = ev.length - 1; i >= 0; i--) if (ev[i].at <= orderAt && ev[i].action !== 'download') { last = ev[i].at; break; }
  // Newly received/created files count as activity, so they surface at the top.
  return Math.max(last, it.origin === 'existing' ? 0 : it.added) || it.modified;
}

export function scopeItems(L: LibIndex, scope: Scope): LibItem[] {
  switch (scope.t) {
    case 'all': return L.all;
    case 'inbox': return L.all.filter((i) => i.origin === 'received');
    case 'created': return L.all.filter((i) => i.origin === 'created');
    case 'folder': return (L.children.get(scope.id) ?? []).map((id) => L.items.get(id)!);
    case 'provider': return L.all.filter((i) => i.provider === scope.id);
    case 'collection': return (L.collections.find((c) => c.id === scope.id)?.items ?? []).map((id) => L.items.get(id)!).filter(Boolean);
    case 'tag': return L.all.filter((i) => L.personalTags(i.id).includes(scope.id) || L.suggestedTags(i.id).some((s) => s.id === scope.id));
  }
}

export function matches(L: LibIndex, it: LibItem, q: string): boolean {
  if (!q) return true;
  const hay = searchText(L, it);
  for (const tok of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    const [k, v] = tok.includes(':') ? tok.split(':', 2) : [null, tok];
    if (k === 'kind' || k === 'type') { if (!(it.kind.startsWith(v) || it.ext === v || KIND_LABEL[it.kind].toLowerCase().startsWith(v))) return false; continue; }
    if (k === 'in' || k === 'from') { if (!(it.provider.startsWith(v) || (it.source ?? '').toLowerCase().includes(v))) return false; continue; }
    if (!hay.includes(v)) return false;
  }
  return true;
}

export function sortKeyOf(L: LibIndex, it: LibItem, sort: SortKey, orderAt: number): number | string {
  switch (sort) {
    case 'recent': return activityAt(L, it, orderAt);
    case 'added': return it.added;
    case 'modified': return it.modified;
    case 'name': return it.name.toLowerCase();
    case 'kind': return KIND_LABEL[it.kind];
  }
}

export function queryRows(L: LibIndex, scope: Scope, sort: SortKey, q: string, orderAt: number): { rows: Row[]; ids: string[] } {
  const base = scopeItems(L, scope).filter((it) => matches(L, it, q));
  const keyed = base.map((it) => ({ it, k: sortKeyOf(L, it, sort, orderAt) }));
  if (sort === 'name') keyed.sort((a, b) => (a.k as string).localeCompare(b.k as string, undefined, { numeric: true }));
  else if (sort === 'kind') keyed.sort((a, b) => (a.k as string).localeCompare(b.k as string) || b.it.modified - a.it.modified);
  else keyed.sort((a, b) => (b.k as number) - (a.k as number) || a.it.name.localeCompare(b.it.name));

  const rows: Row[] = [];
  const ids: string[] = [];
  let last = '';
  for (const { it, k } of keyed) {
    const label = sort === 'name' ? '' : sort === 'kind' ? (k as string) : dayGroup(k as number, L.now);
    if (label && label !== last) { rows.push({ t: 'h', label, key: `h:${label}` }); last = label; }
    rows.push({ t: 'i', id: it.id });
    ids.push(it.id);
  }
  return { rows, ids };
}
