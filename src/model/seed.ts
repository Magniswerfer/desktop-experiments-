import { APPS } from '../apps/meta';
import type { DesktopData } from './store';
import type { AppKind, WinModel } from './types';

export function seedDesktop(): DesktopData {
  const t = Date.now();
  const win = (id: string, app: AppKind, x: number, y: number, size = APPS[app].full, assemblyId: string | null = null): WinModel => ({
    id, app, size: { ...size }, anchor: { x, y }, assemblyId, createdAt: t,
  });
  const windows: Record<string, WinModel> = {
    w_notes: win('w_notes', 'notes', 0.2, 0.34),
    w_music: win('w_music', 'music', 0.16, 0.81),
    w_msgs: win('w_msgs', 'messages', 0.53, 0.84),
    w_read: win('w_read', 'browser', 0.5, 0.22),
    w_edit: win('w_edit', 'editor', 0, 0, { w: 520, h: 380 }, 'a_orbit'),
    w_term: win('w_term', 'terminal', 0, 0, { w: 520, h: 220 }, 'a_orbit'),
    w_web: win('w_web', 'browser', 0, 0, { w: 440, h: 600 }, 'a_orbit'),
  };
  const apps: DesktopData['apps'] = {};
  for (const id in windows) apps[id] = APPS[windows[id].app].initial();
  apps.w_web = { page: 2, history: [], fwd: [] };
  apps.w_read = { page: 0, history: [], fwd: [] };
  return {
    windows,
    assemblies: {
      a_orbit: {
        id: 'a_orbit', name: null, ink: 'teal',
        layout: { w_edit: { x: 0, y: 0 }, w_term: { x: 0, y: 380 }, w_web: { x: 520, y: 0 } },
        anchor: { x: 0.77, y: 0.5 }, collapsed: false, createdAt: t,
      },
    },
    apps,
    focus: { obj: 'w_notes', win: 'w_notes', point: { x: 0.2, y: 0.34 } },
    stack: ['a_orbit', 'w_read', 'w_msgs', 'w_music', 'w_notes'],
    inkCursor: 1,
    relations: [],
  };
}
