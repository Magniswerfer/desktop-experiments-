// Formatting helpers. Dates read the way people talk about them.

const MIN = 60e3, H = 3600e3, D = 24 * H;

export function fmtSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${Math.round(b / 1024)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(b < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(b / 1024 ** 3).toFixed(1)} GB`;
}

const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** Compact relative time for list columns: "14:02", "Yesterday", "Tue", "12 Oct", "Mar 2024". */
export function fmtWhen(t: number | null | undefined, now = Date.now()): string {
  if (!t) return '—';
  const d = new Date(t);
  const today = startOfDay(now);
  if (t >= today) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (t >= today - D) return 'Yesterday';
  if (t >= today - 6 * D) return d.toLocaleDateString([], { weekday: 'short' });
  if (new Date(now).getFullYear() === d.getFullYear()) return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  return d.toLocaleDateString([], { month: 'short', year: 'numeric' });
}

export function fmtAgo(t: number | null | undefined, now = Date.now()): string {
  if (!t) return 'never';
  const s = now - t;
  if (s < MIN) return 'just now';
  if (s < H) return `${Math.round(s / MIN)} min ago`;
  if (s < D) return `${Math.round(s / H)} h ago`;
  if (s < 30 * D) return `${Math.round(s / D)} d ago`;
  return fmtDate(t);
}

export function fmtDate(t: number): string {
  return new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}
export function fmtDateTime(t: number): string {
  return new Date(t).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Day-group label for the chronological list. */
export function dayGroup(t: number, now = Date.now()): string {
  const today = startOfDay(now);
  if (t >= today) return 'Today';
  if (t >= today - D) return 'Yesterday';
  if (t >= today - 6 * D) return 'Earlier this week';
  if (t >= today - 13 * D) return 'Last week';
  const d = new Date(t), n = new Date(now);
  if (d.getFullYear() === n.getFullYear()) return d.toLocaleDateString([], { month: 'long' });
  return String(d.getFullYear());
}

export const tildify = (p: string) => p.replace(/^\/home\/magnus/, '~');
