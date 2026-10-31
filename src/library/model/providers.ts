import type { Availability, Content, LibItem, Provider, ProviderId } from './types';

// ─── Storage provider abstraction ────────────────────────────────────────────
// The UI only talks to this interface. A real implementation would back each
// adapter with a local index (SQLite/tracker), a WebDAV client for Nextcloud,
// libgit2 for repositories, udisks for removable drives. Here each adapter is
// a simulation over seeded data, with honest availability semantics.

export type ReadResult =
  | { ok: true; content: Content | null; fetched?: boolean }
  | { ok: false; reason: string };

export interface ProviderAdapter {
  readonly id: ProviderId;
  /** Whether the item's contents can be read right now, without a network fetch. */
  readableNow(item: LibItem, p: Provider): boolean;
  /** Read contents for preview. Online-only cloud files are fetched (simulated latency). */
  read(item: LibItem, p: Provider): Promise<ReadResult>;
  /** User-facing location line. */
  describe(item: LibItem, p: Provider): string;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const localAdapter = (id: ProviderId): ProviderAdapter => ({
  id,
  readableNow: () => true,
  read: async (item) => ({ ok: true, content: item.content }),
  describe: (_i, p) => p.label,
});

const cloudAdapter: ProviderAdapter = {
  id: 'nextcloud',
  readableNow: (item, p) => p.connected && item.availability !== 'cloud-online',
  read: async (item, p) => {
    if (item.availability === 'cloud-online') {
      if (!p.connected) return { ok: false, reason: 'Online only, and Nextcloud is offline. Nothing is stored on this computer.' };
      await wait(450 + (item.size / 1e6) * 40);
      return { ok: true, content: item.content, fetched: true };
    }
    return { ok: true, content: item.content };
  },
  describe: (item) => (item.availability === 'cloud-online' ? 'Nextcloud · online only' : 'Nextcloud · downloaded'),
};

const externalAdapter: ProviderAdapter = {
  id: 'external',
  readableNow: (_i, p) => p.connected,
  read: async (item, p) =>
    p.connected
      ? { ok: true, content: item.content }
      : { ok: false, reason: `${p.label} is not connected. The library remembers this file, but its contents are on the drive.` },
  describe: (_i, p) => (p.connected ? `${p.label} · connected` : `${p.label} · not connected`),
};

export const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  home: localAdapter('home'),
  downloads: localAdapter('downloads'),
  'git-orbit': { ...localAdapter('git-orbit'), describe: (i) => `Git · ${i.git?.branch ?? 'main'}${i.git && i.git.status !== 'clean' ? ` · ${i.git.status}` : ''}` },
  nextcloud: cloudAdapter,
  external: externalAdapter,
};

/** Effective availability, taking the provider's connection state into account. */
export function effectiveAvailability(item: LibItem, p: Provider | undefined): Availability {
  if (!p) return item.availability;
  if (p.kind === 'external') return p.connected ? 'local' : 'unavailable';
  return item.availability;
}

export const AVAIL_LABEL: Record<Availability, string> = {
  local: 'On this computer',
  'cloud-downloaded': 'Cloud · downloaded',
  'cloud-online': 'Cloud · online only',
  unavailable: 'Drive not connected',
  git: 'Git repository',
};
