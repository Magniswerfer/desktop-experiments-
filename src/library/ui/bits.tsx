import type { LibIndex } from '../model/library';
import { AVAIL_LABEL } from '../model/providers';
import type { Availability, LibItem } from '../model/types';

// Small shared marks. State is drawn so it reads in greyscale.

export function AvailMark({ a, size = 12 }: { a: Availability; size?: number }) {
  const s = { width: size, height: size, viewBox: '0 0 12 12', className: `avail av-${a}`, role: 'img', 'aria-label': AVAIL_LABEL[a] } as const;
  switch (a) {
    case 'local': return <svg {...s}><rect x="1.5" y="2.5" width="9" height="6" fill="none" stroke="currentColor" strokeWidth="1.1" /><path d="M3.5 10.5h5" stroke="currentColor" strokeWidth="1.1" /></svg>;
    case 'cloud-downloaded': return <svg {...s}><path d="M3 9.5h6.2a2.3 2.3 0 0 0 .2-4.6A3.2 3.2 0 0 0 3.2 5.6 2 2 0 0 0 3 9.5z" fill="currentColor" /></svg>;
    case 'cloud-online': return <svg {...s}><path d="M3 9.5h6.2a2.3 2.3 0 0 0 .2-4.6A3.2 3.2 0 0 0 3.2 5.6 2 2 0 0 0 3 9.5z" fill="none" stroke="currentColor" strokeWidth="1.1" /></svg>;
    case 'unavailable': return <svg {...s}><rect x="1.5" y="3" width="9" height="6" fill="none" stroke="currentColor" strokeWidth="1.1" strokeDasharray="1.6 1.2" /><path d="M2 10.5L10 1.5" stroke="currentColor" strokeWidth="1.1" /></svg>;
    case 'git': return <svg {...s}><circle cx="3.5" cy="2.8" r="1.4" fill="none" stroke="currentColor" strokeWidth="1.1" /><circle cx="3.5" cy="9.2" r="1.4" fill="none" stroke="currentColor" strokeWidth="1.1" /><circle cx="8.8" cy="4.2" r="1.4" fill="none" stroke="currentColor" strokeWidth="1.1" /><path d="M3.5 4.2v3.6M8.8 5.6c0 2-5.3 1.4-5.3 2.2" fill="none" stroke="currentColor" strokeWidth="1.1" /></svg>;
  }
}

export function locationLabel(L: LibIndex, it: LibItem): string {
  const p = L.providers[it.provider];
  const parent = it.parentId ? L.items.get(it.parentId) : null;
  if (it.provider === 'downloads' && !parent) return 'Downloads';
  if (it.provider === 'git-orbit') return parent ? `orbit / ${parent.name}` : 'orbit';
  if (parent) return parent.name;
  return p?.label ?? '';
}

export function TagChip({ label, kind, state, onRemove, onApprove }: {
  label: string; kind: 'personal' | 'topic'; state?: 'pending' | 'approved'; onRemove?: () => void; onApprove?: () => void;
}) {
  return (
    <span className={`chip chip-${kind} ${state ? `chip-${state}` : ''}`} title={kind === 'personal' ? 'Personal tag' : state === 'approved' ? 'Suggested from content · approved by you' : 'Suggested from content · not yet approved'}>
      {kind === 'topic' && <span className="chip-ai" aria-label="suggested">◇</span>}
      <span>{label}</span>
      {onApprove && <button className="chip-x" onClick={onApprove} aria-label={`Approve ${label}`} title="Approve">✓</button>}
      {onRemove && <button className="chip-x" onClick={onRemove} aria-label={`Remove ${label}`} title="Remove">×</button>}
    </span>
  );
}

export const Kbd = ({ children }: { children: React.ReactNode }) => <kbd className="kbd">{children}</kbd>;

export function isNew(L: LibIndex, it: LibItem) {
  return it.origin === 'received' && !L.lastOpened.has(it.id) && !L.kept(it.id) && L.now - it.added < 7 * 864e5;
}
