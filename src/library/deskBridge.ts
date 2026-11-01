import type { EditorState, NotesState } from '../apps/meta';
import { findFreeSpot } from '../engine/engine';
import { inferName, useDesktop } from '../model/store';
import type { AppKind } from '../model/types';
import { setDeskOpener } from './model/actions';
import { libraryNow } from './model/library';
import { contentText, useLibStore } from './model/store';
import type { AppId } from './model/types';
import { setDeskPresent } from './ui/Shelf';

// Integration points between the Library and the Lodestone desk:
//   1. Context: the focused window/Assembly on the desk drives the shelf.
//   2. Opening: files that a desk app can show open as real windows.
// The desk's own model is untouched apart from adding windows.

const APP_MAP: Partial<Record<AppKind, AppId>> = {
  editor: 'code', terminal: 'terminal', browser: 'browser', notes: 'notes', messages: 'messages', music: 'player',
};

/** Map a desk assembly to a library assembly: same id, or a matching inferred/user name. */
function mapAssembly(deskAsmId: string): string | null {
  const L = libraryNow();
  if (L.asm.has(deskAsmId)) return deskAsmId;
  const d = useDesktop.getState();
  const a = d.assemblies[deskAsmId];
  if (!a) return null;
  const name = (a.name ?? inferName(d, a)).toLowerCase();
  const hit = L.assemblies.find((x) => x.name.toLowerCase() === name || x.name.toLowerCase().includes(name) || name.includes(x.name.toLowerCase()));
  return hit?.id ?? null;
}

function syncContext() {
  const lib = useLibStore.getState();
  if (lib.prefs.ctx.source !== 'desk') return;
  const d = useDesktop.getState();
  const win = d.focus.win ? d.windows[d.focus.win] : null;
  // Focusing the library itself keeps the context of what you were doing.
  if (!d.focus.obj || win?.app === 'library') return;
  const asm = d.focus.obj.startsWith('a_') ? mapAssembly(d.focus.obj) : null;
  const app = win ? APP_MAP[win.app] ?? null : null;
  const cur = lib.prefs.ctx;
  if (cur.assembly !== asm || cur.app !== app) lib.setCtx({ assembly: asm, app });
}

export function connectDesk(): () => void {
  setDeskPresent(true);
  // On the desk, the library follows the desk by default.
  useLibStore.getState().setCtx({ source: 'desk' });
  syncContext();
  const unsub = useDesktop.subscribe((s, p) => { if (s.focus !== p.focus) syncContext(); });
  const unsubLib = useLibStore.subscribe((s, p) => { if (s.prefs.ctx.source !== p.prefs.ctx.source) syncContext(); });

  setDeskOpener((item, app) => {
    const d = useDesktop.getState();
    const text = contentText(item.content);
    const t = item.content?.t;
    if (app === 'code' && (t === 'code' || t === 'markdown' || t === 'text')) {
      // Reuse an open editor if there is one: add the file as a tab.
      const ed = Object.values(d.windows).find((w) => w.app === 'editor');
      if (ed) {
        d.updateApp<EditorState>(ed.id, (s) => {
          const i = s.files.findIndex((f) => f.name === item.name);
          if (i >= 0) return { file: i };
          return { files: [...s.files, { name: item.name, code: text, dirty: false }], file: s.files.length };
        });
        d.focusObject(ed.assemblyId ?? ed.id, ed.id);
        return true;
      }
      const id = d.addWindow('editor', findFreeSpot());
      d.updateApp<EditorState>(id, () => ({ files: [{ name: item.name, code: text, dirty: false }], file: 0 }));
      return true;
    }
    if (item.kind === 'markdown' || item.kind === 'text') {
      const id = d.addWindow('notes', findFreeSpot());
      const lines = text.split('\n');
      const title = (lines[0] ?? item.name).replace(/^#+\s*/, '') || item.name;
      d.updateApp<NotesState>(id, () => ({ title, body: lines.slice(1).join('\n').trim(), savedAt: Date.now(), dirty: false }));
      return true;
    }
    return false;
  });

  return () => { unsub(); unsubLib(); setDeskOpener(null); setDeskPresent(false); };
}

