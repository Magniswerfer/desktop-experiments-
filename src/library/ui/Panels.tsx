import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addPersonalTag, addToCollection, createCollection, findOrCreateTag, moveToFolder, removeFromCollection, toggleAttach,
} from '../model/actions';
import { tildify } from '../model/format';
import type { LibIndex } from '../model/library';
import { ollamaAnalyzer } from '../model/ai';
import { useLibStore } from '../model/store';
import { Kbd } from './bits';
import { TagsTab } from './QuickLook';
import { useLibUI } from './uiStore';

// Modal panels: organize (tags/collections/assemblies/move), collection picker,
// settings and keyboard help. Each traps Escape and returns focus to the list.

function Modal({ title, children, wide = false }: { title: string; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, button, select');
    first?.focus();
    return () => { prev?.focus?.(); };
  }, []);
  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && useLibUI.getState().setPanel(null)}>
      <div
        ref={ref} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal aria-label={title}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); useLibUI.getState().setPanel(null); } }}
      >
        <header className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={() => useLibUI.getState().setPanel(null)} aria-label="Close">×</button></header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Panels({ L }: { L: LibIndex }) {
  const panel = useLibUI((s) => s.panel);
  if (!panel) return null;
  if (panel.t === 'organize') return <Organize L={L} ids={panel.ids} />;
  if (panel.t === 'collection') return <CollectionPicker L={L} ids={panel.ids} />;
  if (panel.t === 'settings') return <Settings />;
  return <Help />;
}

function Organize({ L, ids }: { L: LibIndex; ids: string[] }) {
  const items = ids.map((i) => L.items.get(i)!).filter(Boolean);
  const [draft, setDraft] = useState('');
  const [dest, setDest] = useState('');
  const folders = useMemo(() => L.all.filter((i) => i.kind === 'folder' && i.availability !== 'unavailable' && !i.id.startsWith('d_stress')).sort((a, b) => a.path.localeCompare(b.path)), [L]);
  if (!items.length) return null;
  const one = items.length === 1 ? items[0] : null;
  return (
    <Modal title={one ? `Organize ${one.name}` : `Organize ${items.length} files`} wide>
      <p className="faint small serif">Organizing is optional and separate from keeping. Tags and collections never move files; only “Move to folder” changes where a file lives.</p>
      <div className="org-grid">
        <section>
          <h3 className="label">Tags</h3>
          {one ? <TagsTab L={L} it={one} autoFocus /> : (
            <div className="tag-add">
              <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Tag all selected…" aria-label="Tag all selected"
                onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) { const t = findOrCreateTag(draft); items.forEach((i) => addPersonalTag(i.id, t)); setDraft(''); useLibUI.getState().toast({ text: `Tagged ${items.length} files “${L.tags.get(t)?.label ?? draft}”` }); } }} />
            </div>
          )}
        </section>
        <section>
          <h3 className="label">Collections <span className="faint">· references</span></h3>
          <ul className="check-list">
            {L.collections.map((c) => {
              const all = items.every((i) => c.items.includes(i.id));
              return (
                <li key={c.id}><label><input type="checkbox" checked={all} onChange={() => (all ? removeFromCollection(c.id, ids) : addToCollection(c.id, ids))} /> {c.name} <span className="faint tnum">{c.items.length}</span></label></li>
              );
            })}
          </ul>
          <button className="link-btn" onClick={() => useLibUI.getState().setPanel({ t: 'collection', ids })}>New collection…</button>
          <h3 className="label">Attach to Assembly</h3>
          <ul className="check-list">
            {L.assemblies.map((a) => {
              const all = items.every((i) => a.attached.includes(i.id));
              return <li key={a.id}><label><input type="checkbox" checked={all} onChange={() => toggleAttach(a.id, ids)} /> <span className={`asm-dot ink-${a.ink}`}>{a.name}</span></label></li>;
            })}
          </ul>
        </section>
        <section>
          <h3 className="label">Move to folder <span className="faint">· changes the real location</span></h3>
          <select value={dest} onChange={(e) => setDest(e.target.value)} aria-label="Destination folder" className="wide-select">
            <option value="">Choose a folder…</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{tildify(f.path)}</option>)}
          </select>
          {dest && <p className="small mono faint">{items.map((i) => tildify(i.path)).slice(0, 3).join(', ')}{items.length > 3 ? '…' : ''} → {tildify(L.items.get(dest)!.path)}/</p>}
          <button className="btn" disabled={!dest} onClick={() => { items.forEach((i) => moveToFolder(i.id, dest)); useLibUI.getState().setPanel(null); }}>Move (simulated)</button>
        </section>
      </div>
    </Modal>
  );
}

function CollectionPicker({ L, ids }: { L: LibIndex; ids: string[] }) {
  const ctx = useLibStore((s) => s.prefs.ctx);
  const [name, setName] = useState('');
  const [assoc, setAssoc] = useState(!!ctx.assembly);
  const items = ids.map((i) => L.items.get(i)!).filter(Boolean);
  const provs = new Set(items.map((i) => L.providers[i.provider].label));
  const create = () => {
    const id = createCollection(name || 'Untitled collection', ids, assoc ? ctx.assembly : null);
    useLibUI.getState().setPanel(null);
    useLibUI.getState().toast({ text: `Created “${name || 'Untitled collection'}”`, detail: `${ids.length} references${provs.size > 1 ? ` across ${[...provs].join(', ')}` : ''}. Nothing was moved.` });
    useLibUI.getState().openQL(id);
  };
  return (
    <Modal title={ids.length ? `Collect ${ids.length === 1 ? items[0]?.name : `${ids.length} files`}` : 'New collection'}>
      {ids.length > 0 && L.collections.length > 0 && (
        <>
          <h3 className="label">Add to existing</h3>
          <ul className="pick-list">
            {L.collections.map((c) => (
              <li key={c.id}><button className="side-item" onClick={() => { addToCollection(c.id, ids); useLibUI.getState().setPanel(null); }}>{c.name}<span className="side-n tnum">{c.items.length}</span></button></li>
            ))}
          </ul>
        </>
      )}
      <h3 className="label">New collection</h3>
      <div className="field">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Collection name" onKeyDown={(e) => e.key === 'Enter' && create()} />
      </div>
      {ctx.assembly && <label className="check"><input type="checkbox" checked={assoc} onChange={(e) => setAssoc(e.target.checked)} /> Associate with {L.asm.get(ctx.assembly)?.name}</label>}
      {provs.size > 1 && <p className="faint small">Spans {[...provs].join(' · ')}. Collections hold references, so files stay where they are.</p>}
      <div className="modal-foot"><button className="btn primary" onClick={create}>Create collection</button></div>
      {ids.length === 0 && <p className="faint small serif">Tip: select several files first (Shift+↑↓ or Ctrl+click), then press C.</p>}
    </Modal>
  );
}

function Settings() {
  const prefs = useLibStore((s) => s.prefs);
  const set = useLibStore((s) => s.setPrefs);
  const [probe, setProbe] = useState<'idle' | 'checking' | 'ok' | 'no'>('idle');
  const [confirm, setConfirm] = useState(false);
  const check = async () => { setProbe('checking'); setProbe((await ollamaAnalyzer(prefs.ai.model).available()) ? 'ok' : 'no'); };
  return (
    <Modal title="Library settings">
      <h3 className="label">Appearance</h3>
      <div className="seg" role="radiogroup" aria-label="Theme">
        {(['system', 'light', 'dark'] as const).map((t) => <button key={t} role="radio" aria-checked={prefs.theme === t} className={`seg-b ${prefs.theme === t ? 'on' : ''}`} onClick={() => set({ theme: t })}>{t[0].toUpperCase() + t.slice(1)}</button>)}
      </div>
      <h3 className="label">Suggestions</h3>
      <label className="check"><input type="checkbox" checked={prefs.suggestions} onChange={(e) => set({ suggestions: e.target.checked })} /> Show contextual suggestions</label>
      <h3 className="label">Content analysis</h3>
      <div className="seg" role="radiogroup" aria-label="Analysis engine">
        <button role="radio" aria-checked={prefs.ai.engine === 'simulated'} className={`seg-b ${prefs.ai.engine === 'simulated' ? 'on' : ''}`} onClick={() => set({ ai: { ...prefs.ai, engine: 'simulated' } })}>Simulated</button>
        <button role="radio" aria-checked={prefs.ai.engine === 'ollama'} className={`seg-b ${prefs.ai.engine === 'ollama' ? 'on' : ''}`} onClick={() => set({ ai: { ...prefs.ai, engine: 'ollama' } })}>Local Ollama</button>
      </div>
      {prefs.ai.engine === 'ollama' && (
        <div className="field">
          <label className="label" htmlFor="olm">Model</label>
          <input id="olm" value={prefs.ai.model} onChange={(e) => set({ ai: { ...prefs.ai, model: e.target.value } })} />
          <button className="btn" onClick={check} aria-busy={probe === 'checking'}>Check localhost:11434</button>
          <p className="small">{probe === 'ok' ? 'Ollama is running with this model.' : probe === 'no' ? 'Not reachable, or the model isn’t pulled. Analysis will fail gracefully; nothing else depends on it.' : ''}</p>
        </div>
      )}
      <p className="faint small serif">Analysis runs only when you ask, only on files stored on this computer, and only against a runtime on localhost. File contents are never sent to third-party services.</p>
      <h3 className="label">Scale test</h3>
      <label className="check"><input type="checkbox" checked={prefs.stress} onChange={(e) => set({ stress: e.target.checked })} /> Add 5,000 archived photos and scans (Nextcloud, online only)</label>
      <h3 className="label">Prototype state</h3>
      <button className={`btn ${confirm ? 'danger' : ''}`} onClick={() => { if (!confirm) return setConfirm(true); useLibStore.getState().reset(); useLibUI.getState().setPanel(null); location.reload(); }}>
        {confirm ? 'Confirm: forget my tags, collections and created documents' : 'Reset library state'}
      </button>
    </Modal>
  );
}

const KEYS: [string, string][] = [
  ['↑ ↓', 'Move selection (also while previewing)'], ['Shift ↑ ↓', 'Extend selection'], ['Home / End, PgUp / PgDn', 'Jump'],
  ['Space', 'Quick Look on / off'], ['↵', 'Open in its application'], ['Esc', 'Close preview · clear search'],
  ['← →', 'Pages and slides in Quick Look'], ['1–5', 'Quick Look views: preview, info, tags, activity, related'],
  ['/', 'Search'], ['K', 'Keep a received file'], ['O', 'Organize'], ['T', 'Tags'], ['C', 'Add to collection'],
  ['A', 'Attach to the current Assembly'], ['N', 'New note (no folder needed)'], ['E', 'Edit a created document'],
  ['G', 'List / grid'], ['D', 'Dock the inspector'], ['R', 'Apply new activity to the order'], ['?', 'This help'],
];

function Help() {
  return (
    <Modal title="Keyboard">
      <table className="keys">
        <tbody>{KEYS.map(([k, d]) => <tr key={k}><td>{k.split(' ').map((x, i) => (x === '/' && k.length > 1 ? ' / ' : <Kbd key={i}>{x}</Kbd>))}</td><td>{d}</td></tr>)}</tbody>
      </table>
    </Modal>
  );
}

