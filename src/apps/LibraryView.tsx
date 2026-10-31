import { openItem } from '../library/model/actions';
import { LIB_APPS } from '../library/model/apps';
import { useLibrary } from '../library/model/library';
import { useLibStore } from '../library/model/store';
import { LibraryApp } from '../library/ui/LibraryApp';
import { useSuggestions } from '../library/ui/Shelf';
import { CollectionGlyph, Thumb } from '../library/ui/Thumb';
import { useLibUI } from '../library/ui/uiStore';
import type { Presentation } from '../model/types';
import { Glyph } from './glyphs';
import '../library/ui/library.css';

// The Library on the desk. Focused, it is the full library. In the periphery
// it becomes what it is for: the few files relevant to what you're doing,
// openable without moving attention (data-act).

export function LibraryView({ pres }: { id: string; pres: Presentation }) {
  if (pres === 'full') return <LibraryApp embedded />;
  return <LibraryPeripheral pres={pres} />;
}

function LibraryPeripheral({ pres }: { pres: Presentation }) {
  const L = useLibrary();
  const ctx = useLibStore((s) => s.prefs.ctx);
  const on = useLibStore((s) => s.prefs.suggestions);
  const { suggestions, ctx: sctx } = useSuggestions(L, ctx);
  const asm = sctx.assembly ? L.asm.get(sctx.assembly) : null;
  const label = asm?.name ?? (sctx.app ? LIB_APPS[sctx.app].name : 'your desk');
  const top = on ? suggestions.filter((s) => L.items.has(s.id) || s.id.startsWith('c_')).slice(0, 4) : [];
  const inbox = L.all.filter((i) => i.origin === 'received' && !L.kept(i.id) && L.now - i.added < 2 * 864e5).length;

  if (pres === 'widget') {
    return (
      <div className="widget">
        <span className="widget-glyph"><Glyph app="library" size={16} /></span>
        <span className="widget-text">
          <span className="widget-title">{top.length ? `${top.length} files for ${label}` : 'Library'}</span>
          <span className="widget-sub">{inbox ? `${inbox} new received` : top[0] ? (L.items.get(top[0].id)?.name ?? '') : 'nothing suggested'}</span>
        </span>
      </div>
    );
  }
  return (
    <div className="lib-compact">
      <div className="lc-head"><span className="label">For</span> <b className={asm ? `asm-dot ink-${asm.ink}` : ''}>{label}</b>{inbox > 0 && <span className="lc-new">{inbox} new</span>}</div>
      <ul className="lc-list">
        {top.map((s) => {
          const it = L.items.get(s.id);
          const col = !it ? L.collections.find((c) => c.id === s.id) : undefined;
          return (
            <li key={s.id}>
              <button
                data-act className="lc-row"
                title={`${s.reasons[0]?.text ?? ''} · click to open without moving attention`}
                onClick={(e) => { e.stopPropagation(); if (it) openItem(it.id); else { useLibUI.getState().openQL(s.id); } }}
              >
                {it ? <Thumb item={it} size={24} /> : <CollectionGlyph size={24} />}
                <span className="lc-txt"><span className="lc-name">{it?.name ?? col?.name}</span><span className="lc-why">{s.reasons[0]?.text}</span></span>
              </button>
            </li>
          );
        })}
        {!top.length && <li className="lc-empty">Nothing stands out here yet.</li>}
      </ul>
    </div>
  );
}
