import {
  BARTER_MINIMUM,
  ITEM_CATALOG,
  ITEM_RARITY_LABELS,
  RESOURCE_LABELS,
  barterQuote,
  supplyPrice,
  marketDay,
  gameHourInZone,
  type ItemId,
  type ItemRarity,
  type MarketResponse,
  type ResourceKey,
  type SupplyLine,
  type VendorAuction,
  type VendorAuctionResult,
  type VendorOffer,
} from '@frontline/shared';
import { useState, type ReactNode } from 'react';
import { ResourceIcon } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { NumberField } from '../../components/ui/NumberField';
import { ResourcePicker } from './ResourcePicker';
import { GoodChip, TradeArrow } from './TradeParts';
import { HoverCard } from '../../components/ui/HoverCard';
import { InfoWindow } from '../../components/ui/InfoWindow';
import { Panel } from '../../components/ui/Panel';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { cn } from '../../lib/cn';
import { useBarter, useBuySupply, useMarket } from '../../lib/queries';
import { formatRemaining } from '../base/format';
import { useServerClock } from '../missions/useServerClock';
import { InfoNote, PageShell, ScreenLoadSheet } from '../game/PageShell';
import { MarketTabs } from './BlackMarketPage';
import { useDayResetClock, usePlayerZone } from '../settings/usePlayerZone';
import { ItemGlyph } from '../inventory/ItemGlyph';
import { VendorAuctionWindow } from './VendorAuctionWindow';

/**
 * The market (market extension, reworked by the board 2026-09-08).
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
  const query = useMarket();
  const now = useServerClock(query.data?.serverNow, query.dataUpdatedAt);
  const zone = usePlayerZone();
  const resetsAt = useDayResetClock(now);
  /** Which lot's bidding screen is open, if any. */
  const [lotOpen, setLotOpen] = useState<string | null>(null);

  const data = query.data;
  if (!data) {
    return (
      <ScreenLoadSheet
        what="The market"
        loading="Walking down to the market…"
        isError={query.isError}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const lot = data.vendor.stock.find((offer) => offer.line.id === lotOpen);

  return (
    <PageShell quote="Nobody owns the market. Some people just think they do." wide fills>
      <MarketTabs active="market" />

      {/* The three counters in one frame. The Runner takes the room a screen has spare, the
          Broker runs the full height beside him, and the supply run sits under the barrow at the
          height it needs. Two columns at every width the game is drawn at: the frame does not
          scroll, so a stack would be a screen with its bottom counter cut off.

          The Runner's row has a floor of one row of lots. Without it a grid hands the supply run
          its whole height first and the barrow gets the strip that is left, which on a 720px
          screen is a strip. With it the run is what gives, and it scrolls inside its own panel
          on the screens that are too short for all three. */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] grid-rows-[minmax(12.75rem,1fr)_minmax(0,auto)] gap-3">
        <VendorPanel market={data} now={now} zone={zone} onBid={setLotOpen} />
        <BrokerPanel market={data} />
        <SupplyPanel market={data} resetsAt={resetsAt} />
      </div>

      {lot !== undefined && lot.auction !== null && (
        <VendorAuctionWindow
          offer={{ ...lot, auction: lot.auction }}
          now={now}
          caps={data.caps}
          onClose={() => setLotOpen(null)}
        />
      )}
    </PageShell>
  );
}

/**
 * The Runner's hours, on the head of his own stall (board request, 2026-09-09).
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
  return (
    <InfoNote label={label}>
      Today he is in at {hours}, two hours each, and the hours move every day. What he has is the
      same for everybody in the city, and every line on the barrow is a lot: bid while he is in, and
      the highest bid takes one when he packs up, at what they bid. The Broker never leaves and
      never gives you more than half.
    </InfoNote>
  );
}

/**
 * Rarity, in the frame rather than in a word beside it.
 *
 * A shop is scanned, not read: what a player wants off a shelf is which of these is the unusual
 * one, and a coloured edge answers that before a label can be focused on. The word is still on the
 * hover window, where somebody who has already picked a thing up can read it.
 */
const RARITY_TONE: Record<ItemRarity, string> = {
  common: 'border-surface-600 text-ink-200',
  uncommon: 'border-verdigris-300/60 text-verdigris-100',
  rare: 'border-iris-300/60 text-iris-100',
  exotic: 'border-brass-300/70 text-brass-300 shadow-brass',
};

/** Where the reader stands on a lot's open bids. */
function lotStanding(auction: VendorAuction): 'leading' | 'outbid' | 'out' {
  if (auction.leading?.yours === true) return 'leading';
  return auction.yourBid === null ? 'out' : 'outbid';
}

/**
 * One lot on the barrow, as a card small enough that six of them make one row.
 *
 * The art, the name, the figure on a lit tag and one door. What the tag says is the leading bid,
 * or the price the lot opens at when nobody has said a number, and its edge carries the reader's
 * own standing so a glance across the row says which lots they are winning and losing.
 */
function LotCard({ offer, onBid }: { offer: VendorOffer; onBid: () => void }) {
  const spec = ITEM_CATALOG[offer.line.item as ItemId];
  const { auction } = offer;
  const gone = auction === null;
  const standing = auction === null ? 'out' : lotStanding(auction);

  return (
    <li
      className={cn(
        'card-paper washed edge-lit relative flex min-w-0 flex-col items-center gap-1 rounded-md border p-1.5',
        RARITY_TONE[spec.rarity],
        gone && 'opacity-50',
      )}
      data-testid={`vendor-line-${offer.line.id}`}
    >
      {/* The stock count in the corner, the way a shelf label sits on a shelf. Visits, not units:
          one goes per visit, so "2 left" is two more visits it can be bid on. */}
      <span className="absolute right-0.5 top-0.5 rounded-sm bg-surface-950/80 px-1 py-0.5 font-display text-[8px] font-bold uppercase tracking-[0.08em]">
        {gone ? 'gone' : `${offer.line.stock} left`}
      </span>

      <HoverCard label={spec.name} size="window" card={<ItemWindow id={spec.id} />}>
        <span className="icon-tile flex h-8 w-8 items-center justify-center rounded-md">
          <ItemGlyph id={spec.id} className="h-6 w-6" />
        </span>
      </HoverCard>

      {/* Two lines, because "Blueprint: Rotorcraft" is a name and a name cut in half is not one.
          Two lines is also the whole of the card's slack, which is why nothing else on it says a
          word: the standing is in the tag's edge and on the button. */}
      <span className="line-clamp-2 w-full min-w-0 text-center font-display text-[10.5px] font-bold leading-[1.15] text-ink-100">
        {spec.name}
      </span>

      <span
        className={cn(
          'holo-tag flex items-center gap-1 rounded-sm px-2 py-0.5',
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
          {(auction?.leading?.amount ?? offer.line.price).toLocaleString()}
        </span>
      </span>

      {/* The one door, and its word is the reader's standing: Bid where nobody has, Raise where
          somebody is in front of them, and their own table where they are. */}
      <Button
        size="sm"
        className="w-full !py-1"
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
      </Button>
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
                    at {result.price.toLocaleString()}
                    {result.outcome === 'lost' && result.winner !== null && ` to ${result.winner}`}
                  </>
                )}
                {result.outcome !== 'won' && ` (you bid ${result.yourBid.toLocaleString()})`}
              </li>
            ))}
          </ul>
        </InfoWindow>
      }
    >
      <span className="shrink-0 rounded-sm border border-surface-600 px-2 py-1 font-display text-[10px] font-bold uppercase tracking-[0.14em] text-ink-300">
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
      title="The Runner"
      className="flex min-h-0 flex-col"
      // The hours and the last visit on the Runner's own head, right-aligned, at the head's
      // height (board request, 2026-09-09): the clock belongs to the stall it is about.
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
      {vendor.open ? (
        <ul
          className="grid min-h-0 flex-1 auto-rows-min grid-cols-3 gap-2 overflow-y-auto p-3 [@media(min-width:1100px)]:grid-cols-6"
          data-testid="vendor-stock"
        >
          {vendor.stock.map((offer) => (
            <LotCard key={offer.line.id} offer={offer} onBid={() => onBid(offer.line.id)} />
          ))}
        </ul>
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

/** A labelled step of a counter's form: the same small-caps hand on every one of them. */
function Field({
  label,
  tone = 'ink',
  centred = false,
  children,
}: {
  label: ReactNode;
  tone?: 'ink' | 'give' | 'take';
  centred?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', centred && 'items-center text-center')}>
      <span
        className={cn(
          'font-display text-[11px] font-bold uppercase tracking-[0.16em]',
          tone === 'give'
            ? 'text-oxblood-300'
            : tone === 'take'
              ? 'text-verdigris-300'
              : 'text-ink-200',
        )}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * The Broker: always in, always half.
 *
 * Drawn down the centre line (board request): what leaves at the top, what arrives at the bottom,
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
  const quote = barterQuote(amount, market.barterRate);
  const blocked =
    give === want
      ? 'Pick two different things'
      : amount < BARTER_MINIMUM
        ? `He will not move for less than ${BARTER_MINIMUM}`
        : amount > held
          ? 'You do not have that much'
          : null;

  return (
    <Panel
      title="The Broker"
      className="row-span-2 flex min-h-0 flex-col"
      action={
        <span className="neon-rose shrink-0 rounded-sm border border-tangerine-300/30 bg-surface-950/60 px-2 py-1 font-display text-[11px] font-bold uppercase tracking-[0.14em]">
          Always in
        </span>
      }
    >
      {/* The rows spread over the column rather than huddling on its centre line: on a tall screen
          the tiles take their full size and the gaps grow with the room, so the Broker fills his
          counter. `m-auto` on the column is what keeps the first row reachable on a short screen,
          where the scroller is the one that gives. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 text-center">
        <div className="m-auto flex min-h-full flex-col items-center justify-around gap-1.5 [@media(min-height:800px)]:gap-3">
          <Field label="You hand over" tone="give" centred>
            <ResourcePicker
              label="What to give the Broker"
              value={give}
              onChange={setGive}
              held={market.resources}
              size="sm"
              data-testid="broker-give"
            />
          </Field>

          {/* The number, its quick fractions, and the deal it makes, on one centred line. A barter
            is a proportion of what you are sitting on rather than a number anybody has in mind,
            so the fractions sit against the field; only the ones that clear his minimum are live.
            The deal sits on the same line so the figure and what it buys are read together. */}
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
            <span className="flex items-center gap-1.5">
              <NumberField
                label="how much to give the Broker"
                value={amount}
                onChange={setAmount}
                min={0}
                max={Math.max(BARTER_MINIMUM, held)}
                className="w-28"
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
                  <button
                    key={label}
                    type="button"
                    disabled={value < BARTER_MINIMUM}
                    onClick={() => setAmount(value)}
                    data-tip={`${value.toLocaleString()} ${RESOURCE_LABELS[give].toLowerCase()}`}
                    className={cn(
                      'door-tile flex h-[38px] min-w-[2.75rem] items-center justify-center rounded-md border px-2',
                      'font-display text-[16px] font-bold leading-none tracking-[0.04em] transition-all duration-150',
                      value < BARTER_MINIMUM
                        ? 'cursor-not-allowed border-surface-600/60 text-ink-500'
                        : 'border-brass-500/60 text-brass-300 hover:-translate-y-0.5 hover:border-brass-300 hover:text-brass-100',
                    )}
                  >
                    <span className="relative z-[2]">{label}</span>
                  </button>
                );
              })}
            </span>

            {/* The deal, drawn: what goes in, the rate, what comes out. */}
            <div
              className="edge-lit flex w-fit items-center gap-2 rounded-md border border-brass-500/40 bg-surface-950/50 px-3 py-1.5"
              data-testid="barter-quote"
            >
              <GoodChip amount={amount} tone="give">
                <ResourceIcon kind={give} className="h-6 w-6" />
              </GoodChip>
              <span className="flex flex-col items-center gap-0.5">
                <TradeArrow className="h-6 w-6 rotate-90" />
                <span className="neon font-display text-[9px] font-bold uppercase tracking-[0.12em]">
                  {Math.round(market.barterRate * 100)}%
                </span>
              </span>
              <GoodChip amount={quote} tone="take">
                <ResourceIcon kind={want} className="h-6 w-6" />
              </GoodChip>
            </div>
          </div>

          <Field label="You walk away with" tone="take" centred>
            <ResourcePicker
              label="What to take from the Broker"
              value={want}
              onChange={setWant}
              held={market.resources}
              disabled={(key) => key === give}
              size="sm"
              data-testid="broker-take"
            />
          </Field>

          <div className="flex flex-col items-center gap-1.5">
            <Button
              disabled={blocked !== null || barter.isPending}
              onClick={() => barter.mutate({ give, want, amount })}
            >
              {barter.isPending ? 'Counting it out…' : 'Trade'}
            </Button>
            {blocked !== null && (
              <span className="font-display text-[12px] text-warning">{blocked}</span>
            )}
            {barter.error !== null && (
              <p role="alert" className="font-body text-[13px] text-oxblood-300">
                {barter.error.message}
              </p>
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
}

/**
 * Why the run cannot carry a single unit of this material, in the same order the server refuses.
 *
 * A zero here has three quite different cures: come back tomorrow, build a store, or go and earn.
 * "More than you can pay for or store" covered all three and pointed at none of them.
 */
function supplyStall(
  key: SupplyLine['key'],
  market: MarketResponse,
  left: number,
  resetsAt: string,
): string {
  if (left === 0) return `Today's ration is spent, back at ${resetsAt}`;
  if ((market.resources[key] ?? 0) >= market.supply.storageCapacity) {
    return `Your store of ${RESOURCE_LABELS[key].toLowerCase()} is full`;
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
  const most = line?.most ?? 0;
  // The order is held at what the crew could actually take, rather than at whatever was last typed:
  // 100 is over the ration on a full warehouse, and a counter that opens refusing to serve you is
  // a bad first impression.
  const units = Math.min(wanted, most);
  const price = supplyPrice(key, units);
  const blocked =
    most === 0 ? supplyStall(key, market, left, resetsAt) : units <= 0 ? 'Say how much' : null;

  return (
    <Panel
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
              left === 0 ? 'text-oxblood-300' : 'text-verdigris-100',
            )}
          >
            {left.toLocaleString()} left
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
          typed; on a sheet narrower than 1440 the row wraps and each part stays whole. */}
      <div className="flex min-h-0 flex-1 flex-wrap items-center justify-center gap-x-2.5 gap-y-2 overflow-y-auto px-3 py-2">
        <ResourcePicker
          label="What to buy with caps"
          value={key}
          onChange={setKey}
          held={market.resources}
          keys={supply.lines.map((entry) => entry.key)}
          size="sm"
          caption={(each) => (
            <>
              <ResourceIcon kind="caps" className="h-3 w-3" />
              {supplyPrice(each, 1).toLocaleString()}
            </>
          )}
          data-testid="supply-resource"
        />
        <div className="flex items-center gap-2">
          <NumberField
            label="how many units to buy"
            value={units}
            onChange={setWanted}
            min={0}
            max={Math.max(1, most)}
            className="w-[7.5rem]"
            data-testid="supply-units"
          />
          {/* Only when there is something to take. "All 0" on a full warehouse is a control
              that advertises its own uselessness. */}
          {most > 0 && (
            <span data-tip={`All ${most.toLocaleString()}`}>
              <Button size="sm" variant="ghost" onClick={() => setWanted(most)}>
                All
              </Button>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* The price as one line: what goes out, what comes in. The chips the Broker's deal
              wears would make this part alone as wide as the picker. */}
          <span
            className="edge-lit flex items-center gap-1 rounded-md border border-brass-500/40 bg-surface-950/50 px-2 py-1.5 font-display text-[13px] font-bold tabular-nums"
            data-testid="supply-quote"
          >
            {/* Each figure in a slot seven characters wide (six digits and their comma), so the
                row is the same row at 1 and at 100,000: the digits fill more of their slot. */}
            <ResourceIcon kind="caps" className="h-5 w-5" />
            <span className="inline-block min-w-[7ch] text-center text-oxblood-300">
              {price.toLocaleString()}
            </span>
            <Icon
              name="chevron-down"
              aria-hidden
              className="h-3.5 w-3.5 -rotate-90 text-brass-300"
            />
            <ResourceIcon kind={key} className="h-5 w-5" />
            <span className="inline-block min-w-[7ch] text-center text-verdigris-100">
              {units.toLocaleString()}
            </span>
          </span>
          {/* The reason the run is refused is the button's own word, with the sentence on its
              hover: a line under the row is a line the frame does not have on a short screen. */}
          <span data-tip={blocked ?? undefined}>
            <Button
              size="sm"
              disabled={blocked !== null || buy.isPending}
              onClick={() => buy.mutate({ key, units })}
              data-testid="supply-buy"
            >
              {buy.isPending ? 'Loading up…' : blocked === null ? 'Buy it' : shortStall(blocked)}
            </Button>
          </span>
        </div>
        {buy.error !== null && (
          <p role="alert" className="w-full text-center font-body text-[13px] text-oxblood-300">
            {buy.error.message}
          </p>
        )}
      </div>
    </Panel>
  );
}

/** The whole item, as a window. Shared by the barrow, the satchel and the board. */
export function ItemWindow({ id }: { id: ItemId }) {
  const spec = ITEM_CATALOG[id];
  return (
    <InfoWindow
      eyebrow={ITEM_RARITY_LABELS[spec.rarity]}
      title={spec.name}
      tone={spec.kind === 'blueprint' ? 'iris' : spec.kind === 'relic' ? 'brass' : 'verdigris'}
      icon={<ItemGlyph id={id} className="h-full w-full" />}
      figure={
        <span className="font-display text-lg font-bold tabular-nums text-warning">
          {spec.capsValue.toLocaleString()} caps
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
