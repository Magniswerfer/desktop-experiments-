import { motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addPersonalTag, approveSuggestion, createCollection, editCreated, findOrCreateTag, openItem, rejectSuggestion,
  removeTag, renameItem, runAnalysis, toggleAttach, toggleKeep,
} from '../model/actions';
import { defaultApp, KIND_LABEL, LIB_APPS } from '../model/apps';
import { fmtAgo, fmtDateTime, fmtSize, tildify } from '../model/format';
import type { LibIndex } from '../model/library';
import { AVAIL_LABEL } from '../model/providers';
import { ctxKey, rankContext } from '../model/relevance';
import { contentText, useLibStore } from '../model/store';
import type { AppId, Collection, LibItem } from '../model/types';
import { AvailMark, Kbd, TagChip } from './bits';
import { ContainerPreview } from './previews/ContainerPreview';
import { ContentPreview, pageCount, useContent } from './previews/Previews';
import { CollectionGlyph, Thumb } from './Thumb';
import { useLibUI, type QLTab } from './uiStore';

const TABS: { id: QLTab; label: string }[] = [
  { id: 'preview', label: 'Preview' }, { id: 'info', label: 'Info' }, { id: 'tags', label: 'Tags' },
  { id: 'activity', label: 'Activity' }, { id: 'related', label: 'Related' },
];

export function useDynamicView(L: LibIndex) {
  const ctx = useLibStore((s) => s.prefs.ctx);
  const pins = useLibStore((s) => s.pins[ctxKey(ctx)]);
  const dis = useLibStore((s) => s.dismissed[ctxKey(ctx)]);
  return useMemo(() => rankContext(L, ctx, pins ?? [], dis ?? []).dynamic, [L, ctx, pins, dis]);
}

export function QuickLook({ L, docked }: { L: LibIndex; docked: boolean }) {
  const stack = useLibUI((s) => s.ql.stack);
  const tab = useLibUI((s) => s.ql.tab);
  const id = stack[stack.length - 1];
  const dyn = useDynamicView(L);
  const [pages, setPages] = useState<Record<string, number>>({});
  const page = pages[id] ?? 0;
  const setPage = (n: number) => setPages((p) => ({ ...p, [id]: n }));

  const it = L.items.get(id);
  const col = !it ? L.collections.find((c) => c.id === id) : undefined;
  const isDyn = !it && !col && dyn?.id === id;

  // ←/→ flip pages and slides while Quick Look is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, .cp-list')) return;
      if (tab !== 'preview' || !it) return;
      const n = pageCount(it.content);
      if (n <= 1) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        setPage(Math.max(0, Math.min(n - 1, page + (e.key === 'ArrowRight' ? 1 : -1))));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!id || (!it && !col && !isDyn)) return null;
  const back = stack.length > 1 ? stack[stack.length - 2] : null;
  const backName = back ? L.items.get(back)?.name ?? L.collections.find((c) => c.id === back)?.name : null;

  return (
    <motion.section
      className={`ql ${docked ? 'docked' : 'floating'}`}
      role="dialog"
      aria-label={`Quick Look: ${it?.name ?? col?.name ?? dyn?.name}`}
      initial={docked ? false : { opacity: 0, scale: 0.985, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.985, transition: { duration: 0.12 } }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
    >
      {back && (
        <button className="ql-back" onClick={() => useLibUI.getState().popQL()}>← Back to {backName}</button>
      )}
      {it ? <ItemLook L={L} it={it} tab={tab} page={page} setPage={setPage} /> : col ? <CollectionLook L={L} c={col} /> : <DynamicLook L={L} dyn={dyn!} />}
    </motion.section>
  );
}

// ─── Files and folders ───────────────────────────────────────────────────────

function ItemLook({ L, it, tab, page, setPage }: { L: LibIndex; it: LibItem; tab: QLTab; page: number; setPage: (n: number) => void }) {
  const editing = useLibUI((s) => s.editing === it.id);
  const [renaming, setRenaming] = useState(false);
  const app = defaultApp(it);
  const last = L.lastOpened.get(it.id);
  const recv = it.origin === 'received';
  const kept = L.kept(it.id);
  const p = L.providers[it.provider];

  return (
    <>
      <header className="ql-head">
        <Thumb item={it} size={34} />
        <div className="ql-title">
          {renaming ? (
            <input
              className="rename" autoFocus defaultValue={it.name.replace(/\.\w+$/, '')}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { renameItem(it.id, e.currentTarget.value); setRenaming(false); } if (e.key === 'Escape') setRenaming(false); }}
              onBlur={(e) => { renameItem(it.id, e.currentTarget.value); setRenaming(false); }}
              aria-label="New name"
            />
          ) : (
            <h2 onDoubleClick={() => setRenaming(true)} title="Double-click to rename">{it.name}</h2>
          )}
          <p className="ql-sub">
            <span>{KIND_LABEL[it.kind]}{it.kind !== 'folder' && ` · ${fmtSize(it.size)}`}</span>
            <span className="sep" />
            <AvailMark a={it.availability} /> <span>{AVAIL_LABEL[it.availability]}</span>
            <span className="sep" />
            <span>{last ? `Opened ${fmtAgo(last, L.now)}` : recv ? `Received ${fmtAgo(it.added, L.now)}` : `Modified ${fmtAgo(it.modified, L.now)}`}</span>
            {it.origin === 'created' && <><span className="sep" /><span className="saved-mark">Saved</span></>}
          </p>
        </div>
        <div className="ql-actions">
          {recv && <button className={`btn ${kept ? 'on' : ''}`} onClick={() => toggleKeep([it.id])} aria-pressed={kept} title="Keep (K)">{kept ? 'Kept' : 'Keep'}</button>}
          <button className="btn" onClick={() => useLibUI.getState().setPanel({ t: 'organize', ids: [it.id] })} title="Organize (O)">Organize</button>
          <button className="btn primary" onClick={() => openItem(it.id)} disabled={it.availability === 'unavailable'} title="Open (Enter)">
            {it.kind === 'folder' ? 'Open' : `Open in ${LIB_APPS[app].name}`}
          </button>
          <button className="icon-btn" onClick={() => useLibStore.getState().setPrefs({ docked: !useLibStore.getState().prefs.docked })} title="Dock as inspector (D)" aria-label="Toggle docked inspector">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><rect x="1" y="1.5" width="12" height="11" fill="none" stroke="currentColor" strokeWidth="1.2" /><path d="M8.5 1.5v11" stroke="currentColor" strokeWidth="1.2" /></svg>
          </button>
          <button className="icon-btn" onClick={() => useLibUI.getState().closeQL()} aria-label="Close Quick Look (Esc)" title="Close (Esc)">×</button>
        </div>
      </header>
      <div className="tabs" role="tablist" aria-label="Quick Look views">
        {TABS.map((t, i) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className="tab" onClick={() => useLibUI.getState().setTab(t.id)} tabIndex={tab === t.id ? 0 : -1}>
            {t.label}{i > 0 && <span className="kb">{i + 1}</span>}
          </button>
        ))}
        <span className="grow" />
        {it.kind !== 'folder' && pageCount(it.content) > 1 && tab === 'preview' && <span className="faint small">← → {it.kind === 'slides' ? 'slides' : 'pages'}</span>}
      </div>
      <div className={`ql-body tab-${tab}`}>
        {tab === 'preview' && (editing ? <Editor it={it} /> : <PreviewBody L={L} it={it} page={page} setPage={setPage} />)}
        {tab === 'info' && <InfoTab L={L} it={it} />}
        {tab === 'tags' && <TagsTab L={L} it={it} />}
        {tab === 'activity' && <ActivityTab L={L} it={it} />}
        {tab === 'related' && <RelatedTab L={L} it={it} />}
      </div>
      <footer className="ql-foot faint">
        <span><Kbd>↑</Kbd><Kbd>↓</Kbd> next file</span><span><Kbd>Space</Kbd> close</span><span><Kbd>↵</Kbd> open</span>
        {recv && <span><Kbd>K</Kbd> keep</span>}<span><Kbd>T</Kbd> tag</span><span><Kbd>O</Kbd> organize</span>
        {it.origin === 'created' && (it.kind === 'markdown' || it.kind === 'doc') && <span><Kbd>E</Kbd> {editing ? 'done' : 'edit'}</span>}
        <span className="grow" />
        <span className="mono path" title={it.path}>{tildify(it.path)}</span>
        {p && !p.connected && <span className="warn">{p.label} offline</span>}
      </footer>
    </>
  );
}

function PreviewBody({ L, it, page, setPage }: { L: LibIndex; it: LibItem; page: number; setPage: (n: number) => void }) {
  const loaded = useContent(L, it);
  if (it.kind === 'folder') {
    const kids = L.children.get(it.id) ?? [];
    return (
      <ContainerPreview
        L={L} kind="folder" title={it.name} ids={kids} rootId={it.id}
        subtitle={<span className="mono">{tildify(it.path)}</span>}
        actions={<button className="btn" onClick={() => { useLibStore.getState().setPrefs({ scope: { t: 'folder', id: it.id } }); useLibUI.getState().closeQL(); }}>Work in this folder</button>}
      />
    );
  }
  if (loaded.s === 'loading') return <div className="pv-state"><span className="spinner" /> <p>Fetching from {L.providers[it.provider].label}… <span className="faint">(simulated download)</span></p></div>;
  if (loaded.s === 'error') {
    return (
      <div className="pv-state unavailable-state">
        <Thumb item={it} size={120} />
        <p className="serif">{loaded.reason}</p>
        <p className="faint small">Last seen {fmtAgo(it.modified, L.now)} at <span className="mono">{tildify(it.path)}</span></p>
        {L.providers[it.provider].kind === 'external' && <button className="btn" onClick={() => useLibStore.getState().setProvider(it.provider, true)}>Simulate connecting the drive</button>}
      </div>
    );
  }
  if (!loaded.c) return <div className="pv-state"><p className="serif">No preview for this file type.</p></div>;
  return (
    <div className="pv-wrap">
      {loaded.fetched && <p className="pv-note">Downloaded from Nextcloud for preview (simulated). A local copy is now cached.</p>}
      <ContentPreview c={loaded.c} page={page} setPage={setPage} />
    </div>
  );
}

function Editor({ it }: { it: LibItem }) {
  const text = contentText(it.content);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [val, setVal] = useState(text);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => {
    if (val === text) return;
    const t = setTimeout(() => editCreated(it.id, val), 350);
    return () => clearTimeout(t);
  }, [val, text, it.id]);
  const v = it.versions ?? [];
  return (
    <div className="editor">
      <textarea
        ref={ref} value={val} onChange={(e) => setVal(e.target.value)} spellCheck
        placeholder={it.kind === 'markdown' ? 'Start writing. The first line becomes the name.' : 'Title\n\nStart writing…'}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); useLibUI.getState().setEditing(null); } }}
        aria-label={`Edit ${it.name}`}
      />
      <p className="editor-status faint small">
        <span className="saved-mark">{val === text ? 'Saved' : 'Saving…'}</span> · {v.length} version{v.length === 1 ? '' : 's'} · Esc to stop editing · no folder needed
      </p>
    </div>
  );
}

// ─── Secondary views ─────────────────────────────────────────────────────────

function InfoTab({ L, it }: { L: LibIndex; it: LibItem }) {
  const p = L.providers[it.provider];
  const ai = useLibStore((s) => s.ai[it.id]);
  const n = L.openCount.get(it.id) ?? 0;
  const parent = it.parentId ? L.items.get(it.parentId) : null;
  const kept = L.kept(it.id);
  const keptAt = useLibStore((s) => s.meta[it.id]?.keptAt);
  return (
    <div className="info">
      {(ai?.summary || it.summary) && (
        <section className="summary">
          <p className="label">Summary <span className={`prov ${ai?.engine === 'ollama' ? 'real' : ''}`}>{ai?.engine === 'ollama' ? `Local AI · ${ai.model}` : 'Simulated AI'}</span></p>
          <p className="serif">{ai?.summary || it.summary}</p>
        </section>
      )}
      <dl className="facts">
        <dt>Kind</dt><dd>{KIND_LABEL[it.kind]}{it.ext && ` (.${it.ext})`}</dd>
        {it.kind !== 'folder' ? <><dt>Size</dt><dd className="tnum">{fmtSize(it.size)}</dd></> : <><dt>Contents</dt><dd className="tnum">{L.folderStats(it.id).files} files · {fmtSize(L.folderStats(it.id).size)}</dd></>}
        <dt>{it.origin === 'received' ? 'Received' : it.origin === 'created' ? 'Created' : 'Added to library'}</dt><dd className="tnum">{fmtDateTime(it.added)}</dd>
        <dt>Modified</dt><dd className="tnum">{fmtDateTime(it.modified)}</dd>
        <dt>Last opened</dt><dd className="tnum">{L.lastOpened.get(it.id) ? fmtDateTime(L.lastOpened.get(it.id)!) : 'Never'}{n > 0 && ` · ${n}× in total`}</dd>
      </dl>
      <h3 className="label">Origin &amp; retention</h3>
      <dl className="facts">
        {it.origin === 'created' && <><dt>Created</dt><dd>By you, saved automatically by {LIB_APPS[defaultApp(it)].name}</dd></>}
        {it.origin === 'received' && <><dt>Source</dt><dd>{it.source ?? 'Downloaded'}</dd>
          <dt>Status</dt><dd>{kept ? `Kept${keptAt ? ` ${fmtAgo(keptAt, L.now)}` : ''} · retained long-term where it is` : 'In the inbox · not kept yet'} <button className="link-btn" onClick={() => toggleKeep([it.id])}>{kept ? 'Return to inbox' : 'Keep'}</button></dd></>}
        {it.origin === 'existing' && <><dt>Indexed</dt><dd>Found in {p.label}</dd></>}
      </dl>
      <p className="faint small serif">Retention here is a simulated library state. Nothing has been copied or backed up, and nothing is ever deleted automatically.</p>
      <h3 className="label">Storage</h3>
      <dl className="facts">
        <dt>Provider</dt><dd>{p.label} <span className="faint">({p.kind})</span></dd>
        <dt>Availability</dt><dd><AvailMark a={it.availability} /> {AVAIL_LABEL[it.availability]}{it.availability === 'cloud-online' && ' · contents fetched on demand'}{it.availability === 'unavailable' && ' · contents not readable'}</dd>
        <dt>Path</dt><dd className="mono wrap">{it.path}</dd>
        {parent && <><dt>In folder</dt><dd><button className="link-btn" onClick={() => useLibUI.getState().pushQL(parent.id)}>{parent.name}</button></dd></>}
        {it.git && <><dt>Git</dt><dd>{it.git.branch} · {it.git.status}</dd></>}
      </dl>
      {it.versions && it.versions.length > 0 && (
        <>
          <h3 className="label">Version history <span className="prov">simulated</span></h3>
          <ol className="versions">
            {[...it.versions].reverse().map((v, i) => <li key={i}><span className="tnum">{fmtDateTime(v.at)}</span><span>{v.note}</span>{i === 0 && <span className="faint">current</span>}</li>)}
          </ol>
        </>
      )}
    </div>
  );
}

export function TagsTab({ L, it, autoFocus = false }: { L: LibIndex; it: LibItem; autoFocus?: boolean }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const engine = useLibStore((s) => s.prefs.ai);
  const ai = useLibStore((s) => s.ai[it.id]);
  const mine = L.personalTags(it.id);
  const sugg = L.suggestedTags(it.id).filter((s) => s.state === 'pending');
  const approved = new Set(L.suggestedTags(it.id).filter((s) => s.state === 'approved').map((s) => s.id));
  const opts = [...L.tags.values()].filter((t) => !mine.includes(t.id) && draft && t.label.toLowerCase().includes(draft.toLowerCase())).slice(0, 6);
  const commit = (label: string) => {
    if (!label.trim()) return;
    addPersonalTag(it.id, findOrCreateTag(label));
    setDraft('');
  };
  return (
    <div className="tags-tab">
      <section>
        <h3 className="label">Your tags</h3>
        <div className="chips">
          {mine.map((t) => <TagChip key={t} label={L.tags.get(t)!.label} kind={approved.has(t) ? 'topic' : 'personal'} state={approved.has(t) ? 'approved' : undefined} onRemove={() => removeTag(it.id, t)} />)}
          {!mine.length && <span className="faint serif">No tags. Nothing requires them; add one if it helps you find this again.</span>}
        </div>
        <div className="tag-add">
          <input
            autoFocus={autoFocus} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a tag…" aria-label="Add a tag"
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commit(opts[0] && opts[0].label.toLowerCase() === draft.toLowerCase() ? opts[0].label : draft); if (e.key === 'Escape') (e.target as HTMLInputElement).blur(); }}
            list={`tagopts-${it.id}`}
          />
          {opts.length > 0 && (
            <div className="tag-opts">{opts.map((o) => <button key={o.id} className="chip-btn" onClick={() => { addPersonalTag(it.id, o.id); setDraft(''); }}>{o.label}<span className="faint"> · existing</span></button>)}</div>
          )}
        </div>
      </section>
      <section>
        <h3 className="label">Suggested from content <span className={`prov ${ai?.engine === 'ollama' ? 'real' : ''}`}>{ai?.engine === 'ollama' ? `Local AI · ${ai.model}` : 'Simulated'}</span></h3>
        <div className="chips">
          {sugg.map((s) => <TagChip key={s.id} label={L.tags.get(s.id)!.label} kind="topic" state="pending" onApprove={() => approveSuggestion(it.id, s.id)} onRemove={() => rejectSuggestion(it.id, s.id)} />)}
          {!sugg.length && <span className="faint serif">No pending suggestions.</span>}
        </div>
        <p className="faint small">Suggestions reuse your existing topic vocabulary. Approving one keeps its ◇ mark, so you can always tell inferred tags from your own.</p>
        <button className="btn" disabled={busy} aria-busy={busy} onClick={async () => { setBusy(true); await runAnalysis(it.id); setBusy(false); }}>
          {busy ? 'Analysing…' : engine.engine === 'ollama' ? `Analyse locally (${engine.model})` : 'Run simulated analysis'}
        </button>
      </section>
    </div>
  );
}

function Spark({ events, now }: { events: number[]; now: number }) {
  const W = 8, weeks = Array.from({ length: W }, () => 0);
  for (const t of events) { const w = Math.floor((now - t) / (7 * 864e5)); if (w >= 0 && w < W) weeks[W - 1 - w]++; }
  const max = Math.max(1, ...weeks);
  return (
    <div className="spark" aria-label={`Opened ${events.length} times; per week: ${weeks.join(', ')}`}>
      {weeks.map((v, i) => <i key={i} style={{ height: `${(v / max) * 100}%` }} title={`${v}`} />)}
      <span className="spark-l faint">8 weeks ago</span><span className="spark-r faint">this week</span>
    </div>
  );
}

function ActivityTab({ L, it }: { L: LibIndex; it: LibItem }) {
  const ev = (L.byItem.get(it.id) ?? []).filter((e) => e.action !== 'download');
  const apps = new Map<AppId, number>();
  const asms = new Map<string, number>();
  for (const e of ev) { apps.set(e.app, (apps.get(e.app) ?? 0) + 1); if (e.assembly) asms.set(e.assembly, (asms.get(e.assembly) ?? 0) + 1); }
  const together = [...(L.together.get(it.id) ?? new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  return (
    <div className="activity">
      <p className="faint small">Observed facts from usage, recorded on this computer. Nothing here is inferred.</p>
      <Spark events={ev.map((e) => e.at)} now={L.now} />
      <dl className="facts">
        <dt>Last opened</dt><dd>{ev.length ? fmtDateTime(ev[ev.length - 1].at) : 'Never'}</dd>
        <dt>Frequency</dt><dd>{ev.length} opens{ev.length > 1 && ` since ${fmtAgo(ev[0].at, L.now)}`}</dd>
        <dt>Applications</dt><dd>{[...apps.entries()].sort((a, b) => b[1] - a[1]).map(([a, n]) => `${LIB_APPS[a].name} ${n}×`).join(' · ') || '—'}</dd>
      </dl>
      <h3 className="label">Assemblies</h3>
      <ul className="asm-list">
        {L.assemblies.map((a) => {
          const used = asms.get(a.id) ?? 0, att = a.attached.includes(it.id);
          if (!used && !att) return null;
          return (
            <li key={a.id}>
              <span className={`asm-dot ink-${a.ink}`}>{a.name}</span>
              <span className="faint">{used ? `used ${used}×` : ''}{att ? `${used ? ' · ' : ''}attached` : ''}</span>
              <button className="link-btn" onClick={() => toggleAttach(a.id, [it.id])}>{att ? 'Detach' : 'Attach'}</button>
            </li>
          );
        })}
        {!asms.size && !L.assembliesOf(it.id).length && <li className="faint serif">Not used in any Assembly yet.</li>}
      </ul>
      <h3 className="label">Commonly opened with</h3>
      <ul className="rel-list">
        {together.map(([oid, n]) => { const o = L.items.get(oid); return o && <RelRow key={oid} L={L} it={o} note={`${n} sessions`} />; })}
        {!together.length && <li className="faint serif">No pattern yet.</li>}
      </ul>
      <h3 className="label">Recent events</h3>
      <ol className="events">
        {[...(L.byItem.get(it.id) ?? [])].reverse().slice(0, 8).map((e, i) => (
          <li key={i}><span className="tnum">{fmtDateTime(e.at)}</span><span>{e.action === 'download' ? 'Downloaded' : e.action === 'edit' ? 'Edited' : e.action === 'save' ? 'Saved' : 'Opened'} in {LIB_APPS[e.app].name}</span>{e.assembly && <span className="faint">{L.asm.get(e.assembly)?.name}</span>}</li>
        ))}
      </ol>
    </div>
  );
}

function RelRow({ it, note, inferred }: { L?: LibIndex; it: LibItem; note?: string; inferred?: boolean }) {
  return (
    <li>
      <button className="rel" onClick={() => useLibUI.getState().pushQL(it.id)}>
        <Thumb item={it} size={22} />
        <span className="nm">{it.name}</span>
        {note && <span className="faint">{note}</span>}
        {inferred && <span className="prov">inferred</span>}
        <AvailMark a={it.availability} size={10} />
      </button>
    </li>
  );
}

function RelatedTab({ L, it }: { L: LibIndex; it: LibItem }) {
  const rels = L.relOf.get(it.id) ?? [];
  const groups: { title: string; rows: { it: LibItem; note?: string; inferred?: boolean }[] }[] = [];
  const g = (title: string, rows: { it: LibItem; note?: string; inferred?: boolean }[]) => rows.length && groups.push({ title, rows });
  const other = (r: { from: string; to: string }) => L.items.get(r.from === it.id ? r.to : r.from)!;
  g('References', rels.filter((r) => r.kind === 'references' && r.from === it.id).map((r) => ({ it: other(r), inferred: !r.explicit })));
  g('Referenced by', rels.filter((r) => r.kind === 'references' && r.to === it.id).map((r) => ({ it: other(r), inferred: !r.explicit })));
  g('Revisions', rels.filter((r) => r.kind === 'revision').map((r) => ({ it: other(r), note: r.from === it.id ? 'earlier version' : 'later version', inferred: !r.explicit })));
  g('Derived', rels.filter((r) => r.kind === 'derived').map((r) => ({ it: other(r), note: r.from === it.id ? 'source' : 'derived from this', inferred: !r.explicit })));
  g('Related by topic', rels.filter((r) => r.kind === 'topic').map((r) => ({ it: other(r), note: r.note, inferred: !r.explicit })));
  const together = [...(L.together.get(it.id) ?? new Map()).entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 5);
  g('Used together', together.map(([o, n]) => ({ it: L.items.get(o)!, note: `${n} sessions`, inferred: true })).filter((x) => x.it));
  const cols = L.collectionsOf(it.id);
  const asms = L.assembliesOf(it.id);
  return (
    <div className="related">
      {groups.map((gr) => (
        <section key={gr.title}>
          <h3 className="label">{gr.title}</h3>
          <ul className="rel-list">{gr.rows.map((r) => <RelRow key={r.it.id} L={L} it={r.it} note={r.note} inferred={r.inferred} />)}</ul>
        </section>
      ))}
      <section>
        <h3 className="label">Collections</h3>
        <ul className="rel-list">
          {cols.map((c) => (
            <li key={c.id}><button className="rel" onClick={() => useLibUI.getState().pushQL(c.id)}><CollectionGlyph size={22} /><span className="nm">{c.name}</span><span className="faint">{c.items.length} items</span></button></li>
          ))}
          {!cols.length && <li className="faint serif">In no collection. <button className="link-btn" onClick={() => useLibUI.getState().setPanel({ t: 'collection', ids: [it.id] })}>Add to one</button></li>}
        </ul>
      </section>
      {asms.length > 0 && (
        <section>
          <h3 className="label">Attached to Assemblies</h3>
          <p className="chips">{asms.map((a) => <span key={a.id} className={`asm-dot ink-${a.ink}`}>{a.name}</span>)}</p>
        </section>
      )}
      {!groups.length && !cols.length && !asms.length && <p className="faint serif">No relationships yet. They appear as you use files together, reference them, or add them to collections.</p>}
    </div>
  );
}

// ─── Collections ─────────────────────────────────────────────────────────────

function CollectionLook({ L, c }: { L: LibIndex; c: Collection }) {
  const providers = new Set(c.items.map((i) => L.items.get(i)?.provider).filter(Boolean));
  return (
    <>
      <LookHead title={c.name} />
      <div className="ql-body">
        <ContainerPreview
          L={L} kind="collection" title={c.name} ids={c.items}
          subtitle={<>{c.description ?? 'A set of references.'} {providers.size > 1 && <span className="faint">Spans {providers.size} storage locations.</span>}</>}
          actions={
            <>
              <button className="btn" onClick={() => { useLibStore.getState().setPrefs({ scope: { t: 'collection', id: c.id } }); useLibUI.getState().closeQL(); }}>Open as library view</button>
              {c.assemblies.map((a) => <span key={a} className={`asm-dot ink-${L.asm.get(a)?.ink}`}>{L.asm.get(a)?.name}</span>)}
              {c.pinnedFrom && <span className="faint small">Pinned from a dynamic view</span>}
            </>
          }
        />
      </div>
    </>
  );
}

function DynamicLook({ L, dyn }: { L: LibIndex; dyn: { id: string; name: string; items: string[]; rule: string } }) {
  const ctx = useLibStore((s) => s.prefs.ctx);
  return (
    <>
      <LookHead title={dyn.name} />
      <div className="ql-body">
        <ContainerPreview
          L={L} kind="dynamic" title={dyn.name} ids={dyn.items}
          subtitle={<>Generated from {dyn.rule.toLowerCase()}. It changes as you work.</>}
          actions={
            <button className="btn" onClick={() => {
              const id = createCollection(dyn.name, dyn.items, ctx.assembly, dyn.id);
              useLibUI.getState().toast({ text: `Pinned “${dyn.name}” as a collection`, detail: 'A saved snapshot. It no longer changes on its own.' });
              useLibUI.getState().openQL(id);
            }}>Pin as collection</button>
          }
        />
      </div>
    </>
  );
}

function LookHead({ title }: { title: string }) {
  return (
    <header className="ql-head slim">
      <div className="ql-title"><h2 className="sr-only">{title}</h2></div>
      <div className="ql-actions">
        <button className="icon-btn" onClick={() => useLibUI.getState().closeQL()} aria-label="Close Quick Look (Esc)">×</button>
      </div>
    </header>
  );
}
