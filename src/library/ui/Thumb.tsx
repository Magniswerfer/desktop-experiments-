import { memo } from 'react';
import type { LibItem } from '../model/types';
import { Art } from './Art';

// Thumbnails show a miniature of the actual content wherever possible: the
// first lines of a note, the title of a paper, the colours of a screenshot.

const lines = (n: number, w = 1) => Array.from({ length: n }, (_, i) => <i key={i} style={{ width: `${(0.55 + ((i * 37) % 40) / 100) * 100 * w}%` }} />);

function firstText(it: LibItem): { title: string; body: string[] } {
  const c = it.content;
  if (!c) return { title: '', body: [] };
  switch (c.t) {
    case 'pdf': {
      const b = c.pages[0]?.blocks ?? [];
      const title = (b.find((x) => x.k === 'title') as { text: string } | undefined)?.text ?? it.name;
      const body = b.filter((x) => x.k === 'p' || x.k === 'abstract').map((x) => (x as { text: string }).text);
      return { title, body };
    }
    case 'markdown': case 'text': {
      const ls = c.text.split('\n').filter((l) => l.trim());
      return { title: (ls[0] ?? '').replace(/^#+\s*/, ''), body: ls.slice(1, 9) };
    }
    case 'code': return { title: '', body: c.text.split('\n').slice(0, 14) };
    case 'doc': return { title: (c.blocks.find((b) => b.k === 'title' || b.k === 'h') as { text: string } | undefined)?.text ?? '', body: c.blocks.filter((b) => b.k === 'p').map((b) => (b as { text: string }).text) };
    case 'slides': return { title: c.slides[0]?.title ?? '', body: c.slides[0]?.bullets ?? [] };
    default: return { title: '', body: [] };
  }
}

export const Thumb = memo(function Thumb({ item, size = 28, reps }: { item: LibItem; size?: number; reps?: LibItem[] }) {
  const rich = size >= 80;
  const c = item.content;
  const cls = `thumb k-${item.kind} ${rich ? 'rich' : ''}`;
  const st = { width: size, height: size } as React.CSSProperties;

  if (item.kind === 'folder') {
    return (
      <span className={cls} style={st} aria-hidden>
        <svg viewBox="0 0 28 28" className="folder-glyph"><path d="M3 7.5h8l2 2h12v12.5H3z" fill="var(--folder-fill)" stroke="currentColor" strokeWidth="1.3" /></svg>
        {rich && reps && reps.length > 0 && (
          <span className="folder-reps">{reps.slice(0, 3).map((r) => <Thumb key={r.id} item={r} size={Math.round(size * 0.34)} />)}</span>
        )}
      </span>
    );
  }
  if (c?.t === 'image') return <span className={cls} style={st} aria-hidden><Art art={c.art} detail={rich} /></span>;
  if (c?.t === 'media' && c.art) return <span className={cls} style={st} aria-hidden><Art art={c.art} detail={false} /><b className="play-badge" /></span>;

  const { title, body } = firstText(item);
  switch (item.kind) {
    case 'pdf': case 'doc': case 'markdown': case 'text': {
      const fig = c?.t === 'pdf' ? c.pages[0]?.blocks.find((b) => b.k === 'figure') : undefined;
      return (
        <span className={cls} style={st} aria-hidden>
          <span className="page">
            {rich ? (
              <>
                <b className="pt">{title.slice(0, 80)}</b>
                {fig && 'art' in fig && <span className="pfig"><Art art={fig.art} detail={false} /></span>}
                <span className="pb">{body.join(' ').slice(0, 260)}</span>
              </>
            ) : (
              <><b className="ph" />{lines(item.kind === 'markdown' || item.kind === 'text' ? 4 : 5)}</>
            )}
          </span>
          {!rich && item.kind === 'pdf' && <em className="pdf-mark">PDF</em>}
        </span>
      );
    }
    case 'code':
      return (
        <span className={cls} style={st} aria-hidden>
          {rich ? <pre className="cb">{body.join('\n')}</pre> : <span className="code-lines">{lines(5, 0.9)}</span>}
        </span>
      );
    case 'slides': {
      const art = c?.t === 'slides' ? c.slides.find((s) => s.art)?.art : undefined;
      return (
        <span className={cls} style={st} aria-hidden>
          <span className="slide">{rich ? <b>{title.slice(0, 40)}</b> : <b className="ph" />}{art && <span className="sart"><Art art={art} detail={false} /></span>}</span>
        </span>
      );
    }
    case 'sheet':
      return <span className={cls} style={st} aria-hidden><span className="grid-lines">{Array.from({ length: rich ? 30 : 12 }, (_, i) => <i key={i} />)}</span></span>;
    case 'archive':
      return <span className={cls} style={st} aria-hidden><svg viewBox="0 0 28 28"><rect x="6" y="4" width="16" height="20" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M14 4v3m0 2v3m0 2v3" stroke="currentColor" strokeWidth="1.6" /><rect x="12" y="17" width="4" height="4" fill="currentColor" /></svg></span>;
    case 'audio':
      return <span className={cls} style={st} aria-hidden><svg viewBox="0 0 28 28">{[6, 10, 14, 18, 22].map((x, i) => <path key={x} d={`M${x} ${14 - [3, 7, 9, 5, 3][i]}V${14 + [3, 7, 9, 5, 3][i]}`} stroke="currentColor" strokeWidth="1.8" />)}</svg></span>;
    case 'video':
      return <span className={cls} style={st} aria-hidden><svg viewBox="0 0 28 28"><rect x="3" y="7" width="22" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M12 11v6l5-3z" fill="currentColor" /></svg></span>;
    default:
      return <span className={cls} style={st} aria-hidden />;
  }
});

export function CollectionGlyph({ size = 28, dynamic = false }: { size?: number; dynamic?: boolean }) {
  return (
    <span className={`thumb k-collection ${dynamic ? 'dyn' : ''}`} style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 28 28">
        <rect x="9" y="5" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray={dynamic ? '2 2' : undefined} />
        <rect x="5" y="9" width="14" height="14" fill="var(--ds-paper-raised)" stroke="currentColor" strokeWidth="1.3" strokeDasharray={dynamic ? '2 2' : undefined} />
      </svg>
    </span>
  );
}
