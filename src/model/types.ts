// ─── Core object model ────────────────────────────────────────────────────────
// Windows and Assemblies are first-class objects. Geometry for a free window
// lives on the window; geometry for fused windows lives on the Assembly as a
// layout in "full units" (the size each window has at full attention).
// Anchors are normalized to the desktop (0..1) so the workspace survives any
// viewport size — the desktop is always exactly the screen.

export type AppKind = 'music' | 'terminal' | 'browser' | 'notes' | 'messages' | 'editor' | 'library';

export type Ink = 'teal' | 'ultramarine' | 'oxide' | 'violet' | 'grass' | 'sienna' | 'chrome';
export const INKS: Ink[] = ['teal', 'ultramarine', 'oxide', 'violet', 'grass', 'sienna', 'chrome'];

export interface Vec { x: number; y: number }
export interface Size { w: number; h: number }
export interface Rect { x: number; y: number; w: number; h: number }
export type Side = 'left' | 'right' | 'top' | 'bottom';

export interface WinModel {
  id: string;
  app: AppKind;
  /** Size at full attention, in px. User-resizable. */
  size: Size;
  /** Normalized centre when free. Ignored while the window belongs to an Assembly. */
  anchor: Vec;
  assemblyId: string | null;
  createdAt: number;
}

export interface AsmModel {
  id: string;
  /** Optional user name; null means "infer from contents". */
  name: string | null;
  ink: Ink;
  /** Top-left of each member in full units, relative to the assembly origin. */
  layout: Record<string, Vec>;
  /** Normalized centre of the assembly. */
  anchor: Vec;
  /** Explicitly collapsed by the user (stays a summary until selected). */
  collapsed: boolean;
  createdAt: number;
}

export interface FocusModel {
  /** Top-level object holding attention (window id or assembly id). */
  obj: string | null;
  /** Active window inside it, if any. */
  win: string | null;
  /** Where the field rests when it isn't attached to an object (normalized). */
  point: Vec;
}

/**
 * Relationships beyond fusion. Fusion is currently represented structurally
 * (assembly layout), but the model keeps a typed relation list so later
 * concepts — context clipboards, associated files, shared history — can attach
 * to windows and assemblies without changing geometry code.
 */
export type Relation =
  | { id: string; kind: 'clipboard'; subject: string; items: string[] }
  | { id: string; kind: 'file'; subject: string; path: string };

export type Presentation = 'full' | 'compact' | 'widget';
export type AsmPresentation = 'full' | 'compact' | 'collapsed';
