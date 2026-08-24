import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * A panel's colour, as a *prop* rather than a `className` from the caller.
 *
 * `cn` is `clsx`: it concatenates and does not resolve Tailwind conflicts, so a caller's
 * `bg-soot-900` and the base `bg-surface-800/70` would both land and the stylesheet's order would
 * silently pick the winner. Same reason `Modal` takes a `size`.
 */
export type PanelTone = 'brass' | 'tangerine';

const TONE: Record<PanelTone, { body: string; head: string; heading: string }> = {
  brass: {
    body: 'bg-surface-800/70',
    head: 'bg-surface-700/70',
    heading: 'text-brass-300',
  },
  // The Black Market's, and nowhere else's. Darker than any other surface in the game on purpose.
  tangerine: {
    body: 'bg-soot-900/85',
    head: 'bg-soot-800/90',
    heading: 'text-tangerine-300',
  },
};

interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Optional header label rendered in the display font. */
  title?: ReactNode;
  /** Optional element pinned to the right of the header. */
  action?: ReactNode;
  /** Which room this panel is in. Defaults to the game's own brass. */
  tone?: PanelTone;
}

/**
 * The surface everything else sits on: warm dark glass over the world, not an opaque box.
 *
 * Translucent because the scene behind it is the point: the district stays visible under every
 * panel, the way a town view stays visible under a Grepolis dialog. The border is a hairline of
 * sodium light rather than a cyan rule, and the shadow is cast rather than glowing: chrome floating
 * over a painting has to look like it is *above* the painting, and a glow just looks like part of
 * the picture.
 */
export function Panel({ title, action, tone = 'brass', className, children, ...rest }: PanelProps) {
  return (
    <div
      className={cn(
        // A step *lighter* than the sheet it sits in, not the same value. Panels used to be the
        // same translucent dark as their container, so a screen with six of them read as one dark
        // rectangle with hairlines drawn on it: the borders were doing all the grouping on their
        // own, which is the weakest signal available. Value does the grouping now and the border
        // just finishes the edge.
        // No hard border: the frayed outline *is* the edge. Running both gives every panel a
        // double rule, which reads as a mistake rather than as a cut sheet of tin.
        'painted washed brushed rivets edge-lit relative flex flex-col rounded-sm',
        'shadow-panel',
        TONE[tone].body,
        className,
      )}
      {...rest}
    >
      {(title !== undefined || action !== undefined) && (
        <div
          className={cn(
            'relative flex items-center justify-between gap-2 px-4 py-3',
            TONE[tone].head,
          )}
        >
          {/* The hand face, and a step up in size again. A panel heading is a *name*: "On the
              shelf", "Your crew", and it is the label a player scans a screen by, so it is one of
              the places the board asked for lettering rather than a field label. */}
          <h2 className={cn('font-stamp text-[16px] leading-none', TONE[tone].heading)}>{title}</h2>
          {action}
          {/* Hand-drawn, not a border: a heading underlined with a ruler reads as a spreadsheet. */}
          <span aria-hidden className="ink-rule absolute inset-x-0 -bottom-[2px]" />
        </div>
      )}
      {children}
    </div>
  );
}
