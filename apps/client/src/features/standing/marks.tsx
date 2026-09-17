import { useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/cn';
import { DrawnDisc } from '../../components/ui/DrawnMarks';

/**
 * The drawn furniture the two standing ladders share.
 *
 * Same pen as `components/ui/DrawnMarks` and the feats board's own marks: a `feTurbulence` and
 * `feDisplacementMap` pair over a stroke, which is the house's way of saying a shape was drawn by
 * somebody rather than emitted by a stylesheet. Every filter carries a `useId` suffix, because a
 * ladder draws eighty of these and a hard-coded id would have all of them referencing whichever
 * copy the browser saw first.
 */

/** The ink every mark here is drawn in, so one sheet reads as one hand. */
const INK = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/**
 * The way out, top right, drawn (maintainer, 2026-09-17).
 *
 * Two crossed strokes inside a ringed disc, with the second stroke overshooting the first: a cross
 * whose two lines meet exactly at their midpoints is the one shape here that could only have come
 * off a machine, and the overshoot is what a pen leaves.
 *
 * A `Link` rather than a history pop. These two screens are opened from the standing bar, which is
 * drawn on every screen in the game, so `navigate(-1)` would land a player back on whatever they
 * happened to be reading; the maintainer asked for a way back to the game, and the game is the
 * district.
 */
export function CloseMark() {
  const id = useId();

  return (
    <Link
      to="/game"
      aria-label="Close this and go back to the district"
      data-testid="standing-close"
      className={cn(
        'relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full',
        'text-ink-200 transition-all duration-150 ease-out',
        'hover:-translate-y-px hover:text-oxblood-300',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brass-300',
      )}
    >
      <DrawnDisc />
      <svg
        viewBox="0 0 24 24"
        className="relative h-[18px] w-[18px]"
        data-testid="standing-close-mark"
        aria-hidden
      >
        <defs>
          <filter id={`close-${id}`} x="-25%" y="-25%" width="150%" height="150%">
            <feTurbulence type="fractalNoise" baseFrequency="0.07" numOctaves="2" seed="31" />
            <feDisplacementMap
              in="SourceGraphic"
              scale="1.2"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
        <g filter={`url(#close-${id})`} strokeWidth="2.1" {...INK}>
          <path d="M6.2 5.8 L18.1 18.4" />
          <path d="M18.3 5.6 L5.9 17.9" />
        </g>
      </svg>
    </Link>
  );
}

/**
 * A rung's head: a hand-drawn disc with something in it.
 *
 * The same object the feats board puts at the head of a rung, and deliberately so. Both ladders
 * are a list of numbered steps a player climbs, and the two screens are reached from the same
 * strip of chrome; drawing them differently would say they were different kinds of thing.
 */
export function RungDisc({
  children,
  tone,
  className,
  'data-testid': testId,
}: {
  children: ReactNode;
  /** The colour the disc and its contents are inked in. */
  tone: string;
  className?: string;
  'data-testid'?: string;
}) {
  return (
    <span
      className={cn('relative flex h-9 w-9 shrink-0 items-center justify-center', tone, className)}
      data-testid={testId}
    >
      <DrawnDisc />
      <span className="relative font-stamp text-[12px] leading-none">{children}</span>
    </span>
  );
}

/**
 * A tick beside something a crew has already done.
 *
 * Drawn rather than a glyph from the icon set: the icons are a struck, even-weight family and this
 * sheet is paper, so a checkmark out of the set would be the one mark on the ladder that nobody
 * drew. The short leg is deliberately shorter than a printed tick's.
 */
export function DoneMark({ className }: { className?: string }) {
  const id = useId();

  return (
    <svg viewBox="0 0 16 16" className={cn('h-3.5 w-3.5', className)} aria-hidden>
      <defs>
        <filter id={`done-${id}`} x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence type="fractalNoise" baseFrequency="0.08" numOctaves="2" seed="7" />
          <feDisplacementMap
            in="SourceGraphic"
            scale="1"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
      <g filter={`url(#done-${id})`} strokeWidth="2" {...INK}>
        <path d="M2.6 8.4 L6.2 12.4 L13.6 3.4" />
      </g>
    </svg>
  );
}
