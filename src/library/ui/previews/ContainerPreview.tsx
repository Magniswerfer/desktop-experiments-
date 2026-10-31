import { useMemo, useRef, useState } from 'react';
import { LIB_APPS } from '../../model/apps';
import { fmtAgo, fmtSize, fmtWhen, tildify } from '../../model/format';
import type { LibIndex } from '../../model/library';
import { matches } from '../../model/query';
import type { AppId, LibItem } from '../../model/types';
import { AvailMark } from '../bits';
import { CollectionGlyph, Thumb } from '../Thumb';
import { useLibUI } from '../uiStore';

// Folders and collections share one preview: a navigable, searchable list of
// contents. Folders are real directories (with a path, and moving into them
// moves files); collections hold references (adding moves nothing).

type Sort = 'recent' | 'name' | 'kind';

export interface ContainerProps {
  L: LibIndex;
  kind: 'folder' | 'collection' | 'dynamic';
  title: string;
  ids: string[];
  /** Folder root id (for nested navigation). */
  rootId?: string;
  subtitle: React.ReactNode;
  actions?: React.ReactNode;
}

export function ContainerPreview({ L, kind, title, ids, rootId, subtitle, actions }: ContainerProps) {
  const stack = useLibUI((s) => s.qlFolder);
  const setStack = useLibUI((s) => s.setQlFolder);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>(kind === 'folder' ? 'kind' : 'recent');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const curFolder = kind === 'folder' ? (stack[stack.length - 1] ?? rootId) : undefined;
  const baseIds = curFolder && curFolder !== rootId ? (L.children.get(curFolder) ?? []) : ids;

  // Searching a folder searches all of its descendants.
  const items = useMemo(() => {
    let list: LibItem[];
    if (q && kind === 'folder' && curFolder) {
      list = [];
      const walk = (f: string) => { for (const c of L.children.get(f) ?? []) { const it = L.items.get(c)!; list.push(it); if (it.kind === 'folder') walk(c); } };
      walk(curFolder);
    } else list = baseIds.map((id) => L.items.get(id)!).filter(Boolean);
    list = list.filter((it) => matches(L, it, q));
    const act = (it: LibItem) => L.lastOpened.get(it.id) ?? it.modified;
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    else if (sort === 'kind') list.sort((a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder') || a.name.localeCompare(b.name, undefined, { numeric: true }));
    else list.sort((a, b) => act(b) - act(a));
    return list;
  }, [L, baseIds, q, sort, kind, curFolder]);

  const stats = useMemo(() => {
    let files = 0, size = 0, last = 0;
    const reps: LibItem[] = [];
    const apps = new Map<AppId, number>();
    const asms = new Set<string>();
    const tagCount = new Map<string, number>();
    const visit = (it: LibItem) => {
      if (it.kind === 'folder') { const fs = L.folderStats(it.id); files += fs.files; size += fs.size; last = Math.max(last, fs.last); }
      else { files++; size += it.size; last = Math.max(last, L.lastOpened.get(it.id) ?? it.modified); if (reps.length < 4 && it.content && ['image', 'pdf', 'slides', 'markdown', 'code', 'doc'].includes(it.kind)) reps.push(it); }
      for (const e of L.byItem.get(it.id) ?? []) { if (e.action !== 'download') apps.set(e.app, (apps.get(e.app) ?? 0) + 1); if (e.assembly) asms.add(e.assembly); }
      for (const t of [...it.tags, ...it.aiTags]) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
    };
    const root = curFolder ? (L.children.get(curFolder) ?? []) : ids;
    for (const id of root) { const it = L.items.get(id); if (it) visit(it); }
    if (curFolder) {
      // reps from descendants when the folder only has subfolders
      if (reps.length < 3) for (const id of root) for (const r of L.folderStats(id).reps) { const it = L.items.get(r); if (it && reps.length < 4 && !reps.includes(it)) reps.push(it); }
      for (const a of L.assembliesOf(curFolder)) asms.add(a.id);
    }
    return {
      files, size, last, reps,
      apps: [...apps.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => a),
      asms: [...asms].map((a) => L.asm.get(a)).filter(Boolean),
      tags: [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => t),
    };
  }, [L, ids, curFolder]);

  const enter = (it: LibItem) => {
    if (it.kind === 'folder' && kind === 'folder') { setStack([...stack, it.id]); setQ(''); setCursor(0); }
    else useLibUI.getState().pushQL(it.id);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      const n = Math.max(0, Math.min(items.length - 1, cursor + (e.key === 'ArrowDown' ? 1 : -1)));
      setCursor(n);
      listRef.current?.children[n]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' || e.key === 'ArrowRight') {
      const it = items[cursor];
      if (it) { e.preventDefault(); e.stopPropagation(); enter(it); }
    } else if ((e.key === 'Backspace' || e.key === 'ArrowLeft') && !(e.target instanceof HTMLInputElement && (e.target.value || e.key === 'ArrowLeft'))) {
      if (stack.length) { e.preventDefault(); e.stopPropagation(); setStack(stack.slice(0, -1)); setCursor(0); }
    }
  };

  const crumbs = kind === 'folder' && rootId ? [rootId, ...stack] : [];
  const cur = curFolder ? L.items.get(curFolder) : undefined;

  return (
    <div className={`container-pv cp-${kind}`} onKeyDown={onKey}>
      <header className="cp-head">
        <div className="cp-reps" aria-hidden>
          {stats.reps.length ? stats.reps.map((r) => <Thumb key={r.id} item={r} size={86} />) : kind === 'folder' ? <Thumb item={L.items.get(rootId!)!} size={86} /> : <CollectionGlyph size={86} dynamic={kind === 'dynamic'} />}
        </div>
        <div className="cp-meta">
          <p className="cp-kind label">{kind === 'folder' ? 'Folder' : kind === 'collection' ? 'Collection · references only' : 'Dynamic view · generated from context'}</p>
          <h2>{cur && cur.id !== rootId ? cur.name : title}</h2>
          <p className="cp-sub">{subtitle}</p>
          <p className="cp-stats tnum">{stats.files} files · {fmtSize(stats.size)} · last activity {fmtAgo(stats.last, L.now)}</p>
          <p className="cp-assoc">
            {stats.apps.length > 0 && <span>Opened with {stats.apps.map((a) => LIB_APPS[a].name).join(', ')}</span>}
            {stats.asms.length > 0 && <span>· Used in {stats.asms.map((a) => <b key={a!.id} className={`asm-dot ink-${a!.ink}`}>{a!.name}</b>)}</span>}
          </p>
          {stats.tags.length > 0 && <p className="cp-tags">{stats.tags.map((t) => <span key={t} className="row-tag">{L.tags.get(t)?.label}</span>)}</p>}
          {actions && <div className="cp-actions">{actions}</div>}
        </div>
      </header>
      {crumbs.length > 1 && (
        <nav className="crumbs" aria-label="Folder path">
          {crumbs.map((c, i) => (
            <span key={c}>
              {i > 0 && <span className="faint"> / </span>}
              <button className="crumb" disabled={i === crumbs.length - 1} onClick={() => { setStack(stack.slice(0, i)); setCursor(0); }}>{L.items.get(c)?.name}</button>
            </span>
          ))}
        </nav>
      )}
      <div className="cp-tools">
        <input className="cp-search" placeholder={kind === 'folder' ? `Search in ${cur?.name ?? title}` : `Search ${title}`} value={q} onChange={(e) => { setQ(e.target.value); setCursor(0); }} aria-label="Search contents" />
        <select className="cp-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort contents">
          <option value="recent">Recent</option><option value="name">Name</option><option value="kind">Folders first</option>
        </select>
      </div>
      <ul className="cp-list" ref={listRef} role="listbox" tabIndex={0} aria-label="Contents" aria-activedescendant={items[cursor] ? `cp-${items[cursor].id}` : undefined}>
        {items.map((it, i) => (
          <li
            key={it.id} id={`cp-${it.id}`} role="option" aria-selected={i === cursor}
            className={`cp-row ${i === cursor ? 'on' : ''} ${it.availability === 'unavailable' ? 'unavail' : ''}`}
            onMouseDown={() => setCursor(i)} onDoubleClick={() => enter(it)} onClick={(e) => e.detail === 1 && it.kind === 'folder' && kind === 'folder' && enter(it)}
          >
            <Thumb item={it} size={22} />
            <span className="nm">{it.name}{q && it.parentId !== curFolder && <span className="faint"> · {L.items.get(it.parentId ?? '')?.name}</span>}</span>
            {kind !== 'folder' && <span className="faint loc"><AvailMark a={it.availability} size={10} /> {L.providers[it.provider].label}</span>}
            <span className="faint tnum">{it.kind === 'folder' ? `${L.folderStats(it.id).count} items` : fmtSize(it.size)}</span>
            <span className="faint tnum">{fmtWhen(L.lastOpened.get(it.id) ?? it.modified, L.now)}</span>
            {it.kind === 'folder' && kind === 'folder' && <span className="chev" aria-hidden>›</span>}
          </li>
        ))}
        {items.length === 0 && <li className="empty serif">{q ? 'Nothing here matches.' : 'Empty. Add files from the library with C, or drop them here in a later version.'}</li>}
      </ul>
      {kind === 'folder' && cur && <p className="cp-path mono faint">{tildify(cur.path)}</p>}
    </div>
  );
}
