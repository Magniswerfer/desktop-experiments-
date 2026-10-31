import type { LibIndex } from '../model/library';
import { useLibStore, type Scope } from '../model/store';
import { AvailMark } from './bits';
import { useLibUI } from './uiStore';

const same = (a: Scope, b: Scope) => a.t === b.t && ('id' in a ? a.id : '') === ('id' in b ? (b as { id: string }).id : '');

export function Sidebar({ L }: { L: LibIndex }) {
  const scope = useLibStore((s) => s.prefs.scope);
  const set = (sc: Scope) => { useLibStore.getState().setPrefs({ scope: sc }); useLibUI.getState().setQuery(''); };
  const inbox = L.all.filter((i) => i.origin === 'received' && !L.kept(i.id)).length;
  const created = L.all.filter((i) => i.origin === 'created').length;
  const Item = ({ sc, children, count, title }: { sc: Scope; children: React.ReactNode; count?: number | string; title?: string }) => (
    <li><button className={`side-item ${same(scope, sc) ? 'on' : ''}`} onClick={() => set(sc)} aria-current={same(scope, sc) ? 'page' : undefined} title={title}>{children}{count !== undefined && <span className="side-n tnum">{count}</span>}</button></li>
  );
  const topTags = [...L.tags.values()].filter((t) => t.kind === 'personal').slice(0, 8);
  const folderScope = scope.t === 'folder' ? L.items.get(scope.id) : null;
  return (
    <nav className="sidebar" aria-label="Library scopes">
      <ul>
        <Item sc={{ t: 'all' }} count={L.all.length}>Everything</Item>
        <Item sc={{ t: 'inbox' }} count={inbox || undefined} title="Received files: downloads, imports, attachments">Received</Item>
        <Item sc={{ t: 'created' }} count={created} title="Documents you made; saved automatically">Created</Item>
      </ul>
      {folderScope && (
        <>
          <h3 className="label">Folder</h3>
          <ul><Item sc={scope}>{folderScope.name}</Item></ul>
        </>
      )}
      <h3 className="label side-h">
        Collections
        <button className="side-add" onClick={() => useLibUI.getState().setPanel({ t: 'collection', ids: useLibUI.getState().multi.length ? useLibUI.getState().multi : useLibUI.getState().sel ? [useLibUI.getState().sel!] : [] })} aria-label="New collection" title="New collection (C)">+</button>
      </h3>
      <ul>
        {L.collections.map((c) => (
          <Item key={c.id} sc={{ t: 'collection', id: c.id }} count={c.items.length}>
            <span className="col-glyph" aria-hidden />{c.name}
          </Item>
        ))}
      </ul>
      <h3 className="label">Locations</h3>
      <ul>
        {Object.values(L.providers).map((p) => {
          const n = L.all.filter((i) => i.provider === p.id).length;
          const av = p.kind === 'external' ? (p.connected ? 'local' : 'unavailable') : p.kind === 'cloud' ? 'cloud-downloaded' : p.kind === 'git' ? 'git' : 'local';
          return (
            <li key={p.id} className="prov-li">
              <button className={`side-item ${same(scope, { t: 'provider', id: p.id }) ? 'on' : ''} ${!p.connected ? 'off' : ''}`} onClick={() => set({ t: 'provider', id: p.id })}>
                <AvailMark a={av} /> {p.label}<span className="side-n tnum">{n}</span>
              </button>
              {(p.kind === 'external' || p.kind === 'cloud') && (
                <button className="side-sim" onClick={() => useLibStore.getState().setProvider(p.id, !p.connected)} title={`Simulate ${p.connected ? 'disconnecting' : 'connecting'} ${p.label}`}>
                  {p.connected ? (p.kind === 'cloud' ? 'online' : 'connected') : (p.kind === 'cloud' ? 'offline' : 'not connected')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <h3 className="label">Tags</h3>
      <ul>
        {topTags.map((t) => <Item key={t.id} sc={{ t: 'tag', id: t.id }}>{t.label}</Item>)}
      </ul>
    </nav>
  );
}
