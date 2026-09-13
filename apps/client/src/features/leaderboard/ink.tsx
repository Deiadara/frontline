import { useId, type CSSProperties, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * Everything on the standings that is drawn rather than bordered.
 *
 * The screen was a flat table: 1px rules, a numbered column and five cells of the same weight. The
 * board asked for the hand the rest of the game is drawn with, so the furniture here is authored in
 * the same grammar as `.ink-disc`, `.ink-frame` and `MissionGauge`: vector strokes pushed off true
 * by a fractal-noise displacement map, which is what makes a curve read as a pen rather than as a
 * path. Nothing here is an asset, so a hundred rows cost no request and the whole screen scales.
 *
 * ## One period runs the whole sheet
 *
 * A ledger is ruled paper: the lines do not stop where the entries do. {@link ROW_HEIGHT} is that
 * period, {@link RULED_ROW} puts one rule under each row, and {@link LedgerFill} carries the same
 * rule down through the empty space at the bottom of a tall viewport, in phase, which is the whole
 * answer to "there is a lot of empty space below the rows". Change the period in one place or the
 * rules under the last row and the rules under nothing will drift apart by a pixel a row.
 */

/** A row's height in px, and the period the ruled paper is drawn at. */
export const ROW_HEIGHT = 42;

/**
 * The three metals a place is struck in.
 *
 * Gold and bronze are `brass-300` and a copper mixed from the `ember` ramp, silver is the cool
 * `ferrite` grey. The chrome palette has exactly one warm metal in it, so a third medal had to come
 * from somewhere: the copper is the only value on this screen that is not already a token, and it
 * exists because three medals that a player cannot tell apart are not three medals.
 */
export type Metal = 'gold' | 'silver' | 'bronze';

const METALS: Readonly<Record<Metal, { face: string; deep: string; lit: string }>> = {
  gold: { face: '#f0ad4c', deep: '#77500f', lit: '#ffe4ae' },
  silver: { face: '#c7cddb', deep: '#475569', lit: '#eef1f7' },
  bronze: { face: '#b3702c', deep: '#4a2a05', lit: '#e0a460' },
};

const PLACES: readonly Metal[] = ['gold', 'silver', 'bronze'];

/**
 * The metal a place is worth, or null for everybody else.
 *
 * By rank rather than by position in the list, so two crews sharing third both get the bronze: the
 * board hands out places, and a shared place is still that place.
 */
export function metalFor(rank: number): Metal | null {
  return PLACES[rank - 1] ?? null;
}

/**
 * A filter id nothing else on the page can collide with.
 *
 * Two medals in one document sharing one `<defs>` id is the classic SVG bug: whichever filter the
 * parser reached first wins, and every other drawing silently borrows its noise seed.
 */
function usePenId(prefix: string): string {
  return `${prefix}-${useId().replace(/:/g, '')}`;
}

/** The pen. Fractal noise driving a displacement map, exactly as the rest of the game inks. */
function Pen({ id, scale, seed }: { id: string; scale: number; seed: number }) {
  return (
    // Grown past the default region: a stroke displaced outward is wider than its own bounding box
    // and would otherwise be cut off at the rim of the drawing.
    <filter id={id} x="-8%" y="-8%" width="116%" height="116%">
      <feTurbulence type="fractalNoise" baseFrequency="0.055" numOctaves="3" seed={seed} />
      <feDisplacementMap
        in="SourceGraphic"
        scale={scale}
        xChannelSelector="R"
        yChannelSelector="G"
      />
    </filter>
  );
}

const round = (value: number) => Math.round(value * 100) / 100;

/** The knurling round the rim of a struck coin: twelve short radial marks. */
const KNURL = Array.from({ length: 12 }, (_, index) => {
  const angle = (index * Math.PI) / 6;
  return {
    x1: round(22 + 18.9 * Math.cos(angle)),
    y1: round(22 + 18.9 * Math.sin(angle)),
    x2: round(22 + 20.9 * Math.cos(angle)),
    y2: round(22 + 20.9 * Math.sin(angle)),
  };
});

/** The coin itself, with nothing struck on it: the numeral is the caller's, in real type. */
function MedalArt({ metal }: { metal: Metal }) {
  const pen = usePenId('standings-medal');
  const { face, deep, lit } = METALS[metal];
  return (
    <svg viewBox="0 0 44 44" aria-hidden className="absolute inset-0 h-full w-full">
      <defs>
        <Pen id={pen} scale={1.3} seed={23} />
      </defs>
      <g filter={`url(#${pen})`}>
        <circle cx="22" cy="22" r="18.4" fill={deep} fillOpacity="0.6" />
        {KNURL.map((mark) => (
          <line
            key={`${mark.x1},${mark.y1}`}
            {...mark}
            stroke={face}
            strokeOpacity="0.45"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        ))}
        {/* Gone round twice at slightly different radii, which is what a pen does when somebody
            circles something on paper. Same move as `.ink-disc`. */}
        <circle
          cx="22"
          cy="22"
          r="18.4"
          fill="none"
          stroke={face}
          strokeOpacity="0.9"
          strokeWidth="2"
        />
        <circle
          cx="22"
          cy="22"
          r="15.3"
          fill="none"
          stroke={lit}
          strokeOpacity="0.32"
          strokeWidth="1"
        />
        {/* One lit arc on the top-left shoulder: the thing that says metal rather than circle. */}
        <path
          d="M8.4 15.4 A 14.6 14.6 0 0 1 21 7.6"
          fill="none"
          stroke={lit}
          strokeOpacity="0.55"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

/**
 * A place, struck.
 *
 * The numeral is a DOM child rather than an SVG `<text>` on purpose. It keeps the rank in real type
 * at the size the rest of the table is set in, and it keeps the rank cell's `textContent` equal to
 * the rank, which is what the ranking gates read.
 */
export function MedalPlate({
  metal,
  className,
  children,
}: {
  metal: Metal;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <span className={cn('relative inline-flex items-center justify-center', className)}>
      <MedalArt metal={metal} />
      <span className="relative" style={{ color: METALS[metal].lit }}>
        {children}
      </span>
    </span>
  );
}

/** Where one leaf sits on a branch, and how far it is turned. */
function leaf(angle: number, radius: number, tilt: number) {
  const radians = (angle * Math.PI) / 180;
  const x = 50 + radius * Math.cos(radians);
  const y = 52 - radius * Math.sin(radians);
  // The tangent to the branch, in SVG's y-down frame, then tilted toward the top of the wreath:
  // laurel leaves lie along the branch and point the way it is growing.
  const turn = (Math.atan2(-Math.cos(radians), -Math.sin(radians)) * 180) / Math.PI + tilt;
  return { x: round(x), y: round(y), turn: round(turn) };
}

/** Where the branch itself runs: bottom-left round to the top, in five-degree steps. */
function branch(from: number, to: number, radius: number): string {
  const step = from < to ? 5 : -5;
  const points: string[] = [];
  for (let angle = from; step > 0 ? angle <= to : angle >= to; angle += step) {
    const radians = (angle * Math.PI) / 180;
    points.push(
      `${round(50 + radius * Math.cos(radians))} ${round(52 - radius * Math.sin(radians))}`,
    );
  }
  return `M ${points.join(' L ')}`;
}

/** The left branch runs from the foot of the wreath up to the gap at the top. */
const BRANCH_FROM = 250;
const BRANCH_TO = 110;

/** The angles the leaves sit at on the left branch. */
const LEAF_ANGLES = [238, 216, 194, 172, 150, 128];

/** The same angle on the other branch: the wreath is one drawing reflected about its own axis. */
const mirror = (angle: number) => 180 - angle;

/**
 * A laurel, drawn.
 *
 * Computed rather than traced: the branch is an arc sampled every five degrees and each leaf is an
 * ellipse laid on the tangent at its own angle, so the two halves are one drawing mirrored and
 * changing the count is changing a list. The displacement filter is what turns the arithmetic back
 * into something somebody drew.
 */
export function Wreath({
  metal,
  className,
  children,
}: {
  metal: Metal;
  className?: string;
  children?: ReactNode;
}) {
  const pen = usePenId('standings-wreath');
  const { face } = METALS[metal];
  return (
    <span className={cn('relative inline-flex items-center justify-center', className)}>
      <svg viewBox="0 0 100 100" aria-hidden className="absolute inset-0 h-full w-full">
        <defs>
          <Pen id={pen} scale={1.6} seed={11} />
        </defs>
        <g filter={`url(#${pen})`} stroke={face} strokeLinecap="round">
          {[false, true].map((flipped) => (
            <g key={String(flipped)}>
              <path
                d={
                  flipped
                    ? branch(mirror(BRANCH_FROM), mirror(BRANCH_TO), 38)
                    : branch(BRANCH_FROM, BRANCH_TO, 38)
                }
                fill="none"
                strokeOpacity="0.7"
                strokeWidth="2"
              />
              {LEAF_ANGLES.map((angle) => {
                const at = leaf(flipped ? mirror(angle) : angle, 43, flipped ? -22 : 22);
                return (
                  <ellipse
                    key={`${String(flipped)}-${angle}`}
                    cx={at.x}
                    cy={at.y}
                    rx="9"
                    ry="3.5"
                    fill={face}
                    fillOpacity="0.22"
                    strokeOpacity="0.62"
                    strokeWidth="1.3"
                    transform={`rotate(${at.turn} ${at.x} ${at.y})`}
                  />
                );
              })}
            </g>
          ))}
          {/* The tie at the foot, where somebody bound the two branches together. */}
          <path
            d="M37 87.7 C 42.5 91.6, 57.5 91.6, 63 87.7"
            fill="none"
            strokeOpacity="0.7"
            strokeWidth="1.8"
          />
        </g>
      </svg>
      {children}
    </span>
  );
}

/**
 * The mark in the gutter of the reader's own row.
 *
 * A tint alone is findable only by somebody already looking at the right part of the sheet. This is
 * a pen mark somebody put in the margin next to their own name, which is what the eye catches when
 * it is running down a hundred rows.
 */
export function YouMark() {
  const pen = usePenId('standings-you');
  return (
    <svg
      viewBox="0 0 10 42"
      aria-hidden
      className="pointer-events-none absolute inset-y-0 left-1 h-full w-2.5"
    >
      <defs>
        <Pen id={pen} scale={1.1} seed={7} />
      </defs>
      <g filter={`url(#${pen})`} stroke="#f0ad4c" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.9 6 L2.5 36" fill="none" strokeOpacity="0.85" strokeWidth="2.4" />
        <path
          d="M5.6 17.5 L10.4 22.2 L5.4 26.8"
          fill="none"
          strokeOpacity="0.75"
          strokeWidth="1.8"
        />
      </g>
    </svg>
  );
}

/**
 * The rule the ledger is ruled with.
 *
 * Drawn at 300px so the wobble has the same frequency however wide the sheet is, exactly as
 * `.ink-rule` does it, and at the row's own height so one drawing does both jobs below.
 */
const LEDGER_RULE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='42'%3E%3Cpath d='M0 40.4 C 46 39.7, 92 41.2, 140 40.4 S 232 39.7, 268 41 S 292 40.1, 300 40.4' fill='none' stroke='%23e6c99a' stroke-opacity='0.32' stroke-width='1.2' stroke-linecap='round'/%3E%3C/svg%3E\")";

/** One entry on the ruled sheet: fixed height, with the rule drawn along its foot. */
export const RULED_ROW: CSSProperties = {
  height: ROW_HEIGHT,
  backgroundImage: LEDGER_RULE,
  backgroundRepeat: 'repeat-x',
  backgroundPosition: 'bottom',
  backgroundSize: `300px ${ROW_HEIGHT}px`,
};

/**
 * The rest of the page, ruled and empty.
 *
 * Grows into whatever the rows leave over, which at 1920x1080 was a third of the sheet of blank
 * paper. Fainter than the rules between entries, because a line under nothing should not read as
 * loudly as a line under somebody.
 */
export function LedgerFill() {
  return (
    <div
      aria-hidden
      data-testid="ledger-fill"
      className="min-h-0 flex-1 opacity-50"
      style={{
        backgroundImage: LEDGER_RULE,
        backgroundRepeat: 'repeat',
        backgroundSize: `300px ${ROW_HEIGHT}px`,
      }}
    />
  );
}

/**
 * A faction's seats, as a row of chairs rather than a number in a column.
 *
 * Five ticks, filled for the seats taken. A rival reading the maintainer wants to know whether there is
 * room at the table, and "4" makes them remember what the cap is; four filled and one open does
 * not.
 */
export function SeatTicks({ taken, of }: { taken: number; of: number }) {
  return (
    <svg
      viewBox={`0 0 ${of * 6} 12`}
      aria-hidden
      className="shrink-0"
      style={{ width: of * 6, height: 12 }}
    >
      {Array.from({ length: of }, (_, index) => (
        <rect
          key={index}
          x={index * 6 + 0.9}
          y={index % 2 === 0 ? 2.4 : 2.9}
          width="4"
          height="7"
          rx="1"
          fill={index < taken ? '#5fbcaf' : 'none'}
          fillOpacity="0.75"
          stroke="#5fbcaf"
          strokeOpacity={index < taken ? 0.9 : 0.4}
          strokeWidth="1"
        />
      ))}
    </svg>
  );
}
