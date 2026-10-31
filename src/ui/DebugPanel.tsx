import { falloff } from '../engine/attention';
import { FOCUS_MODES, useTuning, type Curve, type FocusMode, type MotionPref, type Tuning } from '../model/tuning';

type NumKey = { [K in keyof Tuning]: Tuning[K] extends number ? K : never }[keyof Tuning];

function Slider({ k, label, min, max, step, unit = '' }: { k: NumKey; label: string; min: number; max: number; step: number; unit?: string }) {
  const v = useTuning((s) => s[k]);
  return (
    <label className="dp-row">
      <span className="dp-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => useTuning.getState().set({ [k]: Number(e.target.value) } as Partial<Tuning>)} />
      <span className="dp-val mono">{step < 1 ? v.toFixed(2) : Math.round(v)}{unit}</span>
    </label>
  );
}

function Toggle({ k, label }: { k: 'crowd' | 'showLens' | 'showAttention'; label: string }) {
  const v = useTuning((s) => s[k]);
  return (
    <label className="dp-check">
      <input type="checkbox" checked={v} onChange={(e) => useTuning.getState().set({ [k]: e.target.checked })} />
      <span>{label}</span>
    </label>
  );
}

function CurvePlot() {
  const { curve, sharpness, fullAt, widgetAt, collapseAt } = useTuning();
  const W = 240, H = 64;
  let d = '';
  for (let i = 0; i <= 60; i++) {
    const x = (i / 60) * 2.2;
    d += `${i ? 'L' : 'M'}${((x / 2.2) * W).toFixed(1)} ${(H - falloff(x, curve, sharpness) * H).toFixed(1)}`;
  }
  const line = (a: number, label: string, x: number) => (
    <g key={label}>
      <line x1="0" x2={W} y1={H - a * H} y2={H - a * H} className="dp-th" />
      <text x={x} y={H - a * H - 2} textAnchor="end" className="dp-th-t">{label}</text>
    </g>
  );
  return (
    <svg className="dp-plot" width={W} height={H + 14} viewBox={`0 -2 ${W} ${H + 16}`} aria-label="Attention by distance">
      {line(fullAt, 'full', W - 2)}{line(widgetAt, 'widget', W - 2)}{line(collapseAt, 'collapse', W - 52)}
      <path d={d} className="dp-curve" />
      <line x1={W / 2.2} x2={W / 2.2} y1="0" y2={H} className="dp-th" />
      <text x={W / 2.2 + 3} y={H + 11} className="dp-th-t">radius</text>
      <text x="0" y={H + 11} className="dp-th-t">focus</text>
    </svg>
  );
}

export function DebugPanel() {
  const open = useTuning((s) => s.panelOpen);
  const curve = useTuning((s) => s.curve);
  const motion = useTuning((s) => s.motion);
  const focusMode = useTuning((s) => s.focusMode);
  if (!open) return null;
  const set = useTuning.getState().set;
  return (
    <aside className="debug" aria-label="Tuning">
      <div className="dp-head">
        <span className="label">Tune the field</span>
        <button className="bar-btn" onClick={() => useTuning.getState().reset()}>Defaults</button>
        <button className="bar-btn" onClick={() => useTuning.getState().setPanel(false)} aria-label="Close tuning">×</button>
      </div>
      <section>
        <div className="dp-sec">Focus mode</div>
        <div className="dp-modes" role="radiogroup" aria-label="Focus mode">
          {FOCUS_MODES.map((m) => (
            <label key={m.id} className="dp-check">
              <input type="radio" name="focus-mode" checked={focusMode === m.id} onChange={() => set({ focusMode: m.id as FocusMode })} />
              <span>{m.label}</span>
            </label>
          ))}
        </div>
      </section>
      <section>
        <div className="dp-sec">Attention</div>
        <label className="dp-row">
          <span className="dp-label">Curve</span>
          <select value={curve} onChange={(e) => set({ curve: e.target.value as Curve })}>
            {(['gaussian', 'linear', 'smooth', 'inverse', 'plateau'] as Curve[]).map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <CurvePlot />
        <Slider k="radius" label="Radius" min={0.12} max={0.7} step={0.01} />
        <Slider k="sharpness" label="Sharpness" min={0.3} max={3} step={0.05} />
        <Slider k="neighbours" label="Neighbours" min={0.5} max={1} step={0.01} />
        <Slider k="fullAt" label="Full at" min={0.3} max={0.95} step={0.01} />
        <Slider k="widgetAt" label="Widget below" min={0.05} max={0.6} step={0.01} />
        <Slider k="collapseAt" label="Collapse below" min={0.05} max={0.6} step={0.01} />
        <Toggle k="crowd" label="Tighten field as the desk fills" />
      </section>
      <section>
        <div className="dp-sec">Magnetism</div>
        <Slider k="magnetRange" label="Attract within" min={0} max={200} step={1} unit="px" />
        <Slider k="snapDistance" label="Lock within" min={2} max={48} step={1} unit="px" />
        <Slider k="alignRange" label="Align edges" min={0} max={48} step={1} unit="px" />
        <Slider k="pull" label="Pull" min={0} max={1} step={0.05} />
        <Slider k="detachDistance" label="Tear at" min={24} max={220} step={1} unit="px" />
      </section>
      <section>
        <div className="dp-sec">Space & motion</div>
        <Slider k="makeRoom" label="Make room" min={0} max={320} step={1} unit="px" />
        <Slider k="stiffness" label="Stiffness" min={60} max={900} step={10} />
        <Slider k="dampingRatio" label="Damping" min={0.35} max={1.5} step={0.01} />
        <Slider k="focusSpeed" label="Focus speed" min={0.3} max={3} step={0.05} />
        <label className="dp-row">
          <span className="dp-label">Motion</span>
          <select value={motion} onChange={(e) => set({ motion: e.target.value as MotionPref })}>
            <option value="auto">follow system</option>
            <option value="full">full</option>
            <option value="reduced">reduced</option>
          </select>
        </label>
        <Toggle k="showLens" label="Show field radius" />
        <Toggle k="showAttention" label="Show attention values" />
      </section>
      <p className="dp-foot serif">Keys: <kbd>[</kbd> <kbd>]</kbd> move attention between objects · <kbd>M</kbd> cycles focus mode · <kbd>T</kbd> toggles this panel · <kbd>Esc</kbd> releases focus.</p>
    </aside>
  );
}
