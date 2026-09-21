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

/**
 * The dial, in the SVG's own units (redrawn 2026-09-19).
 *
 * ## It stands on the floor of its box
 *
 * "Have it start from the bottom of its box." The pivot used to sit fourteen units above the
 * bottom of the viewBox to leave room for a counterweight hanging below it, so the instrument
 * floated in its panel with a band of dead plate under it. The pivot is on the floor now: the
 * viewBox ends just past the hub, the counterweight is gone with the gap it needed, and a drawn
 * baseplate runs along the bottom for the dial to stand on. A gauge is bolted to something.
 *
 * ## The radii, outside in
 *
 * `R_RIM` is the pen line round the whole instrument. The bands are painted in the channel
 * between `R_CHANNEL_OUT` and the ticks, and `R_CHANNEL_OUT` is where the inner rule is ruled, so
 * the colour reads as a wash inside a drawn channel rather than as four arcs floating free.
 */
const PIVOT = { x: 110, y: 112 } as const;
/** The whole drawing, so the geometry and the viewBox cannot drift apart. */
const BOX = { w: 220, h: 120 } as const;
const R_FACE = 97;
const R_RIM = 101;
const R_CHANNEL_OUT = 94;
const R_BAND = 86;
const R_CHANNEL_IN = 78;
const R_TICK_OUT = 77;
const R_TICK_IN = 68;
/** A minor tick is drawn from the same outer radius and stops short of the major's inner end. */
const R_TICK_MINOR_IN = 72;
const R_NEEDLE_TIP = 87;
const R_NEEDLE_BASE = 50;
/** The nut the needle turns on, which is also what the instrument stands on. */
const R_HUB = 5.6;

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
 *
 * ## Why it stops short of its own pivot
 *
 * It was drawn through the hub to a stub on the far side for one revision, which is what a real
 * balanced needle does and which broke the instrument: the figure is struck in the well *inside*
 * the blade's inner end, and a blade that reaches the hub sweeps straight through it. At 50% the
 * dial read `80%` with a needle skewering both digits. Measured rather than reasoned about, by
 * driving the CSS angle to each end of the travel and to dead centre and looking at all three.
 *
 * So the blade begins at {@link R_NEEDLE_BASE} and the well lives under it. That is the idiom on
 * any instrument whose face carries a number, and the gap is what the hub's ring is for: it reads
 * as a pointer turning on a spindle rather than as a wedge glued to one.
 */
const NEEDLE_BLADE =
  // Tip, down the left edge with the taper carrying most of the length, a short flat heel that is
  // not quite square to the blade, and back up the right. Slender on purpose: the first cut
  // rounded the heel across four and a half units and the needle came out a paddle floating in
  // the middle of the face rather than a pointer swung from the spindle.
  `M ${PIVOT.x} ${TIP_Y} ` +
  `C ${PIVOT.x - 0.8} ${TIP_Y + 16}, ${PIVOT.x - 2.4} ${BASE_Y - 14}, ${PIVOT.x - 3.1} ${BASE_Y - 0.6} ` +
  `L ${PIVOT.x + 3.3} ${BASE_Y + 0.8} ` +
  `C ${PIVOT.x + 2.5} ${BASE_Y - 14}, ${PIVOT.x + 0.8} ${TIP_Y + 16}, ${PIVOT.x} ${TIP_Y} Z`;

/**
 * The spindle: a thin arm from the nut out to the heel of the blade.
 *
 * Without it the pointer floats, which is what the first two cuts of this looked like. Drawn at
 * under a unit wide so that at the one angle where it crosses the struck figure it reads as a
 * hairline behind the digits rather than as a bar through them, and stopping a little short of
 * the heel so the two are drawn objects rather than one welded shape.
 */
const NEEDLE_SPINDLE = `M ${PIVOT.x} ${PIVOT.y - R_HUB - 1} L ${PIVOT.x} ${BASE_Y + 1.5}`;

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
      <svg viewBox={`0 0 ${BOX.w} ${BOX.h}`} className="block h-auto w-full" aria-hidden="true">
        <defs>
          {/*
           * The wobble, once, for everything on the instrument.
           *
           * The same displaced-stroke grammar as `.ink-disc` and `.ink-chair` in the stylesheet:
           * fractal noise driving a displacement map, which pushes every edge off true by up to
           * half the scale. Every part of the dial goes through it now, the needle included. It
           * used to sit outside, with a CSS `drop-shadow` of its own, and that was most of why
           * the gauge read as a machined bezel with a cartoon arrow laid on top of it rather than
           * as one drawn object.
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

          {/*
           * Rust: a blotchy alpha, cut out of whatever shape is put through it.
           *
           * "Make it a little rusty." Turbulence at a much coarser frequency than the pen's, run
           * through a component transfer that crushes most of the alpha to nothing and leaves
           * ragged islands, then composited `in` the source so the islands are the shape of the
           * thing being rusted. Painting oxide patches by hand would have put them in the same
           * three places on every dial on the board; this way each arc oxidises along its own
           * length and no two look stamped from one plate.
           *
           * `type="discrete"` on the alpha is what gives it an edge. A linear ramp produces a
           * soft airbrushed cloud, which reads as bloom; rust has a boundary.
           */}
          <filter id={`${pen}-rust`} x="-12%" y="-12%" width="124%" height="124%">
            {/*
             * Fine speckle, not clods.
             *
             * At 0.12 the noise cells were several units across, which on a stroke three units
             * wide means one cell covers the whole width: every patch came out as a solid blob
             * with a hard rim, and the dial looked like it had been dropped in mud rather than
             * left out in the rain. 0.34 puts several cells across the stroke, so the oxide
             * breaks up along it.
             */}
            <feTurbulence type="fractalNoise" baseFrequency="0.22" numOctaves="2" seed="9" />
            <feComponentTransfer result="patches">
              {/*
               * Mostly nothing, with a soft-edged patch where the noise happens to peak.
               *
               * The two numbers that matter are the grain and the *coverage*, and they were got
               * wrong in opposite directions one after the other. Coarse noise with a hard step
               * gave clods of mud sitting proud of the rim; fine noise with a full ramp gave a
               * continuous crust that buried the brass. Five leading zeros is what makes this
               * patchy: the oxide only appears in the top third of the noise's range, so most of
               * the rim stays metal and the rest goes off in places.
               */}
              <feFuncA type="table" tableValues="0 0 0 0 0 0.25 0.6 0.35 0.1 0" />
            </feComponentTransfer>
            <feComposite in="SourceGraphic" in2="patches" operator="in" />
          </filter>
        </defs>

        <g filter={`url(#${pen})`}>
          {/* Smoked glass under the bands, so the instrument has a face rather than being four
              arcs floating on the panel. */}
          <path d={faceOfTheDial(R_FACE)} fill="#0b0813" fillOpacity="0.6" />

          {/*
           * The baseplate the whole thing stands on (maintainer, 2026-09-19).
           *
           * Drawn past both ends of the arc, twice, with the second pass short and offset: the
           * same overshoot every other drawn line in this game carries. It is what turns "the
           * dial is flush with the bottom of its box" from a cropping accident into a bench the
           * instrument is bolted to.
           */}
          <g fill="none" stroke="#8c6a3f" strokeLinecap="round" vectorEffect="non-scaling-stroke">
            <path d={`M 6 ${PIVOT.y + 0.9} L ${BOX.w - 6} ${PIVOT.y + 0.4}`} strokeWidth="2.1" />
            <path
              d={`M 14 ${PIVOT.y + 3} L ${BOX.w * 0.42} ${PIVOT.y + 2.6}`}
              strokeWidth="1.1"
              strokeOpacity="0.28"
            />
          </g>

          {/*
           * The rim, once, running past both ends the way a pen does.
           *
           * It went round twice: the heavy bezel and a light `#e0b65a` line inside it. The second
           * pass is gone (maintainer, 2026-09-19: "remove the yellow line going around the
           * circle, keep it only at the bottom"). The bright line the dial needs is the one along
           * the baseplate, where it reads as the bench the instrument is bolted to; following the
           * arc as well, it read as a second rim and was the last thing on the drawing still
           * looking machined.
           */}
          <path d={arc(R_RIM, -OVERSHOOT, 1 + OVERSHOOT)} className="gauge-bezel" />

          {/*
           * ...and the oxide in it.
           *
           * **Narrower than the rim, not wider.** The first cut drew the rust at 5.4 against a
           * bezel of 5, so every patch the mask left stood a fraction proud of the brass on both
           * sides, and through the pen's displacement on top of that it came out as clods of mud
           * stuck to the outside of the instrument rather than as metal going off. Kept inside
           * the rim at 3.6 and 2.2 it stains the brass instead of replacing it.
           *
           * Lighter, too. Oxide on brass is a warm ochre, not the near-black the first pass used:
           * at 0.85 opacity in `#6d3a1c` the patches read as holes in the rim.
           */}
          <g filter={`url(#${pen}-rust)`}>
            <path
              d={arc(R_RIM, -OVERSHOOT * 0.5, 1 + OVERSHOOT * 0.5)}
              fill="none"
              stroke="#bb7538"
              strokeOpacity="0.55"
              strokeWidth="3.6"
              strokeLinecap="round"
            />
            <path
              d={arc(R_RIM - 1.1, 0.07, 0.92)}
              fill="none"
              stroke="#8a4a24"
              strokeOpacity="0.3"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            {/* A little of it has run down the plate under the left shoulder, along the grain of
                the baseplate rather than across it. */}
            <path
              d={`M 24 ${PIVOT.y - 1.4} L 52 ${PIVOT.y - 0.8}`}
              fill="none"
              stroke="#8a4622"
              strokeOpacity="0.3"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          </g>

          {/*
           * The channel the colour is washed into: one rule outside the bands and one inside.
           *
           * This is the change that makes the dial read as drawn rather than assembled. The bands
           * used to be four saturated arcs with nothing round them, so each one was its own
           * object; ruled top and bottom they are a wash inside a drawn track, which is how a
           * painted scale on a real instrument is made and how everything else in this game is
           * inked.
           */}
          <g
            fill="none"
            stroke="#c8b9a2"
            strokeOpacity="0.3"
            strokeLinecap="round"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          >
            <path d={arc(R_CHANNEL_OUT, -OVERSHOOT * 0.6, 1 + OVERSHOOT)} />
            <path d={arc(R_CHANNEL_IN, OVERSHOOT, 1 - OVERSHOOT * 1.4)} />
          </g>

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
                {/* The wash, oxidising. The same arc in dark oxide, eaten by the rust mask, so
                    the paint on the scale is weathered rather than freshly laid. Lighter over
                    the lit band: that one is the reading, and rust must not cost it contrast. */}
                <g filter={`url(#${pen}-rust)`} opacity={index === lit ? 0.3 : 0.45}>
                  <path d={d} fill="none" stroke="#5e3417" strokeWidth="12" strokeLinecap="butt" />
                </g>
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

          {/* The needle, inside the pen with everything else, and the nut over it. */}
          <g className="gauge-needle" style={{ '--gauge-angle': `${angle}deg` } as CSSProperties}>
            <path
              d={NEEDLE_SPINDLE}
              fill="none"
              stroke="#b98a3e"
              strokeOpacity="0.75"
              strokeWidth="0.9"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            <path d={NEEDLE_BLADE} />
            {/* The ink line round the blade: brass on brass bands needs an edge to stay a
                needle. */}
            <path
              d={NEEDLE_BLADE}
              fill="none"
              stroke="#2b1a04"
              strokeOpacity="0.6"
              strokeWidth="0.8"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>

          <circle cx={PIVOT.x} cy={PIVOT.y} r={R_HUB} className="gauge-hub" />
          <circle
            cx={PIVOT.x}
            cy={PIVOT.y}
            r={R_HUB + 3.4}
            fill="none"
            stroke="#c1832a"
            strokeOpacity="0.4"
            strokeWidth="1.1"
            vectorEffect="non-scaling-stroke"
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
      {/*
       * The well, and it is a different box for each of the two readings.
       *
       * The constraint is one line of arithmetic and it is worth writing down, because getting it
       * wrong puts the needle through the figure and nothing but a screenshot catches it.
       *
       * **A chance** can point anywhere, including straight up at fifty, so its box has to sit
       * inside `R_NEEDLE_BASE` of the pivot at every angle: half the width is 0.135 x 220 = 30
       * units, the top edge is 112 - 0.648 x 120 = 34 above the pivot, and sqrt(30^2 + 34^2) =
       * 45.3 against a blade that starts at 50.
       *
       * **A battle** parks in the middle of one of four bands and so is only ever at 22.5 or 67.5
       * degrees off vertical. That buys the width its label needs: at 67.5 the heel of the blade
       * is at x = 110 + 50 sin 67.5 = 156, and this box stops at 149.6. Which it needs, because
       * "Very high chance" wraps to three lines in the chance dial's narrow well and the third
       * line lands on the hub. Two lines here, and the box is tall enough for them.
       */}
      <span
        className={cn(
          'absolute flex items-center justify-center',
          reading.kind === 'chance'
            ? 'inset-x-[36.5%] top-[64.8%] h-[19.5%]'
            : // Higher as well as wider: two lines of label centred where the one-line figure
              // sits reach 105.9 down the dial, and the hub's ring starts at 103.
              'inset-x-[32%] top-[58%] h-[24%]',
        )}
      >
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
