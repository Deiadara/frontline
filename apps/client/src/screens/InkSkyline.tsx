import { useId, useMemo } from 'react';
import { mulberry32 } from '@frontline/shared';

/**
 * The city at the door, drawn by hand (maintainer, 2026-09-27).
 *
 * The landing screen is the first frame of the game, and it was a form over a blurred painting.
 * This is the skyline in the same brass ink the rest of the interface is drawn in: outlines rather
 * than fills, pushed through the wobble filter every drawn mark shares (`DrawnMarks.tsx`), with the
 * Combine's spire over the rooftops and two searchlights sweeping the cloud. Lit windows are a
 * seeded scatter, so the drawing is the same city on every visit.
 *
 * Decorative only: `aria-hidden`, `pointer-events-none`, and the searchlights hold still for anybody
 * who has asked the system for less motion.
 */

const WIDTH = 1440;
const HEIGHT = 320;
const GROUND = 312;

interface Block {
  x: number;
  w: number;
  h: number;
  roof: 'flat' | 'step' | 'tank' | 'mast' | 'saw';
}

/** A seeded row of rooftops across the width, tallest near the spire. */
function blocksFor(seed: number): Block[] {
  const next = mulberry32(seed);
  const roofs: Block['roof'][] = ['flat', 'step', 'tank', 'mast', 'saw'];
  const blocks: Block[] = [];
  let x = 0;
  while (x < WIDTH) {
    // The last block stops at the edge: the drawing stretches to the screen rather than being
    // cropped by it, so nothing it draws may hang past its own frame.
    const w = Math.min(38 + Math.floor(next() * 70), WIDTH - x);
    const nearSpire = 1 - Math.min(1, Math.abs(x + w / 2 - 980) / 700);
    const h = 60 + Math.floor(next() * 90) + Math.floor(nearSpire * 70);
    blocks.push({ x, w, h, roof: roofs[Math.floor(next() * roofs.length)]! });
    x += w + Math.floor(next() * 6);
  }
  return blocks;
}

/** One building's outline, from the ground up and back down. */
function outline(block: Block): string {
  const { x, w, h, roof } = block;
  const top = GROUND - h;
  const right = x + w;
  switch (roof) {
    case 'step':
      return `M${x} ${GROUND} V${top + 14} H${x + w * 0.35} V${top} H${right - w * 0.2} V${top + 10} H${right} V${GROUND}`;
    case 'tank': {
      const cx = x + w * 0.6;
      return `M${x} ${GROUND} V${top} H${right} V${GROUND} M${cx - 9} ${top} V${top - 16} H${cx + 9} V${top} M${cx - 11} ${top - 16} Q${cx} ${top - 26} ${cx + 11} ${top - 16}`;
    }
    case 'mast': {
      const cx = x + w * 0.3;
      return `M${x} ${GROUND} V${top} H${right} V${GROUND} M${cx} ${top} V${top - 34} M${cx - 6} ${top - 22} H${cx + 6}`;
    }
    case 'saw': {
      const tooth = w / 3;
      return `M${x} ${GROUND} V${top} L${x + tooth} ${top - 10} V${top} L${x + tooth * 2} ${top - 10} V${top} L${right} ${top - 10} V${GROUND}`;
    }
    default:
      return `M${x} ${GROUND} V${top} H${right} V${GROUND}`;
  }
}

/** Lit windows: a seeded scatter of short dashes inside each block, never on the roofline. */
function windowsFor(blocks: readonly Block[], seed: number): { x: number; y: number }[] {
  const next = mulberry32(seed);
  const lit: { x: number; y: number }[] = [];
  for (const block of blocks) {
    const rows = Math.floor((block.h - 24) / 16);
    const cols = Math.floor((block.w - 12) / 12);
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        if (next() > 0.14) continue;
        lit.push({ x: block.x + 8 + col * 12, y: GROUND - block.h + 20 + row * 16 });
      }
    }
  }
  return lit;
}

export function InkSkyline({ className }: { className?: string }) {
  const id = useId();
  const blocks = useMemo(() => blocksFor(4217), []);
  const windows = useMemo(() => windowsFor(blocks, 911), [blocks]);
  const pen = `pen-${id}`;
  const beam = `beam-${id}`;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden
      data-testid="ink-skyline"
    >
      <defs>
        <filter id={pen} x="-5%" y="-10%" width="110%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="19" />
          <feDisplacementMap in="SourceGraphic" scale="2.4" />
        </filter>
        {/* In user space, so the fade runs from the spire to the top of the beam wherever it has
            swung, and the light is gone before the drawing's own edge. */}
        <linearGradient id={beam} x1="0" y1="70" x2="0" y2="-560" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f0ad4c" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#f0ad4c" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* The searchlights, from the spire's shoulders, sweeping slowly out of step. */}
      <g className="ink-searchlight ink-searchlight-a" style={{ transformOrigin: '968px 70px' }}>
        <path d="M968 70 L840 -560 L1040 -560 Z" fill={`url(#${beam})`} />
      </g>
      <g className="ink-searchlight ink-searchlight-b" style={{ transformOrigin: '992px 70px' }}>
        <path d="M992 70 L1080 -560 L1260 -560 Z" fill={`url(#${beam})`} />
      </g>

      <g
        filter={`url(#${pen})`}
        fill="none"
        stroke="#f0ad4c"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* A cable strung across the rooftops, sagging between two masts. */}
        <path
          d="M40 150 Q300 214 560 168 Q760 132 900 176"
          strokeOpacity="0.35"
          strokeWidth="1.2"
        />
        {blocks.map((block) => (
          <path
            key={block.x}
            d={outline(block)}
            strokeOpacity="0.55"
            strokeWidth="1.8"
            fill="#120d1a"
            fillOpacity="0.55"
          />
        ))}
        {/* The Combine's spire: a needle over everything, a ring of lamps near the top. */}
        <path
          d="M950 312 V120 L962 70 L980 20 L998 70 L1010 120 V312"
          strokeOpacity="0.8"
          strokeWidth="2.2"
          fill="#120d1a"
          fillOpacity="0.8"
        />
        <path d="M956 118 H1004 M962 96 H998" strokeOpacity="0.55" strokeWidth="1.4" />
        <path d="M980 20 V-6" strokeOpacity="0.8" strokeWidth="1.6" />
        <path d="M1 312.5 H1439" strokeOpacity="0.7" strokeWidth="2" />
      </g>

      <g fill="#f0ad4c">
        {windows.map((pane) => (
          <rect
            key={`${pane.x}-${pane.y}`}
            x={pane.x}
            y={pane.y}
            width="5"
            height="3"
            rx="1"
            opacity="0.55"
          />
        ))}
        <circle cx="980" cy="-6" r="2.5" className="ink-beacon" />
      </g>
    </svg>
  );
}
