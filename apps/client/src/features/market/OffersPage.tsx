import {
  MAX_OPEN_OFFERS,
  OFFER_LIFETIME_HOURS,
  RESOURCE_LABELS,
  RESOURCE_ORDER,
  bundleValue,
  offerExpiresAt,
  type MarketOffer,
  type MarketResponse,
  type ResourceKey,
} from '@frontline/shared';
import { useState, type ReactNode } from 'react';
import { ResourceIcon } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { NumberField } from '../../components/ui/NumberField';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import { useAcceptOffer, useMarket, usePostOffer, useWithdrawOffer } from '../../lib/queries';
import { formatRemaining } from '../base/format';
import { InfoNote, PageShell, ScreenLoadSheet } from '../game/PageShell';
import { useServerClock } from '../missions/useServerClock';
import { MarketTabs } from './BlackMarketPage';
import { BundleChips, TradeArrow } from './TradeParts';

/**
 * The board: crews trading with crews.
 *
 * It was the fourth panel on the front of the market, under the Runner, the Broker and the supply
 * run, and it was the only one of the four that is *people*. Squeezed into a shared column it drew
 * a listing as a row of small chips with two buttons at the end, so the one question a board exists
 * to answer, what for what, was the smallest thing on it.
 *
 * A page of its own, in two halves that face each other across the screen: **They offer** on the
 * left, **You offer** on the right, one card per listing in a single column each. The piles are
 * drawn at `lg`, which is the size at which a glance answers the question. Nothing else on the
 * screen competes with them.
 */
export function OffersPage() {
  const query = useMarket();
  const now = useServerClock(query.data?.serverNow, query.dataUpdatedAt);
  const accept = useAcceptOffer();
  const withdraw = useWithdrawOffer();
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
        isError={query.isError}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const pending = accept.isPending || withdraw.isPending;
  const failure = accept.error ?? withdraw.error;

  return (
    <PageShell
      wide
      quote="A crew never sells what it needs. It sells what somebody else needs more."
    >
      <MarketTabs
        active="offers"
        action={
          <InfoNote label="How Faction Offers Work">
            What you offer leaves your store when you post it and comes home if you withdraw it or
            it stands {OFFER_LIFETIME_HOURS} hours untaken. {MAX_OPEN_OFFERS} standing at once,
            counters included; a counter is a listing only the crew it answers can see.
          </InfoNote>
        }
      />

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <Panel title="They offer" action={<Standing count={data.offers.length} />}>
          {data.offers.length === 0 ? (
            <Nothing>
              Nobody is offering anything right now, and counters aimed at your crew land here too.
            </Nothing>
          ) : (
            <ul className="flex flex-col gap-3 p-4" data-testid="market-board">
              {data.offers.map((offer) => (
                <OfferCard key={offer.id} offer={offer} mine={false} now={now}>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => setCounter({ id: offer.id, sellerName: offer.sellerName })}
                  >
                    Counter
                  </Button>
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() => accept.mutate({ offerId: offer.id })}
                  >
                    Accept
                  </Button>
                </OfferCard>
              ))}
            </ul>
          )}
          {failure !== null && (
            <p role="alert" className="px-4 pb-4 font-body text-[13px] text-oxblood-300">
              {failure.message}
            </p>
          )}
        </Panel>

        <Panel title="You offer" action={<Standing count={data.mine.length} />}>
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
            {data.mine.length === 0 ? (
              <p className="font-body text-[13px] text-ink-300">
                Nothing of yours is standing. Whatever you put up is held aside until somebody takes
                it or you take it back.
              </p>
            ) : (
              <ul className="flex flex-col gap-3" data-testid="my-offers">
                {data.mine.map((offer) => (
                  <OfferCard key={offer.id} offer={offer} mine now={now}>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => withdraw.mutate({ offerId: offer.id })}
                    >
                      Withdraw
                    </Button>
                  </OfferCard>
                ))}
              </ul>
            )}

            <OfferComposer market={data} counter={counter} onDone={() => setCounter(null)} />
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
 * the card rather than worked out from the button at the bottom. The verdict badge is always from
 * *this* crew's side of the table: on somebody else's listing what arrives is their `give`, and on
 * our own it is our `want`, which is why the pair is swapped rather than the card reused as it
 * stood. See the comment on `valueVerdict`.
 *
 * The controls are the caller's, because they are the one thing the two halves do not share.
 */
function OfferCard({
  offer,
  mine,
  now,
  children,
}: {
  offer: MarketOffer;
  mine: boolean;
  now: Date;
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
  };

  // Materials only (board request, 2026-09-09): the item slot went with the verdict badges. The
  // wire still carries items so a listing is one shape everywhere; this screen just never fills it.
  const give = { resources: giveRes, items: {} };
  const want = { resources: wantRes, items: {} };
  const empty = bundleValue(give) === 0 && bundleValue(want) === 0;

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
      />

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
        <BundleChips bundle={give} tone="give" size="lg" empty="nothing yet" />
        <TradeArrow className="h-9 w-9" />
        <BundleChips bundle={want} tone="take" size="lg" empty="nothing yet" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          disabled={post.isPending || empty}
          onClick={() =>
            post.mutate(counter === null ? { give, want } : { give, want, counterTo: counter.id }, {
              onSuccess: () => {
                clear();
                onDone();
              },
            })
          }
        >
          {counter === null ? 'Post it' : 'Send the counter'}
        </Button>
        {counter !== null && (
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
    </Field>
  );
}
