import {
  BATTLE_ODDS,
  BATTLE_ODDS_LABELS,
  CHANCE_TONES,
  chanceTone,
  type BattleOdds,
  type ChanceTone,
} from '@frontline/shared';
import { useId, type CSSProperties } from 'react';
import { cn } from '../../lib/cn';

/**
 * The odds on a job, read off an instrument instead of a number in a table.
 *
 * A percentage in a row of percentages is a figure a player compares and forgets. A dial is a
 * position: the needle sits in the red or it sits in the blue, and where it moves to when a
 * different leader is picked is the whole feedback loop the leader picker exists for. So this is
 * drawn as a bezelled gauge with the five bands of `CHANCE_TONES` under it, twenty points each,
 * and the figure repeated in the middle for anybody who wants the number after all.
 *
 * A battle job reads off the same instrument with four bands and no number on it, because a
 * battle is not a roll against a chance: the crew fights a force it cannot see, with the real
 * engine, and what the screen can honestly say beforehand is a band (`battleOdds`).
 */

/** What the needle is pointing at: a chance out of one, or a battle's band. */
export type GaugeReading =
  { kind: 'chance'; chance: number } | { kind: 'battle'; odds: BattleOdds };

/**
 * A battle's four bands in the gauge's own five-tone vocabulary.
 *
 * Yellow is the one dropped: four bands over the same arc want the widest spacing they can get,
 * and orange beside yellow at 45 degrees apart is two shades of the same warning. Lives here
 * rather than in the shared model because it is a fact about how this dial is painted, not about
 * what a fight is worth.
 */
const BATTLE_ODDS_TONES: Readonly<Record<BattleOdds, ChanceTone>> = {
  low: 'red',
  moderate: 'orange',
  good: 'green',
  very_high: 'blue',
};

/** The dial, in the SVG's own units. The pivot is the bottom centre of the arc. */
const PIVOT = { x: 110, y: 118 } as const;
const R_FACE = 96;
const R_BEZEL = 100;
const R_HAIRLINE = 95;
const R_BAND = 86;
const R_TICK_OUT = 78;
const R_TICK_IN = 69;
/** A minor tick is drawn from the same outer radius and stops short of the major's inner end. */
const R_TICK_MINOR_IN = 73;
const R_NEEDLE_TIP = 84;
const R_NEEDLE_BASE = 50;

/** A point on the dial. `at` runs 0 at the left of the arc to 1 at the right. */
function point(radius: number, at: number): { x: number; y: number } {
  const angle = Math.PI * (1 - at);
  return {
    x: PIVOT.x + radius * Math.cos(angle),
    y: PIVOT.y - radius * Math.sin(angle),
  };
}

const round = (value: number) => Math.round(value * 100) / 100;

/** An arc of the dial, drawn left to right, which is clockwise in SVG's y-down coordinates. */
function arc(radius: number, from: number, to: number): string {
  const start = point(radius, from);
  const end = point(radius, to);
  return `M ${round(start.x)} ${round(start.y)} A ${radius} ${radius} 0 0 1 ${round(end.x)} ${round(end.y)}`;
}

/** The face the bands are painted on: the arc closed back across its own diameter. */
function faceOfTheDial(radius: number): string {
  return `${arc(radius, 0, 1)} Z`;
}

/** Where the blade begins and ends, so the drawing below stays tied to the radii above. */
const TIP_Y = PIVOT.y - R_NEEDLE_TIP;
const BASE_Y = PIVOT.y - R_NEEDLE_BASE;

/**
 * The needle, drawn rather than struck.
 *
 * It was an isosceles triangle: three points, perfectly symmetric, which is the one shape on the
 * dial that could only have come out of a machine. This is the same blade with a taper down each
 * side and the two sides not quite equal, so it reads as a pointer somebody cut out.
 */
const NEEDLE_BLADE =
  `M ${PIVOT.x} ${TIP_Y} ` +
  `C ${PIVOT.x - 1.7} ${TIP_Y + 12}, ${PIVOT.x - 3.6} ${BASE_Y - 12}, ${PIVOT.x - 4.9} ${BASE_Y} ` +
  `L ${PIVOT.x + 4.6} ${BASE_Y + 0.7} ` +
  `C ${PIVOT.x + 3.4} ${BASE_Y - 12}, ${PIVOT.x + 1.7} ${TIP_Y + 12}, ${PIVOT.x} ${TIP_Y} Z`;

/** The counterweight under the pivot. Every real needle has one, and it says which end is which. */
const NEEDLE_TAIL = `M ${PIVOT.x} ${PIVOT.y} C ${PIVOT.x - 0.3} ${PIVOT.y + 3}, ${PIVOT.x - 0.5} ${PIVOT.y + 5}, ${PIVOT.x - 0.7} ${PIVOT.y + 7.4}`;

/** How far the coloured bands are pulled back from each other, so the joins read as joins. */
const BAND_GAP = 0.004;

/**
 * How far past the ends of the sweep the pen carries on.
 *
 * A stroke that stops dead on 0 and 1 is a stroke a machine laid down. Everything ruled round the
 * outside of this dial runs a little past where it had to stop, which is what a hand does.
 */
const OVERSHOOT = 0.016;

const BAND_CLASS: Readonly<Record<ChanceTone, string>> = {
  red: 'gauge-band-red',
  orange: 'gauge-band-orange',
  yellow: 'gauge-band-yellow',
  green: 'gauge-band-green',
  blue: 'gauge-band-blue',
};

/** Where the needle sits and what colours it, for either kind of reading. */
export function gaugeDial(reading: GaugeReading): {
  bands: readonly ChanceTone[];
  at: number;
  tone: ChanceTone;
  figure: string;
} {
  if (reading.kind === 'chance') {
    /*
     * Rounded once, and the needle, the band and the figure all read that one number.
     *
     * The dial used to colour itself off the raw chance while printing the rounded one, so 0.599
     * struck `60%` in yellow and 0.601 struck the same `60%` in green: two jobs a player is being
     * asked to compare, quoted the same odds in two different tones, which is the one thing five
     * colours exist to make impossible. Whole points is the precision this instrument prints, so
     * it is the precision it points at.
     */
    const points = Math.round(Math.min(1, Math.max(0, reading.chance)) * 100);
    return {
      bands: CHANCE_TONES,
      at: points / 100,
      tone: chanceTone(points / 100),
      figure: `${points}%`,
    };
  }
  const index = BATTLE_ODDS.indexOf(reading.odds);
  return {
    bands: BATTLE_ODDS.map((odds) => BATTLE_ODDS_TONES[odds]),
    // The middle of its own band: a band is all the screen knows, so a needle anywhere else in it
    // would be claiming a precision the model does not have.
    at: (index + 0.5) / BATTLE_ODDS.length,
    tone: BATTLE_ODDS_TONES[reading.odds],
    figure: BATTLE_ODDS_LABELS[reading.odds],
  };
}

export function MissionGauge({
  reading,
  label,
  className,
}: {
  reading: GaugeReading;
  /** What is being measured, for anybody who cannot see the dial. */
  label: string;
  className?: string;
}) {
  const { bands, at, tone, figure } = gaugeDial(reading);
  const angle = round(-90 + at * 180);
  /*
   * The band the needle is standing in, found from the tone rather than recomputed from `at`.
   *
   * It is the lit band, so it has to be the band whose colour the figure under it is struck in.
   * A second floor-and-clamp of the same number here would be a second place for the banding to
   * be a point out, and the two would disagree silently at exactly the boundaries.
   */
  const lit = bands.indexOf(tone);
  /* Scoped, because two dials on one page would otherwise share one filter by whichever
     `<defs>` the document reached first. */
  const pen = `gauge-pen-${useId().replace(/:/g, '')}`;

  return (
    <div
      className={cn('mission-gauge rivets relative w-full max-w-[13.75rem]', className)}
      data-testid="mission-gauge"
      data-tone={tone}
      data-angle={angle}
      role="img"
      aria-label={`${label}: ${figure}`}
    >
      <svg viewBox="0 0 220 132" className="block h-auto w-full" aria-hidden="true">
        <defs>
          {/*
           * The wobble, once, for everything ruled on the face.
           *
           * The same displaced-stroke grammar as `.ink-disc` and `.ink-chair` in the stylesheet:
           * fractal noise driving a displacement map, which pushes every edge off true by up to
           * half the scale. It is what the rest of the game's line work is drawn with, and it is
           * the whole answer to "the graphics do not match the game": the dial was the one object
           * on the screen with machine-perfect arcs on it.
           *
           * The filter region is grown past the default because an arc that has been displaced
           * outward is wider than its own bounding box and would otherwise be cut at the rim.
           */}
          <filter id={pen} x="-6%" y="-6%" width="112%" height="112%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.055"
              numOctaves="3"
              seed="23"
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="1.7"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>

        <g filter={`url(#${pen})`}>
          {/* Smoked glass under the bands, so the instrument has a face rather than being four
              arcs floating on the panel. */}
          <path d={faceOfTheDial(R_FACE)} fill="#09070f" fillOpacity="0.55" />

          {/* The rim, gone round twice and running past both ends, the way a pen does. */}
          <path d={arc(R_BEZEL, -OVERSHOOT, 1 + OVERSHOOT)} className="gauge-bezel" />
          <path
            d={arc(R_BEZEL - 3.4, OVERSHOOT * 1.8, 1 - OVERSHOOT * 0.6)}
            fill="none"
            stroke="#f0ad4c"
            strokeOpacity="0.3"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
          <path d={arc(R_HAIRLINE, OVERSHOOT, 1 - OVERSHOOT)} className="gauge-hairline" />
          {/* One cold line on a brass instrument: the game's other accent, and the only part of
              this that says the dial is wired to something. */}
          <path
            d={arc(R_HAIRLINE - 2.8, 0.03, 0.97)}
            fill="none"
            stroke="#22d3ee"
            strokeOpacity="0.24"
            strokeWidth="1"
            strokeLinecap="round"
          />

          {bands.map((band, index) => {
            const d = arc(
              R_BAND,
              index / bands.length + (index === 0 ? 0 : BAND_GAP),
              (index + 1) / bands.length - (index === bands.length - 1 ? 0 : BAND_GAP),
            );
            return (
              <g key={band + String(index)}>
                {/*
                 * The band the needle is in is the one that glows.
                 *
                 * A wide, faint copy of the same arc under the band itself: a paint halo, not a
                 * `drop-shadow`. A CSS shadow inside a displaced group gets smeared along with
                 * everything else and comes out as a bruise, and this way the glow is made of the
                 * same stroke the band is, at the same tone, and wobbles with it.
                 */}
                {index === lit && (
                  <path
                    d={d}
                    className={cn('gauge-band', BAND_CLASS[band])}
                    /* `style`, not a `stroke-width` attribute: `.gauge-band` declares the width in
                       the stylesheet, and a CSS declaration beats a presentation attribute, so the
                       halo would silently come out exactly as wide as the band it is under. */
                    style={{ strokeWidth: 22 }}
                    opacity={0.28}
                  />
                )}
                <path
                  d={d}
                  className={cn('gauge-band', BAND_CLASS[band])}
                  opacity={index === lit ? 1 : 0.62}
                />
              </g>
            );
          })}

          {/*
           * Ticks at every band edge and one between each pair, the minor ones drawn short.
           *
           * Twice as many marks as there were, because a five-band dial with six ticks on it is a
           * chart; a scale a player can count along is an instrument.
           */}
          {Array.from({ length: bands.length * 2 + 1 }, (_, index) => {
            const major = index % 2 === 0;
            const outer = point(R_TICK_OUT, index / (bands.length * 2));
            const inner = point(major ? R_TICK_IN : R_TICK_MINOR_IN, index / (bands.length * 2));
            return (
              <line
                key={index}
                x1={round(outer.x)}
                y1={round(outer.y)}
                x2={round(inner.x)}
                y2={round(inner.y)}
                className="gauge-tick"
                style={{ strokeWidth: major ? 1.8 : 1 }}
                opacity={major ? 1 : 0.6}
              />
            );
          })}
        </g>

        <g className="gauge-needle" style={{ '--gauge-angle': `${angle}deg` } as CSSProperties}>
          <path d={NEEDLE_BLADE} />
          {/* The ink line round the blade: brass on brass bands needs an edge to stay a needle. */}
          <path
            d={NEEDLE_BLADE}
            fill="none"
            stroke="#2b1a04"
            strokeOpacity="0.55"
            strokeWidth="0.8"
            strokeLinejoin="round"
          />
          <path
            d={NEEDLE_TAIL}
            fill="none"
            stroke="#f0ad4c"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </g>

        {/* Last, over the blade: the nut the needle turns on. */}
        <g filter={`url(#${pen})`}>
          <circle cx={PIVOT.x} cy={PIVOT.y} r={6} className="gauge-hub" />
          <circle
            cx={PIVOT.x}
            cy={PIVOT.y}
            r={9.8}
            fill="none"
            stroke="#f0ad4c"
            strokeOpacity="0.3"
            strokeWidth="1.2"
          />
        </g>
      </svg>

      {/*
       * The figure, in the well the needle sweeps around rather than through.
       *
       * Ordinary DOM over the drawing, not an SVG `<text>`: a battle's band is two words that have
       * to wrap, and the cut-text sweeps in the e2e suite measure boxes that a `<text>` does not
       * have. The box is sized to sit inside the annulus the blade sweeps around: its far corners
       * are 49 of the dial's units from the pivot and the blade starts at `R_NEEDLE_BASE`, so no
       * angle puts the needle through the figure.
       */}
      <span className="absolute inset-x-[35%] top-[62%] flex h-[22%] items-center justify-center">
        <span
          data-testid="gauge-figure"
          className={cn(
            'gauge-figure text-center font-display font-bold leading-none tabular-nums',
            reading.kind === 'chance'
              ? 'text-[22px] tracking-[0.02em]'
              : 'text-[11px] uppercase leading-tight tracking-[0.1em]',
          )}
        >
          {figure}
        </span>
      </span>
    </div>
  );
}
