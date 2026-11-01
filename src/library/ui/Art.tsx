import { memo } from 'react';
import type { ImageArt } from '../model/types';

// Procedural "images". The sample library ships no binaries; each image is a
// deterministic drawing from its description, recognisable at 28px and at
// full preview size alike.

function rng(seed: number) {
  let a = seed * 2654435761 >>> 0 || 1;
  return () => { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; return ((a >>> 0) % 10000) / 10000; };
}
const hsl = (h: number, s: number, l: number) => `hsl(${((h % 360) + 360) % 360} ${s}% ${l}%)`;

export const Art = memo(function Art({ art, className, detail = true }: { art: ImageArt; className?: string; detail?: boolean }) {
  const W = 160, H = Math.round((160 * art.h) / Math.max(1, art.w));
  const r = rng(art.seed + 7);
  const h = art.hue;
  let body: React.ReactNode = null;

  switch (art.style) {
    case 'screenshot': {
      const side = 34 + r() * 14;
      const rows = Array.from({ length: 6 }, (_, i) => i);
      body = (
        <>
          <rect width={W} height={H} fill="#f6f6f4" />
          <rect width={W} height="9" fill="#e4e4e0" />
          <circle cx="6" cy="4.5" r="1.6" fill="#c9c9c4" /><circle cx="11" cy="4.5" r="1.6" fill="#c9c9c4" /><circle cx="16" cy="4.5" r="1.6" fill="#c9c9c4" />
          <rect y="9" width={side} height={H - 9} fill={hsl(h, 18, 93)} />
          {rows.map((i) => <rect key={i} x="5" y={16 + i * 8} width={side - 12 - (i % 3) * 5} height="3" fill={i === 1 ? hsl(h, 55, 45) : '#c4c4bf'} />)}
          {art.label && detail && <text x={side + 8} y="22" fontSize="8" fontFamily="Familjen Grotesk, sans-serif" fontWeight="700" fill="#18181a">{art.label.slice(0, 26)}</text>}
          {!detail || !art.label ? <rect x={side + 8} y="15" width="60" height="6" fill="#26262a" /> : null}
          <rect x={side + 8} y="30" width={W - side - 16} height={H * 0.32} fill={hsl(h + 20, 45, 78)} />
          {[0, 1, 2].map((i) => <rect key={i} x={side + 8 + i * ((W - side - 16) / 3)} y={34 + H * 0.32} width={(W - side - 16) / 3 - 4} height={H * 0.25} fill={i === 0 ? hsl(h, 30, 86) : '#e7e7e3'} />)}
          {[0, 1, 2, 3].map((i) => <rect key={i} x={side + 8} y={40 + H * 0.57 + i * 6} width={(W - side - 16) * (0.9 - i * 0.15)} height="2.4" fill="#cfcfca" />)}
        </>
      );
      break;
    }
    case 'wireframe': {
      body = (
        <>
          <rect width={W} height={H} fill="#fafaf8" />
          <g fill="none" stroke="#9a9a96" strokeWidth="1">
            <rect x="8" y="8" width={W - 16} height="12" />
            <rect x="8" y="26" width={W * 0.55} height={H * 0.4} />
            <path d={`M8 26L${8 + W * 0.55} ${26 + H * 0.4}M${8 + W * 0.55} 26L8 ${26 + H * 0.4}`} />
            <rect x={16 + W * 0.55} y="26" width={W * 0.45 - 24} height={H * 0.18} />
            <rect x={16 + W * 0.55} y={30 + H * 0.2} width={W * 0.45 - 24} height={H * 0.18} />
          </g>
          {[0, 1, 2, 3, 4].map((i) => <rect key={i} x="8" y={34 + H * 0.4 + i * 7} width={(W - 16) * (0.95 - (i % 3) * 0.2)} height="2.5" fill="#c9c9c4" />)}
          <rect x="8" y={H - 18} width="34" height="10" fill="none" stroke="#5b5b58" />
        </>
      );
      break;
    }
    case 'sketch':
    case 'scan': {
      const paper = art.style === 'scan' ? '#f1ede3' : '#fbfaf6';
      const ink = art.style === 'scan' ? '#3a3a52' : '#55555a';
      const wob = (x: number, y: number, w: number, hh: number) => {
        const j = () => (r() - 0.5) * 3;
        return `M${x + j()} ${y + j()} L${x + w + j()} ${y + j()} L${x + w + j()} ${y + hh + j()} L${x + j()} ${y + hh + j()} Z`;
      };
      const boxes = Array.from({ length: 3 + Math.floor(r() * 3) }, () => ({ x: 10 + r() * (W - 60), y: 14 + r() * (H - 50), w: 26 + r() * 30, h: 16 + r() * 22 }));
      body = (
        <>
          <rect width={W} height={H} fill={paper} />
          {art.style === 'scan' && Array.from({ length: Math.floor(H / 9) }, (_, i) => <path key={i} d={`M6 ${10 + i * 9}H${W - 6}`} stroke="#d9d2c0" strokeWidth="0.5" />)}
          <g fill="none" stroke={ink} strokeWidth="1.1" strokeLinecap="round">
            {boxes.map((b, i) => <path key={i} d={wob(b.x, b.y, b.w, b.h)} />)}
            {boxes.slice(1).map((b, i) => <path key={i} d={`M${boxes[i].x + boxes[i].w / 2} ${boxes[i].y + boxes[i].h} Q ${(boxes[i].x + b.x) / 2 + 12} ${(boxes[i].y + b.y) / 2 + 20} ${b.x + b.w / 2} ${b.y}`} />)}
            {Array.from({ length: 4 }, (_, i) => <path key={i} d={`M${10 + r() * 20} ${H - 26 + i * 5} q 10 -2 20 0 t 20 0 t ${10 + r() * 30} 0`} strokeWidth="0.8" />)}
          </g>
          {art.label && detail && <text x="10" y="11" fontSize="7" fontFamily="Georgia, serif" fontStyle="italic" fill={ink}>{art.label.slice(0, 32)}</text>}
        </>
      );
      break;
    }
    case 'photo': {
      const sky = hsl(h, 45, 70 + r() * 10), land = hsl(h + 120 + r() * 40, 28, 38 + r() * 12), mid = hsl(h + 90, 22, 55);
      const sun = { x: 20 + r() * (W - 40), y: 12 + r() * H * 0.25 };
      body = (
        <>
          <defs>
            <linearGradient id={`sky${art.seed}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={hsl(h, 40, 82)} /><stop offset="1" stopColor={sky} /></linearGradient>
          </defs>
          <rect width={W} height={H} fill={`url(#sky${art.seed})`} />
          <circle cx={sun.x} cy={sun.y} r={6 + r() * 6} fill={hsl(h + 30, 70, 90)} />
          <path d={`M0 ${H * 0.6} Q ${W * 0.25} ${H * (0.45 + r() * 0.1)} ${W * 0.5} ${H * 0.58} T ${W} ${H * (0.5 + r() * 0.1)} V ${H} H 0 Z`} fill={mid} />
          <path d={`M0 ${H * 0.75} Q ${W * 0.4} ${H * (0.62 + r() * 0.08)} ${W * 0.7} ${H * 0.74} T ${W} ${H * 0.72} V ${H} H 0 Z`} fill={land} />
          {Array.from({ length: 5 }, (_, i) => <rect key={i} x={r() * W} y={H * 0.7 + r() * H * 0.2} width="2" height={6 + r() * 8} fill={hsl(h + 140, 25, 22)} />)}
        </>
      );
      break;
    }
    case 'moodboard': {
      const cells = [[0, 0, 0.5, 0.6], [0.5, 0, 0.5, 0.35], [0.5, 0.35, 0.25, 0.25], [0.75, 0.35, 0.25, 0.25], [0, 0.6, 0.33, 0.4], [0.33, 0.6, 0.34, 0.4], [0.67, 0.6, 0.33, 0.4]];
      body = (
        <>
          <rect width={W} height={H} fill="#f2f1ee" />
          {cells.map(([x, y, w, hh], i) => (
            <rect key={i} x={x * W + 2} y={y * H + 2} width={w * W - 4} height={hh * H - 4} fill={i === 1 ? '#1b1b1d' : i === 5 ? '#efeae0' : hsl(h + i * 28, 30 + r() * 30, 40 + r() * 35)} />
          ))}
          <text x={0.5 * W + 8} y={0.25 * H} fontSize={H * 0.16} fontFamily="Source Serif 4, Georgia, serif" fill="#f2f1ee">Aa</text>
          <text x={0.33 * W + 6} y={0.85 * H} fontSize={H * 0.08} fontFamily="Familjen Grotesk, sans-serif" fontWeight="700" fill="#1b1b1d">{(art.label ?? 'Lantern').slice(0, 10)}</text>
        </>
      );
      break;
    }
    case 'diagram': {
      const nodes = Array.from({ length: 5 }, (_, i) => ({ x: 14 + (i % 3) * 48 + r() * 6, y: 14 + Math.floor(i / 3) * (H * 0.45) + r() * 6 }));
      body = (
        <>
          <rect width={W} height={H} fill="#fbfbfa" />
          <g stroke="#3c3c40" strokeWidth="1" fill="none">
            {nodes.slice(1).map((n, i) => <path key={i} d={`M${nodes[i].x + 18} ${nodes[i].y + 8}L${n.x + 18} ${n.y + 8}`} />)}
          </g>
          {nodes.map((n, i) => <rect key={i} x={n.x} y={n.y} width="36" height="16" fill={i === 0 ? hsl(h, 40, 60) : '#fff'} stroke="#3c3c40" />)}
        </>
      );
      break;
    }
    case 'chart': {
      const n = 9;
      const vals = Array.from({ length: n }, () => 0.2 + r() * 0.8);
      body = (
        <>
          <rect width={W} height={H} fill="#fbfbfa" />
          <path d={`M12 ${H - 12}H${W - 8}M12 8V${H - 12}`} stroke="#8a8a86" strokeWidth="0.8" />
          {vals.map((v, i) => <rect key={i} x={18 + i * ((W - 30) / n)} y={H - 12 - v * (H - 26)} width={(W - 30) / n - 4} height={v * (H - 26)} fill={i === n - 1 ? hsl(h, 50, 42) : hsl(h, 12, 72)} />)}
        </>
      );
      break;
    }
    case 'logo': {
      const dark = r() > 0.5;
      const fg = dark ? '#f4f1ea' : hsl(h, 60, 30), bg = dark ? hsl(h, 45, 20) : '#f4f1ea';
      body = (
        <>
          <rect width={W} height={H} fill={bg} />
          <g transform={`translate(${W / 2} ${H * 0.42})`} fill="none" stroke={fg} strokeWidth="3">
            {art.seed % 3 === 0 ? <><path d="M-10 -14h20M-8 -14v22h16v-22" /><path d="M-4 0a4 6 0 1 0 8 0a4 6 0 1 0 -8 0" fill={fg} stroke="none" /></>
              : art.seed % 3 === 1 ? <><circle r="14" /><path d="M0 -14V14M-14 0H14" strokeWidth="2" /></>
                : <path d="M-14 12L0 -14L14 12Z" />}
          </g>
          <text x={W / 2} y={H * 0.82} textAnchor="middle" fontSize={H * 0.11} fontFamily="Familjen Grotesk, sans-serif" fontWeight="700" letterSpacing="0.5" fill={fg}>{(art.label ?? 'lantern').slice(0, 14)}</text>
        </>
      );
      break;
    }
  }
  return (
    <svg className={className} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" role="img" aria-label={art.label ?? art.style}>
      {body}
    </svg>
  );
});
