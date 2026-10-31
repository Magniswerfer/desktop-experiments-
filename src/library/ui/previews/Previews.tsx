import { useEffect, useState } from 'react';
import { fmtSize } from '../../model/format';
import type { LibIndex } from '../../model/library';
import { ADAPTERS } from '../../model/providers';
import { useLibStore } from '../../model/store';
import type { Content, DocBlock, LibItem, PdfBlock } from '../../model/types';
import { Art } from '../Art';
import { Code, Markdown } from './text';

// Content previews. Each renders what the file actually contains.

export type Loaded = { s: 'ok'; c: Content | null; fetched?: boolean } | { s: 'loading' } | { s: 'error'; reason: string };

export function useContent(L: LibIndex, it: LibItem): Loaded {
  const p = L.providers[it.provider];
  const ad = ADAPTERS[it.provider];
  const now = ad.readableNow(it, p);
  const [st, setSt] = useState<Loaded>(now ? { s: 'ok', c: it.content } : { s: 'loading' });
  useEffect(() => {
    if (ad.readableNow(it, p)) { setSt({ s: 'ok', c: it.content }); return; }
    let live = true;
    setSt({ s: 'loading' });
    ad.read(it, p).then((r) => {
      if (!live) return;
      if (r.ok) {
        setSt({ s: 'ok', c: r.content, fetched: r.fetched });
        if (r.fetched) useLibStore.getState().patchMeta(it.id, (m) => ({ ...m, downloaded: true }));
      } else setSt({ s: 'error', reason: r.reason });
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [it.id, it.content, it.availability, p.connected]);
  return st;
}

export function ContentPreview({ c, page, setPage }: { c: Content; page: number; setPage: (n: number) => void }) {
  switch (c.t) {
    case 'pdf': return <PdfView c={c} page={page} setPage={setPage} />;
    case 'markdown': return <div className="paper prose"><Markdown text={c.text} /></div>;
    case 'text': return <div className="paper prose plain"><pre>{c.text}</pre></div>;
    case 'code': return <Code text={c.text} lang={c.lang} />;
    case 'image': return <div className="img-stage"><Art art={c.art} className="img-full" /><span className="img-dim mono">{c.art.w} × {c.art.h}</span></div>;
    case 'doc': return <div className="paper doc">{c.blocks.map((b, i) => <DocB key={i} b={b} />)}</div>;
    case 'sheet': return <SheetView c={c} />;
    case 'slides': return <SlidesView c={c} page={page} setPage={setPage} />;
    case 'archive': return <ArchiveView c={c} />;
    case 'media': return <MediaView c={c} />;
  }
}

export const pageCount = (c: Content | null) => (c?.t === 'pdf' ? c.pages.length : c?.t === 'slides' ? c.slides.length : 1);

function PdfB({ b }: { b: PdfBlock }) {
  switch (b.k) {
    case 'title': return <h1 className="pdf-title">{b.text}</h1>;
    case 'authors': return <p className="pdf-authors">{b.text}</p>;
    case 'abstract': return <div className="pdf-abstract"><b>Abstract</b> {b.text}</div>;
    case 'h': return <h2 className="pdf-h">{b.text}</h2>;
    case 'p': return <p>{b.text}</p>;
    case 'quote': return <blockquote>{b.text}</blockquote>;
    case 'figure': return <figure><Art art={b.art} className="pdf-fig" /><figcaption>{b.caption}</figcaption></figure>;
    case 'table': return <table className="pdf-table"><tbody>{b.rows.map((r, i) => <tr key={i}>{r.map((c, j) => (i === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody></table>;
    case 'refs': return <ol className="pdf-refs">{b.items.map((x, i) => <li key={i}>{x}</li>)}</ol>;
  }
}

function PdfView({ c, page, setPage }: { c: Extract<Content, { t: 'pdf' }>; page: number; setPage: (n: number) => void }) {
  const p = Math.min(page, c.pages.length - 1);
  return (
    <div className="pdf">
      <div className="pdf-page paper" key={p}>
        {c.pages[p]?.blocks.map((b, i) => <PdfB key={i} b={b} />)}
        <span className="pdf-folio mono">{p + 1}</span>
      </div>
      {c.pages.length > 1 && <Pager n={c.pages.length} p={p} setPage={setPage} label="Page" />}
    </div>
  );
}

export function Pager({ n, p, setPage, label }: { n: number; p: number; setPage: (n: number) => void; label: string }) {
  return (
    <div className="pager" role="group" aria-label={`${label}s`}>
      <button className="ghost-btn" disabled={p === 0} onClick={() => setPage(p - 1)} aria-label={`Previous ${label.toLowerCase()}`}>←</button>
      <span className="tnum">{label} {p + 1} of {n}</span>
      <button className="ghost-btn" disabled={p >= n - 1} onClick={() => setPage(p + 1)} aria-label={`Next ${label.toLowerCase()}`}>→</button>
    </div>
  );
}

function DocB({ b }: { b: DocBlock }) {
  switch (b.k) {
    case 'title': return <h1>{b.text}</h1>;
    case 'h': return <h2>{b.text}</h2>;
    case 'p': return <p>{b.text}</p>;
    case 'li': return <p className="li">{b.text}</p>;
    case 'table': return <table className="pdf-table"><tbody>{b.rows.map((r, i) => <tr key={i}>{r.map((c, j) => (i === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody></table>;
    case 'sign': return <p className="sign">{b.text}</p>;
  }
}

function SheetView({ c }: { c: Extract<Content, { t: 'sheet' }> }) {
  const col = (i: number) => String.fromCharCode(65 + i);
  return (
    <div className="sheet">
      <table>
        <thead><tr><th className="rn" />{c.columns.map((_, i) => <th key={i} className="cn">{col(i)}</th>)}</tr></thead>
        <tbody>
          <tr className="hdr"><td className="rn">1</td>{c.columns.map((h, i) => <td key={i}>{h}</td>)}</tr>
          {c.rows.map((r, i) => (
            <tr key={i}><td className="rn">{i + 2}</td>{r.map((v, j) => <td key={j} className={typeof v === 'number' ? 'num tnum' : ''}>{typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SlidesView({ c, page, setPage }: { c: Extract<Content, { t: 'slides' }>; page: number; setPage: (n: number) => void }) {
  const p = Math.min(page, c.slides.length - 1);
  const s = c.slides[p];
  return (
    <div className="slides">
      <div className="slide-stage" key={p}>
        <div className={`slide-sheet ${s.art ? 'with-art' : ''}`}>
          <h2>{s.title}</h2>
          {s.bullets && <ul>{s.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>}
          {s.art && <Art art={s.art} className="slide-art" />}
          <span className="slide-n mono">{p + 1}</span>
        </div>
      </div>
      <div className="slide-strip" role="tablist" aria-label="Slides">
        {c.slides.map((x, i) => (
          <button key={i} role="tab" aria-selected={i === p} className={`strip-thumb ${i === p ? 'on' : ''}`} onClick={() => setPage(i)} title={x.title}>
            <b>{x.title.slice(0, 28)}</b>
          </button>
        ))}
      </div>
    </div>
  );
}

function ArchiveView({ c }: { c: Extract<Content, { t: 'archive' }> }) {
  const total = c.entries.reduce((a, e) => a + e.size, 0);
  return (
    <div className="archive">
      <p className="faint small">{c.entries.length} entries · {fmtSize(total)} uncompressed · contents listed without extracting</p>
      <ul>
        {c.entries.map((e) => {
          const depth = e.path.split('/').length - 1 - (e.path.endsWith('/') ? 1 : 0);
          return <li key={e.path} style={{ paddingLeft: 8 + depth * 16 }}><span className="mono">{e.path.split('/').filter(Boolean).pop()}{e.path.endsWith('/') ? '/' : ''}</span><span className="faint tnum">{e.path.endsWith('/') ? '' : fmtSize(e.size)}</span></li>;
        })}
      </ul>
    </div>
  );
}

function MediaView({ c }: { c: Extract<Content, { t: 'media' }> }) {
  const m = Math.floor(c.duration / 60), s = Math.round(c.duration % 60);
  return (
    <div className="media">
      {c.art ? <Art art={c.art} className="media-art" /> : <div className="media-art blank" />}
      <div className="wave" aria-hidden>{Array.from({ length: 64 }, (_, i) => <i key={i} style={{ height: `${20 + Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.31)) * 80}%` }} />)}</div>
      <p className="tnum">{m}:{String(s).padStart(2, '0')}{c.artist ? ` · ${c.artist}` : ''}</p>
      {c.note && <p className="faint serif">{c.note}</p>}
    </div>
  );
}
