import {
  BLACK_MARKET_KIND_LABELS,
  GAME_TIMEZONE,
  findBlackMarketGood,
  type BlackMarketGoodSpec,
  type BlackMarketKind,
  type BlackMarketLot,
  type BlackMarketOffer,
} from '@frontline/shared';
import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { DrawnButton } from '../../components/ui/DrawnButton';
import { Icon } from '../../components/ui/Icon';
import { Modal } from '../../components/ui/Modal';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import { DrawnFace } from '../../components/ui/DrawnMarks';
import { useBlackMarket, useMe, usePlaceBlackMarketBid } from '../../lib/queries';
import { CityPicker } from '../city/CityPicker';
import { formatRemaining } from '../base/format';
import { PageShell, ScreenLoadSheet } from '../game/PageShell';
import { useServerClock } from '../missions/useServerClock';
import { LotBidPanel, LotClock, LotHistory, LotStanding, standingOf } from './LotParts';

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
 * ## Five lots, not five prices (maintainer, 2026-09-17)
 *
 * The shelf was always the whole city's, and buying off it never was: five crews after the same
 * crate raced a network round trip and the fastest connection won. Every slot is a lot now, exactly
 * as every line on the Runner's barrow is. Bids stand in the open all day in infamy, the fence
 * settles at midnight, and the crate goes to the highest bidder who can still pay. A crew may bid
 * on all five and win the one a day it has always been allowed.
 *
 * The bidding furniture is `LotParts`, which the barrow uses too, so the clock, the table and the
 * one control read the same on both counters and cannot drift apart. What this screen owns is the
 * room's two colours and the card.
 *
 * The screen leads with the constraint a player cannot work out from the cards: **how long this
 * shelf lasts**, which is also when every lot on it settles. The infamy chip went with the same
 * pass, at the maintainer's request: the standing bar across the top of every screen already
 * carries the figure, and a second copy of it in the corner of one room was the wrong thing to
 * lead with now that a card says what the lot is actually at.
 */

/** Which of the three rooms behind the strip a page is standing in. */
export type MarketTab = 'market' | 'offers' | 'black';

/**
 * The strip that makes the three rooms read as three tabs of one place.
 *
 * `action` is the far-right slot: a chip a page wants beside its own tabs rather than in the
 * sheet's header, which the market has no room for. A page that passes nothing gets nothing.
 */
export function MarketTabs({ active, action }: { active: MarketTab; action?: ReactNode }) {
  const tab = (to: string, label: string, mine: MarketTab, tip?: string) => {
    // The back-room tab keeps its own colours in *both* states, so the door is visible from the
    // shop rather than only once a player is through it.
    const black = mine === 'black';
    return (
      <NavLink
        to={to}
        end
        data-testid={`market-tab-${mine}`}
        // What the door is for, on the door (maintainer request, 2026-09-10): the line about the
        // arcade used to sit printed beside the tabs, and only where the strip had the width.
        data-tip={tip}
        className={cn(
          'group/tab relative px-4 py-2 font-display text-[12px] font-bold uppercase tracking-[0.16em] transition-all duration-150',
          'hover:-translate-y-px active:translate-y-px',
          active === mine
            ? black
              ? 'text-tangerine-100'
              : 'text-brass-100'
            : black
              ? 'text-tangerine-300/70 hover:text-tangerine-100'
              : 'text-ink-300 hover:text-brass-100',
        )}
      >
        {/*
         * Drawn, like the counters under it (maintainer, 2026-09-17). The back room keeps its own
         * ink in both states, which is the rule the colours above were already written to: the
         * door at the end of the arcade should be visible from the shop.
         */}
        <DrawnFace
          face={cn(
            'transition-all duration-150',
            active === mine
              ? black
                ? 'fill-tangerine-300/25 group-hover/tab:fill-tangerine-300/35'
                : 'fill-brass-500/30 group-hover/tab:fill-brass-500/40'
              : black
                ? 'fill-soot-900/80 group-hover/tab:fill-tangerine-300/15'
                : 'fill-surface-900/50 group-hover/tab:fill-brass-500/15',
          )}
        />
        <span className="relative">{label}</span>
      </NavLink>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="market-tabs">
      {tab('/game/market', 'The Market', 'market')}
      {tab(
        '/game/market/offers',
        'District Offers',
        'offers',
        'Districts trading with districts. What you put up leaves your store until somebody takes it or you take it back.',
      )}
      {tab(
        '/game/market/black',
        'Black Market',
        'black',
        'There is a door at the end of the arcade. It costs infamy, not caps.',
      )}
      {/* The crew screen's line, running on from the last tab (maintainer, 2026-09-21). */}
      <span aria-hidden className="ink-rule block min-w-0 flex-1" />
      {action !== undefined && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * Every kind, one palette.
 *
 * Everywhere else in the game a category badge picks a colour off the whole chrome ramp. Here they
 * are all tangerine and differ only in weight, because the room's whole read is that it has two
 * colours: a hue per kind would put the market's rainbow back on the wrong side of the door. The
 * glyph is what tells the kinds apart, which is what a glyph is for.
 */
const KIND_TONE: Record<BlackMarketKind, string> = {
  contraband: 'border-tangerine-700 text-tangerine-300/85',
  unit_upgrade: 'border-tangerine-500/70 text-tangerine-300',
  blueprint: 'border-tangerine-300/70 text-tangerine-100',
  battle_boost: 'border-tangerine-300 bg-tangerine-300/15 text-tangerine-100',
  // §F2: a single sheet, so the lightest weight on the shelf. It is the cheapest thing here and
  // the one a player is most often after.
  blueprint_page: 'border-tangerine-700/70 text-tangerine-300/85',
};

const KIND_ICON: Record<BlackMarketKind, 'crew' | 'units' | 'research' | 'sword'> = {
  contraband: 'crew',
  unit_upgrade: 'units',
  blueprint: 'research',
  battle_boost: 'sword',
  blueprint_page: 'research',
};

/**
 * One slot on the shelf, which is one lot.
 *
 * The card still leads with what the thing *is*, because that is the decision. Under it is the
 * figure the lot is actually at, wearing the reader's own standing on its edge so a glance across
 * five cards says which they are winning and losing, and one door whose word is that standing.
 */
function SlotCard({
  offer,
  spec,
  now,
  onBid,
}: {
  offer: BlackMarketOffer;
  spec: BlackMarketGoodSpec;
  now: Date;
  onBid: () => void;
}) {
  const { lot } = offer;
  const standing = lot === null ? 'out' : standingOf(lot);
  const figure = lot?.leading?.amount ?? offer.price;
  // Out of reach: the fence will not deal this rank, or the next legal number is past the ledger.
  // The door still opens, because the window is where the reason is said in words.
  const beyond = !offer.affordable && standing !== 'leading';

  return (
    <li
      className="rusted flex min-w-0 flex-col gap-2.5 rounded-sm border border-tangerine-700/70 bg-soot-900/90 p-4"
      data-testid={`black-slot-${offer.slot.index}`}
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
      <p className="font-body text-[13px] leading-snug text-ink-100">{offer.effect}</p>

      <span className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
        <span
          className={cn(
            'flex items-center gap-1.5 rounded-sm border px-2 py-1',
            standing === 'leading'
              ? 'border-verdigris-300/70'
              : standing === 'outbid'
                ? 'border-oxblood-300/70'
                : 'border-tangerine-700/70',
          )}
          data-tip={
            lot === null
              ? 'He is not taking offers on this'
              : beyond && offer.minNotoriety > 0
                ? `He keeps this for rank ${offer.minNotoriety} and better`
                : beyond
                  ? 'More than you have to say'
                  : lot.leading === null
                    ? 'Where the lot opens. Nobody has bid.'
                    : `${lot.bidders} ${lot.bidders === 1 ? 'crew is' : 'crews are'} in`
          }
          data-testid={`black-lot-tag-${offer.slot.index}`}
        >
          <Icon name="infamy" className="h-5 w-5 text-tangerine-300" />
          <span
            className={cn(
              'font-display text-[15px] font-bold tabular-nums',
              beyond ? 'text-oxblood-300' : 'text-tangerine-100',
            )}
          >
            {figure.toLocaleString()}
          </span>
        </span>
        {/* The one door, and its word is the reader's standing: Bid where nobody has, Raise where
            somebody is in front of them, and their own table where they are. */}
        <DrawnButton
          size="sm"
          disabled={lot === null}
          onClick={onBid}
          data-testid={`black-bid-${offer.slot.index}`}
        >
          {lot === null
            ? 'Gone'
            : standing === 'leading'
              ? 'Your table'
              : standing === 'outbid'
                ? 'Raise'
                : 'Bid'}
        </DrawnButton>
      </span>
      {/* The clock is on the panel's head, not on five cards: every lot here settles at the same
          midnight, so five copies of one countdown would be five things ticking in unison. The
          card carries it only in the last five minutes, when it is the thing to know. */}
      {lot !== null && Date.parse(lot.closesAt) - now.getTime() <= LAST_CALL_ON_A_CARD_MS && (
        <LotClock
          closesAt={lot.closesAt}
          now={now}
          words={LOT_WORDS}
          testId={`black-lot-clock-${offer.slot.index}`}
        />
      )}
    </li>
  );
}

/** How the fence's own close is worded, wherever a clock for it is drawn. */
const LOT_WORDS = ['Settles in', 'Settled'] as const;

/** When a card starts wearing its own clock: the last quarter of an hour before midnight. */
const LAST_CALL_ON_A_CARD_MS = 15 * 60 * 1000;

/**
 * Bidding on one of the fence's lots.
 *
 * The barrow's window in this room's two colours: what the crate is down the left, who is in front
 * and for how much, how long until he settles, the table, and one control. Everything on the right
 * is `LotParts`, so a player who has bid at the barrow already knows this screen.
 */
function BlackLotWindow({
  offer,
  spec,
  lot,
  infamy,
  now,
  cityId,
  onClose,
}: {
  offer: BlackMarketOffer;
  spec: BlackMarketGoodSpec;
  lot: BlackMarketLot;
  infamy: number;
  now: Date;
  /** Which back room the bid is placed in: a slot index is 0 to 4 in every city. */
  cityId: string;
  onClose: () => void;
}) {
  const me = useMe();
  const zone = me.data?.user.timezone ?? GAME_TIMEZONE;
  const bid = usePlaceBlackMarketBid();

  return (
    <Modal
      onClose={onClose}
      labelledBy="black-lot-title"
      size="wide"
      data-testid="black-lot-window"
      className="border-tangerine-500/40"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-tangerine-700/60 px-5 py-3">
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-tangerine-500/60 bg-tangerine-700/30 [&_svg]:h-5 [&_svg]:w-5"
        >
          <Icon name={KIND_ICON[spec.kind]} className="text-tangerine-100" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[10px] font-bold uppercase tracking-[0.2em] text-ink-300">
            Lot in the back room
          </span>
          <h2
            id="black-lot-title"
            className="min-w-0 break-words font-stamp text-[18px] leading-tight text-tangerine-100"
          >
            {spec.name}
          </h2>
        </span>
        <LotClock
          closesAt={lot.closesAt}
          now={now}
          size="lg"
          words={LOT_WORDS}
          testId="black-lot-clock"
        />
        <Button size="sm" variant="ghost" onClick={onClose}>
          Leave it
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="flex min-w-0 flex-col gap-3">
          <span
            className={cn(
              'self-start rounded-sm border px-1.5 py-0.5 font-display text-[10px] uppercase tracking-[0.14em]',
              KIND_TONE[spec.kind],
            )}
          >
            {BLACK_MARKET_KIND_LABELS[spec.kind]}
          </span>
          <p className="font-body text-[14px] italic leading-relaxed text-ink-200">
            {spec.description}
          </p>
          <p className="font-body text-[14px] leading-relaxed text-ink-100">{offer.effect}</p>
          {offer.minNotoriety > 0 && (
            <p className="font-body text-[12px] leading-relaxed text-tangerine-300">
              He keeps this for people with a name: rank {offer.minNotoriety} or better.
            </p>
          )}
          <p className="font-body text-[12px] leading-relaxed text-ink-300">
            It goes to the highest bid at midnight, at what they bid, and the infamy leaves your
            ledger then rather than now. Every crew's bid is in the open; raising yours replaces it.
            You may still only walk out with what your allowance lets you.
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <LotStanding
            auction={lot}
            currency="infamy"
            opens={`Opens at ${lot.reserve.toLocaleString()}. He will not take less.`}
          />
          <LotBidPanel
            auction={lot}
            name={spec.name}
            purse={infamy}
            currency="infamy"
            now={now}
            pending={bid.isPending}
            error={bid.error}
            shortMessage={(purse) =>
              `You have ${purse.toLocaleString()} infamy. He will want the whole figure at midnight.`
            }
            onPlace={(amount) =>
              bid.mutate({
                slotIndex: offer.slot.index,
                goodId: offer.slot.goodId,
                amount,
                city: cityId,
              })
            }
          />
          <LotHistory auction={lot} zone={zone} />
        </div>
      </div>
    </Modal>
  );
}

export function BlackMarketPage() {
  /*
   * Which city's back room, and it is a door now rather than a label (maintainer, 2026-09-17).
   *
   * Until `0099_black_market_cities` the shelf, the lot ids and the turnover counter were keyed by
   * the day and the slot alone, so this screen carried a read-only tag: a picker would have changed
   * the word over the crates without changing the crates. The lot ids carry a room prefix now and
   * the counter carries a column, so the three doors, barrow, Bar and fence, all work the same way.
   */
  const [city, setCity] = useState<string | null>(null);
  const query = useBlackMarket(city ?? undefined);
  const now = useServerClock(query.data?.serverNow, query.dataUpdatedAt);
  /** Which lot's bidding screen is open, if any. */
  const [lotOpen, setLotOpen] = useState<number | null>(null);

  const data = query.data;
  if (!data) {
    return (
      <ScreenLoadSheet
        what="The back room"
        loading="Knocking on the back door…"
        isError={query.isError}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const left = data.takesPerDay - data.takenToday;
  const refreshesIn = Date.parse(data.refreshesAt) - now.getTime();
  const open = data.offers.find((offer) => offer.slot.index === lotOpen);
  const openSpec = open ? findBlackMarketGood(open.slot.goodId) : undefined;

  return (
    <PageShell
      wide
      quote="Caps won't get you far in here."
      action={
        data === undefined ? undefined : (
          <CityPicker cityId={data.cityId} cities={data.cities} onChoose={setCity} />
        )
      }
    >
      <MarketTabs active="black" />

      {/* The clock is not a rule, so it does not go behind a hover: it is the one thing on this
          screen that is changing while the player looks at it, and it is when every lot on the
          shelf settles as well as when the shelf turns over. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-2 rounded-sm border border-brass-500/50 bg-brass-500/10 px-2.5 py-1 font-display text-[11px] font-bold uppercase tracking-[0.14em] text-brass-100">
          <Icon name="clock" aria-hidden className="h-3.5 w-3.5" />
          Settles in
          <span className="tabular-nums text-brass-300" data-testid="black-refresh">
            {formatRemaining(refreshesIn)}
          </span>
        </span>
      </div>

      {/* The bag used to sit beside the shelf here. Contraband is applied on the battle it is
          meant for now, so what a crew is carrying is listed under Boosts on that fight's own
          screen and the shelf has the width to itself. */}
      <div className="grid items-start gap-5">
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
              data-tip="Bid on as many as you like. This is how many you can walk out with tonight."
              data-testid="black-allowance"
            >
              {left > 0 ? `${left} to win tonight` : 'Come back tomorrow'}
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
                  offer={offer}
                  spec={spec}
                  now={now}
                  onBid={() => setLotOpen(offer.slot.index)}
                />
              );
            })}
          </ul>
        </Panel>
      </div>

      {open !== undefined && open.lot !== null && openSpec !== undefined && (
        <BlackLotWindow
          offer={open}
          spec={openSpec}
          lot={open.lot}
          infamy={data.infamy}
          now={now}
          // The room the shelf was read from, not the crew's own: a bid is placed where the reader
          // is standing.
          cityId={data.cityId}
          onClose={() => setLotOpen(null)}
        />
      )}
    </PageShell>
  );
}
