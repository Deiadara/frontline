import { SKILL_NAMES, type Skills } from '@frontline/shared';
import { palette } from '../../theme/tokens';

const SIZE = 200;
const CENTER = SIZE / 2;
const MAX_R = 68;
const LABEL_R = 86;
const MAX_SKILL = 20;
const RINGS = [0.25, 0.5, 0.75, 1];

/** Angle (radians) of the i-th of eight axes, first at the top. */
function angleAt(index: number): number {
  return -Math.PI / 2 + index * ((2 * Math.PI) / SKILL_NAMES.length);
}

function point(index: number, radius: number): [number, number] {
  const a = angleAt(index);
  return [CENTER + Math.cos(a) * radius, CENTER + Math.sin(a) * radius];
}

function polygon(radiusOf: (index: number) => number): string {
  return SKILL_NAMES.map((_, i) => point(i, radiusOf(i)).join(',')).join(' ');
}

function anchorFor(x: number): 'start' | 'middle' | 'end' {
  if (x > CENTER + 4) return 'start';
  if (x < CENTER - 4) return 'end';
  return 'middle';
}

/** Compact FM-style octagon radar — one vertex per skill, scaled 1..20. */
export function SkillRadar({ skills }: { skills: Skills }) {
  const dataPoints = SKILL_NAMES.map((name, i) =>
    point(i, (skills[name] / MAX_SKILL) * MAX_R).join(','),
  ).join(' ');

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="h-full w-full"
      role="img"
      aria-label="Skill radar"
    >
      {RINGS.map((ring) => (
        <polygon
          key={ring}
          points={polygon(() => ring * MAX_R)}
          fill="none"
          stroke={palette.steel[700]}
          strokeWidth={1}
        />
      ))}
      {SKILL_NAMES.map((_, i) => {
        const [x, y] = point(i, MAX_R);
        return (
          <line
            key={i}
            x1={CENTER}
            y1={CENTER}
            x2={x}
            y2={y}
            stroke={palette.steel[700]}
            strokeWidth={1}
          />
        );
      })}
      <polygon
        points={dataPoints}
        fill={palette.neon.cyan}
        fillOpacity={0.22}
        stroke={palette.neon.cyan}
        strokeWidth={1.5}
      />
      {SKILL_NAMES.map((name, i) => {
        const [x, y] = point(i, LABEL_R);
        return (
          <text
            key={name}
            x={x}
            y={y}
            dy="0.32em"
            textAnchor={anchorFor(x)}
            fill={palette.steel[400]}
            fontSize={9}
            fontFamily="Orbitron, sans-serif"
            letterSpacing="0.5"
          >
            {name.slice(0, 3).toUpperCase()}
          </text>
        );
      })}
    </svg>
  );
}
