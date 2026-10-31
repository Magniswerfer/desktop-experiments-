import { useEffect } from 'react';
import { startSim } from './apps/sim';
import { renderedRects } from './engine/engine';
import { center } from './model/geometry';
import { useDesktop } from './model/store';
import { useTuning } from './model/tuning';
import { DebugPanel } from './ui/DebugPanel';
import { Desktop } from './ui/Desktop';
import { TopBar } from './ui/TopBar';

/** Keyboard paths so nothing is ever reachable by pointer alone. */
function useKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable], .lib') || e.metaKey || e.ctrlKey || e.altKey) return;
      const st = useDesktop.getState();
      if (e.key === 't' || e.key === 'T') { useTuning.getState().setPanel(!useTuning.getState().panelOpen); return; }
      if (e.key === 'Escape') { st.focusPoint(st.focus.point); return; }
      if (e.key === '[' || e.key === ']') {
        // order objects left → right by where they currently are
        const r = renderedRects();
        const objs = st.stack.map((id) => {
          const members = id.startsWith('a_') ? Object.keys(st.assemblies[id]?.layout ?? {}) : [id];
          const rr = members.map((m) => r[m]).filter(Boolean);
          const c = rr.length ? center(rr[0]) : { x: 0, y: 0 };
          return { id, x: c.x + c.y * 0.01 };
        }).sort((a, b) => a.x - b.x);
        if (!objs.length) return;
        const i = objs.findIndex((o) => o.id === st.focus.obj);
        const n = objs[(i + (e.key === ']' ? 1 : -1) + objs.length) % objs.length];
        st.focusObject(n.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  useKeys();
  useEffect(() => startSim(), []);
  return (
    <div className="shell">
      <TopBar />
      <Desktop />
      <DebugPanel />
    </div>
  );
}
