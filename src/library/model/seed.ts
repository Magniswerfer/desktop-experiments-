// ─── Deterministic sample library ─────────────────────────────────────────────
// Magnus is an interaction designer / creative technologist at a small studio.
// The library mirrors the spatial-desktop prototype's world (src/apps/meta.ts):
// the "orbit" code project, the desk note "Desk as a field", Ines Halvorsen's
// essay on peripheral vision, J. Moreau's "Against the virtual desktop", and
// Ada Lindqvist, who keeps asking for a build.
//
// Everything is derived from `now` and a fixed PRNG seed — no Math.random,
// no Date.now — so two calls with the same `now` produce identical data.

import type {
  AppId, Collection, Content, DocBlock, FileKind, ImageArt, LibAssembly, LibItem,
  PdfBlock, PdfPage, Provider, ProviderId, Relation, SeedData, Tag, UsageEvent,
} from './types';

const M = 60e3, H = 60 * M, D = 24 * H;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Small stable string hash (FNV-1a) used for art seeds. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

const ROOTS: Record<ProviderId, string> = {
  home: '/home/magnus',
  downloads: '/home/magnus/Downloads',
  nextcloud: 'nextcloud://studio',
  'git-orbit': '/home/magnus/src/orbit',
  external: '/media/magnus/FIELD',
};

const EXT_KIND: Record<string, FileKind> = {
  pdf: 'pdf', md: 'markdown', txt: 'text', bib: 'text',
  ts: 'code', json: 'code', html: 'code', js: 'code',
  png: 'image', jpg: 'image', jpeg: 'image', heic: 'image', svg: 'image',
  docx: 'doc', odt: 'doc',
  xlsx: 'sheet', ods: 'sheet', csv: 'sheet',
  pptx: 'slides', odp: 'slides',
  zip: 'archive', gz: 'archive',
  mp3: 'audio', m4a: 'audio', wav: 'audio',
  mp4: 'video', mov: 'video', webm: 'video',
};

const art = (style: ImageArt['style'], hue: number, w: number, h: number, label?: string, seed?: number): ImageArt =>
  ({ style, hue, seed: seed ?? hash(`${style}:${label ?? ''}:${hue}:${w}`) % 100000, w, h, ...(label ? { label } : {}) });

// ─── PDF layout helper ───────────────────────────────────────────────────────

interface PaperSpec {
  title: string;
  authors: string;
  abstract: string;
  sections: { h: string; p: string[]; quote?: string; table?: string[][] }[];
  figure?: { after: number; art: ImageArt; caption: string };
  refs: string[];
  /** Blocks per page after the first; tuned so key papers run 3–6 pages. */
  perPage?: number;
}

function paper(s: PaperSpec): Content {
  const body: PdfBlock[] = [];
  s.sections.forEach((sec, i) => {
    body.push({ k: 'h', text: sec.h });
    for (const p of sec.p) body.push({ k: 'p', text: p });
    if (sec.quote) body.push({ k: 'quote', text: sec.quote });
    if (sec.table) body.push({ k: 'table', rows: sec.table });
    if (s.figure && s.figure.after === i) body.push({ k: 'figure', art: s.figure.art, caption: s.figure.caption });
  });
  const per = s.perPage ?? 4;
  const pages: PdfPage[] = [{ blocks: [{ k: 'title', text: s.title }, { k: 'authors', text: s.authors }, { k: 'abstract', text: s.abstract }, ...body.splice(0, 2)] }];
  while (body.length) pages.push({ blocks: body.splice(0, per) });
  const last = pages[pages.length - 1];
  if (last.blocks.length <= 2) last.blocks.push({ k: 'refs', items: s.refs });
  else pages.push({ blocks: [{ k: 'h', text: 'References' }, { k: 'refs', items: s.refs }] });
  return { t: 'pdf', pages };
}

const pdf = (...pages: PdfBlock[][]): Content => ({ t: 'pdf', pages: pages.map((blocks) => ({ blocks })) });
const md = (text: string): Content => ({ t: 'markdown', text: text.trim() + '\n' });
const code = (lang: string, text: string): Content => ({ t: 'code', lang, text: text.trimStart() });
const doc = (...blocks: DocBlock[]): Content => ({ t: 'doc', blocks });
const image = (a: ImageArt): Content => ({ t: 'image', art: a });

// ─── orbit — source files ────────────────────────────────────────────────────

const ORBIT_TS = `
import { Body, step } from './physics';
import { AU, DAY } from './units';
import { planets } from './bodies';

export const sun = new Body({ name: 'Sun', mass: 1.989e30 });
export const earth = new Body({
  name: 'Earth',
  mass: 5.972e24,
  orbit: sun,
  radius: 1.496e11,
});

/** Everything the simulation integrates, in draw order. */
export const system: Body[] = [sun, earth, ...planets(sun)];

/** One simulated hour per physics step — see docs/decisions/0001. */
const FIXED_DT = DAY / 24;
let carry = 0;

export function tick(dt: number) {
  // attraction falls off with distance
  carry += dt;
  let guard = 0;
  while (carry >= FIXED_DT && guard++ < 240) {
    step(system, FIXED_DT);
    carry -= FIXED_DT;
  }
  // TODO(trails): sample positions here once trails.ts lands
}

export function find(name: string): Body | undefined {
  return system.find((b) => b.name === name);
}

export function distanceAU(a: Body, b: Body): number {
  return Math.hypot(a.x - b.x, a.y - b.y) / AU;
}

export function reset() {
  carry = 0;
  for (const b of system) b.reset();
}
`;

const PHYSICS_TS = `
import { G, SOFTENING } from './units';

export interface BodyOpts {
  name: string;
  mass: number;
  /** Body this one orbits; omitted for the root of the system. */
  orbit?: Body;
  /** Initial orbital radius in metres (circular orbit at t = 0). */
  radius?: number;
  /** Starting angle in radians. */
  phase?: number;
}

export class Body {
  x = 0; y = 0;
  vx = 0; vy = 0;
  ax = 0; ay = 0;

  constructor(public opts: BodyOpts) {
    this.reset();
  }

  get name() { return this.opts.name; }
  get mass() { return this.opts.mass; }

  reset() {
    const { orbit, radius = 0, phase = 0 } = this.opts;
    this.ax = this.ay = 0;
    if (!orbit || radius <= 0) { this.x = this.y = this.vx = this.vy = 0; return; }
    const v = Math.sqrt((G * orbit.mass) / radius); // circular orbital speed
    this.x = orbit.x + Math.cos(phase) * radius;
    this.y = orbit.y + Math.sin(phase) * radius;
    this.vx = orbit.vx - Math.sin(phase) * v;
    this.vy = orbit.vy + Math.cos(phase) * v;
  }

  /** Half of a velocity-Verlet kick. */
  kick(dt: number) { this.vx += this.ax * dt; this.vy += this.ay * dt; }

  integrate(dt: number) { this.x += this.vx * dt; this.y += this.vy * dt; }
}

export function accelerate(bodies: Body[]) {
  for (const b of bodies) b.ax = b.ay = 0;
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], c = bodies[j];
      const dx = c.x - a.x, dy = c.y - a.y;
      const r2 = dx * dx + dy * dy + SOFTENING;
      const inv = 1 / (Math.sqrt(r2) * r2);
      a.ax += G * c.mass * dx * inv; a.ay += G * c.mass * dy * inv;
      c.ax -= G * a.mass * dx * inv; c.ay -= G * a.mass * dy * inv;
    }
  }
}

export function step(bodies: Body[], dt: number) {
  for (const b of bodies) b.kick(dt / 2);
  for (const b of bodies) b.integrate(dt);
  accelerate(bodies);
  for (const b of bodies) b.kick(dt / 2);
}

export function energy(bodies: Body[]): number {
  let e = 0;
  for (const b of bodies) e += 0.5 * b.mass * (b.vx * b.vx + b.vy * b.vy);
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++)
      e -= (G * bodies[i].mass * bodies[j].mass) / Math.hypot(bodies[j].x - bodies[i].x, bodies[j].y - bodies[i].y);
  return e;
}
`;

const RENDER_TS = `
import type { Body } from './physics';
import type { Camera } from './camera';
import { AU } from './units';

const COLORS: Record<string, string> = {
  Sun: '#ffcf5c', Mercury: '#a7a39b', Venus: '#e8c58a',
  Earth: '#5aa6ff', Mars: '#d9653b', Moon: '#cfd3da',
};

export function draw(ctx: CanvasRenderingContext2D, bodies: Body[], cam: Camera) {
  const { width: w, height: h } = ctx.canvas;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0b0d12';
  ctx.fillRect(0, 0, w, h);

  const scale = Math.min(w, h) / 2 / (cam.extentAU * AU);
  const sx = (x: number) => w / 2 + (x - cam.x) * scale;
  const sy = (y: number) => h / 2 + (y - cam.y) * scale;

  // faint orbit guides first, so bodies always sit on top
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  for (const b of bodies) {
    const p = b.opts.orbit;
    if (!p || !b.opts.radius) continue;
    ctx.beginPath();
    ctx.arc(sx(p.x), sy(p.y), b.opts.radius * scale, 0, Math.PI * 2);
    ctx.stroke();
  }

  for (const b of bodies) {
    const r = b.name === 'Sun' ? 9 : Math.max(2, Math.log10(b.mass) - 21);
    ctx.fillStyle = COLORS[b.name] ?? '#ffffff';
    ctx.beginPath();
    ctx.arc(sx(b.x), sy(b.y), r, 0, Math.PI * 2);
    ctx.fill();
    if (cam.labels) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '11px Inter, system-ui, sans-serif';
      ctx.fillText(b.name, sx(b.x) + r + 4, sy(b.y) + 4);
    }
  }
}
`;

const MAIN_TS = `
import { tick, system, reset } from './orbit';
import { draw } from './render';
import { createCamera } from './camera';
import { DAY } from './units';

const canvas = document.querySelector<HTMLCanvasElement>('#sky')!;
const ctx = canvas.getContext('2d')!;
const cam = createCamera({ extentAU: 1.8, labels: true });

/** Simulated seconds per real second: 20 days a second by default. */
let speed = 20 * DAY;
let last = performance.now();
let paused = false;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
}

function frame(t: number) {
  const dt = Math.min(0.1, (t - last) / 1000);
  last = t;
  if (!paused) tick(dt * speed);
  draw(ctx, system, cam);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
window.addEventListener('keydown', (e) => {
  if (e.key === ' ') paused = !paused;
  if (e.key === 'r') reset();
  if (e.key === '+') speed *= 2;
  if (e.key === '-') speed /= 2;
  if (e.key === 'l') cam.labels = !cam.labels;
});
canvas.addEventListener('wheel', (e) => {
  cam.extentAU *= e.deltaY > 0 ? 1.1 : 1 / 1.1;
}, { passive: true });

resize();
requestAnimationFrame(frame);
`;

const UNITS_TS = `
/** Gravitational constant, m^3 kg^-1 s^-2. */
export const G = 6.674e-11;

/** Astronomical unit in metres. */
export const AU = 1.496e11;

export const DAY = 86_400;
export const YEAR = 365.25 * DAY;

/**
 * Softening term (m^2) added to r^2 so close encounters don't explode.
 * Small compared to any orbit we draw; see docs/decisions/0004.
 */
export const SOFTENING = 1e14;
`;

const CAMERA_TS = `
export interface Camera {
  x: number;
  y: number;
  /** Half the shorter canvas side, in AU. */
  extentAU: number;
  labels: boolean;
  follow?: string;
}

export function createCamera(init: Partial<Camera> = {}): Camera {
  return { x: 0, y: 0, extentAU: 2, labels: false, ...init };
}

export function zoomTo(cam: Camera, extentAU: number, k = 0.15) {
  cam.extentAU += (extentAU - cam.extentAU) * k;
}
`;

const TRAILS_TS = `
// Work in progress — Ada asked for trails so the perihelion jitter is visible.
import type { Body } from './physics';

const MAX_POINTS = 360;

export class Trails {
  private pts = new Map<string, Float64Array>();
  private head = 0;
  private count = 0;

  sample(bodies: Body[]) {
    for (const b of bodies) {
      let buf = this.pts.get(b.name);
      if (!buf) { buf = new Float64Array(MAX_POINTS * 2); this.pts.set(b.name, buf); }
      buf[this.head * 2] = b.x;
      buf[this.head * 2 + 1] = b.y;
    }
    this.head = (this.head + 1) % MAX_POINTS;
    this.count = Math.min(this.count + 1, MAX_POINTS);
  }

  // TODO: draw as a fading polyline, oldest point most transparent
  points(name: string): number[] {
    const buf = this.pts.get(name);
    if (!buf) return [];
    const out: number[] = [];
    for (let i = 0; i < this.count; i++) {
      const k = (this.head - this.count + i + MAX_POINTS) % MAX_POINTS;
      out.push(buf[k * 2], buf[k * 2 + 1]);
    }
    return out;
  }
}
`;

const BODIES_INDEX_TS = `
import type { Body } from '../physics';
import { inner } from './planets';
import { moonOf } from './moons';
import { halley } from './comets';

export function planets(sun: Body): Body[] {
  const ps = inner(sun);
  const earth = ps.find((p) => p.name === 'Earth');
  return [...ps.filter((p) => p.name !== 'Earth'), ...(earth ? [moonOf(earth)] : []), halley(sun)];
}

export { inner, moonOf, halley };
`;

const PLANETS_TS = `
import { Body } from '../physics';
import { AU } from '../units';

/** Semi-major axes (AU) and masses (kg) for the inner planets. Circular for now. */
const INNER = [
  { name: 'Mercury', a: 0.387, mass: 3.301e23, phase: 1.2 },
  { name: 'Venus', a: 0.723, mass: 4.867e24, phase: 4.1 },
  { name: 'Earth', a: 1.0, mass: 5.972e24, phase: 0 },
  { name: 'Mars', a: 1.524, mass: 6.417e23, phase: 2.6 },
];

export function inner(sun: Body): Body[] {
  return INNER.map((p) => new Body({ name: p.name, mass: p.mass, orbit: sun, radius: p.a * AU, phase: p.phase }));
}
`;

const MOONS_TS = `
import { Body } from '../physics';

export function moonOf(earth: Body): Body {
  return new Body({ name: 'Moon', mass: 7.342e22, orbit: earth, radius: 3.844e8, phase: 0.5 });
}
`;

const COMETS_TS = `
import { Body } from '../physics';
import { AU } from '../units';

// Not a real ellipse yet: placed at aphelion with a reduced tangential speed.
export function halley(sun: Body): Body {
  const c = new Body({ name: 'Halley', mass: 2.2e14, orbit: sun, radius: 4.2 * AU, phase: 3.6 });
  c.vx *= 0.42;
  c.vy *= 0.42;
  return c;
}
`;

const PHYSICS_TEST_TS = `
import { describe, it, expect } from 'vitest';
import { Body, step, energy } from '../src/physics';
import { AU, DAY, YEAR } from '../src/units';

describe('physics', () => {
  it('keeps a circular orbit circular over one year', () => {
    const sun = new Body({ name: 'Sun', mass: 1.989e30 });
    const earth = new Body({ name: 'Earth', mass: 5.972e24, orbit: sun, radius: AU });
    for (let t = 0; t < YEAR; t += DAY / 24) step([sun, earth], DAY / 24);
    const r = Math.hypot(earth.x - sun.x, earth.y - sun.y);
    expect(Math.abs(r - AU) / AU).toBeLessThan(1e-3);
  });

  it('conserves energy to within 0.1% (velocity Verlet)', () => {
    const sun = new Body({ name: 'Sun', mass: 1.989e30 });
    const earth = new Body({ name: 'Earth', mass: 5.972e24, orbit: sun, radius: AU });
    const e0 = energy([sun, earth]);
    for (let i = 0; i < 24 * 365; i++) step([sun, earth], DAY / 24);
    expect(Math.abs((energy([sun, earth]) - e0) / e0)).toBeLessThan(1e-3);
  });
});
`;

const ORBIT_TEST_TS = `
import { describe, it, expect, beforeEach } from 'vitest';
import { tick, find, distanceAU, reset, sun } from '../src/orbit';
import { DAY } from '../src/units';

describe('orbit', () => {
  beforeEach(() => reset());

  it('starts Earth at 1 AU', () => {
    expect(distanceAU(sun, find('Earth')!)).toBeCloseTo(1, 3);
  });

  it('does not step when dt is below the fixed step', () => {
    const e = find('Earth')!;
    const x = e.x;
    tick(DAY / 48);
    expect(e.x).toBe(x);
  });
});
`;

const RENDER_TEST_TS = `
import { describe, it, expect } from 'vitest';
import { createCamera, zoomTo } from '../src/camera';

describe('camera', () => {
  it('eases towards the target extent', () => {
    const cam = createCamera({ extentAU: 2 });
    zoomTo(cam, 1);
    expect(cam.extentAU).toBeLessThan(2);
    expect(cam.extentAU).toBeGreaterThan(1);
  });
});
`;

const PACKAGE_JSON = `
{
  "name": "orbit",
  "version": "0.4.0",
  "private": true,
  "type": "module",
  "description": "A small solar-system toy: n-body physics on a 2D canvas.",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "preview": "vite preview"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vite": "^7.3.0",
    "vitest": "^3.2.4"
  }
}
`;

const TSCONFIG_JSON = `
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noUncheckedIndexedAccess": false,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "tests"]
}
`;

const VITE_CONFIG_TS = `
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, open: false },
  build: { target: 'es2022', sourcemap: true },
});
`;

const INDEX_HTML = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>orbit</title>
    <style>
      html, body { margin: 0; height: 100%; background: #0b0d12; }
      #sky { width: 100%; height: 100%; display: block; }
      #hint { position: fixed; left: 12px; bottom: 10px; color: #6b7280; font: 12px Inter, system-ui, sans-serif; }
    </style>
  </head>
  <body>
    <canvas id="sky"></canvas>
    <div id="hint">space pause · r reset · +/- speed · l labels · scroll zoom</div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`;

const README_MD = `
# orbit

A small solar-system toy. Real masses, real distances, velocity-Verlet
integration, drawn on a plain 2D canvas. It exists mostly so I have something
alive to put on the desk while testing the spatial-desktop prototype.

![inner planets](docs/screenshot.png)

## Running

    npm install
    npm run dev      # http://localhost:5173
    npm test         # vitest, 6 checks
    npm run build    # type-check + production bundle

Keys: **space** pause · **r** reset · **+ / -** speed · **l** labels · scroll to zoom.

## Layout

| path | what |
| --- | --- |
| src/orbit.ts | the system, fixed-step tick loop |
| src/physics.ts | Body, accelerations, Verlet step, energy |
| src/render.ts | canvas drawing |
| src/bodies/ | planets, the Moon, a not-quite-Halley comet |
| docs/ | architecture notes and decision records |

See docs/architecture.md before changing the tick loop.

## Known issues

- Mercury's perihelion jitters at high speed settings (Ada spotted it; trails
  will make it visible — see src/trails.ts, not committed yet).
- The comet is placed by hand, not from orbital elements.
`;

const CHANGELOG_MD = `
# Changelog

## 0.4.0 — unreleased
- Fixed-step accumulator in orbit.tick (no more speed-dependent drift)
- Energy check in tests
- Camera module with eased zoom

## 0.3.0
- Switched integrator from semi-implicit Euler to velocity Verlet (ADR 0004)
- Added the Moon and a comet
- Labels toggle

## 0.2.0
- Inner planets with real masses and semi-major axes
- Orbit guides

## 0.1.0
- Sun and Earth, Euler integration, canvas renderer
`;

const ARCHITECTURE_MD = `
# Architecture

orbit is three modules and a loop. Keep it that way.

## Data flow

    main.ts ──frame(t)──▶ orbit.tick(dt·speed) ──▶ physics.step(system, FIXED_DT)
       │
       └──────────────▶ render.draw(ctx, system, camera)

- **src/orbit.ts** owns the list of bodies (\`system\`) and the fixed-step
  accumulator. Real frame time is multiplied by \`speed\`, accumulated in
  \`carry\`, and consumed in steps of one simulated hour (ADR 0001).
- **src/physics.ts** knows nothing about time scales or drawing. \`step\`
  is a kick–drift–kick velocity-Verlet step over all pairs (O(n²), fine for
  fewer than ~50 bodies).
- **src/render.ts** reads positions and never writes them. Camera state lives in
  **src/camera.ts**; render only reads it.

## Units

Everything inside the simulation is SI: metres, kilograms, seconds (ADR 0003).
AU only appears at the edges — body definitions in src/bodies/ and the camera.

## Rules of thumb

1. Physics must stay deterministic for a given dt sequence; tests depend on it.
2. Nothing in render.ts may allocate per body per frame.
3. New visual features (trails, labels) sample state in orbit.tick and draw in
   render.ts — never the other way around.

## Open questions

- Elliptical orbits from orbital elements instead of hand-placed bodies.
- Do trails belong in render or in their own module? (trails.ts, draft)
`;

const ROADMAP_MD = `
# Roadmap

- [x] Inner planets
- [x] Velocity Verlet
- [ ] Trails (in progress — src/trails.ts)
- [ ] Orbital elements → initial state
- [ ] Outer planets with a log-scale camera
- [ ] Collapsed "widget" view for the desk: just the Earth's angle as a dial
- [ ] Export a 10 s loop as webm for the talk
`;

const ADR = (n: string, title: string, status: string, context: string, decision: string, consequences: string) => `
# ${n}. ${title}

Status: ${status}

## Context

${context}

## Decision

${decision}

## Consequences

${consequences}
`;

const ADR_0001 = ADR('0001', 'Fixed physics timestep', 'accepted',
  'Frame times vary between 6 ms and 40 ms depending on what else is on the desk. Stepping physics with the raw frame delta made orbits speed-dependent: at 64x speed Mercury slowly spiralled outwards.',
  'orbit.tick accumulates simulated time and advances physics in fixed steps of one simulated hour. At most 240 steps run per frame; the remainder carries over.',
  'Results are reproducible for a given speed. Very high speeds drop simulated time instead of exploding. Rendering may show positions up to one step old, which is invisible at this scale.');
const ADR_0002 = ADR('0002', 'Canvas 2D over WebGL', 'accepted',
  'We draw fewer than fifty circles and some arcs. WebGL would add a build step for shaders and a lot of code for text labels.',
  'Use CanvasRenderingContext2D. Revisit if we ever draw more than a few thousand particles (e.g. an asteroid belt).',
  'Labels are trivial. Trails will be polylines; if they get slow we can cache them in an OffscreenCanvas.');
const ADR_0003 = ADR('0003', 'SI units internally', 'accepted',
  'Mixing AU, km and m caused the v0.1 Moon to orbit at the wrong distance by a factor of 1000.',
  'All simulation state is SI. Conversions happen only in src/bodies/ (input) and the camera (output).',
  'Numbers are large (1e11) but well inside float64 precision for positions; velocities and accelerations stay well conditioned.');
const ADR_0004 = ADR('0004', 'Velocity Verlet integration', 'accepted',
  'Semi-implicit Euler drifted visibly in total energy over a few simulated years, and the energy test failed at 1% tolerance.',
  'Use kick–drift–kick velocity Verlet with a small softening term (units.SOFTENING) to avoid singularities in close passes.',
  'One extra acceleration pass per step. Energy error stays below 0.1% over a simulated year in tests/physics.test.ts.');

// ─── Research papers ─────────────────────────────────────────────────────────
// Real classics are summarised faithfully (paraphrased, not quoted). The
// recent preprints (Halvorsen, Okonkwo, Tanaka, Mehta) are fictional.

const P_MALONE = paper({
  title: 'How Do People Organize Their Desks? Implications for the Design of Office Information Systems',
  authors: 'Thomas W. Malone · Xerox Palo Alto Research Center · ACM Transactions on Office Information Systems 1(1), 1983, 99–112',
  abstract: 'This paper reports a series of interviews about how professional and clerical office workers organise the paper information in their desks and offices. Two observations are emphasised: an important function of desk organisation is to remind people of things they need to do, not only to help them find information; and classifying information is often hard, which is one reason people keep untitled piles instead of titled files. Implications for computer-based office systems are discussed.',
  sections: [
    { h: '1. Introduction', p: [
      'Designers of electronic office systems often assume that the main problem is retrieval: given a document someone wants, how can the system help them find it? Watching how people actually use their desks suggests that this is only half of the picture.',
      'This study set out to describe, in a qualitative way, how people arrange the information around them, and what those arrangements are for.'] },
    { h: '2. Method', p: [
      'Ten people in two organisations — a research laboratory and a manufacturing firm — were interviewed in their own offices. Each interview began with a "tour" in which the participant explained what was on and in the desk, the shelves and the filing cabinets, and why it was there.',
      'The participants ranged from secretaries to managers and scientists. The interviews were recorded and later analysed for recurring patterns.'] },
    { h: '3. Files and piles', p: [
      'Two broad units of organisation appeared repeatedly. Files are collections whose elements are explicitly titled and often arranged in a systematic order. Piles are collections whose elements are not titled and not arranged in any particular order.',
      'Some people described themselves as "neat" and relied mostly on files; others were "messy" and relied on piles. But almost everyone used both, and piles were not simply a failure of discipline.'],
      quote: 'Piles are not necessarily a sign of disorganisation; they can be a deliberate way of postponing a decision that is hard to make.' },
    { h: '4. Finding', p: [
      'People found things in piles by remembering roughly where they had put them and what the pile looked like. This works surprisingly well for recent and frequently used material and degrades as piles grow or age.',
      'Files make retrieval possible without remembering location, but only if the person can predict the category under which an item was filed.'] },
    { h: '5. Reminding', p: [
      'Many items were left in view precisely so that they would be seen again. A paper on the corner of the desk is a note to self: something needs to happen. Moving it into a drawer removes the cue.',
      'Several participants were explicit that visible clutter served this purpose, and that an empty desk would make them forget work.'] },
    { h: '6. Implications for design', p: [
      'Electronic systems should not force immediate classification. They should allow untitled, spatially arranged collections — piles — and should help users defer the decision of where something belongs.',
      'Systems should support reminding as a first-class function, for example by keeping relevant items visible in the context where they will be needed, and could help with classification automatically rather than demanding it up front.'] },
  ],
  figure: { after: 2, art: art('sketch', 32, 1600, 1100, 'desk: files and piles'), caption: 'Figure 1. Schematic of a participant’s desk: titled files in the drawer and on the shelf, untitled piles on the work surface.' },
  refs: [
    'Card, S. K., Moran, T. P., and Newell, A. The Psychology of Human-Computer Interaction. Erlbaum, 1983.',
    'Smith, D. C., Irby, C., Kimball, R., Verplank, W., and Harslem, E. Designing the Star user interface. Byte 7, 4 (1982).',
    'Rosch, E. Principles of categorization. In Cognition and Categorization, Rosch and Lloyd, Eds. Erlbaum, 1978.',
  ],
});

const P_LIFESTREAMS = paper({
  title: 'Lifestreams: An Alternative to the Desktop Metaphor',
  authors: 'Scott Fertig, Eric Freeman, David Gelernter · Yale University · CHI ’96 Conference Companion',
  abstract: 'Lifestreams replaces files, folders and the desktop with a single time-ordered stream of documents that works as a diary of a person’s electronic life. Every document created or received is added to the stream. The tail holds the past, the present holds working documents, and the future holds reminders and scheduled items. Users organise and find documents by creating substreams — persistent, filtered views defined by queries — and can ask the system to summarise a substream.',
  sections: [
    { h: 'The problem with the desktop', p: [
      'Desktop systems ask users to name every file, choose a place for it, and remember both. They provide little support for archiving or for reminding, and the metaphor of a physical desk breaks down as soon as collections grow beyond what fits on one screen.'] },
    { h: 'The stream', p: [
      'A lifestream is ordered by time. New documents — whether a note just written or a message just received — enter at the head. Nothing has to be named or filed. Because the stream extends into the future, a document can be placed at a future time to act as a reminder; it surfaces when that time arrives.'] },
    { h: 'Substreams and summaries', p: [
      'Organisation happens through substreams: the user describes what they want ("all documents mentioning the budget") and gets a stream containing only those documents. Substreams are dynamic and persistent, so new matching documents appear in them automatically. They overlap freely, unlike directories.',
      'A summarise operation compresses a substream into an overview, for example a table of figures pulled from expense reports.'] },
    { h: 'Interface', p: [
      'The prototype shows the stream as a receding cascade of document representations, with the most recent nearest the viewer. Moving a slider travels back through time; glancing at a document shows a preview without opening it.'] },
    { h: 'Discussion', p: [
      'Time is a natural, universal key that every document already has. Combined with content-based substreams, it can stand in for most uses of folders while keeping the reminding function that a physical desk provides.'] },
  ],
  figure: { after: 3, art: art('diagram', 210, 1400, 900, 'past · now · future'), caption: 'Figure 1. The stream: past documents recede, the present is in front, future reminders wait at the head.' },
  refs: [
    'Gelernter, D. The cyber-road not taken. The Washington Post, April 1994.',
    'Malone, T. W. How do people organize their desks? ACM TOOIS 1, 1 (1983), 99–112.',
    'Barreau, D. and Nardi, B. A. Finding and reminding: file organization from the desktop. SIGCHI Bulletin 27, 3 (1995).',
  ],
});

const P_DATAMOUNTAIN = paper({
  title: 'Data Mountain: Using Spatial Memory for Document Management',
  authors: 'George Robertson, Mary Czerwinski, Kevin Larson, Daniel C. Robbins, David Thiel, Maarten van Dantzich · Microsoft Research · UIST ’98',
  abstract: 'Data Mountain lets users place documents — in the study, thumbnails of web pages — at arbitrary positions on an inclined plane in a 3D desktop environment, using ordinary 2D mouse interaction. A user study compared it with the Internet Explorer 4 Favorites mechanism for storing and retrieving 100 web pages. Retrieval with Data Mountain was faster and produced fewer incorrect or failed retrievals, suggesting that spatial memory can be exploited for document management.',
  sections: [
    { h: '1. Introduction', p: [
      'Bookmarks and favorites lists grow until they are hard to use. Earlier work suggested that people remember where they put things, and that location can be an effective retrieval cue — though not always better than names.',
      'Data Mountain asks whether a carefully designed spatial layout, with perspective and thumbnails, makes that memory reliable enough to be useful.'] },
    { h: '2. Design', p: [
      'The mountain is a tilted plane seen in perspective: items further up the slope appear smaller and further away. Users drag thumbnails into place; the system keeps them from occluding one another by gently pushing neighbours aside.',
      'Faint landmarks painted on the surface give the space some texture without imposing categories. Hovering an item shows its title; audio cues accompany movement.'] },
    { h: '3. Study', p: [
      'Participants first stored 100 web pages using either Data Mountain or IE4 Favorites, organising them however they liked. They then retrieved pages given a cue such as a title or summary. Times and errors were recorded.'] },
    { h: '4. Results', p: [
      'Retrieval was reliably faster on Data Mountain and participants failed to find pages less often. Many participants grouped items into spatial clusters that functioned like informal categories, without having to name them.',
      'Storage took longer on Data Mountain, because placement involves a decision, but participants rated the experience favourably.'] },
    { h: '5. Discussion', p: [
      'The thumbnail and the location work together: the thumbnail confirms what the user remembers about the place. A follow-up question is how long spatial memory for a layout lasts when it is not used.'] },
  ],
  figure: { after: 1, art: art('diagram', 160, 1600, 1000, 'inclined plane with thumbnails'), caption: 'Figure 2. Data Mountain with about 100 page thumbnails arranged by one participant into loose clusters.' },
  refs: [
    'Jones, W. P. and Dumais, S. T. The spatial metaphor for user interfaces: experimental tests of reference by location versus name. ACM TOIS 4, 1 (1986).',
    'Card, S. K., Robertson, G. G., and York, W. The WebBook and the Web Forager. CHI ’96.',
    'Malone, T. W. How do people organize their desks? ACM TOOIS 1, 1 (1983).',
  ],
});

const P_BARREAU = paper({
  title: 'Finding and Reminding: File Organization from the Desktop',
  authors: 'Deborah Barreau, Bonnie A. Nardi · SIGCHI Bulletin 27(3), 1995',
  abstract: 'Two independent studies of how people organise and find files on personal computers reached similar conclusions. People strongly prefer to locate files by browsing to where they put them rather than by searching. They place files deliberately, including on the desktop itself, as reminders of work to be done. And they distinguish between ephemeral, working and archived information, but archive very little.',
  sections: [
    { h: 'Three kinds of information', p: [
      'Ephemeral information has a short shelf life — a note, a draft, a message to answer. Working information is used frequently for current projects. Archived information is kept for the long term but rarely consulted. Most effort goes into the first two.'] },
    { h: 'Location-based finding', p: [
      'Participants navigated folder hierarchies and scanned the desktop rather than using search tools, even when search was available. The act of placing a file is itself an act of remembering.'] },
    { h: 'Reminding', p: [
      'Files left on the desktop or at the top of a folder served the same function as papers left on a physical desk: they were cues to act. Systems that hide or auto-sort files remove those cues.'] },
  ],
  refs: [
    'Malone, T. W. How do people organize their desks? ACM TOOIS 1, 1 (1983).',
    'Jones, W. P. and Dumais, S. T. The spatial metaphor for user interfaces: experimental tests of reference by location versus name. ACM TOIS 4, 1 (1986).',
  ],
  perPage: 5,
});

const P_CZERWINSKI = paper({
  title: 'A Diary Study of Task Switching and Interruptions',
  authors: 'Mary Czerwinski, Eric Horvitz, Susan Wilhite · Microsoft Research · CHI 2004',
  abstract: 'A week-long diary study followed information workers as they switched between tasks and were interrupted. Participants switched frequently, and returning to an interrupted task was reported as notably harder than moving to a new one. Long, complex tasks were more likely to be interrupted and more difficult to resume. The findings motivate tools that help people reinstate the context of a suspended task.',
  sections: [
    { h: 'Method', p: [
      'Participants kept a structured diary for a week, logging each task they worked on, what caused them to switch, and how hard it was to come back.'] },
    { h: 'Findings', p: [
      'Work was highly fragmented. Self-interruptions were common, not only external ones. Returning to complex tasks required recalling which documents, windows and intermediate results were involved.'] },
    { h: 'Design implications', p: [
      'Software could capture the set of documents and applications associated with a task and restore them together, and could show reminders of suspended tasks without demanding immediate attention.'] },
  ],
  refs: [
    'Cutrell, E., Czerwinski, M., and Horvitz, E. Notification, disruption, and memory: effects of messaging interruptions on memory and performance. INTERACT 2001.',
    'Gonzalez, V. M. and Mark, G. "Constant, constant, multi-tasking craziness": managing multiple working spheres. CHI 2004.',
  ],
  perPage: 5,
});

const P_LEROY = paper({
  title: 'Why Is It So Hard to Do My Work? The Challenge of Attention Residue When Switching Between Work Tasks',
  authors: 'Sophie Leroy · Organizational Behavior and Human Decision Processes 109(2), 2009, 168–181',
  abstract: 'When people switch from one task to another, part of their attention can remain with the previous task — attention residue. Across experiments, participants who moved on from an unfinished first task showed more residue and performed worse on the next task than those who had finished it. Finishing the first task, especially under time pressure, reduced residue and improved performance on the subsequent task.',
  sections: [
    { h: '1. Introduction', p: [
      'Knowledge workers juggle many projects and switch between them many times a day. Research on multitasking has mostly studied rapid switching between simple tasks; less is known about switching between substantive work tasks.',
      'The paper proposes that thoughts about a prior task persist after a switch, and that this persistence depends on whether the prior task reached closure.'] },
    { h: '2. Attention residue', p: [
      'Attention residue is measured as the accessibility of words related to the prior task, using a lexical decision task immediately after switching. More residue means those words are recognised faster.'],
      quote: 'People need to stop thinking about one task in order to fully transition their attention and perform well on another.' },
    { h: '3. Study 1', p: [
      'Participants worked on a word puzzle and were either allowed or not allowed to finish before being moved to a second task: evaluating candidates’ résumés. Those who did not finish showed higher residue and evaluated less accurately.'] },
    { h: '4. Study 2', p: [
      'The second study manipulated time pressure on the first task. Completing it under high time pressure produced the lowest residue, which the paper interprets as people reaching closure more quickly and decisively when time is short.'] },
    { h: '5. General discussion', p: [
      'Interrupting work before it is finished has a cost that persists into the next task. Organisations, and the tools people use, could reduce this cost by helping people reach a natural stopping point, or by externalising what was left unfinished so it does not have to be held in mind.'] },
  ],
  figure: { after: 3, art: art('chart', 4, 1400, 900, 'residue by condition'), caption: 'Figure 1. Lexical decision response times for prior-task words by condition (lower = more residue).' },
  refs: [
    'Zeigarnik, B. On finished and unfinished tasks. In A Source Book of Gestalt Psychology, 1938.',
    'Monsell, S. Task switching. Trends in Cognitive Sciences 7, 3 (2003), 134–140.',
    'Czerwinski, M., Horvitz, E., and Wilhite, S. A diary study of task switching and interruptions. CHI 2004.',
  ],
});

const P_HALVORSEN = paper({
  title: 'Peripheral Interfaces: Designing for the Edge of Attention',
  authors: 'Ines Halvorsen, Tomas Aalto · Preprint, arXiv:2406.01937 [cs.HC], 2024',
  abstract: 'Desktop interfaces render every window at full fidelity regardless of where the user is looking, then compensate by hiding windows in stacks, tabs and virtual workspaces. We propose peripheral interfaces, in which objects simplify as they move away from the user’s current focus — a media player becomes its play button, a chat becomes its unread count — but never disappear. In a lab study (n = 18) comparing tiled windows, virtual desktops and a peripheral layout, participants resumed interrupted tasks faster in the peripheral condition and reported less effort locating material they had set aside.',
  sections: [
    { h: '1. Introduction', p: [
      'The fovea covers about two degrees of the visual field; the rest is coarse but motion-sensitive and good at telling us where to look next. Screens, by contrast, treat every object as if it were in the fovea.',
      'When everything competes at full fidelity, users hide things. Hiding converts spatial memory into recall: a list of workspaces, a stack of tabs. We ask what happens if the system simplifies instead of hiding.'] },
    { h: '2. Related work', p: [
      'Malone’s observation that piles serve reminding, Data Mountain’s use of spatial memory, and Lifestreams’ time-ordered stream all argue that location and visibility are retrieval cues. Work on glanceable displays and semantic zoom provides the mechanism: representations that change form with available space.'] },
    { h: '3. Design', p: [
      'A peripheral layout keeps all windows on one surface. A soft "lens" follows the active object; each window chooses one of three representations — full, compact, widget — from its distance to the lens. Representations are authored per application, not generated by scaling.',
      'Grouped windows can collapse into a single summary line showing what each member is for: a build status, a track title, a count of unread messages.'] },
    { h: '4. Study', p: [
      'Eighteen participants completed a writing task while being interrupted by a scheduling task and a coding fix. Each did all three conditions in counterbalanced order: tiled windows, virtual desktops, and the peripheral layout.'] },
    { h: '5. Results', p: [
      'Time to resume the writing task after an interruption was shortest in the peripheral condition. Participants in the virtual-desktop condition frequently switched to the wrong workspace first. NASA-TLX effort scores were lowest for the peripheral layout, though two participants found the simplification of distant windows distracting.'],
      table: [['Condition', 'Resumption (s, median)', 'Wrong-target switches', 'TLX effort'], ['Tiled', '14.2', '0.8', '52'], ['Virtual desktops', '17.9', '2.1', '58'], ['Peripheral', '9.6', '0.4', '41']] },
    { h: '6. Discussion', p: [
      'Simplifying at the periphery preserves the reminding function of visible clutter without the cost of full-fidelity clutter. A summary must still say enough: a widget that shows only an icon loses most of the benefit.',
      'Open questions include how fused windows should share a scale, and whether the lens should follow gaze, pointer or keyboard focus.'] },
  ],
  figure: { after: 2, art: art('diagram', 262, 1600, 1000, 'lens falloff: full · compact · widget'), caption: 'Figure 2. Representation as a function of distance from the attention lens. Windows step from full to compact to widget form.' },
  refs: [
    'Malone, T. W. How do people organize their desks? ACM TOOIS 1, 1 (1983).',
    'Robertson, G. et al. Data Mountain: using spatial memory for document management. UIST ’98.',
    'Fertig, S., Freeman, E., and Gelernter, D. Lifestreams: an alternative to the desktop metaphor. CHI ’96.',
    'Leroy, S. Why is it so hard to do my work? OBHDP 109, 2 (2009).',
    'Moreau, J. Against the virtual desktop. tools.quarterly, 2023.',
  ],
});

const P_GLANCE = paper({
  title: 'Glance Before You Open: Inline Previews Reduce Re-finding Cost in Personal File Collections',
  authors: 'Chidi Okonkwo, Réka Varga, Jonas Lind · Preprint, arXiv:2503.11427v1 [cs.HC], 2025',
  abstract: 'Re-finding a known file often involves opening several wrong candidates. We logged six weeks of file activity from 41 knowledge workers before and after enabling a space-bar preview panel in their file manager. With previews available, the number of files opened per successful re-finding episode fell from 2.3 to 1.4, and episodes were 31% shorter. Previews were used most for PDFs and images and least for spreadsheets, whose first screen rarely identified them.',
  sections: [
    { h: '1. Introduction', p: [
      'Names are a weak cue: "report (1).pdf" tells you almost nothing. Opening a file to check it costs an application launch, a window and a context switch. A preview answers the question "is this the one?" without paying that cost.'] },
    { h: '2. Method', p: [
      'A logging extension recorded opens, previews and searches. A re-finding episode began with a search or folder navigation and ended when a file was opened and kept open for at least 30 seconds.'] },
    { h: '3. Results', p: [
      'Previews replaced roughly four in ten speculative opens. The benefit was largest in Downloads folders, where names were least informative.'],
      table: [['Measure', 'Before', 'After'], ['Opens per episode', '2.3', '1.4'], ['Episode length (s)', '38', '26'], ['Episodes ending in search', '61%', '48%']] },
    { h: '4. Discussion', p: [
      'Previews should show recognisable content — a first page, a heading, the actual image — rather than a generic icon. For spreadsheets, a preview that shows the sheet’s header row and a few rows was rated more useful than the top-left cells.'] },
  ],
  figure: { after: 2, art: art('chart', 140, 1400, 860, 'opens per re-finding episode'), caption: 'Figure 1. Files opened per re-finding episode, before and after previews, by file type.' },
  refs: [
    'Barreau, D. and Nardi, B. A. Finding and reminding. SIGCHI Bulletin 27, 3 (1995).',
    'Jones, W., Bruce, H., and Dumais, S. Keeping found things found on the web. CIKM 2001.',
  ],
});

const P_CONTEXT = paper({
  title: 'Context Is a Better Folder: Suggesting Files from Co-occurrence and the Active Task',
  authors: 'Mei Tanaka, Pål Sørensen, Ana Ribeiro · Preprint, arXiv:2507.02281v2 [cs.HC], 2025',
  abstract: 'We describe a file suggestion model that ranks documents by how often they were used together with the currently open documents and applications, decayed by recency, and combined with explicit associations made by the user. In an offline replay of 9 weeks of activity from 23 participants, the correct next file appeared in the top five suggestions 64% of the time, against 41% for a recency-only baseline. Explanations of the form "opened with X in this workspace" increased trust in a follow-up survey.',
  sections: [
    { h: '1. Motivation', p: [
      'Folders encode one context per file. Real files belong to several: a brief is part of a client project, a presentation and an invoice. The workspace a person is in when they open a file is a strong, cheap signal of which context is active.'] },
    { h: '2. Model', p: [
      'Each usage event links an item to an application and an active workspace. Scores combine co-occurrence within sessions, workspace affinity, recency with a half-life of seven days, and explicit links such as attachments or references.',
      'Suggestions are always explained by the strongest contributing signal, never by an opaque score.'] },
    { h: '3. Evaluation', p: [
      'Recency alone does well at the start of a session and badly after a switch. Co-occurrence recovers after a switch within one or two opens. Explicit links matter most for rarely used files.'] },
    { h: '4. Limitations', p: [
      'Shared or synced files have noisy co-occurrence. Files that are never opened — most of the Downloads folder — get no signal and must be handled by an inbox, not by suggestions.'] },
  ],
  figure: { after: 1, art: art('diagram', 190, 1500, 900, 'item–app–workspace graph'), caption: 'Figure 1. Usage events form a tripartite graph of items, applications and workspaces.' },
  refs: [
    'Czerwinski, M., Horvitz, E., and Wilhite, S. A diary study of task switching and interruptions. CHI 2004.',
    'Fertig, S., Freeman, E., and Gelernter, D. Lifestreams. CHI ’96.',
    'Okonkwo, C., Varga, R., and Lind, J. Glance before you open. arXiv:2503.11427, 2025.',
  ],
});

const P_MEHTA = paper({
  title: 'Where Did I Put It? Spatial Memory for Files Across Devices',
  authors: 'Priya Mehta, Lorenzo Rossi · Proceedings of the Personal Information Management Workshop (PIM ’22)',
  abstract: 'People who use a laptop, a phone and cloud storage often know where a file is on one device but not on another. Interviews with 16 participants and a two-week diary study show that spatial memory is strongly device-specific: a file’s remembered location is its location on the device where it was last worked on. Sync services that mirror folder structures help less than expected because the same folder looks different on each device.',
  sections: [
    { h: 'Findings', p: [
      'Participants described files by place ("bottom left of my desktop", "in the client folder, near the top") and by time ("the one from just before the trip"). Cross-device misses were usually resolved by search, then by asking a colleague.'] },
    { h: 'Implications', p: [
      'A unified library should show a file with the same visual identity everywhere and remember where the user last saw it, rather than insisting on a single canonical path.'] },
  ],
  refs: [
    'Barreau, D. and Nardi, B. A. Finding and reminding. SIGCHI Bulletin 27, 3 (1995).',
    'Robertson, G. et al. Data Mountain. UIST ’98.',
  ],
  perPage: 5,
});

// ─── Saved web articles (browser "save as PDF") ─────────────────────────────

const W_PERIPHERAL = pdf(
  [{ k: 'title', text: 'Peripheral vision is an interface' }, { k: 'authors', text: 'Ines Halvorsen · margins.press · 6 min read' },
   { k: 'abstract', text: 'We read the world through a narrow cone of acuity, yet we are never blind outside it. Interfaces could borrow the same arrangement.' },
   { k: 'p', text: 'The fovea covers about two degrees of the visual field. Everything else is low resolution, colour-poor and motion-sensitive. And yet the periphery is not wasted: it tells us where to look next.' },
   { k: 'p', text: 'Most desktops treat every window as if it were at the centre of vision. Each one competes at full fidelity, so we hide them, stack them, or tile them until they are too small to use.' }],
  [{ k: 'p', text: 'A different arrangement lets objects at the edge of attention become simpler rather than smaller — a player becomes its play button, a conversation becomes a count of what is unread.' },
   { k: 'figure', art: art('diagram', 262, 1200, 700, 'acuity falls off from the fovea'), caption: 'Acuity drops steeply outside the central two degrees.' },
   { k: 'p', text: 'Related: “Against the virtual desktop” (tools.quarterly) and the longer preprint, “Peripheral Interfaces: Designing for the Edge of Attention”.' }],
);

const W_AGAINST = pdf(
  [{ k: 'title', text: 'Against the virtual desktop' }, { k: 'authors', text: 'J. Moreau · tools.quarterly · 4 min read' },
   { k: 'abstract', text: 'Workspaces promise order by hiding things. What we lose is the one thing a screen is good at: showing everything at once.' },
   { k: 'p', text: 'Virtual desktops convert spatial memory into a list you have to recall. Out of sight is, almost literally, out of mind.' },
   { k: 'p', text: 'If the screen is the whole world, the system must earn space by simplifying what is not in use, never by sending it somewhere else.' }],
);

const W_PILES = pdf(
  [{ k: 'title', text: 'In defence of piles' }, { k: 'authors', text: 'Ines Halvorsen · margins.press · 5 min read' },
   { k: 'abstract', text: 'Forty years after Malone asked how people organise their desks, our file systems still punish the pile.' },
   { k: 'p', text: 'A pile is a decision postponed. That is not a flaw: most things we receive do not yet know what they are for. A folder demands a category on arrival; a pile lets the category emerge.' },
   { k: 'p', text: 'The Downloads folder is the pile every operating system grudgingly admits. It is also where most files go to be forgotten, because nothing in it is ever shown back to us at the right moment.' }],
  [{ k: 'quote', text: 'The question is not where a file lives. It is when it should be in front of me again.' },
   { k: 'p', text: 'Imagine a library that remembers what you were doing when each thing arrived, and offers it back the next time you are doing that again. That is a pile with a memory.' }],
);

// ─── Notes & research writing ────────────────────────────────────────────────

/** Same body as the Notes window on the desk (src/apps/meta.ts). */
const DESK_AS_A_FIELD = `
# Desk as a field

Attention moves; windows stay.

Things near the lens open up. Things far away become what they are for: a button, a count, a status.

Try: drag Music onto the edge of this note. Pull its title bar to separate them again.

Questions
— Should fused windows share one scale?
— When does a summary say too little?
`;

const NOTES_ATTENTION = `
# Reading notes — attention

## Leroy 2009 — attention residue
- Switching away from an *unfinished* task leaves residue; next task suffers.
- Finishing (even under time pressure) reduces residue. Closure matters more than the break.
- → For the desk: a collapsed assembly should show *where I stopped*, so I don't have to hold it in my head. Externalise the unfinished part.
- Measured with lexical decision right after the switch. Nice method, could steal for a study.

## Czerwinski, Horvitz & Wilhite 2004 — diary study
- People switch constantly; many switches are self-interruptions.
- Returning is the expensive part, esp. for long complex tasks.
- Explicit design implication: capture the *set* of docs + apps for a task and restore together.
  That is literally an assembly.

## Halvorsen & Aalto 2024 — peripheral interfaces
- Simplify, don't hide. full → compact → widget by distance from the lens.
- n = 18, resumption 9.6 s vs 17.9 s for virtual desktops (table 1).
- Two participants found simplification distracting → motion at the periphery is loud. Animate less out there.
- Same argument as her margins.press piece, with numbers.

## Moreau — Against the virtual desktop (web)
- "Out of sight is, almost literally, out of mind."
- Short, polemical. Good quote for the talk, slide 3.

## Threads to pull
- Residue + periphery: does a widget showing "build failed" *create* residue? Probably yes, and that's fine when it's actionable.
- What is the smallest summary that still supports resumption? (Halvorsen §6 says an icon is too little.)
- Ask Ada if she'd sit for a quick pilot with the orbit + notes desk.
`;

const NOTES_SPATIAL = `
# Reading notes — spatial memory

## Malone 1983 — desks
- Files (titled, ordered) vs piles (untitled, unordered). Everyone uses both.
- Piles are *deferred classification*, not mess.
- Two functions of a desk: **finding** and **reminding**. Most systems only do finding.
- 10 interviews, "office tour" method. Fig. 1 is a lovely little desk sketch — redraw for the talk.

## Barreau & Nardi 1995
- Location-based finding beats search (people *prefer* browsing to where they put it).
- ephemeral / working / archived. Hardly anyone archives.
- Desktop-as-reminder confirmed for PCs.

## Robertson et al. 1998 — Data Mountain
- Inclined plane, thumbnails, items push each other aside instead of overlapping.
- Faster retrieval + fewer failures than IE4 favorites for 100 pages.
- Storage was slower (placing is deciding). Retrieval is where it pays off.
- Thumbnail *confirms* the remembered place. → previews matter as much as layout.

## Mehta & Rossi 2022
- Spatial memory is device-specific. The same synced folder "looks different" on phone vs laptop.
- → A library item should look the same everywhere (same preview, same colour), regardless of provider.

## So what
- Library should never move files. Collections are references.
- Show where I *last saw* something, not just its canonical path.
`;

const NOTES_PIM = `
# Reading notes — personal information management

## Lifestreams (Fertig, Freeman, Gelernter 1996)
- One time-ordered stream; no names, no folders required.
- Future = reminders. Substreams = saved queries that stay live.
- Basically smart folders + an inbox + a calendar, in 1996.

## Glance before you open (Okonkwo et al. 2025)
- Previews: 2.3 → 1.4 opens per re-finding episode.
- Biggest win in Downloads (bad names: "report (1).pdf").
- Sheets need header + rows in preview, not A1:F12.

## Context is a better folder (Tanaka et al. 2025)
- Rank by co-occurrence + workspace affinity + recency (7-day half-life) + explicit links.
- Always explain the suggestion: "opened with X in this workspace".
- Never-opened files get no signal → need an inbox. ✔ matches what I want for received files.

## Design notes for the library
- Inbox = received & not yet kept. Don't make me file things.
- Assemblies are the context signal. A suggestion is "because you're in orbit".
- Collections are pinned dynamic views; never moves.
`;

const TO_READ = `
# To read

- [x] Malone 1983 — How do people organize their desks?
- [x] Leroy 2009 — attention residue
- [x] Halvorsen & Aalto 2024 — peripheral interfaces
- [x] Robertson et al. 1998 — Data Mountain
- [ ] Tanaka, Sørensen, Ribeiro 2025 — Context is a better folder (arXiv 2507.02281, v2 just out)
- [ ] Okonkwo et al. 2025 — Glance before you open (skimmed, §3 table is the useful bit)
- [ ] Mehta & Rossi 2022 — cross-device spatial memory
- [ ] Gonzalez & Mark 2004 — working spheres (find PDF)
- [ ] Jones, Bruce & Dumais 2001 — Keeping found things found
- [ ] Re-read Lifestreams for the "future" part of the stream
- [ ] Halvorsen — "In defence of piles" (margins.press, saved)
`;

const REFERENCES_BIB = `
@article{malone1983desks,
  author  = {Malone, Thomas W.},
  title   = {How Do People Organize Their Desks? Implications for the Design of Office Information Systems},
  journal = {ACM Transactions on Office Information Systems},
  volume  = {1}, number = {1}, pages = {99--112}, year = {1983}
}

@inproceedings{fertig1996lifestreams,
  author    = {Fertig, Scott and Freeman, Eric and Gelernter, David},
  title     = {Lifestreams: An Alternative to the Desktop Metaphor},
  booktitle = {Conference Companion on Human Factors in Computing Systems (CHI '96)},
  year      = {1996}
}

@inproceedings{robertson1998datamountain,
  author    = {Robertson, George and Czerwinski, Mary and Larson, Kevin and Robbins, Daniel C. and Thiel, David and van Dantzich, Maarten},
  title     = {Data Mountain: Using Spatial Memory for Document Management},
  booktitle = {Proceedings of UIST '98},
  year      = {1998}
}

@article{barreau1995finding,
  author  = {Barreau, Deborah and Nardi, Bonnie A.},
  title   = {Finding and Reminding: File Organization from the Desktop},
  journal = {SIGCHI Bulletin}, volume = {27}, number = {3}, year = {1995}
}

@inproceedings{czerwinski2004diary,
  author    = {Czerwinski, Mary and Horvitz, Eric and Wilhite, Susan},
  title     = {A Diary Study of Task Switching and Interruptions},
  booktitle = {Proceedings of CHI 2004},
  year      = {2004}
}

@article{leroy2009residue,
  author  = {Leroy, Sophie},
  title   = {Why Is It So Hard to Do My Work? The Challenge of Attention Residue When Switching Between Work Tasks},
  journal = {Organizational Behavior and Human Decision Processes},
  volume  = {109}, number = {2}, pages = {168--181}, year = {2009}
}

@misc{halvorsen2024peripheral,
  author = {Halvorsen, Ines and Aalto, Tomas},
  title  = {Peripheral Interfaces: Designing for the Edge of Attention},
  note   = {arXiv:2406.01937}, year = {2024}
}

@misc{okonkwo2025glance,
  author = {Okonkwo, Chidi and Varga, R{\\'e}ka and Lind, Jonas},
  title  = {Glance Before You Open: Inline Previews Reduce Re-finding Cost in Personal File Collections},
  note   = {arXiv:2503.11427}, year = {2025}
}

@misc{tanaka2025context,
  author = {Tanaka, Mei and S{\\o}rensen, P{\\aa}l and Ribeiro, Ana},
  title  = {Context Is a Better Folder: Suggesting Files from Co-occurrence and the Active Task},
  note   = {arXiv:2507.02281}, year = {2025}
}

@inproceedings{mehta2022where,
  author    = {Mehta, Priya and Rossi, Lorenzo},
  title     = {Where Did I Put It? Spatial Memory for Files Across Devices},
  booktitle = {PIM Workshop '22}, year = {2022}
}
`;

const SYNTHESIS = `
# Desktop research — synthesis (draft)

Three claims I keep coming back to:

1. **Visibility is a memory aid.** Malone's piles, Barreau & Nardi's desktop
   reminders, Data Mountain's thumbnails. Hiding things (workspaces, tabs) breaks it.
2. **Resumption is the expensive moment.** Leroy's residue, Czerwinski's diary study.
   The system should carry what was unfinished, so I don't have to.
3. **Context beats location for retrieval.** Lifestreams' substreams, Tanaka's
   co-occurrence model. Where I *was* matters more than where the file *is*.

What the prototype does about each:

| claim | desk | library |
| --- | --- | --- |
| visibility | windows simplify by distance, never vanish | inbox shows received files until kept |
| resumption | collapsed assemblies keep a one-line summary | "continue" row per assembly |
| context | assemblies group apps | suggestions ranked by assembly co-use |

Still unresolved: how much the library should *guess*. Halvorsen §6 warns that a
summary can say too little; Tanaka says always explain. Both point the same way:
show the reason, keep it short.
`;

// ─── Created docs (Documents/Created) ────────────────────────────────────────

const TALK_OUTLINE = `
# Talk outline — Desks without workspaces

Slow Interfaces 2026, Copenhagen · 25 min + 5 Q&A

## 1. Cold open (2 min)
- Photo of my actual desk. Piles. "This works. Why doesn't my screen?"

## 2. The trouble with workspaces (4 min)
- Moreau: out of sight, out of mind.
- Virtual desktops turn spatial memory into recall. Show the wrong-workspace switch clip.

## 3. What desks are for (5 min)
- Malone 1983: finding *and* reminding. Files vs piles.
- Data Mountain: spatial memory works when thumbnails confirm it.

## 4. Peripheral vision as a model (5 min)
- Halvorsen: simplify, don't hide. Lens falloff diagram.
- Live demo: orbit + terminal + notes. Drag the lens, watch them collapse.

## 5. Assemblies (5 min)
- Leroy: residue. Czerwinski: returning is the hard part.
- An assembly keeps its one-line summary: "build passed · 6m ago".
- Library: files show up where the work is, not where they're stored.

## 6. Close (2 min)
- "The screen is the whole world. Earn space by simplifying, never by sending things away."
- Thanks / links.

## Open
- Too many citations? Cut Barreau & Nardi if over time.
- Record a backup video of the demo in case the projector is 1024×768.
`;

const SPEAKER_NOTES = `
# Speaker notes — Desks without workspaces

**Slide 1 — title.** Hi, I'm Magnus. I design interfaces at a small studio and I have a messy desk. This talk is about why that's fine, and why my computer should be more like it.

**Slide 2 — my desk.** (photo) Every pile here means something. The one on the left is "waiting on the client". I don't need to open it to know that.

**Slide 3 — workspaces.** Moreau: "Virtual desktops convert spatial memory into a list you have to recall." Pause. Ask who uses more than four. Most hands.

**Slide 4 — Malone.** 1983. Ten people, an office tour. Two jobs for a desk: finding and reminding. Files and piles. Most software only does finding.

**Slide 5 — Data Mountain.** Spatial memory works, *if* the thing at the place confirms itself — thumbnails. Keep this short.

**Slide 6 — periphery.** Halvorsen's lens falloff. Full, compact, widget. Then switch to the live demo. If the demo fails: video on the desktop, "assembly-demo.webm".

**Slide 7 — assemblies.** Leroy's attention residue in one sentence. The collapsed assembly carries where you stopped: "build passed", "1 unread from Ada".

**Slide 8 — library.** Files show up where the work is. Downloads stop being a graveyard.

**Slide 9 — close.** "Earn space by simplifying, never by sending things away." Thanks.

Timing check (last run-through): 27:40 — cut 2 min from slides 4–5.
`;

const TALK_ABSTRACT = `
Desks without workspaces
Magnus — interaction designer

Virtual desktops, tabs and workspaces all promise order by hiding things. But a
physical desk works the other way: everything stays in view, and what we are
not using fades into the background without disappearing. Drawing on forty
years of research on desks, piles and attention — from Malone's office tours to
recent work on peripheral interfaces — this talk shows a prototype desktop
where windows simplify instead of hiding, related apps fuse into assemblies,
and files appear where the work is rather than where they are stored.

25 minutes + Q&A. Live demo.
`;

const NOTES_2 = `
fraunces opsz 72 for the lantern wordmark? check with sofie
- amber on paper fails AA for body text → only for large display
- book detail: put availability above the fold
- orbit: energy test flaky at 64x? no — only the comet. fine.
ada build: send link after trails
`;

const TRAILS_IDEA = `
# Orbit — trails idea

Ada's screenshot shows Mercury jittering near perihelion at 64x. Trails would make
it obvious whether it's the integrator or just the renderer sampling late.

## Plan
1. Ring buffer per body (360 points), sampled in orbit.tick after each *fixed* step,
   not per frame — otherwise trails depend on frame rate.
2. Draw as polyline, alpha ramps from 0 → 0.6 towards the head.
3. Toggle with **t**.

## Gotchas
- Moon trail around a moving Earth looks like a spirograph. Draw it relative to Earth?
- Memory: 7 bodies × 360 × 2 × 8 bytes = 40 KB. Fine.

## For the desk widget
Collapsed orbit window could just be the Earth's angle as a dial. Tiny, alive,
says "running".
`;

const TODO_TXT = `
TODAY
- reply to Sofie re: round 2 feedback (draft in Created/)
- invoice INV-2026-019 → Lantern
- send Ada a build w/ trails
- book hotel CPH for the talk (ticket is in Downloads)

THIS WEEK
- talk run-through #2, cut 2 min
- VAT Q3 — check receipts zip
- printer: order toner
`;

// ─── Item builders ───────────────────────────────────────────────────────────

interface FileSpec {
  id: string;
  provider: ProviderId;
  /** Path relative to the provider root. */
  rel: string;
  /** ms before `now` the item entered the library. */
  added: number;
  /** ms before `now` it was last modified (defaults to `added`; edits in usage push it later). */
  modified?: number;
  origin?: LibItem['origin'];
  source?: string;
  kept?: boolean;
  tags?: string[];
  ai?: string[];
  summary?: string;
  content: Content;
  size?: number;
  /** [ms ago, note], oldest first. */
  versions?: [number, string][];
  git?: 'modified' | 'untracked';
  /** Nextcloud only: contents stay on the server. */
  online?: boolean;
}

const TAGS: Tag[] = [
  { id: 'p_important', label: 'Important', kind: 'personal' },
  { id: 'p_toread', label: 'To Read', kind: 'personal' },
  { id: 'p_inspiration', label: 'Inspiration', kind: 'personal' },
  { id: 'p_waiting', label: 'Waiting on reply', kind: 'personal' },
  { id: 'p_tax', label: 'Tax 2026', kind: 'personal' },
  { id: 'p_lantern', label: 'Client: Lantern', kind: 'personal' },
  { id: 'p_personal', label: 'Personal', kind: 'personal' },
  { id: 't_interface', label: 'Interface Design', kind: 'topic' },
  { id: 't_spatial', label: 'Spatial Memory', kind: 'topic' },
  { id: 't_attention', label: 'Attention', kind: 'topic' },
  { id: 't_pim', label: 'Personal Information Management', kind: 'topic' },
  { id: 't_previews', label: 'File Previews', kind: 'topic' },
  { id: 't_typography', label: 'Typography', kind: 'topic' },
  { id: 't_branding', label: 'Branding', kind: 'topic' },
  { id: 't_wireframes', label: 'Wireframes', kind: 'topic' },
  { id: 't_libraries', label: 'Public Libraries', kind: 'topic' },
  { id: 't_accessibility', label: 'Accessibility', kind: 'topic' },
  { id: 't_typescript', label: 'TypeScript', kind: 'topic' },
  { id: 't_physics', label: 'Physics Simulation', kind: 'topic' },
  { id: 't_architecture', label: 'Software Architecture', kind: 'topic' },
  { id: 't_testing', label: 'Testing', kind: 'topic' },
  { id: 't_tooling', label: 'Tooling', kind: 'topic' },
  { id: 't_invoices', label: 'Invoices', kind: 'topic' },
  { id: 't_finance', label: 'Finance', kind: 'topic' },
  { id: 't_contracts', label: 'Contracts', kind: 'topic' },
  { id: 't_travel', label: 'Travel', kind: 'topic' },
  { id: 't_paper', label: 'Research Paper', kind: 'topic' },
  { id: 't_meeting', label: 'Meeting Notes', kind: 'topic' },
  { id: 't_presentation', label: 'Presentation', kind: 'topic' },
  { id: 't_photography', label: 'Photography', kind: 'topic' },
];

const PROVIDERS: Provider[] = [
  { id: 'home', label: 'Local', kind: 'local', root: ROOTS.home, connected: true },
  { id: 'downloads', label: 'Downloads', kind: 'downloads', root: ROOTS.downloads, connected: true },
  { id: 'nextcloud', label: 'Nextcloud', kind: 'cloud', root: ROOTS.nextcloud, connected: true },
  { id: 'git-orbit', label: 'Git · ~/src/orbit', kind: 'git', root: ROOTS['git-orbit'], connected: true },
  { id: 'external', label: 'Field Drive', kind: 'external', root: ROOTS.external, connected: false },
];

function estimateSize(c: Content, ext: string, r: () => number): number {
  switch (c.t) {
    case 'pdf': {
      const figs = c.pages.reduce((n, p) => n + p.blocks.filter((b) => b.k === 'figure').length, 0);
      return Math.round(c.pages.length * (48e3 + r() * 120e3) + figs * (180e3 + r() * 260e3));
    }
    case 'markdown': case 'text': case 'code':
      return new TextEncoder().encode(c.text).length;
    case 'image': {
      const px = c.art.w * c.art.h;
      const bpp = ext === 'svg' ? 0.004 : ext === 'heic' ? 0.16 : c.art.style === 'photo' ? 0.32
        : c.art.style === 'scan' || c.art.style === 'moodboard' ? 0.26 : c.art.style === 'screenshot' ? 0.19 : 0.09;
      return Math.round(px * bpp * (0.85 + r() * 0.3));
    }
    case 'doc': return Math.round(8.5e3 + c.blocks.length * (900 + r() * 700));
    case 'sheet': return ext === 'csv'
      ? c.rows.length * c.columns.length * 11
      : Math.round(7.8e3 + c.rows.length * c.columns.length * (12 + r() * 6));
    case 'slides': return Math.round(c.slides.reduce((n, s) => n + (s.art ? 420e3 : 60e3), 120e3) * (0.9 + r() * 0.2));
    case 'archive': return Math.round(c.entries.reduce((n, e) => n + e.size, 0) * (0.55 + r() * 0.2));
    case 'media': {
      const rate = ext === 'mp3' ? 16e3 : ext === 'm4a' ? 24e3 : ext === 'webm' ? 260e3 : ext === 'mov' ? 18e6 : 1.1e6;
      return Math.round(c.duration * rate);
    }
  }
}

const extOf = (name: string) => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; };

// ─── Seed ────────────────────────────────────────────────────────────────────

export function seedLibrary(now: number): SeedData {
  const rnd = mulberry32(0x0b17a5ee);
  const ymd = (ago: number) => new Date(now - ago).toISOString().slice(0, 10);
  const hms = (ago: number) => new Date(now - ago).toISOString().slice(11, 19).split(':').join('.');
  const dmy = (ago: number) => { const [y, m, d] = ymd(ago).split('-'); return `${d}.${m}.${y}`; };

  const items: LibItem[] = [];
  const byId = new Map<string, LibItem>();
  const versionSpecs = new Map<string, [number, string][]>();

  const push = (it: LibItem) => {
    if (byId.has(it.id)) throw new Error(`seed: duplicate id ${it.id}`);
    byId.set(it.id, it);
    items.push(it);
  };

  const dir = (id: string, provider: ProviderId, rel: string, added: number, extra: { tags?: string[]; summary?: string } = {}) => {
    const name = rel.slice(rel.lastIndexOf('/') + 1);
    push({
      id, kind: 'folder', name, ext: '', path: `${ROOTS[provider]}/${rel}`, parentId: null, provider,
      availability: 'local', size: 0, added: now - added, modified: now - added, origin: 'existing',
      tags: extra.tags ?? [], aiTags: [], ...(extra.summary ? { summary: extra.summary } : {}), content: null,
    });
  };

  const F = (s: FileSpec) => {
    const name = s.rel.slice(s.rel.lastIndexOf('/') + 1);
    const ext = extOf(name);
    const kind = EXT_KIND[ext];
    if (!kind) throw new Error(`seed: unknown extension for ${name}`);
    const availability: LibItem['availability'] =
      s.provider === 'git-orbit' ? 'git'
      : s.provider === 'external' ? 'unavailable'
      : s.provider === 'nextcloud' ? ((s.online ?? rnd() < 0.4) ? 'cloud-online' : 'cloud-downloaded')
      : 'local';
    const origin = s.origin ?? (s.provider === 'downloads' ? 'received' : 'existing');
    push({
      id: s.id, kind, name, ext, path: `${ROOTS[s.provider]}/${s.rel}`, parentId: null, provider: s.provider,
      availability, size: s.size ?? estimateSize(s.content, ext, rnd),
      added: now - s.added, modified: now - (s.modified ?? s.added), origin,
      ...(s.source ? { source: s.source } : {}),
      ...(origin === 'received' ? { kept: s.kept ?? false } : {}),
      tags: s.tags ?? [], aiTags: s.ai ?? [],
      ...(s.summary ? { summary: s.summary } : {}),
      content: s.content,
      ...(s.provider === 'git-orbit' ? { git: { status: s.git ?? 'clean', branch: 'main' } } : {}),
    });
    if (s.versions) versionSpecs.set(s.id, s.versions);
  };

  const shotName = (ago: number) => `Screenshot ${ymd(ago)} at ${hms(ago)}.png`;

  // ════════════════════════════════════════════════════════════════════════
  // git-orbit — ~/src/orbit
  // ════════════════════════════════════════════════════════════════════════
  const G = 'git-orbit' as const;
  dir('d_orbit_src', G, 'src', 160 * D);
  dir('d_orbit_bodies', G, 'src/bodies', 120 * D);
  dir('d_orbit_docs', G, 'docs', 150 * D, { summary: 'Architecture notes, roadmap and decision records for orbit.' });
  dir('d_orbit_decisions', G, 'docs/decisions', 140 * D);
  dir('d_orbit_tests', G, 'tests', 110 * D);

  F({ id: 'f_orbit_readme', provider: G, rel: 'README.md', added: 160 * D, modified: 9 * D, content: md(README_MD), ai: ['t_typescript', 't_physics'], summary: 'How to run orbit, the key bindings, module layout and the known Mercury jitter issue.' });
  F({ id: 'f_orbit_package', provider: G, rel: 'package.json', added: 160 * D, modified: 30 * D, content: code('json', PACKAGE_JSON), ai: ['t_tooling'] });
  F({ id: 'f_orbit_tsconfig', provider: G, rel: 'tsconfig.json', added: 160 * D, modified: 110 * D, content: code('json', TSCONFIG_JSON), ai: ['t_tooling', 't_typescript'] });
  F({ id: 'f_orbit_vite', provider: G, rel: 'vite.config.ts', added: 160 * D, modified: 95 * D, content: code('ts', VITE_CONFIG_TS), ai: ['t_tooling'] });
  F({ id: 'f_orbit_index_html', provider: G, rel: 'index.html', added: 160 * D, modified: 60 * D, content: code('html', INDEX_HTML) });
  F({ id: 'f_orbit_changelog', provider: G, rel: 'CHANGELOG.md', added: 140 * D, modified: 12 * D, content: md(CHANGELOG_MD), summary: 'Release notes from 0.1.0 to the unreleased 0.4.0 (fixed-step accumulator, energy test, camera).' });

  F({ id: 'f_orbit_ts', provider: G, rel: 'src/orbit.ts', added: 160 * D, modified: 2 * H, git: 'modified', content: code('ts', ORBIT_TS), ai: ['t_typescript', 't_physics'], tags: ['p_important'], summary: 'Defines the simulated system and the fixed-step tick loop that advances physics one simulated hour at a time.' });
  F({ id: 'f_physics_ts', provider: G, rel: 'src/physics.ts', added: 160 * D, modified: 26 * H, git: 'modified', content: code('ts', PHYSICS_TS), ai: ['t_typescript', 't_physics'], summary: 'Body class plus pairwise gravitational acceleration and a kick–drift–kick velocity-Verlet step.' });
  F({ id: 'f_render_ts', provider: G, rel: 'src/render.ts', added: 160 * D, modified: 3 * D, content: code('ts', RENDER_TS), ai: ['t_typescript'], summary: 'Canvas renderer: background, faint orbit guides, bodies sized by log mass, optional labels.' });
  F({ id: 'f_main_ts', provider: G, rel: 'src/main.ts', added: 160 * D, modified: 20 * D, content: code('ts', MAIN_TS), ai: ['t_typescript'], summary: 'Entry point: canvas setup, animation frame loop and keyboard controls.' });
  F({ id: 'f_units_ts', provider: G, rel: 'src/units.ts', added: 140 * D, modified: 70 * D, content: code('ts', UNITS_TS), ai: ['t_physics'] });
  F({ id: 'f_camera_ts', provider: G, rel: 'src/camera.ts', added: 40 * D, modified: 18 * D, content: code('ts', CAMERA_TS), ai: ['t_typescript'] });
  F({ id: 'f_trails_ts', provider: G, rel: 'src/trails.ts', added: 2 * D, modified: 5 * H, git: 'untracked', content: code('ts', TRAILS_TS), ai: ['t_typescript'], summary: 'Draft ring buffer of sampled positions per body, for drawing orbit trails.' });
  F({ id: 'f_bodies_index', provider: G, rel: 'src/bodies/index.ts', added: 120 * D, modified: 64 * D, content: code('ts', BODIES_INDEX_TS) });
  F({ id: 'f_bodies_planets', provider: G, rel: 'src/bodies/planets.ts', added: 120 * D, modified: 88 * D, content: code('ts', PLANETS_TS), ai: ['t_physics'] });
  F({ id: 'f_bodies_moons', provider: G, rel: 'src/bodies/moons.ts', added: 66 * D, modified: 66 * D, content: code('ts', MOONS_TS) });
  F({ id: 'f_bodies_comets', provider: G, rel: 'src/bodies/comets.ts', added: 64 * D, modified: 64 * D, content: code('ts', COMETS_TS) });

  F({ id: 'f_orbit_architecture', provider: G, rel: 'docs/architecture.md', added: 150 * D, modified: 11 * D, content: md(ARCHITECTURE_MD), ai: ['t_architecture', 't_typescript'], tags: ['p_important'], summary: 'Explains the main → orbit.tick → physics.step / render.draw data flow, SI units and three rules for changes.' });
  F({ id: 'f_orbit_roadmap', provider: G, rel: 'docs/roadmap.md', added: 100 * D, modified: 6 * D, content: md(ROADMAP_MD) });
  F({ id: 'f_orbit_screenshot', provider: G, rel: 'docs/screenshot.png', added: 60 * D, content: image(art('screenshot', 215, 2560, 1600, 'Orbit — inner planets')), ai: ['t_physics'] });
  F({ id: 'f_adr_0001', provider: G, rel: 'docs/decisions/0001-fixed-timestep.md', added: 140 * D, modified: 24 * D, content: md(ADR_0001), ai: ['t_architecture', 't_physics'], summary: 'Decision to advance physics in fixed one-hour steps from an accumulator.' });
  F({ id: 'f_adr_0002', provider: G, rel: 'docs/decisions/0002-canvas-over-webgl.md', added: 138 * D, content: md(ADR_0002), ai: ['t_architecture'] });
  F({ id: 'f_adr_0003', provider: G, rel: 'docs/decisions/0003-si-units-internally.md', added: 125 * D, content: md(ADR_0003), ai: ['t_architecture'] });
  F({ id: 'f_adr_0004', provider: G, rel: 'docs/decisions/0004-velocity-verlet.md', added: 70 * D, content: md(ADR_0004), ai: ['t_architecture', 't_physics'], summary: 'Decision to replace semi-implicit Euler with velocity Verlet after the energy test failed.' });
  F({ id: 'f_test_physics', provider: G, rel: 'tests/physics.test.ts', added: 110 * D, modified: 16 * D, content: code('ts', PHYSICS_TEST_TS), ai: ['t_testing', 't_physics'] });
  F({ id: 'f_test_orbit', provider: G, rel: 'tests/orbit.test.ts', added: 40 * D, modified: 16 * D, content: code('ts', ORBIT_TEST_TS), ai: ['t_testing'] });
  F({ id: 'f_test_render', provider: G, rel: 'tests/render.test.ts', added: 40 * D, content: code('ts', RENDER_TEST_TS), ai: ['t_testing'] });

  // ════════════════════════════════════════════════════════════════════════
  // home — /home/magnus
  // ════════════════════════════════════════════════════════════════════════
  const HM = 'home' as const;
  dir('d_documents', HM, 'Documents', 1000 * D);
  dir('d_created', HM, 'Documents/Created', 200 * D, { summary: 'Where Notes and Documents auto-save new work.' });
  dir('d_research', HM, 'Documents/Research', 75 * D);
  dir('d_papers', HM, 'Documents/Research/Papers', 75 * D, { summary: 'Classic and recent papers on desks, spatial memory, attention and PIM.' });
  dir('d_web', HM, 'Documents/Research/Web', 40 * D);
  dir('d_talks', HM, 'Documents/Talks', 300 * D);
  dir('d_talk', HM, 'Documents/Talks/Desks without workspaces', 24 * D, { summary: 'Deck, speaker notes and figures for the Slow Interfaces 2026 talk.' });
  dir('d_pictures', HM, 'Pictures', 1000 * D);
  dir('d_screenshots', HM, 'Pictures/Screenshots', 900 * D);
  dir('d_phone', HM, 'Pictures/Phone', 700 * D);
  dir('d_sketches', HM, 'Sketches', 400 * D);
  dir('d_desktop', HM, 'Desktop', 1000 * D);

  // — Created documents —
  F({ id: 'f_desk_field', provider: HM, rel: 'Documents/Created/Desk as a field.md', origin: 'created', added: 9 * D, modified: 2 * M + 40e3,
    content: md(DESK_AS_A_FIELD), ai: ['t_interface', 't_attention'], tags: ['p_important'],
    summary: 'Short design note: windows near the attention lens open up, distant ones collapse to what they are for.',
    versions: [[9 * D, 'Created in Notes'], [9 * D - 4 * M, 'Renamed from Untitled note'], [6 * D, 'Edited in Notes'], [3 * D, 'Added questions'], [26 * H, 'Edited in Notes'], [2 * M + 40e3, 'Autosaved']] });
  F({ id: 'f_meeting_lantern', provider: HM, rel: `Documents/Created/Meeting notes — Lantern review ${ymd(4 * D)}.md`, origin: 'created', added: 4 * D, modified: 4 * D - 3 * H,
    content: md(`
# Lantern review — ${ymd(4 * D)}

Present: Sofie Brandt (Lantern, digital lead), Jens Kier (Lantern, branch services), me.
Rasmus joined for the last 15 min (illustration).

## Identity
- Lamp mark: **B** is the favourite. They want to see it at 16 px and on the bus-stop posters.
- Amber reads "too orange" on their printed signage → test a deeper, browner amber.
- Wordmark: one-colour version needed for print and embroidery (tote bags!).

## App
- Search: filter chips well received. "Available nearby" toggle confused Jens — rename or explain.
- Book detail: availability per branch must be above the fold.
- Loans: renew-all button yes, but confirm before renewing.
- Events: out of scope for round 2, keep in v3 brief timeline.

## Accessibility
- Their accessibility panel tests round 2 with screen-reader users. Need VoiceOver labels in the prototype.
- Minimum 18 px body text in the app.

## Actions
- [ ] Me: round 2 deck by Friday, incl. deeper amber + one-colour wordmark
- [ ] Me: wireframes for availability above the fold
- [ ] Sofie: send written feedback (doc) + Q3 usage report
- [ ] Rasmus: two spot illustrations for empty states
`), ai: ['t_meeting', 't_branding', 't_accessibility'], tags: ['p_lantern'],
    summary: 'Notes from the Lantern round-1 review: lamp mark B chosen, amber too orange, availability above the fold.',
    versions: [[4 * D, 'Created in Notes'], [4 * D - 50 * M, 'Edited in Notes'], [4 * D - 3 * H, 'Added actions']] });
  F({ id: 'f_talk_outline', provider: HM, rel: 'Documents/Created/Talk outline — Desks without workspaces.md', origin: 'created', added: 12 * D, modified: 2 * D,
    content: md(TALK_OUTLINE), ai: ['t_presentation', 't_interface', 't_attention'],
    summary: 'Six-part outline for the 25-minute talk, from the trouble with workspaces to assemblies and the library.',
    versions: [[12 * D, 'Created in Notes'], [12 * D - 2 * M, 'Renamed from Untitled note'], [10 * D, 'Edited in Notes'], [7 * D, 'Reordered sections'], [5 * D, 'Edited in Notes'], [2 * D, 'Autosaved']] });
  F({ id: 'f_standup', provider: HM, rel: `Documents/Created/Studio standup ${ymd(2 * D)}.md`, origin: 'created', added: 2 * D, modified: 2 * D - 25 * M,
    content: md(`
# Studio standup — ${ymd(2 * D)}

**Magnus**
- Lantern round 2 deck: 60%. Waiting on Sofie's written feedback.
- Talk: outline done, deck draft, run-through Thursday.
- Orbit (evenings): trails prototype.

**Rasmus** (remote)
- Empty-state illustrations for Lantern: sketches Friday.

**Admin**
- INV-2026-018 paid. 019 goes out after round 2.
- VAT Q3 due — receipts zipped in Nextcloud/Admin/Tax 2026.

**Blockers**
- Printer out of toner again.
`), ai: ['t_meeting'], versions: [[2 * D, 'Created in Notes'], [2 * D - 10 * M, 'Edited in Notes'], [2 * D - 25 * M, 'Autosaved']] });
  F({ id: 'f_notes_2', provider: HM, rel: 'Documents/Created/notes (2).md', origin: 'created', added: 6 * D, modified: 20 * H,
    content: md(NOTES_2), ai: ['t_typography'],
    versions: [[6 * D, 'Created in Notes'], [5 * D, 'Autosaved'], [20 * H, 'Autosaved']] });
  F({ id: 'f_trails_idea', provider: HM, rel: 'Documents/Created/Orbit — trails idea.md', origin: 'created', added: 3 * D, modified: 6 * H,
    content: md(TRAILS_IDEA), ai: ['t_physics', 't_typescript'], summary: 'Plan for orbit trails: per-body ring buffer sampled after each fixed step, fading polyline.',
    versions: [[3 * D, 'Created in Notes'], [3 * D - 3 * M, 'Renamed from Untitled note'], [2 * D, 'Edited in Notes'], [6 * H, 'Autosaved']] });
  F({ id: 'f_reply_lantern', provider: HM, rel: 'Documents/Created/Reply to Lantern feedback round 2.odt', origin: 'created', added: 5 * H, modified: 70 * M,
    content: doc(
      { k: 'title', text: 'Re: Lantern — round 2 feedback' },
      { k: 'p', text: 'Hi Sofie, thank you for the detailed notes — and to Jens for testing on the branch tablets.' },
      { k: 'h', text: 'Amber' },
      { k: 'p', text: 'Agreed. We have a deeper amber (#D98E2B) that holds up on uncoated stock and passes AA as large text on Paper. Proofs from Printhaus arrive Tuesday.' },
      { k: 'h', text: 'Wordmark in one colour' },
      { k: 'p', text: 'Attached a single-colour wordmark and a knockout version for dark backgrounds. The lamp mark keeps its glow as a cut-out, so it still reads at embroidery size.' },
      { k: 'h', text: '"Available nearby"' },
      { k: 'li', text: 'Rename to "At my branches" and show the chosen branches in the chip itself.' },
      { k: 'li', text: 'First-run explains it in one line; screen readers get the full branch list.' },
      { k: 'h', text: 'Next' },
      { k: 'p', text: 'I will fold this into the round 2 deck and send it with the updated wireframes on Friday. Invoice for phase 2 follows separately.' },
      { k: 'sign', text: 'Best, Magnus' },
    ), ai: ['t_branding', 't_accessibility'], tags: ['p_lantern', 'p_waiting'],
    summary: 'Draft reply to Sofie: deeper amber, one-colour wordmark, rename "Available nearby" to "At my branches".',
    versions: [[5 * H, 'Created in Documents'], [5 * H - 3 * M, 'Renamed from Untitled document'], [3 * H, 'Edited in Documents'], [70 * M, 'Autosaved']] });
  F({ id: 'f_letter_landlord', provider: HM, rel: 'Documents/Created/Letter to landlord — heating.odt', origin: 'created', added: 11 * D, modified: 10 * D,
    content: doc(
      { k: 'title', text: 'Heating in studio 2, Mejlgade' },
      { k: 'p', text: 'Dear Mejlgade Ejendomme,' },
      { k: 'p', text: 'Since the start of October the radiators in studio 2 have not reached more than 17 °C, even with the thermostats fully open. The caretaker bled them on the 9th, which helped for two days.' },
      { k: 'p', text: 'Under §4 of our lease the landlord maintains the heating installation. Could you send a technician this week? We are in the studio on weekdays from 9 to 17.' },
      { k: 'sign', text: 'Kind regards, Magnus · Studio Nordlys ApS' },
    ), ai: ['t_contracts'], tags: ['p_personal', 'p_waiting'],
    versions: [[11 * D, 'Created in Documents'], [11 * D - 2 * M, 'Renamed from Untitled document'], [10 * D, 'Edited in Documents']] });

  // — Research —
  F({ id: 'f_notes_attention', provider: HM, rel: 'Documents/Research/Reading notes — attention.md', origin: 'created', added: 21 * D, modified: 2 * H + 10 * M,
    content: md(NOTES_ATTENTION), ai: ['t_attention', 't_interface'], tags: ['p_important'],
    summary: 'Notes on Leroy’s attention residue, Czerwinski’s diary study and Halvorsen’s peripheral interfaces, with design threads.',
    versions: [[21 * D, 'Created in Notes'], [21 * D - 2 * M, 'Renamed from Untitled note'], [17 * D, 'Edited in Notes'], [11 * D, 'Added Halvorsen'], [6 * D, 'Edited in Notes'], [2 * D, 'Added threads to pull'], [2 * H + 10 * M, 'Autosaved']] });
  F({ id: 'f_notes_spatial', provider: HM, rel: 'Documents/Research/Reading notes — spatial memory.md', origin: 'created', added: 30 * D, modified: 4 * D,
    content: md(NOTES_SPATIAL), ai: ['t_spatial', 't_pim'],
    summary: 'Notes on Malone’s files and piles, Barreau & Nardi, Data Mountain and cross-device spatial memory.',
    versions: [[30 * D, 'Created in Notes'], [30 * D - 1 * M, 'Renamed from Untitled note'], [22 * D, 'Edited in Notes'], [13 * D, 'Edited in Notes'], [4 * D, 'Autosaved']] });
  F({ id: 'f_notes_pim', provider: HM, rel: 'Documents/Research/Reading notes — PIM.md', origin: 'created', added: 16 * D, modified: 3 * D,
    content: md(NOTES_PIM), ai: ['t_pim', 't_previews'],
    summary: 'Notes on Lifestreams, preview-based re-finding and co-occurrence suggestions, mapped onto the library design.',
    versions: [[16 * D, 'Created in Notes'], [16 * D - 2 * M, 'Renamed from Untitled note'], [8 * D, 'Edited in Notes'], [3 * D, 'Autosaved']] });
  F({ id: 'f_to_read', provider: HM, rel: 'Documents/Research/To read.md', added: 60 * D, modified: 3 * H, content: md(TO_READ), ai: ['t_paper'], tags: ['p_toread'] });
  F({ id: 'f_references_bib', provider: HM, rel: 'Documents/Research/references.bib', added: 58 * D, modified: 3 * D, content: { t: 'text', text: REFERENCES_BIB.trimStart() }, ai: ['t_paper'], summary: 'BibTeX entries for the ten papers in the desktop research reading list.' });
  F({ id: 'f_synthesis', provider: HM, rel: 'Documents/Research/Desktop research — synthesis.md', added: 7 * D, modified: 26 * H, origin: 'created', content: md(SYNTHESIS), ai: ['t_interface', 't_spatial', 't_attention'], tags: ['p_important'],
    summary: 'Draft synthesis: visibility aids memory, resumption is expensive, context beats location — and what the prototype does about each.',
    versions: [[7 * D, 'Created in Notes'], [7 * D - 1 * M, 'Renamed from Untitled note'], [5 * D, 'Edited in Notes'], [26 * H, 'Autosaved']] });

  F({ id: 'f_p_malone', provider: HM, rel: 'Documents/Research/Papers/Malone_1983_How-do-people-organize-their-desks.pdf', added: 62 * D, content: P_MALONE, ai: ['t_paper', 't_spatial', 't_pim'], tags: ['p_important'], summary: 'Interview study of office desks: files vs piles, and the reminding function of visible clutter.' });
  F({ id: 'f_p_lifestreams', provider: HM, rel: 'Documents/Research/Papers/Fertig1996_Lifestreams.pdf', added: 58 * D, content: P_LIFESTREAMS, ai: ['t_paper', 't_pim'], summary: 'Replaces files and folders with a time-ordered stream of documents, live substreams and future reminders.' });
  F({ id: 'f_p_datamountain', provider: HM, rel: 'Documents/Research/Papers/robertson-data-mountain-uist98.pdf', added: 55 * D, content: P_DATAMOUNTAIN, ai: ['t_paper', 't_spatial'], summary: 'Documents placed on an inclined 3D plane were retrieved faster than IE4 Favorites, using spatial memory.' });
  F({ id: 'f_p_barreau', provider: HM, rel: 'Documents/Research/Papers/Barreau-Nardi-1995-finding-and-reminding.pdf', added: 50 * D, content: P_BARREAU, ai: ['t_paper', 't_pim', 't_spatial'], summary: 'People prefer location-based finding and use the desktop for reminding; little gets archived.' });
  F({ id: 'f_p_czerwinski', provider: HM, rel: 'Documents/Research/Papers/czerwinski-chi2004-diary-task-switching.pdf', added: 33 * D, content: P_CZERWINSKI, ai: ['t_paper', 't_attention'], summary: 'Week-long diary study: frequent task switches, and returning to complex tasks is the hard part.' });
  F({ id: 'f_p_mehta', provider: HM, rel: 'Documents/Research/Papers/Mehta_Rossi_2022_spatial-memory-files.pdf', added: 27 * D, content: P_MEHTA, ai: ['t_paper', 't_spatial'], tags: ['p_toread'] });

  F({ id: 'f_web_peripheral', provider: HM, rel: 'Documents/Research/Web/Peripheral vision is an interface — margins.press.pdf', origin: 'received', source: 'Firefox · margins.press', kept: true, added: 38 * D,
    content: W_PERIPHERAL, ai: ['t_attention', 't_interface'], tags: ['p_inspiration'], summary: 'Essay arguing objects at the edge of attention should become simpler, not smaller.' });
  F({ id: 'f_web_against', provider: HM, rel: 'Documents/Research/Web/Against the virtual desktop — tools.quarterly.pdf', origin: 'received', source: 'Firefox · tools.quarterly', kept: true, added: 36 * D,
    content: W_AGAINST, ai: ['t_interface', 't_spatial'], tags: ['p_inspiration'], summary: 'Short polemic: virtual desktops turn spatial memory into recall.' });
  F({ id: 'f_web_piles', provider: HM, rel: 'Documents/Research/Web/In defence of piles — margins.press.pdf', origin: 'received', source: 'Firefox · margins.press', kept: true, added: 8 * D,
    content: W_PILES, ai: ['t_pim', 't_spatial'], tags: ['p_toread'], summary: 'Argues the Downloads folder is a pile without a memory, and should offer things back at the right moment.' });

  // — Talk —
  const lens = art('diagram', 262, 1920, 1080, 'full · compact · widget');
  F({ id: 'f_talk_deck', provider: HM, rel: 'Documents/Talks/Desks without workspaces/Desks without workspaces.pptx', added: 9 * D, modified: 22 * H,
    content: { t: 'slides', slides: [
      { title: 'Desks without workspaces', bullets: ['Magnus · interaction designer', 'Slow Interfaces 2026'], art: art('photo', 30, 1920, 1080, 'my desk', 4471) },
      { title: 'This works', bullets: ['Every pile means something', 'I never open “waiting on client” to know what it is'], art: art('photo', 30, 1920, 1080, 'piles', 4472) },
      { title: 'Out of sight, out of mind', bullets: ['Virtual desktops convert spatial memory into a list you have to recall — J. Moreau', 'Who uses more than four?'] },
      { title: 'What desks are for', bullets: ['Malone 1983: finding and reminding', 'Files are titled and ordered; piles are neither', 'Piles are deferred decisions'], art: art('diagram', 32, 1920, 1080, 'files vs piles') },
      { title: 'Place + picture', bullets: ['Data Mountain: retrieval faster than favorites', 'The thumbnail confirms the remembered place'] },
      { title: 'Simplify, don’t hide', bullets: ['Halvorsen: the periphery tells us where to look next', 'full → compact → widget by distance from the lens', 'Live demo'], art: lens },
      { title: 'Assemblies', bullets: ['Attention residue (Leroy 2009)', 'Returning is the expensive part (Czerwinski 2004)', 'A collapsed assembly carries where you stopped'], art: art('screenshot', 190, 1920, 1080, 'orbit · build passed · 6m ago') },
      { title: 'Files where the work is', bullets: ['Received files wait in an inbox until kept', 'Suggestions explain themselves: “opened with orbit.ts”', 'Nothing is ever moved'] },
      { title: 'Earn space by simplifying', bullets: ['never by sending things away', 'Thank you'] },
    ] }, ai: ['t_presentation', 't_interface', 't_attention'], tags: ['p_important'],
    summary: 'Nine-slide deck for the talk: workspaces vs desks, Malone, Data Mountain, peripheral simplification, assemblies, the library.' });
  F({ id: 'f_speaker_notes', provider: HM, rel: 'Documents/Talks/Desks without workspaces/speaker-notes.md', added: 8 * D, modified: 22 * H, content: md(SPEAKER_NOTES), ai: ['t_presentation'], summary: 'Per-slide speaker notes with a timing note: last run-through 27:40, cut two minutes.' });
  F({ id: 'f_talk_abstract', provider: HM, rel: 'Documents/Talks/Desks without workspaces/talk-abstract.txt', added: 24 * D, modified: 20 * D, content: { t: 'text', text: TALK_ABSTRACT.trimStart() }, ai: ['t_presentation'], summary: 'Submitted abstract for Slow Interfaces 2026.' });
  F({ id: 'f_fig_piles', provider: HM, rel: 'Documents/Talks/Desks without workspaces/fig-files-vs-piles.png', added: 7 * D, content: image(art('diagram', 32, 1920, 1080, 'files vs piles')), ai: ['t_presentation', 't_pim'] });
  F({ id: 'f_fig_lens', provider: HM, rel: 'Documents/Talks/Desks without workspaces/fig-lens-falloff.png', added: 7 * D, modified: 5 * D, content: image(lens), ai: ['t_presentation', 't_attention'] });
  F({ id: 'f_photo_desk', provider: HM, rel: 'Documents/Talks/Desks without workspaces/photo-messy-desk.jpg', added: 9 * D, content: image(art('photo', 30, 4032, 3024, undefined, 4471)), ai: ['t_photography'] });
  F({ id: 'f_demo_webm', provider: HM, rel: 'Documents/Talks/Desks without workspaces/assembly-demo.webm', added: 3 * D, content: { t: 'media', duration: 94, note: 'Backup recording of the live demo: dragging the lens across orbit, terminal and notes.', art: art('screenshot', 190, 2560, 1600, 'assembly demo') }, ai: ['t_presentation', 't_interface'] });

  // — Screenshots —
  const shots: [string, number, string, number, string[], string?][] = [
    ['f_shot_lantern_search', 3 * D + 6.6 * H, 'Lantern — Search', 38, ['t_libraries', 't_interface'], 'Current Lantern app search screen captured for the redesign.'],
    ['f_shot_lantern_detail', 3 * D + 6.5 * H, 'Lantern — Book detail', 38, ['t_libraries', 't_interface'], 'Current Lantern book detail screen; availability is below the fold.'],
    ['f_shot_lantern_loans', 15 * D + 2 * H, 'Lantern — Loans', 38, ['t_libraries']],
    ['f_shot_lantern_events', 15 * D + 1.9 * H, 'Lantern — Events (old app)', 38, ['t_libraries']],
    ['f_shot_quicklook', 19 * D + 4 * H, 'Quick Look — PDF preview', 220, ['t_previews', 't_interface'], 'Reference: a space-bar preview panel showing the first page of a PDF.'],
    ['f_shot_spatial_fm', 19 * D + 3.8 * H, 'Spatial file browser ref', 200, ['t_spatial', 't_interface']],
    ['f_shot_tiling', 26 * D + 5 * H, 'Window tiling — 4 up', 210, ['t_interface']],
    ['f_shot_orbit_jitter', 1 * D + 3 * H, 'Orbit — Mercury at 64x', 215, ['t_physics']],
    ['f_shot_contrast', 5 * D + 2 * H, 'Contrast check — amber on paper', 38, ['t_accessibility', 't_branding'], 'Contrast checker: amber on paper fails AA for body text, passes for large text.'],
    ['f_shot_fraunces', 12 * D + 7 * H, 'Type specimen — Fraunces', 30, ['t_typography']],
    ['f_shot_terminal', 44 * D + 3 * H, 'Terminal — vitest 6 passed', 160, ['t_testing']],
    ['f_shot_old_site', 400 * D, 'Kalkbrud — landing (2024)', 120, ['t_interface']],
  ];
  for (const [id, base, label, hue, ai, summary] of shots) {
    const ago = base + (hash(id) % 3571) * 1e3;
    F({ id, provider: HM, rel: `Pictures/Screenshots/${shotName(ago)}`, added: ago, content: image(art('screenshot', hue, 2880, 1800, label)), ai, ...(summary ? { summary } : {}),
      ...(id === 'f_shot_quicklook' || id === 'f_shot_spatial_fm' ? { tags: ['p_inspiration'] } : {}) });
  }

  // — Phone photos —
  const photos: [string, number, number, number, string, string[], string?][] = [
    ['f_img_4471', 4471, 9 * D + 2 * H, 30, 'my desk, piles', ['t_photography'], 'Photo of the studio desk with labelled paper piles, used on slide 2 of the talk.'],
    ['f_img_4458', 4458, 18 * D, 45, 'Lantern branch — reading room', ['t_libraries', 't_photography'], 'Reading room at a Lantern branch: warm lamps, long tables, card catalogue.'],
    ['f_img_4459', 4459, 18 * D - 5 * M, 40, 'Lantern branch — returns shelf', ['t_libraries', 't_photography']],
    ['f_img_4460', 4460, 18 * D - 9 * M, 50, 'Lantern branch — wayfinding sign', ['t_libraries', 't_branding']],
    ['f_img_4466', 4466, 13 * D, 210, 'whiteboard — assemblies', ['t_interface'], 'Whiteboard sketch of assemblies collapsing into one-line summaries.'],
    ['f_img_4469', 4469, 11 * D, 55, 'notebook — lamp marks', ['t_branding']],
    ['f_img_4402', 4402, 52 * D, 200, 'harbour, morning', ['t_photography']],
    ['f_img_4380', 4380, 70 * D, 25, 'studio party', ['t_photography']],
  ];
  for (const [id, n, ago, hue, label, ai, summary] of photos) {
    F({ id, provider: HM, rel: `Pictures/Phone/IMG_${n}.jpg`, added: ago, content: image(art(label.startsWith('whiteboard') || label.startsWith('notebook') ? 'scan' : 'photo', hue, 4032, 3024, label, n)), ai, ...(summary ? { summary } : {}) });
  }

  // — Sketches —
  F({ id: 'f_sketch_search_1', provider: HM, rel: 'Sketches/lantern-search-sketch-01.jpg', added: 22 * D, content: image(art('scan', 40, 3508, 2480, 'search: chips + results')), ai: ['t_wireframes', 't_libraries'], tags: ['p_lantern'], summary: 'Pen sketch of the Lantern search screen with filter chips above results.' });
  F({ id: 'f_sketch_search_2', provider: HM, rel: 'Sketches/lantern-search-sketch-02.jpg', added: 21 * D, content: image(art('scan', 40, 3508, 2480, 'search: availability toggle')), ai: ['t_wireframes', 't_libraries'], tags: ['p_lantern'] });
  F({ id: 'f_sketch_icons', provider: HM, rel: 'Sketches/lantern-icon-doodles.jpg', added: 25 * D, content: image(art('scan', 36, 3508, 2480, 'lamp marks A–F')), ai: ['t_branding'] });
  F({ id: 'f_sketch_lens', provider: HM, rel: 'Sketches/lens-falloff.png', added: 10 * D, content: image(art('sketch', 262, 2048, 1536, 'lens: full / compact / widget')), ai: ['t_interface', 't_attention'], summary: 'Tablet sketch of the attention lens and the three window representations.' });
  F({ id: 'f_sketch_collapse', provider: HM, rel: 'Sketches/assembly-collapse.png', added: 10 * D - 2 * H, content: image(art('sketch', 190, 2048, 1536, 'assembly → one line')), ai: ['t_interface'] });
  F({ id: 'f_sketch_scan_pdf', provider: HM, rel: `Sketches/Scan ${ymd(19 * D)} 10.14.pdf`, added: 19 * D, content: pdf(
    [{ k: 'figure', art: art('scan', 40, 2480, 3508, 'book detail — availability first'), caption: 'Scanned page 1' }],
    [{ k: 'figure', art: art('scan', 40, 2480, 3508, 'loans — renew all'), caption: 'Scanned page 2' }]), ai: ['t_wireframes', 't_libraries'] });

  // — Desktop —
  F({ id: 'f_todo', provider: HM, rel: 'Desktop/todo.txt', added: 90 * D, modified: 3 * H, content: { t: 'text', text: TODO_TXT.trimStart() } });
  F({ id: 'f_screen_rec', provider: HM, rel: `Desktop/Screen Recording ${ymd(1 * D + 1 * H + 724e3)} at ${hms(1 * D + 1 * H + 724e3)}.webm`, added: 1 * D + 1 * H + 724e3, content: { t: 'media', duration: 41, note: 'Screen recording: windows fusing and separating on the desk.', art: art('screenshot', 262, 2880, 1800, 'desk — fuse & separate') }, ai: ['t_interface'] });
  F({ id: 'f_quick_sketch', provider: HM, rel: 'Desktop/quick-sketch.png', added: 2 * D + 4 * H, content: image(art('sketch', 190, 1600, 1200, 'widget dial for orbit')), ai: ['t_interface'] });

  // ════════════════════════════════════════════════════════════════════════
  // downloads — /home/magnus/Downloads (flat; everything here is received)
  // ════════════════════════════════════════════════════════════════════════
  const DL = 'downloads' as const;
  const ADA_SHOT = 14 * H + 17 * M + 23e3;
  F({ id: 'f_p_halvorsen', provider: DL, rel: 'Halvorsen_2024_peripheral-interfaces.pdf', source: 'Firefox · arxiv.org', kept: true, added: 12 * D, content: P_HALVORSEN, ai: ['t_paper', 't_attention', 't_interface'], tags: ['p_important'], summary: 'Preprint: windows simplify with distance from the attention lens; peripheral layout cut task resumption time.' });
  F({ id: 'f_p_leroy', provider: DL, rel: 'Leroy_2009_attention-residue.pdf', source: 'Firefox · sciencedirect.com', kept: true, added: 18 * D, content: P_LEROY, ai: ['t_paper', 't_attention'], summary: 'Experiments showing attention residue from unfinished tasks lowers performance on the next task.' });
  F({ id: 'f_p_glance', provider: DL, rel: '2503.11427v1.pdf', source: 'Firefox · arxiv.org', kept: true, added: 9 * D, content: P_GLANCE, ai: ['t_paper', 't_previews', 't_pim'], summary: 'Log study: inline previews cut files opened per re-finding episode from 2.3 to 1.4.' });
  F({ id: 'f_p_context', provider: DL, rel: '2507.02281v2.pdf', source: 'Firefox · arxiv.org', kept: false, added: 3 * H, content: P_CONTEXT, ai: ['t_paper', 't_pim'], tags: ['p_toread'], summary: 'File suggestions from co-occurrence, workspace affinity and recency beat a recency-only baseline.' });

  F({ id: 'f_lantern_feedback_r2', provider: DL, rel: 'Lantern_feedback_round2.docx', source: 'Mail · Sofie Brandt (Lantern)', kept: false, added: 6 * H,
    content: doc(
      { k: 'title', text: 'Lantern — feedback on round 1 concepts' },
      { k: 'p', text: 'Written up after our review, with input from Jens and the branch services team. Numbered so we can track them.' },
      { k: 'h', text: 'Identity' },
      { k: 'li', text: '1. Lamp mark B — yes. Please show it at 16 px (app tab bar) and on the bus-stop poster format.' },
      { k: 'li', text: '2. The amber feels too orange on our printed signage, especially next to the municipal blue. Can we try something deeper?' },
      { k: 'li', text: '3. We need the wordmark in one colour for print, embroidery and the tote bags.' },
      { k: 'h', text: 'App' },
      { k: 'li', text: '4. Search: the filter chips are great. "Available nearby" confused several people — nearby to what?' },
      { k: 'li', text: '5. Book detail: availability per branch must be visible without scrolling. This is the number one support question.' },
      { k: 'li', text: '6. Loans: renew-all is wanted, but please confirm before renewing; some loans cannot be renewed.' },
      { k: 'h', text: 'Accessibility' },
      { k: 'li', text: '7. Our accessibility panel will test round 2 with screen-reader users. VoiceOver labels in the prototype, please.' },
      { k: 'li', text: '8. Body text in the app at least 18 px.' },
      { k: 'h', text: 'Timing' },
      { k: 'p', text: 'Board meeting on the 14th — round 2 deck a week before would be ideal. Q3 usage report attached separately.' },
      { k: 'sign', text: 'Sofie Brandt · Digital lead, Lantern' },
    ), ai: ['t_branding', 't_accessibility', 't_libraries'], tags: ['p_lantern', 'p_important'],
    summary: 'Eight numbered comments from Lantern: keep mark B, deeper amber, one-colour wordmark, clarify "Available nearby".' });
  F({ id: 'f_ada_screenshot', provider: DL, rel: `Screenshot from ${ymd(ADA_SHOT)} ${hms(ADA_SHOT).split('.').join('-')}.png`, source: 'Signal · Ada Lindqvist', kept: false, added: ADA_SHOT,
    content: image(art('screenshot', 215, 1920, 1080, 'Orbit — perihelion jitter')), ai: ['t_physics'], summary: 'Ada’s screenshot of orbit at 64x with Mercury visibly jittering near perihelion.' });
  F({ id: 'f_untitled_png', provider: DL, rel: 'Untitled.png', source: 'Firefox · lantern.app', kept: false, added: 1 * H, content: image(art('screenshot', 38, 1170, 2532, 'Lantern — Search (live)')), ai: ['t_libraries'] });
  const reportPdf = pdf(
    [{ k: 'title', text: 'Lantern — Q3 2026 usage report' }, { k: 'authors', text: 'Lantern Library Consortium · Digital team' },
     { k: 'abstract', text: 'Monthly active users rose 9% on Q2. Search remains the most used feature; "where is this book available" is still the top support question.' },
     { k: 'table', rows: [['Metric', 'Q2', 'Q3', 'Δ'], ['Monthly active users', '41,200', '44,900', '+9%'], ['Searches / user / month', '6.1', '6.4', '+5%'], ['Renewals in app', '58%', '63%', '+5 pt'], ['Event sign-ups in app', '2,310', '2,140', '−7%']] }],
    [{ k: 'h', text: 'Support questions' }, { k: 'p', text: 'Top three: availability at a specific branch (31%), renewing a loan that cannot be renewed (14%), forgotten PIN (11%).' },
     { k: 'figure', art: art('chart', 38, 1600, 900, 'MAU by month'), caption: 'Monthly active users, January–September.' }],
  );
  F({ id: 'f_report', provider: DL, rel: 'report.pdf', source: 'Mail · Sofie Brandt (Lantern)', kept: true, added: 5 * D, content: reportPdf, ai: ['t_libraries'], tags: ['p_lantern'], summary: 'Lantern Q3 usage report: MAU +9%, availability is the top support question.' });
  F({ id: 'f_report_1', provider: DL, rel: 'report (1).pdf', source: 'Mail · Sofie Brandt (Lantern)', kept: false, added: 9 * H, content: reportPdf, ai: ['t_libraries'], summary: 'Identical to report.pdf — the Q3 usage report, downloaded again.' });
  F({ id: 'f_ticket', provider: DL, rel: `ticket-AAR-CPH-${ymd(-5 * D)}.pdf`, source: 'Mail · DSB', kept: false, added: 20 * H,
    content: pdf([{ k: 'title', text: 'Your ticket — Aarhus H → København H' }, { k: 'authors', text: `Order 7741-2290-15 · ${dmy(-5 * D)}` },
      { k: 'table', rows: [['', 'Departure', 'Arrival', 'Train', 'Seat'], ['Outbound', `Aarhus H 07:02`, 'København H 09:58', 'IC 115', 'Car 3 · seat 64 (quiet zone)'], ['Return', 'København H 17:30', 'Aarhus H 20:26', 'IC 150', 'Car 5 · seat 21']] },
      { k: 'p', text: '1 adult · Standard · Orange Fri ticket. Valid only on the departures shown. Show this ticket and photo ID on request.' },
      { k: 'figure', art: art('diagram', 0, 600, 600, 'QR'), caption: 'Scan at the platform gate.' }]),
    ai: ['t_travel'], summary: 'Return train ticket Aarhus–Copenhagen for the Slow Interfaces talk day.' });
  F({ id: 'f_invoice_0142', provider: DL, rel: 'invoice-0142.pdf', source: 'Thunderbird · accounting@printhaus.dk', kept: false, added: 26 * H,
    content: pdf([{ k: 'title', text: 'Invoice 0142' }, { k: 'authors', text: `Printhaus Aarhus ApS · CVR 38 11 42 90 · issued ${dmy(26 * H)} · due in 14 days` },
      { k: 'p', text: 'Bill to: Studio Nordlys ApS, Mejlgade 41, 8000 Aarhus C. Reference: Lantern proofs.' },
      { k: 'table', rows: [['Item', 'Qty', 'Unit', 'Amount (DKK)'], ['Poster proofs A2, uncoated 120 g', '6', '95.00', '570.00'], ['Colour test strip, 3 ambers', '2', '140.00', '280.00'], ['Tote bag screen-print sample', '1', '450.00', '450.00'], ['Subtotal', '', '', '1,300.00'], ['VAT 25%', '', '', '325.00'], ['Total', '', '', '1,625.00']] },
      { k: 'p', text: 'Payment to Danske Bank reg. 3409 acct. 0012 448 913. Please quote invoice number.' }]),
    ai: ['t_invoices', 't_finance'], tags: ['p_tax'], summary: 'Printhaus invoice for Lantern poster proofs and colour tests, DKK 1,625 incl. VAT.' });
  F({ id: 'f_speaker_pack', provider: DL, rel: 'speaker-pack-slow-interfaces-2026.pdf', source: 'Mail · Slow Interfaces', kept: true, added: 30 * H,
    content: pdf([{ k: 'title', text: 'Slow Interfaces 2026 — speaker pack' }, { k: 'authors', text: 'Kulturværftet stage B · Copenhagen' },
      { k: 'p', text: 'Thank you for speaking. Your slot: "Desks without workspaces", 25 minutes plus 5 for questions, stage B, 11:20.' },
      { k: 'h', text: 'Technical' }, { k: 'p', text: 'Projector 1920×1080 over HDMI or USB-C. Bring your own adapter. A clicker is provided. Please send slides as PDF backup by the day before.' },
      { k: 'h', text: 'Travel & hotel' }, { k: 'p', text: 'We cover train travel within Denmark and one night at the partner hotel. Send receipts to the finance contact within 30 days.' }],
      [{ k: 'h', text: 'Schedule' }, { k: 'table', rows: [['Time', 'Session'], ['09:30', 'Doors & coffee'], ['10:00', 'Opening keynote'], ['11:20', 'Desks without workspaces — Magnus'], ['12:00', 'Lunch'], ['15:30', 'Panel: calm technology']] }]),
    ai: ['t_presentation', 't_travel'], summary: 'Speaker pack: 11:20 slot on stage B, 1920×1080 projector, PDF backup due the day before.' });
  F({ id: 'f_signal_photo', provider: DL, rel: `signal-${ymd(40 * H)}-183302.jpg`, source: 'Signal · Ada Lindqvist', kept: false, added: 40 * H, content: image(art('photo', 205, 3024, 4032, 'Ada’s laptop running orbit')), ai: ['t_photography'] });
  F({ id: 'f_podcast', provider: DL, rel: 'ep-117-the-desktop-is-dead-again.mp3', source: 'Firefox · hypertexthour.fm', kept: false, added: 44 * H,
    content: { t: 'media', duration: 3412, artist: 'Hypertext Hour', note: 'Ep. 117 — The desktop is dead (again). A history of attempts to replace the desktop metaphor, from Lifestreams to tiling window managers.', art: art('logo', 300, 1400, 1400, 'HH 117') },
    ai: ['t_interface', 't_pim'], summary: 'Podcast episode on attempts to replace the desktop metaphor, from Lifestreams to tiling WMs.' });

  const bankLines: [string, string, number][] = [
    ['01.09.2026', 'Husleje Mejlgade 41', -14500], ['02.09.2026', 'Printhaus Aarhus ApS', -2180], ['03.09.2026', 'Kalkbrud ApS — INV-2026-014', 58593.75],
    ['05.09.2026', 'Nextcloud hosting', -189], ['08.09.2026', 'DSB', -598], ['10.09.2026', 'Løn Magnus', -38000],
    ['10.09.2026', 'Rasmus Holm — illustration (faktura 31)', -12500], ['12.09.2026', 'Fraunces — donation til font', -250], ['15.09.2026', 'Aarhus Jazz Week — INV-2026-015', 27500],
    ['18.09.2026', 'Kontorartikler', -436.75], ['22.09.2026', 'Erhvervsforsikring', -2210], ['25.09.2026', 'Moms Q2', -31240],
    ['28.09.2026', 'Harbour Museum — depositum Q-2026-034', 18750], ['30.09.2026', 'Gebyr', -45],
  ];
  let saldo = 200720.4;
  F({ id: 'f_bank_csv', provider: DL, rel: 'kontoudtog_2026-09.csv', source: 'Firefox · netbank', kept: true, added: 28 * D,
    content: { t: 'sheet', columns: ['Dato', 'Tekst', 'Beløb', 'Saldo'], rows: bankLines.map(([d, t, a]) => { saldo = Math.round((saldo + a) * 100) / 100; return [d, t, a, saldo]; }) },
    ai: ['t_finance'], tags: ['p_tax'], summary: 'September 2026 business account export: rent, salaries, VAT and three client payments.' });
  F({ id: 'f_forskud', provider: DL, rel: 'forskudsopgoerelse-2026.pdf', source: 'Firefox · skat.dk', kept: true, added: 40 * D,
    content: pdf([{ k: 'title', text: 'Forskudsopgørelse 2026' }, { k: 'authors', text: 'Skattestyrelsen · preliminary income assessment' },
      { k: 'table', rows: [['Item', 'DKK'], ['Personal income (salary)', '456,000'], ['Labour market contribution 8%', '−36,480'], ['Pension contribution', '−24,000'], ['Expected tax', '166,920'], ['Withheld so far', '139,100']] },
      { k: 'p', text: 'Check the figures and change them in TastSelv if your income changes during the year.' }]),
    ai: ['t_finance'], tags: ['p_tax'] });
  F({ id: 'f_lease', provider: DL, rel: 'studio-lease-2025-signed.pdf', source: 'Mail · Mejlgade Ejendomme', kept: true, added: 300 * D,
    content: pdf([{ k: 'title', text: 'Lease agreement — commercial premises' }, { k: 'authors', text: 'Mejlgade Ejendomme A/S and Studio Nordlys ApS' },
      { k: 'h', text: '§1 Premises' }, { k: 'p', text: 'Studio 2, 2nd floor, Mejlgade 41, 8000 Aarhus C. 64 m², shared kitchen and meeting room.' },
      { k: 'h', text: '§2 Term' }, { k: 'p', text: 'The lease runs from 1 January 2025 and may be terminated by the tenant with six months’ notice.' }],
      [{ k: 'h', text: '§3 Rent' }, { k: 'p', text: 'DKK 14,500 per month including heating, payable in advance on the first weekday of each month. Deposit equals three months’ rent.' },
       { k: 'h', text: '§4 Maintenance' }, { k: 'p', text: 'The landlord maintains the building, roof, windows and heating installation. The tenant maintains interior surfaces.' },
       { k: 'h', text: 'Signatures' }, { k: 'p', text: 'Signed electronically by both parties.' }]),
    ai: ['t_contracts'], tags: ['p_personal'], summary: 'Signed studio lease at Mejlgade 41: DKK 14,500/month incl. heating, landlord maintains heating.' });
  F({ id: 'f_node_tar', provider: DL, rel: 'node-v22.11.0-linux-x64.tar.gz', source: 'Firefox · nodejs.org', kept: false, added: 35 * D,
    content: { t: 'archive', entries: [
      { path: 'node-v22.11.0-linux-x64/bin/node', size: 118_420_416 }, { path: 'node-v22.11.0-linux-x64/bin/npm', size: 54 }, { path: 'node-v22.11.0-linux-x64/bin/npx', size: 54 }, { path: 'node-v22.11.0-linux-x64/bin/corepack', size: 81 },
      { path: 'node-v22.11.0-linux-x64/include/node/node.h', size: 61_204 }, { path: 'node-v22.11.0-linux-x64/lib/node_modules/npm/package.json', size: 5_822 },
      { path: 'node-v22.11.0-linux-x64/lib/node_modules/corepack/package.json', size: 2_914 }, { path: 'node-v22.11.0-linux-x64/share/man/man1/node.1', size: 26_118 },
      { path: 'node-v22.11.0-linux-x64/README.md', size: 39_644 }, { path: 'node-v22.11.0-linux-x64/LICENSE', size: 114_870 }, { path: 'node-v22.11.0-linux-x64/CHANGELOG.md', size: 371_002 }] },
    ai: ['t_tooling'] });
  F({ id: 'f_fraunces_zip', provider: DL, rel: 'Fraunces.zip', source: 'Firefox · fonts.google.com', kept: true, added: 50 * D,
    content: { t: 'archive', entries: [
      { path: 'Fraunces-VariableFont_SOFT,WONK,opsz,wght.ttf', size: 1_612_040 }, { path: 'Fraunces-Italic-VariableFont_SOFT,WONK,opsz,wght.ttf', size: 1_701_552 },
      { path: 'static/Fraunces_72pt-Regular.ttf', size: 168_220 }, { path: 'static/Fraunces_72pt-SemiBold.ttf', size: 170_884 }, { path: 'static/Fraunces_9pt-Regular.ttf', size: 166_010 },
      { path: 'static/Fraunces_9pt-Italic.ttf', size: 171_442 }, { path: 'OFL.txt', size: 4_388 }, { path: 'README.txt', size: 2_960 }] },
    ai: ['t_typography', 't_branding'], tags: ['p_lantern'], summary: 'Fraunces variable font family (OFL) — the Lantern display typeface.' });
  F({ id: 'f_inter_zip', provider: DL, rel: 'Inter-4.1.zip', source: 'Firefox · github.com', kept: true, added: 50 * D - 10 * M,
    content: { t: 'archive', entries: [
      { path: 'InterVariable.ttf', size: 874_708 }, { path: 'InterVariable-Italic.ttf', size: 905_284 }, { path: 'web/InterVariable.woff2', size: 352_240 },
      { path: 'web/InterVariable-Italic.woff2', size: 387_184 }, { path: 'web/inter.css', size: 1_842 }, { path: 'extras/otf/Inter-Regular.otf', size: 318_560 },
      { path: 'extras/otf/Inter-SemiBold.otf', size: 322_104 }, { path: 'LICENSE.txt', size: 4_380 }, { path: 'help.txt', size: 1_206 }] },
    ai: ['t_typography'] });
  F({ id: 'f_lantern_logo_zip', provider: DL, rel: 'lantern-logo-pack-2019.zip', source: 'Firefox · lantern.app', kept: false, added: 45 * D,
    content: { t: 'archive', entries: [
      { path: 'Lantern logo 2019/lantern-logo-rgb.png', size: 84_220 }, { path: 'Lantern logo 2019/lantern-logo-cmyk.eps', size: 1_210_884 }, { path: 'Lantern logo 2019/lantern-logo-white.png', size: 61_002 },
      { path: 'Lantern logo 2019/lantern-app-icon.png', size: 212_540 }, { path: 'Lantern logo 2019/Lantern_designguide_2019.pdf', size: 3_822_110 }, { path: 'Lantern logo 2019/__MACOSX/._lantern-logo-rgb.png', size: 212 }] },
    ai: ['t_branding', 't_libraries'], tags: ['p_lantern'], summary: 'The previous (2019) Lantern logo files and design guide from the client’s press page.' });
  F({ id: 'f_wcag_pdf', provider: DL, rel: 'WCAG-2.2-quickref.pdf', source: 'Firefox · w3.org', kept: true, added: 25 * D,
    content: pdf([{ k: 'title', text: 'WCAG 2.2 — quick reference (printed)' }, { k: 'authors', text: 'Saved from w3.org · filtered to level AA' },
      { k: 'h', text: '1.4.3 Contrast (Minimum) — AA' }, { k: 'p', text: 'Text has a contrast ratio of at least 4.5:1; large text at least 3:1.' },
      { k: 'h', text: '2.5.8 Target Size (Minimum) — AA' }, { k: 'p', text: 'Targets are at least 24 by 24 CSS pixels, with listed exceptions.' }],
      [{ k: 'h', text: '2.4.11 Focus Not Obscured (Minimum) — AA' }, { k: 'p', text: 'When a component receives keyboard focus, it is not entirely hidden by author-created content.' },
       { k: 'h', text: '3.3.8 Accessible Authentication (Minimum) — AA' }, { k: 'p', text: 'No cognitive function test is required for any step of authentication unless an alternative or assistance is provided.' }]),
    ai: ['t_accessibility'], tags: ['p_lantern'], summary: 'Printed WCAG 2.2 AA quick reference: contrast, target size, focus and authentication criteria.' });
  F({ id: 'f_label_manual', provider: DL, rel: 'label-printer-manual-EN.pdf', source: 'Firefox · support.labelworks.com', kept: false, added: 410 * D,
    content: pdf([{ k: 'title', text: 'LW-400 Label Printer — User Guide' }, { k: 'h', text: 'Loading labels' }, { k: 'p', text: 'Open the cover, insert the label roll with the spool guides facing outwards, and feed the end into the slot until the printer pulls it in.' }],
      [{ k: 'h', text: 'Troubleshooting' }, { k: 'table', rows: [['Light', 'Meaning', 'Fix'], ['Blinking blue', 'Label jam', 'Open cover, remove roll, reinsert'], ['Solid red', 'No labels', 'Load a new roll'], ['Off', 'No power', 'Check the USB cable']] }]),
    ai: ['t_tooling'] });
  F({ id: 'f_heic', provider: DL, rel: 'IMG_0213.HEIC', source: 'Signal · Mor', kept: false, added: 200 * D, content: image(art('photo', 110, 4032, 3024, 'garden in May')), ai: ['t_photography'], tags: ['p_personal'] });
  F({ id: 'f_wallpaper', provider: DL, rel: 'wallpaper-aurora-5k.jpg', source: 'Firefox · unsplash.com', kept: false, added: 520 * D, content: image(art('photo', 150, 5120, 2880, 'aurora over a fjord')), ai: ['t_photography'] });
  F({ id: 'f_receipt_tools', provider: DL, rel: `receipt-${ymd(78 * D)}.pdf`, source: 'Mail · orders@toolshop.dk', kept: false, added: 78 * D,
    content: pdf([{ k: 'title', text: 'Order receipt #TS-558190' }, { k: 'table', rows: [['Item', 'Qty', 'DKK'], ['Cutting mat A1', '1', '389.00'], ['Steel ruler 100 cm', '1', '219.00'], ['Masking tape 25 mm × 6', '1', '84.00'], ['Total incl. VAT', '', '692.00']] }]),
    ai: ['t_finance'], tags: ['p_tax'] });
  F({ id: 'f_energy_chart', provider: DL, rel: 'image.png', source: 'Mail · Ada Lindqvist', kept: false, added: 60 * D, content: image(art('chart', 215, 1600, 900, 'total energy drift, Euler vs Verlet')), ai: ['t_physics'], summary: 'Chart from Ada comparing energy drift of Euler and Verlet integration in orbit.' });
  F({ id: 'f_ada_bug_webm', provider: DL, rel: 'orbit-jitter-64x.webm', source: 'Mail · Ada Lindqvist', kept: false, added: 8 * D, content: { t: 'media', duration: 23, note: 'Ada’s screen recording: Mercury jittering at 64x speed.', art: art('screenshot', 215, 1920, 1080, 'Orbit — 64x') }, ai: ['t_physics'] });
  F({ id: 'f_boarding', provider: DL, rel: 'boarding-pass-CPH-OSL.pdf', source: 'Mail · SAS', kept: false, added: 430 * D,
    content: pdf([{ k: 'title', text: 'Boarding pass — CPH → OSL' }, { k: 'table', rows: [['Flight', 'Date', 'Boarding', 'Gate', 'Seat'], ['SK 1462', dmy(431 * D), '08:15', 'C33', '14A']] }, { k: 'figure', art: art('diagram', 0, 600, 600, 'barcode'), caption: '' }]),
    ai: ['t_travel'] });
  F({ id: 'f_contract_template', provider: DL, rel: 'contract-template-freelance.docx', source: 'Mail · Designers’ union newsletter', kept: false, added: 100 * D,
    content: doc({ k: 'title', text: 'Freelance agreement — template' }, { k: 'p', text: 'This agreement is between [Client] and [Designer] for the services described in Appendix 1.' },
      { k: 'h', text: 'Rights' }, { k: 'p', text: 'Copyright remains with the designer. The client receives a non-exclusive licence for the uses described, effective on full payment.' },
      { k: 'h', text: 'Payment' }, { k: 'p', text: 'Invoices are payable net 14 days. Late payment interest follows the Danish Interest Act.' }),
    ai: ['t_contracts'] });
  F({ id: 'f_timesheet_tpl', provider: DL, rel: 'timesheet-template.xlsx', source: 'Mail · Rasmus Holm', kept: false, added: 150 * D,
    content: { t: 'sheet', columns: ['Date', 'Project', 'Task', 'Hours', 'Billable'], rows: [['', '', '', 0, 'yes'], ['', '', '', 0, 'yes'], ['', '', '', 0, 'no'], ['', '', '', 0, 'yes'], ['', '', '', 0, 'yes'], ['', '', '', 0, 'yes'], ['', '', '', 0, 'yes'], ['Total', '', '', 0, '']] } });

  // ════════════════════════════════════════════════════════════════════════
  // nextcloud — nextcloud://studio
  // ════════════════════════════════════════════════════════════════════════
  const NC = 'nextcloud' as const;
  dir('d_nc_clients', NC, 'Clients', 900 * D);
  dir('d_lantern', NC, 'Clients/Lantern', 48 * D, { tags: ['p_lantern'], summary: 'Everything for the Lantern brand & app refresh: brief, brand, moodboard, wireframes, presentations, feedback.' });
  dir('d_lantern_brief', NC, 'Clients/Lantern/Brief', 48 * D);
  dir('d_lantern_brand', NC, 'Clients/Lantern/Brand', 30 * D);
  dir('d_lantern_mood', NC, 'Clients/Lantern/Moodboard', 40 * D);
  dir('d_lantern_wf', NC, 'Clients/Lantern/Wireframes', 21 * D);
  dir('d_lantern_pres', NC, 'Clients/Lantern/Presentation', 16 * D);
  dir('d_lantern_feedback', NC, 'Clients/Lantern/Feedback', 14 * D);
  dir('d_nc_admin', NC, 'Admin', 900 * D);
  dir('d_nc_invoices', NC, 'Admin/Invoices', 800 * D);
  dir('d_nc_quotes', NC, 'Admin/Quotes', 800 * D);
  dir('d_nc_contracts', NC, 'Admin/Contracts', 800 * D);
  dir('d_nc_timesheets', NC, 'Admin/Timesheets', 800 * D);
  dir('d_nc_tax', NC, 'Admin/Tax 2026', 300 * D, { tags: ['p_tax'] });
  dir('d_nc_shared', NC, 'Shared', 900 * D);

  // — Lantern brief: v1 → v2 → v3-FINAL —
  const brief = (v: 1 | 2 | 3): Content => {
    const head: PdfBlock[] = [
      { k: 'title', text: 'Lantern — Brand & App Refresh' },
      { k: 'authors', text: `Creative brief · Lantern Library Consortium · prepared by Sofie Brandt, Digital lead · ${v === 3 ? 'v3 FINAL' : `draft v${v}`}` },
      { k: 'abstract', text: 'Lantern is the shared library app for fourteen municipal libraries in East Jutland. Ten years after launch, it looks dated and readers struggle to find out where a book is available. We want a refreshed identity and a redesign of the core app flows that makes borrowing feel as calm as a reading room — for every reader.' },
      { k: 'h', text: 'Background' },
      { k: 'p', text: 'The app has around 45,000 monthly users, mostly on phones. It handles search, loans, reservations and event sign-ups for all fourteen branches. The current identity dates from 2019 and was designed for print first; the app icon is illegible at small sizes.' },
    ];
    const goals: PdfBlock[] = [
      { k: 'h', text: 'Goals' },
      { k: 'table', rows: v === 1
        ? [['Goal', 'Measure'], ['Modern look', 'Positive board feedback'], ['More app usage', 'MAU']]
        : [['Goal', 'Measure'], ['Readers find where a book is available in one step', 'Support questions on availability −50%'], ['A recognisable mark that works at 16 px and on a bus stop', 'Recognition test with 30 readers'], ['Accessible to readers with low vision and dyslexia', 'WCAG 2.2 AA, panel test pass'], ['More renewals in the app', 'Renewals in app ≥ 70%']] },
      { k: 'h', text: 'Audiences' },
      { k: 'p', text: v === 1 ? 'Library members of all ages.' : 'Families booking events; students reserving course books; older readers who renew loans and often use larger text sizes; branch staff who answer questions about the app at the desk.' },
    ];
    const scope: PdfBlock[] = [
      { k: 'h', text: 'Scope' },
      { k: 'table', rows: [['Deliverable', 'Notes'], ['Identity refresh', 'Mark, wordmark, colour, type, brand guidelines'], ['App: Search', 'Filters, availability per branch'], ['App: Book detail', 'Availability above the fold, reserve'], ['App: Loans', 'Renew, renew-all, reminders'],
        ...(v === 1 ? [['Website redesign', 'All pages']] : []), ...(v === 3 ? [['App: Events', 'Listing and sign-up (phase 3)']] : [])] },
      ...(v >= 2 ? [
        { k: 'h', text: 'Constraints' } as PdfBlock,
        { k: 'p', text: 'WCAG 2.2 AA throughout; body text at least 18 px in the app. Danish and English. Must work with the existing React Native codebase and the consortium’s catalogue API; offline cache of loans. The identity must work in one colour for print and embroidery.' } as PdfBlock,
      ] : []),
    ];
    const plan: PdfBlock[] = [
      { k: 'h', text: 'Timeline & budget' },
      { k: 'table', rows: v === 3
        ? [['Phase', 'Weeks', 'Output'], ['1. Discovery & concepts', '1–4', 'Moodboard, marks A–F, wireframes'], ['2. Refinement', '5–8', 'Round 2 deck, guidelines v1'], ['3. Delivery', '9–12', 'Guidelines v1.2, UI kit, events flow']]
        : [['Phase', 'Weeks'], ['Concepts', '1–4'], ['Refinement', '5–8'], ['Delivery', '9–10']] },
      { k: 'p', text: v === 1 ? 'Budget to be confirmed after the first meeting.' : v === 2 ? 'Budget: DKK 380,000 excl. VAT.' : 'Budget: DKK 420,000 excl. VAT, as quoted in Q-2026-031, including the events flow in phase 3.' },
      { k: 'figure', art: art('screenshot', 38, 1170, 2532, 'Lantern — current search'), caption: 'The current app’s search screen: availability is hidden behind “More”.' },
      { k: 'h', text: 'Contacts' },
      { k: 'p', text: 'Sofie Brandt, Digital lead (decisions, feedback). Jens Kier, Branch services (staff testing). Accessibility panel coordinated by the consortium.' },
    ];
    if (v === 1) return pdf([...head, ...goals], [...scope, ...plan]);
    if (v === 2) return pdf(head, [...goals, ...scope.slice(0, 2)], [...scope.slice(2), ...plan]);
    return pdf(head, goals, scope, plan.slice(0, 3), plan.slice(3));
  };
  F({ id: 'f_brief_v1', provider: NC, rel: 'Clients/Lantern/Brief/lantern-brief-v1.pdf', added: 48 * D, content: brief(1), ai: ['t_branding', 't_libraries'], online: true, summary: 'First draft brief: modern look, website included, budget TBD.' });
  F({ id: 'f_brief_v2', provider: NC, rel: 'Clients/Lantern/Brief/lantern-brief-v2.pdf', added: 41 * D, content: brief(2), ai: ['t_branding', 't_libraries', 't_accessibility'], online: true, summary: 'Second draft: measurable goals, accessibility constraints, website dropped, DKK 380k.' });
  F({ id: 'f_brief_v3', provider: NC, rel: 'Clients/Lantern/Brief/lantern-brief-v3-FINAL.pdf', added: 34 * D, content: brief(3), ai: ['t_branding', 't_libraries', 't_accessibility'], online: false, tags: ['p_lantern', 'p_important'], summary: 'Final brief: identity refresh plus search, book detail, loans and events flows; WCAG 2.2 AA; DKK 420k.' });
  F({ id: 'f_kickoff_notes', provider: NC, rel: 'Clients/Lantern/Brief/kickoff-notes.md', added: 46 * D, content: md(`
# Lantern kickoff

- 14 branches, one app. Sofie owns decisions; Jens speaks for branch staff.
- Biggest pain: "is the book at *my* branch?" — staff answer this all day.
- They hate the current icon. "A yellow smudge."
- Older readers: large text, renewals. Students: reservations. Families: events.
- Website is a separate procurement — out of scope (to confirm in v2 brief).
- Next: v2 brief from Sofie, quote from us.
`), ai: ['t_meeting', 't_libraries'] });

  // — Brand —
  F({ id: 'f_guidelines', provider: NC, rel: 'Clients/Lantern/Brand/Lantern-brand-guidelines-v1.2.pdf', added: 9 * D, modified: 2 * D, online: false,
    content: pdf(
      [{ k: 'title', text: 'Lantern — Brand guidelines' }, { k: 'authors', text: 'Version 1.2 · Studio Nordlys for the Lantern Library Consortium' },
       { k: 'abstract', text: 'Lantern should feel like a reading room: warm, quiet, unhurried, and open to everyone. These guidelines cover the lamp mark, wordmark, colour, type, imagery and accessibility.' },
       { k: 'figure', art: art('logo', 34, 2400, 1200, 'Lantern'), caption: 'Primary lockup: lamp mark and Fraunces wordmark.' }],
      [{ k: 'h', text: '1. The lamp mark' }, { k: 'p', text: 'The mark is a lamp seen from above: a circle of light with a single opening that reads as an "L". It is drawn on a 24-unit grid and holds at 16 px.' },
       { k: 'h', text: 'Clear space & minimum size' }, { k: 'p', text: 'Keep clear space equal to the height of the opening on all sides. Minimum size: 16 px on screen, 6 mm in print. Never outline, rotate or add effects.' },
       { k: 'figure', art: art('diagram', 34, 1600, 900, 'clear space'), caption: 'Clear space equals the height of the opening.' }],
      [{ k: 'h', text: '2. Colour' }, { k: 'table', rows: [['Name', 'Hex', 'Use'], ['Lamp Amber', '#D98E2B', 'Mark, highlights, large display text'], ['Reading-room Ink', '#1F2A44', 'Text, UI'], ['Paper', '#F6F1E7', 'Backgrounds'], ['Stack Green', '#3E6B57', 'Availability, success'], ['Slate', '#5B6475', 'Secondary text']] },
       { k: 'p', text: 'v1.2: Lamp Amber deepened from #F2A93B after print tests on uncoated stock.' }],
      [{ k: 'h', text: '3. Typography' }, { k: 'p', text: 'Fraunces (soft, optical size 72) for display and the wordmark; Inter for interface and body text. App body text is 18 px minimum with 1.5 line height.' },
       { k: 'figure', art: art('moodboard', 30, 1600, 1000, 'Fraunces / Inter specimen'), caption: 'Type specimen.' }],
      [{ k: 'h', text: '4. Accessibility' }, { k: 'table', rows: [['Pair', 'Ratio', 'Allowed'], ['Ink on Paper', '13.2:1', 'All text'], ['Amber on Paper', '3.1:1', 'Large text only'], ['Paper on Stack Green', '5.6:1', 'All text'], ['Slate on Paper', '5.4:1', 'All text']] },
       { k: 'h', text: '5. Voice' }, { k: 'p', text: 'Plain, friendly Danish and English. Say "your loans", not "user account". Never use exclamation marks in errors.' }],
    ), ai: ['t_branding', 't_typography', 't_accessibility'], tags: ['p_lantern', 'p_important'],
    summary: 'Lantern brand guidelines v1.2: lamp mark, deeper Lamp Amber, Fraunces + Inter, contrast rules and voice.' });
  F({ id: 'f_logo_expl_1', provider: NC, rel: 'Clients/Lantern/Brand/lantern-logo-explorations-01.png', added: 27 * D, content: image(art('logo', 38, 2400, 1600, 'marks A–F')), ai: ['t_branding'], summary: 'Six candidate lamp marks (A–F) presented in round 1.' });
  F({ id: 'f_logo_expl_2', provider: NC, rel: 'Clients/Lantern/Brand/lantern-logo-explorations-02.png', added: 3 * D, content: image(art('logo', 32, 2400, 1600, 'mark B refinements')), ai: ['t_branding'], summary: 'Refinements of mark B at 16 px, poster size and one-colour.' });
  F({ id: 'f_wordmark', provider: NC, rel: 'Clients/Lantern/Brand/lantern-wordmark-final.svg', added: 2 * D, modified: 20 * H, online: false, content: image(art('logo', 32, 1200, 400, 'Lantern')), ai: ['t_branding', 't_typography'], tags: ['p_lantern'] });
  F({ id: 'f_app_icon', provider: NC, rel: 'Clients/Lantern/Brand/lantern-icon-1024.png', added: 2 * D, content: image(art('logo', 32, 1024, 1024, 'L')), ai: ['t_branding'] });
  F({ id: 'f_palette', provider: NC, rel: 'Clients/Lantern/Brand/lantern-palette.png', added: 9 * D, content: image(art('diagram', 32, 1600, 600, 'Amber · Ink · Paper · Stack Green · Slate')), ai: ['t_branding', 't_accessibility'] });

  // — Moodboard —
  F({ id: 'f_moodboard', provider: NC, rel: 'Clients/Lantern/Moodboard/moodboard-overview.jpg', added: 38 * D, online: false, content: image(art('moodboard', 36, 3000, 2000, 'reading room · warm light · wayfinding')), ai: ['t_branding', 't_libraries'], tags: ['p_inspiration'], summary: 'Moodboard: reading rooms, warm lamplight, card catalogues, paper textures and signage.' });
  F({ id: 'f_ref_reading', provider: NC, rel: 'Clients/Lantern/Moodboard/ref-reading-room.jpg', added: 39 * D, content: image(art('photo', 40, 4032, 3024, 'reading room')), ai: ['t_libraries', 't_photography'] });
  F({ id: 'f_ref_signage', provider: NC, rel: 'Clients/Lantern/Moodboard/ref-wayfinding-signage.jpg', added: 39 * D, content: image(art('photo', 210, 4032, 3024, 'wayfinding')), ai: ['t_branding'] });
  F({ id: 'f_ref_catalogue', provider: NC, rel: 'Clients/Lantern/Moodboard/ref-card-catalogue.jpg', added: 39 * D, content: image(art('photo', 28, 3024, 4032, 'card catalogue')), ai: ['t_libraries'] });
  F({ id: 'f_ref_paper', provider: NC, rel: 'Clients/Lantern/Moodboard/ref-paper-textures.jpg', added: 39 * D, content: image(art('scan', 42, 3508, 2480, 'paper textures')), ai: ['t_branding'] });
  F({ id: 'f_ref_light', provider: NC, rel: 'Clients/Lantern/Moodboard/ref-warm-light.jpg', added: 39 * D, content: image(art('photo', 34, 4032, 3024, 'lamplight')), ai: ['t_branding', 't_photography'] });

  // — Wireframes —
  const wf = (id: string, n: string, slug: string, label: string, ago: number, summary?: string) =>
    F({ id, provider: NC, rel: `Clients/Lantern/Wireframes/wf-${n}-${slug}.png`, added: ago, content: image(art('wireframe', 38, 1170, 2532, label)), ai: ['t_wireframes', 't_libraries'], ...(summary ? { summary } : {}) });
  wf('f_wf_home', '01', 'home', 'Lantern — Home (wf)', 20 * D);
  wf('f_wf_search', '02', 'search', 'Lantern — Search (wf)', 20 * D, 'Search wireframe: filter chips, "At my branches" toggle, results with availability.');
  wf('f_wf_detail', '03', 'book-detail', 'Lantern — Book detail (wf)', 3 * D, 'Book detail wireframe with per-branch availability above the fold.');
  wf('f_wf_loans', '04', 'loans', 'Lantern — Loans (wf)', 19 * D);
  wf('f_wf_events', '05', 'events', 'Lantern — Events (wf)', 19 * D);
  F({ id: 'f_flows_pdf', provider: NC, rel: 'Clients/Lantern/Wireframes/lantern-flows.pdf', added: 18 * D,
    content: pdf(
      [{ k: 'title', text: 'Lantern — core flows' }, { k: 'authors', text: 'Round 1 · wireframes' }, { k: 'figure', art: art('wireframe', 38, 2400, 1400, 'search → detail → reserve'), caption: 'Flow 1: search to reservation in three steps.' }],
      [{ k: 'figure', art: art('wireframe', 38, 2400, 1400, 'loans → renew all → confirm'), caption: 'Flow 2: renew all, with confirmation listing non-renewable loans.' }, { k: 'p', text: 'Open question: should reminders offer one-tap renew from the notification?' }]),
    ai: ['t_wireframes', 't_libraries'], summary: 'Two flow diagrams: search to reservation, and renew-all with confirmation.' });

  // — Presentation —
  const conceptSlides = [
    { title: 'Lantern — a reading room in your pocket', bullets: ['Round 1 concepts', 'Studio Nordlys'], art: art('logo', 38, 1920, 1080, 'Lantern') },
    { title: 'What we heard', bullets: ['“Is it at my branch?” is the number one question', 'The icon is a yellow smudge at small sizes', 'Older readers live in large text mode'] },
    { title: 'Principles', bullets: ['Calm over clever', 'Readable by everyone', 'Every library is local'] },
    { title: 'Identity: six lamp marks', bullets: ['A–F, from literal to abstract', 'All drawn to hold at 16 px'], art: art('logo', 38, 1920, 1080, 'marks A–F') },
    { title: 'Colour & type', bullets: ['Lamp Amber, Reading-room Ink, Paper, Stack Green', 'Fraunces for warmth, Inter for clarity'], art: art('moodboard', 36, 1920, 1080, 'palette + type') },
    { title: 'Search', bullets: ['Filter chips', 'Availability on every result'], art: art('wireframe', 38, 1920, 1080, 'search') },
    { title: 'Book detail', bullets: ['Where can I get it — first', 'Reserve in one tap'], art: art('wireframe', 38, 1920, 1080, 'book detail') },
    { title: 'Loans & reminders', bullets: ['Renew all, with confirmation', 'Reminders three days before due'], art: art('wireframe', 38, 1920, 1080, 'loans') },
    { title: 'Next steps', bullets: ['Pick a mark', 'Feedback within a week', 'Round 2 in three weeks'] },
  ];
  F({ id: 'f_concept_pptx', provider: NC, rel: 'Clients/Lantern/Presentation/Lantern — concept presentation.pptx', added: 16 * D, modified: 15 * D, online: false, content: { t: 'slides', slides: conceptSlides }, ai: ['t_presentation', 't_branding'], tags: ['p_lantern'], summary: 'Round 1 concept deck: what we heard, principles, marks A–F, palette and type, three key screens.' });
  F({ id: 'f_concept_pdf', provider: NC, rel: 'Clients/Lantern/Presentation/Lantern-concept-presentation.pdf', added: 15 * D, content: pdf(...conceptSlides.map((s): PdfBlock[] => [{ k: 'h', text: s.title }, ...(s.bullets ?? []).map((b): PdfBlock => ({ k: 'p', text: '• ' + b })), ...(s.art ? [{ k: 'figure', art: s.art, caption: '' } as PdfBlock] : [])])), ai: ['t_presentation', 't_branding'], summary: 'PDF export of the round 1 concept deck sent to the client.' });
  F({ id: 'f_round2_pptx', provider: NC, rel: 'Clients/Lantern/Presentation/Lantern — round 2.pptx', added: 3 * D, modified: 4 * H, online: false,
    content: { t: 'slides', slides: [
      { title: 'Lantern — round 2', bullets: ['Refinements after your feedback'], art: art('logo', 32, 1920, 1080, 'Lantern') },
      { title: 'What changed', bullets: ['Deeper Lamp Amber for print', 'One-colour wordmark', '“At my branches” replaces “Available nearby”'] },
      { title: 'Mark B at every size', bullets: ['16 px tab bar', 'App icon', 'Bus-stop poster'], art: art('logo', 32, 1920, 1080, 'mark B at 16 / 1024 / poster') },
      { title: 'Amber, deeper', bullets: ['#F2A93B → #D98E2B', 'Large text only on Paper (3.1:1)'], art: art('diagram', 32, 1920, 1080, 'amber proofs') },
      { title: 'Book detail', bullets: ['Availability per branch above the fold', 'VoiceOver reads branch, shelf and status'], art: art('wireframe', 38, 1920, 1080, 'book detail v2') },
      { title: 'Loans', bullets: ['Renew all → confirm, lists loans that cannot be renewed'], art: art('wireframe', 38, 1920, 1080, 'loans v2') },
      { title: 'Next', bullets: ['Accessibility panel test', 'Guidelines v1.2 → UI kit', 'Events flow in phase 3'] },
    ] }, ai: ['t_presentation', 't_branding', 't_accessibility'], tags: ['p_lantern', 'p_important'],
    summary: 'Round 2 deck in progress: deeper amber, one-colour wordmark, "At my branches", availability above the fold.' });

  // — Feedback —
  F({ id: 'f_feedback_r1', provider: NC, rel: 'Clients/Lantern/Feedback/client-feedback-round1.docx', added: 14 * D,
    content: doc({ k: 'title', text: 'Lantern — quick reactions to round 1' }, { k: 'p', text: 'Sent the evening after the presentation; full written feedback to follow.' },
      { k: 'li', text: 'Mark B stood out for everyone. D is too playful.' }, { k: 'li', text: 'Love Fraunces. Is it free? (Yes — OFL.)' },
      { k: 'li', text: 'Search chips: yes. Book detail: still hunting for availability.' }, { k: 'sign', text: 'Sofie' }),
    ai: ['t_branding'], tags: ['p_lantern'], summary: 'Sofie’s first reactions: mark B wins, Fraunces liked, availability still hard to find.' });
  F({ id: 'f_feedback_tracker', provider: NC, rel: 'Clients/Lantern/Feedback/feedback-tracker.xlsx', added: 13 * D, modified: 3 * H, online: false,
    content: { t: 'sheet', columns: ['#', 'Round', 'Area', 'Comment', 'From', 'Status', 'Owner'], rows: [
      [1, 1, 'Identity', 'Mark B preferred; D too playful', 'Sofie', 'Done', 'Magnus'],
      [2, 1, 'Typography', 'Is Fraunces licensed for print?', 'Sofie', 'Done', 'Magnus'],
      [3, 1, 'Book detail', 'Availability hard to find', 'Sofie', 'Done', 'Magnus'],
      [4, 2, 'Identity', 'Show mark at 16 px and poster', 'Sofie', 'In progress', 'Magnus'],
      [5, 2, 'Colour', 'Amber too orange in print', 'Jens', 'In progress', 'Magnus'],
      [6, 2, 'Identity', 'One-colour wordmark for print/embroidery', 'Sofie', 'Done', 'Magnus'],
      [7, 2, 'Search', '"Available nearby" unclear', 'Jens', 'In progress', 'Magnus'],
      [8, 2, 'Book detail', 'Availability per branch above the fold', 'Sofie', 'Done', 'Magnus'],
      [9, 2, 'Loans', 'Confirm before renew-all', 'Jens', 'Open', 'Magnus'],
      [10, 2, 'Accessibility', 'VoiceOver labels in prototype', 'Panel', 'Open', 'Magnus'],
      [11, 2, 'Accessibility', 'Body text ≥ 18 px', 'Panel', 'Done', 'Magnus'],
      [12, 2, 'Illustration', 'Empty-state spots', 'Sofie', 'Open', 'Rasmus'],
      [13, 2, 'Timing', 'Round 2 deck one week before board meeting', 'Sofie', 'Open', 'Magnus'],
    ] }, ai: ['t_branding', 't_accessibility'], tags: ['p_lantern'], summary: 'Tracker of 13 client comments across two rounds with status and owner.' });
  F({ id: 'f_lantern_contacts', provider: NC, rel: 'Clients/Lantern/contacts & links.md', added: 47 * D, content: md(`
# Lantern — contacts & links

- **Sofie Brandt** — digital lead · decisions, feedback
- **Jens Kier** — branch services · staff testing on branch tablets
- **Accessibility panel** — via the consortium office
- **Rasmus Holm** — illustration (subcontract)

Links
- Production app: lantern.app
- Catalogue API docs: shared in Mail, 3 weeks ago
- Board meeting: the 14th
`), ai: ['t_libraries'] });

  // — Admin —
  const clients = ['Kalkbrud', 'Harbour Museum', 'Aarhus Jazz Week', 'Kalkbrud', 'Design school', 'Harbour Museum'];
  const amounts = [46875, 18750, 22000, 46875, 9400, 31250, 46875, 18750, 22000, 46875, 12000, 18750, 31250, 46875, 22000, 9400, 18750, 105000, 106300];
  const invRows: (string | number)[][] = amounts.map((net, i) => {
    const n = i + 1, issuedAgo = n === 19 ? 1 * D : n === 18 ? 14 * D : (19 - n) * 16 * D + 2 * D;
    const status = n === 19 ? 'Draft' : n === 18 ? 'Paid' : n === 17 ? 'Sent' : 'Paid';
    return [`INV-2026-${String(n).padStart(3, '0')}`, n === 18 || n === 19 ? 'Lantern' : n === 17 ? 'Kalkbrud' : clients[i % clients.length], ymd(issuedAgo), ymd(issuedAgo - 14 * D), net, net * 0.25, net * 1.25, status];
  });
  F({ id: 'f_invoices_sheet', provider: NC, rel: 'Admin/Invoices/invoices-2026.xlsx', added: 300 * D, modified: 1 * D, online: false,
    content: { t: 'sheet', columns: ['Invoice', 'Client', 'Issued', 'Due', 'Net (DKK)', 'VAT (DKK)', 'Total (DKK)', 'Status'], rows: invRows },
    ai: ['t_invoices', 't_finance'], tags: ['p_tax', 'p_important'], summary: 'Register of all 19 invoices issued in 2026 with net, VAT and payment status.' });
  const invoicePdf = (no: string, client: string, ago: number, lines: [string, number][]) => {
    const net = lines.reduce((n, l) => n + l[1], 0);
    const fmt = (x: number) => x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return pdf([{ k: 'title', text: `Invoice ${no}` }, { k: 'authors', text: `Studio Nordlys ApS · Mejlgade 41, 8000 Aarhus C · CVR 41 22 87 06 · issued ${dmy(ago)}` },
      { k: 'p', text: `Bill to: ${client}. Payment terms: net 14 days.` },
      { k: 'table', rows: [['Description', 'Amount (DKK)'], ...lines.map((l) => [l[0], fmt(l[1])]), ['Net', fmt(net)], ['VAT 25%', fmt(net * 0.25)], ['Total', fmt(net * 1.25)]] },
      { k: 'p', text: 'Please transfer to reg. 3409 acct. 0011 905 228 and quote the invoice number. Thank you.' }]);
  };
  F({ id: 'f_inv_018', provider: NC, rel: 'Admin/Invoices/INV-2026-018 Lantern.pdf', added: 14 * D, content: invoicePdf('INV-2026-018', 'Lantern Library Consortium, att. Sofie Brandt', 14 * D, [['Phase 1 — discovery & concepts (Q-2026-031)', 105000]]), ai: ['t_invoices'], tags: ['p_tax'], summary: 'Phase 1 invoice to Lantern, DKK 131,250 incl. VAT.' });
  F({ id: 'f_inv_019', provider: NC, rel: 'Admin/Invoices/INV-2026-019 Lantern.pdf', added: 1 * D, modified: 22 * H, online: false, content: invoicePdf('INV-2026-019', 'Lantern Library Consortium, att. Sofie Brandt', 1 * D, [['Phase 2 — refinement, round 2 deck (Q-2026-031)', 105000], ['Print proofs (pass-through, Printhaus 0142)', 1300]]), ai: ['t_invoices'], tags: ['p_tax', 'p_lantern'], summary: 'Draft phase 2 invoice to Lantern including print proof pass-through.' });
  F({ id: 'f_inv_017', provider: NC, rel: 'Admin/Invoices/INV-2026-017 Kalkbrud.pdf', added: 2 * 16 * D + 2 * D, content: invoicePdf('INV-2026-017', 'Kalkbrud ApS', 34 * D, [['Website maintenance Q3', 9500], ['New product page design', 9250]]), ai: ['t_invoices'] });
  F({ id: 'f_quote_031', provider: NC, rel: 'Admin/Quotes/Q-2026-031 Lantern rebrand.pdf', added: 44 * D, online: false,
    content: pdf([{ k: 'title', text: 'Quote Q-2026-031 — Lantern brand & app refresh' }, { k: 'authors', text: `Studio Nordlys ApS · valid 30 days from ${dmy(44 * D)}` },
      { k: 'p', text: 'Based on creative brief v2 and the kickoff meeting. Prices excl. VAT.' },
      { k: 'table', rows: [['Phase', 'Content', 'DKK'], ['1. Discovery & concepts', 'Moodboard, six marks, wireframes, concept deck', '105,000'], ['2. Refinement', 'Round 2, guidelines v1', '105,000'], ['3. Delivery', 'Guidelines v1.2, UI kit, events flow', '168,000'], ['Illustration (subcontract)', 'Six spot illustrations', '42,000'], ['Total', '', '420,000']] }],
      [{ k: 'h', text: 'Terms' }, { k: 'p', text: 'Invoiced per phase on delivery. Two rounds of feedback per phase included. Rights transfer on full payment for the uses described in the brief.' }]),
    ai: ['t_finance', 't_contracts'], tags: ['p_lantern'], summary: 'Quote for the Lantern project: three phases plus illustration, DKK 420,000 excl. VAT.' });
  F({ id: 'f_quote_034', provider: NC, rel: 'Admin/Quotes/Q-2026-034 Harbour Museum.pdf', added: 12 * D,
    content: pdf([{ k: 'title', text: 'Quote Q-2026-034 — Harbour Museum wayfinding app' }, { k: 'table', rows: [['Phase', 'DKK'], ['Discovery', '37,500'], ['Prototype', '62,500'], ['Total', '100,000']] }, { k: 'p', text: 'Deposit of DKK 18,750 received. Start pending board approval.' }]),
    ai: ['t_finance'], tags: ['p_waiting'] });
  F({ id: 'f_quote_tpl', provider: NC, rel: 'Admin/Quotes/quote-template.docx', added: 700 * D, content: doc({ k: 'title', text: 'Quote Q-YYYY-NNN — [Project]' }, { k: 'p', text: 'Based on [brief]. Prices excl. VAT.' }, { k: 'table', rows: [['Phase', 'Content', 'DKK'], ['', '', '']] }, { k: 'h', text: 'Terms' }, { k: 'p', text: 'Invoiced per phase on delivery. Two rounds of feedback per phase included.' }), ai: ['t_finance'] });
  F({ id: 'f_service_agreement', provider: NC, rel: 'Admin/Contracts/Lantern — service agreement.docx', added: 40 * D, modified: 37 * D,
    content: doc({ k: 'title', text: 'Service agreement — Lantern brand & app refresh' }, { k: 'p', text: 'Between the Lantern Library Consortium ("the client") and Studio Nordlys ApS ("the studio").' },
      { k: 'h', text: '1. Services' }, { k: 'p', text: 'The studio delivers the services described in quote Q-2026-031 and creative brief v3.' },
      { k: 'h', text: '2. Fees and payment' }, { k: 'p', text: 'DKK 420,000 excl. VAT, invoiced per phase. Payment net 14 days.' },
      { k: 'h', text: '3. Rights' }, { k: 'li', text: 'On full payment the client receives exclusive rights to the final identity.' }, { k: 'li', text: 'The studio may show the work in its portfolio after public launch.' },
      { k: 'h', text: '4. Accessibility' }, { k: 'p', text: 'Deliverables target WCAG 2.2 AA. The client arranges testing with its accessibility panel.' },
      { k: 'sign', text: 'Signed for the client: Sofie Brandt' }, { k: 'sign', text: 'Signed for the studio: Magnus' }),
    ai: ['t_contracts'], tags: ['p_lantern'], summary: 'Signed service agreement with Lantern: DKK 420k per Q-2026-031, rights on full payment, WCAG 2.2 AA.' });
  F({ id: 'f_nda_lantern', provider: NC, rel: 'Admin/Contracts/NDA Lantern signed.pdf', added: 47 * D, online: true,
    content: pdf([{ k: 'title', text: 'Mutual non-disclosure agreement' }, { k: 'authors', text: 'Lantern Library Consortium · Studio Nordlys ApS' }, { k: 'p', text: 'Each party keeps the other’s confidential information confidential for three years and uses it only to evaluate and perform the project.' }, { k: 'p', text: 'Signed electronically by both parties.' }]),
    ai: ['t_contracts'] });
  F({ id: 'f_subcontract', provider: NC, rel: 'Admin/Contracts/Subcontract — Rasmus Holm (illustration).docx', added: 30 * D,
    content: doc({ k: 'title', text: 'Subcontract — illustration for Lantern' }, { k: 'p', text: 'Rasmus Holm delivers six spot illustrations for empty states and onboarding, in two rounds.' }, { k: 'h', text: 'Fee' }, { k: 'p', text: 'DKK 30,000 excl. VAT, half on sketches, half on delivery.' }, { k: 'sign', text: 'Rasmus Holm · Magnus' }),
    ai: ['t_contracts'] });
  const tsRows = (startAgo: number, days: number): (string | number)[][] => {
    const tasks: [string, string][] = [['Lantern', 'Round 2 deck'], ['Lantern', 'Wireframes'], ['Lantern', 'Brand guidelines'], ['Lantern', 'Client review'], ['Kalkbrud', 'Maintenance'], ['Studio', 'Admin & invoicing'], ['Studio', 'Talk prep'], ['Harbour Museum', 'Discovery call']];
    const rows: (string | number)[][] = [];
    for (let d = 0; d < days; d++) {
      const ago = startAgo - d * D, wd = new Date(now - ago).getUTCDay();
      if (wd === 0 || wd === 6) continue;
      const [p, t] = tasks[(d * 3 + (wd % 3)) % tasks.length];
      const hours = Math.round((2 + rnd() * 5) * 2) / 2;
      rows.push([ymd(ago), p, t, hours, p === 'Studio' ? 'no' : 'yes']);
    }
    return rows;
  };
  F({ id: 'f_timesheet_10', provider: NC, rel: 'Admin/Timesheets/timesheet-2026-10.xlsx', added: 30 * D, modified: 5 * H, online: false, content: { t: 'sheet', columns: ['Date', 'Project', 'Task', 'Hours', 'Billable'], rows: tsRows(29 * D, 29) }, ai: ['t_finance'], summary: 'October timesheet, mostly Lantern hours plus talk prep and admin.' });
  F({ id: 'f_timesheet_09', provider: NC, rel: 'Admin/Timesheets/timesheet-2026-09.xlsx', added: 61 * D, modified: 31 * D, content: { t: 'sheet', columns: ['Date', 'Project', 'Task', 'Hours', 'Billable'], rows: tsRows(60 * D, 30) }, ai: ['t_finance'] });
  F({ id: 'f_tax_overview', provider: NC, rel: 'Admin/Tax 2026/tax-2026-overview.xlsx', added: 280 * D, modified: 2 * D, online: false,
    content: { t: 'sheet', columns: ['Month', 'Revenue (DKK)', 'Expenses (DKK)', 'VAT out', 'VAT in', 'Net VAT'], rows: [
      ['Jan', 62500, 41210, 15625, 3120, 12505], ['Feb', 18750, 39880, 4688, 2850, 1838], ['Mar', 46875, 40400, 11719, 2990, 8729],
      ['Apr', 105000, 44100, 26250, 3610, 22640], ['May', 31400, 39720, 7850, 2770, 5080], ['Jun', 31250, 41900, 7813, 3230, 4583],
      ['Jul', 46875, 38050, 11719, 2410, 9309], ['Aug', 105000, 42330, 26250, 3080, 23170], ['Sep', 170625, 70120, 42656, 4210, 38446],
      ['Oct', 147000, 45200, 36750, 3405, 33345]] },
    ai: ['t_finance'], tags: ['p_tax'], summary: 'Monthly revenue, expenses and VAT for 2026 to date.' });
  F({ id: 'f_receipts_zip', provider: NC, rel: 'Admin/Tax 2026/receipts-q3-2026.zip', added: 9 * D, online: true,
    content: { t: 'archive', entries: [
      { path: 'Q3/07-01 rent.pdf', size: 88_120 }, { path: 'Q3/07-14 printhaus 0127.pdf', size: 142_004 }, { path: 'Q3/07-30 nextcloud.pdf', size: 51_772 },
      { path: 'Q3/08-01 rent.pdf', size: 88_120 }, { path: 'Q3/08-14 toolshop TS-558190.pdf', size: 63_210 }, { path: 'Q3/08-22 DSB.pdf', size: 74_880 },
      { path: 'Q3/09-01 rent.pdf', size: 88_120 }, { path: 'Q3/09-02 printhaus 0133.pdf', size: 139_550 }, { path: 'Q3/09-12 fraunces donation.pdf', size: 40_212 },
      { path: 'Q3/09-18 office supplies.jpg', size: 1_822_430 }, { path: 'Q3/09-22 insurance.pdf', size: 210_440 }, { path: 'Q3/summary.csv', size: 1_204 }] },
    ai: ['t_finance'], tags: ['p_tax'], summary: 'All Q3 2026 expense receipts, zipped for the VAT return.' });
  F({ id: 'f_vat_q3', provider: NC, rel: 'Admin/Tax 2026/VAT-return-Q3-2026.pdf', added: 4 * D,
    content: pdf([{ k: 'title', text: 'VAT return — Q3 2026' }, { k: 'authors', text: 'Studio Nordlys ApS · CVR 41 22 87 06 · draft' },
      { k: 'table', rows: [['Field', 'DKK'], ['Output VAT (sales)', '80,625'], ['Input VAT (purchases)', '9,700'], ['VAT payable', '70,925']] },
      { k: 'p', text: 'Deadline: 1 December. Check Printhaus 0133 is included before filing.' }]),
    ai: ['t_finance'], tags: ['p_tax', 'p_important'], summary: 'Draft Q3 VAT return: DKK 70,925 payable, due 1 December.' });
  F({ id: 'f_rates', provider: NC, rel: 'Shared/studio-rates-2026.pdf', added: 300 * D, online: true,
    content: pdf([{ k: 'title', text: 'Studio Nordlys — rates 2026' }, { k: 'table', rows: [['Role', 'Hourly (DKK)', 'Day (DKK)'], ['Design lead', '1,150', '8,400'], ['Designer', '950', '6,900'], ['Creative technologist', '1,050', '7,600'], ['Illustration (sub)', '750', '5,400']] }, { k: 'p', text: 'Prices excl. VAT. Fixed-price quotes on request.' }]),
    ai: ['t_finance'] });
  F({ id: 'f_team_photo', provider: NC, rel: 'Shared/team-photo-2026.jpg', added: 210 * D, online: true, content: image(art('photo', 24, 6000, 4000, 'studio team, spring')), ai: ['t_photography'] });
  F({ id: 'f_printer_setup', provider: NC, rel: 'Shared/printer-setup.md', added: 380 * D, content: md(`
# Studio printer

- Name on the network: **nordlys-laser** (IPP Everywhere, no driver needed on Linux)
- Toner: TN-2420. Spare in the kitchen cupboard (when there is one).
- Label printer manual is in Magnus's Downloads, if anyone ever needs it.
- If it says "paper jam" and there is no jam: open the back flap and close it again.
`), ai: ['t_tooling'] });

  // ════════════════════════════════════════════════════════════════════════
  // external — Field Drive (not connected)
  // ════════════════════════════════════════════════════════════════════════
  const EX = 'external' as const;
  dir('d_field_archive', EX, 'Archive', 700 * D);
  dir('d_field_2024', EX, 'Archive/2024 Projects', 420 * D, { summary: 'Final project archives from 2024.' });
  dir('d_field_footage', EX, 'Footage', 520 * D);
  dir('d_field_photos', EX, 'Photos', 900 * D);
  dir('d_field_lofoten', EX, 'Photos/Lofoten 2024 export', 780 * D);
  dir('d_field_backups', EX, 'Backups', 330 * D);
  F({ id: 'f_field_kalkbrud', provider: EX, rel: 'Archive/2024 Projects/Kalkbrud website 2024.zip', added: 420 * D, content: { t: 'archive', entries: [
    { path: 'Kalkbrud/design/kalkbrud-site.fig', size: 48_220_000 }, { path: 'Kalkbrud/design/exports/landing.png', size: 2_840_000 }, { path: 'Kalkbrud/brief.pdf', size: 820_000 },
    { path: 'Kalkbrud/handover/README.md', size: 6_400 }, { path: 'Kalkbrud/handover/tokens.json', size: 12_800 }, { path: 'Kalkbrud/invoices/INV-2024-009.pdf', size: 91_000 }] }, ai: ['t_interface'] });
  F({ id: 'f_field_harbour', provider: EX, rel: 'Archive/2024 Projects/Harbour Museum wayfinding.zip', added: 400 * D, content: { t: 'archive', entries: [
    { path: 'Harbour/signage/sign-family.pdf', size: 14_200_000 }, { path: 'Harbour/signage/pictograms.svg', size: 380_000 }, { path: 'Harbour/photos/install-01.jpg', size: 6_100_000 },
    { path: 'Harbour/photos/install-02.jpg', size: 5_900_000 }, { path: 'Harbour/report.pdf', size: 2_400_000 }] }, ai: ['t_branding'] });
  F({ id: 'f_field_index', provider: EX, rel: 'Archive/2024 Projects/2024 project index.xlsx', added: 380 * D, content: { t: 'sheet', columns: ['Project', 'Client', 'Year', 'Archive'], rows: [
    ['Website 2024', 'Kalkbrud', 2024, 'Kalkbrud website 2024.zip'], ['Wayfinding', 'Harbour Museum', 2024, 'Harbour Museum wayfinding.zip'], ['Festival identity', 'Aarhus Jazz Week', 2024, '— (on Nextcloud)'],
    ['Exhibition app', 'Harbour Museum', 2024, '— (cancelled)'], ['Annual report', 'Kalkbrud', 2024, '— (print only)'], ['Workshop', 'Design school', 2024, '—'],
    ['Orbit (personal)', '—', 2024, 'git'], ['Portfolio site', '—', 2024, '—']] }, ai: ['t_finance'] });
  F({ id: 'f_field_a001', provider: EX, rel: 'Footage/A001_C004_0612.mov', added: 510 * D, content: { t: 'media', duration: 48, note: 'ProRes 422 · 3840×2160 · 25 fps', art: art('photo', 200, 3840, 2160, 'harbour b-roll') }, ai: ['t_photography'] });
  F({ id: 'f_field_a002', provider: EX, rel: 'Footage/A001_C007_0612.mov', added: 510 * D, content: { t: 'media', duration: 71, note: 'ProRes 422 · 3840×2160 · 25 fps', art: art('photo', 195, 3840, 2160, 'install timelapse') }, ai: ['t_photography'] });
  F({ id: 'f_field_broll', provider: EX, rel: 'Footage/lantern-branch-visit-broll.mp4', added: 18 * D + 4 * H, content: { t: 'media', duration: 186, note: 'H.264 · 1920×1080 · shot on phone during the branch visit', art: art('photo', 40, 1920, 1080, 'reading room') }, ai: ['t_libraries'], summary: 'Phone b-roll from the Lantern branch visit, copied to the field drive.' });
  F({ id: 'f_field_dsc412', provider: EX, rel: 'Photos/Lofoten 2024 export/DSC_0412.jpg', added: 780 * D, content: image(art('photo', 205, 6000, 4000, 'Reine, blue hour')), ai: ['t_photography'] });
  F({ id: 'f_field_dsc419', provider: EX, rel: 'Photos/Lofoten 2024 export/DSC_0419.jpg', added: 780 * D, content: image(art('photo', 190, 6000, 4000, 'fishing racks')), ai: ['t_photography'] });
  F({ id: 'f_field_dsc433', provider: EX, rel: 'Photos/Lofoten 2024 export/DSC_0433.jpg', added: 780 * D, content: image(art('photo', 215, 4000, 6000, 'mountain path')), ai: ['t_photography'] });
  F({ id: 'f_field_backup', provider: EX, rel: 'Backups/home-backup-2025-12.tar.gz', added: 330 * D, content: { t: 'archive', entries: [
    { path: 'home/magnus/Documents/', size: 2_400_000_000 }, { path: 'home/magnus/Pictures/', size: 18_600_000_000 }, { path: 'home/magnus/src/', size: 1_100_000_000 }, { path: 'home/magnus/.config/', size: 220_000_000 }, { path: 'backup.log', size: 82_000 }] }, ai: ['t_tooling'] });
  F({ id: 'f_field_backup_notes', provider: EX, rel: 'Backups/restore-notes.txt', added: 330 * D, content: { t: 'text', text: 'Restore: tar -xzf home-backup-2025-12.tar.gz -C /\nExclude ~/.cache and node_modules next time (took 3 h).\nNext backup: before the end of the year.\n' } });

  // ════════════════════════════════════════════════════════════════════════
  // Relations
  // ════════════════════════════════════════════════════════════════════════
  const relations: Relation[] = [];
  const rel = (kind: Relation['kind'], from: string, to: string, explicit: boolean, note?: string) =>
    relations.push({ id: `r_${String(relations.length + 1).padStart(3, '0')}`, from, to, kind, explicit, ...(note ? { note } : {}) });
  const refs = (from: string, ...to: string[]) => to.forEach((t) => rel('references', from, t, true));

  refs('f_notes_attention', 'f_p_leroy', 'f_p_czerwinski', 'f_p_halvorsen', 'f_web_against');
  refs('f_notes_spatial', 'f_p_malone', 'f_p_barreau', 'f_p_datamountain', 'f_p_mehta');
  refs('f_notes_pim', 'f_p_lifestreams', 'f_p_glance', 'f_p_context', 'f_p_barreau');
  refs('f_synthesis', 'f_notes_attention', 'f_notes_spatial', 'f_notes_pim');
  refs('f_to_read', 'f_p_context', 'f_web_piles');
  refs('f_talk_outline', 'f_p_malone', 'f_p_halvorsen', 'f_p_leroy', 'f_web_against', 'f_desk_field');
  refs('f_p_halvorsen', 'f_p_malone', 'f_p_datamountain', 'f_p_lifestreams', 'f_p_leroy');
  refs('f_web_peripheral', 'f_p_halvorsen');
  refs('f_orbit_architecture', 'f_orbit_ts', 'f_physics_ts', 'f_render_ts', 'f_adr_0001');
  refs('f_orbit_readme', 'f_orbit_architecture', 'f_orbit_screenshot');
  refs('f_adr_0001', 'f_orbit_ts');
  refs('f_adr_0004', 'f_physics_ts', 'f_test_physics');
  refs('f_trails_idea', 'f_trails_ts', 'f_ada_screenshot');
  refs('f_meeting_lantern', 'f_concept_pptx', 'f_logo_expl_1');
  refs('f_reply_lantern', 'f_lantern_feedback_r2', 'f_wordmark');
  refs('f_inv_019', 'f_quote_031');
  refs('f_service_agreement', 'f_quote_031');

  rel('revision', 'f_brief_v1', 'f_brief_v2', true, 'v1 → v2');
  rel('revision', 'f_brief_v2', 'f_brief_v3', true, 'v2 → v3-FINAL');
  rel('revision', 'f_concept_pptx', 'f_round2_pptx', true, 'Round 1 → round 2');
  rel('revision', 'f_logo_expl_1', 'f_logo_expl_2', true, 'Marks A–F → mark B refinements');
  rel('revision', 'f_feedback_r1', 'f_lantern_feedback_r2', true, 'Quick reactions → full written feedback');

  rel('derived', 'f_concept_pdf', 'f_concept_pptx', true, 'Exported as PDF');
  rel('derived', 'f_talk_deck', 'f_talk_outline', true, 'Deck built from outline');
  rel('derived', 'f_speaker_notes', 'f_talk_outline', true);
  rel('derived', 'f_fig_lens', 'f_sketch_lens', true, 'Redrawn from sketch');
  rel('derived', 'f_wf_search', 'f_sketch_search_1', true, 'Wireframe from sketch');
  rel('derived', 'f_tax_overview', 'f_bank_csv', true, 'September figures imported');

  rel('topic', 'f_p_malone', 'f_p_barreau', false, 'Both: finding and reminding');
  rel('topic', 'f_p_malone', 'f_p_datamountain', false, 'Spatial memory');
  rel('topic', 'f_p_datamountain', 'f_p_mehta', false, 'Spatial memory');
  rel('topic', 'f_p_leroy', 'f_p_czerwinski', false, 'Task switching');
  rel('topic', 'f_p_halvorsen', 'f_web_peripheral', false, 'Same author, same argument');
  rel('topic', 'f_p_lifestreams', 'f_p_context', false, 'Alternatives to folders');
  rel('topic', 'f_p_glance', 'f_p_context', false, 'Re-finding files');
  rel('topic', 'f_report', 'f_report_1', false, 'Identical content — likely duplicate');
  rel('topic', 'f_guidelines', 'f_fraunces_zip', false, 'Typography');
  rel('topic', 'f_wcag_pdf', 'f_guidelines', false, 'Accessibility');
  rel('topic', 'f_untitled_png', 'f_shot_lantern_search', false, 'Lantern search screen');
  rel('topic', 'f_speaker_pack', 'f_ticket', false, 'Same trip');
  rel('topic', 'f_podcast', 'f_p_lifestreams', false, 'Replacing the desktop metaphor');
  rel('topic', 'f_ada_bug_webm', 'f_ada_screenshot', false, 'Mercury jitter');

  // ════════════════════════════════════════════════════════════════════════
  // Usage — sessions over ~60 days, densest in the last two weeks
  // ════════════════════════════════════════════════════════════════════════
  const usage: UsageEvent[] = [];
  const ev = (item: string, app: AppId, at: number, assembly: string | null, action: UsageEvent['action'] = 'open') => {
    const it = byId.get(item);
    if (!it) throw new Error(`seed: usage for unknown item ${item}`);
    if (at > now - 20e3 || at < it.added) return;
    usage.push({ item, app, at: Math.round(at), assembly, action });
  };

  /** [item, app, weight, chance an open is followed by an edit] */
  type Pick = [string, AppId, number, number?];
  const RESEARCH: Pick[] = [
    ['f_p_halvorsen', 'reader', 10], ['f_p_malone', 'reader', 8], ['f_p_leroy', 'reader', 8], ['f_p_datamountain', 'reader', 6],
    ['f_p_czerwinski', 'reader', 2], ['f_p_lifestreams', 'reader', 2], ['f_p_barreau', 'reader', 1], ['f_p_mehta', 'reader', 1],
    ['f_p_glance', 'reader', 1.5], ['f_p_context', 'reader', 1],
    ['f_notes_attention', 'notes', 9, 0.7], ['f_desk_field', 'notes', 7, 0.5], ['f_notes_spatial', 'notes', 3, 0.5], ['f_notes_pim', 'notes', 2, 0.5],
    ['f_to_read', 'notes', 1.2, 0.4], ['f_synthesis', 'notes', 2, 0.6], ['f_references_bib', 'notes', 1, 0.5],
    ['f_web_peripheral', 'browser', 3], ['f_web_against', 'browser', 2], ['f_web_piles', 'browser', 1],
    ['f_shot_quicklook', 'images', 1], ['f_shot_spatial_fm', 'images', 0.7], ['f_sketch_lens', 'images', 0.6],
  ];
  const ORBIT: Pick[] = [
    ['f_orbit_ts', 'code', 9, 0.75], ['f_physics_ts', 'code', 7, 0.55], ['f_orbit_readme', 'code', 6.5, 0.35], ['f_render_ts', 'code', 2.5, 0.45],
    ['f_main_ts', 'code', 2, 0.3], ['f_trails_ts', 'code', 3, 0.7], ['f_units_ts', 'code', 1], ['f_camera_ts', 'code', 1, 0.3],
    ['f_bodies_planets', 'code', 0.8], ['f_bodies_comets', 'code', 0.5], ['f_test_physics', 'code', 1.5, 0.3], ['f_test_orbit', 'code', 1, 0.3],
    ['f_orbit_architecture', 'code', 1.5, 0.2], ['f_adr_0004', 'code', 0.6], ['f_orbit_changelog', 'code', 0.8, 0.5], ['f_orbit_roadmap', 'code', 0.6, 0.4],
    ['f_orbit_package', 'terminal', 3], ['f_test_physics', 'terminal', 1.5], ['f_orbit_index_html', 'browser', 1.5],
    ['f_orbit_screenshot', 'images', 0.5], ['f_ada_screenshot', 'images', 1], ['f_trails_idea', 'notes', 1.5, 0.4], ['f_energy_chart', 'images', 0.4],
  ];
  const LANTERN: Pick[] = [
    ['f_brief_v3', 'reader', 5], ['f_guidelines', 'reader', 4], ['f_flows_pdf', 'reader', 1.5], ['f_wcag_pdf', 'reader', 1.5], ['f_report', 'reader', 1],
    ['f_concept_pptx', 'slides', 4, 0.5], ['f_round2_pptx', 'slides', 6, 0.65],
    ['f_moodboard', 'images', 3], ['f_ref_reading', 'images', 1], ['f_ref_light', 'images', 0.8], ['f_ref_signage', 'images', 0.8],
    ['f_logo_expl_1', 'images', 2], ['f_logo_expl_2', 'images', 2.5], ['f_wordmark', 'images', 2], ['f_app_icon', 'images', 1], ['f_palette', 'images', 1],
    ['f_wf_search', 'images', 2.5], ['f_wf_detail', 'images', 2.5], ['f_wf_loans', 'images', 1.2], ['f_wf_home', 'images', 1], ['f_wf_events', 'images', 0.6],
    ['f_shot_lantern_search', 'images', 1.5], ['f_shot_lantern_detail', 'images', 1.5], ['f_shot_contrast', 'images', 1],
    ['f_sketch_search_1', 'images', 1.2], ['f_sketch_search_2', 'images', 0.8], ['f_img_4458', 'images', 0.6],
    ['f_feedback_r1', 'writer', 1.5], ['f_lantern_feedback_r2', 'writer', 3], ['f_feedback_tracker', 'sheets', 3, 0.6],
    ['f_meeting_lantern', 'notes', 1.2], ['f_kickoff_notes', 'notes', 0.6], ['f_lantern_contacts', 'notes', 0.4], ['f_fraunces_zip', 'archive', 0.3],
    ['f_lantern_logo_zip', 'archive', 0.3], ['f_shot_lantern_search', 'browser', 0.4],
  ];
  const ADMIN: Pick[] = [
    ['f_invoices_sheet', 'sheets', 5, 0.6], ['f_timesheet_10', 'sheets', 6, 0.75], ['f_timesheet_09', 'sheets', 1, 0.3], ['f_tax_overview', 'sheets', 3, 0.5],
    ['f_bank_csv', 'sheets', 1.5], ['f_inv_018', 'reader', 1.5], ['f_inv_019', 'reader', 2], ['f_inv_019', 'mail', 0.8], ['f_inv_017', 'reader', 1],
    ['f_quote_031', 'reader', 1.5], ['f_quote_034', 'reader', 0.8], ['f_service_agreement', 'writer', 1.5, 0.2], ['f_subcontract', 'writer', 0.6],
    ['f_vat_q3', 'reader', 1.2], ['f_receipts_zip', 'archive', 1], ['f_forskud', 'reader', 0.6], ['f_invoice_0142', 'reader', 1], ['f_rates', 'reader', 0.4],
    ['f_receipt_tools', 'reader', 0.4], ['f_quote_tpl', 'writer', 0.3],
  ];
  const TALK: Pick[] = [
    ['f_talk_deck', 'slides', 7, 0.65], ['f_speaker_notes', 'notes', 4, 0.6], ['f_talk_outline', 'notes', 2.5, 0.5], ['f_talk_abstract', 'notes', 0.8],
    ['f_fig_lens', 'images', 2], ['f_fig_piles', 'images', 2], ['f_photo_desk', 'images', 1.2], ['f_img_4471', 'images', 0.8], ['f_sketch_lens', 'images', 1.5],
    ['f_demo_webm', 'player', 1], ['f_desk_field', 'notes', 2], ['f_speaker_pack', 'reader', 1], ['f_p_malone', 'reader', 1], ['f_p_halvorsen', 'reader', 1],
    ['f_sketch_collapse', 'images', 0.8], ['f_screen_rec', 'player', 0.6],
  ];
  const MISC: Pick[] = [
    ['f_todo', 'notes', 1.5, 0.5], ['f_notes_2', 'notes', 1.5, 0.5], ['f_podcast', 'player', 0.8], ['f_img_4466', 'images', 0.6], ['f_img_4469', 'images', 0.5],
    ['f_img_4402', 'images', 0.3], ['f_signal_photo', 'images', 0.6], ['f_screen_rec', 'player', 0.6], ['f_quick_sketch', 'images', 0.8],
    ['f_lease', 'reader', 0.3], ['f_letter_landlord', 'writer', 0.5], ['f_standup', 'notes', 0.6], ['f_team_photo', 'images', 0.2], ['f_printer_setup', 'notes', 0.2],
    ['f_web_against', 'browser', 0.4], ['f_ticket', 'reader', 0.5],
  ];

  const session = (assembly: string | null, pool: Pick[], start: number, n: number) => {
    const total = pool.reduce((s, p) => s + p[2], 0);
    let t = start, prev = '';
    for (let i = 0; i < n; i++) {
      let r = rnd() * total, k = 0;
      while (r > pool[k][2] && k < pool.length - 1) { r -= pool[k][2]; k++; }
      const [item, app, , edit = 0] = pool[k];
      if (item === prev) { t += 2 * M; continue; }
      prev = item;
      ev(item, app, t, assembly, 'open');
      if (rnd() < edit) {
        t += (2 + rnd() * 12) * M;
        ev(item, app, t, assembly, 'edit');
        if (rnd() < 0.35) ev(item, app, t + (0.5 + rnd()) * M, assembly, 'save');
      }
      t += (3 + rnd() * 14) * M;
    }
  };

  const today = now - (now % D);
  for (let d = 0; d <= 60; d++) {
    const base = today - d * D;
    const wd = new Date(base).getUTCDay();
    const dom = new Date(base).getUTCDate();
    const weekend = wd === 0 || wd === 6;
    const recent = d <= 14;
    const n = (lo: number, spread: number) => lo + Math.floor(rnd() * spread);
    if (!weekend && rnd() < (recent ? 0.8 : d <= 40 ? 0.3 : 0.12)) session('a_research', RESEARCH, base + (8 + rnd() * 2) * H, n(4, 6));
    if (!weekend && recent && rnd() < 0.4) session('a_research', RESEARCH, base + (14.5 + rnd() * 1.5) * H, n(3, 4));
    if (!weekend && d <= 47 && rnd() < (d <= 21 ? 0.85 : 0.4)) session('a_lantern', LANTERN, base + (12 + rnd() * 2.5) * H, n(6, 7));
    if (rnd() < (weekend ? 0.7 : recent ? 0.55 : 0.2)) session('a_orbit', ORBIT, base + (weekend ? 10.5 + rnd() * 3 : 19.5 + rnd() * 2) * H, n(5, 7));
    if (!weekend && rnd() < (wd === 5 || dom >= 28 || dom === 1 ? 0.65 : 0.12)) session('a_admin', ADMIN, base + (15.3 + rnd() * 1.2) * H, n(3, 4));
    if (d <= 24 && rnd() < (d <= 12 ? 0.65 : 0.2)) session('a_talk', TALK, base + (weekend ? 15 + rnd() * 2 : 17 + rnd()) * H, n(4, 5));
    if (rnd() < 0.6) session(null, MISC, base + (7.5 + rnd() * 14) * H, n(1, 3));
  }

  // Received items: a download event at arrival, then (for some) a first look.
  const sourceApp = (s: string): AppId => s.startsWith('Firefox') ? 'browser' : s.startsWith('Signal') ? 'messages' : 'mail';
  for (const it of items) if (it.origin === 'received' && it.source) ev(it.id, sourceApp(it.source), it.added, null, 'download');
  const firstLook: [string, AppId, string | null, number][] = [
    ['f_p_halvorsen', 'reader', 'a_research', 4 * M], ['f_p_leroy', 'reader', 'a_research', 20 * M], ['f_p_glance', 'reader', 'a_research', 6 * M],
    ['f_p_context', 'reader', 'a_research', 9 * M], ['f_lantern_feedback_r2', 'writer', 'a_lantern', 12 * M], ['f_ada_screenshot', 'images', null, 2 * M],
    ['f_report', 'reader', 'a_lantern', 30 * M], ['f_ticket', 'reader', null, 3 * M], ['f_invoice_0142', 'reader', 'a_admin', 5 * H], ['f_speaker_pack', 'reader', 'a_talk', 25 * M],
    ['f_signal_photo', 'images', null, 1 * M], ['f_bank_csv', 'sheets', 'a_admin', 2 * M], ['f_forskud', 'reader', 'a_admin', 3 * M], ['f_lease', 'reader', null, 10 * M],
    ['f_node_tar', 'archive', null, 1 * M], ['f_fraunces_zip', 'archive', 'a_lantern', 3 * M], ['f_inter_zip', 'archive', null, 2 * M], ['f_lantern_logo_zip', 'archive', 'a_lantern', 4 * M],
    ['f_wcag_pdf', 'reader', 'a_lantern', 5 * M], ['f_energy_chart', 'images', 'a_orbit', 40 * M], ['f_ada_bug_webm', 'player', 'a_orbit', 2 * H], ['f_contract_template', 'writer', 'a_admin', 1 * D],
    ['f_web_peripheral', 'reader', 'a_research', 2 * M], ['f_web_against', 'reader', 'a_research', 3 * M], ['f_web_piles', 'reader', 'a_research', 20 * H], ['f_boarding', 'reader', null, 1 * D],
  ];
  for (const [id, app, asm, delay] of firstLook) ev(id, app, byId.get(id)!.added + delay, asm);

  // Version history doubles as edit events in the owning app.
  const versionCtx: Record<string, string | null> = {
    f_desk_field: 'a_research', f_meeting_lantern: 'a_lantern', f_talk_outline: 'a_talk', f_standup: null, f_notes_2: null,
    f_trails_idea: 'a_orbit', f_reply_lantern: 'a_lantern', f_letter_landlord: null, f_notes_attention: 'a_research',
    f_notes_spatial: 'a_research', f_notes_pim: 'a_research', f_synthesis: 'a_research',
  };
  for (const [id, vs] of versionSpecs) {
    const app: AppId = byId.get(id)!.kind === 'doc' ? 'writer' : 'notes';
    vs.forEach(([ago, ], i) => ev(id, app, now - ago, versionCtx[id] ?? null, i === 0 ? 'save' : 'edit'));
  }

  // The last few hours, so "right now" has a clear context.
  ev('f_lantern_feedback_r2', 'writer', now - 5.2 * H, 'a_lantern');
  ev('f_round2_pptx', 'slides', now - 4.6 * H, 'a_lantern');
  ev('f_round2_pptx', 'slides', now - 4.1 * H, 'a_lantern', 'edit');
  ev('f_feedback_tracker', 'sheets', now - 3.2 * H, 'a_lantern', 'edit');
  ev('f_p_context', 'reader', now - 2.75 * H, 'a_research');
  ev('f_notes_attention', 'notes', now - 2.6 * H, 'a_research');
  ev('f_p_halvorsen', 'reader', now - 2.5 * H, 'a_research');
  ev('f_to_read', 'notes', now - 2.4 * H, 'a_research', 'edit');
  ev('f_p_leroy', 'reader', now - 2.3 * H, 'a_research');
  ev('f_desk_field', 'notes', now - 2.1 * H, 'a_research');
  ev('f_ada_screenshot', 'images', now - 58 * M, 'a_orbit');
  ev('f_orbit_ts', 'code', now - 52 * M, 'a_orbit');
  ev('f_physics_ts', 'code', now - 40 * M, 'a_orbit');
  ev('f_trails_ts', 'code', now - 31 * M, 'a_orbit');
  ev('f_orbit_ts', 'code', now - 12 * M, 'a_orbit', 'edit');
  ev('f_orbit_package', 'terminal', now - 6.5 * M, 'a_orbit');
  ev('f_orbit_index_html', 'browser', now - 5 * M, 'a_orbit');
  ev('f_desk_field', 'notes', now - 4 * M, 'a_research');

  usage.sort((a, b) => a.at - b.at || a.item.localeCompare(b.item));

  // ════════════════════════════════════════════════════════════════════════
  // Finalise: parents, modified times, versions, folder aggregates
  // ════════════════════════════════════════════════════════════════════════
  const lastEdit = new Map<string, number>();
  for (const e of usage) if (e.action === 'edit' || e.action === 'save') lastEdit.set(e.item, Math.max(lastEdit.get(e.item) ?? 0, e.at));

  const folderByPath = new Map<string, LibItem>();
  for (const it of items) if (it.kind === 'folder') folderByPath.set(it.path, it);
  for (const it of items) {
    const parent = it.path.slice(0, it.path.lastIndexOf('/'));
    if (parent === ROOTS[it.provider]) it.parentId = null;
    else {
      const f = folderByPath.get(parent);
      if (!f || f.provider !== it.provider) throw new Error(`seed: no folder for ${it.path}`);
      it.parentId = f.id;
    }
    if (it.kind === 'folder') continue;
    const le = lastEdit.get(it.id);
    if (le && le > it.modified) it.modified = le;
    const vs = versionSpecs.get(it.id);
    if (vs) {
      const versions = vs.map(([ago, note]) => ({ at: now - ago, note }));
      const last = versions[versions.length - 1];
      if (it.modified > last.at + M) {
        if (versions.length < 8) versions.push({ at: it.modified, note: 'Autosaved' });
        else last.at = it.modified;
      }
      it.versions = versions;
    }
  }

  // Folder aggregates, deepest first so parents see their children's results.
  const children = new Map<string, LibItem[]>();
  for (const it of items) if (it.parentId) (children.get(it.parentId) ?? children.set(it.parentId, []).get(it.parentId)!).push(it);
  const depth = (it: LibItem) => it.path.split('/').length;
  for (const f of items.filter((i) => i.kind === 'folder').sort((a, b) => depth(b) - depth(a))) {
    const kids = children.get(f.id) ?? [];
    f.modified = Math.max(f.modified, ...kids.map((k) => k.modified));
    f.availability =
      f.provider === 'git-orbit' ? 'git'
      : f.provider === 'external' ? 'unavailable'
      : f.provider === 'nextcloud' ? (kids.length && kids.every((k) => k.availability === 'cloud-online') ? 'cloud-online' : 'cloud-downloaded')
      : 'local';
    if (f.provider === 'git-orbit') f.git = { status: kids.some((k) => k.git && k.git.status !== 'clean') ? 'modified' : 'clean', branch: 'main' };
  }

  // ════════════════════════════════════════════════════════════════════════
  // Collections & assemblies
  // ════════════════════════════════════════════════════════════════════════
  const collections: Collection[] = [
    { id: 'c_interface_refs', name: 'Interface references', created: now - 19 * D,
      description: 'Screens, essays and papers I keep pointing at — across Pictures, Downloads and the Lantern moodboard.',
      items: ['f_shot_quicklook', 'f_shot_spatial_fm', 'f_shot_tiling', 'f_web_peripheral', 'f_p_halvorsen', 'f_p_glance', 'f_moodboard', 'f_img_4466', 'f_sketch_lens'],
      assemblies: ['a_research', 'a_lantern'] },
    { id: 'c_lantern_deliverables', name: 'Lantern deliverables', created: now - 15 * D,
      description: 'What the client actually receives.',
      items: ['f_brief_v3', 'f_guidelines', 'f_wordmark', 'f_app_icon', 'f_concept_pdf', 'f_round2_pptx', 'd_lantern_wf', 'f_flows_pdf'],
      assemblies: ['a_lantern'] },
    { id: 'c_talk_material', name: 'Talk material', created: now - 10 * D,
      description: 'Desks without workspaces — deck, notes, figures and the sources I quote.',
      items: ['f_talk_deck', 'f_speaker_notes', 'f_talk_outline', 'f_fig_lens', 'f_fig_piles', 'f_photo_desk', 'f_demo_webm', 'f_p_malone', 'f_p_halvorsen', 'f_web_against', 'f_speaker_pack'],
      assemblies: ['a_talk'] },
    { id: 'c_tax_2026', name: 'Tax 2026', created: now - 40 * D,
      description: 'Everything the accountant will ask for.',
      items: ['d_nc_tax', 'f_tax_overview', 'f_vat_q3', 'f_receipts_zip', 'f_bank_csv', 'f_forskud', 'f_invoice_0142', 'f_invoices_sheet', 'f_receipt_tools'],
      assemblies: ['a_admin'] },
    { id: 'c_orbit_onboarding', name: 'Orbit onboarding', created: now - 8 * D,
      description: 'For Ada: read these before touching the tick loop.',
      items: ['f_orbit_readme', 'd_orbit_docs', 'f_orbit_architecture', 'd_orbit_decisions', 'f_orbit_package', 'f_test_physics'],
      assemblies: ['a_orbit'] },
    { id: 'c_unread_papers', name: 'Unread papers', created: now - 6 * D, pinnedFrom: 'view:unopened-pdfs',
      description: 'Pinned from “PDFs I haven’t opened in Reader”.',
      items: ['f_p_context', 'f_p_mehta', 'f_p_barreau', 'f_web_piles'],
      assemblies: ['a_research'] },
  ];

  const assemblies: LibAssembly[] = [
    { id: 'a_research', name: 'Desktop Research', ink: 'violet', apps: ['reader', 'notes', 'browser'],
      attached: ['d_papers', 'f_notes_attention', 'f_notes_spatial', 'f_p_halvorsen', 'f_p_malone', 'f_desk_field', 'f_references_bib'] },
    { id: 'a_orbit', name: 'orbit', ink: 'teal', apps: ['code', 'terminal', 'browser'],
      attached: ['d_orbit_docs', 'f_orbit_ts', 'f_physics_ts', 'f_orbit_readme', 'f_trails_idea'] },
    { id: 'a_lantern', name: 'Lantern rebrand', ink: 'oxide', apps: ['images', 'slides', 'reader', 'browser'],
      attached: ['d_lantern', 'f_brief_v3', 'f_guidelines', 'f_round2_pptx', 'f_lantern_feedback_r2', 'f_feedback_tracker'] },
    { id: 'a_admin', name: 'Studio admin', ink: 'chrome', apps: ['sheets', 'reader', 'mail', 'writer'],
      attached: ['d_nc_invoices', 'f_invoices_sheet', 'f_timesheet_10', 'f_tax_overview', 'f_service_agreement'] },
    { id: 'a_talk', name: 'Talk: Desks without workspaces', ink: 'ultramarine', apps: ['slides', 'notes', 'images'],
      attached: ['d_talk', 'f_talk_deck', 'f_speaker_notes', 'f_talk_outline', 'f_fig_lens'] },
  ];

  return { providers: PROVIDERS.map((p) => ({ ...p })), tags: TAGS.map((t) => ({ ...t })), items, relations, usage, collections, assemblies };
}

export const SEED_VERSION = 1;
