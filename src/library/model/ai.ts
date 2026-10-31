import type { LibItem, Tag } from './types';
import type { AiResult } from './store';
import { contentText } from './store';

// ─── Metadata analysis ───────────────────────────────────────────────────────
// A small interface so the library never depends on AI to function.
//
//   SimulatedAnalyzer  deterministic keyword matching against the existing
//                      topic vocabulary. Clearly labelled as simulated.
//   OllamaAnalyzer     optional; talks ONLY to a local Ollama runtime on
//                      localhost, and only when the user asks for it.
//
// Both must prefer existing tags to new ones, so the vocabulary converges.
// Future: an EmbeddingIndex (local embedding model + vector store) plugs in
// beside this to provide "similar content" for relevance ranking.

export interface AnalyzerInput { item: LibItem; text: string; vocabulary: Tag[] }
export interface MetadataAnalyzer {
  readonly engine: AiResult['engine'];
  readonly label: string;
  available(): Promise<boolean>;
  analyze(input: AnalyzerInput): Promise<Omit<AiResult, 'at'>>;
}

export interface EmbeddingIndex {
  embed(text: string): Promise<number[]>;
  nearest(itemId: string, k: number): Promise<{ id: string; score: number }[]>;
}

/** Keywords per topic label (lowercase). Unknown labels fall back to their own words. */
const HINTS: Record<string, string[]> = {
  'interface design': ['interface', 'ui', 'ux', 'interaction', 'screen', 'window', 'preview', 'layout', 'wireframe'],
  'spatial memory': ['spatial', 'location', 'place', 'desk', 'pile', 'memory'],
  attention: ['attention', 'focus', 'peripher', 'distraction', 'salience'],
  'personal information management': ['file', 'folder', 'organiz', 'retriev', 'filing', 'piles', 'lifestream', 'archive'],
  typography: ['type', 'font', 'typeface', 'grotesk', 'serif', 'kerning'],
  branding: ['brand', 'logo', 'identity', 'lantern', 'palette'],
  wireframes: ['wireframe', 'flow', 'sketch'],
  typescript: ['typescript', 'export', 'interface', 'const', 'import'],
  'physics simulation': ['orbit', 'mass', 'gravity', 'physics', 'integrat', 'body'],
  architecture: ['architecture', 'module', 'decision', 'adr', 'component'],
  invoices: ['invoice', 'amount due', 'vat', 'payment'],
  finance: ['bank', 'budget', 'tax', 'expense', 'dkk', 'eur'],
  contracts: ['agreement', 'contract', 'party', 'term', 'lease'],
  travel: ['train', 'flight', 'ticket', 'hotel', 'booking'],
  'research paper': ['abstract', 'study', 'participants', 'et al', 'references'],
  'meeting notes': ['meeting', 'attendees', 'action items', 'agenda'],
  presentation: ['slide', 'talk', 'deck', 'audience'],
  photography: ['photo', 'img_', 'camera', 'exposure'],
  accessibility: ['accessib', 'screen reader', 'contrast', 'keyboard'],
  tooling: ['build', 'vite', 'npm', 'config', 'script'],
};

function score(text: string, tag: Tag): number {
  const words = HINTS[tag.label.toLowerCase()] ?? tag.label.toLowerCase().split(/\s+/);
  let n = 0;
  for (const w of words) {
    let i = text.indexOf(w);
    while (i >= 0 && n < 20) { n++; i = text.indexOf(w, i + w.length); }
  }
  return n;
}

function summarize(item: LibItem, text: string): string {
  const firstSentence = text.replace(/[#*>`_-]+/g, ' ').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0] ?? '';
  const s = firstSentence.length > 20 ? firstSentence : `${item.name}`;
  return s.length > 160 ? `${s.slice(0, 157)}…` : s;
}

export const SimulatedAnalyzer: MetadataAnalyzer = {
  engine: 'simulated',
  label: 'Simulated analysis (keyword matching, no model)',
  available: async () => true,
  analyze: async ({ item, text, vocabulary }) => {
    await new Promise((r) => setTimeout(r, 380));
    const t = `${item.name} ${text}`.toLowerCase();
    const topics = vocabulary.filter((v) => v.kind === 'topic')
      .map((v) => ({ v, s: score(t, v) }))
      .filter((x) => x.s >= 2)
      .sort((a, b) => b.s - a.s)
      .slice(0, 3)
      .map((x) => x.v.id);
    return { tags: topics, summary: summarize(item, text), engine: 'simulated' };
  },
};

const OLLAMA = 'http://localhost:11434';

export function ollamaAnalyzer(model: string): MetadataAnalyzer {
  return {
    engine: 'ollama',
    label: `Ollama · ${model} (local)`,
    available: async () => {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 900);
        const r = await fetch(`${OLLAMA}/api/tags`, { signal: ctl.signal });
        clearTimeout(t);
        if (!r.ok) return false;
        const j = await r.json();
        return Array.isArray(j.models) && j.models.some((m: { name: string }) => m.name.startsWith(model));
      } catch { return false; }
    },
    analyze: async ({ item, text, vocabulary }) => {
      const topics = vocabulary.filter((v) => v.kind === 'topic');
      const prompt = `You tag files in a personal library. Choose 1-3 topics for this file, strongly preferring labels from this existing list: ${topics.map((t) => t.label).join(', ')}. Only invent a new label if none fit. Also write a one-sentence summary (max 25 words).
Reply as JSON: {"topics": string[], "summary": string}.

File name: ${item.name}
Contents (truncated):
${text.slice(0, 4000)}`;
      const r = await fetch(`${OLLAMA}/api/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, stream: false, format: 'json', options: { temperature: 0 } }),
      });
      if (!r.ok) throw new Error(`Ollama responded ${r.status}`);
      const j = await r.json();
      const out = JSON.parse(j.response ?? '{}') as { topics?: string[]; summary?: string };
      const byLabel = new Map(topics.map((t) => [t.label.toLowerCase(), t.id]));
      // Only existing vocabulary is applied automatically; new labels are reported in the summary line.
      const ids = (out.topics ?? []).map((l) => byLabel.get(l.toLowerCase())).filter((x): x is string => !!x);
      const fresh = (out.topics ?? []).filter((l) => !byLabel.has(l.toLowerCase()));
      return { tags: ids.slice(0, 3), summary: (out.summary ?? '') + (fresh.length ? ` (also suggested: ${fresh.join(', ')})` : ''), engine: 'ollama', model };
    },
  };
}

export async function analyzeItem(item: LibItem, vocabulary: Tag[], engine: 'simulated' | 'ollama', model: string): Promise<AiResult> {
  const a = engine === 'ollama' ? ollamaAnalyzer(model) : SimulatedAnalyzer;
  const res = await a.analyze({ item, text: contentText(item.content), vocabulary });
  return { ...res, at: Date.now() };
}
