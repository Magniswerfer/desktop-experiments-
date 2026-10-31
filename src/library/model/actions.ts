import { useLibUI } from '../ui/uiStore';
import { analyzeItem } from './ai';
import { defaultApp, LIB_APPS } from './apps';
import { libraryNow } from './library';
import { ADAPTERS } from './providers';
import { autosaveVersions, uid, useLibStore } from './store';
import type { AppId, Collection, LibItem } from './types';

// User-level operations. Each one changes only the overlay state and says
// honestly what it did; nothing here touches a real disk.

const toast = (text: string, detail?: string, undo?: () => void) => useLibUI.getState().toast({ text, detail, undo });
const S = () => useLibStore.getState();

/** Hook for the spatial desktop: when present, "Open" places a real window on the desk. */
type DeskOpener = (item: LibItem, app: AppId) => boolean;
let deskOpener: DeskOpener | null = null;
export const setDeskOpener = (fn: DeskOpener | null) => { deskOpener = fn; };

export async function openItem(id: string, appOverride?: AppId) {
  const L = libraryNow();
  const it = L.items.get(id);
  if (!it) return;
  const p = L.providers[it.provider];
  if (it.availability === 'unavailable') { toast(`Can’t open ${it.name}`, `${p.label} is not connected. Connect it to open this file.`); return; }
  const app = appOverride ?? defaultApp(it);
  if (it.availability === 'cloud-online') {
    toast(`Downloading ${it.name} from Nextcloud…`, 'Simulated. A local copy would be kept in the sync folder.');
    const r = await ADAPTERS.nextcloud.read(it, p);
    if (!r.ok) { toast(`Can’t open ${it.name}`, r.reason); return; }
    S().patchMeta(id, (m) => ({ ...m, downloaded: true }));
  }
  const ctx = S().prefs.ctx;
  S().logUsage({ item: id, app, at: Date.now(), assembly: ctx.assembly, action: 'open' });
  if (it.origin === 'created' && (it.kind === 'markdown' || it.kind === 'doc')) {
    useLibUI.getState().openQL(id);
    useLibUI.getState().setEditing(id);
    return;
  }
  const placed = deskOpener?.(it, app) ?? false;
  toast(placed ? `Opened ${it.name} on the desk` : `Opened ${it.name} in ${LIB_APPS[app].name}`, placed ? `${LIB_APPS[app].name} · next to your current work` : 'Simulated. In the desktop, a window would open in the active Assembly.');
}

export function toggleKeep(ids: string[]) {
  const L = libraryNow();
  const recv = ids.filter((id) => L.items.get(id)?.origin === 'received');
  if (!recv.length) { toast('Already part of your library', 'Created files and indexed folders are always retained.'); return; }
  const to = !recv.every((id) => L.kept(id));
  const prev = recv.map((id) => [id, S().meta[id]] as const);
  for (const id of recv) S().patchMeta(id, (m) => ({ ...m, kept: to, keptAt: to ? Date.now() : undefined }));
  const n = recv.length === 1 ? L.items.get(recv[0])!.name : `${recv.length} files`;
  toast(to ? `Kept ${n}` : `${n} back in the inbox`, to ? 'Stays where it is. Marked for long-term retention; no folder needed. (Simulated: nothing was copied or backed up.)' : 'It stays on disk. The prototype never deletes files.', () => {
    for (const [id, m] of prev) S().patchMeta(id, () => m ?? {});
  });
}

export function createDocument(kind: 'note' | 'doc', initial?: string) {
  const L = libraryNow();
  const now = Date.now();
  const ctx = S().prefs.ctx;
  const id = uid('f_new');
  const dir = '/home/magnus/Documents/Created';
  const parent = L.all.find((i) => i.kind === 'folder' && i.path === dir);
  const app: AppId = kind === 'note' ? 'notes' : 'writer';
  const name = kind === 'note' ? 'Untitled note.md' : 'Untitled document.odt';
  const it: LibItem = {
    id, kind: kind === 'note' ? 'markdown' : 'doc', name, ext: kind === 'note' ? 'md' : 'odt',
    path: `${dir}/${name.replace(/\.(md|odt)$/, '')} ${new Date(now).toISOString().slice(0, 16).replace('T', ' ').replace(':', '.')}.${kind === 'note' ? 'md' : 'odt'}`,
    parentId: parent?.id ?? null, provider: 'home', availability: 'local', size: 0,
    added: now, modified: now, origin: 'created', tags: [], aiTags: [],
    content: kind === 'note' ? { t: 'markdown', text: initial ?? '' } : { t: 'doc', blocks: [{ k: 'title', text: '' }, { k: 'p', text: initial ?? '' }] },
    versions: [{ at: now, note: `Created in ${LIB_APPS[app].name}` }], autoName: true,
  };
  S().createItem(it);
  S().logUsage({ item: id, app, at: now, assembly: ctx.assembly, action: 'edit' });
  if (ctx.assembly) {
    const a = L.asm.get(ctx.assembly);
    if (a) S().setAttach(a.id, [id, ...a.attached]);
  }
  const ui = useLibUI.getState();
  ui.select(id);
  ui.openQL(id);
  ui.setEditing(id);
  toast(`New ${kind === 'note' ? 'note' : 'document'} — already saved`, `Lives in your library${ctx.assembly ? ` and is attached to ${L.asm.get(ctx.assembly)?.name}` : ''}. Name it whenever you like.`);
  return id;
}

/** Created docs: edits autosave; the name follows the first line until the user renames. */
export function editCreated(id: string, text: string) {
  S().updateCreated(id, (it) => {
    const first = text.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').trim().slice(0, 60);
    const name = it.autoName && first ? `${first}.${it.ext}` : it.name;
    const content = it.kind === 'markdown'
      ? { t: 'markdown' as const, text }
      : { t: 'doc' as const, blocks: text.split('\n\n').map((p, i) => (i === 0 ? { k: 'title' as const, text: p } : { k: 'p' as const, text: p })) };
    const versions = autosaveVersions(it);
    return { ...it, name, content, size: new Blob([text]).size, modified: Date.now(), versions };
  });
}

export function renameItem(id: string, name: string) {
  const L = libraryNow();
  const it = L.items.get(id);
  if (!it || !name.trim()) return;
  const clean = it.ext && !name.endsWith(`.${it.ext}`) ? `${name.trim()}.${it.ext}` : name.trim();
  if (it.origin === 'created') S().updateCreated(id, (x) => ({ ...x, name: clean, autoName: false, versions: [...(x.versions ?? []), { at: Date.now(), note: `Renamed to “${clean}”` }] }));
  else S().patchMeta(id, (m) => ({ ...m, name: clean }));
}

// ─── Tags ────────────────────────────────────────────────────────────────────

export function addPersonalTag(id: string, tagId: string) {
  const it = libraryNow().items.get(id);
  if (!it) return;
  S().patchMeta(id, (m) => ({ ...m, tags: [...new Set([...(m.tags ?? it.tags), tagId])] }));
}
export function removeTag(id: string, tagId: string) {
  const it = libraryNow().items.get(id);
  if (!it) return;
  S().patchMeta(id, (m) => ({
    ...m,
    tags: (m.tags ?? it.tags).filter((t) => t !== tagId),
    aiApproved: (m.aiApproved ?? []).filter((t) => t !== tagId),
    aiRejected: it.aiTags.includes(tagId) || S().ai[id]?.tags.includes(tagId) ? [...new Set([...(m.aiRejected ?? []), tagId])] : m.aiRejected,
  }));
}
export const approveSuggestion = (id: string, tagId: string) =>
  S().patchMeta(id, (m) => ({ ...m, aiApproved: [...new Set([...(m.aiApproved ?? []), tagId])] }));
export const rejectSuggestion = (id: string, tagId: string) =>
  S().patchMeta(id, (m) => ({ ...m, aiRejected: [...new Set([...(m.aiRejected ?? []), tagId])], aiApproved: (m.aiApproved ?? []).filter((t) => t !== tagId) }));

/** Reuse an existing tag when the label matches (case/spacing-insensitive) to avoid near-duplicates. */
export function findOrCreateTag(label: string, kind: 'personal' | 'topic' = 'personal'): string {
  const L = libraryNow();
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const hit = [...L.tags.values()].find((t) => norm(t.label) === norm(label));
  return hit ? hit.id : S().addTag(label, kind).id;
}

export async function runAnalysis(id: string) {
  const L = libraryNow();
  const it = L.items.get(id);
  if (!it) return;
  if (it.availability === 'unavailable' || it.availability === 'cloud-online') {
    toast('Can’t analyse this file', 'Its contents aren’t on this computer. Analysis only ever runs on local data.');
    return;
  }
  const { engine, model } = S().prefs.ai;
  try {
    const r = await analyzeItem(it, [...L.tags.values()], engine, model);
    S().setAi(id, r);
    toast(engine === 'ollama' ? `Analysed locally with ${model}` : 'Simulated analysis complete', engine === 'ollama' ? 'Ran on this computer via Ollama. Nothing left the machine.' : 'Keyword matching against your tag vocabulary. No model was used.');
  } catch (e) {
    toast('Local analysis failed', `${(e as Error).message}. Your library still works without it.`);
  }
}

// ─── Collections, assemblies, folders ────────────────────────────────────────

const cols = (fn: (c: Collection[]) => Collection[]) => S().setCollections(fn, libraryNow().seedCollections);

export function createCollection(name: string, items: string[], assembly?: string | null, pinnedFrom?: string): string {
  const id = uid('c');
  cols((c) => [...c, { id, name: name.trim() || 'Untitled collection', items: [...new Set(items)], assemblies: assembly ? [assembly] : [], created: Date.now(), pinnedFrom }]);
  return id;
}
export function addToCollection(cid: string, ids: string[]) {
  cols((c) => c.map((x) => (x.id === cid ? { ...x, items: [...new Set([...x.items, ...ids])] } : x)));
  const c = libraryNow().collections.find((x) => x.id === cid);
  toast(`Added to “${c?.name ?? 'collection'}”`, 'A reference only. Nothing was moved.');
}
export const removeFromCollection = (cid: string, ids: string[]) =>
  cols((c) => c.map((x) => (x.id === cid ? { ...x, items: x.items.filter((i) => !ids.includes(i)) } : x)));
export const renameCollection = (cid: string, name: string) => cols((c) => c.map((x) => (x.id === cid ? { ...x, name } : x)));
export function deleteCollection(cid: string) {
  const prev = libraryNow().collections;
  cols((c) => c.filter((x) => x.id !== cid));
  toast('Collection removed', 'Its files are untouched.', () => S().setCollections(() => prev, prev));
}
export const toggleCollectionAssembly = (cid: string, asm: string) =>
  cols((c) => c.map((x) => (x.id === cid ? { ...x, assemblies: x.assemblies.includes(asm) ? x.assemblies.filter((a) => a !== asm) : [...x.assemblies, asm] } : x)));

export function toggleAttach(asmId: string, ids: string[]) {
  const a = libraryNow().asm.get(asmId);
  if (!a) return;
  const on = !ids.every((i) => a.attached.includes(i));
  S().setAttach(asmId, on ? [...new Set([...ids, ...a.attached])] : a.attached.filter((i) => !ids.includes(i)));
  toast(on ? `Attached to ${a.name}` : `Detached from ${a.name}`, on ? 'It will be suggested whenever this Assembly is active.' : undefined);
}

export function moveToFolder(id: string, folderId: string) {
  const L = libraryNow();
  const it = L.items.get(id), f = L.items.get(folderId);
  if (!it || !f || f.kind !== 'folder') return;
  const from = it.path;
  const base = it.path.split('/').pop()!;
  const prev = S().meta[id];
  S().patchMeta(id, (m) => ({ ...m, moved: { parentId: f.id, path: `${f.path}/${base}`, provider: f.provider } }));
  toast(`Moved ${it.name} to ${f.name}`, `Simulated filesystem move: ${from} → ${f.path}/${base}`, () => S().patchMeta(id, () => prev ?? {}));
}
