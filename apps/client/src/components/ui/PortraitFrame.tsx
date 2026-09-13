import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * A frame round a portrait, drawn rather than machined (maintainer request, 2026-09-13).
 *
 * The big portraits were pictures in a hole: a 1px border, and the painting sitting in the middle
 * of a box the wrong shape with a bar of empty panel down each side of it. Two separate
 * complaints, one fix. The frame is this component; the dead space is the caller's job, and the
 * contract here is what makes it possible: **the child fills the frame**. Give the frame the box
 * you want the picture to occupy and let the picture be `h-full w-full`, rather than letting the
 * picture pick its own size inside a centred flex row.
 *
 * The line round it is `.brushed`, the same frayed pen stroke the WITHDRAW and MAX buttons carry,
 * so a framed picture reads as the same hand that drew the controls under it. On top of that, two
 * things a button does not have:
 *
 * - a cold hairline just inside the edge, with a short bloom off it. Brass outside, cyan inside:
 *   the game's two accents, and the one place the chrome is allowed to glow.
 * - four corner brackets at `lg` size, with a bolt in each and a neon chamfer cut across it.
 *   Drawn with wobbled coordinates rather than pushed through a turbulence filter, which is how
 *   `.ink-frame` does it: a filter costs a raster pass per corner per repaint and buys the same
 *   waver a curve control point buys for nothing.
 *
 * `sm` is for the 40px avatar in the top bar and anything else that small. It gets the pen line
 * and the hairline and no brackets: a 32px corner drawing on a 40px box is not a frame, it is four
 * blobs.
 */

type FrameSize = 'sm' | 'lg';

/**
 * Where each bracket sits and how far it is turned.
 *
 * One drawing, four placements. A square box turned by a right angle keeps the same bounding box,
 * so the e2e image gate still measures every bracket as sitting inside the frame it decorates.
 */
const CORNERS: readonly string[] = [
  'left-0 top-0',
  'right-0 top-0 rotate-90',
  'bottom-0 right-0 rotate-180',
  'bottom-0 left-0 -rotate-90',
];

/** The pen line inside the edge, and the cold light off it. */
const GLASS =
  'inset 0 0 0 1px rgb(34 211 238 / 0.2), inset 0 0 22px -8px rgb(34 211 238 / 0.55), ' +
  '0 10px 24px -16px rgb(0 0 0 / 0.9)';

/** The top-left bracket. Every coordinate is a little off true, because a ruled line is not. */
function CornerBracket({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={cn('pointer-events-none absolute h-8 w-8', className)}
    >
      <g fill="none" stroke="#f0ad4c" strokeLinecap="round" strokeLinejoin="round">
        <path
          d="M2.6 30.4 C2 22.1 2.1 13.7 2.8 9.2 C3.2 5.1 5.3 3.1 9.5 2.7 C14.7 2.2 22.5 2.4 30.3 2.2"
          strokeOpacity="0.82"
          strokeWidth="2"
        />
        {/* The second pass a pen makes when somebody goes round a corner twice. */}
        <path
          d="M6.9 25.3 C6.5 19.1 6.8 13.5 8 10.5 C9.3 7.5 12.4 6.8 16.2 6.7 C19.7 6.6 22.5 6.7 24.5 6.9"
          strokeOpacity="0.28"
          strokeWidth="1.1"
        />
      </g>
      {/* The chamfer: a corner cut off, lit. The one cold line in an otherwise brass drawing. */}
      <path
        d="M3.5 13.6 L13.4 3.3"
        fill="none"
        stroke="#22d3ee"
        strokeOpacity="0.5"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="8.3" cy="8.3" r="1.5" fill="#c1832a" fillOpacity="0.8" />
    </svg>
  );
}

export function PortraitFrame({
  size = 'lg',
  className,
  children,
}: {
  size?: FrameSize;
  /** The frame's own box. Whatever shape this is, the picture inside takes all of it. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-testid="portrait-frame"
      data-frame={size}
      className={cn('brushed relative overflow-hidden bg-surface-950', className)}
      style={{ boxShadow: GLASS }}
    >
      {children}
      {size === 'lg' && CORNERS.map((corner) => <CornerBracket key={corner} className={corner} />)}
    </div>
  );
}
