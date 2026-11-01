import type { AppId, FileKind, LibItem } from './types';

// Applications known to the desktop, and which kinds they can open.
// Compatibility is deliberately a weak signal in relevance ranking.

export interface LibApp { id: AppId; name: string; noun: string; opens: FileKind[] }

export const LIB_APPS: Record<AppId, LibApp> = {
  reader: { id: 'reader', name: 'PDF Reader', noun: 'your PDF reader', opens: ['pdf'] },
  code: { id: 'code', name: 'Code editor', noun: 'your editor', opens: ['code', 'markdown', 'text', 'folder'] },
  notes: { id: 'notes', name: 'Notes', noun: 'Notes', opens: ['markdown', 'text'] },
  browser: { id: 'browser', name: 'Browser', noun: 'the browser', opens: ['pdf', 'image', 'markdown'] },
  terminal: { id: 'terminal', name: 'Terminal', noun: 'the terminal', opens: ['folder', 'code', 'archive'] },
  images: { id: 'images', name: 'Image viewer', noun: 'the image viewer', opens: ['image'] },
  writer: { id: 'writer', name: 'Documents', noun: 'Documents', opens: ['doc', 'text'] },
  sheets: { id: 'sheets', name: 'Spreadsheets', noun: 'Spreadsheets', opens: ['sheet'] },
  slides: { id: 'slides', name: 'Presentations', noun: 'Presentations', opens: ['slides'] },
  archive: { id: 'archive', name: 'Archive manager', noun: 'the archive manager', opens: ['archive'] },
  player: { id: 'player', name: 'Media player', noun: 'the media player', opens: ['audio', 'video'] },
  mail: { id: 'mail', name: 'Mail', noun: 'Mail', opens: ['pdf', 'doc', 'image'] },
  messages: { id: 'messages', name: 'Messages', noun: 'Messages', opens: ['image'] },
};

const DEFAULT_APP: Record<FileKind, AppId> = {
  folder: 'code', pdf: 'reader', markdown: 'notes', text: 'notes', code: 'code', image: 'images',
  doc: 'writer', sheet: 'sheets', slides: 'slides', archive: 'archive', audio: 'player', video: 'player',
};

export const defaultApp = (it: Pick<LibItem, 'kind' | 'provider'>): AppId =>
  it.kind === 'markdown' && it.provider === 'git-orbit' ? 'code' : DEFAULT_APP[it.kind];

export const KIND_LABEL: Record<FileKind, string> = {
  folder: 'Folder', pdf: 'PDF', markdown: 'Markdown', text: 'Text', code: 'Source', image: 'Image',
  doc: 'Document', sheet: 'Spreadsheet', slides: 'Slides', archive: 'Archive', audio: 'Audio', video: 'Video',
};
