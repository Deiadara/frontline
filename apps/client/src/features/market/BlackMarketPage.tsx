import {
  BLACK_MARKET_KIND_LABELS,
  findBlackMarketGood,
  formatClock,
  stashBoost,
  type BlackMarketGoodSpec,
  type BlackMarketKind,
  type BlackMarketResponse,
} from '@frontline/shared';
import { NavLink } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import { useBlackMarket, useTakeFromBlackMarket } from '../../lib/queries';
import { formatRemaining } from '../base/format';
import { InfoNote, PageShell } from '../game/PageShell';
import { useServerClock } from '../missions/useServerClock';
import { usePlayerZone } from '../settings/usePlayerZone';

/**
 * The Black Market, behind the door at the end of the arcade.
 *
 * A separate screen rather than a sixth panel on the market, because it is not the same shop and
 * the difference is the whole point: nothing here is priced in caps, nothing here is negotiable,
 * and the shelf is being looked at by everybody in the city at once. Walking through a door is the
 * cheapest way to say all three before a player reads a single line.
 *
 * ## Black and orange, and nothing else
 *
 * It used to be called the Back Room and painted in the same brass and iris as the shop it hangs
 * off, which undid the door: two tabs, one palette, one place. It is now the only screen in the
 * game built out of `soot` and `tangerine`: a colour pair that appears nowhere else, sits darker
 * than any other surface, and reads as a hazard placard rather than as a storefront. A player who
 * has been here once knows where they are before they have read a word.
 *
 * The screen leads with the two constraints, in this order: **what you can spend** and **how long
 * this shelf lasts**. Both are things a player cannot work out from the cards, and getting either
 * wrong wastes the purchase they get today.
 */

/** The strip that makes the two shops read as two tabs of one place. */
export function MarketTabs({ active }: { active: 'market' | 'black' }) {
  const tab = (to: string, label: string, mine: 'market' | 'black') => {
    // The back-room tab keeps its own colours in *both* states, so the door is visible from the
    // shop rather than only once a player is through it.
    const black = mine === 'black';
    return (
      <NavLink
        to={to}
        end
        data-testid={`market-tab-${mine}`}
        className={cn(
          'rounded-sm border px-4 py-2 font-display text-[12px] font-bold uppercase tracking-[0.16em] transition-colors',
          active === mine
            ? black
              ? 'border-tangerine-300/80 bg-tangerine-300/15 text-tangerine-100'
              : 'border-brass-300/80 bg-brass-300/15 text-brass-100'
            : black
              ? 'border-tangerine-700 bg-soot-900 text-tangerine-300/70 hover:border-tangerine-300/60 hover:text-tangerine-100'
              : 'border-surface-600 bg-surface-800/60 text-ink-300 hover:border-iris-300/60 hover:text-iris-100',
        )}
      >
        {label}
      </NavLink>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="market-tabs">
      {tab('/game/market', 'The Market', 'market')}
      {tab('/game/market/black', 'Black Market', 'black')}
      {active === 'market' && (
        <span className="font-display text-[11px] uppercase tracking-[0.14em] text-tangerine-300/80">
          There is a door at the end of the arcade. It costs infamy, not caps.
        </span>
      )}
    </div>
  );
}

/**
 * Four kinds, one palette.
 *
 * Everywhere else in the game a category badge picks a colour off the whole chrome ramp. Here they
 * are all tangerine and differ only in weight, because the room's whole read is that it has two
 * colours: four hues on a shelf would put the market's rainbow back on the wrong side of the door.
 * The glyph is what tells the kinds apart, which is what a glyph is for.
 */
const KIND_TONE: Record<BlackMarketKind, string> = {
  contraband: 'border-tangerine-700 text-tangerine-300/85',
  unit_upgrade: 'border-tangerine-500/70 text-tangerine-300',
  blueprint: 'border-tangerine-300/70 text-tangerine-100',
  battle_boost: 'border-tangerine-300 bg-tangerine-300/15 text-tangerine-100',
};

const KIND_ICON: Record<BlackMarketKind, 'crew' | 'units' | 'research' | 'sword'> = {
  contraband: 'crew',
  unit_upgrade: 'units',
  blueprint: 'research',
  battle_boost: 'sword',
};

/** One slot on the shelf. */
function SlotCard({
  spec,
  slotIndex,
  affordable,
  infamy,
  price,
  effect,
  pending,
  onTake,
}: {
  spec: BlackMarketGoodSpec;
  slotIndex: number;
  affordable: boolean;
  infamy: number;
  /** What it costs *here*: the catalogue price weighted by the city's average level (§D8). */
  price: number;
  /** And what it does here, with this city's figures already written into it. */
  effect: string;
  pending: boolean;
  onTake: () => void;
}) {
  const short = infamy < price;

  return (
    <li
      className="rusted flex min-w-0 flex-col gap-2.5 rounded-sm border border-tangerine-700/70 bg-soot-900/90 p-4"
      data-testid={`black-slot-${slotIndex}`}
    >
      <span className="flex items-start gap-3">
        {/* Not `icon-tile`: that plate is the palest surface in the game, and a lilac square is
            the one thing that would break this room's read. A struck-orange tile instead. */}
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border border-tangerine-500/60 bg-tangerine-700/30">
          <Icon name={KIND_ICON[spec.kind]} className="h-7 w-7 text-tangerine-100" />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'inline-block rounded-sm border px-1.5 py-0.5 font-display text-[10px] uppercase tracking-[0.14em]',
              KIND_TONE[spec.kind],
            )}
          >
            {BLACK_MARKET_KIND_LABELS[spec.kind]}
          </span>
          <span className="mt-1 block font-stamp text-[16px] leading-tight text-tangerine-100">
            {spec.name}
          </span>
        </span>
      </span>

      <p className="font-body text-[13px] italic leading-relaxed text-ink-300">
        {spec.description}
      </p>
      {/* The server's line, not the catalogue's: a shelf stocked for a veteran street hands out
          bigger numbers, and a card quoting the catalogue's would be the card lying. */}
      <p className="font-body text-[13px] leading-snug text-ink-100">{effect}</p>

      <span className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
        <span className="flex items-center gap-1.5">
          <Icon name="infamy" className="h-5 w-5 text-tangerine-300" />
          <span
            className={cn(
              'font-display text-[15px] font-bold tabular-nums',
              short ? 'text-oxblood-300' : 'text-tangerine-100',
            )}
          >
            {price.toLocaleString()}
          </span>
        </span>
        <Button size="sm" disabled={!affordable || pending} onClick={onTake}>
          Take it
        </Button>
      </span>
    </li>
  );
}

/** What the crew is carrying into its next fight. */
function StashPanel({ market }: { market: BlackMarketResponse }) {
  const held = Object.entries(market.stash).filter(([, count]) => count > 0);
  // Weighted by the same city average the shelf is priced against, so what the bag says it is
  // worth is what the fight will apply. Duplicates count once: see `stashBoost`.
  const total = stashBoost(market.stash, market.cityLevel);

  return (
    <Panel
      tone="tangerine"
      title="In the bag"
      action={
        <span className="font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
          Spent on the next fight
        </span>
      }
    >
      {held.length === 0 ? (
        <p className="p-4 font-body text-[13px] text-ink-300">
          Nothing yet. A boost sits here until the next battle and is gone after it.
        </p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-tangerine-700/40" data-testid="boost-stash">
            {held.map(([goodId, count]) => {
              const spec = findBlackMarketGood(goodId);
              if (!spec) return null;
              return (
                <li key={goodId} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1 truncate font-display text-[13px] font-bold text-ink-100">
                    {spec.name}
                  </span>
                  <span className="shrink-0 font-display text-[13px] tabular-nums text-tangerine-300">
                    ×{count}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="px-4 py-3 font-display text-[12px] uppercase tracking-[0.12em] text-ink-200">
            Together: {total.offensePercent >= 0 ? '+' : ''}
            {total.offensePercent}% offense · {total.defensePercent >= 0 ? '+' : ''}
            {total.defensePercent}% defence · {total.moralePercent >= 0 ? '+' : ''}
            {total.moralePercent}% morale
          </p>
        </>
      )}
    </Panel>
  );
}

export function BlackMarketPage() {
  const query = useBlackMarket();
  const take = useTakeFromBlackMarket();
  const zone = usePlayerZone();
  const now = useServerClock(query.data?.serverNow, query.dataUpdatedAt);

  const data = query.data;
  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="font-display text-xs uppercase tracking-[0.2em] text-ink-300">
          Knocking on the back door…
        </p>
      </div>
    );
  }

  const left = data.takesPerDay - data.takenToday;
  const refreshesIn = Date.parse(data.refreshesAt) - now.getTime();

  return (
    <PageShell
      title="The Black Market"
      icon="market"
      wide
      lede="Contraband, off-book refits, stolen plans and things to take into a fight. Priced in your name, not your caps."
      action={
        <span
          className="flex items-center gap-1.5 rounded-sm border border-tangerine-500/70 bg-tangerine-700/25 px-2.5 py-1.5"
          data-testid="black-infamy"
        >
          <Icon name="infamy" className="h-5 w-5 text-tangerine-300" />
          <span className="font-display text-[14px] font-bold tabular-nums text-tangerine-100">
            {data.infamy.toLocaleString()}
          </span>
        </span>
      }
    >
      <MarketTabs active="black" />

      {/* The clock is not a rule, so it does not go behind a hover: it is the one thing on this
          screen that is changing while the player looks at it, and the whole shelf turns over when
          it runs out. The rule beside it does go behind one. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-2 rounded-sm border border-brass-500/50 bg-brass-500/10 px-2.5 py-1 font-display text-[11px] font-bold uppercase tracking-[0.14em] text-brass-100">
          <Icon name="clock" aria-hidden className="h-3.5 w-3.5" />
          Turns over in
          <span className="tabular-nums text-brass-300" data-testid="black-refresh">
            {formatRemaining(refreshesIn)}
          </span>
        </span>
        <InfoNote tone="warn" label="How the shelf works">
          Five things sit on the shelf, the same five for everybody in the city, and{' '}
          <strong>you may take {data.takesPerDay} of them a day</strong>. Anything taken is replaced
          at once, so the shelf is never bare, and whatever you are looking at may be gone a minute
          from now. The whole shelf turns over once a day, at{' '}
          {formatClock(new Date(data.refreshesAt), zone)}.
        </InfoNote>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2.6fr)_minmax(0,1fr)]">
        <Panel
          tone="tangerine"
          title="On the shelf"
          action={
            <span
              className={cn(
                'shrink-0 rounded-sm border px-2 py-1 font-display text-[11px] font-bold uppercase tracking-[0.14em]',
                left > 0
                  ? 'border-tangerine-300/70 text-tangerine-100'
                  : 'border-tangerine-700 text-tangerine-300/60',
              )}
              data-testid="black-allowance"
            >
              {left > 0 ? `${left} left today` : 'Come back tomorrow'}
            </span>
          }
        >
          <ul
            className="grid gap-3 p-4 sm:grid-cols-2 2xl:grid-cols-3"
            data-testid="black-market-shelf"
          >
            {data.offers.map((offer) => {
              const spec = findBlackMarketGood(offer.slot.goodId);
              if (!spec) return null;
              return (
                <SlotCard
                  key={offer.slot.index}
                  spec={spec}
                  slotIndex={offer.slot.index}
                  affordable={offer.affordable}
                  infamy={data.infamy}
                  price={offer.price}
                  effect={offer.effect}
                  pending={take.isPending}
                  onTake={() =>
                    take.mutate({ slotIndex: offer.slot.index, goodId: offer.slot.goodId })
                  }
                />
              );
            })}
          </ul>
          {take.error !== null && (
            <p role="alert" className="px-4 pb-4 font-body text-[13px] text-oxblood-300">
              {take.error.message}
            </p>
          )}
        </Panel>

        <StashPanel market={data} />
      </div>
    </PageShell>
  );
}
