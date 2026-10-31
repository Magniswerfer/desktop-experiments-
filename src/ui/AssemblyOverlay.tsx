import { memo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Glyph, IconCollapse, IconRelease, StatusMark } from '../apps/glyphs';
import { APPS, type Summary } from '../apps/meta';
import { beginObjectDrag, desktopSize, registerAsm, renderedRects } from '../engine/engine';
import { inferName, useDesktop } from '../model/store';
import type { AppKind } from '../model/types';

const inkVars = (ink: string) =>
  ({ '--ink': `var(--ds-section-${ink})`, '--ink-on': `var(--ds-section-${ink}-on)` }) as React.CSSProperties;

/** The Assembly as an object: silhouette, identity tab and collapsed summary. */
export const AssemblyOverlay = memo(function AssemblyOverlay({ id }: { id: string }) {
  const ink = useDesktop((s) => s.assemblies[id]?.ink);
  const name = useDesktop((s) => (s.assemblies[id] ? s.assemblies[id].name ?? inferName(s, s.assemblies[id]) : ''));
  const named = useDesktop((s) => !!s.assemblies[id]?.name);
  const collapsed = useDesktop((s) => !!s.assemblies[id]?.collapsed);
  const [editing, setEditing] = useState(false);
  if (!ink) return null;
  const st = () => useDesktop.getState();

  const grab = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button,input')) return;
    e.preventDefault();
    st().focusObject(id);
    beginObjectDrag(id, e);
  };
  const grabCard = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    beginObjectDrag(id, e, () => { st().setCollapsed(id, false); st().focusObject(id); });
  };

  return (
    <>
      <svg className="asm-svg" ref={(el) => registerAsm(id, 'svg', el)} aria-hidden>
        <defs>
          <clipPath id={`clip-${id}`}><path ref={(el) => registerAsm(id, 'clip', el)} clipRule="evenodd" /></clipPath>
        </defs>
        <path className="asm-hit" ref={(el) => registerAsm(id, 'hit', el)} clipPath={`url(#clip-${id})`} onPointerDown={grab as any} />
        <path className="asm-outline" ref={(el) => registerAsm(id, 'outline', el)} />
      </svg>

      <div className="asm-tab" style={inkVars(ink)} ref={(el) => registerAsm(id, 'tab', el)} onPointerDown={grab}
        title="Drag to move the assembly · double-click to name it">
        {editing ? (
          <input
            className="asm-name-input"
            autoFocus
            defaultValue={named ? name : ''}
            placeholder={name}
            onBlur={(e) => { st().rename(id, e.target.value); setEditing(false); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
        ) : (
          <span className="asm-name" onDoubleClick={() => setEditing(true)}>{name}</span>
        )}
        <button className="tab-btn" aria-label="Collapse assembly" title="Collapse" onClick={() => { st().setCollapsed(id, true); }}><IconCollapse /></button>
        <button className="tab-btn" aria-label="Release windows" title="Release all windows" onClick={() => st().release(id, renderedRects(), desktopSize())}><IconRelease /></button>
      </div>

      <div className="asm-card" style={inkVars(ink)} ref={(el) => registerAsm(id, 'card', el)} onPointerDown={grabCard}
        role="button" aria-label={`${name} assembly, ${collapsed ? 'collapsed' : 'summarised'}. Click to expand.`}>
        <AssemblyCard id={id} name={name} />
      </div>
    </>
  );
});

const PRIORITY: AppKind[] = ['terminal', 'messages', 'music', 'editor', 'notes', 'browser'];

function AssemblyCard({ id, name }: { id: string; name: string }) {
  const rows = useDesktop(
    useShallow((s) => {
      const asm = s.assemblies[id];
      if (!asm) return [] as string[];
      return Object.keys(asm.layout).map((w) => {
        const win = s.windows[w];
        if (!win) return '';
        const sum = APPS[win.app].summary(s.apps[w]);
        return `${win.app}\u0000${sum.status}\u0000${sum.text}`;
      });
    }),
  );
  const items = rows.filter(Boolean).map((r) => {
    const [app, status, text] = r.split('\u0000');
    return { app: app as AppKind, sum: { status, text } as Summary };
  });
  items.sort((a, b) => PRIORITY.indexOf(a.app) - PRIORITY.indexOf(b.app));
  const headline = items[0];
  return (
    <div className="card-inner">
      <div className="card-head">
        <span className="card-name">{name}</span>
        <span className="card-apps">{items.map((i, k) => <Glyph key={k} app={i.app} size={13} />)}</span>
      </div>
      {headline && (
        <div className="card-headline">
          <StatusMark kind={headline.sum.status} size={13} />
          <span className="clip">{headline.sum.text}</span>
        </div>
      )}
      <div className="card-rest">
        {items.slice(1, 3).map((i, k) => (
          <span key={k} className="card-item clip"><span className="card-item-app">{APPS[i.app].name}</span> {i.sum.text}</span>
        ))}
      </div>
    </div>
  );
}
