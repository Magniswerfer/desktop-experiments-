import { usePresentation } from '../model/presentation';
import { useDesktop } from '../model/store';
import { TRACKS, type MessagesState, type MusicState, type TerminalState } from './meta';

// Local simulation so the mock apps have live state worth summarising.

const timers = new Map<string, number>();

export function runTask(winId: string, task: 'build' | 'test') {
  const st = useDesktop.getState();
  const cur = st.apps[winId] as TerminalState | undefined;
  if (!cur || cur.status === 'running') return;
  const steps =
    task === 'build'
      ? ['vite v7.3 building for production…', 'transforming src/orbit.ts', 'transforming src/physics.ts', 'rendering chunks…', 'computing gzip size…']
      : ['RUN  v3.2 ~/src/orbit', '✓ physics.test.ts (12)', '✓ orbit.test.ts (18)', '✓ render.test.ts (12)'];
  const fail = Math.random() < 0.18;
  st.updateApp<TerminalState>(winId, (s) => ({
    status: 'running', progress: 0, task,
    lines: [...s.lines, { k: 'in' as const, t: `npm run ${task}` }].slice(-200),
  }));
  let i = 0;
  const tick = () => {
    const s = useDesktop.getState().apps[winId] as TerminalState | undefined;
    if (!s) return;
    if (i < steps.length) {
      const line = steps[i++];
      useDesktop.getState().updateApp<TerminalState>(winId, (x) => ({
        progress: i / (steps.length + 1),
        lines: [...x.lines, { k: (line.startsWith('✓') ? 'ok' : 'out') as 'ok' | 'out', t: line }].slice(-200),
      }));
      timers.set(winId, window.setTimeout(tick, 520 + Math.random() * 380));
      return;
    }
    useDesktop.getState().updateApp<TerminalState>(winId, (x) => ({
      status: fail ? 'failed' : 'passed', progress: 1, lastRun: Date.now(),
      lines: [
        ...x.lines,
        fail
          ? { k: 'err' as const, t: task === 'build' ? '✗ src/orbit.ts:12 — Type "Body" is not assignable' : '✗ orbit.test.ts › keeps a stable period' }
          : { k: 'ok' as const, t: task === 'build' ? '✓ 42 modules transformed · built in 1.91s' : '✓ 42 passed (1.2s)' },
      ].slice(-200),
    }));
  };
  timers.set(winId, window.setTimeout(tick, 400));
}

const REPLIES = [
  'Oh nice. Does it feel stable when focus moves?',
  'Can you collapse the project and still see the build?',
  'Send me a screen recording later?',
  'Ha — I keep pulling windows apart just for the stretch.',
  'Agreed. The periphery should do less, not look smaller.',
];

export function sendMessage(winId: string, text: string) {
  const st = useDesktop.getState();
  st.updateApp<MessagesState>(winId, (s) => ({ thread: [...s.thread, { from: 'me' as const, text, at: Date.now() }], draft: '' }));
  window.setTimeout(() => useDesktop.getState().updateApp<MessagesState>(winId, () => ({ typing: true })), 900);
  window.setTimeout(() => incoming(winId, REPLIES[Math.floor(Math.random() * REPLIES.length)]), 2600);
}

function incoming(winId: string, text: string) {
  const st = useDesktop.getState();
  if (!st.apps[winId]) return;
  const visible = usePresentation.getState().win[winId] === 'full' && useDesktop.getState().focus.win === winId;
  st.updateApp<MessagesState>(winId, (s) => ({
    typing: false,
    thread: [...s.thread, { from: 'them' as const, text, at: Date.now() }].slice(-60),
    unread: visible ? 0 : s.unread + 1,
  }));
}

let started = false;
export function startSim() {
  if (started) return;
  started = true;
  // A build interrupted by a reload can't still be running.
  const st0 = useDesktop.getState();
  for (const id in st0.apps) {
    const a = st0.apps[id] as TerminalState;
    if (st0.windows[id]?.app === 'terminal' && a.status === 'running') st0.updateApp<TerminalState>(id, () => ({ status: 'idle', progress: 0 }));
  }
  // music clock
  window.setInterval(() => {
    const st = useDesktop.getState();
    for (const id in st.apps) {
      if (st.windows[id]?.app !== 'music') continue;
      const m = st.apps[id] as MusicState;
      if (!m.playing) continue;
      const dur = TRACKS[m.track].dur;
      st.updateApp<MusicState>(id, (s) => (s.t + 1 >= dur ? { t: 0, track: (s.track + 1) % TRACKS.length } : { t: s.t + 1 }));
    }
  }, 1000);
  // occasional unprompted messages so the periphery has something to say
  const ping = ['Running late — 10 min.', 'Saw the fused windows demo. Very good.', 'Are you around for a quick call?', 'Also: the collapsed project card is great.'];
  let n = 0;
  window.setInterval(() => {
    const st = useDesktop.getState();
    const id = Object.keys(st.windows).find((w) => st.windows[w].app === 'messages');
    if (id && n < ping.length) incoming(id, ping[n++]);
  }, 55000);
}
