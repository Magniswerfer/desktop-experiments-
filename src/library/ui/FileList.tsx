import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { KIND_LABEL } from '../model/apps';
import { fmtWhen } from '../model/format';
import type { LibIndex } from '../model/library';
import type { Row } from '../model/query';
import type { SortKey } from '../model/store';
import type { LibItem } from '../model/types';
import { AvailMark, isNew, locationLabel } from './bits';
import { Thumb } from './Thumb';
import { useLibUI } from './uiStore';

// A virtualised, spatially stable list. Rows have fixed heights so position
// is a pure function of index: selecting, previewing or tagging never moves
// anything. Only rows in (and just around) the viewport are rendered.

const ROW = 36, HEAD = 30, OVERSCAN = 8;

interface Props {
  L: LibIndex;
  rows: Row[];
  ids: string[];
  sort: SortKey;
  onOpen: (id: string) => void;
  onContext: (id: string, e: React.MouseEvent) => void;
}

function useViewport(ref: React.RefObject<HTMLDivElement | null>) {
  const [vp, setVp] = useState({ top: 0, h: 600, w: 800 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const read = () => { raf = 0; setVp({ top: el.scrollTop, h: el.clientHeight, w: el.clientWidth }); };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(read); };
    const ro = new ResizeObserver(read);
    ro.observe(el);
    el.addEventListener('scroll', onScroll, { passive: true });
    read();
    return () => { ro.disconnect(); el.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, [ref]);
  return vp;
}

/** Scroll the minimum needed to keep [top, top+h] visible. Never recentres. */
function reveal(el: HTMLElement, top: number, h: number, pad = 0) {
  if (top - pad < el.scrollTop) el.scrollTop = top - pad;
  else if (top + h > el.scrollTop + el.clientHeight) el.scrollTop = top + h - el.clientHeight;
}

export const FileList = memo(function FileList({ L, rows, ids, sort, onOpen, onContext }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const vp = useViewport(ref);
  const sel = useLibUI((s) => s.sel);
  const multi = useLibUI((s) => s.multi);
  const qlOpen = useLibUI((s) => s.ql.open);

  const offsets = useMemo(() => {
    const o = new Float64Array(rows.length + 1);
    for (let i = 0; i < rows.length; i++) o[i + 1] = o[i] + (rows[i].t === 'h' ? HEAD : ROW);
    return o;
  }, [rows]);
  const indexOf = useMemo(() => { const m = new Map<string, number>(); rows.forEach((r, i) => r.t === 'i' && m.set(r.id, i)); return m; }, [rows]);
  const total = offsets[rows.length];

  // Keep the selection visible (minimal scroll), including under Quick Look.
  useEffect(() => {
    if (!sel || !ref.current) return;
    const i = indexOf.get(sel);
    if (i === undefined) return;
    reveal(ref.current, offsets[i], ROW, i > 0 && rows[i - 1].t === 'h' ? HEAD : 0);
  }, [sel, indexOf, offsets, rows]);

  // Binary search the first visible row.
  let lo = 0, hi = rows.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (offsets[m + 1] <= vp.top) lo = m + 1; else hi = m; }
  const start = Math.max(0, lo - OVERSCAN);
  let end = lo;
  while (end < rows.length && offsets[end] < vp.top + vp.h) end++;
  end = Math.min(rows.length, end + OVERSCAN);

  // Sticky group header for the current scroll position.
  let sticky: string | null = null;
  for (let i = lo; i >= 0; i--) { const r = rows[i]; if (r?.t === 'h') { sticky = r.label; break; } }

  const multiSet = useMemo(() => new Set(multi), [multi]);
  const dateLabel = sort === 'added' ? 'Added' : sort === 'modified' ? 'Modified' : 'Last opened';

  const click = (id: string, e: React.MouseEvent) => {
    useLibUI.getState().select(id, { extend: e.shiftKey, toggle: e.metaKey || e.ctrlKey, ids });
    ref.current?.focus({ preventScroll: true });
  };

  return (
    <div className="list-wrap">
      <div className="list-head" role="presentation">
        <span className="c-name">Name</span><span className="c-kind">Kind</span><span className="c-date">{dateLabel}</span><span className="c-loc">Location</span>
      </div>
      <div
        ref={ref}
        className={`list ${qlOpen ? 'ql-open' : ''}`}
        tabIndex={0}
        role="listbox"
        aria-label="Library"
        aria-multiselectable
        aria-activedescendant={sel ? `row-${sel}` : undefined}
        data-list
      >
        {sticky && vp.top > 0 && <div className="sticky-h" aria-hidden>{sticky}</div>}
        <div style={{ height: total, position: 'relative' }}>
          {rows.slice(start, end).map((r, k) => {
            const i = start + k;
            if (r.t === 'h') return <div key={r.key} className="group-h" style={{ top: offsets[i], height: HEAD }} role="presentation">{r.label}</div>;
            const it = L.items.get(r.id);
            if (!it) return null;
            return (
              <ListRow
                key={r.id} L={L} it={it} top={offsets[i]} sort={sort}
                selected={sel === r.id} inMulti={multiSet.has(r.id)}
                onClick={click} onOpen={onOpen} onContext={onContext}
              />
            );
          })}
        </div>
        {rows.length === 0 && <p className="empty serif">Nothing matches. Try fewer words, or search everywhere with <b>Esc</b> then <b>/</b>.</p>}
      </div>
    </div>
  );
});

const ListRow = memo(function ListRow({ L, it, top, sort, selected, inMulti, onClick, onOpen, onContext }: {
  L: LibIndex; it: LibItem; top: number; sort: SortKey; selected: boolean; inMulti: boolean;
  onClick: (id: string, e: React.MouseEvent) => void; onOpen: (id: string) => void; onContext: (id: string, e: React.MouseEvent) => void;
}) {
  const last = L.lastOpened.get(it.id);
  const date = sort === 'added' ? it.added : sort === 'modified' ? it.modified : last ?? it.added;
  const dateHint = sort === 'recent' && !last ? (it.origin === 'received' ? 'Received' : it.origin === 'created' ? 'Created' : 'Added') : '';
  const fresh = isNew(L, it);
  const unkept = it.origin === 'received' && !L.kept(it.id);
  const stats = it.kind === 'folder' ? L.folderStats(it.id) : null;
  const tags = L.personalTags(it.id);
  return (
    <div
      id={`row-${it.id}`}
      role="option"
      aria-selected={selected || inMulti}
      className={`row ${selected ? 'sel' : ''} ${inMulti ? 'multi' : ''} ${it.availability === 'unavailable' ? 'unavail' : ''}`}
      style={{ top, height: ROW }}
      onMouseDown={(e) => { if (e.button === 0) onClick(it.id, e); }}
      onDoubleClick={() => onOpen(it.id)}
      onContextMenu={(e) => { e.preventDefault(); onContext(it.id, e); }}
    >
      <span className="c-name">
        <Thumb item={it} size={26} />
        <span className="nm">{it.name}</span>
        {fresh && <span className="new-mark" title="New, not opened yet">New</span>}
        {stats && <span className="faint count">{stats.count}</span>}
        {tags.slice(0, 2).map((t) => <span key={t} className="row-tag">{L.tags.get(t)?.label}</span>)}
      </span>
      <span className="c-kind faint">{it.kind === 'folder' ? 'Folder' : it.ext ? it.ext.toUpperCase() : KIND_LABEL[it.kind]}</span>
      <span className="c-date tnum">{dateHint && <span className="faint">{dateHint} </span>}{fmtWhen(date, L.now)}</span>
      <span className="c-loc faint">
        <AvailMark a={it.availability} />
        <span className="loc-t">{locationLabel(L, it)}</span>
        {unkept && <span className="unkept" title="Received, not kept yet">inbox</span>}
      </span>
    </div>
  );
});

// ─── Grid view ───────────────────────────────────────────────────────────────

const CELL_W = 156, CELL_H = 178;

export const FileGrid = memo(function FileGrid({ L, ids, onOpen, onContext, onCols }: { L: LibIndex; ids: string[]; onOpen: (id: string) => void; onContext: (id: string, e: React.MouseEvent) => void; onCols: (n: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const vp = useViewport(ref);
  const sel = useLibUI((s) => s.sel);
  const multi = useLibUI((s) => s.multi);
  const cols = Math.max(1, Math.floor((vp.w - 16) / CELL_W));
  useEffect(() => onCols(cols), [cols, onCols]);
  const nRows = Math.ceil(ids.length / cols);
  const r0 = Math.max(0, Math.floor(vp.top / CELL_H) - 2);
  const r1 = Math.min(nRows, Math.ceil((vp.top + vp.h) / CELL_H) + 2);
  const idx = useMemo(() => new Map(ids.map((id, i) => [id, i])), [ids]);
  useEffect(() => {
    if (!sel || !ref.current) return;
    const i = idx.get(sel);
    if (i === undefined) return;
    reveal(ref.current, Math.floor(i / cols) * CELL_H, CELL_H);
  }, [sel, idx, cols]);
  const cells = [];
  for (let r = r0; r < r1; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    const id = ids[i];
    if (!id) break;
    const it = L.items.get(id)!;
    const reps = it.kind === 'folder' ? L.folderStats(id).reps.map((x) => L.items.get(x)!).filter(Boolean) : undefined;
    cells.push(
      <div
        key={id} id={`row-${id}`} role="option" aria-selected={sel === id || multi.includes(id)}
        className={`cell ${sel === id ? 'sel' : ''} ${multi.includes(id) ? 'multi' : ''} ${it.availability === 'unavailable' ? 'unavail' : ''}`}
        style={{ left: 8 + c * CELL_W, top: r * CELL_H, width: CELL_W - 12, height: CELL_H - 10 }}
        onMouseDown={(e) => { useLibUI.getState().select(id, { extend: e.shiftKey, toggle: e.metaKey || e.ctrlKey, ids }); ref.current?.focus({ preventScroll: true }); }}
        onDoubleClick={() => onOpen(id)}
        onContextMenu={(e) => { e.preventDefault(); onContext(id, e); }}
      >
        <span className="cell-thumb"><Thumb item={it} size={124} reps={reps} /></span>
        <span className="cell-name">{it.name}</span>
        <span className="cell-meta faint"><AvailMark a={it.availability} size={10} /> {fmtWhen(L.lastOpened.get(id) ?? it.added, L.now)}</span>
      </div>,
    );
  }
  return (
    <div ref={ref} className="grid" tabIndex={0} role="listbox" aria-label="Library" aria-activedescendant={sel ? `row-${sel}` : undefined} data-list>
      <div style={{ height: nRows * CELL_H + 8, position: 'relative' }}>{cells}</div>
      {ids.length === 0 && <p className="empty serif">Nothing here yet.</p>}
    </div>
  );
});
