import type { AppKind, Size } from '../model/types';

// ─── App state shapes ────────────────────────────────────────────────────────

export interface Track { title: string; artist: string; album: string; dur: number; pattern: 'rings' | 'stripes' | 'grid' | 'dots' | 'arcs' }
export const TRACKS: Track[] = [
  { title: 'Slow Magnet', artist: 'Halden Quartet', album: 'Ferrous', dur: 252, pattern: 'rings' },
  { title: 'Periphery', artist: 'Mira Okafor', album: 'Side Vision', dur: 218, pattern: 'arcs' },
  { title: 'Field Lines', artist: 'Tessellate', album: 'Flux', dur: 301, pattern: 'stripes' },
  { title: 'Drift Assembly', artist: 'Unit Seven', album: 'Parts', dur: 235, pattern: 'grid' },
  { title: 'Low Orbit', artist: 'Saar & Venn', album: 'Apsis', dur: 267, pattern: 'dots' },
];
export interface MusicState { track: number; playing: boolean; t: number }

export type BuildStatus = 'idle' | 'running' | 'passed' | 'failed';
export interface TermLine { k: 'in' | 'out' | 'ok' | 'err' | 'dim'; t: string }
export interface TerminalState { cwd: string; lines: TermLine[]; status: BuildStatus; progress: number; lastRun: number | null; task: string }

export interface Article { domain: string; title: string; byline: string; lead: string; body: string[]; links: number[] }
export const ARTICLES: Article[] = [
  {
    domain: 'margins.press',
    title: 'Peripheral vision is an interface',
    byline: 'Ines Halvorsen · 6 min read',
    lead: 'We read the world through a narrow cone of acuity, yet we are never blind outside it. Interfaces could borrow the same arrangement.',
    body: [
      'The fovea covers about two degrees of the visual field. Everything else is low resolution, colour-poor and motion-sensitive. And yet the periphery is not wasted: it tells us where to look next.',
      'Most desktops treat every window as if it were at the centre of vision. Each one competes at full fidelity, so we hide them, stack them, or tile them until they are too small to use.',
      'A different arrangement lets objects at the edge of attention become simpler rather than smaller — a player becomes its play button, a conversation becomes a count of what is unread.',
    ],
    links: [1, 2],
  },
  {
    domain: 'tools.quarterly',
    title: 'Against the virtual desktop',
    byline: 'J. Moreau · 4 min read',
    lead: 'Workspaces promise order by hiding things. What we lose is the one thing a screen is good at: showing everything at once.',
    body: [
      'Virtual desktops convert spatial memory into a list you have to recall. Out of sight is, almost literally, out of mind.',
      'If the screen is the whole world, the system must earn space by simplifying what is not in use, never by sending it somewhere else.',
    ],
    links: [0, 2],
  },
  {
    domain: 'orbit.local',
    title: 'Orbit — build dashboard',
    byline: 'localhost:5173 · dev server',
    lead: 'Preview of the Orbit project running against the local dev server. All 42 checks green on the last run.',
    body: [
      'Orbit renders a small solar-system simulation. The preview reloads whenever the editor saves a file in src/.',
      'Open the terminal in this assembly and run build to refresh the status shown here and on the collapsed assembly.',
    ],
    links: [0, 1],
  },
];
export interface BrowserState { page: number; history: number[]; fwd: number[] }

export interface NotesState { title: string; body: string; savedAt: number; dirty: boolean }

export interface Msg { from: 'me' | 'them'; text: string; at: number }
export interface MessagesState { contact: string; thread: Msg[]; unread: number; draft: string; typing: boolean }

export interface EditorState { file: number; files: { name: string; code: string; dirty: boolean }[] }

/** The Library keeps its own persisted store; the window only remembers that it is a library. */
export interface LibraryWinState { kind: 'library' }

export type AppState = MusicState | TerminalState | BrowserState | NotesState | MessagesState | EditorState | LibraryWinState;

export type StatusKind = 'ok' | 'err' | 'run' | 'idle' | 'unread' | 'play' | 'pause' | 'edit';
export interface Summary { text: string; status: StatusKind }

export interface AppMeta {
  kind: AppKind;
  name: string;
  full: Size;
  compact: Size;
  widget: Size;
  initial: () => AppState;
  title: (s: any) => string;
  summary: (s: any) => Summary;
}

const now = () => Date.now();

const fmtAgo = (t: number | null) => {
  if (!t) return 'never';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 50) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
};
export { fmtAgo };

export const APPS: Record<AppKind, AppMeta> = {
  library: {
    kind: 'library', name: 'Library',
    full: { w: 860, h: 580 }, compact: { w: 300, h: 214 }, widget: { w: 236, h: 52 },
    initial: (): LibraryWinState => ({ kind: 'library' }),
    title: () => 'Files for your current work',
    summary: () => ({ text: 'Library', status: 'idle' }),
  },
  music: {
    kind: 'music', name: 'Music',
    full: { w: 420, h: 330 }, compact: { w: 300, h: 128 }, widget: { w: 224, h: 52 },
    initial: (): MusicState => ({ track: 0, playing: false, t: 48 }),
    title: (s: MusicState) => TRACKS[s.track].title,
    summary: (s: MusicState) => ({ text: `${TRACKS[s.track].title} — ${TRACKS[s.track].artist}`, status: s.playing ? 'play' : 'pause' }),
  },
  terminal: {
    kind: 'terminal', name: 'Terminal',
    full: { w: 520, h: 320 }, compact: { w: 320, h: 170 }, widget: { w: 210, h: 52 },
    initial: (): TerminalState => ({
      cwd: '~/src/orbit',
      lines: [
        { k: 'dim', t: 'Last login on ttys004' },
        { k: 'in', t: 'git status' },
        { k: 'out', t: 'On branch main · 2 files changed' },
        { k: 'in', t: 'npm run build' },
        { k: 'out', t: 'vite v7.3 building for production…' },
        { k: 'ok', t: '✓ 42 modules transformed · built in 1.84s' },
      ],
      status: 'passed', progress: 1, lastRun: now() - 6 * 60 * 1000, task: 'build',
    }),
    title: (s: TerminalState) => s.cwd,
    summary: (s: TerminalState) => ({
      text: s.status === 'running' ? `${s.task} running · ${Math.round(s.progress * 100)}%` : s.status === 'idle' ? 'idle' : `${s.task} ${s.status} · ${fmtAgo(s.lastRun)}`,
      status: s.status === 'running' ? 'run' : s.status === 'passed' ? 'ok' : s.status === 'failed' ? 'err' : 'idle',
    }),
  },
  browser: {
    kind: 'browser', name: 'Browser',
    full: { w: 540, h: 420 }, compact: { w: 300, h: 196 }, widget: { w: 210, h: 48 },
    initial: (): BrowserState => ({ page: 0, history: [], fwd: [] }),
    title: (s: BrowserState) => ARTICLES[s.page].title,
    summary: (s: BrowserState) => ({ text: ARTICLES[s.page].domain, status: 'idle' }),
  },
  notes: {
    kind: 'notes', name: 'Notes',
    full: { w: 420, h: 380 }, compact: { w: 264, h: 176 }, widget: { w: 196, h: 52 },
    initial: (): NotesState => ({
      title: 'Desk as a field',
      body: 'Attention moves; windows stay.\n\nThings near the lens open up. Things far away become what they are for: a button, a count, a status.\n\nTry: drag Music onto the edge of this note. Pull its title bar to separate them again.\n\nQuestions\n— Should fused windows share one scale?\n— When does a summary say too little?',
      savedAt: now() - 120000, dirty: false,
    }),
    title: (s: NotesState) => s.title || 'Untitled',
    summary: (s: NotesState) => ({ text: s.dirty ? 'edited' : `saved ${fmtAgo(s.savedAt)}`, status: s.dirty ? 'edit' : 'idle' }),
  },
  messages: {
    kind: 'messages', name: 'Messages',
    full: { w: 440, h: 380 }, compact: { w: 288, h: 150 }, widget: { w: 196, h: 52 },
    initial: (): MessagesState => ({
      contact: 'Ada Lindqvist',
      thread: [
        { from: 'them', text: 'Did the magnet thing work?', at: now() - 40 * 60000 },
        { from: 'me', text: 'Windows fuse now. Pulling them apart feels right.', at: now() - 38 * 60000 },
        { from: 'them', text: 'Send me a build when the collapsed view is in.', at: now() - 9 * 60000 },
      ],
      unread: 1, draft: '', typing: false,
    }),
    title: (s: MessagesState) => s.contact,
    summary: (s: MessagesState) => ({ text: s.unread ? `${s.unread} unread from ${s.contact.split(' ')[0]}` : s.thread[s.thread.length - 1]?.text ?? '', status: s.unread ? 'unread' : 'idle' }),
  },
  editor: {
    kind: 'editor', name: 'Editor',
    full: { w: 540, h: 400 }, compact: { w: 300, h: 180 }, widget: { w: 210, h: 52 },
    initial: (): EditorState => ({
      file: 0,
      files: [
        {
          name: 'orbit.ts', dirty: true,
          code: `import { Body, step } from './physics';\n\nexport const sun = new Body({ mass: 1.989e30 });\nexport const earth = new Body({\n  mass: 5.972e24,\n  orbit: sun,\n  radius: 1.496e11,\n});\n\nexport function tick(dt: number) {\n  // attraction falls off with distance\n  step([sun, earth], dt);\n}\n`,
        },
        { name: 'physics.ts', dirty: false, code: `export class Body {\n  constructor(public opts: BodyOpts) {}\n}\n\nexport function step(bodies: Body[], dt: number) {\n  for (const b of bodies) b.integrate(dt);\n}\n` },
        { name: 'render.ts', dirty: false, code: `export function draw(ctx: CanvasRenderingContext2D) {\n  ctx.clearRect(0, 0, w, h);\n}\n` },
      ],
    }),
    title: (s: EditorState) => s.files[s.file].name,
    summary: (s: EditorState) => {
      const d = s.files.filter((f) => f.dirty).length;
      return { text: d ? `${s.files[s.file].name} · ${d} unsaved` : s.files[s.file].name, status: d ? 'edit' : 'idle' };
    },
  },
};
