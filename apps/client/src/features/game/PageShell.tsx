import type { ReactNode } from 'react';
import { deliveredUrl } from '../../assets/delivered';
import { HoverCard } from '../../components/ui/HoverCard';
import { DrawnInfo } from '../../components/ui/DrawnMarks';
import { Icon, type IconName } from '../../components/ui/Icon';
import { InfoWindow } from '../../components/ui/InfoWindow';
import { ScreenLoad } from '../../components/ui/LoadFailure';
import { Quote } from '../../components/ui/Quote';
import { cn } from '../../lib/cn';

/**
 * The frame every screen that is *not* a place gets.
 *
 * The roster, the missions board, research and the bar are documents, lists you read, but the
 * game is still a district you are standing in, and losing that between clicks is what makes a
 * browser game feel like a spreadsheet with art on it. So the district stays behind them, pushed
 * back with a blur and a dim, and the document floats on it in a single readable column. It is the
 * Grepolis move: the town never goes away, it just goes out of focus.
 *
 * **The scroll is inside the sheet, not on the page.** A document that scrolls the whole viewport
 * takes its own heading off the top of the screen, so a player three screens down a roster has lost
 * the one label telling them where they are, and the scrollbar runs the full height of the artwork.
 * Scrolling the sheet's body keeps the title, the count and any filter pinned where they were put,
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
  /**
   * The screen's own name, and **most screens do not have one**.
   *
   * A door on the scenery switcher already carries the name, lit, at the bottom of every screen in
   * the game: printing it again at the top of the sheet is the same word twice on one frame, and
   * the second one costs a header. So the pages the switcher leads to open on a quotation instead
   * (`quote`), which is what the roster has always done.
   *
   * What keeps a title is a screen with no door: the two the standing bar leads to, the back room
   * behind the Market, the testing bench, and a character's own file, where the heading is a
   * *person's name* rather than the name of a screen.
   */
  title?: string;
  /** The icon this screen is known by in the scenery switcher: same glyph, so the two agree. */
  icon?: IconName;
  /** A short line under the title. Optional: most screens say enough with a title. */
  lede?: string;
  /**
   * The line a screen opens on when it has no name to print: a fragment of the city talking.
   *
   * Separate from `lede` because the two want opposite typography. A lede is read at a glance and
   * set small and quiet; a quotation is meant to be read once, properly, and set as lettering. A
   * screen may carry either but not both: two lines at the top of a sheet is a subtitle and a
   * slogan arguing.
   */
  quote?: string;
  /**
   * A ruled line under the quotation, the one a titled screen's header ends in (maintainer,
   * 2026-09-23, for the settings). Off by default: a quote-only screen has no header and most of
   * them want the body to start straight under the line of poetry.
   */
  ruled?: boolean;
  /** Pinned to the right of the heading: a filter, a count, a primary action. */
  action?: ReactNode;
  /**
   * The page fills the sheet and does its own scrolling, rather than the sheet scrolling the page.
   *
   * The default is right for a document: everything stacks, the body scrolls, and a screen that
   * grew a row is a screen you scroll a little further. It is wrong for a screen that is a
   * *console*, where the useful thing is that the controls stay where they were put and one region
   * inside them moves. Training is the first: the roster rail scrolls and nothing else does, so a
   * player picking the fourth officer does not lose the sheet they were reading off the top of the
   * screen to do it.
   */
  fills?: boolean;
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
          // this one is meant to run past the frame: see `expectNothingClippedHorizontally`.
          data-scenery
          className="h-full w-full scale-110 object-cover opacity-[0.62] blur-[5px] saturate-[0.75]"
        />
      )}
      {/* Dimmed until the type on top of it is comfortable, and no further. Pushed back too hard
          it stops being a place and becomes a dark texture, which is the same as having no
          backdrop at all, and then a login is a form again. */}
      <div className="absolute inset-0 bg-surface-950/45" />
    </div>
  );
}

export function PageShell({
  title,
  icon,
  lede,
  quote,
  ruled = false,
  action,
  wide = false,
  fills = false,
  children,
}: PageShellProps) {
  /**
   * Whether the action goes on the quotation's line rather than in a header of its own.
   *
   * Only when there is a quotation and no name: a screen with a title has a line already and the
   * action belongs at the end of it, and an action with neither keeps the header, because it has to
   * be drawn somewhere.
   */
  const onQuoteLine = action !== undefined && title === undefined && quote !== undefined;

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
          data-testid="page-sheet"
        >
          {/* No name, no header. A screen that opens on a quotation has nothing to pin: the
              quotation belongs in the scrolling body (read once, on arrival) and a header holding
              only a rule is forty pixels of the sheet spent on a line. A screen with a count or a
              filter keeps the row for it, with no heading in it. */}
          {(title !== undefined || (action !== undefined && !onQuoteLine)) && (
            <header className="relative flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5">
              {icon !== undefined && title !== undefined && (
                <span className="flex h-9 w-9 items-center justify-center rounded-sm border border-brass-500/40 bg-brass-300/10 text-brass-300">
                  <Icon name={icon} className="h-5 w-5" />
                </span>
              )}
              {title !== undefined && (
                <div className="min-w-0">
                  {/* The hand face, because the name of a place is the one label on the screen that
                      is not a field. Larger than the stamped equivalent it replaced: a pen stroke
                      needs the size to read as a stroke rather than as a wobble. */}
                  <h1 className="font-stamp text-[22px] font-semibold leading-[1.1] text-ink-100">
                    {title}
                  </h1>
                  {lede !== undefined && (
                    <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-ink-300">
                      {lede}
                    </p>
                  )}
                </div>
              )}
              {action !== undefined && <div className="ml-auto">{action}</div>}
              <span aria-hidden className="ink-rule absolute inset-x-4 bottom-0" />
            </header>
          )}

          <div
            className={cn(
              'relative min-h-0 flex-1 px-5',
              fills ? 'flex flex-col overflow-hidden py-4' : 'overflow-y-auto py-5',
            )}
          >
            <div className={cn('flex flex-col', fills ? 'min-h-0 flex-1 gap-3' : 'gap-5')}>
              {/* Inside the scrolling body rather than in the pinned header: a quotation is read
                  once on arrival, and a pinned one would keep a line of poetry on screen for the
                  whole time a player is working three screens down a roster. */}
              {quote !== undefined && (
                /*
                 * The action rides the quotation's line when there is no name to pin it beside
                 * (maintainer, 2026-09-17).
                 *
                 * The market's city picker went into `action`, which opened the header, and a
                 * header on a screen whose whole heading is one line of poetry is a second row
                 * pushing the quotation and everything under it down the sheet. There is nothing
                 * else on that line, so the control goes on it.
                 */
                <span
                  className={cn(
                    fills && 'shrink-0',
                    onQuoteLine && 'flex flex-wrap items-center justify-between gap-x-4 gap-y-2',
                  )}
                >
                  <Quote>{quote}</Quote>
                  {onQuoteLine && action}
                </span>
              )}
              {quote !== undefined && ruled && (
                <span
                  aria-hidden
                  className="ink-rule -mt-2 block w-full"
                  data-testid="quote-rule"
                />
              )}
              {children}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * The two states before a screen's data lands, inside the frame the screen will have.
 *
 * A screen that has not loaded has not drawn its `PageShell` yet, so a bare {@link ScreenLoad}
 * goes straight into the shell's outlet at the top-left of the viewport, which is where the
 * standing bar is drawn. Seven screens shipped that way: the market, the back room, the board,
 * the workshop, the yard, the garage and the gym all put "would not load" and a Try again button
 * in the DOM, correctly worded, six inches under an opaque bar. A player got a blurred district
 * and nothing else, which is the failure `LoadFailure` was written to end, arrived at from the
 * other side.
 *
 * So the framed version is a component rather than seven copies of `<PageShell><ScreenLoad/>`:
 * a screen returns this before its data is there, and cannot put the message where the chrome is.
 */
export function ScreenLoadSheet(props: Parameters<typeof ScreenLoad>[0]) {
  return (
    <PageShell wide>
      <ScreenLoad {...props} />
    </PageShell>
  );
}

/**
 * A standing note about how something works, folded behind one chip.
 *
 * Rules a player is expected to *know* have to be written somewhere they will actually be read, and
 * the two places that never work are a wiki and a one-time tooltip. They were pinned above the
 * thing they describe, permanently, and that turned out to be a third place that does not work: a
 * paragraph that never changes is a paragraph a player reads once and then looks past forever,
 * while it goes on taking sixty pixels off the top of every screen it is on.
 *
 * So it is a chip now, with the note on a torn scrap of paper on hover. The words are unchanged and
 * one movement away; the screen underneath gets its room back. This is how every strategy game of
 * this shape does it, and the reason is the same: the rule is reference material, and reference
 * material belongs where the pointer is, not where the content should be.
 */
export function InfoNote({
  children,
  tone = 'neutral',
  /** What the chip says, and what the note is titled. Short: it is a label, not a summary. */
  label = 'How this works',
  size = 'md',
  drawn = false,
  ink = 'brass',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'warn';
  label?: string;
  /** `sm` is a chip that sits on a panel's head beside its title, at the head's own height. */
  size?: 'md' | 'sm';
  /**
   * The pen rather than the plate (maintainer, 2026-09-21): the box the crew screen's door and
   * the archive's tabs wear, for a note that sits on a paper screen's quotation line, where a
   * struck chip would be the one machine-made thing on it.
   */
  drawn?: boolean;
  /**
   * Which pen a drawn chip is inked in (maintainer, 2026-09-23).
   *
   * Brass is the game's "press this" colour, and a note is not a control. Iris is what an
   * information window is already ringed in, so a chip that opens one can be drawn in the same
   * ink and read as the label on that window rather than as the screen's main action.
   */
  ink?: 'brass' | 'iris';
}) {
  return (
    <HoverCard
      size="window"
      label={label}
      data-testid="info-note"
      // The page body is a stretching column, so a chip dropped straight into it would run the
      // whole width and read as the banner it replaced.
      className="self-start"
      card={
        /*
         * No eyebrow (maintainer, 2026-09-17: "remove the how it works text and keep only the How
         * the bar works one").
         *
         * It was "How it works" over "How the Bar works", which is the same sentence twice, once
         * in stamped capitals and once in the pen. An eyebrow earns its line when it says what
         * *kind* of thing the title names; over a title that is already a question about how
         * something works it only pushes the answer down.
         */
        <InfoWindow
          title={label}
          tone={tone === 'warn' ? 'oxblood' : 'iris'}
          plate="none"
          iconSize="sm"
          icon={
            // Sized here rather than left to the alcove: the mark is an `h-full w-full` drawing,
            // and `plate="none"` gives it a box with no definite width to be full of.
            <span
              className={cn('block h-9 w-9', tone === 'warn' ? 'text-brass-100' : 'text-iris-100')}
            >
              <DrawnInfo />
            </span>
          }
        >
          {/* The note in the same pen as the title above it, rather than in the body face: these
              windows sit on the paper screens now, and `font-stamp` is what that paper is written
              in. Ink rather than the near-white `ink-100`, for the same reason. */}
          <div className="font-stamp text-[15px] leading-[1.55] text-ink-200">{children}</div>
        </InfoWindow>
      }
    >
      <span
        className={cn(
          'flex items-center gap-1.5',
          drawn
            ? cn(
                'gap-2 px-3.5 py-1.5 font-stamp text-[13px] leading-none transition-colors',
                ink === 'iris'
                  ? 'ink-box-iris text-iris-100 hover:text-iris-300'
                  : 'ink-box text-brass-300 hover:text-brass-100',
              )
            : cn(
                'rounded-sm border',
                // `sm` is the height of the plaque chips a panel's head carries ("Always in"):
                // one line of 10px capitals with the head's own padding, so a note beside them
                // sits level.
                size === 'sm'
                  ? 'h-[1.3125rem] px-2 font-display text-[10px] font-bold uppercase leading-none tracking-[0.14em]'
                  : 'px-2.5 py-1 font-display text-[11px] font-bold uppercase tracking-[0.14em]',
                tone === 'warn'
                  ? 'border-brass-500/50 bg-brass-500/10 text-brass-100'
                  : 'border-iris-500/45 bg-iris-500/10 text-iris-100',
              ),
        )}
      >
        {/* Smaller than the struck glyph it replaces, because a drawn ring carries its own weight:
            at 14px the pen was heavier than the capitals beside it and the chip read as an icon
            with a caption. */}
        <span
          aria-hidden
          className={cn(
            'block shrink-0',
            drawn ? 'h-3.5 w-3.5' : size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3',
          )}
        >
          <DrawnInfo />
        </span>
        {label}
      </span>
    </HoverCard>
  );
}
