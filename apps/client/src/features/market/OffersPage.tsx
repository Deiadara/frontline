import {
  BLUEPRINTS,
  type BlueprintSpec,
  type ItemId,
  isBlueprintUnlocked,
  CLAIM_WINDOW_HOURS,
  MAX_OPEN_OFFERS,
  NO_TRADER_TEXT,
  OFFER_LIFETIME_HOURS,
  RESOURCE_LABELS,
  RESOURCE_ORDER,
  bundleIsEmpty,
  findCity,
  offerExpiresAt,
  ITEM_CATALOG,
  ITEM_IDS,
  type Inventory,
  type MarketClaim,
  type MarketOffer,
  type MarketResponse,
  type ResourceKey,
} from '@frontline/shared';
import { useState, type ReactNode } from 'react';
import { ResourceIcon } from '../../components/Resources';
import { DrawnButton } from '../../components/ui/DrawnButton';
import { NumberField } from '../../components/ui/NumberField';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import { PartsPicker } from './PartsPicker';

/**
 * Every part, at a count high enough that the stepper never runs out.
 *
 * The picker's `held` means "what may be chosen here". On the give side that is the crew's own bin.
 * On the want side it is the whole catalogue: what a crew asks for is by definition what they do
 * not have, so passing their inventory would hide the one part they are stuck on, which is the only
 * part anybody asks for. The ceiling is a stepper bound rather than a rule; `offerRefusal` on the
 * server is what actually decides whether a listing is legal.
 */
/**
 * The pages a crew may ask for: the ones missing from blueprints it has started and not finished
 * (maintainer, 2026-10-02). Every page in the game would be two hundred rows; a crew one page short
 * of a blueprint is the one asking.
 */
function pagesToAskFor(inventory: Inventory): Inventory {
  const wanted: Inventory = {};
  for (const blueprint of BLUEPRINTS as readonly BlueprintSpec[]) {
    // A fence document has no pages; an unlocked one wants none.
    if (blueprint.pages.length === 0 || isBlueprintUnlocked(inventory, blueprint.id)) continue;
    if (!blueprint.pages.some((page) => (inventory[page.id as ItemId] ?? 0) > 0)) continue;
    for (const page of blueprint.pages) {
      if ((inventory[page.id as ItemId] ?? 0) === 0) wanted[page.id as ItemId] = 99;
    }
  }
  return wanted;
}

const ASK_FOR_ANY: Inventory = Object.fromEntries(
  ITEM_IDS.filter((id) => ITEM_CATALOG[id].kind === 'component').map((id) => [id, 99]),
);
import {
  isCityShut,
  useAcceptOffer,
  useClaimMarketGoods,
  useMarket,
  usePostOffer,
  useWithdrawOffer,
} from '../../lib/queries';
import { CityPicker } from '../city/CityPicker';
import { useCityRoom } from '../city/useCityRoom';
import { formatRemaining } from '../base/format';
import { InfoNote, PageShell, ScreenLoadSheet } from '../game/PageShell';
import { useServerClock } from '../missions/useServerClock';
import { MarketTabs } from './BlackMarketPage';
import { BundleChips, TradeArrow } from './TradeParts';
import { PressError } from '../../components/ui/PressError';

/**
 * The board: crews trading with crews.
 *
 * It was the fourth panel on the front of the market, under the Runner, the Broker and the supply
 * run, and it was the only one of the four that is *people*. Squeezed into a shared column it drew
 * a listing as a row of small chips with two buttons at the end, so the one question a board exists
 * to answer, what for what, was the smallest thing on it.
 *
 * A page of its own, in two halves that face each other across the screen: **District Offers** on
 * the left, **Your Offers** on the right, one card per listing in a single column each. The piles
 * are drawn at `lg`, which is the size at which a glance answers the question. Nothing else on the
 * screen competes with them.
 *
 * Both halves are paper (maintainer, 2026-09-17), the same sheet the feats board and the market
 * counters are drawn on, and every control is a `DrawnButton`. The board used to be two struck tin
 * panels with brass plates on them and a violet edge under each material tile, which read as a
 * different building from the shop it is a tab of.
 */
export function OffersPage() {
  /*
   * Which city's board this is, the same remembered city the market reads and for the same reason:
   * the offers on it are the offers of the crews in that city (maintainer, 2026-09-17).
   */
  const { city, choose } = useCityRoom();
  const query = useMarket(city);
  const now = useServerClock(query.data?.serverNow, query.dataUpdatedAt);
  const accept = useAcceptOffer();
  const withdraw = useWithdrawOffer();
  const claim = useClaimMarketGoods();
  /*
   * Who a counter is aimed at, carried by name as well as by id.
   *
   * The composer is on the other side of the screen from the listing that was clicked, so it has
   * to say whose offer it is answering. The name only exists on the listing, and a form headed
   * "Counter" beside a board of four of them is a form that has forgotten which one.
   */
  const [counter, setCounter] = useState<{ id: string; sellerName: string } | null>(null);

  const data = query.data;
  if (!data) {
    return (
      <ScreenLoadSheet
        what="The board"
        loading="Reading what is pinned up…"
        // A shut door is not a failed read: see `isCityShut`.
        isError={query.isError && !isCityShut(query.error)}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const pending = accept.isPending || withdraw.isPending || claim.isPending;
  // A new deal needs this crew's Trader at work (2026-09-29). Withdraw and Claim stay live: what
  // is already up is still this crew's to take back or collect.
  const shut = data.traderAtWork === false;

  return (
    <PageShell
      wide
      quote="Put a price on it. Someone out there is desperate enough."
      action={
        data === undefined ? undefined : (
          <CityPicker cityId={data.cityId} cities={data.cities} onChoose={choose} />
        )
      }
    >
      <MarketTabs
        active="offers"
        action={
          <InfoNote label="How District Offers Work">
            Each city has its own board, and only crews with ground in that city see it. What you
            offer leaves your store when posted. Up to {MAX_OPEN_OFFERS} at once across every city,
            counters included. When somebody takes it, or nobody has after {OFFER_LIFETIME_HOURS}{' '}
            hours, the goods wait here for you to claim. After {CLAIM_WINDOW_HOURS} hours they go
            into your stores anyway, and whatever does not fit is lost.
          </InfoNote>
        }
      />

      {shut && (
        <p
          className="font-body text-[12px] leading-relaxed text-oxblood-300"
          data-testid="offers-shut"
        >
          {NO_TRADER_TEXT}. Your listings stand, and you can still take them back.
        </p>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <Panel
          tone="paper"
          title="District Offers"
          action={<Standing count={data.offers.length} />}
        >
          {data.offers.length === 0 ? (
            <Nothing>
              Nobody is offering anything right now, and counters aimed at your crew land here too.
            </Nothing>
          ) : (
            <ul className="flex flex-col gap-3 p-4" data-testid="market-board">
              {data.offers.map((offer) => (
                <OfferCard key={offer.id} offer={offer} mine={false} now={now}>
                  <DrawnButton
                    size="sm"
                    disabled={pending || shut}
                    onClick={() => setCounter({ id: offer.id, sellerName: offer.sellerName })}
                    // Opens the composer, commits nothing: the press that spends is its Post.
                    data-sound="click"
                  >
                    Counter
                  </DrawnButton>
                  <DrawnButton
                    size="sm"
                    disabled={pending || shut}
                    onClick={() => accept.mutate({ offerId: offer.id })}
                  >
                    Accept
                  </DrawnButton>
                </OfferCard>
              ))}
            </ul>
          )}
          {/* Under the half whose button was pressed. Both refusals used to print here, so
              "that listing has gone" for a withdraw on the right of the screen appeared under
              somebody else's board on the left, where the player was not looking. */}
          {accept.error && <PressError onDismiss={accept.reset}>{accept.error.message}</PressError>}
        </Panel>

        <Panel tone="paper" title="Your Offers" action={<Standing count={data.mine.length} />}>
          {/*
           * What is standing first, the form for a new one under it.
           *
           * The composer is about 370px of empty pickers, and with it on top the listing this
           * panel's own header counts ("1 standing") began below the fold at 1440x900: a player
           * was shown a blank form where the thing they came to check should have been, and had
           * to scroll past the form to find out whether anybody had taken it. Posting a listing
           * is the rarer errand of the two and it reads perfectly well as the foot of the panel.
           */}
          <div className="flex flex-col gap-4 p-4">
            {/* Waiting goods first: they are the one thing on this half with a clock that costs. */}
            {data.claims.length > 0 && (
              <ul className="flex flex-col gap-3" data-testid="my-claims">
                {data.claims.map((held) => (
                  <ClaimCard key={held.id} claim={held} now={now}>
                    <DrawnButton
                      size="sm"
                      disabled={pending}
                      onClick={() => claim.mutate({ claimId: held.id })}
                      data-testid={`claim-${held.id}`}
                    >
                      Claim
                    </DrawnButton>
                  </ClaimCard>
                ))}
              </ul>
            )}
            {claim.error && <PressError onDismiss={claim.reset}>{claim.error.message}</PressError>}

            {data.mine.length === 0 ? (
              <p className="font-body text-[13px] text-ink-300">
                Nothing of yours is standing. Whatever you put up is held aside until somebody takes
                it or you take it back.
              </p>
            ) : (
              <ul className="flex flex-col gap-3" data-testid="my-offers">
                {data.mine.map((offer) => (
                  <OfferCard
                    key={offer.id}
                    offer={offer}
                    mine
                    now={now}
                    // Your listings in every city are listed here, so Withdraw can reach one
                    // pinned to another city's board; that one says which board it is on.
                    elsewhere={offer.cityId === data.cityId ? null : offer.cityId}
                  >
                    <DrawnButton
                      size="sm"
                      disabled={pending}
                      onClick={() => withdraw.mutate({ offerId: offer.id })}
                    >
                      Withdraw
                    </DrawnButton>
                  </OfferCard>
                ))}
              </ul>
            )}

            {withdraw.error && (
              <PressError onDismiss={withdraw.reset}>{withdraw.error.message}</PressError>
            )}

            <OfferComposer
              market={data}
              // Only while the listing it answers is still on the board (bug pass, 2026-10-06): a
              // listing taken or withdrawn meanwhile left "Countering X" up and a send the server
              // refused.
              counter={
                counter !== null && data.offers.some((offer) => offer.id === counter.id)
                  ? counter
                  : null
              }
              onDone={() => setCounter(null)}
            />
          </div>
        </Panel>
      </div>
    </PageShell>
  );
}

/** How many listings are pinned to one half of the board. */
function Standing({ count }: { count: number }) {
  return (
    <span className="shrink-0 font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
      {count} standing
    </span>
  );
}

/** An empty half, in words rather than as a blank panel. */
function Nothing({ children }: { children: ReactNode }) {
  return <p className="p-4 font-body text-[13px] text-ink-300">{children}</p>;
}

/**
 * One listing, as the trade it is.
 *
 * Two piles with an arrow between them and a caption on each, so which side is whose is read off
 * the card rather than worked out from the button at the bottom. The colours are always from
 * *this* crew's side of the table: on somebody else's listing what arrives is their `give`, and on
 * our own it is our `want`, which is why the `tone` pair is swapped rather than the card reused as
 * it stood.
 *
 * There is no worth-against-worth verdict on the card any more. It went with the board's
 * 2026-09-09 pass, along with the item slot the composer used to offer: the two piles drawn at
 * `lg` answer "what for what" faster than a badge summarising them, and a badge priced off the
 * vendor's table was quietly telling a player their own proposal was fair.
 *
 * The controls are the caller's, because they are the one thing the two halves do not share.
 */
function OfferCard({
  offer,
  mine,
  now,
  elsewhere = null,
  children,
}: {
  offer: MarketOffer;
  mine: boolean;
  now: Date;
  /** The city this listing is pinned in, when that is not the board on screen. */
  elsewhere?: string | null;
  children: ReactNode;
}) {
  const standsFor = offerExpiresAt(offer).getTime() - now.getTime();
  // Our own half never prints our own crew's name back at us: on that side the only thing the
  // line has to say is which of the two kinds of listing this is.
  const whose = mine
    ? offer.counterTo !== null
      ? 'Your counter'
      : 'Your listing'
    : `${offer.counterTo !== null ? 'Counter from' : 'Offered by'} ${offer.sellerName}`;

  return (
    <li
      className="card-paper washed edge-lit flex flex-col gap-3 rounded-md border border-surface-600/70 p-4"
      data-testid={`offer-${offer.id}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-display text-[12px] font-bold uppercase tracking-[0.14em] text-brass-300">
          {whose}
        </span>
        {elsewhere !== null && (
          <span
            className="font-display text-[11px] uppercase tracking-[0.12em] text-ink-300"
            data-testid={`offer-city-${offer.id}`}
          >
            On the {findCity(elsewhere)?.name ?? elsewhere} board
          </span>
        )}
        <span
          className="ml-auto font-display text-[11px] uppercase tracking-[0.12em] text-ink-300"
          data-tip="How long this listing stands before it lapses"
        >
          Stands {formatRemaining(Math.max(0, standsFor))}
        </span>
      </div>

      {/* The controls sit on the end of the piles rather than on a row of their own: a card whose
          trade is two chips is mostly empty to the right of them, and a third row under that empty
          space is height spent on nothing. They wrap under when the piles have earned the width. */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <Field label={mine ? 'You hand over' : 'They hand over'} tone="give">
          <BundleChips
            bundle={offer.give}
            tone={mine ? 'give' : 'take'}
            size="lg"
            empty="nothing"
          />
        </Field>
        <TradeArrow className="mb-1 h-9 w-9" />
        <Field label={mine ? 'You are asking' : 'They want'} tone="take">
          <BundleChips
            bundle={offer.want}
            tone={mine ? 'take' : 'give'}
            size="lg"
            empty="nothing"
          />
        </Field>
        <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
      </div>
    </li>
  );
}

/**
 * Goods the board is holding for this crew (maintainer, 2026-09-28).
 *
 * A listing somebody took stays on this half with Claim where Withdraw was, and says who took it
 * and what the crew handed over for it. Goods coming back from a listing nobody took, a counter
 * whose listing closed, or a listing closed by a deal on a counter to it, say so instead. The clock is the one that matters: when it runs out the
 * goods go in whatever the stores can hold.
 */
function ClaimCard({
  claim,
  now,
  children,
}: {
  claim: MarketClaim;
  now: Date;
  children: ReactNode;
}) {
  const left = Date.parse(claim.claimUntil) - now.getTime();
  const headline =
    claim.reason === 'taken'
      ? `Taken by ${claim.takenBy ?? 'another crew'}`
      : claim.reason === 'expired'
        ? 'Nobody took it'
        : // A listing, not a counter, closes this way only when a counter further down was taken.
          claim.offer.counterTo === null
          ? 'A deal on a counter closed it'
          : 'The listing you countered closed';

  return (
    <li
      className="card-paper washed edge-lit flex flex-col gap-3 rounded-md border border-verdigris-500/50 p-4"
      data-testid={`market-claim-${claim.id}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-display text-[12px] font-bold uppercase tracking-[0.14em] text-verdigris-300">
          {headline}
        </span>
        <span
          className="ml-auto font-display text-[11px] uppercase tracking-[0.12em] text-ink-300"
          data-tip="After this they go into your stores anyway, and whatever does not fit is lost"
        >
          Claim within {formatRemaining(Math.max(0, left))}
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        {claim.reason === 'taken' && (
          <>
            <Field label="You handed over" tone="give">
              <BundleChips bundle={claim.offer.give} tone="give" size="lg" empty="nothing" />
            </Field>
            <TradeArrow className="mb-1 h-9 w-9" />
          </>
        )}
        <Field label={claim.reason === 'taken' ? 'You get' : 'Back to you'} tone="take">
          <BundleChips bundle={claim.goods} tone="take" size="lg" empty="nothing" />
        </Field>
        <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
      </div>
    </li>
  );
}

/**
 * One side of a trade, captioned: on a card, and in the composer.
 *
 * The same small-caps hand the rest of the market labels its steps with, and the same two colours
 * on both halves of the page, so a red caption always names what leaves and a green one always
 * names what arrives whichever card the eye lands on.
 */
function Field({
  label,
  tone,
  children,
}: {
  label: string;
  tone: 'give' | 'take';
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span
        className={cn(
          'font-display text-[11px] font-bold uppercase tracking-[0.16em]',
          tone === 'give' ? 'text-oxblood-300' : 'text-verdigris-300',
        )}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * Posting a listing, and countering one.
 *
 * The same form both ways, because a counter *is* a listing: it just knows who it is aimed at, and
 * says so in its own heading rather than leaving a player to remember which card they clicked.
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
  counter,
  onDone,
}: {
  market: MarketResponse;
  counter: { id: string; sellerName: string } | null;
  onDone: () => void;
}) {
  const post = usePostOffer();
  const [giveRes, setGiveRes] = useState<Partial<Record<ResourceKey, number>>>({});
  const [wantRes, setWantRes] = useState<Partial<Record<ResourceKey, number>>>({});
  // Parts, on both sides. `TradeBundle` has carried `items` since the board existed and
  // `offerRefusal` has always checked them; until now nothing filled the field. See `PartsPicker`.
  const [giveParts, setGiveParts] = useState<Inventory>({});
  const [wantParts, setWantParts] = useState<Inventory>({});

  /*
   * Emptied on a successful post, and this is not tidiness.
   *
   * `postOffer` spends `give` out of the stockpile the moment the listing goes up, deliberately: a
   * board of listings that cannot be honoured is worse than no board. The form used to keep the
   * pile with the button live, so a second press escrowed a second copy of it, up to
   * `MAX_OPEN_OFFERS`. A player who did not notice the first one land could put eight copies of
   * the same 500 scrap on the board.
   *
   * The counter case was quieter and worse: the parent's `onDone` cleared `counterTo` but not the
   * bundle, so an identical-looking form changed from "counter that listing" to "public listing"
   * with nothing but the button's own label to say so.
   */
  const clear = () => {
    setGiveRes({});
    setWantRes({});
    setGiveParts({});
    setWantParts({});
  };

  const give = { resources: giveRes, items: giveParts };
  const want = { resources: wantRes, items: wantParts };
  // Either side empty, not both: the server refuses a listing that gives nothing and one that asks
  // for nothing (`offerRefusal`), so a half-filled form was a live button with a refusal behind it.
  const empty = bundleIsEmpty(give) || bundleIsEmpty(want);
  // Counters stand on the board as listings do, so they count toward the cap too.
  const full = market.mine.length >= MAX_OPEN_OFFERS;

  return (
    <div
      className="card-paper washed edge-lit flex flex-col gap-3.5 rounded-md border border-brass-500/50 p-4"
      data-testid="offer-composer"
    >
      <h3 className="font-stamp text-[16px] leading-none text-brass-300">
        {counter === null ? 'Put something up' : `Countering ${counter.sellerName}`}
      </h3>

      <BundleBuilder
        label="You give"
        tone="give"
        state={giveRes}
        onChange={setGiveRes}
        held={market.resources}
        testId="offer-give"
        parts={
          <>
            <PartsPicker
              label="You give"
              chosen={giveParts}
              held={market.inventory}
              onChange={setGiveParts}
              testId="offer-give-parts"
            />
            <PartsPicker
              kind="page"
              label="You give"
              chosen={giveParts}
              held={market.inventory}
              onChange={setGiveParts}
              testId="offer-give-pages"
            />
          </>
        }
      />

      <BundleBuilder
        label="You want"
        tone="take"
        state={wantRes}
        onChange={setWantRes}
        held={market.resources}
        testId="offer-want"
        parts={
          /*
           * The want side offers the whole catalogue, not the bin.
           *
           * What a crew is asking *for* is by definition something they do not have, so passing
           * their own inventory as `held` would make the interesting case, the part you are stuck
           * on, the one part you cannot ask for. The picker's `held` is "what may be chosen", and
           * on this side that is everything a part can be.
           */
          <>
            <PartsPicker
              label="You want"
              chosen={wantParts}
              held={ASK_FOR_ANY}
              owned={market.inventory}
              onChange={setWantParts}
              testId="offer-want-parts"
            />
            <PartsPicker
              kind="page"
              label="You want"
              chosen={wantParts}
              held={pagesToAskFor(market.inventory)}
              owned={market.inventory}
              onChange={setWantParts}
              testId="offer-want-pages"
            />
          </>
        }
      />

      {/* The deal as the board will print it, before anybody else sees it. */}
      <div className="edge-lit flex flex-wrap items-center justify-center gap-2.5 rounded-md border border-brass-500/40 bg-surface-950/50 px-3 py-3">
        <BundleChips bundle={give} tone="give" size="lg" empty="nothing yet" />
        <TradeArrow className="h-9 w-9" />
        <BundleChips bundle={want} tone="take" size="lg" empty="nothing yet" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <DrawnButton
          size="sm"
          disabled={post.isPending || empty || market.traderAtWork === false || full}
          onClick={() =>
            // A listing goes up on the board on screen; a counter on its listing's, whatever tab.
            post.mutate(
              counter === null
                ? { give, want, cityId: market.cityId }
                : { give, want, counterTo: counter.id },
              {
                onSuccess: () => {
                  clear();
                  onDone();
                },
              },
            )
          }
        >
          {counter === null ? 'Post it' : 'Send the counter'}
        </DrawnButton>
        {counter !== null && (
          <DrawnButton size="sm" data-sound="click" onClick={onDone}>
            Never mind
          </DrawnButton>
        )}
      </div>
      {full && (
        <p className="font-body text-[12px] text-ink-300" data-testid="offers-full">
          You have {MAX_OPEN_OFFERS} up already. Take one down before you put up another.
        </p>
      )}
      {post.error && <PressError onDismiss={post.reset}>{post.error.message}</PressError>}
    </div>
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
  parts,
}: {
  label: string;
  tone: 'give' | 'take';
  state: Partial<Record<ResourceKey, number>>;
  onChange: (next: Partial<Record<ResourceKey, number>>) => void;
  held: Partial<Record<ResourceKey, number>>;
  testId: string;
  /** The parts door, drawn at the end of the row of material tiles. */
  parts?: ReactNode;
}) {
  const chosen = RESOURCE_ORDER.filter((key) => (state[key] ?? 0) > 0);

  const set = (key: ResourceKey, amount: number): void => {
    const next = { ...state };
    if (amount <= 0) delete next[key];
    else next[key] = amount;
    onChange(next);
  };

  return (
    <Field label={label} tone={tone}>
      <div className="flex flex-wrap gap-1.5" data-testid={testId}>
        {RESOURCE_ORDER.map((key) => {
          const inPile = (state[key] ?? 0) > 0;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={inPile}
              aria-label={`${RESOURCE_LABELS[key]} into ${label}`}
              data-tip={`${RESOURCE_LABELS[key]} · ${(held[key] ?? 0).toLocaleString('en-US')} held`}
              data-testid={`${testId}-${key}`}
              onClick={() => set(key, inPile ? 0 : 1)}
              className={cn(
                'door-tile flex h-11 w-11 items-center justify-center rounded-lg border transition-all duration-150',
                inPile
                  ? 'door-tile-active -translate-y-0.5 border-brass-300'
                  : 'border-surface-500/70 hover:-translate-y-0.5 hover:border-brass-300/80',
              )}
            >
              <ResourceIcon
                kind={key}
                className="relative z-[2] h-7 w-7 drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)]"
              />
            </button>
          );
        })}
        {/* The parts door, at the end of the materials it sits beside: one row, two kinds of
            thing, and the eight parts stay behind one press rather than eight dim tiles. */}
        {parts}
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
                // What the stores hold, on the side that leaves them: the post is escrowed, and
                // more than is held came back "you cannot cover that" after the press.
                max={tone === 'give' ? Math.max(0, Math.floor(held[key] ?? 0)) : 999_999}
                className="w-28"
                data-testid={`${testId}-amount-${key}`}
              />
            </span>
          ))}
        </div>
      )}
    </Field>
  );
}
