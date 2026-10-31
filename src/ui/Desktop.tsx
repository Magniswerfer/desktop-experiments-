import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { desktopSize, registerOverlay, startEngine } from '../engine/engine';
import { useDesktop } from '../model/store';
import { AssemblyOverlay } from './AssemblyOverlay';
import { WindowFrame } from './WindowFrame';

export function Desktop() {
  const ref = useRef<HTMLDivElement>(null);
  const winIds = useDesktop(useShallow((s) => Object.keys(s.windows).sort()));
  const asmIds = useDesktop(useShallow((s) => Object.keys(s.assemblies).sort()));

  useEffect(() => (ref.current ? startEngine(ref.current) : undefined), []);

  // Clicking empty space moves the field of attention there.
  const onDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget || e.button !== 0) return;
    const b = e.currentTarget.getBoundingClientRect();
    const V = desktopSize();
    (document.activeElement as HTMLElement | null)?.blur?.();
    useDesktop.getState().focusPoint({ x: (e.clientX - b.left) / V.w, y: (e.clientY - b.top) / V.h });
  };

  return (
    <main className="desktop" ref={ref} onPointerDown={onDown} aria-label="Desktop">
      <div className="lens" aria-hidden />
      <div className="field-dots" aria-hidden />
      {winIds.map((id) => <WindowFrame key={id} id={id} />)}
      {asmIds.map((id) => <AssemblyOverlay key={id} id={id} />)}
      <svg className="overlay" aria-hidden>
        <path className="neck" ref={(el) => registerOverlay('neck', el)} />
        <path className="seam" ref={(el) => registerOverlay('seam', el)} />
        <circle className="lens-ring" ref={(el) => registerOverlay('ring', el)} />
      </svg>
      {winIds.length === 0 && (
        <p className="empty serif">The desk is clear. Open something from the bar above — it will land wherever there is room.</p>
      )}
    </main>
  );
}
