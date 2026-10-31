import { create } from 'zustand';
import type { AsmPresentation, Presentation } from './types';

// Transient (not persisted) semantic state, written by the engine whenever an
// object crosses a presentation threshold. React re-renders only on change.
interface PresentationStore {
  win: Record<string, Presentation>;
  asm: Record<string, AsmPresentation>;
  apply: (win: Record<string, Presentation>, asm: Record<string, AsmPresentation>) => void;
}

export const usePresentation = create<PresentationStore>()((set) => ({
  win: {},
  asm: {},
  apply: (win, asm) => set((s) => ({ win: { ...s.win, ...win }, asm: { ...s.asm, ...asm } })),
}));
