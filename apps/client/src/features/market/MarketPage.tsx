import {
  BARTER_MINIMUM,
  ITEM_CATALOG,
  ITEM_RARITY_LABELS,
  RESOURCE_LABELS,
  RESOURCE_ORDER,
  barterQuote,
  supplyPrice,
  bundleValue,
  marketDay,
  utcHourInZone,
  heldItems,
  type ItemId,
  type ItemRarity,
  type MarketOffer,
  type MarketResponse,
  type ResourceKey,
  type SupplyLine,
  type VendorOffer,
} from '@frontline/shared';
import { useState, type ReactNode } from 'react';
import { ResourceIcon } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { Dropdown } from '../../components/ui/Dropdown';
import { Icon } from '../../components/ui/Icon';
import { NumberField } from '../../components/ui/NumberField';
import { ResourcePicker } from './ResourcePicker';
import { BundleChips, GoodChip, TradeArrow, ValueBadge } from './TradeParts';
import { HoverCard } from '../../components/ui/HoverCard';
import { InfoWindow } from '../../components/ui/InfoWindow';
import { Panel } from '../../components/ui/Panel';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { cn } from '../../lib/cn';
import {
  useAcceptOffer,
  useBarter,
  useBuyFromVendor,
  useBuySupply,
  useMarket,
  usePostOffer,
  useWithdrawOffer,
} from '../../lib/queries';
import { formatRemaining } from '../base/format';
import { useServerClock } from '../missions/useServerClock';
import { InfoNote, PageShell } from '../game/PageShell';
import { MarketTabs } from './BlackMarketPage';
import { usePlayerZone } from '../settings/usePlayerZone';
import { ItemGlyph } from '../inventory/ItemGlyph';

/**
 * The market (market extension).
 *
 * Three things that are not the same thing, so three panels rather than one list:
 *
 * - **The Runner** is a *window*. He is in for four hours a day at hours that move, everything on
 *   his barrow is shared with the whole city, and a blueprint you wanted is gone when somebody else
 *   takes it. The panel leads with when he is in, because that is the question.
 * - **The Broker** is a *rate*. Always open, always half. It is the floor under a shortage, and the
 *   quote is shown before the button so nobody finds out afterwards.
 * - **The supply run** is a *ration*. Caps into ordinary materials, always, at a price that is
 *   mildly bad, and bounded by the day, so it tops a crew up and can never feed one.
 * - **The board** is *people*. Somebody's listing, what it is worth against the vendor's own
 *   prices, and three things you can do about it: take it, counter it, or leave it.
 */
export function MarketPage() {
  const query = useMarket();
  const now = useServerClock(query.data?.serverNow, query.dataUpdatedAt);

  const data = query.data;
  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="font-display text-xs uppercase tracking-[0.2em] text-ink-300">
          Walking down to the market…
        </p>
      </div>
    );
  }

  return (
    <PageShell quote="Every price on this street is an argument about who needs it more." wide>
      <MarketTabs active="market" />

      <InfoNote label="The Runner's hours">
        The Runner is in for two short spells a day and the hours move. What he has is the same for
        everybody in the city, so a blueprint somebody else takes is gone. The Broker never leaves
        and never gives you more than half.
      </InfoNote>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <VendorPanel market={data} now={now} />
        <BrokerPanel market={data} />
      </div>

      <SupplyPanel market={data} />

      <BoardPanel market={data} now={now} />
    </PageShell>
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

/**
 * One thing on the barrow, as a card.
 *
 * A row of art, a name, a rarity tag, a price and a button is five columns of text with a picture
 * at one end. A card puts the art at the size it was drawn for, the price where a price goes, and
 * the rarity in the frame itself rather than in a word beside it, which is how every shop in the
 * genre does it and why they are readable at a glance.
 */
function VendorCard({
  offer,
  pending,
  onBuy,
}: {
  offer: VendorOffer;
  pending: boolean;
  onBuy: () => void;
}) {
  const spec = ITEM_CATALOG[offer.line.item as ItemId];
  const soldOut = offer.line.stock <= 0;

  return (
    <li
      className={cn(
        'card-paper washed edge-lit relative flex flex-col items-center gap-2 rounded-md border p-3',
        RARITY_TONE[spec.rarity],
        soldOut && 'opacity-50',
      )}
      data-testid={`vendor-line-${offer.line.id}`}
    >
      {/* The stock count in the corner, the way a shelf label sits on a shelf. */}
      <span className="absolute right-1.5 top-1.5 rounded-sm bg-surface-950/80 px-1.5 py-0.5 font-display text-[10px] font-bold uppercase tracking-[0.12em]">
        {soldOut ? 'gone' : `${offer.line.stock} left`}
      </span>

      <HoverCard label={spec.name} size="window" card={<ItemWindow id={spec.id} />}>
        <span className="icon-tile flex h-16 w-16 items-center justify-center rounded-md">
          <ItemGlyph id={spec.id} className="h-12 w-12" />
        </span>
      </HoverCard>

      <span className="min-w-0 text-center font-display text-[13px] font-bold leading-tight text-ink-100">
        {spec.name}
      </span>

      <span className="flex items-center gap-1.5">
        <ResourceIcon kind="caps" className="h-5 w-5" />
        <span className="font-display text-[15px] font-bold tabular-nums text-warning">
          {offer.line.price.toLocaleString()}
        </span>
      </span>

      <Button
        size="sm"
        className="w-full"
        disabled={soldOut || !offer.affordable || pending}
        onClick={onBuy}
      >
        {soldOut ? 'Sold out' : offer.affordable ? 'Buy' : 'Too dear'}
      </Button>
    </li>
  );
}

function VendorPanel({ market, now }: { market: MarketResponse; now: Date }) {
  const buy = useBuyFromVendor();
  const zone = usePlayerZone();
  const { vendor } = market;
  const closes = vendor.closesAt === null ? null : Date.parse(vendor.closesAt) - now.getTime();
  const opens = Date.parse(vendor.opensAt) - now.getTime();

  return (
    <Panel
      title="The Runner"
      action={
        <span
          className={cn(
            'shrink-0 rounded-sm border px-2 py-1 font-display text-[11px] font-bold uppercase tracking-[0.14em]',
            vendor.open ? 'border-bile-300/60 text-bile-300' : 'border-surface-600 text-ink-300',
          )}
          data-testid="vendor-state"
        >
          {vendor.open
            ? `In: ${formatRemaining(closes ?? 0)} left`
            : `Back in ${formatRemaining(opens)}`}
        </span>
      }
    >
      <p className="px-4 pt-3 font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
        Today he is in at{' '}
        {vendor.sessions
          .map((session) => utcHourInZone(marketDay(now), session.startHour, zone))
          .join(' and ')}
        , two hours each.
      </p>
      {/* Nothing on the barrow until he is standing behind it.
          
          The cards used to be drawn the whole time with their buttons dead, which showed a player
          exactly what to save for and made the opening hours a formality: the decision the shop is
          supposed to create is "be here when he is", and a shelf you can read all day removes it.
          The server withholds the stock as well, so this is not a curtain over data the client was
          sent anyway. */}
      {vendor.open ? (
        <ul
          className="grid gap-2.5 p-4 pt-3 sm:grid-cols-2 [@media(min-width:1500px)]:grid-cols-3"
          data-testid="vendor-stock"
        >
          {vendor.stock.map((offer) => (
            <VendorCard
              key={offer.line.id}
              offer={offer}
              pending={buy.isPending}
              onBuy={() => buy.mutate({ lineId: offer.line.id, count: 1 })}
            />
          ))}
        </ul>
      ) : (
        <div
          className="edge-lit m-4 mt-3 flex flex-col items-center gap-2 rounded-md border border-surface-600/70 bg-surface-950/40 px-4 py-8"
          data-testid="vendor-shut"
        >
          <span className="text-ink-500 [&_svg]:h-9 [&_svg]:w-9">
            <Icon name="market" />
          </span>
          <p className="font-display text-[12px] uppercase tracking-[0.16em] text-ink-300">
            The barrow is covered
          </p>
          <p className="font-body text-[13px] text-ink-300">
            Nobody sees what he has until he is here.
          </p>
        </div>
      )}
      {buy.error !== null && (
        <p role="alert" className="px-4 pb-3 font-body text-[13px] text-oxblood-300">
          {buy.error.message}
        </p>
      )}
    </Panel>
  );
}

/** A labelled step of a counter's form: the same small-caps hand on every one of them. */
function Field({
  label,
  tone = 'ink',
  children,
}: {
  label: string;
  tone?: 'ink' | 'give' | 'take';
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
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
 * Two picked materials and one number, and it used to be two dropdowns of six words with a bare
 * spinner between them. It is a *trade*, so it is drawn as one: what leaves on the left, what
 * arrives on the right, the rate stamped on the arrow between them, and the answer underneath at
 * a size worth reading. The quote stays above the button, which was always right: nobody should
 * find out the rate afterwards.
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
      action={
        <span className="shrink-0 rounded-sm border border-brass-500/40 px-2 py-1 font-display text-[11px] font-bold uppercase tracking-[0.14em] text-brass-300">
          Always in
        </span>
      }
    >
      <div className="flex flex-col gap-3.5 p-4">
        {/* What leaves. The tiles carry the stockpile, so "which of these do I have spare" is
            answered on the control itself rather than in a line under the button. */}
        <Field label="You hand over" tone="give">
          <ResourcePicker
            label="What to give the Broker"
            value={give}
            onChange={setGive}
            held={market.resources}
            data-testid="broker-give"
          />
        </Field>

        <div className="flex flex-wrap items-end gap-2">
          <Field label="How much">
            <NumberField
              label="how much to give the Broker"
              value={amount}
              onChange={setAmount}
              min={0}
              max={Math.max(BARTER_MINIMUM, held)}
              className="w-32"
              data-testid="broker-amount"
            />
          </Field>
          {/* Quick amounts, because a barter is a proportion of what you are sitting on rather
              than a number anybody has in mind. Only the ones that clear his minimum.

              Sized up from the ghost buttons they were: at 12px on a dark plate a `¼` is a smudge,
              and these are the controls a player reaches for far more often than the stepper
              beside them. Full-height against the field, a real plate under them, and the
              fractions at a size the glyph actually survives. */}
          <span className="flex gap-2">
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
                    'door-tile flex h-[38px] min-w-[3rem] items-center justify-center rounded-md border px-3',
                    'font-display text-[17px] font-bold leading-none tracking-[0.04em] transition-all duration-150',
                    value < BARTER_MINIMUM
                      ? 'cursor-not-allowed border-surface-600/60 text-ink-500'
                      : 'border-brass-500/60 text-brass-200 hover:-translate-y-0.5 hover:border-brass-300 hover:text-brass-100',
                  )}
                >
                  <span className="relative z-[2]">{label}</span>
                </button>
              );
            })}
          </span>
        </div>

        {/* The deal, drawn. */}
        <div
          className="edge-lit flex w-fit items-center gap-3 rounded-md border border-brass-500/40 bg-surface-950/50 px-4 py-3"
          data-testid="barter-quote"
        >
          <GoodChip amount={amount} tone="give">
            <ResourceIcon kind={give} className="h-6 w-6" />
          </GoodChip>
          <span className="flex flex-col items-center gap-0.5">
            <TradeArrow />
            <span className="font-display text-[10px] font-bold uppercase tracking-[0.12em] text-ink-300">
              {Math.round(market.barterRate * 100)}%
            </span>
          </span>
          <GoodChip amount={quote} tone="take">
            <ResourceIcon kind={want} className="h-6 w-6" />
          </GoodChip>
        </div>

        <Field label="You walk away with" tone="take">
          <ResourcePicker
            label="What to take from the Broker"
            value={want}
            onChange={setWant}
            held={market.resources}
            disabled={(key) => key === give}
            data-testid="broker-take"
          />
        </Field>

        <div className="flex items-center gap-3">
          <Button
            size="sm"
            disabled={blocked !== null || barter.isPending}
            onClick={() => barter.mutate({ give, want, amount })}
          >
            {barter.isPending ? 'Counting it out…' : 'Trade'}
          </Button>
          {blocked !== null && (
            <span className="font-display text-[12px] text-warning">{blocked}</span>
          )}
        </div>
        {barter.error !== null && (
          <p role="alert" className="font-body text-[13px] text-oxblood-300">
            {barter.error.message}
          </p>
        )}
      </div>
    </Panel>
  );
}

/**
 * The supply run: caps into materials, rationed by the day.
 *
 * The screen leads with the **ration**, not with the prices, because the ration is the thing a
 * player cannot work out for themselves and the thing that decides whether this screen is worth
 * opening today. The prices are fixed and mildly bad; the budget is what moves.
 *
 * One picker and one quantity, rather than five rows with five buttons. The allowance is pooled
 * across every material, so a five-row form would suggest five separate budgets, which is exactly
 * the wrong model of the thing.
 */
/**
 * Why the run cannot carry a single unit of this material, in the same order the server refuses.
 *
 * A zero here has three quite different cures: come back tomorrow, build a store, or go and earn.
 * "More than you can pay for or store" covered all three and pointed at none of them.
 */
function supplyStall(key: SupplyLine['key'], market: MarketResponse, left: number): string {
  if (left === 0) return "Today's ration is spent, back at midnight";
  if ((market.resources[key] ?? 0) >= market.supply.storageCapacity) {
    return `Your store of ${RESOURCE_LABELS[key].toLowerCase()} is full`;
  }
  return 'Not enough caps for a single unit';
}

function SupplyPanel({ market }: { market: MarketResponse }) {
  const buy = useBuySupply();
  const { supply } = market;
  const [key, setKey] = useState<SupplyLine['key']>('scrap');
  const [wanted, setWanted] = useState(100);

  const line = supply.lines.find((entry) => entry.key === key);
  const left = Math.max(0, supply.allowance - supply.used);
  const most = line?.most ?? 0;
  // The order is held at what the crew could actually take, rather than at whatever was last typed.
  // The screen used to open on 100 with the button dead and a complaint under it, because 100 is
  // over the ration on a full warehouse: a first impression of a counter that refuses to serve you.
  const units = Math.min(wanted, most);
  const price = supplyPrice(key, units);
  const blocked = most === 0 ? supplyStall(key, market, left) : units <= 0 ? 'Say how much' : null;

  return (
    <Panel
      title="The supply run"
      action={
        <span className="shrink-0 font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
          {supply.percent}% of a full store · resets at midnight
        </span>
      }
    >
      <div className="flex flex-col gap-3.5 p-4">
        <ProgressBar
          progress={supply.allowance === 0 ? 0 : supply.used / supply.allowance}
          label="Today's ration"
          remaining={`${left.toLocaleString()} left`}
          tone={left === 0 ? 'oxblood' : 'verdigris'}
          size="md"
          data-testid="supply-allowance"
        />

        {/* Pick, count, pay: the three steps of the run laid left to right, so the panel's width is
            the order of the transaction rather than empty tin beside a narrow form. */}
        <div className="grid justify-start gap-x-6 gap-y-4 [@media(min-width:1100px)]:grid-cols-[auto_auto_auto]">
          <Field label="What to load up on">
            <ResourcePicker
              label="What to buy with caps"
              value={key}
              onChange={setKey}
              held={market.resources}
              keys={supply.lines.map((entry) => entry.key)}
              caption={(each) => (
                <>
                  <ResourceIcon kind="caps" className="h-3 w-3" />
                  {supplyPrice(each, 1).toLocaleString()}
                </>
              )}
              data-testid="supply-resource"
            />
          </Field>

          <Field label="How many">
            <div className="flex items-center gap-2">
              <NumberField
                label="how many units to buy"
                value={units}
                onChange={setWanted}
                min={0}
                max={Math.max(1, most)}
                className="w-32"
                data-testid="supply-units"
              />
              {/* Only when there is something to take. "All 0" on a full warehouse is a control
                  that advertises its own uselessness. */}
              {most > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setWanted(most)}>
                  All {most.toLocaleString()}
                </Button>
              )}
            </div>
          </Field>

          <Field label="What it costs">
            <div className="flex flex-wrap items-center gap-3">
              {/* The price drawn the way the Broker draws his rate, so both counters quote in the
                  same hand. */}
              <div
                className="edge-lit flex w-fit items-center gap-3 rounded-md border border-brass-500/40 bg-surface-950/50 px-3 py-2"
                data-testid="supply-quote"
              >
                <GoodChip amount={price} tone="give">
                  <ResourceIcon kind="caps" className="h-6 w-6" />
                </GoodChip>
                <TradeArrow />
                <GoodChip amount={units} tone="take">
                  <ResourceIcon kind={key} className="h-6 w-6" />
                </GoodChip>
              </div>
              <Button
                size="sm"
                disabled={blocked !== null || buy.isPending}
                onClick={() => buy.mutate({ key, units })}
              >
                {buy.isPending ? 'Loading up…' : 'Buy it'}
              </Button>
            </div>
          </Field>
        </div>

        {blocked !== null && <p className="font-display text-[12px] text-ink-300">{blocked}</p>}
        {buy.error !== null && (
          <p role="alert" className="font-body text-[13px] text-oxblood-300">
            {buy.error.message}
          </p>
        )}
      </div>
    </Panel>
  );
}

/**
 * One listing on the board, as the trade it is.
 *
 * This was a sentence: `Gives 200 scrap for 100 oil · worth 400 against 300 · stands 12h`. Every
 * question a player brings to a board is "what for what, and is that fair", and a sentence makes
 * them parse the answer. Two rows of chips with an arrow between them answers the first before the
 * eye has finished moving, and the verdict badge answers the second without printing arithmetic.
 * The figures are still on the badge's hover for anybody haggling.
 */
function OfferRow({
  offer,
  mine,
  now,
  onAccept,
  onCounter,
  onWithdraw,
  pending,
}: {
  offer: MarketOffer;
  mine: boolean;
  now: Date;
  onAccept: () => void;
  onCounter: () => void;
  onWithdraw: () => void;
  pending: boolean;
}) {
  const standsFor = Date.parse(offer.createdAt) + 48 * 3_600_000 - now.getTime();

  return (
    <li
      className="flex flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-3"
      data-testid={`offer-${offer.id}`}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-display text-[11px] uppercase tracking-[0.14em] text-brass-300">
            {offer.counterTo !== null ? 'Counter from' : 'Offered by'} {offer.sellerName}
          </span>
          <ValueBadge received={offer.give} paid={offer.want} />
          <span
            className="font-display text-[10px] uppercase tracking-[0.12em] text-ink-300"
            data-tip="How long this listing stands before it lapses"
          >
            {formatRemaining(Math.max(0, standsFor))}
          </span>
        </span>

        <span className="flex flex-wrap items-center gap-2.5">
          <BundleChips bundle={offer.give} tone="take" empty="nothing" />
          <TradeArrow className="h-6 w-6" />
          <BundleChips bundle={offer.want} tone="give" empty="nothing" />
        </span>
      </span>

      {mine ? (
        <Button size="sm" variant="ghost" disabled={pending} onClick={onWithdraw}>
          Withdraw
        </Button>
      ) : (
        <span className="flex shrink-0 gap-2">
          <Button size="sm" variant="ghost" disabled={pending} onClick={onCounter}>
            Counter
          </Button>
          <Button size="sm" disabled={pending} onClick={onAccept}>
            Accept
          </Button>
        </span>
      )}
    </li>
  );
}

function BoardPanel({ market, now }: { market: MarketResponse; now: Date }) {
  const accept = useAcceptOffer();
  const withdraw = useWithdrawOffer();
  const post = usePostOffer();
  const [counterTo, setCounterTo] = useState<string | null>(null);
  const pending = accept.isPending || withdraw.isPending || post.isPending;

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Panel
        title="The board"
        action={
          <span className="font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
            {market.offers.length} standing
          </span>
        }
      >
        {market.offers.length === 0 ? (
          <p className="p-4 font-body text-[13px] text-ink-300">
            Nobody is offering anything right now. Post something and see who bites.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-surface-700" data-testid="market-board">
            {market.offers.map((offer) => (
              <OfferRow
                key={offer.id}
                offer={offer}
                mine={false}
                now={now}
                pending={pending}
                onAccept={() => accept.mutate({ offerId: offer.id })}
                onCounter={() => setCounterTo(offer.id)}
                onWithdraw={() => undefined}
              />
            ))}
          </ul>
        )}
        {(accept.error ?? withdraw.error) !== null && (
          <p role="alert" className="px-4 pb-3 font-body text-[13px] text-oxblood-300">
            {(accept.error ?? withdraw.error)?.message}
          </p>
        )}
      </Panel>

      <div className="flex flex-col gap-5">
        <OfferComposer market={market} counterTo={counterTo} onDone={() => setCounterTo(null)} />

        <Panel title="Yours">
          {market.mine.length === 0 ? (
            <p className="p-4 font-body text-[13px] text-ink-300">Nothing of yours is standing.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-surface-700" data-testid="my-offers">
              {market.mine.map((offer) => (
                <OfferRow
                  key={offer.id}
                  offer={offer}
                  mine
                  now={now}
                  pending={pending}
                  onAccept={() => undefined}
                  onCounter={() => undefined}
                  onWithdraw={() => withdraw.mutate({ offerId: offer.id })}
                />
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

/**
 * Posting a listing, and countering one.
 *
 * The same form both ways, because a counter *is* a listing: it just knows who it is aimed at.
 *
 * It used to be twelve bare number spinners in two grids, which is a tax form for a screen whose
 * whole job is "this pile, for that pile". You build each side by **pointing at what goes in it**:
 * the tiles are the same ones the Broker uses, a tap adds a chip, and the chip carries its own
 * stepper. What is on screen at rest is the two piles, not twelve empty fields, and the verdict
 * between them is the same badge the board prints so a player can see how their own offer will
 * read before anybody else sees it.
 */
function OfferComposer({
  market,
  counterTo,
  onDone,
}: {
  market: MarketResponse;
  counterTo: string | null;
  onDone: () => void;
}) {
  const post = usePostOffer();
  const [giveRes, setGiveRes] = useState<Partial<Record<ResourceKey, number>>>({});
  const [wantRes, setWantRes] = useState<Partial<Record<ResourceKey, number>>>({});
  const [giveItem, setGiveItem] = useState<ItemId | ''>('');
  const [giveItemCount, setGiveItemCount] = useState(1);

  const give = {
    resources: giveRes,
    items: giveItem === '' ? {} : { [giveItem]: giveItemCount },
  };
  const want = { resources: wantRes, items: {} };
  const held = heldItems(market.inventory);
  const empty = bundleValue(give) === 0 && bundleValue(want) === 0;

  return (
    <Panel title={counterTo === null ? 'Offer something' : 'Counter'}>
      <div className="flex flex-col gap-3.5 p-4">
        <BundleBuilder
          label="You give"
          tone="give"
          state={giveRes}
          onChange={setGiveRes}
          held={market.resources}
          testId="offer-give"
        />

        {held.length > 0 && (
          <label className="flex items-end gap-2">
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-ink-200">
                …and an item
              </span>
              <Dropdown
                label="An item to include in the offer"
                value={giveItem}
                onChange={setGiveItem}
                options={[
                  { value: '', label: 'Nothing' },
                  ...held.map(([id, count]) => ({
                    value: id,
                    label: ITEM_CATALOG[id].name,
                    hint: `${count} held`,
                  })),
                ]}
                data-testid="offer-item"
              />
            </span>
            {giveItem !== '' && (
              <NumberField
                label="how many of the item"
                value={giveItemCount}
                onChange={setGiveItemCount}
                min={1}
                max={market.inventory[giveItem] ?? 1}
                className="w-24"
              />
            )}
          </label>
        )}

        <BundleBuilder
          label="You want"
          tone="take"
          state={wantRes}
          onChange={setWantRes}
          held={market.resources}
          testId="offer-want"
        />

        {/* The deal as the board will print it, before anybody else sees it. */}
        <div className="edge-lit flex flex-wrap items-center justify-center gap-2.5 rounded-md border border-brass-500/40 bg-surface-950/50 px-3 py-3">
          <BundleChips bundle={give} tone="give" empty="nothing yet" />
          <TradeArrow className="h-6 w-6" />
          <BundleChips bundle={want} tone="take" empty="nothing yet" />
          {!empty && <ValueBadge received={want} paid={give} />}
        </div>

        <div className="flex items-center gap-3">
          <Button
            size="sm"
            disabled={post.isPending || empty}
            onClick={() =>
              post.mutate(counterTo === null ? { give, want } : { give, want, counterTo }, {
                onSuccess: onDone,
              })
            }
          >
            {counterTo === null ? 'Post it' : 'Send the counter'}
          </Button>
          {counterTo !== null && (
            <Button size="sm" variant="ghost" onClick={onDone}>
              Never mind
            </Button>
          )}
        </div>
        {post.error !== null && (
          <p role="alert" className="font-body text-[13px] text-oxblood-300">
            {post.error.message}
          </p>
        )}
      </div>
    </Panel>
  );
}

/**
 * One side of a proposed trade: tap a material to put it in, then say how much.
 *
 * A tile that is already in the pile keeps its stepper under it and drops out when it reaches
 * zero, so adding and removing are the same gesture and there is no delete button to hunt for.
 */
function BundleBuilder({
  label,
  tone,
  state,
  onChange,
  held,
  testId,
}: {
  label: string;
  tone: 'give' | 'take';
  state: Partial<Record<ResourceKey, number>>;
  onChange: (next: Partial<Record<ResourceKey, number>>) => void;
  held: Partial<Record<ResourceKey, number>>;
  testId: string;
}) {
  const chosen = RESOURCE_ORDER.filter((key) => (state[key] ?? 0) > 0);

  const set = (key: ResourceKey, amount: number): void => {
    const next = { ...state };
    if (amount <= 0) delete next[key];
    else next[key] = amount;
    onChange(next);
  };

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span
        className={cn(
          'font-display text-[11px] font-bold uppercase tracking-[0.16em]',
          tone === 'give' ? 'text-oxblood-300' : 'text-verdigris-100',
        )}
      >
        {label}
      </span>

      <div className="flex flex-wrap gap-1.5" data-testid={testId}>
        {RESOURCE_ORDER.map((key) => {
          const inPile = (state[key] ?? 0) > 0;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={inPile}
              aria-label={`${RESOURCE_LABELS[key]} into ${label}`}
              data-tip={`${RESOURCE_LABELS[key]} · ${(held[key] ?? 0).toLocaleString()} held`}
              data-testid={`${testId}-${key}`}
              onClick={() => set(key, inPile ? 0 : 1)}
              className={cn(
                'door-tile flex h-11 w-11 items-center justify-center rounded-lg border transition-all duration-150',
                inPile
                  ? 'door-tile-active -translate-y-0.5 border-brass-300'
                  : 'border-surface-500/70 hover:-translate-y-0.5 hover:border-iris-300/80',
              )}
            >
              <ResourceIcon
                kind={key}
                className="relative z-[2] h-7 w-7 drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)]"
              />
            </button>
          );
        })}
      </div>

      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-0.5">
          {chosen.map((key) => (
            <span key={key} className="flex items-center gap-1.5">
              <ResourceIcon kind={key} className="h-5 w-5" />
              <NumberField
                label={`how much ${RESOURCE_LABELS[key].toLowerCase()}`}
                value={state[key] ?? 0}
                onChange={(next) => set(key, next)}
                min={0}
                max={999_999}
                className="w-28"
                data-testid={`${testId}-amount-${key}`}
              />
            </span>
          ))}
        </div>
      )}
    </div>
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
