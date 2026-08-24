import {
  BARTER_MINIMUM,
  ITEM_CATALOG,
  ITEM_RARITY_LABELS,
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  barterQuote,
  supplyPrice,
  bundleValue,
  describeBundle,
  marketDay,
  utcHourInZone,
  zoneCity,
  heldItems,
  type ItemId,
  type ItemRarity,
  type MarketOffer,
  type MarketResponse,
  type ResourceKey,
  type SupplyLine,
  type VendorOffer,
} from '@frontline/shared';
import { useState } from 'react';
import { ResourceIcon } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { Dropdown } from '../../components/ui/Dropdown';
import { HoverCard } from '../../components/ui/HoverCard';
import { InfoWindow, WindowSection } from '../../components/ui/InfoWindow';
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
 *   mildly bad — and bounded by the day, so it tops a crew up and can never feed one.
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
    <PageShell title="The Market" icon="market" wide>
      <MarketTabs active="market" />

      <InfoNote>
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

const RARITY_TONE: Record<ItemRarity, string> = {
  common: 'border-surface-600 text-ink-200',
  uncommon: 'border-verdigris-300/60 text-verdigris-100',
  rare: 'border-iris-300/60 text-iris-100',
  exotic: 'border-brass-300/70 text-brass-300',
};

/** One line on the barrow, with the whole item behind a hover. */
function VendorRow({
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
    <li className="flex items-center gap-3 px-4 py-3">
      <HoverCard
        label={spec.name}
        size="window"
        card={<ItemWindow id={spec.id} />}
        className="shrink-0"
      >
        <span className="icon-tile flex h-12 w-12 items-center justify-center rounded-sm">
          <ItemGlyph id={spec.id} className="h-9 w-9" />
        </span>
      </HoverCard>

      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-[14px] font-bold text-ink-100">
          {spec.name}
        </span>
        <span
          className={cn(
            'mt-0.5 inline-block rounded-sm border px-1.5 py-0.5 font-display text-[10px] uppercase tracking-[0.14em]',
            RARITY_TONE[spec.rarity],
          )}
        >
          {ITEM_RARITY_LABELS[spec.rarity]}
        </span>
      </span>

      <span className="shrink-0 text-right">
        <span className="block font-display text-[15px] font-bold tabular-nums text-warning">
          {offer.line.price.toLocaleString()}
        </span>
        <span className="block font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
          {soldOut ? 'sold out' : `${offer.line.stock} left`}
        </span>
      </span>

      <Button size="sm" disabled={soldOut || !offer.affordable || pending} onClick={onBuy}>
        Buy
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
            ? `In — ${formatRemaining(closes ?? 0)} left`
            : `Back in ${formatRemaining(opens)}`}
        </span>
      }
    >
      <p className="px-4 pt-3 font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
        Today he is in at{' '}
        {vendor.sessions
          .map((session) => utcHourInZone(marketDay(now), session.startHour, zone))
          .join(' and ')}
        , two hours each, {zoneCity(zone)} time.
      </p>
      <ul className="flex flex-col divide-y divide-surface-700" data-testid="vendor-stock">
        {vendor.stock.map((offer) => (
          <VendorRow
            key={offer.line.id}
            offer={offer}
            pending={buy.isPending || !vendor.open}
            onBuy={() => buy.mutate({ lineId: offer.line.id, count: 1 })}
          />
        ))}
      </ul>
      {buy.error !== null && (
        <p role="alert" className="px-4 pb-3 font-body text-[13px] text-oxblood-300">
          {buy.error.message}
        </p>
      )}
    </Panel>
  );
}

/** The always-open half-rate exchange. */
function BrokerPanel({ market }: { market: MarketResponse }) {
  const barter = useBarter();
  const [give, setGive] = useState<ResourceKey>('oil');
  const [want, setWant] = useState<ResourceKey>('scrap');
  const [amount, setAmount] = useState(100);

  const held = market.resources[give];
  // §I3 — the rate is quoted by the server so the screen and the settlement cannot disagree about
  // which one applied. A client that recomputed the milestone would be a second opinion about it.
  const quote = barterQuote(amount, market.barterRate);
  const blocked =
    give === want || amount < BARTER_MINIMUM || amount > held || barter.isPending
      ? give === want
        ? 'Pick two different things'
        : amount < BARTER_MINIMUM
          ? `He will not move for less than ${BARTER_MINIMUM}`
          : amount > held
            ? 'You do not have that much'
            : null
      : null;

  return (
    <Panel
      title="The Broker"
      action={
        <span className="font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
          Always in · gives back {Math.round(market.barterRate * 100)}%
        </span>
      }
    >
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex w-40 min-w-0 flex-col gap-1">
            <span className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-ink-200">
              Give
            </span>
            <Dropdown
              label="What to give the Broker"
              value={give}
              onChange={setGive}
              options={RESOURCE_KEYS.map((key) => ({ value: key, label: RESOURCE_LABELS[key] }))}
              data-testid="broker-give"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-ink-200">
              How much
            </span>
            <input
              type="number"
              min={BARTER_MINIMUM}
              value={amount}
              onChange={(event) => setAmount(Math.max(0, Math.trunc(Number(event.target.value))))}
              className="w-28 rounded-sm border border-surface-600 bg-surface-950 px-2.5 py-2 text-[13px] tabular-nums text-ink-100"
            />
          </label>
          <label className="flex w-40 min-w-0 flex-col gap-1">
            <span className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-ink-200">
              Take
            </span>
            <Dropdown
              label="What to take from the Broker"
              value={want}
              onChange={setWant}
              options={RESOURCE_KEYS.map((key) => ({ value: key, label: RESOURCE_LABELS[key] }))}
              data-testid="broker-take"
            />
          </label>
        </div>

        {/* The quote, before the button. Nobody should find out the rate afterwards. */}
        <p
          className="rounded-sm border border-brass-500/40 bg-surface-900/60 px-3 py-2.5 font-display text-[14px] tabular-nums text-ink-100"
          data-testid="barter-quote"
        >
          <span className="flex items-center gap-2">
            <ResourceIcon kind={give} className="h-6 w-6" />
            {amount.toLocaleString()}
            <span className="text-ink-300">→</span>
            <ResourceIcon kind={want} className="h-6 w-6" />
            <span className="font-bold text-brass-300">{quote.toLocaleString()}</span>
          </span>
        </p>

        <div className="flex items-center gap-3">
          <Button
            size="sm"
            disabled={blocked !== null || barter.isPending}
            onClick={() => barter.mutate({ give, want, amount })}
          >
            Trade
          </Button>
          <span className="font-display text-[12px] text-ink-300">
            {blocked ?? `You are holding ${held.toLocaleString()}`}
          </span>
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
 * across every material, so a five-row form would suggest five separate budgets — which is exactly
 * the wrong model of the thing.
 */
function SupplyPanel({ market }: { market: MarketResponse }) {
  const buy = useBuySupply();
  const { supply } = market;
  const [key, setKey] = useState<SupplyLine['key']>('scrap');
  const [units, setUnits] = useState(100);

  const line = supply.lines.find((entry) => entry.key === key);
  const left = Math.max(0, supply.allowance - supply.used);
  const most = line?.most ?? 0;
  const price = supplyPrice(key, units);
  const blocked =
    units <= 0
      ? 'Say how much you want'
      : units > left
        ? `Today's run will only carry ${left.toLocaleString()} more`
        : units > most
          ? 'More than you can pay for or store'
          : null;

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

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex w-44 min-w-0 flex-col gap-1">
            <span className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-ink-200">
              Buy
            </span>
            <Dropdown
              label="What to buy with caps"
              value={key}
              onChange={setKey}
              options={supply.lines.map((entry) => ({
                value: entry.key,
                label: RESOURCE_LABELS[entry.key],
                hint: `${entry.capsPerUnit.toLocaleString()} caps each`,
              }))}
              data-testid="supply-resource"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-ink-200">
              How many
            </span>
            <input
              aria-label="How many units to buy"
              type="number"
              min={1}
              value={units}
              onChange={(event) => setUnits(Math.max(0, Math.trunc(Number(event.target.value))))}
              className="w-28 rounded-sm border border-surface-600 bg-surface-950 px-2.5 py-2 font-hand text-[20px] tabular-nums text-ink-100"
            />
          </label>
          {/* Only when there is something to take. "All 0" on a full warehouse is a control that
              advertises its own uselessness, and the line under the button already says why. */}
          {most > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setUnits(most)}>
              All {most.toLocaleString()}
            </Button>
          )}
        </div>

        {/* The price before the button, exactly as the Broker quotes his rate. */}
        <p
          className="flex flex-wrap items-center gap-2 rounded-sm border border-brass-500/40 bg-surface-900/60 px-3 py-2.5 font-hand text-[21px] text-ink-100"
          data-testid="supply-quote"
        >
          <ResourceIcon kind="caps" className="h-6 w-6" />
          <span className="tabular-nums text-warning">{price.toLocaleString()}</span>
          <span className="text-ink-300">for</span>
          <ResourceIcon kind={key} className="h-6 w-6" />
          <span className="tabular-nums text-brass-300">
            {units.toLocaleString()} {RESOURCE_LABELS[key].toLowerCase()}
          </span>
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            disabled={blocked !== null || buy.isPending}
            onClick={() => buy.mutate({ key, units })}
          >
            {buy.isPending ? 'Loading up…' : 'Buy it'}
          </Button>
          <span className="font-display text-[12px] text-ink-300">
            {blocked ?? `Your store holds ${supply.storageCapacity.toLocaleString()} of each`}
          </span>
        </div>
        {buy.error !== null && (
          <p role="alert" className="font-body text-[13px] text-oxblood-300">
            {buy.error.message}
          </p>
        )}
      </div>
    </Panel>
  );
}

/** One listing on the board, with what it is worth beside what it says. */
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
  const giving = bundleValue(offer.give);
  const wanting = bundleValue(offer.want);
  const standsFor = Date.parse(offer.createdAt) + 48 * 3_600_000 - now.getTime();

  return (
    <li
      className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
      data-testid={`offer-${offer.id}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[12px] uppercase tracking-[0.14em] text-brass-300">
          {offer.counterTo !== null ? 'Counter from' : 'Offered by'} {offer.sellerName}
        </span>
        <span className="mt-0.5 block font-body text-[14px] leading-snug text-ink-100">
          Gives <span className="text-bile-300">{describeBundle(offer.give)}</span> for{' '}
          <span className="text-warning">{describeBundle(offer.want)}</span>
        </span>
        <span className="mt-0.5 block font-display text-[11px] uppercase tracking-[0.12em] text-ink-300">
          worth {giving.toLocaleString()} against {wanting.toLocaleString()} · stands{' '}
          {formatRemaining(Math.max(0, standsFor))}
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
 * The same form both ways, because a counter *is* a listing — it just knows who it is aimed at.
 * Resources on one axis, items on the other, and the running valuation under both so a player can
 * see what they are proposing before anybody else does.
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

  const field = (
    label: string,
    state: Partial<Record<ResourceKey, number>>,
    set: (next: Partial<Record<ResourceKey, number>>) => void,
  ) => (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-ink-200">
        {label}
      </span>
      <div className="grid grid-cols-2 gap-1.5">
        {RESOURCE_KEYS.map((key) => (
          <label key={key} className="flex items-center gap-1.5">
            <ResourceIcon kind={key} className="h-5 w-5 shrink-0" />
            <input
              type="number"
              min={0}
              value={state[key] ?? 0}
              onChange={(event) =>
                set({ ...state, [key]: Math.max(0, Math.trunc(Number(event.target.value))) })
              }
              className="w-full min-w-0 rounded-sm border border-surface-600 bg-surface-950 px-1.5 py-1 text-[12px] tabular-nums text-ink-100"
            />
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <Panel title={counterTo === null ? 'Offer something' : 'Counter'}>
      <div className="flex flex-col gap-3 p-4">
        {field('You give', giveRes, setGiveRes)}

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
            <input
              type="number"
              min={1}
              value={giveItemCount}
              onChange={(event) =>
                setGiveItemCount(Math.max(1, Math.trunc(Number(event.target.value))))
              }
              className="w-16 rounded-sm border border-surface-600 bg-surface-950 px-2 py-2 text-[13px] tabular-nums text-ink-100"
            />
          </label>
        )}

        {field('You want', wantRes, setWantRes)}

        <p className="font-display text-[12px] uppercase tracking-[0.12em] text-ink-300">
          Giving {bundleValue(give).toLocaleString()} · asking {bundleValue(want).toLocaleString()}
        </p>

        <div className="flex items-center gap-3">
          <Button
            size="sm"
            disabled={post.isPending}
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
      {spec.usedFor !== '' ? (
        <WindowSection label="What it is for">
          <p className="font-body text-[13px] leading-snug text-ink-100">{spec.usedFor}</p>
        </WindowSection>
      ) : (
        <WindowSection label="What it is for">
          <p className="font-body text-[13px] leading-snug text-ink-300">
            Nothing. Somebody will still pay for it.
          </p>
        </WindowSection>
      )}
    </InfoWindow>
  );
}
