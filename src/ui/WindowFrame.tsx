import { AnimatePresence, motion } from 'motion/react';
import { memo, useCallback } from 'react';
import { Glyph, IconClose } from '../apps/glyphs';
import { APPS } from '../apps/meta';
import { VIEWS } from '../apps/views';
import {
  beginMemberDrag, beginObjectDrag, beginResize, desktopSize, isReduced, registerAtt, registerWin, renderedRects,
} from '../engine/engine';
import { usePresentation } from '../model/presentation';
import { useDesktop } from '../model/store';

export const WindowFrame = memo(function WindowFrame({ id }: { id: string }) {
  const app = useDesktop((s) => s.windows[id]?.app);
  const asmId = useDesktop((s) => s.windows[id]?.assemblyId ?? null);
  const title = useDesktop((s) => (s.windows[id] ? APPS[s.windows[id].app].title(s.apps[id]) : ''));
  const active = useDesktop((s) => s.focus.win === id);
  const known = usePresentation((s) => s.win[id]);
  const pres = known ?? 'compact';
  const ref = useCallback((el: HTMLDivElement | null) => registerWin(id, el), [id]);
  const attRef = useCallback((el: HTMLSpanElement | null) => registerAtt(id, el), [id]);
  if (!app) return null;
  const View = VIEWS[app];
  const obj = asmId ?? id;

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-act]')) return; // peripheral actions don't steal attention
    useDesktop.getState().focusObject(obj, id);
    // A widget has no title bar: the whole object is the handle.
    if (pres === 'widget' && !asmId) {
      e.preventDefault();
      beginObjectDrag(id, e);
    }
  };
  const onTitleDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    useDesktop.getState().focusObject(obj, id);
    if (asmId) beginMemberDrag(asmId, id, e);
    else beginObjectDrag(id, e);
  };
  const close = () => useDesktop.getState().closeWindow(id, renderedRects(), desktopSize());
  const fade = isReduced() ? { duration: 0 } : { duration: 0.2, ease: [0.16, 1, 0.3, 1] as const };

  return (
    <div
      ref={ref}
      className={`win p-${pres} ${asmId ? 'member' : 'free'} ${active ? 'active' : ''}`}
      data-app={app}
      onPointerDown={onDown}
    >
      {pres !== 'widget' && (
        <div className="titlebar" onPointerDown={onTitleDown} title={asmId ? 'Drag to pull this window out of the assembly' : 'Drag to move · bring to another window to fuse'}>
          <Glyph app={app} size={pres === 'compact' ? 12 : 13} />
          <span className="tb-app">{APPS[app].name}</span>
          <span className="tb-title">{title}</span>
          <button className="tb-close" aria-label={`Close ${APPS[app].name}`} onClick={close}><IconClose /></button>
        </div>
      )}
      <div className="win-body">
        <AnimatePresence initial={false}>
          {known && <motion.div key={pres} className="layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade}>
            <View id={id} pres={pres} />
          </motion.div>}
        </AnimatePresence>
      </div>
      {pres === 'full' && (
        <div className="resize" aria-hidden onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); useDesktop.getState().focusObject(obj, id); beginResize(id, e); }} />
      )}
      <span className="att mono" ref={attRef} />
    </div>
  );
});
