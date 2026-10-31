import { clamp, lerp } from '../model/geometry';
import type { Curve, Tuning } from '../model/tuning';
import type { AsmPresentation, Presentation, Size } from '../model/types';

// ─── Focus field ─────────────────────────────────────────────────────────────
// Attention is a function of distance from the (animated) focus point to an
// object's anchor, normalised by the field radius. Curves are interchangeable
// so the falloff can be felt and compared.

export function falloff(x: number, curve: Curve, k: number): number {
  switch (curve) {
    case 'gaussian': return Math.exp(-k * x * x);
    case 'linear': return clamp(1 - 0.62 * k * x, 0, 1);
    case 'smooth': {
      const t = clamp((x * k) / 1.8, 0, 1);
      return 1 - t * t * (3 - 2 * t);
    }
    case 'inverse': return 1 / (1 + 1.7 * Math.pow(k * x, 2.2));
    case 'plateau': {
      const t = Math.max(0, x - 0.55) * 1.9 * k;
      return Math.exp(-t * t);
    }
  }
}

export function effectiveRadius(V: Size, T: Tuning, count: number) {
  const base = T.radius * Math.hypot(V.w, V.h);
  if (!T.crowd) return base;
  return base * clamp(Math.sqrt(6 / Math.max(1, count)), 0.62, 1.15);
}

const H = 0.035; // hysteresis half-band

export function nextPresentation(prev: Presentation | undefined, a: number, T: Tuning): Presentation {
  const F = T.fullAt, W = T.widgetAt;
  if (!prev) return a >= F ? 'full' : a >= W ? 'compact' : 'widget';
  if (prev === 'full') return a < F - H ? (a < W - H ? 'widget' : 'compact') : 'full';
  if (prev === 'compact') return a >= F + H ? 'full' : a < W - H ? 'widget' : 'compact';
  return a >= W + H ? (a >= F + H ? 'full' : 'compact') : 'widget';
}

export function nextAsmPresentation(prev: AsmPresentation | undefined, a: number, T: Tuning): AsmPresentation {
  const F = T.fullAt, C = T.collapseAt;
  if (!prev) return a >= F ? 'full' : a >= C ? 'compact' : 'collapsed';
  if (prev === 'full') return a < F - H ? (a < C - H ? 'collapsed' : 'compact') : 'full';
  if (prev === 'compact') return a >= F + H ? 'full' : a < C - H ? 'collapsed' : 'compact';
  return a >= C + H ? (a >= F + H ? 'full' : 'compact') : 'collapsed';
}

const band = (a: number, lo: number, hi: number) => clamp((a - lo) / Math.max(0.001, hi - lo), 0, 1);

/** Size of a free window for its state; it breathes continuously within a state. */
export function windowSize(pres: Presentation, a: number, full: Size, compact: Size, widget: Size, T: Tuning, fit: Size): Size {
  if (pres === 'widget') {
    const k = lerp(0.96, 1, band(a, 0, T.widgetAt));
    return { w: widget.w * k, h: widget.h };
  }
  if (pres === 'compact') {
    const k = lerp(1, 1.1, band(a, T.widgetAt, T.fullAt));
    return { w: compact.w * k, h: compact.h * k };
  }
  const k = lerp(0.88, 1, band(a, T.fullAt, 0.93));
  const cap = Math.min(1, fit.w / full.w, fit.h / full.h);
  return { w: full.w * k * cap, h: full.h * k * cap };
}

/** Uniform scale of an assembly's layout for its state. */
export function assemblyScale(pres: AsmPresentation, a: number, T: Tuning): number {
  if (pres === 'full') return lerp(0.86, 1, band(a, T.fullAt, 0.93));
  return lerp(0.5, 0.6, band(a, T.collapseAt, T.fullAt));
}

export const CARD: Size = { w: 268, h: 118 };
