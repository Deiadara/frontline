import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * A framed window, the way a game draws one.
 *
 * The hover explanations were a dark rounded rectangle with text in it: a tooltip, which is what
 * a form uses, and it made the most-read moment in the interface look like browser chrome. A game
 * puts a *window* there: a brass-lipped frame, a titled header band, a big picture of the thing,
 * and the words underneath with room to breathe.
 *
 * Roughly six times the area of the tooltip it replaces, which is the point. The icon inside it is
 * drawn at eight times the size it has in the bar, so pointing at a resource is the moment a
 * player actually sees what the thing looks like.
 *
 * Built from the same texture utilities as every other surface (`glass-strong`, `painted`,
 * `rivets`, `brushed`) so it belongs to the interface rather than being a second visual language,
 * but with a double frame and lit corners, which nothing else in the chrome has, so a window reads
 * as a window at a glance.
 */

export interface InfoWindowProps {
  /** The small line above the name: what kind of thing this is. */
  eyebrow?: string;
  title: string;
  /** Drawn large in its own lit alcove on the left of the header. */
  icon?: ReactNode;
  /** Pinned right of the title: a count, a price, a rating. */
  figure?: ReactNode;
  /** Accent for the frame and the header rule. Defaults to brass. */
  tone?: 'brass' | 'iris' | 'verdigris' | 'oxblood';
  /**
   * What the icon stands on.
   *
   * `light` is the pale plate the painted resource masters need. `dark` is for a stroked
   * single-colour mark, which the light plate washes out: see `.icon-plate`.
   */
  plate?: 'light' | 'dark';
  children: ReactNode;
}

const TONE: Record<NonNullable<InfoWindowProps['tone']>, { edge: string; rule: string }> = {
  brass: { edge: 'border-brass-300/60', rule: 'from-brass-300/70' },
  iris: { edge: 'border-iris-300/60', rule: 'from-iris-300/70' },
  verdigris: { edge: 'border-verdigris-300/60', rule: 'from-verdigris-300/70' },
  oxblood: { edge: 'border-oxblood-300/60', rule: 'from-oxblood-300/70' },
};

/** The four lit corners. Drawn, not implied. This is the ornament that says "window". */
function Corners({ tone }: { tone: NonNullable<InfoWindowProps['tone']> }) {
  const edge = TONE[tone].edge;
  return (
    <>
      <span
        aria-hidden
        className={cn('absolute left-1 top-1 h-3 w-3 border-l-2 border-t-2', edge)}
      />
      <span
        aria-hidden
        className={cn('absolute right-1 top-1 h-3 w-3 border-r-2 border-t-2', edge)}
      />
      <span
        aria-hidden
        className={cn('absolute bottom-1 left-1 h-3 w-3 border-b-2 border-l-2', edge)}
      />
      <span
        aria-hidden
        className={cn('absolute bottom-1 right-1 h-3 w-3 border-b-2 border-r-2', edge)}
      />
    </>
  );
}

export function InfoWindow({
  eyebrow,
  title,
  icon,
  figure,
  tone = 'brass',
  plate = 'light',
  children,
}: InfoWindowProps) {
  return (
    <div
      className={cn(
        'glass-strong painted washed rivets brushed relative rounded-md border-2 shadow-panel',
        TONE[tone].edge,
      )}
    >
      {/* The inner hairline. A single border reads as a box; two, a hair apart, read as a frame
          somebody made. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-[3px] rounded-[3px] border border-surface-500/50"
      />
      <Corners tone={tone} />

      <header className="relative flex items-start gap-3.5 px-4 pb-3 pt-3.5">
        {icon !== undefined && (
          <span
            className={cn(
              'flex h-24 w-24 shrink-0 items-center justify-center rounded-sm p-2',
              plate === 'dark' ? 'icon-plate' : 'icon-tile',
              'shadow-lifted',
            )}
          >
            {icon}
          </span>
        )}
        <span className="min-w-0 flex-1 pt-1">
          {eyebrow !== undefined && (
            <span className="block font-display text-[11px] font-bold uppercase tracking-[0.22em] text-ink-300">
              {eyebrow}
            </span>
          )}
          {/* The hand face. The eyebrow above it stays stamped: a window's title is the name of a
              thing and its eyebrow is a category, and setting both in the pen loses the difference
              that makes the pair readable at a glance. */}
          <span className="mt-0.5 block font-stamp text-[19px] leading-[1.15] text-ink-100">
            {title}
          </span>
          {figure !== undefined && <span className="mt-1.5 block">{figure}</span>}
        </span>
      </header>

      {/* A lit rule under the header, fading out: the one piece of ornament the panels share. */}
      <span
        aria-hidden
        className={cn('mx-4 block h-px bg-gradient-to-r to-transparent', TONE[tone].rule)}
      />

      <div className="relative flex flex-col gap-2.5 px-4 pb-4 pt-3">{children}</div>
    </div>
  );
}

/** A labelled block inside a window: a heading nobody has to parse, and its content. */
export function WindowSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <h4 className="font-display text-[11px] font-bold uppercase tracking-[0.2em] text-brass-300">
        {label}
      </h4>
      <div className="mt-1 min-w-0">{children}</div>
    </section>
  );
}
