import { Fragment, memo, type ReactNode } from 'react';

// Minimal Markdown and code rendering — enough to recognise a document.

function inline(s: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\)|\[\[[^\]]+\]\])/g;
  let last = 0, m: RegExpExecArray | null, k = key;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('`')) out.push(<code key={k++}>{t.slice(1, -1)}</code>);
    else if (t.startsWith('**')) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('[[')) out.push(<span key={k++} className="wikilink">{t.slice(2, -2)}</span>);
    else if (t.startsWith('[')) out.push(<span key={k++} className="mdlink">{t.slice(1, t.indexOf(']'))}</span>);
    else out.push(<em key={k++}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0, k = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={k++} className="md-pre">{body.join('\n')}</pre>);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)/.exec(l);
    if (h) { const T = `h${Math.min(4, h[1].length + 1)}` as 'h2'; blocks.push(<T key={k++}>{inline(h[2])}</T>); i++; continue; }
    if (/^\s*([-*+]|\d+\.)\s/.test(l)) {
      const items: ReactNode[] = [];
      const ordered = /^\s*\d+\./.test(l);
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s/.test(lines[i])) {
        const raw = lines[i].replace(/^\s*([-*+]|\d+\.)\s/, '');
        const task = /^\[( |x)\]\s/.exec(raw);
        items.push(<li key={i} className={task ? 'task' : ''}>{task && <span className={`tick ${task[1] === 'x' ? 'on' : ''}`} />}{inline(task ? raw.slice(4) : raw)}</li>);
        i++;
      }
      blocks.push(ordered ? <ol key={k++}>{items}</ol> : <ul key={k++}>{items}</ul>);
      continue;
    }
    if (l.startsWith('>')) {
      const q: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) q.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push(<blockquote key={k++}>{inline(q.join(' '))}</blockquote>);
      continue;
    }
    if (/^(---|\*\*\*)\s*$/.test(l)) { blocks.push(<hr key={k++} />); i++; continue; }
    if (!l.trim()) { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#|```|>|\s*([-*+]|\d+\.)\s)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={k++}>{inline(para.join(' '))}</p>);
  }
  return <div className="md">{blocks}</div>;
});

const KW = new Set('import export from const let var function return if else for while of in new class extends implements interface type public private readonly async await try catch throw default switch case break continue true false null undefined this as void number string boolean def self None True False fn pub use struct impl mut'.split(' '));

function highlight(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\/\/.*$|#(?!\[).*$|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d[\d._e]*\b|\b[A-Za-z_$][\w$]*\b)/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const t = m[0];
    const cls = t.startsWith('//') || (t.startsWith('#') && !/^#[\w-]+:/.test(t)) ? 'tk-c'
      : /^["'`]/.test(t) ? 'tk-s'
        : /^\d/.test(t) ? 'tk-n'
          : KW.has(t) ? 'tk-k'
            : /^[A-Z]/.test(t) ? 'tk-t' : '';
    out.push(cls ? <span key={k++} className={cls}>{t}</span> : <Fragment key={k++}>{t}</Fragment>);
    last = m.index + t.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

export const Code = memo(function Code({ text, lang }: { text: string; lang: string }) {
  const lines = text.replace(/\n$/, '').split('\n');
  const plain = lang === 'json' || lang === 'text' || lang === 'bib';
  return (
    <div className="code-view" data-lang={lang}>
      <pre>
        {lines.map((l, i) => (
          <div key={i} className="cl"><span className="ln">{i + 1}</span><span className="lc">{plain && lang !== 'json' ? l : highlight(l)}</span></div>
        ))}
      </pre>
    </div>
  );
});
