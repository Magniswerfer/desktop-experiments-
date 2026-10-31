import { AnimatePresence } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createDocument, openItem, toggleAttach, toggleKeep } from '../model/actions';
import { useLibrary } from '../model/library';
import { queryRows } from '../model/query';
import { useLibStore, type SortKey } from '../model/store';
import { Panels } from './Panels';
import { QuickLook } from './QuickLook';
import { Shelf } from './Shelf';
import { Sidebar } from './Sidebar';
import { FileGrid, FileList } from './FileList';
import { useLibUI, type QLTab } from './uiStore';
import { Kbd } from './bits';
import './library.css';

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'recent', label: 'Recently used' }, { id: 'added', label: 'Date added' }, { id: 'modified', label: 'Date modified' },
  { id: 'name', label: 'Name' }, { id: 'kind', label: 'Kind' },
];
const TAB_KEYS: QLTab[] = ['preview', 'info', 'tags', 'activity', 'related'];

export function LibraryApp({ embedded = false }: { embedded?: boolean }) {
  const L = useLibrary();
  const prefs = useLibStore((s) => s.prefs);
  const query = useLibUI((s) => s.query);
  const orderAt = useLibUI((s) => s.orderAt);
  const qlOpen = useLibUI((s) => s.ql.open);
  const toasts = useLibUI((s) => s.toasts);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [gridCols, setGridCols] = useState(4);
  const [narrow, setNarrow] = useState(false);

  const { rows, ids } = useMemo(() => queryRows(L, prefs.scope, prefs.sort, query, orderAt), [L, prefs.scope, prefs.sort, query, orderAt]);

  // Theme on the document, so tokens resolve everywhere (including the desk).
  useEffect(() => {
    const r = document.documentElement;
    if (prefs.theme === 'system') delete r.dataset.theme; else r.dataset.theme = prefs.theme;
  }, [prefs.theme]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < 760));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Initial selection + focus.
  useEffect(() => {
    const ui = useLibUI.getState();
    if (!ui.sel && ids[0]) ui.select(ids[0]);
    if (!embedded) rootRef.current?.querySelector<HTMLElement>('[data-list]')?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const focusList = () => rootRef.current?.querySelector<HTMLElement>('[data-list]')?.focus({ preventScroll: true });
  const pendingOrder = useMemo(() => L.usage.filter((e) => e.at > orderAt && e.action !== 'download').length, [L, orderAt]);

  const onOpen = useCallback((id: string) => { useLibUI.getState().select(id); openItem(id); }, []);
  const onContext = useCallback((id: string) => { useLibUI.getState().select(id); useLibUI.getState().setPanel({ t: 'organize', ids: [id] }); }, []);

  const targets = () => {
    const ui = useLibUI.getState();
    if (ui.ql.open && ui.ql.stack.length > 1) return [ui.ql.stack[ui.ql.stack.length - 1]];
    return ui.multi.length ? ui.multi : ui.sel ? [ui.sel] : [];
  };

  const onKey = (e: React.KeyboardEvent) => {
    const ui = useLibUI.getState();
    const t = e.target as HTMLElement;
    const inField = !!t.closest('input, textarea, select, [contenteditable]');
    if (e.key === 'Escape') {
      if (ui.panel) return;
      if (ui.editing) { ui.setEditing(null); e.preventDefault(); return; }
      if (ui.ql.open) { ui.closeQL(); focusList(); e.preventDefault(); return; }
      if (inField && t === searchRef.current) { ui.setQuery(''); focusList(); e.preventDefault(); return; }
      if (ui.multi.length) { ui.select(ui.sel); return; }
      if (ui.query) { ui.setQuery(''); return; }
      return;
    }
    if (ui.panel) return;
    if (inField) {
      if (t === searchRef.current && (e.key === 'ArrowDown' || e.key === 'Enter')) {
        e.preventDefault();
        if (ids[0]) ui.select(ids[0]);
        focusList();
      }
      return;
    }
    if (t.closest('.cp-list')) return; // folder preview handles its own arrows
    if ((e.key === ' ' || e.key === 'Enter') && t.closest('button, a')) return; // let focused controls act natively
    if (e.metaKey || e.altKey) return;
    if (e.ctrlKey) {
      if (e.key === 'f') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'a') { e.preventDefault(); useLibUI.setState({ multi: ids.slice(), sel: ui.sel ?? ids[0] }); }
      return;
    }

    const grid = prefs.view === 'grid' && !ui.ql.open;
    const i = ui.sel ? ids.indexOf(ui.sel) : -1;
    const move = (d: number) => {
      e.preventDefault();
      if (!ids.length) return;
      const n = i < 0 ? 0 : Math.max(0, Math.min(ids.length - 1, i + d));
      ui.select(ids[n], { extend: e.shiftKey, ids });
    };
    switch (e.key) {
      case 'ArrowDown': return move(grid ? gridCols : 1);
      case 'ArrowUp': return move(grid ? -gridCols : -1);
      case 'ArrowRight': if (grid) move(1); return;
      case 'ArrowLeft': if (grid) move(-1); return;
      case 'PageDown': return move(grid ? gridCols * 4 : 15);
      case 'PageUp': return move(grid ? -gridCols * 4 : -15);
      case 'Home': return move(-1e9);
      case 'End': return move(1e9);
      case ' ':
        e.preventDefault();
        if (ui.ql.open) ui.closeQL(); else ui.openQL();
        return;
      case 'Enter': {
        e.preventDefault();
        const id = targets()[0];
        if (id && !id.startsWith('c_') && !id.startsWith('dyn_')) openItem(id);
        return;
      }
      case '/': e.preventDefault(); searchRef.current?.focus(); return;
    }
    const k = e.key.toLowerCase();
    const tg = targets();
    if (k >= '1' && k <= '5' && ui.ql.open) { ui.setTab(TAB_KEYS[Number(k) - 1]); return; }
    if (k === '?') { ui.setPanel({ t: 'help' }); return; }
    if (k === 'n') { e.preventDefault(); createDocument(e.shiftKey ? 'doc' : 'note'); return; }
    if (k === 'g') { useLibStore.getState().setPrefs({ view: prefs.view === 'grid' ? 'list' : 'grid' }); return; }
    if (k === 'd') { useLibStore.getState().setPrefs({ docked: !prefs.docked }); if (!ui.ql.open) ui.openQL(); return; }
    if (k === 'r') { ui.refreshOrder(); return; }
    if (!tg.length) return;
    if (k === 'k') toggleKeep(tg);
    else if (k === 'o') ui.setPanel({ t: 'organize', ids: tg });
    else if (k === 'c') ui.setPanel({ t: 'collection', ids: tg });
    else if (k === 't') { e.preventDefault(); if (tg.length > 1) ui.setPanel({ t: 'organize', ids: tg }); else { ui.openQL(tg[0]); ui.setTab('tags'); setTimeout(() => rootRef.current?.querySelector<HTMLInputElement>('.tag-add input')?.focus(), 30); } }
    else if (k === 'a') { const a = prefs.ctx.assembly; if (a) toggleAttach(a, tg); else ui.toast({ text: 'No Assembly in focus', detail: 'Choose one in the context switcher above.' }); }
    else if (k === 'e') {
      const it = L.items.get(tg[0]);
      if (it?.origin === 'created' && (it.kind === 'markdown' || it.kind === 'doc')) { e.preventDefault(); if (!ui.ql.open) ui.openQL(it.id); ui.setEditing(ui.editing ? null : it.id); }
    }
  };

  const scopeTitle = (() => {
    const s = prefs.scope;
    switch (s.t) {
      case 'all': return 'Everything';
      case 'inbox': return 'Received';
      case 'created': return 'Created';
      case 'folder': return L.items.get(s.id)?.name ?? 'Folder';
      case 'provider': return L.providers[s.id]?.label;
      case 'collection': return L.collections.find((c) => c.id === s.id)?.name ?? 'Collection';
      case 'tag': return L.tags.get(s.id)?.label ?? 'Tag';
    }
  })();
  const scopeNote = prefs.scope.t === 'inbox' ? 'Downloads and imports, newest first. Keep what matters; nothing is ever deleted for you.'
    : prefs.scope.t === 'created' ? 'Everything you made. Saved automatically, no folder required.'
      : prefs.scope.t === 'collection' ? 'A collection holds references. Files stay where they are.'
        : prefs.scope.t === 'folder' ? L.items.get(prefs.scope.id)?.path.replace(/^\/home\/magnus/, '~') : null;
  const showShelf = prefs.scope.t === 'all' && !query;
  const docked = prefs.docked && qlOpen;

  return (
    <div ref={rootRef} className={`lib ${embedded ? 'embedded' : 'standalone'} ${narrow ? 'narrow' : ''} ${docked ? 'is-docked' : ''}`} onKeyDown={onKey}
      // Like native desktop buttons, clicking a control doesn't steal keyboard focus from the list.
      onMouseDown={(e) => { const t = e.target as HTMLElement; if (t.closest('button') && !t.closest('.modal')) e.preventDefault(); }}
    >
      {!embedded && (
        <header className="lib-masthead">
          <span className="wordmark">Library</span>
          <span className="faint small">An experimental file library for Lodestone</span>
          <span className="grow" />
          <a className="link-btn" href="#desk">Open the desk →</a>
        </header>
      )}
      <div className="lib-body">
        {!narrow && <Sidebar L={L} />}
        <main className="lib-main">
          <div className="toolbar">
            <div className="scope-title">
              <h1>{scopeTitle}</h1>
              {scopeNote && <p className="faint small">{scopeNote}</p>}
            </div>
            <div className="search">
              <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden><circle cx="5.5" cy="5.5" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M8.6 8.6L12 12" stroke="currentColor" strokeWidth="1.3" /></svg>
              <input
                ref={searchRef} value={query} onChange={(e) => useLibUI.getState().setQuery(e.target.value)}
                placeholder={`Search ${prefs.scope.t === 'all' ? 'everything' : scopeTitle}`} aria-label="Search the library"
              />
              {!query && <Kbd>/</Kbd>}
            </div>
            <select value={prefs.sort} onChange={(e) => useLibStore.getState().setPrefs({ sort: e.target.value as SortKey })} aria-label="Sort by">
              {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <div className="seg" role="radiogroup" aria-label="View">
              <button role="radio" aria-checked={prefs.view === 'list'} className={`seg-b ${prefs.view === 'list' ? 'on' : ''}`} onClick={() => useLibStore.getState().setPrefs({ view: 'list' })} title="List (G)">List</button>
              <button role="radio" aria-checked={prefs.view === 'grid'} className={`seg-b ${prefs.view === 'grid' ? 'on' : ''}`} onClick={() => useLibStore.getState().setPrefs({ view: 'grid' })} title="Grid (G)">Grid</button>
            </div>
            <button className="btn primary" onClick={() => createDocument('note')} title="New note (N) · Shift+N for a document">New note</button>
            <button className="icon-btn" onClick={() => useLibUI.getState().setPanel({ t: 'settings' })} aria-label="Settings" title="Settings">
              <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden><path d="M2 4h11M2 7.5h11M2 11h11" stroke="currentColor" strokeWidth="1.3" /><rect x="4" y="2.5" width="2.4" height="3" fill="var(--ds-paper)" stroke="currentColor" strokeWidth="1.2" /><rect x="9" y="6" width="2.4" height="3" fill="var(--ds-paper)" stroke="currentColor" strokeWidth="1.2" /><rect x="5.5" y="9.5" width="2.4" height="3" fill="var(--ds-paper)" stroke="currentColor" strokeWidth="1.2" /></svg>
            </button>
            <button className="icon-btn" onClick={() => useLibUI.getState().setPanel({ t: 'help' })} aria-label="Keyboard shortcuts" title="Keyboard (?)">?</button>
          </div>
          {narrow && <ScopeChips />}
          {showShelf && <Shelf L={L} />}
          <div className="status-line">
            <span className="tnum faint">{ids.length.toLocaleString()} items{query && ` matching “${query}”`}</span>
            <MultiBar />
            <span className="grow" />
            {pendingOrder > 0 && prefs.sort === 'recent' && (
              <button className="link-btn" onClick={() => useLibUI.getState().refreshOrder()} title="The list keeps its order while you work. Apply recent activity now (R).">
                {pendingOrder} new {pendingOrder === 1 ? 'activity' : 'activities'} · update order
              </button>
            )}
          </div>
          <div className="view-area">
            {prefs.view === 'list'
              ? <FileList L={L} rows={rows} ids={ids} sort={prefs.sort} onOpen={onOpen} onContext={onContext} />
              : <FileGrid L={L} ids={ids} onOpen={onOpen} onContext={onContext} onCols={setGridCols} />}
            <AnimatePresence>
              {qlOpen && !prefs.docked && <QuickLook key="ql" L={L} docked={false} />}
            </AnimatePresence>
          </div>
        </main>
        {docked && <aside className="inspector"><QuickLook L={L} docked /></aside>}
      </div>
      <Panels L={L} />
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <b>{t.text}</b>
            {t.detail && <span className="faint">{t.detail}</span>}
            {t.undo && <button className="link-btn" onClick={() => { t.undo!(); useLibUI.getState().dropToast(t.id); }}>Undo</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

function MultiBar() {
  const multi = useLibUI((s) => s.multi);
  if (multi.length < 2) return null;
  return (
    <span className="multibar">
      <b className="tnum">{multi.length} selected</b>
      <button className="link-btn" onClick={() => useLibUI.getState().setPanel({ t: 'collection', ids: multi })}>Collect (C)</button>
      <button className="link-btn" onClick={() => toggleKeep(multi)}>Keep (K)</button>
      <button className="link-btn" onClick={() => useLibUI.getState().setPanel({ t: 'organize', ids: multi })}>Organize (O)</button>
    </span>
  );
}

function ScopeChips() {
  const scope = useLibStore((s) => s.prefs.scope);
  const set = (t: 'all' | 'inbox' | 'created') => useLibStore.getState().setPrefs({ scope: { t } });
  return (
    <div className="scope-chips seg" role="radiogroup" aria-label="Scope">
      {(['all', 'inbox', 'created'] as const).map((t) => <button key={t} role="radio" aria-checked={scope.t === t} className={`seg-b ${scope.t === t ? 'on' : ''}`} onClick={() => set(t)}>{t === 'all' ? 'Everything' : t === 'inbox' ? 'Received' : 'Created'}</button>)}
    </div>
  );
}
