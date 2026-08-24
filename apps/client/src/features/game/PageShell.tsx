import type { ReactNode } from 'react';
import { deliveredUrl } from '../../assets/delivered';
import { Icon, type IconName } from '../../components/ui/Icon';
import { Quote } from '../../components/ui/Quote';
import { cn } from '../../lib/cn';

/**
 * The frame every screen that is *not* a place gets.
 *
 * The roster, the missions board, research and the bar are documents — lists you read — but the
 * game is still a district you are standing in, and losing that between clicks is what makes a
 * browser game feel like a spreadsheet with art on it. So the district stays behind them, pushed
 * back with a blur and a dim, and the document floats on it in a single readable column. It is the
 * Grepolis move: the town never goes away, it just goes out of focus.
 *
 * **The scroll is inside the sheet, not on the page.** A document that scrolls the whole viewport
 * takes its own heading off the top of the screen, so a player three screens down a roster has lost
 * the one label telling them where they are, and the scrollbar runs the full height of the artwork.
 * Scrolling the sheet's body keeps the title, the count and any filter pinned where they were put —
 * which is the entire reason a games UI puts a window on the world instead of a page under it.
 *
 * The backdrop is `aria-hidden` and inert. It is scenery, and a screen reader that announced the
 * district on the missions page would be describing a room nobody is being asked to look at.
 */

/**
 * The measure a document sheet gets.
 *
 * Wider than the 64rem it started at. A reading measure is the right constraint for a page of
 * prose and the wrong one for a page of controls: every screen in this game is a table, a roster
 * or a grid of cards, and holding those to a paragraph's width left a third of a 1440px browser
 * as blurred scenery while the cards inside were too narrow to lay out properly.
 */
export const CONTENT_WIDTH = 'mx-auto w-full max-w-[80rem]';

/**
 * For screens that are mostly picture.
 *
 * The roster shows portraits, and a portrait squeezed into half of a 64rem column is a stamp. A
 * document made of prose wants a narrow measure; a document made of art wants the room.
 */
export const WIDE_CONTENT_WIDTH = 'mx-auto w-full max-w-[104rem]';

interface PageShellProps {
  /** The screen's own name, shown as its heading. */
  title: string;
  /** The icon this screen is known by in the scenery switcher — same glyph, so the two agree. */
  icon?: IconName;
  /** A short line under the title. Optional — most screens say enough with a title. */
  lede?: string;
  /**
   * A line under the title that is *not* information: a fragment of the city talking.
   *
   * Separate from `lede` because the two want opposite typography. A lede is read at a glance and
   * set small and quiet; a quotation is meant to be read once, properly, and set as lettering. A
   * screen may carry either but not both — two lines under a heading is a subtitle and a slogan
   * arguing.
   */
  quote?: string;
  /** Pinned to the right of the heading: a filter, a count, a primary action. */
  action?: ReactNode;
  /** Give the sheet the wider measure. For screens carrying art rather than paragraphs. */
  wide?: boolean;
  children: ReactNode;
}

/** The district, blurred back into scenery. Falls back to bare surface before the plate lands. */
export function SceneBackdrop({ className }: { className?: string }) {
  const plate = deliveredUrl({ type: 'plate', plate: 'district' });
  return (
    <div className={cn('absolute inset-0 overflow-hidden bg-surface-950', className)} aria-hidden>
      {plate !== null && (
        <img
          src={plate}
          alt=""
          // Over-scaled on purpose: a blur samples past its own edges, so an unscaled image shows a
          // soft transparent rim on all four sides. `data-scenery` is how the layout gates know
          // this one is meant to run past the frame — see `expectNothingClippedHorizontally`.
          data-scenery
          className="h-full w-full scale-110 object-cover opacity-[0.62] blur-[5px] saturate-[0.75]"
        />
      )}
      {/* Dimmed until the type on top of it is comfortable, and no further. Pushed back too hard
          it stops being a place and becomes a dark texture, which is the same as having no
          backdrop at all — and then a login is a form again. */}
      <div className="absolute inset-0 bg-surface-950/45" />
    </div>
  );
}

export function PageShell({
  title,
  icon,
  lede,
  quote,
  action,
  wide = false,
  children,
}: PageShellProps) {
  return (
    <div className="relative h-full w-full">
      <SceneBackdrop />
      {/* The chrome floats over the top and bottom of this box, so the sheet is inset by the
          measured height of both rather than by a guessed constant. */}
      <div
        className="relative flex h-full flex-col px-4"
        style={{
          paddingTop: 'calc(var(--hud-h, 96px) + 16px)',
          paddingBottom: 'calc(var(--nav-h, 104px) + 16px)',
        }}
      >
        <section
          className={cn(
            wide ? WIDE_CONTENT_WIDTH : CONTENT_WIDTH,
            'glass painted washed rivets taped edge-lit relative flex min-h-0 flex-1 flex-col rounded-md',
            'border border-surface-600/70 shadow-panel',
          )}
        >
          <header className="relative flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5">
            {icon !== undefined && (
              <span className="flex h-9 w-9 items-center justify-center rounded-sm border border-brass-500/40 bg-brass-300/10 text-brass-300">
                <Icon name={icon} className="h-5 w-5" />
              </span>
            )}
            <div className="min-w-0">
              {/* The hand face, because the name of a place is the one label on the screen that is
                  not a field. Larger than the stamped equivalent it replaced: a pen stroke needs
                  the size to read as a stroke rather than as a wobble. */}
              <h1 className="font-hand text-[30px] font-semibold leading-[1.1] text-ink-100">
                {title}
              </h1>
              {lede !== undefined && (
                <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-ink-300">{lede}</p>
              )}
            </div>
            {action !== undefined && <div className="ml-auto">{action}</div>}
            <span aria-hidden className="ink-rule absolute inset-x-4 bottom-0" />
          </header>

          <div className="relative min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <div className="flex flex-col gap-5">
              {/* Inside the scrolling body rather than in the pinned header: a quotation is read
                  once on arrival, and a pinned one would keep a line of poetry on screen for the
                  whole time a player is working three screens down a roster. */}
              {quote !== undefined && <Quote className="max-w-prose">{quote}</Quote>}
              {children}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * A short standing note about how something works.
 *
 * Rules a player is expected to *know* have to be written somewhere they will actually be read, and
 * the two places that never work are a wiki and a one-time tooltip. These sit next to the thing they
 * describe, permanently, and stay quiet: they are the smallest type on the screen and the only
 * element in the interface with no interaction on it at all.
 */
export function InfoNote({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'warn';
}) {
  return (
    <aside
      className={cn(
        'flex items-start gap-2.5 rounded-sm border px-3.5 py-2.5 text-xs leading-relaxed',
        tone === 'warn'
          ? 'border-brass-500/45 bg-brass-500/10 text-brass-100'
          : 'border-iris-500/40 bg-iris-500/10 text-ink-200',
      )}
    >
      <span className={tone === 'warn' ? 'text-brass-300' : 'text-iris-300'}>
        <Icon name="info" className="mt-px h-4 w-4" />
      </span>
      <p className="min-w-0">{children}</p>
    </aside>
  );
}
