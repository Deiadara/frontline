import {
  compactFigure,
  describeNotorietyGrant,
  nextNotorietyTier,
  notorietyTier,
  notorietyUpgradeCost,
  type EconomyState,
} from '@frontline/shared';
import { useId, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUpgradeNotoriety } from '../lib/queries';
import { cn } from '../lib/cn';
import type { DeltaMark } from '../lib/deltas';
import { DeltaFloat } from './ui/Delta';
import { DrawnButton } from './ui/DrawnButton';
import { DrawnDisc } from './ui/DrawnMarks';
import { HoverCard } from './ui/HoverCard';
import { Icon } from './ui/Icon';

/**
 * The two ladders the standing chips open, as declared under `/game` in `App.tsx`.
 *
 * Exported as the relative path the router wants rather than as the absolute one, because a child
 * route in react-router may not begin with a slash. The chips prefix `/game/` to navigate; the
 * route table spends them as they are, so there is one statement of where these screens live.
 */
export const LEVEL_LADDER_ROUTE = 'standing/level';
export const NOTORIETY_LADDER_ROUTE = 'standing/infamy';

/**
 * A meter with a pen round it rather than a rounded rectangle (maintainer, 2026-09-17).
 *
 * The hover cards were a framed console window with a flat bar in it, and the maintainer's note was
 * that the graphic sat *inside* its box instead of being drawn. So the track is a hand-inked
 * quadrilateral with the same `feTurbulence` and `feDisplacementMap` pair the feats board's marks
 * use, the earned part is a wash inside it, and the pen overshoots the bottom-left corner the way
 * `DrawnFace` does.
 *
 * `preserveAspectRatio="none"` lets one drawing serve a 12rem card bar and a full-width ladder row,
 * and `vectorEffect="non-scaling-stroke"` is what stops the stretch making the two short sides
 * three times heavier than the long ones. Both are `DrawnFace`'s reasoning and both apply here for
 * the same reason.
 *
 * The filter id carries a `useId` suffix: a ladder draws fourteen of these, and a hard-coded id
 * would have all of them pointing at whichever copy the browser saw first.
 */
export function DrawnMeter({
  percent,
  className,
  'data-testid': testId,
}: {
  /** How much of the track is earned, 0 to 100. Clamped, so a raid past a ceiling cannot overrun. */
  percent: number;
  className?: string;
  'data-testid'?: string;
}) {
  const id = useId();
  const filled = Math.max(0, Math.min(100, percent));

  return (
    <span className={cn('relative block h-3 w-full', className)} data-testid={testId}>
      <svg
        viewBox="0 0 120 12"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        <defs>
          <filter id={`meter-${id}`} x="-6%" y="-40%" width="112%" height="180%">
            <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="17" />
            <feDisplacementMap
              in="SourceGraphic"
              scale="1.1"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
        <g filter={`url(#meter-${id})`}>
          {/* The earned part, as a wash rather than a solid: the sheet under it is paper, and a
              flat block would read as a sticker laid on top of it. */}
          <rect
            x="2"
            y="2.5"
            width={(116 * filled) / 100}
            height="7.6"
            fill="currentColor"
            opacity="0.72"
          />
          <g
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          >
            <path
              d="M2 2.4 L118 1.9 L118.4 10.2 L1.6 10.7 Z"
              strokeWidth="1.5"
              opacity="0.9"
              vectorEffect="non-scaling-stroke"
            />
            {/* The overshoot: the pen carries on past the corner it closed at. */}
            <path
              d="M1.6 10.7 L5.2 9.2 L27 9.9"
              strokeWidth="1.1"
              opacity="0.45"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        </g>
      </svg>
    </span>
  );
}

/**
 * The ink each chip's ring and glyph are drawn in.
 *
 * A prop rather than a `className` from the caller, for `Panel`'s reason: `cn` is `clsx`, so it
 * concatenates without resolving Tailwind conflicts and two colours would both land with the
 * stylesheet's order picking the winner.
 */
const CARD_TONE = {
  hextech: 'text-hextech-100',
  oxblood: 'text-oxblood-300',
} as const;

type CardTone = keyof typeof CARD_TONE;

/**
 * What a standing chip says when you look at it: a sheet of paper, not a console window.
 *
 * `InfoWindow` is the right object for a resource, which is a thing with a picture of itself. A
 * level and a rank are neither, and the maintainer asked for these two in the hand the feats board
 * is drawn in. So the frame is the board's own material (`ink-frame card-paper washed grain`), the
 * icon is the same glyph as before but ringed by hand (`DrawnDisc`) instead of standing on a lit
 * tile, and the rule under the header is `.ink-rule` rather than a lit gradient.
 *
 * The icon stays exactly what it was: the maintainer's note was that the two glyphs are right and
 * everything round them is not.
 */
function DrawnCard({
  eyebrow,
  title,
  icon,
  tone,
  figure,
  footnote,
  children,
  'data-testid': testId,
}: {
  eyebrow: string;
  title: string;
  /** The chip's own glyph, unchanged. */
  icon: ReactNode;
  tone: CardTone;
  figure: ReactNode;
  /** The one line telling a player the chip is also a door. */
  /**
   * The italic line at the foot of the card.
   *
   * Optional since 2026-09-22: the two ladder cards dropped theirs at the maintainer's request.
   * "Click for the whole ladder" is a caption on a control that is already a button, printed
   * under a figure that is the reason to press it.
   */
  footnote?: string;
  children?: ReactNode;
  'data-testid'?: string;
}) {
  return (
    <div
      className="ink-frame card-paper washed grain relative w-[23rem] max-w-full rounded-sm px-3.5 pb-3.5 pt-3 shadow-panel"
      data-testid={testId}
    >
      <div className="flex items-start gap-3.5">
        <span
          className={cn(
            'relative flex h-[4.25rem] w-[4.25rem] shrink-0 items-center justify-center',
            CARD_TONE[tone],
          )}
        >
          <DrawnDisc />
          <span className="relative block h-9 w-9 [&_svg]:h-full [&_svg]:w-full">{icon}</span>
        </span>
        <span className="min-w-0 flex-1 pt-0.5">
          <span className="block font-display text-[10px] font-bold uppercase tracking-[0.2em] text-ink-400">
            {eyebrow}
          </span>
          {/* The hand face for the name, the stamped one for the category above it: a window's
              title is a thing and its eyebrow is a kind, and setting both in the pen loses the
              difference that makes the pair readable at a glance. */}
          <span className="mt-0.5 block font-stamp text-[19px] leading-[1.15] text-ink-100">
            {title}
          </span>
          <span className="mt-1.5 block">{figure}</span>
        </span>
      </div>

      <span aria-hidden className="ink-rule mb-2.5 mt-2 block" />

      {children}

      {/* The chip is a door now, and a door nobody knows about is a door nobody opens. Set small
          and quiet, because it is an instruction rather than a reading. */}
      {footnote !== undefined && (
        <p className="mt-2.5 font-body text-[11px] italic leading-snug text-ink-400">{footnote}</p>
      )}
    </div>
  );
}

/**
 * §I: the district's own level, and how far into the next one it is.
 *
 * The XP is the **district's**, not the crew's (maintainer, 2026-09-17). The chip called it a crew
 * level, which is the one reading of it that is wrong: a crew is the people, and this number is
 * what the place they work out of has grown into. Everything the level gates is a building, a
 * screen or a limit on the district, so the label follows the mechanic.
 *
 * This took district morale's place in the standing bar, and the swap is the point. Morale was a
 * meter that drifted on its own towards a number the player could not aim at, so a glance at it
 * told them nothing they could act on. A level is the opposite: it only ever goes up, everything
 * they do moves it, and what it unlocks is written down. Blue, because it is the one standing in
 * the bar that is *earned* rather than judged: the brass is what you own and the oxblood is what
 * the street thinks of you.
 *
 * The card is Hero Zero's arrangement and it is the right one: the level as the headline, the bar
 * under it, and the exact figures, `1,240 / 2,100`, spelled out rather than left as a proportion.
 * Pressing it opens the whole ladder, which is the only place the thresholds are written out.
 */
export function DistrictLevelChip({
  level,
  xpIntoLevel,
  xpToNextLevel,
  deltas,
}: {
  level: number;
  xpIntoLevel: number;
  xpToNextLevel: number;
  /**
   * What the district just learned, from `useDeltaMarks` over {@link xpBehind}.
   *
   * Opt-in the way the infamy chip's is: the standing bar and the base screen both draw this chip
   * and only one of them should announce the award. No trickle and no floor either, because
   * nothing pays XP passively: every point of it was a job somebody finished.
   */
  deltas?: readonly DeltaMark[];
}) {
  const navigate = useNavigate();
  const pct =
    xpToNextLevel > 0 ? Math.max(0, Math.min(100, (xpIntoLevel / xpToNextLevel) * 100)) : 0;

  return (
    <HoverCard
      data-testid="level-hover"
      label={`District level ${level}`}
      size="window"
      onActivate={() => void navigate(`/game/${LEVEL_LADDER_ROUTE}`)}
      card={
        <DrawnCard
          eyebrow="Your district"
          title={`Level ${level}`}
          tone="hextech"
          data-testid="level-card"
          icon={<Icon name="level" />}
          figure={
            <span className="flex items-baseline gap-2">
              <span className="font-display text-2xl font-bold tabular-nums text-hextech-100">
                {xpIntoLevel.toLocaleString()}
              </span>
              <span className="font-display text-base tabular-nums text-ink-300">
                / {xpToNextLevel.toLocaleString()} XP
              </span>
            </span>
          }
        >
          {/*
           * The meter and nothing else, which is the standing bar's own rule.
           *
           * The prose came out of every readout in this bar on purpose: what a player opens one of
           * these for is the number, and a paragraph about what a level is worth was being read
           * over the top of the figure they came for. What changed is that there is now somewhere
           * for that paragraph to live, which is the screen the footnote points at.
           */}
          <DrawnMeter percent={pct} className="text-hextech-100" data-testid="level-card-meter" />
        </DrawnCard>
      }
    >
      <div
        // `px-3` rather than `px-1.5`: the level was set hard against the chip's own edge, which
        // reads as a number that has run out of room rather than as one sitting on a plate.
        // `relative`, so the XP figure hangs from this chip's own box; portalled out of it, see
        // `DeltaFloat`.
        className="resource-chip relative flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1"
        data-testid="level-chip"
      >
        <DeltaFloat
          marks={deltas ?? []}
          data-testid="delta-xp"
          unit="XP"
          icon={
            <span className="block h-full w-full [&_svg]:h-full [&_svg]:w-full">
              <Icon name="level" />
            </span>
          }
        />
        <span
          aria-hidden
          className="resource-well flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-hextech-100 [&_svg]:h-8 [&_svg]:w-8"
        >
          <Icon name="level" />
        </span>
        <span className="flex flex-col gap-1.5">
          <span
            aria-hidden
            className="hidden font-display text-[11px] font-bold uppercase leading-none tracking-[0.14em] text-ink-200 [@media(min-width:1960px)]:block"
          >
            Level
          </span>
          <span className="hidden h-1.5 w-full rounded-sm bg-surface-700 [@media(min-width:1960px)]:block">
            <span className="block h-full rounded-sm bg-hextech-100" style={{ width: `${pct}%` }} />
          </span>
        </span>
        {/* Same rule as the infamy figure beside it: tabular, one size, room reserved. Two chips
            whose numbers are set at different widths read as two different instruments. */}
        <span className="w-[26px] shrink-0 truncate text-center font-display text-base font-bold leading-none tabular-nums text-hextech-100">
          {level}
        </span>
      </div>
    </HoverCard>
  );
}

/**
 * §D7: the wallet and the rank, side by side.
 *
 * Infamy is two things now and the chip has to show both, because they behave in opposite
 * directions: the points go up when you kill people and *down* when you spend them, and the rank
 * only ever goes up. A player who saw the points fall after buying a boost, with no rank beside
 * them, would reasonably conclude the game had taken their standing away.
 *
 * The bar under the word fills towards the price of the next rung rather than towards nothing,
 * which is what turns a running total into a goal. At the top of the ladder there is no next rung
 * and the bar is simply full.
 *
 * The card is interactive, so the button inside it is a real button. Pressing the **chip** opens
 * the ladder rather than buying anything: a purchase this expensive should not be one stray click
 * away, and the card is portalled out of the trigger, so a press on Upgrade Tier never reaches it.
 */
export function InfamyChip({
  infamy,
  notoriety,
  deltas,
}: {
  infamy: number;
  notoriety: number;
  /**
   * What the wallet just did, from `useDeltaMarks`. Opt-in for the reason `ResourceChip`'s is:
   * the standing bar and the base screen's readout both draw this chip, and only one of them
   * should announce a move.
   */
  deltas?: readonly DeltaMark[];
}) {
  const navigate = useNavigate();
  const tier = notorietyTier(notoriety);
  const next = nextNotorietyTier(notoriety);
  const cost = notorietyUpgradeCost(notoriety);
  const upgrade = useUpgradeNotoriety();
  const affordable = cost !== null && infamy >= cost;
  const pct = cost === null ? 100 : Math.max(0, Math.min(100, (infamy / cost) * 100));
  // What the next rung actually pays (§D7). Without it the card is a price and a button, and a
  // player is being asked for three hundred thousand infamy for a different word on a chip.
  const buys = describeNotorietyGrant(notoriety + 1);

  return (
    <HoverCard
      data-testid="infamy-hover"
      label={`Infamy: ${Math.round(infamy).toLocaleString()} points, and they call you ${tier}`}
      size="window"
      interactive
      onActivate={() => void navigate(`/game/${NOTORIETY_LADDER_ROUTE}`)}
      card={
        <DrawnCard
          eyebrow="They call you"
          title={tier}
          tone="oxblood"
          data-testid="infamy-card"
          icon={<Icon name="infamy" />}
          figure={
            <span className="flex items-baseline gap-2">
              {/* Grouped, like the price under it. The chip beside this one is allowed to say
                  `15.7K` because it is 58px wide; the card is where the exact figure lives, and
                  `40000` is not a figure anybody reads at a glance. */}
              <span className="font-display text-2xl font-bold tabular-nums text-oxblood-300">
                {Math.round(infamy).toLocaleString()}
              </span>
              <span className="font-display text-base text-ink-300">infamy</span>
            </span>
          }
        >
          {/* The rank blurb is gone with the rest of the standing-bar prose: what is left is the
              ladder itself, which is a price and a button rather than an explanation. */}
          <h4 className="font-display text-[10px] font-bold uppercase tracking-[0.2em] text-brass-300">
            {next === null ? 'The top of it' : 'Next up'}
          </h4>
          {next === null || cost === null ? (
            <p className="mt-1 font-body text-[13px] leading-snug text-ink-300">
              No rank above this one.
            </p>
          ) : (
            <div className="mt-1.5 flex flex-col gap-2" data-testid="notoriety-next">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-stamp text-[15px] leading-none text-brass-100">{next}</span>
                <span className="font-display text-[13px] tabular-nums text-ink-200">
                  {cost.toLocaleString()} infamy
                </span>
              </div>
              <DrawnMeter
                percent={pct}
                className="text-oxblood-300"
                data-testid="infamy-card-meter"
              />
              {/*
               * What the rank is for, in the channels' own words.
               *
               * A rank used to be a gate and nothing else, and the top eight rungs of the ladder
               * gated nothing at all: every unit tier is fieldable by `Marked`. They pay now
               * (`economy/renown.ts`), and the card is where a player is told so, because it is
               * where a rank is bought.
               */}
              {buys.length > 0 && (
                <ul
                  className="flex flex-wrap gap-1"
                  data-testid="notoriety-grant"
                  aria-label={`What ${next} pays`}
                >
                  {buys.map((line) => (
                    <li
                      key={line}
                      className="rounded-sm border border-brass-300/40 bg-brass-500/10 px-1.5 py-px font-display text-[11px] font-bold tracking-[0.04em] text-brass-100"
                    >
                      {line}
                    </li>
                  ))}
                </ul>
              )}
              {/* The shortfall as a figure, not a sentence about how to earn it. */}
              {!affordable && (
                <p className="font-display text-[12px] uppercase tracking-[0.14em] text-ink-300">
                  <span className="tabular-nums text-oxblood-300">
                    {Math.max(0, cost - Math.round(infamy)).toLocaleString()}
                  </span>{' '}
                  short
                </p>
              )}
              <DrawnButton
                size="sm"
                className="self-start"
                disabled={!affordable || upgrade.isPending}
                // The rung this chip is showing: the server refuses a press that names one the
                // row has already left, so a double click buys one rank and not two.
                onClick={() => upgrade.mutate({ fromNotoriety: notoriety })}
                data-testid="upgrade-tier"
              >
                Upgrade Tier
              </DrawnButton>
            </div>
          )}
        </DrawnCard>
      }
    >
      <div
        // Same room as the level beside it, and a little more between the points and the rank:
        // `Nobody` was touching the right edge of the plate.
        // `relative`, so the spend and gain figures hang from this chip's own box. Portalled out
        // of it: see `DeltaFloat`.
        className="resource-chip relative flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1"
        data-testid="infamy-chip"
      >
        <DeltaFloat
          marks={deltas ?? []}
          data-testid="delta-infamy"
          icon={
            <span className="block h-full w-full [&_svg]:h-full [&_svg]:w-full">
              <Icon name="infamy" />
            </span>
          }
        />
        <span
          aria-hidden
          className="resource-well flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-oxblood-300 [&_svg]:h-8 [&_svg]:w-8"
        >
          <Icon name="infamy" />
        </span>
        <span className="flex flex-col gap-1.5">
          <span
            aria-hidden
            className="hidden font-display text-[11px] font-bold uppercase leading-none tracking-[0.14em] text-ink-200 [@media(min-width:1960px)]:block"
          >
            Infamy
          </span>
          <span className="hidden h-1.5 w-full rounded-sm bg-surface-700 [@media(min-width:1960px)]:block">
            <span className="block h-full rounded-sm bg-oxblood-300" style={{ width: `${pct}%` }} />
          </span>
        </span>
        {/*
         * Fixed width, tabular figures, one size.
         *
         * The standing bar has to be a row of boxes that do not move. A figure that widened with
         * its own value pushed everything to its right along as infamy grew, and at seven digits
         * it shoved the identity plaque off the line entirely. `tabular-nums` makes every digit
         * the same width and `min-w` reserves the room for the largest realistic figure, so the
         * box is the same size at 0 and at 9,999,999.
         */}
        <span className="w-[58px] shrink-0 truncate text-center font-display text-base font-bold leading-none tabular-nums text-oxblood-300">
          {compactFigure(infamy)}
        </span>
        {/*
         * The rank, in a box that does not grow with the word in it.
         *
         * `Nobody` is six characters and `Back-Alley Rumored` is eighteen, and the plate used to
         * be as wide as whichever one you had earned: reaching a longer rank silently made the
         * whole standing bar wider and pushed the district plaque into the doors beside it. The
         * board hit exactly that and screenshotted it.
         *
         * A fixed width with the words allowed to wrap onto a second line. Two short lines inside
         * a plate that never moves is the right trade against a plate that moves: the bar is a
         * row of instruments, and an instrument that changes size when its reading changes is
         * the thing being fixed here.
         *
         * The width is measured against the longest *word* rather than the longest rank, because
         * a space or a hyphen is somewhere the line can break. `Back-Alley Rumored` is eighteen
         * characters and needs room for `Back-` (five); what actually sets the floor is
         * `Whispered` and `Nightmare` at nine, which nothing can break. That is the difference
         * between a 6.25rem plate and a 4.75rem one.
         *
         * Hidden below 1400px, which is the same width the two meter labels appear at and for the
         * same reason: the standing bar has to fit five resources, two doors and an identity on
         * one line, and a line that wraps costs fifty pixels of the world underneath it. The hover
         * card carries the rank at every width.
         */}
        <span
          className="hidden w-[4.75rem] shrink-0 border-l border-surface-600 pl-2 pr-0.5 text-balance text-center font-display text-[10px] font-bold uppercase leading-tight tracking-[0.06em] text-brass-300 [@media(min-width:1400px)]:block"
          data-testid="notoriety-tier"
        >
          {tier}
        </span>
      </div>
    </HoverCard>
  );
}

/** The standing block for the base screen: the level you have earned, and the name you have made. */
export function StandingReadout({
  economy,
  level,
  xpIntoLevel,
  xpToNextLevel,
}: {
  economy: EconomyState;
  level: number;
  xpIntoLevel: number;
  xpToNextLevel: number;
}) {
  return (
    <div className="flex flex-wrap gap-2 p-4">
      <DistrictLevelChip level={level} xpIntoLevel={xpIntoLevel} xpToNextLevel={xpToNextLevel} />
      <InfamyChip infamy={economy.infamy} notoriety={economy.notoriety} />
    </div>
  );
}
