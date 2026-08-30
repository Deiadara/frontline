import {
  notorietyTier,
  notorietyUpgradeCost,
  nextNotorietyTier,
  type EconomyState,
} from '@frontline/shared';
import { useUpgradeNotoriety } from '../lib/queries';
import { HoverCard } from './ui/HoverCard';
import { InfoWindow, WindowSection } from './ui/InfoWindow';
import { Icon } from './ui/Icon';
import { Button } from './ui/Button';

/**
 * §I: the allegiance's own level, and how far into the next one the crew is.
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
 */
export function CrewLevelChip({
  level,
  xpIntoLevel,
  xpToNextLevel,
}: {
  level: number;
  xpIntoLevel: number;
  xpToNextLevel: number;
}) {
  const pct =
    xpToNextLevel > 0 ? Math.max(0, Math.min(100, (xpIntoLevel / xpToNextLevel) * 100)) : 0;

  return (
    <HoverCard
      data-testid="level-hover"
      label={`Crew level ${level}`}
      size="window"
      card={
        <InfoWindow
          eyebrow="Your crew"
          title={`Level ${level}`}
          tone="hextech"
          icon={
            <span className="block h-full w-full text-hextech-100 [&_svg]:h-full [&_svg]:w-full">
              <Icon name="level" />
            </span>
          }
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
          <span className="block h-2 w-full overflow-hidden rounded-sm bg-surface-950/80">
            <span className="block h-full rounded-sm bg-hextech-100" style={{ width: `${pct}%` }} />
          </span>
        </InfoWindow>
      }
    >
      <div
        // `px-3` rather than `px-1.5`: the level was set hard against the chip's own edge, which
        // reads as a number that has run out of room rather than as one sitting on a plate.
        className="resource-chip flex shrink-0 items-center gap-2 rounded-lg px-3 py-1"
        data-testid="level-chip"
      >
        <span
          aria-hidden
          className="resource-well flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-hextech-100 [&_svg]:h-10 [&_svg]:w-10"
        >
          <Icon name="level" />
        </span>
        <span className="flex flex-col gap-1.5">
          <span
            aria-hidden
            className="hidden font-display text-[11px] font-bold uppercase leading-none tracking-[0.14em] text-ink-200 [@media(min-width:1700px)]:block"
          >
            Level
          </span>
          <span className="hidden h-1.5 w-full rounded-sm bg-surface-700 [@media(min-width:1700px)]:block">
            <span className="block h-full rounded-sm bg-hextech-100" style={{ width: `${pct}%` }} />
          </span>
        </span>
        <span className="font-display text-lg font-bold leading-none tabular-nums text-hextech-100">
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
 * The card is interactive, so the button inside it is a real button. The chip itself does nothing
 * on click: a purchase this expensive should not be one stray click away.
 */
export function InfamyChip({ infamy, notoriety }: { infamy: number; notoriety: number }) {
  const tier = notorietyTier(notoriety);
  const next = nextNotorietyTier(notoriety);
  const cost = notorietyUpgradeCost(notoriety);
  const upgrade = useUpgradeNotoriety();
  const affordable = cost !== null && infamy >= cost;
  const pct = cost === null ? 100 : Math.max(0, Math.min(100, (infamy / cost) * 100));

  return (
    <HoverCard
      data-testid="infamy-hover"
      label={`Infamy: ${Math.round(infamy)} points, and they call you ${tier}`}
      size="window"
      interactive
      card={
        <InfoWindow
          eyebrow="They call you"
          title={tier}
          tone="oxblood"
          plate="dark"
          icon={
            <span className="block h-full w-full text-oxblood-300 [&_svg]:h-full [&_svg]:w-full">
              <Icon name="infamy" />
            </span>
          }
          figure={
            <span className="flex items-baseline gap-2">
              <span className="font-display text-2xl font-bold tabular-nums text-oxblood-300">
                {Math.round(infamy)}
              </span>
              <span className="font-display text-base text-ink-300">infamy</span>
            </span>
          }
        >
          {/* The rank blurb is gone with the rest of the standing-bar prose: what is left is the
              ladder itself, which is a price and a button rather than an explanation. */}
          <WindowSection label={next === null ? 'The top of it' : 'Next up'}>
            {next === null || cost === null ? (
              <p className="font-body text-[13px] leading-snug text-ink-300">
                No rank above this one.
              </p>
            ) : (
              <div className="flex flex-col gap-2" data-testid="notoriety-next">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-display text-base font-bold tracking-[0.08em] text-brass-300">
                    {next}
                  </span>
                  <span className="font-display text-[13px] tabular-nums text-ink-200">
                    {cost.toLocaleString()} infamy
                  </span>
                </div>
                <span className="block h-2 w-full overflow-hidden rounded-sm bg-surface-950/80">
                  <span
                    className="block h-full rounded-sm bg-oxblood-300"
                    style={{ width: `${pct}%` }}
                  />
                </span>
                {/* The shortfall as a figure, not a sentence about how to earn it. */}
                {!affordable && (
                  <p className="font-display text-[12px] uppercase tracking-[0.14em] text-ink-300">
                    <span className="tabular-nums text-oxblood-300">
                      {Math.max(0, cost - Math.round(infamy)).toLocaleString()}
                    </span>{' '}
                    short
                  </p>
                )}
                <Button
                  size="sm"
                  disabled={!affordable || upgrade.isPending}
                  onClick={() => upgrade.mutate(undefined)}
                  data-testid="upgrade-tier"
                >
                  Upgrade Tier
                </Button>
              </div>
            )}
          </WindowSection>
        </InfoWindow>
      }
    >
      <div
        // Same room as the level beside it, and a little more between the points and the rank:
        // `Nobody` was touching the right edge of the plate.
        className="resource-chip flex shrink-0 items-center gap-2 rounded-lg px-3 py-1"
        data-testid="infamy-chip"
      >
        <span
          aria-hidden
          className="resource-well flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-oxblood-300 [&_svg]:h-10 [&_svg]:w-10"
        >
          <Icon name="infamy" />
        </span>
        <span className="flex flex-col gap-1.5">
          <span
            aria-hidden
            className="hidden font-display text-[11px] font-bold uppercase leading-none tracking-[0.14em] text-ink-200 [@media(min-width:1700px)]:block"
          >
            Infamy
          </span>
          <span className="hidden h-1.5 w-full rounded-sm bg-surface-700 [@media(min-width:1700px)]:block">
            <span className="block h-full rounded-sm bg-oxblood-300" style={{ width: `${pct}%` }} />
          </span>
        </span>
        <span className="font-display text-lg font-bold leading-none tabular-nums text-oxblood-300">
          {Math.round(infamy)}
        </span>
        {/* The rank, beside the points and visibly a different kind of thing: a word on a brass
            plate, not another number.

            Hidden below 1400px, which is the same width the two meter labels appear at and for the
            same reason: the standing bar has to fit five resources, two doors and an identity on
            one line, and a line that wraps costs fifty pixels of the world underneath it. The hover
            card carries the rank at every width, and it is the only place the ladder and its price
            are legible anyway. */}
        <span
          className="hidden shrink-0 border-l border-surface-600 pl-2.5 pr-1 font-display text-[12px] font-bold uppercase leading-none tracking-[0.1em] text-brass-300 [@media(min-width:1400px)]:block"
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
      <CrewLevelChip level={level} xpIntoLevel={xpIntoLevel} xpToNextLevel={xpToNextLevel} />
      <InfamyChip infamy={economy.infamy} notoriety={economy.notoriety} />
    </div>
  );
}
