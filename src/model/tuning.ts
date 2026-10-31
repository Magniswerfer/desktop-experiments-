import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Curve = 'gaussian' | 'linear' | 'smooth' | 'inverse' | 'plateau';
export type MotionPref = 'auto' | 'reduced' | 'full';

export interface Tuning {
  /** Focus radius as a fraction of the desktop diagonal. */
  radius: number;
  curve: Curve;
  sharpness: number;
  /** Prominence of everything that isn't the focused object (0..1). */
  neighbours: number;
  /** Shrink the effective radius as more objects are open. */
  crowd: boolean;
  /** Attention thresholds for presentation states. */
  fullAt: number;
  widgetAt: number;
  collapseAt: number;
  /** Magnetism (px). */
  magnetRange: number;
  snapDistance: number;
  alignRange: number;
  pull: number;
  detachDistance: number;
  /** Max px a prominent object may nudge a peripheral one out of the way. */
  makeRoom: number;
  /** Springs. */
  stiffness: number;
  dampingRatio: number;
  focusSpeed: number;
  motion: MotionPref;
  showLens: boolean;
  showAttention: boolean;
}

export const DEFAULT_TUNING: Tuning = {
  radius: 0.3,
  curve: 'gaussian',
  sharpness: 1,
  neighbours: 0.86,
  crowd: true,
  fullAt: 0.68,
  widgetAt: 0.3,
  collapseAt: 0.27,
  magnetRange: 90,
  snapDistance: 18,
  alignRange: 18,
  pull: 0.55,
  detachDistance: 72,
  makeRoom: 180,
  stiffness: 300,
  dampingRatio: 0.9,
  focusSpeed: 1,
  motion: 'auto',
  showLens: false,
  showAttention: false,
};

interface TuningStore extends Tuning {
  set: (p: Partial<Tuning>) => void;
  reset: () => void;
  panelOpen: boolean;
  setPanel: (o: boolean) => void;
}

export const useTuning = create<TuningStore>()(
  persist(
    (set) => ({
      ...DEFAULT_TUNING,
      panelOpen: false,
      set: (p) => set(p),
      reset: () => set({ ...DEFAULT_TUNING }),
      setPanel: (panelOpen) => set({ panelOpen }),
    }),
    { name: 'lodestone:tuning:v1' },
  ),
);
