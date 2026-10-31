import { useEffect, useState } from 'react';
import { Glyph } from '../apps/glyphs';
import { APPS } from '../apps/meta';
import { findFreeSpot, resetEngine } from '../engine/engine';
import { useDesktop } from '../model/store';
import { FOCUS_MODES, useTuning } from '../model/tuning';
import type { AppKind } from '../model/types';

const LAUNCH: AppKind[] = ['notes', 'music', 'terminal', 'browser', 'messages', 'editor'];

export function TopBar() {
  const [now, setNow] = useState(() => new Date());
  const [confirm, setConfirm] = useState(false);
  const panelOpen = useTuning((s) => s.panelOpen);
  const focusMode = useTuning((s) => s.focusMode);
  const cycleMode = () => {
    const i = FOCUS_MODES.findIndex((m) => m.id === focusMode);
    useTuning.getState().set({ focusMode: FOCUS_MODES[(i + 1) % FOCUS_MODES.length].id });
  };
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!confirm) return; const t = setTimeout(() => setConfirm(false), 3000); return () => clearTimeout(t); }, [confirm]);

  const open = (app: AppKind) => useDesktop.getState().addWindow(app, findFreeSpot());
  const reset = () => {
    if (!confirm) return setConfirm(true);
    resetEngine();
    useDesktop.getState().reset();
    setConfirm(false);
  };

  return (
    <header className="topbar">
      <span className="wordmark">Lodestone</span>
      <nav className="launch" aria-label="Open a window">
        {LAUNCH.map((a) => (
          <button key={a} className="launch-btn" onClick={() => open(a)} title={`Open ${APPS[a].name}`}>
            <Glyph app={a} size={13} /><span>{APPS[a].name}</span>
          </button>
        ))}
      </nav>
      <span className="grow" />
      <span className="hint">Drag edges together to fuse · pull a title bar to separate · click anything to move attention</span>
      <button className={`bar-btn mode-btn ${focusMode !== 'field' ? 'test' : ''}`} onClick={cycleMode} title="Cycle focus mode (M)">
        {FOCUS_MODES.find((m) => m.id === focusMode)?.label}
      </button>
      <button className={`bar-btn ${panelOpen ? 'on' : ''}`} onClick={() => useTuning.getState().setPanel(!panelOpen)} aria-pressed={panelOpen}>Tune</button>
      <button className={`bar-btn ${confirm ? 'confirm' : ''}`} onClick={reset}>{confirm ? 'Confirm reset' : 'Reset'}</button>
      <span className="clock">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
    </header>
  );
}
