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
  tone?: 'brass' | 'iris' | 'verdigris' | 'oxblood' | 'hextech';
  /**
   * What the icon stands on.
   *
   * `light` is the pale plate the painted resource masters need. `dark` is for a stroked
   * single-colour mark, which the light plate washes out: see `.icon-plate`.
   *
   * `none` is for a **picture**: a unit portrait is a whole painting with its own frame and its
   * own light, and standing one on a pale lilac square inset it by two pixels on every side and
   * ringed it in lavender. Nothing to stand on, no padding, and the box takes the picture's own
   * shape rather than forcing a 3:4 painting into a square and matting the sides.
   */
  plate?: 'light' | 'dark' | 'none';
  /**
   * How big the alcove is.
   *
   * `lg` is the 96px one this window was built around: a resource master or a unit portrait, drawn
   * at eight times its size in the bar, which is most of why these windows exist. `sm` is for a
   * *mark* rather than a picture (maintainer, 2026-09-17: the note chips' info icon should be
   * smaller). A 96px circled "i" is not a bigger look at anything; it is one glyph taking a quarter
   * of the sheet and pushing the sentence the reader came for below the fold.
   */
  iconSize?: 'lg' | 'sm';
  /**
   * The unit, and it is optional.
   *
   * A window with a figure and a bar and nothing under them is the common case now: what a player
   * opens one of these for is the number, and the paragraphs explaining what the number is for
   * came out of every readout in the standing bar. The unit block disappears entirely when there
   * is nothing in it, so an empty window closes on its header rather than on a strip of padding.
   */
  children?: ReactNode;
}

const TONE: Record<NonNullable<InfoWindowProps['tone']>, { edge: string; rule: string }> = {
  brass: { edge: 'border-brass-300/60', rule: 'from-brass-300/70' },
  iris: { edge: 'border-iris-300/60', rule: 'from-iris-300/70' },
  verdigris: { edge: 'border-verdigris-300/60', rule: 'from-verdigris-300/70' },
  oxblood: { edge: 'border-oxblood-300/60', rule: 'from-oxblood-300/70' },
  hextech: { edge: 'border-hextech-100/60', rule: 'from-hextech-100/70' },
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
  iconSize = 'lg',
  children,
}: InfoWindowProps) {
  return (
    <div
      className={cn(
        'glass-strong painted washed rivets brushed relative rounded-md border-2 shadow-panel',
        TONE[tone].edge,
      )}
      /*
       * An opaque ground, set inline, because the class stack cannot hold one (maintainer report,
       * 2026-09-15: the card is see-through over the deploy rows).
       *
       * Four texture utilities are stacked here and three of them paint a background. `.painted`
       * lays two nearly-opaque gradients, and `.rivets` then sets its own `background-image`, which
       * replaces them: the computed style on this element is the rivet dots and nothing else, so
       * the only thing left holding the window up was `.glass-strong`'s `background-color` at 0.97
       * alpha. Over a dialog that is itself over artwork, three percent of two lit surfaces is
       * plainly visible, and the row separators and the footer rule read straight through the card.
       *
       * Inline rather than a `bg-*` class for the reason the Scrapyard's parts picker records: a
       * utility here loses to whichever of these three emits last in the generated stylesheet, and
       * which one that is is not something this file gets to decide. The colour is
       * `.glass-strong`'s own, at full alpha, so nothing about the window's look changes except
       * that you can no longer see through it.
       */
      style={{ backgroundColor: 'rgb(33 28 45)' }}
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
              'flex shrink-0 items-center justify-center rounded-sm',
              iconSize === 'sm' ? 'h-9' : 'h-24 shadow-lifted',
              plate === 'none'
                ? // The picture *is* the plate. `w-auto` so a 3:4 portrait comes out 72x96 rather
                  // than sitting in a 96-wide square with a mat down both sides.
                  'w-auto overflow-hidden'
                : cn(
                    iconSize === 'sm' ? 'w-9 p-1' : 'w-24 p-2',
                    plate === 'dark' ? 'icon-plate' : 'icon-tile',
                  ),
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

      {children !== undefined && children !== null && children !== false && (
        <div className="relative flex flex-col gap-2.5 px-4 pb-4 pt-3">{children}</div>
      )}
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
