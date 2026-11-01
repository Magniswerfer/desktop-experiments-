import type { AppKind } from '../model/types';
import type { StatusKind } from './meta';

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'square' as const, strokeLinejoin: 'miter' as const };

export function Glyph({ app, size = 14 }: { app: AppKind; size?: number }) {
  const s = { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true } as const;
  switch (app) {
    case 'music': return <svg {...s}><path {...P} d="M6 12.5V3.5l7-1.5v9" /><circle {...P} cx="4.5" cy="12.5" r="1.8" /><circle {...P} cx="11.5" cy="11" r="1.8" /></svg>;
    case 'terminal': return <svg {...s}><rect {...P} x="1.5" y="2.5" width="13" height="11" /><path {...P} d="M4 6l2.5 2L4 10M8 10.5h4" /></svg>;
    case 'browser': return <svg {...s}><circle {...P} cx="8" cy="8" r="6.2" /><path {...P} d="M1.8 8h12.4M8 1.8c-3 3.4-3 9 0 12.4M8 1.8c3 3.4 3 9 0 12.4" /></svg>;
    case 'notes': return <svg {...s}><path {...P} d="M3 1.8h10v12.4H3zM5.5 5h5M5.5 8h5M5.5 11h3" /></svg>;
    case 'messages': return <svg {...s}><path {...P} d="M1.8 2.5h12.4v8.5H7l-3.5 2.8V11H1.8z" /></svg>;
    case 'library': return <svg {...s}><path {...P} d="M2 2.5h3v11H2zM6.5 2.5h3v11h-3zM11 3.2l2.6-.7 2 10.6-2.6.6z" /></svg>;
    case 'editor': return <svg {...s}><path {...P} d="M5.5 4L2 8l3.5 4M10.5 4L14 8l-3.5 4M9 2.5l-2 11" /></svg>;
  }
}

/** Status drawn so it reads in greyscale; colour only reinforces. */
export function StatusMark({ kind, size = 12 }: { kind: StatusKind; size?: number }) {
  const s = { width: size, height: size, viewBox: '0 0 12 12', className: `status-mark sm-${kind}`, 'aria-label': kind } as const;
  switch (kind) {
    case 'ok': return <svg {...s}><rect x="0.5" y="0.5" width="11" height="11" fill="currentColor" /><path d="M3 6.2l2 2 4-4.4" fill="none" stroke="var(--on-mark)" strokeWidth="1.6" /></svg>;
    case 'err': return <svg {...s}><rect x="0.75" y="0.75" width="10.5" height="10.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M3.5 3.5l5 5M8.5 3.5l-5 5" stroke="currentColor" strokeWidth="1.6" /></svg>;
    case 'run': return <svg {...s} className={`status-mark sm-run spin`}><circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.6" /><path d="M6 1.4A4.6 4.6 0 0 1 10.6 6" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>;
    case 'unread': return <svg {...s}><circle cx="6" cy="6" r="5" fill="currentColor" /></svg>;
    case 'play': return <svg {...s}><path d="M2 10V6M5 10V2M8 10V4.5M11 10V7" stroke="currentColor" strokeWidth="1.6" /></svg>;
    case 'pause': return <svg {...s}><path d="M3.5 2v8M8.5 2v8" stroke="currentColor" strokeWidth="1.6" /></svg>;
    case 'edit': return <svg {...s}><circle cx="6" cy="6" r="4.4" fill="none" stroke="currentColor" strokeWidth="1.5" /><circle cx="6" cy="6" r="1.6" fill="currentColor" /></svg>;
    default: return <svg {...s}><circle cx="6" cy="6" r="4.4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>;
  }
}

export const IconPlay = () => <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M2.5 1.5v9l8-4.5z" fill="currentColor" /></svg>;
export const IconPause = () => <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M2.5 1.5h2.5v9H2.5zM7 1.5h2.5v9H7z" fill="currentColor" /></svg>;
export const IconPrev = () => <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M1.5 1.5v9M10.5 1.5v9L3.5 6z" fill="currentColor" stroke="currentColor" strokeWidth="1" /></svg>;
export const IconNext = () => <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M10.5 1.5v9M1.5 1.5v9L8.5 6z" fill="currentColor" stroke="currentColor" strokeWidth="1" /></svg>;
export const IconClose = () => <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.4" /></svg>;
export const IconCollapse = () => <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M1 5h8" stroke="currentColor" strokeWidth="1.5" /></svg>;
export const IconRelease = () => <svg width="12" height="10" viewBox="0 0 12 10" aria-hidden><path d="M0.75 0.75h4v8.5h-4zM7.25 0.75h4v8.5h-4z" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>;
