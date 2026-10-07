import {
  BARTER_MINIMUM,
  BARTER_RESOURCES,
  ITEM_CATALOG,
  ITEM_RARITY_LABELS,
  blueprintOfPage,
  RESOURCE_LABELS,
  barterQuote,
  brokerPayoutRate,
  effectiveMarketDiscount,
  supplyPrice,
  supplyUnitPrice,
  supplyRationUnits,
  marketDay,
  gameHourInZone,
  type ItemId,
  type MarketResponse,
  type ResourceKey,
  type SupplyLine,
  type VendorAuction,
  type VendorAuctionResult,
  type VendorOffer,
} from '@frontline/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { ResourceIcon } from '../../components/Resources';
import { Icon } from '../../components/ui/Icon';
import { NumberField } from '../../components/ui/NumberField';
import { ResourcePicker } from './ResourcePicker';
import { GoodChip, TradeArrow } from './TradeParts';
import { HoverCard } from '../../components/ui/HoverCard';
import { InfoWindow } from '../../components/ui/InfoWindow';
import { Panel } from '../../components/ui/Panel';
import { DrawnButton } from '../../components/ui/DrawnButton';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { cn } from '../../lib/cn';
import { isCityShut, useBarter, useBuySupply, useMarket } from '../../lib/queries';
import { RARITY_TAG } from '../../lib/rarity';
import { formatRemaining } from '../base/format';
import { useServerClock } from '../missions/useServerClock';
import { InfoNote, PageShell, ScreenLoadSheet } from '../game/PageShell';
import { MarketTabs } from './BlackMarketPage';
import { CityPicker } from '../city/CityPicker';
import { useCityRoom } from '../city/useCityRoom';
import { useDayResetClock, usePlayerZone } from '../settings/usePlayerZone';
import { ItemGlyph } from '../inventory/ItemGlyph';
import { VendorAuctionWindow, lotSpec } from './VendorAuctionWindow';
import { pastLotCap } from './LotParts';
import { PressError } from '../../components/ui/PressError';

/**
 * The market (market extension, reworked by the maintainer 2026-09-08).
 *
 * One screen, no scrolling: a street you stand in rather than a list you read down. Three
 * counters, each a different kind of thing:
 *
 * - **The Runner** is a *window* and an *auction*. He is in for two spells a day at hours that
 *   move, everything on the barrow is the same for the whole city, and every line is a lot: the
 *   highest bid when he packs up takes one. The panel leads with the lots and the clock.
 * - **The Broker** is a *rate*. Always open, always half, drawn as the trade it is: what leaves
 *   above, what arrives below, the rate on the arrow between them, everything on the centre line.
 * - **The supply run** is a *ration*. Caps into ordinary materials at a mildly bad price, bounded
 *   by the day, so it tops a crew up and can never feed one.
 *
 * The trading board between crews is its own page now (`OffersPage`), behind the second tab: a
 * board of other people's offers wants room to read, and this screen wants to fit in one frame.
 */
export function MarketPage() {
  /*
   * Which city's market this is (maintainer, 2026-09-17).
   *
   * Not in the URL: it is where a player is standing, and a bookmarked city they have since been
   * thrown out of would be a refusal on arrival. Not on this screen either, since 2026-09-24. It
   * was a `useState` that came back as the crew's own city every time the player looked at
   * anything else; it is the one remembered city now, shared with the map and the other rooms.
   */
  const { city, choose } = useCityRoom();
  const query = useMarket(city);
  const now = useServerClock(query.data?.serverNow, query.dataUpdatedAt);
  const zone = usePlayerZone();
  const resetsAt = useDayResetClock(now);
  /** Which lot's bidding screen is open, if any. */
  const [lotOpen, setLotOpen] = useState<string | null>(null);
  /*
   * Closed for good when its lot leaves the stock (bug pass, 2026-10-06). The Runner's visit ends
   * with an empty list, which unmounted the window but kept the id, and a line id is the same for
   * both of a day's visits: the window opened by itself hours later when he came back.
   * Before the early return below: a hook after it is how a page goes blank.
   */
  const stock = query.data?.vendor.stock;
  const lotGone =
    lotOpen !== null && stock !== undefined && !stock.some((offer) => offer.line.id === lotOpen);
  useEffect(() => {
    if (lotGone) setLotOpen(null);
  }, [lotGone]);

  const data = query.data;
  if (!data) {
    return (
      <ScreenLoadSheet
        what="The market"
        loading="Walking down to the market…"
        // A shut door is not a failed read: see `isCityShut`. The screen asks again for the
        // crew's own market on the next render rather than printing a refusal at them.
        isError={query.isError && !isCityShut(query.error)}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const lot = data.vendor.stock.find((offer) => offer.line.id === lotOpen);

  return (
    <PageShell
      quote="Nobody owns the market. Some people just think they do."
      wide
      fills
      // The city door on the heading's own line, top right, which is where the maintainer asked for
      // it: "in the market on the top right in the same height as the quote on top".
      action={<CityPicker cityId={data.cityId} cities={data.cities} onChoose={choose} />}
    >
      <MarketTabs active="market" />

      {/* The three counters in one frame. The Runner takes the room a screen has spare, the
          Broker runs the full height beside him, and the supply run sits under the barrow at the
          height it needs. Two columns at every width the game is drawn at: the frame does not
          scroll, so a stack would be a screen with its bottom counter cut off.

          The Runner's row has a floor of one row of lots. Without it a grid hands the supply run
          its whole height first and the barrow gets the strip that is left, which on a 720px
          screen is a strip. With it the run is what gives, and it scrolls inside its own panel
          on the screens that are too short for all three.

          The run's row is 10rem rather than `auto` (maintainer, 2026-09-17: half again the size
          it was). Measured at 106.5px on its content, which is a strip under a barrow six hundred
          pixels tall: a counter a player buys from every day should not be the smallest thing on
          the street. The Runner gives up the difference and still keeps its floor. */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] grid-rows-[minmax(12.75rem,1fr)_minmax(0,10rem)] gap-3">
        <VendorPanel market={data} now={now} zone={zone} onBid={setLotOpen} />
        <BrokerPanel market={data} />
        <SupplyPanel market={data} resetsAt={resetsAt} />
      </div>

      {lot !== undefined && lot.auction !== null && (
        <VendorAuctionWindow
          offer={{ ...lot, auction: lot.auction }}
          now={now}
          caps={data.caps}
          bidCeiling={data.bidCeiling}
          discountPercent={data.marketDiscountPercent}
          atLotCap={pastLotCap(
            data.vendor.stock.map((one) => ({ id: one.line.id, auction: one.auction })),
            lot.line.id,
          )}
          onClose={() => setLotOpen(null)}
        />
      )}
    </PageShell>
  );
}

/**
 * The Runner's hours, on the head of his own stall (maintainer request, 2026-09-09).
 *
 * A standing note rather than a chip that only tells the time, because the rule behind the clock
 * is the thing a player has to know: what he has is shared with the city, and every line is a lot.
 * The label carries the live clock so the note reads as a fact before it is opened.
 */
function RunnerHours({ market, now, zone }: { market: MarketResponse; now: Date; zone: string }) {
  const { vendor } = market;
  const closes = vendor.closesAt === null ? null : Date.parse(vendor.closesAt) - now.getTime();
  const opens = Date.parse(vendor.opensAt) - now.getTime();
  const label = vendor.open
    ? `The Runner: in, ${formatRemaining(Math.max(0, closes ?? 0))} left`
    : `The Runner: back in ${formatRemaining(Math.max(0, opens))}`;
  const hours = vendor.sessions
    .map((session) => gameHourInZone(marketDay(now), session.startHour, zone))
    .join(' and ');
  const raw = market.marketDiscountPercent;
  return (
    <InfoNote label={label} size="sm">
      In today at {hours}, two hours each. Every line is a lot: the highest bid when he packs up
      takes it. The Broker never leaves, and pays back part of the worth of what you hand over: the
      rate is on his counter.
      {/* The figure the till applies, not the sum of the cards (maintainer, 2026-10-01): the
          sources go through a curve, so each one counts for a little less than the last. */}
      {raw > 0 && (
        <span className="mt-2 block" data-testid="market-discount">
          Your market discount is {Math.round(effectiveMarketDiscount(raw))}%, off a lot you win,
          the supply run and the Broker&rsquo;s cut. Your sources add up to {raw}%, and each one
          counts for less the more you stack.
        </span>
      )}
    </InfoNote>
  );
}

/** Where the reader stands on a lot's open bids. */
function lotStanding(auction: VendorAuction): 'leading' | 'outbid' | 'out' {
  if (auction.leading?.yours === true) return 'leading';
  return auction.yourBid === null ? 'out' : 'outbid';
}

/**
 * One lot on the barrow: one of six plates the board is split into (maintainer request, 2026-09-10).
 *
 * The barrow used to be a strip of six thumbnails along the top of the stall with the rest of the
 * panel empty under them. It is a three by two board now and each lot is a plate that fills its
 * sixth: the drawing of the thing at a size it can be told apart at, the name, what it is (its
 * rarity, or the document a page came out of), the figure on a lit tag and one door. What the tag
 * says is the leading bid, or the price the lot opens at when nobody has said a number, and its
 * edge carries the reader's own standing so a glance across the board says which lots they are
 * winning and losing.
 */
function LotCard({ offer, onBid }: { offer: VendorOffer; onBid: () => void }) {
  const spec = lotSpec(offer.line.item);
  if (spec === undefined) {
    // An id the catalogue lacks. The plate says so rather than the barrow throwing on `spec.kind`.
    return (
      <li
        className="card-paper washed edge-lit relative flex min-h-0 min-w-0 flex-col items-center justify-center rounded-md border border-surface-600 p-2 opacity-60"
        data-testid={`vendor-line-${offer.line.id}`}
      >
        <span className="line-clamp-2 w-full min-w-0 break-all text-center font-display text-[11px] font-bold leading-[1.15] text-ink-100">
          {offer.line.item}
        </span>
      </li>
    );
  }
  const { auction } = offer;
  const gone = auction === null;
  const standing = auction === null ? 'out' : lotStanding(auction);
  // A page says which document it is a page of: that is the fact a collector is scanning for, and
  // the rarity is already in the plate's edge.
  const document = spec.kind === 'page' ? blueprintOfPage(spec.id) : undefined;

  return (
    <li
      className={cn(
        'card-paper washed edge-lit relative flex min-h-0 min-w-0 flex-col items-center justify-between gap-1 rounded-md border p-2',
        /*
         * Rarity, in the frame rather than in a word beside it.
         *
         * A shop is scanned, not read: what a player wants off a shelf is which of these is the
         * unusual one, and a coloured edge answers that before a label can be focused on. The
         * colours are the one table in `lib/rarity.tsx` now; the barrow used to keep its own copy
         * of them and had drifted a band off it.
         */
        RARITY_TAG[spec.rarity],
        // The glow stays on the top band. It is right on one lot in six and wrong on a column of
        // page rows, which is why it is here rather than in the shared table.
        spec.rarity === 'masterpiece' && 'shadow-brass',
        gone && 'opacity-50',
      )}
      data-testid={`vendor-line-${offer.line.id}`}
    >
      {/* The stock count in the corner, the way a shelf label sits on a shelf. Visits, not units:
          one goes per visit, so "2 left" is two more visits it can be bid on. */}
      <span className="absolute right-1 top-1 rounded-sm bg-surface-950/80 px-1 py-0.5 font-display text-[8px] font-bold uppercase tracking-[0.08em]">
        {gone ? 'gone' : `${offer.line.stock} left`}
      </span>

      {/* The plate has three sizes and the height the barrow is given picks one (the container
          query on the board below). Short of two rows the barrow is one row of six; with them, a
          three by two board and the drawing gets the room. The one row has two plates of its own:
          under 250px of stall it is the thumbnail it always was, and from 250px (frames about 860
          to 960 tall) it keeps the full plate's drawing and its second line, because a thumbnail
          on a 234px plate was a 32px drawing and a lot of empty paper (maintainer, 2026-09-29).
          The door keeps the one row's tight lettering in both, since the plate is as narrow, and
          the drawing drops clear of the stock tag, which a 56px drawing on a plate 89px wide
          otherwise runs under. All three are the same six lots in the same order. */}
      <HoverCard label={spec.name} size="window" card={<ItemWindow id={spec.id} />}>
        <span className="icon-tile flex h-14 w-14 items-center justify-center rounded-md [@container(max-height:249px)]:h-8 [@container(max-height:249px)]:w-8 [@container(min-height:250px)_and_(max-height:341px)]:mt-3">
          <ItemGlyph
            id={spec.id}
            size="md"
            className="h-11 w-11 [@container(max-height:249px)]:h-6 [@container(max-height:249px)]:w-6"
          />
        </span>
      </HoverCard>

      <span className="flex w-full min-w-0 flex-col items-center gap-0.5">
        {/* One line on the short board, where the six lots share a single row: a second line of
            name took its height out of the price tag, which is the one thing on the plate a
            bidder has to read (bug pass, 2026-09-29, "Sniper Blueprint: Barrel Liners" at
            1280x720). The whole name is on the hover card above. */}
        <span className="line-clamp-2 w-full min-w-0 text-center font-display text-[11px] font-bold leading-[1.15] text-ink-100 [@container(max-height:249px)]:line-clamp-1 [@container(max-height:249px)]:text-[10.5px] [@container(min-height:250px)_and_(max-height:341px)]:line-clamp-3">
          {spec.name}
        </span>
        <span className="line-clamp-1 w-full min-w-0 text-center font-display text-[9px] uppercase tracking-[0.14em] opacity-80 [@container(max-height:249px)]:hidden [@container(min-height:250px)_and_(max-height:341px)]:line-clamp-3">
          {document ? `Page of the ${document.name}` : ITEM_RARITY_LABELS[spec.rarity]}
        </span>
      </span>

      <span
        className={cn(
          'holo-tag flex shrink-0 items-center gap-1 rounded-sm px-2 py-0.5',
          standing === 'leading' && 'border-verdigris-300/70',
          standing === 'outbid' && 'border-oxblood-300/70',
        )}
        data-tip={
          gone
            ? 'The city cleared him out of these'
            : auction.leading === null
              ? 'Where the lot opens. Nobody has bid.'
              : `${auction.bidders} ${auction.bidders === 1 ? 'crew is' : 'crews are'} in`
        }
        data-testid={`lot-tag-${offer.line.id}`}
      >
        <ResourceIcon kind="caps" className="h-3.5 w-3.5" />
        <span className="font-display text-[13px] font-bold leading-none tabular-nums text-hextech-100">
          {(auction?.leading?.amount ?? offer.line.price).toLocaleString('en-US')}
        </span>
      </span>

      {/* The one door, and its word is the reader's standing: Bid where nobody has, Raise where
          somebody is in front of them, and their own table where they are. */}
      {/* Tighter lettering on the short board, whose plate is 78px inside at 1100 wide: at the
          `sm` tracking "Your table" broke onto two lines and pushed the tag off the plate. */}
      <DrawnButton
        size="sm"
        className="w-full whitespace-nowrap [@container(max-height:341px)]:px-1.5 [@container(max-height:341px)]:text-[10px] [@container(max-height:341px)]:tracking-[0.04em]"
        disabled={gone}
        onClick={onBid}
        data-testid={`bid-${offer.line.id}`}
      >
        {gone
          ? 'Gone'
          : standing === 'leading'
            ? 'Your table'
            : standing === 'outbid'
              ? 'Raise'
              : 'Bid'}
      </DrawnButton>
    </li>
  );
}

/** How the last visit ended for this crew, in a hover off the panel's head. */
function LastVisit({ results }: { results: readonly VendorAuctionResult[] }) {
  if (results.length === 0) return null;
  const won = results.filter((result) => result.outcome === 'won').length;
  return (
    <HoverCard
      label="Last visit"
      size="window"
      data-testid="vendor-results"
      card={
        <InfoWindow
          eyebrow="The barrow"
          title="Last visit"
          tone="brass"
          icon={<Icon name="market" className="h-full w-full text-brass-300" />}
        >
          <ul className="flex flex-col gap-1.5 font-body text-[13px] text-ink-100">
            {results.map((result) => (
              <li key={`${result.day}-${result.session}-${result.lineId}`}>
                <span className="font-display text-[11px] uppercase tracking-[0.12em] text-brass-300">
                  {result.outcome === 'won'
                    ? 'Yours'
                    : result.outcome === 'passed'
                      ? 'Passed'
                      : result.outcome === 'unsold'
                        ? 'Unsold'
                        : 'Lost'}
                </span>{' '}
                {ITEM_CATALOG[result.item as ItemId]?.name ?? result.item}
                {result.price !== null && (
                  <>
                    {' '}
                    at {result.price.toLocaleString('en-US')}
                    {result.outcome === 'lost' && result.winner !== null && ` to ${result.winner}`}
                  </>
                )}
                {result.outcome !== 'won' && ` (you bid ${result.yourBid.toLocaleString('en-US')})`}
              </li>
            ))}
          </ul>
        </InfoWindow>
      }
    >
      <span className="flex h-[1.3125rem] shrink-0 items-center rounded-sm border border-surface-600 px-2 font-display text-[10px] font-bold uppercase leading-none tracking-[0.14em] text-ink-300">
        Last visit: {won} of {results.length} won
      </span>
    </HoverCard>
  );
}

function VendorPanel({
  market,
  now,
  zone,
  onBid,
}: {
  market: MarketResponse;
  now: Date;
  zone: string;
  onBid: (lineId: string) => void;
}) {
  const { vendor } = market;
  return (
    <Panel
      tone="paper"
      title="The Runner"
      className="flex min-h-0 flex-col"
      // The hours and the last visit on the Runner's own head, right-aligned, at the head's
      // height (maintainer request, 2026-09-09): the clock belongs to the stall it is about.
      action={
        <span className="flex items-center gap-2">
          <LastVisit results={vendor.results} />
          <RunnerHours market={market} now={now} zone={zone} />
        </span>
      }
    >
      {/* The awning over the stall, the one panel on the screen that is a stall. Laid over the
          top of the barrow rather than given a row of its own: the frame does not scroll, so
          every pixel of height is a pixel off the lots. `!absolute` because the panel is painted. */}
      <div aria-hidden className="awning !absolute inset-x-0 top-[2.75rem] z-[2]" />
      {/* Nothing on the barrow until he is standing behind it: the server withholds the stock as
          well, so this is not a curtain over data the client was sent anyway. */}
      {/* Six lots on a board split in six. From 1100px wide the board fills the stall: three by
          two when the stall is tall enough for two rows of whole plates, one row of six when it
          is not, so nothing under the awning ever scrolls at the sizes the game is drawn at. Under
          1100px the six cannot share a line and the barrow is three to a row behind its own
          scroller, the one concession.

          Which of the two is measured off the stall itself, a container query, rather than off
          the window. The window's height was the rule (three by two from 860px tall), and it is not
          the stall's: at 1280x900 and 1440x900 a row was 133px against the 155 a full plate
          needs, and every door hung off the foot of its plate onto the plate below; at 1100x900
          it was 93 (bug pass, 2026-09-29). 342px is two 155px plates, the gap and the padding. */}
      {vendor.open ? (
        <div className="flex min-h-0 flex-1 flex-col [container-type:size]">
          <ul
            className={cn(
              'grid min-h-0 flex-1 auto-rows-min grid-cols-3 gap-2 overflow-y-auto p-3',
              '[@media(min-width:1100px)]:auto-rows-fr [@media(min-width:1100px)]:grid-rows-2 [@media(min-width:1100px)]:overflow-visible',
              '[@media(min-width:1100px)]:[@container(max-height:341px)]:grid-cols-6 [@media(min-width:1100px)]:[@container(max-height:341px)]:grid-rows-1',
            )}
            data-testid="vendor-stock"
          >
            {vendor.stock.map((offer) => (
              <LotCard key={offer.line.id} offer={offer} onBid={() => onBid(offer.line.id)} />
            ))}
          </ul>
        </div>
      ) : (
        <div
          className="edge-lit m-3 flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-md border border-surface-600/70 bg-surface-950/40 px-4 py-4"
          data-testid="vendor-shut"
        >
          <span className="text-ink-500 [&_svg]:h-8 [&_svg]:w-8">
            <Icon name="market" />
          </span>
          <p className="neon-rose font-display text-[12px] uppercase tracking-[0.2em]">
            The barrow is covered
          </p>
          <p className="font-body text-[13px] text-ink-300">
            Nobody sees what he has until he is here.
          </p>
        </div>
      )}
    </Panel>
  );
}

/**
 * The Broker: always in, always half.
 *
 * Drawn down the centre line (maintainer request): what leaves at the top, what arrives at the bottom,
 * and between them the number and the deal it makes. Every row is centred so the eye reads
 * straight down through the trade rather than across a form. The quote stays above the button,
 * which was always right: nobody should find out the rate afterwards.
 */
function BrokerPanel({ market }: { market: MarketResponse }) {
  const barter = useBarter();
  const [give, setGive] = useState<ResourceKey>('oil');
  const [want, setWant] = useState<ResourceKey>('scrap');
  const [amount, setAmount] = useState(100);

  const held = market.resources[give];
  // §I3: the rate is quoted by the server so the screen and the settlement cannot disagree about
  // which one applied. A client that recomputed the milestone would be a second opinion about it.
  // A trade into caps is held under the supply run's price, by the same function the till uses.
  const rate = brokerPayoutRate(
    want,
    market.barterRate,
    market.marketDiscountPercent,
    market.traderPoints ?? null,
    give,
  );
  const quote = barterQuote(give, want, amount, rate);
  // The shelf the server measures the trade against, which the supply board already carries per
  // material. Past it is a warning now rather than a wall (maintainer ruling, 2026-09-28): the line
  // under the button says so before the press, and the till asks again with its own figure.
  const room = market.supply.lines.find((line) => line.key === want)?.capacity;
  const spill =
    room === undefined ? 0 : Math.max(0, quote - Math.max(0, room - market.resources[want]));
  const blocked =
    give === want
      ? 'Pick two different things'
      : amount < BARTER_MINIMUM
        ? `He will not move for less than ${BARTER_MINIMUM}`
        : amount > held
          ? 'You do not have that much'
          : // The quote floors, and the server refuses a trade worth nothing back.
            quote === 0
            ? 'Too little to get anything back'
            : null;
  const warning =
    blocked === null && spill > 0
      ? `Your store is short of room: ${spill.toLocaleString('en-US')} ${RESOURCE_LABELS[want]} would go to waste`
      : null;

  return (
    <Panel
      tone="paper"
      title="The Broker"
      className="row-span-2 flex min-h-0 flex-col"
      action={
        <span className="neon-rose shrink-0 rounded-sm border border-tangerine-300/30 bg-surface-950/60 px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-[0.14em]">
          Always in
        </span>
      }
    >
      {/* Two ledgers and the deal between them (maintainer request, 2026-09-09). What leaves is a
          framed sheet in the giving colour, what arrives a framed sheet in the taking colour, and
          the rate sits on the band between them with the arrow pointing the way the goods go. The
          two sheets share whatever height the column has, so the counter is full at any size, and
          on a screen too short for both the column scrolls behind its own head. */}
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3 [@media(min-height:960px)]:gap-3 [@media(min-height:960px)]:p-4">
        <Ledger tone="give" title="You hand over" eyebrow="What leaves your store">
          <ResourcePicker
            label="What to give the Broker"
            value={give}
            onChange={setGive}
            held={market.resources}
            keys={BARTER_RESOURCES}
            size="sm"
            grow
            data-testid="broker-give"
          />
          {/* The number, and the three fractions a player reaches for instead of typing it. Only
              the fractions that clear his minimum are live. */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <NumberField
              label="how much to give the Broker"
              value={amount}
              onChange={setAmount}
              min={0}
              max={Math.max(BARTER_MINIMUM, held)}
              className="w-[7.5rem]"
              data-testid="broker-amount"
            />
            {(
              [
                ['¼', 0.25],
                ['½', 0.5],
                ['All', 1],
              ] as const
            ).map(([label, share]) => {
              const value = Math.floor(held * share);
              return (
                <DrawnButton
                  key={label}
                  // A chip that fills in a number has not spent anything: `confirm` is the sound of
                  // a press that banks or buys, and `DrawnButton` defaults to it for the doors.
                  data-sound="click"
                  disabled={value < BARTER_MINIMUM}
                  onClick={() => setAmount(value)}
                  data-tip={`${value.toLocaleString('en-US')} ${RESOURCE_LABELS[give].toLowerCase()}`}
                  className="h-[38px] min-w-[2.75rem] !text-[16px] !tracking-[0.04em]"
                >
                  {label}
                </DrawnButton>
              );
            })}
          </div>
        </Ledger>

        {/* The band between the sheets: the deal, drawn, with his rate on it. */}
        <div
          className="edge-lit flex shrink-0 items-center justify-center gap-4 rounded-md border border-brass-500/40 bg-surface-950/60 px-4 py-2"
          data-testid="barter-quote"
        >
          <GoodChip amount={amount} tone="give">
            <ResourceIcon kind={give} className="h-6 w-6" />
          </GoodChip>
          <span className="flex items-center gap-2">
            <TradeArrow className="h-7 w-7 rotate-90" />
            <span className="neon font-display text-[13px] font-bold uppercase tracking-[0.16em]">
              {Math.round(rate * 100)}% back
            </span>
            <TradeArrow className="h-7 w-7 rotate-90" />
          </span>
          <GoodChip amount={quote} tone="take">
            <ResourceIcon kind={want} className="h-6 w-6" />
          </GoodChip>
        </div>

        <Ledger tone="take" title="You walk away with" eyebrow="What he hands back">
          <ResourcePicker
            label="What to take from the Broker"
            value={want}
            onChange={setWant}
            held={market.resources}
            keys={BARTER_RESOURCES}
            disabled={(key) => key === give}
            size="sm"
            grow
            data-testid="broker-take"
          />
          {/* The answer, at a size worth reading: the figure and the thing, nothing else. */}
          <span className="flex items-baseline gap-2" data-testid="broker-answer">
            <span className="font-display text-[26px] font-bold leading-none tabular-nums text-verdigris-100">
              {quote.toLocaleString('en-US')}
            </span>
            <span className="font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
              {RESOURCE_LABELS[want]}
            </span>
          </span>
        </Ledger>

        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <DrawnButton
            className="w-full"
            disabled={blocked !== null || barter.isPending}
            onClick={() => barter.mutate({ give, want, amount })}
          >
            {barter.isPending ? 'Counting it out…' : 'Trade'}
          </DrawnButton>
          {(blocked ?? warning) !== null && (
            <span
              className="text-center font-display text-[12px] text-warning"
              data-testid="broker-note"
            >
              {blocked ?? warning}
            </span>
          )}
          {barter.error && <PressError onDismiss={barter.reset}>{barter.error.message}</PressError>}
        </div>
      </div>
    </Panel>
  );
}

/**
 * One side of the Broker's ledger: a framed sheet in the colour of the direction the goods move,
 * with its name lettered across the top and a line under it saying what the sheet is for.
 *
 * Both sheets share the column's height (`flex-1`) and centre what they hold, so the Broker's
 * counter is full at every size rather than two rows of tiles on a centre line with nothing
 * above or below them. `shrink-0`, because a sheet squeezed under its own content lets the
 * content run over the sheet below it: on a screen too short for both, the column scrolls.
 */
function Ledger({
  tone,
  title,
  eyebrow,
  children,
}: {
  tone: 'give' | 'take';
  title: string;
  eyebrow: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        'card-paper washed edge-lit flex flex-1 shrink-0 flex-col items-center justify-center gap-2.5 rounded-md border p-3 text-center [@media(min-height:960px)]:gap-3',
        tone === 'give' ? 'border-oxblood-500/45' : 'border-verdigris-300/45',
      )}
      data-testid={`ledger-${tone}`}
    >
      <span className="flex flex-col items-center gap-0.5">
        <span
          className={cn(
            'font-stamp text-[17px] leading-none',
            tone === 'give' ? 'text-oxblood-300' : 'text-verdigris-100',
          )}
        >
          {title}
        </span>
        <span className="font-display text-[10px] uppercase tracking-[0.18em] text-ink-400">
          {eyebrow}
        </span>
      </span>
      {children}
    </section>
  );
}

/**
 * Why the run cannot carry a single unit of this material, in the same order the server refuses.
 *
 * A zero here has three quite different cures: come back tomorrow, build a store, or go and earn.
 * "More than you can pay for or store" covered all three and pointed at none of them.
 */
function supplyStall(
  line: SupplyLine | undefined,
  market: MarketResponse,
  left: number,
  resetsAt: string,
): string {
  if (left === 0) return `Today's ration is spent, back at ${resetsAt}`;
  // Worth left, but not a whole unit of this one: a metal spends twelve of it.
  if (line !== undefined && supplyRationUnits(line.key, left) === 0) {
    return `Today's ration will not stretch to one more of these, back at ${resetsAt}`;
  }
  // This resource's own shelf, off the line, and not `supply.storageCapacity`, which is the bulk
  // one. Oil and supplies get two thirds of bulk and HQ metal a third (`STORAGE_SHARES`), so the
  // bulk comparison could never be true for four of the five materials on offer: a crew with a full
  // alloy shelf and fifty thousand caps was told it did not have the caps.
  if (line !== undefined && (market.resources[line.key] ?? 0) >= line.capacity) {
    return `Your store of ${RESOURCE_LABELS[line.key].toLowerCase()} is full`;
  }
  return 'Not enough caps for a single unit';
}

/**
 * The supply run: caps into materials, rationed by the day.
 *
 * The ration is the thing a player cannot work out for themselves, so it is on the panel's head
 * where the eye lands first, and the run itself is one line under it: pick, count, pay, left to
 * right. One picker and one quantity rather than five rows, because the allowance is pooled
 * across every material and five rows would suggest five budgets.
 */
/** The refusal as a button's word. The sentence itself is on the button's hover. */
function shortStall(reason: string): string {
  // Checked before "Today's ration is spent": some ration is left, just not a whole unit of this
  // one, and another material may still fit (bug pass, 2026-10-02).
  if (reason.startsWith("Today's ration will not stretch")) return 'Too dear today';
  if (reason.startsWith('Today')) return 'Ration spent';
  if (reason.startsWith('Your store')) return 'Store full';
  if (reason.startsWith('Say')) return 'Say how much';
  return 'No caps';
}

function SupplyPanel({ market, resetsAt }: { market: MarketResponse; resetsAt: string }) {
  const buy = useBuySupply();
  const { supply } = market;
  const [key, setKey] = useState<SupplyLine['key']>('scrap');
  const [wanted, setWanted] = useState(100);

  const line = supply.lines.find((entry) => entry.key === key);
  const left = Math.max(0, supply.allowance - supply.used);
  // The ration is caps' worth; the header says it in units of whatever the picker is on, the unit
  // the field beside it counts in (bug pass, 2026-10-01).
  const leftUnits = supplyRationUnits(key, left);
  const noun =
    key === 'highQualityMetal' ? RESOURCE_LABELS[key] : RESOURCE_LABELS[key].toLowerCase();
  const most = line?.most ?? 0;
  // The order is held at what the crew could actually take, rather than at whatever was last typed:
  // 100 is over the ration on a full warehouse, and a counter that opens refusing to serve you is
  // a bad first impression.
  const units = Math.min(wanted, most);
  // After the crew's market discount, the figure the till charges (maintainer, 2026-09-29).
  const price = supplyPrice(key, units, market.marketDiscountPercent, market.traderPoints ?? null);
  const blocked =
    most === 0 ? supplyStall(line, market, left, resetsAt) : units <= 0 ? 'Say how much' : null;

  return (
    <Panel
      tone="paper"
      title="The supply run"
      dense
      className="flex min-h-0 flex-col"
      action={
        <span className="flex min-w-0 items-center gap-2.5" data-testid="supply-allowance">
          <ProgressBar
            progress={supply.allowance === 0 ? 0 : supply.used / supply.allowance}
            label="Today's ration"
            tone={left === 0 ? 'oxblood' : 'verdigris'}
            size="sm"
            className="w-32"
          />
          <span
            className={cn(
              'shrink-0 font-display text-[11px] font-bold tabular-nums',
              leftUnits === 0 ? 'text-oxblood-300' : 'text-verdigris-100',
            )}
            data-testid="supply-left"
          >
            {leftUnits.toLocaleString('en-US')} {noun} left
          </span>
          <span className="shrink-0 font-display text-[10px] uppercase tracking-[0.14em] text-ink-300">
            {supply.percent}% of a store · resets at {resetsAt}
          </span>
        </span>
      }
    >
      {/* One line, three parts: what to buy, how much, and what it costs with the button on it.
          The parts are centred as a row, so the run reads as one sentence rather than a form, and
          every figure sits in a slot sized for six digits so the row is the same row whatever is
          typed; on a sheet narrower than 1440 the row wraps and each part stays whole.

          Everything in here is a size up from what it was (maintainer, 2026-09-17). The panel's
          row went to 160px and the run kept the furniture it had at 106.5px, so measured at
          1440x900 its contents were 50px inside a 120px body: seventy pixels of nothing, and a
          counter that read as a caption under the barrow rather than as the third counter on the
          street. The tiles are the picker's full size, the field and the quote are a few points
          up, and the two doors are `md` like the Broker's, which measures 114px in the same
          120px and leaves six for the wrap. */}
      <div className="flex min-h-0 flex-1 flex-wrap items-center justify-center gap-x-3 gap-y-2 overflow-y-auto px-3 py-2">
        <ResourcePicker
          label="What to buy with caps"
          value={key}
          onChange={setKey}
          held={market.resources}
          keys={supply.lines.map((entry) => entry.key)}
          caption={(each) => (
            <>
              <ResourceIcon kind="caps" className="h-3.5 w-3.5" />
              {/* The unit price itself, not one unit's till price: that rounds up, so a 2.25 read
                  as 3 beside a quote charging 225 for a hundred. */}
              {supplyUnitPrice(
                each,
                market.marketDiscountPercent,
                market.traderPoints ?? null,
              ).toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}
            </>
          )}
          data-testid="supply-resource"
        />
        <div className="flex items-center gap-2">
          {/* The field has no size of its own, so the two figures that make its height (the input's
              padding and its type) are lifted here rather than a `size` prop being invented for
              one caller. */}
          <NumberField
            label="how many units to buy"
            value={units}
            onChange={setWanted}
            min={0}
            max={Math.max(1, most)}
            className="w-[8.5rem] [&_input]:py-[7px] [&_input]:text-[16px]"
            data-testid="supply-units"
          />
          {/* Only when there is something to take. "All 0" on a full warehouse is a control
              that advertises its own uselessness. */}
          {most > 0 && (
            <span data-tip={`All ${most.toLocaleString('en-US')}`}>
              <DrawnButton data-sound="click" onClick={() => setWanted(most)}>
                All
              </DrawnButton>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* The price as one line: what goes out, what comes in. The chips the Broker's deal
              wears would make this part alone as wide as the picker. */}
          <span
            className="edge-lit flex items-center gap-1.5 rounded-md border border-brass-500/40 bg-surface-950/50 px-2.5 py-2 font-display text-[16px] font-bold tabular-nums"
            data-testid="supply-quote"
          >
            {/* Each figure in a slot seven characters wide (six digits and their comma), so the
                row is the same row at 1 and at 100,000: the digits fill more of their slot. */}
            <ResourceIcon kind="caps" className="h-6 w-6" />
            <span className="inline-block min-w-[7ch] text-center text-oxblood-300">
              {price.toLocaleString('en-US')}
            </span>
            <Icon name="chevron-down" aria-hidden className="h-4 w-4 -rotate-90 text-brass-300" />
            <ResourceIcon kind={key} className="h-6 w-6" />
            <span className="inline-block min-w-[7ch] text-center text-verdigris-100">
              {units.toLocaleString('en-US')}
            </span>
          </span>
          {/* The reason the run is refused is the button's own word, with the sentence on its
              hover: a line under the row is a line the frame does not have on a short screen. */}
          <span data-tip={blocked ?? undefined}>
            <DrawnButton
              disabled={blocked !== null || buy.isPending}
              onClick={() => buy.mutate({ key, units })}
              data-testid="supply-buy"
            >
              {buy.isPending ? 'Loading up…' : blocked === null ? 'Buy it' : shortStall(blocked)}
            </DrawnButton>
          </span>
        </div>
        {buy.error && <PressError onDismiss={buy.reset}>{buy.error.message}</PressError>}
      </div>
    </Panel>
  );
}

/** The whole item, as a window. Shared by the barrow, the inventory and the board. */
export function ItemWindow({ id }: { id: ItemId }) {
  const spec = ITEM_CATALOG[id];
  return (
    <InfoWindow
      eyebrow={ITEM_RARITY_LABELS[spec.rarity]}
      title={spec.name}
      tone={spec.kind === 'blueprint' ? 'iris' : 'verdigris'}
      icon={<ItemGlyph id={id} className="h-full w-full" />}
      figure={
        <span className="font-display text-lg font-bold tabular-nums text-warning">
          {spec.capsValue.toLocaleString('en-US')} caps
        </span>
      }
    >
      <p className="font-body text-[14px] italic leading-relaxed text-ink-200">
        {spec.description}
      </p>
      {/* No "what it is for" section. The line above says what the thing is and the figure says
          what it costs, which is what a shop listing is; the rest was an explanation of a mechanic
          under the price a player was reading. */}
    </InfoWindow>
  );
}
