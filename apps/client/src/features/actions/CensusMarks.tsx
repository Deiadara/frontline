import { useId } from 'react';

/**
 * The census's own drawing kit (maintainer, 2026-09-19).
 *
 * "Make the total units page nicer, more hand drawn with custom graphics to match theme."
 *
 * The page had none: four columns of tabular figures under a name, which is a spreadsheet and not
 * a sheet of paper. What it needed was not ornament but the thing a census is actually for, drawn
 * rather than tabulated: *where your people are*. So the marks here are the four places, and the
 * bar is the split between them.
 *
 * Drawn the way the rest of this game's chrome is drawn (`components/ui/DrawnMarks.tsx`): one pen
 * pass, `currentColor`, `vectorEffect="non-scaling-stroke"` so a glyph at 14px and the same glyph
 * at 22px carry the same weight of line, and an overshoot at a corner or two because a line that
 * stops exactly where it began is a line a machine drew.
 *
 * Every mark takes its size and its colour from the box it is dropped into, so the row's small
 * version and the legend's larger one are one drawing.
 */

/** The shared pen: no fill, round ends, and a stroke that ignores the box it is stretched into. */
const PEN = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  vectorEffect: 'non-scaling-stroke',
} as const;

/**
 * Home: a roof over a door.
 *
 * The crew's own district, which is the only place on this page nobody had to take. A roof is the
 * one shape that reads as "where you live" at fourteen pixels, and the door under it is what stops
 * it reading as an arrow.
 */
export function HomeMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <g {...PEN} strokeWidth="1.7">
        <path d="M3.4 11.2 12 4.3 20.8 10.9" />
        {/* The pen carries past the eaves on the left, once. */}
        <path d="M3.4 11.2 5.2 12.4" strokeWidth="1.1" opacity="0.55" />
        <path d="M5.3 11.6 5.6 19.8 18.5 19.6 18.3 11.3" />
        <path d="M10.2 19.7 10.4 14.6 14 14.5 13.9 19.6" />
      </g>
    </svg>
  );
}

/**
 * Held: a flag on a pole, planted in ground the crew took.
 *
 * Deliberately the *only* mark with a ground line under it. "Held" and "planted" are the two
 * places off the crew's own plot and the difference between them is whose ground it is, so the
 * one standing on a line is the one standing on ground you own.
 */
export function HeldMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <g {...PEN} strokeWidth="1.7">
        <path d="M6.8 3.6 7.2 20.6" />
        <path d="M7.1 4.4 17.8 6.9 7.4 12.2" />
        <path d="M3.2 20.9 13.4 20.5" strokeWidth="1.2" opacity="0.6" />
      </g>
    </svg>
  );
}

/**
 * At the gate: the door itself, two posts and a bar, drawn in the same pen (2026-09-22).
 */
export function GateMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <g {...PEN} strokeWidth="1.7">
        <path d="M5.2 20.6 5.6 6.2" />
        <path d="M18.6 20.4 18.9 6.4" />
        <path d="M5.4 6.6 C9 3.2 15.2 3.1 19 6.4" />
        <path d="M5.8 13.4 18.4 13.2" strokeWidth="1.4" />
        <path d="M3 20.8 21.2 20.5" strokeWidth="1.2" opacity="0.6" />
      </g>
    </svg>
  );
}

/**
 * Planted: somebody under the floor of a place that is not yours.
 *
 * A dashed line over a figure, because the whole mechanic is that the ground above does not know
 * they are there (§A4, `sleepers.ts`). The dashes are the tell: every other mark here is drawn in
 * one continuous pen and this one is interrupted.
 */
export function PlantedMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <g {...PEN} strokeWidth="1.7">
        <path d="M3 8.4 7.6 8.2" />
        <path d="M10.6 8.1 15.2 8" />
        <path d="M18.2 7.9 21.3 7.8" />
        <path d="M12 12.4 A2.1 2.1 0 1 1 12 12.3" strokeWidth="1.5" />
        <path d="M8.6 20.4 C9.4 16.8 14.8 16.7 15.6 20.3" strokeWidth="1.5" />
      </g>
    </svg>
  );
}

/**
 * Out: two boot prints going somewhere.
 *
 * At a fight, walking to one, or on a job. One shape for all three on purpose: from the census's
 * side they are the same fact, which is that these people are committed and not available.
 */
export function OutMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <g {...PEN} strokeWidth="1.6">
        <path d="M6.4 16.8 C4.9 14.4 5.4 10.8 7.4 10.4 9.4 10 10.2 12.4 9.6 15 9.2 16.9 7.6 18.3 6.4 16.8 Z" />
        <path d="M6.6 19.9 C6.2 18.9 6.6 18.1 7.6 18.1 8.6 18.1 9.1 18.8 8.9 19.7" />
        <path d="M15.4 11.6 C13.9 9.2 14.4 5.6 16.4 5.2 18.4 4.8 19.2 7.2 18.6 9.8 18.2 11.7 16.6 13.1 15.4 11.6 Z" />
        <path d="M15.6 14.7 C15.2 13.7 15.6 12.9 16.6 12.9 17.6 12.9 18.1 13.6 17.9 14.5" />
      </g>
    </svg>
  );
}

/**
 * Work: an hourglass, half run.
 *
 * The In progress tab (maintainer, 2026-09-23). Everything on it is a clock, so the mark is the
 * one shape that is nothing but a clock: two cups, the sand part way through, the glass pinched in
 * the middle and the pen overrunning one cap, the way the rest of this strip is drawn.
 */
export function WorkMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <g {...PEN} strokeWidth="1.6">
        <path d="M6.3 4.4 17.6 4.2" />
        <path d="M6.6 19.7 17.4 19.5" />
        <path d="M7.6 4.6 C7.4 8.4 10.2 10.4 11.9 12 13.6 13.6 16.4 15.4 16.2 19.4" />
        <path d="M16.3 4.5 C16.6 8.3 13.8 10.3 12.1 12 10.4 13.7 7.6 15.5 7.8 19.5" />
        {/* The sand: a little left in the top cup, a heap already in the bottom one. */}
        <path d="M10.2 8.6 13.9 8.5" strokeWidth="1.2" opacity="0.7" />
        <path d="M9.4 18.2 C10.2 16.4 13.8 16.4 14.6 18.2" strokeWidth="1.2" opacity="0.7" />
        <path d="M17.6 4.2 19 4" strokeWidth="1.1" opacity="0.55" />
      </g>
    </svg>
  );
}

/**
 * Orders: a folded sheet with a seal on it, for the Right Hand's standing orders (§C2b).
 *
 * The third tab on the Monitor. A sealed letter is the one shape that reads as "instructions
 * left behind" at fourteen pixels: it is neither a person nor a place, which the other two marks
 * on this strip both are, and that difference is the point of the tab.
 */
export function OrdersMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <g {...PEN} strokeWidth="1.6">
        <path d="M4.3 6.2 19.6 5.9 19.8 18.4 4.6 18.6 Z" />
        <path d="M4.5 6.4 12 12.6 19.5 6.1" />
        {/* The seal, a little off centre, the way wax lands. */}
        <path d="M13.6 14.2 C13.2 12.9 14.6 12.1 15.5 12.9 16.4 13.7 15.7 15.2 14.6 15 13.9 14.9 13.7 14.6 13.6 14.2 Z" />
        {/* The pen runs on past the corner, once. */}
        <path d="M19.6 5.9 21 5.6" strokeWidth="1.1" opacity="0.55" />
      </g>
    </svg>
  );
}

/**
 * A hand-ruled strip showing how one sheet's people are split across the four places.
 *
 * The one piece of this page that is a *picture of the data* rather than a label on it, and the
 * reason the page is worth redrawing at all: four numbers in four columns tell a player where
 * their Razors are only after they have done the arithmetic, and this tells them at a glance which
 * of their sheets is sitting at home and which is entirely committed.
 *
 * ## Why it is drawn rather than four divs
 *
 * A stacked bar out of flexbox is four rectangles with hard edges, which on a paper sheet reads as
 * a progress meter borrowed from somewhere else. This is one pen: a ruled baseline under the whole
 * width, then a filled block per place with its own slightly-off top edge, so the strip has the
 * wobble the rest of the chrome has. The segments are drawn in the page's own order (home, held,
 * planted, out) so the eye reads the same left-to-right sequence as the figures beside it.
 *
 * Segments under {@link MIN_SLICE} of the width are widened to it and the rest are shrunk to pay
 * for it. Without that, one Sleeper in a roster of two hundred is a segment a third of a pixel
 * wide, which is a segment that is not there: the bar would say "none planted" about a crew that
 * has some, and the whole point of the strip is that it agrees with the figures beside it.
 */
const MIN_SLICE = 0.035;

export interface Slice {
  key: string;
  count: number;
  /** A Tailwind `fill-*`, so the strip's colours are the same tokens the figures use. */
  fill: string;
}

export function SplitBar({
  slices,
  total,
  className,
  label,
}: {
  slices: readonly Slice[];
  total: number;
  className?: string;
  /** What the strip is, for anybody not looking at it. The figures beside it are the detail. */
  label: string;
}) {
  const id = useId();
  const drawn = slices.filter((slice) => slice.count > 0);
  if (total <= 0 || drawn.length === 0) return null;

  /*
   * Shares, floored so nothing vanishes, then normalised so they still add to one.
   *
   * The floor is spent out of the segments that have room: raising a hairline to 3.5% has to come
   * from somewhere, and taking it proportionally from the ones above the floor keeps the big
   * segments in the right order relative to each other.
   */
  const raw = drawn.map((slice) => slice.count / total);
  const short = raw.reduce((sum, share) => sum + Math.max(0, MIN_SLICE - share), 0);
  const spare = raw.reduce((sum, share) => sum + Math.max(0, share - MIN_SLICE), 0);
  const shares = raw.map((share) =>
    share < MIN_SLICE
      ? MIN_SLICE
      : // `spare` is zero only when every segment is already at the floor, and then `short` is
        // zero too and this branch is never reached with a divisor of nothing.
        share - (spare > 0 ? (share - MIN_SLICE) * (short / spare) : 0),
  );

  let x = 0;
  const blocks = shares.map((share, index) => {
    const left = x * 100;
    x += share;
    return { slice: drawn[index]!, left, width: share * 100 };
  });

  return (
    <svg
      viewBox="0 0 100 10"
      preserveAspectRatio="none"
      className={className}
      role="img"
      aria-label={label}
    >
      <defs>
        {/* The same fractal wobble the drawn box uses, at the same scale, so a strip beside a
            drawn button does not read as a second hand. */}
        <filter id={`split-${id}`} x="-4%" y="-30%" width="108%" height="160%">
          <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="7" />
          <feDisplacementMap
            in="SourceGraphic"
            scale="0.7"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
      <g filter={`url(#split-${id})`}>
        {blocks.map(({ slice, left, width }) => (
          <rect
            key={slice.key}
            x={left}
            y={1.6}
            width={Math.max(0, width - 0.5)}
            height={6}
            className={slice.fill}
          />
        ))}
        {/* The rule under the whole width, drawn past both ends. It is what makes the blocks read
            as marks on a sheet rather than as a bar chart: the line was there first. */}
        <path
          d="M0.4 8.7 L99.6 8.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          opacity="0.5"
        />
      </g>
    </svg>
  );
}
