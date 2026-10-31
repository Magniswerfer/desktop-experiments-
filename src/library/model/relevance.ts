import { LIB_APPS } from './apps';
import type { LibIndex } from './library';
import type { LibContext } from './store';
import type { AppId, Collection } from './types';

// ─── Contextual relevance ────────────────────────────────────────────────────
// Each signal contributes a score and a human reason. Weights are tiered so
// explicit associations always outrank inferred ones:
//
//   pinned (user, here)                  1000
//   attached to Assembly (explicit)       300
//   collection associated w/ Assembly     220 (collection) / 40 (its items)
//   used while Assembly active            ≤ 120 (recency-weighted count)
//   references an attached/used file      ≤ 45
//   opened repeatedly by focused app      ≤ 70
//   commonly opened together              ≤ 35
//   related by topic (tag overlap)        ≤ 30
//   compatible with focused app             6  (weak on purpose)

export type ReasonKind = 'pinned' | 'attached' | 'collection' | 'assembly-use' | 'app-use' | 'references' | 'together' | 'topic' | 'compatible';

export interface Reason { kind: ReasonKind; text: string; score: number; explicit: boolean }
export interface Suggestion {
  /** Item id, or collection id (prefixed c_ / dyn_). */
  id: string;
  type: 'item' | 'collection' | 'dynamic';
  score: number;
  reasons: Reason[];
  pinned: boolean;
}

export const ctxKey = (c: LibContext) => c.assembly ?? (c.app ? `app:${c.app}` : 'none');

const DAY = 864e5;
const decay = (age: number, halfLife = 7 * DAY) => Math.pow(0.5, age / halfLife);

export interface DynamicView { id: string; name: string; items: string[]; rule: string }

export function rankContext(
  L: LibIndex,
  ctx: LibContext,
  pins: string[],
  dismissed: string[],
): { suggestions: Suggestion[]; dynamic: DynamicView | null } {
  const { assembly, app } = ctx;
  const asm = assembly ? L.asm.get(assembly) : undefined;
  const scores = new Map<string, Reason[]>();
  const add = (id: string, r: Reason) => {
    if (!L.items.has(id) && !id.startsWith('c_')) return;
    if (!scores.has(id)) scores.set(id, []);
    scores.get(id)!.push(r);
  };
  const appName = app ? LIB_APPS[app].noun : '';

  // 1. Explicit: attached to the assembly.
  if (asm) for (const id of asm.attached) add(id, { kind: 'attached', text: `Attached to ${asm.name}`, score: 300, explicit: true });

  // 2. Collections associated with the assembly.
  const asmCols: Collection[] = asm ? L.collections.filter((c) => c.assemblies.includes(asm.id)) : [];
  for (const c of asmCols) {
    add(c.id, { kind: 'collection', text: `Collection for ${asm!.name}`, score: 220, explicit: true });
    for (const id of c.items) add(id, { kind: 'collection', text: `In “${c.name}”`, score: 40, explicit: true });
  }

  // 3. Usage while the assembly was active, and by the focused app.
  const asmUse = new Map<string, number>(), appUse = new Map<string, number>(), appRecent = new Map<string, number>();
  for (const e of L.usage) {
    if (e.action === 'download') continue;
    const w = decay(L.now - e.at);
    if (asm && e.assembly === asm.id) asmUse.set(e.item, (asmUse.get(e.item) ?? 0) + w);
    if (app && e.app === app) {
      appUse.set(e.item, (appUse.get(e.item) ?? 0) + w);
      appRecent.set(e.item, Math.max(appRecent.get(e.item) ?? 0, e.at));
    }
  }
  const norm = (m: Map<string, number>) => Math.max(1e-6, ...m.values());
  const aMax = norm(asmUse), pMax = norm(appUse);
  for (const [id, v] of asmUse) {
    const n = L.byItem.get(id)?.filter((e) => e.assembly === asm!.id && e.action !== 'download').length ?? 0;
    add(id, { kind: 'assembly-use', text: n > 2 ? `Used ${n}× with this Assembly` : 'Used with this Assembly', score: 120 * Math.sqrt(v / aMax), explicit: false });
  }
  for (const [id, v] of appUse) {
    const rec = L.now - (appRecent.get(id) ?? 0) < 2 * DAY;
    const verb = app === 'code' || app === 'notes' || app === 'writer' ? 'edited' : 'opened';
    add(id, {
      kind: 'app-use',
      text: rec ? `Recently ${verb} in ${appName}` : `Frequently ${verb} in ${appName}`,
      score: 70 * Math.sqrt(v / pMax), explicit: false,
    });
  }

  // 4. Seeds for inferred signals: the strongest explicit/used items.
  const seeds = [...scores.entries()]
    .map(([id, rs]) => ({ id, s: rs.reduce((a, r) => a + r.score, 0) }))
    .filter((x) => L.items.has(x.id))
    .sort((a, b) => b.s - a.s).slice(0, 8).map((x) => x.id);

  // References / revisions with seed items.
  for (const sid of seeds) {
    for (const r of L.relOf.get(sid) ?? []) {
      if (r.kind === 'topic') continue;
      const other = r.from === sid ? r.to : r.from;
      const name = L.items.get(sid)!.name;
      const text = r.kind === 'references' ? (r.from === sid ? `Referenced by ${name}` : `References ${name}`) : r.kind === 'revision' ? `Revision of ${name}` : `Derived from ${name}`;
      add(other, { kind: 'references', text, score: 45, explicit: r.explicit });
    }
    // Commonly opened together.
    const tg = L.together.get(sid);
    if (tg) for (const [other, n] of tg) if (n >= 2) add(other, { kind: 'together', text: `Often opened with ${L.items.get(sid)!.name}`, score: Math.min(35, n * 5), explicit: false });
  }

  // Topic profile of the context: tags of seed items.
  const profile = new Map<string, number>();
  for (const sid of seeds) for (const t of [...L.personalTags(sid), ...L.suggestedTags(sid).map((x) => x.id)]) profile.set(t, (profile.get(t) ?? 0) + 1);
  if (profile.size) {
    const top = [...profile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    for (const it of L.all) {
      if (it.id.startsWith('f_stress')) continue;
      const its = new Set([...it.tags, ...it.aiTags]);
      const hit = top.filter(([t]) => its.has(t));
      if (!hit.length) continue;
      const sc = Math.min(30, hit.reduce((a, [, n]) => a + n * 4, 0));
      add(it.id, { kind: 'topic', text: `Related by topic: ${L.tags.get(hit[0][0])?.label}`, score: sc, explicit: false });
    }
  }

  // Weak compatibility signal.
  if (app) {
    const opens = new Set(LIB_APPS[app].opens);
    for (const id of scores.keys()) {
      const it = L.items.get(id);
      if (it && opens.has(it.kind)) add(id, { kind: 'compatible', text: `Opens in ${LIB_APPS[app].name}`, score: 6, explicit: false });
    }
  }

  for (const p of pins) add(p, { kind: 'pinned', text: 'Pinned here', score: 1000, explicit: true });

  const dis = new Set(dismissed);
  const all: Suggestion[] = [...scores.entries()]
    .filter(([id]) => !dis.has(id))
    .map(([id, reasons]) => {
      const rs = [...reasons].sort((a, b) => b.score - a.score);
      return {
        id, type: id.startsWith('c_') ? 'collection' as const : 'item' as const,
        score: rs.reduce((a, r) => a + r.score, 0) + (L.lastOpened.get(id) ? decay(L.now - L.lastOpened.get(id)!, 3 * DAY) * 5 : 0),
        reasons: rs.filter((r, i) => rs.findIndex((x) => x.text === r.text) === i), pinned: pins.includes(id),
      };
    })
    .filter((s) => s.score >= 12)
    .sort((a, b) => b.score - a.score);

  // Dynamic collection: what this context is "about" right now.
  let dynamic: DynamicView | null = null;
  const label = asm?.name ?? (app ? LIB_APPS[app].name : null);
  if (label) {
    const members = all.filter((s) => s.type === 'item' && !s.pinned).slice(0, 40).map((s) => s.id);
    if (members.length >= 3) dynamic = { id: `dyn_${ctx.assembly ?? app}`, name: `Related to ${label}`, items: members, rule: asm ? `Usage, attachments and topics of the ${asm.name} Assembly` : `Files ${LIB_APPS[app as AppId].noun} opens and their topics` };
  }
  return { suggestions: all, dynamic };
}
