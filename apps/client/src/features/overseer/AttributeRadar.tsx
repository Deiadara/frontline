import {
  ATTRIBUTES_BY_GROUP,
  ATTRIBUTE_GROUPS,
  MAX_RECRUITMENT_ATTRIBUTE,
  type AttributeGroup,
  type Attributes,
} from '@frontline/shared';
import { palette } from '../../theme/tokens';

/*
 * The radar renders at ~128px, so the viewBox is kept tight: a much larger one scales the
 * axis labels down to an illegible few pixels. SIZE then has to leave room for the label to
 * sit *outside* LABEL_R without crossing the edge, or the side labels get clipped mid-word
 * ("TEC" -> "C").
 *
 * The side labels are the binding case: `CENTER + LABEL_R + labelWidth <= SIZE`. Measured in
 * Roboto Condensed (not the fallback), the widest abbreviation ("MEN") renders 22.0 viewBox
 * units, so LABEL_R <= 68.0. 56 keeps ~12.0 units of margin and still clears MAX_R.
 *
 * That headroom used to be 4.7 units, when these labels were set in Orbitron at 29.3 units wide.
 * The condensed face bought back 7.3 units of it.
 */
const SIZE = 180;
const CENTER = SIZE / 2;
const MAX_R = 50;
const LABEL_R = 56;
const RINGS = [0.25, 0.5, 0.75, 1];

const GROUP_ABBREVIATIONS: Record<AttributeGroup, string> = {
  physical: 'PHY',
  mental: 'MEN',
  social: 'SOC',
  technical: 'TEC',
};

/**
 * The character's best rating in a group. Peak rather than mean: only a handful of a
 * character's 34 attributes are ever lifted, so group means all collapse toward the 15-20
 * band (§B2) and every character would draw the same shape. The peak is also the thing a
 * player is actually reading for: what is this person great at.
 */
function peakOf(attributes: Attributes, group: AttributeGroup): number {
  return Math.max(...ATTRIBUTES_BY_GROUP[group].map((name) => attributes[name]));
}

/** Angle of the i-th axis, first at the top. */
function angleAt(index: number): number {
  return -Math.PI / 2 + index * ((2 * Math.PI) / ATTRIBUTE_GROUPS.length);
}

function point(index: number, radius: number): [number, number] {
  const a = angleAt(index);
  return [CENTER + Math.cos(a) * radius, CENTER + Math.sin(a) * radius];
}

function polygon(radiusOf: (index: number) => number): string {
  return ATTRIBUTE_GROUPS.map((_, i) => point(i, radiusOf(i)).join(',')).join(' ');
}

function anchorFor(x: number): 'start' | 'middle' | 'end' {
  if (x > CENTER + 4) return 'start';
  if (x < CENTER - 4) return 'end';
  return 'middle';
}

/**
 * Peak rating per attribute group (GDD §B4a), as a four-axis radar.
 *
 * The outer ring is the recruitment ceiling (§B2a), so a fresh character fills a readable
 * share of it and progression visibly grows the shape. If progression pushes a peak past the
 * ceiling the scale grows with it rather than clipping.
 */
export function AttributeRadar({ attributes }: { attributes: Attributes }) {
  const peaks = ATTRIBUTE_GROUPS.map((group) => peakOf(attributes, group));
  const scale = Math.max(MAX_RECRUITMENT_ATTRIBUTE, ...peaks);
  const dataPoints = peaks.map((peak, i) => point(i, (peak / scale) * MAX_R).join(',')).join(' ');

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="h-full w-full"
      role="img"
      aria-label="Attribute radar"
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
      {ATTRIBUTE_GROUPS.map((group, i) => {
        const [x, y] = point(i, MAX_R);
        return (
          <line
            key={group}
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
      {ATTRIBUTE_GROUPS.map((group, i) => {
        const [x, y] = point(i, LABEL_R);
        return (
          <text
            key={group}
            x={x}
            y={y}
            dy="0.32em"
            textAnchor={anchorFor(x)}
            fill={palette.steel[400]}
            fontSize={11}
            fontFamily="Roboto Condensed, sans-serif"
            letterSpacing="0.5"
          >
            {GROUP_ABBREVIATIONS[group]}
          </text>
        );
      })}
    </svg>
  );
}
