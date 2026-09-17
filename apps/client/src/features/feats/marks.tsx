import { useId, type CSSProperties, type ReactNode } from 'react';
import type { FeatState } from '@frontline/shared';
import { cn } from '../../lib/cn';
import { DrawnDisc } from '../../components/ui/DrawnMarks';

/**
 * The drawn furniture of the feats screen.
 *
 * Everything here is a pen line rather than a border: the same `feTurbulence` and
 * `feDisplacementMap` pair `PortraitFrame` and `MissionGauge` use, which is the house's way of
 * saying a shape was drawn by somebody rather than emitted by a stylesheet. Kept in one module
 * because the ladder, the ledger and the claim button all want the same hand.
 *
 * The filters carry `useId` suffixes. Six ladders on a screen mean six copies of every drawing,
 * and a hard-coded filter id would have all of them referencing whichever one the browser saw
 * first: on a page that mounts and unmounts cards as the filter changes, that is a drawing that
 * loses its wobble the moment its owner is scrolled past.
 */

/** The ink every mark on this screen is drawn in, so a card reads as one hand. */
const INK = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/**
 * What each state is drawn in.
 *
 * Four states, four colours, and the assignment is not decorative. Brass is the colour of every
 * decision in this interface, so a rung that is *ready* wears it and nothing else does. Iris is
 * the pointing colour and marks the rung being worked on. Claimed is spent ink. Locked is the
 * chrome's own surface: a shut door is furniture, not information.
 */
export const RUNG_TONE: Readonly<Record<FeatState, string>> = {
  locked: 'text-surface-500',
  open: 'text-iris-300',
  ready: 'text-brass-300',
  claimed: 'text-ink-500',
};

/**
 * A closed ring of petals: `count` bulges, each swelling from `inner` out to `outer`.
 *
 * Quadratic rather than arcs, because a control point at the outer radius gives a petal that is
 * fat in the middle and pinched at both ends, which is what the edge of a rosette looks like. An
 * arc of the same chord comes out as a scallop with corners.
 */
function petals(count: number, inner: number, outer: number): string {
  const round = (value: number) => Math.round(value * 10) / 10;
  const at = (radius: number, turn: number): [number, number] => [
    round(50 + radius * Math.cos(turn * Math.PI * 2)),
    round(50 + radius * Math.sin(turn * Math.PI * 2)),
  ];
  let path = `M ${at(inner, 0).join(' ')}`;
  for (let index = 0; index < count; index += 1) {
    const [cx, cy] = at(outer, (index + 0.5) / count);
    const [x, y] = at(inner, (index + 1) / count);
    path += ` Q ${cx} ${cy} ${x} ${y}`;
  }
  return `${path} Z`;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'] as const;

/** The step number as a numeral, or the step itself when a chain outgrows the table. */
export function roman(step: number): string {
  return ROMAN[step - 1] ?? String(step);
}

/**
 * The mark at the head of a rung: a hand-drawn disc with the step's numeral in it.
 *
 * A locked rung gets a padlock instead of a numeral, and that is the maintainer's rule about locking
 * kept honest at the level of the pixels: the server sends zeros for a locked feat so that its
 * real figure cannot leak, and a roman numeral on the disc would be the one number left on a row
 * that is supposed to have none.
 */
export function RungMark({
  step,
  state,
  className,
}: {
  step: number;
  state: FeatState;
  className?: string;
}) {
  const locked = state === 'locked';

  return (
    <span
      className={cn(
        'relative flex h-9 w-9 shrink-0 items-center justify-center',
        RUNG_TONE[state],
        className,
      )}
      data-testid={`feat-rung-mark-${state}`}
    >
      <DrawnDisc />
      {locked ? (
        <svg viewBox="0 0 24 24" className="relative h-4 w-4" aria-hidden>
          <path d="M6.4 10.6h11.2v9H6.4z" strokeWidth="1.7" {...INK} />
          <path d="M8.8 10.6V7.9a3.2 3.2 0 0 1 6.4 0v2.7" strokeWidth="1.7" {...INK} />
        </svg>
      ) : (
        <span className="relative font-stamp text-[13px] leading-none">{roman(step)}</span>
      )}
    </span>
  );
}

/**
 * The ladder's upright, behind the discs.
 *
 * Tiled at a fixed 120px rather than stretched to the card's height, for the reason `.ink-rule`
 * tiles: one drawing stretched over a two-rung card and a five-rung card is the same wobble at two
 * different frequencies, and the eye reads the squeezed one as a zigzag. The path opens and closes
 * at the same x so the seam between tiles is invisible.
 */
export const SPINE: CSSProperties = {
  backgroundRepeat: 'repeat-y',
  backgroundSize: '5px 120px',
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='5' height='120'%3E%3Cpath d='M2.5 0 C 1.5 20, 3.4 40, 2.5 60 S 1.4 100, 2.5 120' fill='none' stroke='%23f0ad4c' stroke-opacity='0.45' stroke-width='1.7' stroke-linecap='round'/%3E%3C/svg%3E\")",
};

/**
 * The page's own seal: a rosette somebody inked, with the collected figure struck into it.
 *
 * The maintainer asked for a page that looks drawn rather than generated, and a screen made of
 * two hundred progress bars needs one object on it that is unmistakably a picture. This is
 * it: two rings that do not close, a ring of ticks between them, and two ribbon tails under it.
 */
export function FeatSeal({ children, className }: { children: ReactNode; className?: string }) {
  const id = useId();

  return (
    // The size is the caller's, because the seal is the tallest thing in the summary box and
    // therefore the one thing that decides how much of the sheet that box takes.
    <span
      className={cn(
        'relative flex shrink-0 items-center justify-center',
        className ?? 'h-[7.5rem] w-[7.5rem]',
      )}
    >
      <svg viewBox="0 0 100 108" className="absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <filter id={`seal-${id}`} x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="3" seed="7" />
            <feDisplacementMap
              in="SourceGraphic"
              scale="1.5"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
        {/* The ribbon first, so the medal sits on top of where the two tails meet. */}
        <g
          className="text-oxblood-500"
          filter={`url(#seal-${id})`}
          {...INK}
          strokeWidth="1.6"
          opacity="0.75"
        >
          <path d="M38 78 L31 105 L42 99 L48 106 L48 84" />
          <path d="M62 78 L69 105 L58 99 L52 106 L52 84" />
        </g>
        <g className="text-brass-500" filter={`url(#seal-${id})`} {...INK}>
          {/* The scalloped edge, and the reason it is scalloped: the first version ringed the
              medal in evenly spaced radial ticks, which is a clock face. Sixteen petals is a
              rosette, and nothing else in the interface is one. */}
          <path d={petals(16, 38, 47)} strokeWidth="1.5" opacity="0.7" />
          <path d="M50 9 A41 41 0 1 1 49.4 9" strokeWidth="1.7" opacity="0.9" />
          <path d="M50 17 A33 33 0 1 1 49.5 17" strokeWidth="1" opacity="0.45" />
        </g>
      </svg>
      {/* Lifted off the vertical centre of the viewBox, because the ribbon takes the bottom
          eighth of the drawing and a figure centred on the box sits low in the medal. */}
      <span className="relative -mt-[0.6rem] flex flex-col items-center">{children}</span>
    </span>
  );
}

/**
 * The door's glyph, on the bottom bar.
 *
 * The icon set (`components/ui/Icon`) has no mark for this and adding one there would be an edit
 * to a file the whole interface shares for the sake of a single door. It is drawn here instead, on
 * the set's own 24-unit grid at its own 1.6 stroke with round joins, so it sits in the row as a
 * sibling of the other thirteen rather than as an import from somewhere else.
 *
 * A rosette, deliberately the same object as the seal at the top of the page: the door and the
 * screen behind it are the same picture at two sizes, which is the cheapest way to make a new
 * fourteenth door in a crowded bar feel like it has always been there. It avoids the podium and
 * star of `standings` and the flask of `research`, the two marks it could otherwise be confused
 * with at 28px: two rings and a pair of tails, and no star anywhere in it.
 */
export function FeatsDoorGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-full w-full" aria-hidden>
      <g {...INK} strokeWidth="1.6">
        {/* The two ribbon tails first, so the medal is drawn over where they meet. */}
        <path d="M9.1 14.4 L6.6 21.6 L9.9 19.8 L12 21.9 L14.1 19.8 L17.4 21.6 L14.9 14.4" />
        <circle cx="12" cy="8.8" r="6.5" />
        {/* The second ring, struck a little off centre: a seal is pressed by hand and never lands
            concentric, and the offset is what stops the pair reading as a target. */}
        <circle cx="12.2" cy="8.6" r="3.4" strokeWidth="1.3" opacity="0.75" />
      </g>
    </svg>
  );
}
