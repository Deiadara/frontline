import { formatClock, nextLotBid, type LotAuction } from '@frontline/shared';
import { useEffect, useState } from 'react';
import { ResourceIcon } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { NumberField } from '../../components/ui/NumberField';
import { cn } from '../../lib/cn';
import { countdownText, LAST_CALL_MS } from '../bar/AuctionParts';

/**
 * The furniture a lot's bidding screen is made of (maintainer, 2026-09-17).
 *
 * Two counters in the city take open bids now: the Runner's barrow, in caps, and the fence's shelf,
 * in infamy. The clock, the standing, the table and the one control were written for the barrow and
 * lifted here when the shelf became an auction, because two copies of a bidding screen is two
 * places for "leading" and "the next legal number" to drift apart.
 *
 * Everything in here is written against {@link LotAuction}, which is the shape both counters'
 * schemas extend, plus a {@link LotCurrency}. Nothing knows what is being sold.
 */

/**
 * What a lot is bid in, and what a crew's purse is measured in.
 *
 * Two, and there will not be a third without a reason: caps are the city's money and infamy is the
 * reputation the back room takes instead. They are drawn differently on purpose, so a player can
 * never mistake one screen's numbers for the other's.
 */
export type LotCurrency = 'caps' | 'infamy';

/** The purse icon and the word for it, so a refusal can name what the crew is short of. */
export function CurrencyIcon({
  currency,
  className,
}: {
  currency: LotCurrency;
  className?: string;
}) {
  return currency === 'caps' ? (
    <ResourceIcon kind="caps" className={className ?? ''} />
  ) : (
    <Icon name="infamy" className={cn(className, 'text-tangerine-300')} />
  );
}

/** Where the reader stands on the open bids. */
export type LotStandingWord = 'leading' | 'outbid' | 'out';

export function standingOf(auction: LotAuction): LotStandingWord {
  if (auction.leading?.yours === true) return 'leading';
  return auction.yourBid === null ? 'out' : 'outbid';
}

/**
 * The clock on a lot: how long until it settles, oxblood inside the last five minutes.
 *
 * `mm:ss` inside the hour, the game's two-unit duration above it, exactly as the Bar's clock reads,
 * because a player who has learned one countdown should not have to learn another.
 *
 * `words` is the pair the counter uses for its own close. The barrow's man packs up; the fence
 * settles at midnight, and "Packs up in" over a shelf nobody ever sees close would be a sentence
 * about the wrong room.
 */
export function LotClock({
  closesAt,
  now,
  size = 'sm',
  words = ['Packs up in', 'Packed up'],
  testId,
}: {
  closesAt: string;
  now: Date;
  size?: 'sm' | 'lg';
  words?: readonly [running: string, done: string];
  testId?: string;
}) {
  const left = Date.parse(closesAt) - now.getTime();
  const closed = left <= 0;
  const lastCall = !closed && left <= LAST_CALL_MS;
  return (
    <span
      className={cn(
        'inline-flex min-w-0 shrink-0 items-center gap-1.5 rounded-sm border px-2 py-1',
        lastCall
          ? 'border-oxblood-300/60 bg-oxblood-500/10'
          : 'border-surface-600/80 bg-surface-950/50',
      )}
      data-testid={testId}
    >
      <Icon
        name="clock"
        aria-hidden
        className={cn('h-3.5 w-3.5 shrink-0', lastCall ? 'text-oxblood-300' : 'text-hextech-100')}
      />
      <span className="font-display text-[10px] uppercase tracking-[0.14em] text-ink-300">
        {closed ? words[1] : words[0]}
      </span>
      {!closed && (
        <span
          className={cn(
            'font-display font-bold leading-none tabular-nums',
            size === 'lg' ? 'text-[17px]' : 'text-[13px]',
            lastCall ? 'text-oxblood-300' : 'text-ink-100',
          )}
        >
          {countdownText(left)}
        </span>
      )}
    </span>
  );
}

/** The figure the whole screen is about, and where the reader stands against it. */
export function LotStanding({
  auction,
  currency,
  opens,
}: {
  auction: LotAuction;
  currency: LotCurrency;
  /** The sentence under an untouched lot, which is the one thing the two counters word differently. */
  opens: string;
}) {
  const standing = standingOf(auction);
  const word =
    auction.leading === null
      ? 'Nobody has bid'
      : standing === 'leading'
        ? 'You are leading'
        : standing === 'outbid'
          ? 'You have been outbid'
          : 'Somebody is in front';
  return (
    <div
      className={cn(
        'edge-lit flex flex-col gap-1.5 rounded-sm border bg-surface-950/50 p-3',
        standing === 'leading'
          ? 'border-verdigris-300/50'
          : standing === 'outbid'
            ? 'border-oxblood-300/50'
            : 'border-surface-600',
      )}
      data-testid="lot-standing"
    >
      <span
        className={cn(
          'font-display text-[10px] font-bold uppercase tracking-[0.18em]',
          standing === 'leading'
            ? 'text-verdigris-100'
            : standing === 'outbid'
              ? 'text-oxblood-300'
              : 'text-ink-300',
        )}
      >
        {word}
      </span>
      <span className="flex min-w-0 items-baseline gap-2">
        <CurrencyIcon currency={currency} className="h-5 w-5" />
        <span
          className="font-display text-[34px] font-bold leading-none tabular-nums text-brass-100"
          data-testid="lot-leading"
        >
          {(auction.leading?.amount ?? auction.reserve).toLocaleString()}
        </span>
      </span>
      <span className="min-w-0 truncate font-body text-[12px] leading-snug text-ink-200">
        {auction.leading === null ? (
          opens
        ) : (
          <>
            Held by{' '}
            <span className="text-ink-100">
              {auction.leading.yours ? 'you' : auction.leading.username}
            </span>{' '}
            · {auction.bidders} {auction.bidders === 1 ? 'crew is in' : 'crews are in'}
          </>
        )}
      </span>
    </div>
  );
}

/** Every crew's standing bid on the lot, newest first: a raise replaces the crew's earlier row. */
export function LotHistory({ auction, zone }: { auction: LotAuction; zone: string }) {
  return (
    <div className="flex min-w-0 flex-col rounded-sm border border-surface-700 bg-surface-950/40">
      <span className="border-b border-surface-700/80 px-2.5 py-1.5 font-display text-[10px] font-bold uppercase tracking-[0.2em] text-brass-300">
        On the table
      </span>
      {auction.bids.length === 0 ? (
        <p className="px-2.5 py-3 text-center font-body text-[12px] italic text-ink-400">
          Nobody has said a number yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-surface-800" data-testid="lot-history">
          {auction.bids.map((bid, at) => (
            <li
              key={`${bid.username}-${bid.at}-${at}`}
              data-yours={bid.yours ? 'yes' : undefined}
              className={cn(
                'flex min-w-0 items-baseline gap-2 px-2.5 py-1.5',
                bid.yours && 'bg-brass-300/10',
              )}
            >
              <span
                className={cn(
                  'min-w-0 flex-1 truncate font-body text-[12px]',
                  bid.yours ? 'text-brass-100' : 'text-ink-200',
                )}
              >
                {bid.yours ? 'You' : bid.username}
              </span>
              <span className="shrink-0 font-display text-[13px] font-bold tabular-nums text-ink-100">
                {bid.amount.toLocaleString()}
              </span>
              <span className="w-10 shrink-0 text-right font-body text-[11px] tabular-nums text-ink-400">
                {formatClock(new Date(bid.at), zone)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The one control: a figure and a button, with the four quick raises a player uses instead of
 * typing. Floored at the lot's opening price rather than at the standing minimum, for the reason
 * the Bar gives: the minimum is a race and the server is the authority on whether a bid cleared it,
 * so a figure under it is warned about before the press and refused in the server's words after.
 */
export function LotBidPanel({
  auction,
  name,
  purse,
  currency,
  now,
  pending,
  error,
  shortMessage,
  onPlace,
}: {
  auction: LotAuction;
  name: string;
  /** What the crew has to spend. A bid it cannot cover is warned about here and refused there. */
  purse: number;
  currency: LotCurrency;
  /** The server's clock, ticking: whether the lot has closed is its call, never the browser's. */
  now: Date;
  pending: boolean;
  error: Error | null;
  /** What to say when the figure is past what the crew holds. Each counter names its own purse. */
  shortMessage: (purse: number) => string;
  onPlace: (amount: number) => void;
}) {
  const [amount, setAmount] = useState(auction.nextBid);
  // The floor follows the table: other crews are bidding into this lot under an open window.
  useEffect(() => {
    setAmount((current) => (current < auction.nextBid ? auction.nextBid : current));
  }, [auction.nextBid]);

  const closed = Date.parse(auction.closesAt) <= now.getTime();
  const leading = auction.leading?.yours === true;
  const refusal = closed
    ? 'It has been settled. Whoever was in front has it.'
    : leading
      ? 'You are already leading this lot.'
      : null;
  const short = amount > purse;
  const stepFrom = (value: number) => Math.max(1, nextLotBid(auction.reserve, value) - value);
  // Never past the field's own ceiling: a button that types a figure the field refuses is a
  // button that does nothing visible.
  const ceiling = Math.max(auction.nextBid, purse, auction.reserve);
  const raiseBy = (percent: number) => () =>
    setAmount((current) => Math.min(ceiling, Math.ceil(current * (1 + percent / 100))));

  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="lot-bid-panel">
      <span className="font-display text-[10px] font-bold uppercase tracking-[0.18em] text-brass-300">
        Your bid
      </span>
      <div className="flex min-w-0 items-center gap-2">
        <NumberField
          value={amount}
          onChange={setAmount}
          min={auction.reserve}
          max={ceiling}
          step={stepFrom(amount)}
          label={`Bid for ${name}`}
          disabled={refusal !== null}
          className="min-w-0 flex-1"
          data-testid="lot-amount"
        />
        <CurrencyIcon currency={currency} className="h-5 w-5 shrink-0" />
      </div>
      {/* Four quick raises; the "+ 1 step" button went at the maintainer's request (2026-09-11),
          the field's own arrows already step by the legal increment.

          The big two were added 2026-09-17 and they need no guard of their own. `raiseBy` clamps
          to `ceiling`, which is the crew's own purse once a lot is worth more than the opening
          price, so "+ 100%" on a lot a crew cannot double types what they have rather than a
          figure the field would refuse and the close could not collect. */}
      <div className="flex flex-wrap gap-1.5">
        {([5, 10, 50, 100] as const).map((percent) => (
          <Button
            key={percent}
            size="sm"
            variant="ghost"
            disabled={refusal !== null}
            onClick={raiseBy(percent)}
            data-testid={`lot-raise-${percent}`}
          >
            + {percent}%
          </Button>
        ))}
      </div>
      <Button
        disabled={refusal !== null || short || pending}
        onClick={() => onPlace(amount)}
        data-testid="lot-place"
      >
        {pending ? 'Saying it…' : 'Place bid'}
      </Button>
      {refusal !== null && (
        <p
          className="font-body text-[12px] leading-relaxed text-oxblood-300"
          data-testid="lot-refusal"
        >
          {refusal}
        </p>
      )}
      {refusal === null && short && (
        <p
          className="font-body text-[12px] leading-relaxed text-oxblood-300"
          data-testid="lot-refusal"
        >
          {shortMessage(purse)}
        </p>
      )}
      {refusal === null && !short && amount < auction.nextBid && (
        <p className="font-body text-[12px] leading-relaxed text-brass-100" data-testid="lot-under">
          {auction.leading === null
            ? `He will not take under ${auction.reserve.toLocaleString()}.`
            : `Somebody is at ${auction.leading.amount.toLocaleString()}. You need at least ${auction.nextBid.toLocaleString()}.`}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="font-body text-[12px] leading-relaxed text-oxblood-300">
          {error.message}
        </p>
      )}
    </div>
  );
}
