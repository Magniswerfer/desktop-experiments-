import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { LIB_APPS } from '../model/apps';
import type { LibIndex } from '../model/library';
import { ctxKey, rankContext, type Suggestion } from '../model/relevance';
import { useLibStore, type LibContext } from '../model/store';
import type { AppId } from '../model/types';
import { AvailMark } from './bits';
import { CollectionGlyph, Thumb } from './Thumb';
import { useLibUI } from './uiStore';

// The contextual shelf: what is likely relevant to the current work, each
// with a plain explanation. It sits above — and never reorders — the
// chronological list. Changes are debounced so it settles, not flickers.

const MAX = 7;

function useSettled<T>(v: T, ms: number): T {
  const [s, setS] = useState(v);
  useEffect(() => { const t = setTimeout(() => setS(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return s;
}

export function ContextSwitcher({ L, compact = false }: { L: LibIndex; compact?: boolean }) {
  const ctx = useLibStore((s) => s.prefs.ctx);
  const set = useLibStore((s) => s.setCtx);
  const deskAvailable = useDeskAvailable();
  const apps = Object.values(LIB_APPS);
  return (
    <div className={`ctx-switch ${compact ? 'compact' : ''}`} role="group" aria-label="Simulated context">
      <label>
        <span className="label">Assembly</span>
        <select
          value={ctx.assembly ?? ''} disabled={ctx.source === 'desk'}
          onChange={(e) => {
            const a = e.target.value || null;
            const asm = a ? L.asm.get(a) : null;
            set({ assembly: a, app: asm && ctx.app && !asm.apps.includes(ctx.app) ? asm.apps[0] : ctx.app });
          }}
        >
          <option value="">None</option>
          {L.assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      <label>
        <span className="label">Focused app</span>
        <select value={ctx.app ?? ''} disabled={ctx.source === 'desk'} onChange={(e) => set({ app: (e.target.value || null) as AppId | null })}>
          <option value="">None</option>
          {apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      {deskAvailable && (
        <label className="desk-follow" title="Follow the focused window and Assembly on the Lodestone desk">
          <input type="checkbox" checked={ctx.source === 'desk'} onChange={(e) => set({ source: e.target.checked ? 'desk' : 'simulated' })} />
          <span>Follow desk</span>
        </label>
      )}
    </div>
  );
}

/** True when the library runs inside the Lodestone desk. */
let deskPresent = false;
export const setDeskPresent = (v: boolean) => { deskPresent = v; };
export const useDeskAvailable = () => deskPresent;

export function useSuggestions(L: LibIndex, ctx: LibContext) {
  const settled = useSettled(ctx, ctx.source === 'desk' ? 600 : 140);
  const k = ctxKey(settled);
  const pins = useLibStore((s) => s.pins[k]);
  const dismissed = useLibStore((s) => s.dismissed[k]);
  return { ...useMemo(() => rankContext(L, settled, pins ?? [], dismissed ?? []), [L, settled, pins, dismissed]), key: k, ctx: settled };
}

export function Shelf({ L }: { L: LibIndex }) {
  const ctx = useLibStore((s) => s.prefs.ctx);
  const on = useLibStore((s) => s.prefs.suggestions);
  const open = useLibStore((s) => s.prefs.shelf);
  const [why, setWhy] = useState(false);
  const { suggestions, dynamic, key, ctx: sctx } = useSuggestions(L, ctx);
  const dismissedN = useLibStore((s) => s.dismissed[key]?.length ?? 0);
  const top = suggestions.slice(0, MAX);
  const asm = sctx.assembly ? L.asm.get(sctx.assembly) : null;
  const heading = asm ? asm.name : sctx.app ? LIB_APPS[sctx.app].name : null;

  return (
    <section className={`shelf ${open ? '' : 'closed'}`} aria-label="Suggested for your current work">
      <header className="shelf-head">
        <button className="shelf-toggle" onClick={() => useLibStore.getState().setPrefs({ shelf: !open })} aria-expanded={open}>
          <span className="label">For</span>
          <b className={asm ? `asm-dot ink-${asm.ink}` : ''}>{heading ?? 'No current context'}</b>
          {asm && sctx.app && <span className="faint">· {LIB_APPS[sctx.app].name}</span>}
          <span className="chev" aria-hidden>{open ? '▾' : '▸'}</span>
        </button>
        <ContextSwitcher L={L} />
        <span className="grow" />
        {open && on && <button className={`link-btn ${why ? 'on' : ''}`} onClick={() => setWhy(!why)} aria-pressed={why}>Why these?</button>}
        {open && dismissedN > 0 && <button className="link-btn" onClick={() => useLibStore.getState().undismissAll(key)}>Restore {dismissedN} hidden</button>}
      </header>
      {open && (
        <div className="shelf-row" role="list">
          {!on ? (
            <p className="shelf-empty serif">Suggestions are off. The library works the same without them. <button className="link-btn" onClick={() => useLibStore.getState().setPrefs({ suggestions: true })}>Turn on</button></p>
          ) : !top.length ? (
            <p className="shelf-empty serif">Nothing stands out for this context yet. Files you open here, attach, or pin will appear.</p>
          ) : (
            <AnimatePresence mode="popLayout" initial={false}>
              {top.map((s) => <Tile key={s.id} L={L} s={s} ctxKeyStr={key} why={why} />)}
              {dynamic && (
                <motion.button
                  layout key={dynamic.id} className="tile tile-dyn" role="listitem"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}
                  onClick={() => useLibUI.getState().openQL(dynamic.id)}
                  title={`${dynamic.rule}. Generated; pin it to keep a snapshot.`}
                >
                  <CollectionGlyph size={40} dynamic />
                  <span className="tile-txt">
                    <span className="tile-name">{dynamic.name}</span>
                    <span className="tile-why">{dynamic.items.length} items · dynamic</span>
                  </span>
                </motion.button>
              )}
            </AnimatePresence>
          )}
        </div>
      )}
    </section>
  );
}

function Tile({ L, s, ctxKeyStr, why }: { L: LibIndex; s: Suggestion; ctxKeyStr: string; why: boolean }) {
  const it = L.items.get(s.id);
  const col = !it ? L.collections.find((c) => c.id === s.id) : undefined;
  if (!it && !col) return null;
  const name = it?.name ?? col!.name;
  const primary = s.reasons[0];
  return (
    <motion.div
      layout className={`tile ${s.pinned ? 'pinned' : ''} ${it?.availability === 'unavailable' ? 'unavail' : ''}`} role="listitem"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
    >
      <button
        className="tile-main"
        onClick={() => useLibUI.getState().openQL(s.id)}
        title={s.reasons.map((r) => `${r.explicit ? '●' : '○'} ${r.text}`).join('\n')}
        aria-label={`${name}. ${primary?.text ?? ''}`}
      >
        {it ? <Thumb item={it} size={40} /> : <CollectionGlyph size={40} />}
        <span className="tile-txt">
          <span className="tile-name">{name}</span>
          <span className={`tile-why ${primary?.explicit ? 'explicit' : ''}`}>{primary?.text}</span>
          {why && s.reasons.slice(1, 3).map((r) => <span key={r.text} className={`tile-why more ${r.explicit ? 'explicit' : ''}`}>{r.text}</span>)}
        </span>
        {it && it.availability !== 'local' && it.availability !== 'git' && <AvailMark a={it.availability} size={10} />}
      </button>
      <span className="tile-acts">
        <button className={`tile-act ${s.pinned ? 'on' : ''}`} onClick={() => useLibStore.getState().togglePin(ctxKeyStr, s.id)} aria-pressed={s.pinned} aria-label={s.pinned ? `Unpin ${name}` : `Pin ${name} to this context`} title={s.pinned ? 'Unpin' : 'Pin to this context'}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M3 1h4l-.6 3L8 6H2l1.6-2zM5 6v3.5" fill={s.pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1" /></svg>
        </button>
        <button className="tile-act" onClick={() => useLibStore.getState().dismiss(ctxKeyStr, s.id)} aria-label={`Hide ${name} here`} title="Not relevant here">×</button>
      </span>
    </motion.div>
  );
}
