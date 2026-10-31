import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useDesktop } from '../model/store';
import type { AppKind, Presentation } from '../model/types';
import {
  ARTICLES, TRACKS, fmtAgo,
  type BrowserState, type EditorState, type MessagesState, type MusicState, type NotesState, type TermLine, type TerminalState, type Track,
} from './meta';
import { Glyph, IconNext, IconPause, IconPlay, IconPrev, StatusMark } from './glyphs';
import { runTask, sendMessage } from './sim';

// Each app renders three presentations. They are not scaled copies of each
// other: each one is re-composed for the attention it receives.

type ViewProps = { id: string; pres: Presentation };

function useApp<T>(id: string): [T, (fn: (s: T) => Partial<T>) => void] {
  const s = useDesktop((st) => st.apps[id]) as T;
  return [s, (fn) => useDesktop.getState().updateApp<any>(id, fn as any)];
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Buttons marked data-act work without pulling attention to the window. */
const Act = ({ label, onClick, children, className = '' }: { label: string; onClick: () => void; children: ReactNode; className?: string }) => (
  <button data-act className={`act ${className}`} aria-label={label} title={label} onClick={(e) => { e.stopPropagation(); onClick(); }}>
    {children}
  </button>
);

function Widget({ app, title, sub, mark, children }: { app: AppKind; title: ReactNode; sub?: ReactNode; mark?: ReactNode; children?: ReactNode }) {
  return (
    <div className="widget">
      <span className="widget-glyph">{mark ?? <Glyph app={app} size={16} />}</span>
      <span className="widget-text">
        <span className="widget-title">{title}</span>
        {sub && <span className="widget-sub">{sub}</span>}
      </span>
      {children}
    </div>
  );
}

// ─── Music ───────────────────────────────────────────────────────────────────

function Art({ track, size }: { track: Track; size: number }) {
  const n = 9;
  const items = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    switch (track.pattern) {
      case 'rings': items.push(<circle key={i} cx="50" cy="50" r={6 + t * 42} fill="none" stroke="currentColor" strokeWidth={0.8 + (1 - t) * 1.8} />); break;
      case 'arcs': items.push(<path key={i} d={`M0 ${100 - t * 100} A ${20 + t * 80} ${20 + t * 80} 0 0 1 ${t * 100 + 10} 100`} fill="none" stroke="currentColor" strokeWidth="1.4" />); break;
      case 'stripes': items.push(<rect key={i} x={i * 11.5} y="0" width={2 + t * 6} height="100" fill="currentColor" />); break;
      case 'grid': items.push(<g key={i}>{Array.from({ length: n }, (_, j) => <rect key={j} x={i * 11 + 2} y={j * 11 + 2} width={(i + j) % 3 ? 3 : 8} height={(i + j) % 3 ? 3 : 8} fill="currentColor" />)}</g>); break;
      case 'dots': items.push(<circle key={i} cx={50 + Math.cos(i * 1.4) * t * 40} cy={50 + Math.sin(i * 1.4) * t * 40} r={2 + (1 - t) * 8} fill="currentColor" />); break;
    }
  }
  return (
    <svg className="art" width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <rect width="100" height="100" fill="var(--ds-paper-sunken)" />
      {items}
    </svg>
  );
}

function MusicView({ id, pres }: ViewProps) {
  const [s, up] = useApp<MusicState>(id);
  const tr = TRACKS[s.track];
  const toggle = () => up((x) => ({ playing: !x.playing }));
  const skip = (d: number) => up((x) => ({ track: (x.track + d + TRACKS.length) % TRACKS.length, t: 0 }));
  const pct = (s.t / tr.dur) * 100;
  const playBtn = <Act label={s.playing ? 'Pause' : 'Play'} onClick={toggle} className="act-primary">{s.playing ? <IconPause /> : <IconPlay />}</Act>;

  if (pres === 'widget') {
    return (
      <Widget app="music" title={tr.title} sub={tr.artist} mark={<StatusMark kind={s.playing ? 'play' : 'pause'} size={14} />}>
        {playBtn}
        <span className="hair-progress" style={{ width: `${pct}%` }} />
      </Widget>
    );
  }
  if (pres === 'compact') {
    return (
      <div className="music-compact">
        <Art track={tr} size={64} />
        <div className="mc-info">
          <div className="t-strong clip">{tr.title}</div>
          <div className="t-muted clip">{tr.artist}</div>
          <div className="mc-controls">
            <Act label="Previous" onClick={() => skip(-1)}><IconPrev /></Act>
            {playBtn}
            <Act label="Next" onClick={() => skip(1)}><IconNext /></Act>
            <span className="t-num t-muted">{fmt(s.t)}</span>
          </div>
        </div>
        <span className="hair-progress" style={{ width: `${pct}%` }} />
      </div>
    );
  }
  return (
    <div className="music-full">
      <div className="mf-top">
        <Art track={tr} size={132} />
        <div className="mf-info">
          <div className="label">Now playing · {tr.album}</div>
          <div className="mf-title">{tr.title}</div>
          <div className="t-muted">{tr.artist}</div>
          <div className="scrub" onClick={(e) => {
            const b = e.currentTarget.getBoundingClientRect();
            up(() => ({ t: Math.round(((e.clientX - b.left) / b.width) * tr.dur) }));
          }}>
            <div className="scrub-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="mf-time t-num t-muted"><span>{fmt(s.t)}</span><span>-{fmt(tr.dur - s.t)}</span></div>
          <div className="mc-controls">
            <Act label="Previous" onClick={() => skip(-1)}><IconPrev /></Act>
            {playBtn}
            <Act label="Next" onClick={() => skip(1)}><IconNext /></Act>
          </div>
        </div>
      </div>
      <ol className="queue">
        {TRACKS.map((t, i) => (
          <li key={t.title} className={i === s.track ? 'current' : ''} onClick={() => up(() => ({ track: i, t: 0, playing: true }))}>
            <span className="t-num t-faint">{String(i + 1).padStart(2, '0')}</span>
            <span className="clip">{t.title}</span>
            <span className="t-muted clip">{t.artist}</span>
            <span className="t-num t-faint">{fmt(t.dur)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ─── Terminal ────────────────────────────────────────────────────────────────

const statusKind = (s: TerminalState) => (s.status === 'running' ? 'run' : s.status === 'passed' ? 'ok' : s.status === 'failed' ? 'err' : 'idle');

function TerminalView({ id, pres }: ViewProps) {
  const [s, up] = useApp<TerminalState>(id);
  const [input, setInput] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { scroller.current?.scrollTo({ top: 1e6 }); }, [s.lines.length, pres]);
  const project = s.cwd.split('/').pop();
  const statusText = s.status === 'running' ? `${s.task} · ${Math.round(s.progress * 100)}%` : s.status === 'idle' ? 'idle' : `${s.task} ${s.status}`;

  if (pres === 'widget') {
    return (
      <Widget app="terminal" title={statusText} sub={s.status === 'running' ? project : `${project} · ${fmtAgo(s.lastRun)}`} mark={<StatusMark kind={statusKind(s)} size={14} />}>
        <Act label="Run build" onClick={() => runTask(id, 'build')}><IconPlay /></Act>
        {s.status === 'running' && <span className="hair-progress" style={{ width: `${s.progress * 100}%` }} />}
      </Widget>
    );
  }
  if (pres === 'compact') {
    return (
      <div className="term-compact">
        <div className="tc-head">
          <StatusMark kind={statusKind(s)} />
          <span className="t-strong">{statusText}</span>
          <span className="t-faint t-num">{fmtAgo(s.lastRun)}</span>
          <span className="grow" />
          <Act label="Run build" onClick={() => runTask(id, 'build')} className="act-text">build</Act>
          <Act label="Run tests" onClick={() => runTask(id, 'test')} className="act-text">test</Act>
        </div>
        <div className="tc-lines mono">
          {s.lines.slice(-6).map((l, i) => <div key={i} className={`tl tl-${l.k}`}>{l.k === 'in' ? '› ' : ''}{l.t}</div>)}
        </div>
        {s.status === 'running' && <span className="hair-progress" style={{ width: `${s.progress * 100}%` }} />}
      </div>
    );
  }
  const exec = (cmd: string) => {
    const c = cmd.trim();
    if (!c) return;
    const out = (t: string, k: 'out' | 'dim' | 'err' = 'out'): TermLine => ({ k, t });
    if (c === 'build' || c === 'npm run build') return runTask(id, 'build');
    if (c === 'test' || c === 'npm test' || c === 'npm run test') return runTask(id, 'test');
    let lines;
    switch (c.split(' ')[0]) {
      case 'clear': up(() => ({ lines: [] })); return;
      case 'help': lines = [out('build · test · ls · status · echo · date · clear', 'dim')]; break;
      case 'ls': lines = [out('README.md  package.json  src/  tests/  vite.config.ts')]; break;
      case 'status': lines = [out(`last ${s.task}: ${s.status} (${fmtAgo(s.lastRun)})`)]; break;
      case 'echo': lines = [out(c.slice(5))]; break;
      case 'date': lines = [out(new Date().toString())]; break;
      case 'whoami': lines = [out('you, at the centre of attention')]; break;
      default: lines = [out(`command not found: ${c.split(' ')[0]} — try help`, 'err')];
    }
    up((x) => ({ lines: [...x.lines, { k: 'in' as const, t: c }, ...lines].slice(-200) }));
  };
  return (
    <div className="term-full mono" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}>
      <div className="tf-lines" ref={scroller}>
        {s.lines.map((l, i) => <div key={i} className={`tl tl-${l.k}`}>{l.k === 'in' ? <span className="t-faint">{project} % </span> : null}{l.t}</div>)}
        <form className="tf-input" onSubmit={(e) => { e.preventDefault(); exec(input); setInput(''); }}>
          <span className="t-faint">{project} %</span>
          <input value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} aria-label="Command" placeholder={s.lines.length < 8 ? 'try: build' : ''} />
        </form>
      </div>
      <div className="tf-status">
        <StatusMark kind={statusKind(s)} />
        <span>{statusText}</span>
        <span className="grow" />
        <span className="t-faint">{s.cwd}</span>
      </div>
    </div>
  );
}

// ─── Browser ─────────────────────────────────────────────────────────────────

const Favicon = ({ page }: { page: number }) => (
  <span className="favicon" aria-hidden>{ARTICLES[page].domain[0].toUpperCase()}</span>
);

function BrowserView({ id, pres }: ViewProps) {
  const [s, up] = useApp<BrowserState>(id);
  const a = ARTICLES[s.page];
  const go = (p: number) => up((x) => ({ page: p, history: [...x.history, x.page], fwd: [] }));
  const back = () => up((x) => (x.history.length ? { page: x.history[x.history.length - 1], history: x.history.slice(0, -1), fwd: [x.page, ...x.fwd] } : {}));
  const fwd = () => up((x) => (x.fwd.length ? { page: x.fwd[0], fwd: x.fwd.slice(1), history: [...x.history, x.page] } : {}));

  if (pres === 'widget') return <Widget app="browser" mark={<Favicon page={s.page} />} title={a.title} sub={a.domain} />;
  if (pres === 'compact') {
    return (
      <div className="browser-compact">
        <div className="bc-domain"><Favicon page={s.page} /><span className="t-muted">{a.domain}</span></div>
        <div className="bc-title">{a.title}</div>
        <p className="bc-lead serif">{a.lead}</p>
      </div>
    );
  }
  return (
    <div className="browser-full">
      <div className="bf-bar">
        <button className="act" onClick={back} disabled={!s.history.length} aria-label="Back">←</button>
        <button className="act" onClick={fwd} disabled={!s.fwd.length} aria-label="Forward">→</button>
        <div className="bf-url mono"><span className="t-faint">https://</span>{a.domain}/{a.title.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-$/, '')}</div>
      </div>
      <article className="bf-article">
        <div className="label">{a.domain}</div>
        <h1>{a.title}</h1>
        <div className="t-muted small">{a.byline}</div>
        <p className="lead serif">{a.lead}</p>
        {a.body.map((p, i) => <p key={i} className="serif">{p}</p>)}
        <div className="bf-links">
          <div className="label">Related</div>
          {a.links.map((l) => <button key={l} className="link" onClick={() => go(l)}>{ARTICLES[l].title} →</button>)}
        </div>
      </article>
    </div>
  );
}

// ─── Notes ───────────────────────────────────────────────────────────────────

function NotesView({ id, pres }: ViewProps) {
  const [s, up] = useApp<NotesState>(id);
  useEffect(() => {
    if (!s.dirty) return;
    const t = window.setTimeout(() => up(() => ({ dirty: false, savedAt: Date.now() })), 1200);
    return () => window.clearTimeout(t);
  }, [s.body, s.title, s.dirty]);
  const words = s.body.trim() ? s.body.trim().split(/\s+/).length : 0;
  const status = s.dirty ? 'Editing…' : `Saved ${fmtAgo(s.savedAt)}`;

  if (pres === 'widget') return <Widget app="notes" title={s.title || 'Untitled'} sub={status} mark={s.dirty ? <StatusMark kind="edit" size={14} /> : undefined} />;
  if (pres === 'compact') {
    return (
      <div className="notes-compact">
        <div className="nc-title">{s.title || 'Untitled'}</div>
        <p className="nc-body serif">{s.body}</p>
        <div className="nc-foot t-faint"><span>{words} words</span><span>{status}</span></div>
      </div>
    );
  }
  return (
    <div className="notes-full">
      <input className="nf-title" value={s.title} placeholder="Untitled" onChange={(e) => up(() => ({ title: e.target.value, dirty: true }))} aria-label="Note title" />
      <textarea className="nf-body serif" value={s.body} onChange={(e) => up(() => ({ body: e.target.value, dirty: true }))} aria-label="Note" spellCheck={false} />
      <div className="nc-foot t-faint"><span>{words} words</span><span>{status}</span></div>
    </div>
  );
}

// ─── Messages ────────────────────────────────────────────────────────────────

function MessagesView({ id, pres }: ViewProps) {
  const [s, up] = useApp<MessagesState>(id);
  const listRef = useRef<HTMLDivElement>(null);
  const focused = useDesktop((st) => st.focus.win === id);
  useEffect(() => { if (pres === 'full' && focused && s.unread) up(() => ({ unread: 0 })); }, [pres, focused, s.unread]);
  useEffect(() => { listRef.current?.scrollTo({ top: 1e6 }); }, [s.thread.length, pres, s.typing]);
  const last = [...s.thread].reverse().find((m) => m.from === 'them');
  const first = s.contact.split(' ')[0];
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (s.draft.trim()) sendMessage(id, s.draft.trim()); };
  const composer = (compact: boolean) => (
    <form className={compact ? 'composer composer-compact' : 'composer'} onSubmit={submit}>
      <input data-act={compact ? '' : undefined} value={s.draft} placeholder={compact ? `Reply to ${first}` : `Message ${first}`} onChange={(e) => up(() => ({ draft: e.target.value }))} aria-label="Message" />
      <button data-act={compact ? '' : undefined} className="act act-text" type="submit">Send</button>
    </form>
  );

  if (pres === 'widget') {
    return (
      <Widget app="messages" title={first} sub={s.unread ? `${s.unread} unread` : s.typing ? 'typing…' : 'no new messages'}
        mark={s.unread ? <span className="badge">{s.unread}</span> : undefined} />
    );
  }
  if (pres === 'compact') {
    return (
      <div className="msg-compact">
        <div className="mc-row">
          {s.unread ? <span className="badge">{s.unread}</span> : <Glyph app="messages" />}
          <span className="t-strong">{s.contact}</span>
          <span className="grow" />
          <span className="t-faint t-num">{last ? fmtAgo(last.at) : ''}</span>
        </div>
        <p className="mc-last serif">{s.typing ? `${first} is typing…` : last?.text}</p>
        {composer(true)}
      </div>
    );
  }
  return (
    <div className="msg-full">
      <div className="mf-head"><span className="avatar">{s.contact.split(' ').map((p) => p[0]).join('')}</span><span className="t-strong">{s.contact}</span><span className="t-faint small">{s.typing ? 'typing…' : 'active now'}</span></div>
      <div className="mf-thread" ref={listRef}>
        {s.thread.map((m, i) => <div key={i} className={`bubble ${m.from}`}><span className="serif">{m.text}</span></div>)}
        {s.typing && <div className="bubble them typing"><span>• • •</span></div>}
      </div>
      {composer(false)}
    </div>
  );
}

// ─── Editor ──────────────────────────────────────────────────────────────────

function EditorView({ id, pres }: ViewProps) {
  const [s, up] = useApp<EditorState>(id);
  const f = s.files[s.file];
  const dirty = s.files.filter((x) => x.dirty).length;
  const save = () => up((x) => ({ files: x.files.map((ff) => ({ ...ff, dirty: false })) }));

  if (pres === 'widget') return <Widget app="editor" title={f.name} sub={dirty ? `${dirty} unsaved` : 'all saved'} mark={dirty ? <StatusMark kind="edit" size={14} /> : undefined} />;
  if (pres === 'compact') {
    return (
      <div className="editor-compact">
        <div className="ec-head"><span className="t-strong mono">{f.name}</span><span className="grow" />{dirty ? <Act label="Save all" onClick={save} className="act-text">save {dirty}</Act> : <span className="t-faint">saved</span>}</div>
        <pre className="ec-code mono">{f.code.split('\n').slice(0, 9).join('\n')}</pre>
      </div>
    );
  }
  const lines = f.code.split('\n').length;
  return (
    <div className="editor-full">
      <aside className="ef-tree">
        <div className="label">orbit / src</div>
        {s.files.map((ff, i) => (
          <button key={ff.name} className={`ef-file mono ${i === s.file ? 'current' : ''}`} onClick={() => up(() => ({ file: i }))}>
            {ff.name}{ff.dirty ? <span className="dot" aria-label="unsaved"> ●</span> : null}
          </button>
        ))}
        <span className="grow" />
        <button className="act act-text" onClick={save} disabled={!dirty}>Save all</button>
      </aside>
      <div className="ef-code mono">
        <div className="ef-gutter" aria-hidden>{Array.from({ length: lines }, (_, i) => <div key={i}>{i + 1}</div>)}</div>
        <textarea value={f.code} spellCheck={false} aria-label={f.name}
          onChange={(e) => up((x) => ({ files: x.files.map((ff, i) => (i === x.file ? { ...ff, code: e.target.value, dirty: true } : ff)) }))} />
      </div>
    </div>
  );
}

export const VIEWS: Record<AppKind, (p: ViewProps) => ReactNode> = {
  music: MusicView, terminal: TerminalView, browser: BrowserView, notes: NotesView, messages: MessagesView, editor: EditorView,
};
