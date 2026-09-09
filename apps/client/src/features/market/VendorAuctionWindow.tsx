import {
  GAME_TIMEZONE,
  ITEM_CATALOG,
  ITEM_RARITY_LABELS,
  formatClock,
  nextLotBid,
  type ItemId,
  type VendorAuction,
  type VendorOffer,
} from '@frontline/shared';
import { useEffect, useState } from 'react';
import { ResourceIcon } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { Modal } from '../../components/ui/Modal';
import { NumberField } from '../../components/ui/NumberField';
import { cn } from '../../lib/cn';
import { useMe, usePlaceVendorBid } from '../../lib/queries';
import { countdownText, LAST_CALL_MS } from '../bar/AuctionParts';
import { ItemGlyph } from '../inventory/ItemGlyph';

/**
 * Bidding on a lot at the barrow (market extension, board 2026-09-08).
 *
 * The Bar's bidding screen with the sealed half hour taken out, because a visit is two hours and
 * a secret last number is a game for a day. One lot, drawn as a table: what it is down the left,
 * who is in front and for how much, how long until he packs up, every bid in the order it was
 * said, and one control. The window is opened from the lot's card, where the decision is made in
 * front of the figures; in here a player says a number.
 */
export function VendorAuctionWindow({
  offer,
  now,
  caps,
  onClose,
}: {
  offer: VendorOffer & { auction: VendorAuction };
  now: Date;
  /** What the crew has in the tin. A bid it cannot cover is warned about here and refused there. */
  caps: number;
  onClose: () => void;
}) {
  const me = useMe();
  const zone = me.data?.user.timezone ?? GAME_TIMEZONE;
  const spec = ITEM_CATALOG[offer.line.item as ItemId];
  const { auction } = offer;

  return (
    <Modal
      onClose={onClose}
      labelledBy="lot-title"
      size="wide"
      data-testid="lot-window"
      className="border-hextech-100/30"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-surface-600/60 px-5 py-3">
        <span
          aria-hidden
          className="holo-tag flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-hextech-100 [&_svg]:h-5 [&_svg]:w-5"
        >
          <Icon name="market" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[10px] font-bold uppercase tracking-[0.2em] text-ink-300">
            Lot on the barrow
          </span>
          <h2
            id="lot-title"
            className="neon min-w-0 break-words font-stamp text-[18px] leading-tight"
          >
            {spec.name}
          </h2>
        </span>
        <LotClock auction={auction} now={now} size="lg" testId="lot-clock" />
        <Button size="sm" variant="ghost" onClick={onClose}>
          Leave it
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-[minmax(0,1fr)_19rem]">
        <LotDossier offer={offer} />
        <div className="flex min-w-0 flex-col gap-3">
          <LotStanding auction={auction} />
          <LotBidPanel auction={auction} name={spec.name} caps={caps} now={now} />
          <LotHistory auction={auction} zone={zone} />
        </div>
      </div>
    </Modal>
  );
}

/** What the thing is, on the left: the art, the rarity, the line, and what the catalogue says it is worth. */
function LotDossier({ offer }: { offer: VendorOffer }) {
  const spec = ITEM_CATALOG[offer.line.item as ItemId];
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 gap-4">
        <span className="icon-tile edge-lit flex h-28 w-28 shrink-0 items-center justify-center rounded-md">
          <ItemGlyph id={spec.id} className="h-20 w-20" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="font-display text-[10px] font-bold uppercase tracking-[0.2em] text-brass-300">
            {ITEM_RARITY_LABELS[spec.rarity]}
          </span>
          <p className="font-body text-[14px] italic leading-relaxed text-ink-200">
            {spec.description}
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
            <dt>Worth</dt>
            <dd className="tabular-nums text-ink-100">{spec.capsValue.toLocaleString()} caps</dd>
            <dt>Left to sell</dt>
            <dd className="tabular-nums text-ink-100">
              {offer.line.stock} {offer.line.stock === 1 ? 'visit' : 'visits'}
            </dd>
          </dl>
        </div>
      </div>
      <p className="font-body text-[12px] leading-relaxed text-ink-300">
        One goes to the highest bid when he packs up, at what they bid. Every crew's bid is in the
        open; raising yours replaces it, and nothing comes off the table until he leaves.
      </p>
    </div>
  );
}

/** Where the reader stands on the open bids. */
type LotStandingWord = 'leading' | 'outbid' | 'out';

function standingOf(auction: VendorAuction): LotStandingWord {
  if (auction.leading?.yours === true) return 'leading';
  return auction.yourBid === null ? 'out' : 'outbid';
}

/** The figure the whole screen is about, and where the reader stands against it. */
function LotStanding({ auction }: { auction: VendorAuction }) {
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
        <ResourceIcon kind="caps" className="h-5 w-5" />
        <span
          className="font-display text-[34px] font-bold leading-none tabular-nums text-brass-100"
          data-testid="lot-leading"
        >
          {(auction.leading?.amount ?? auction.reserve).toLocaleString()}
        </span>
      </span>
      <span className="min-w-0 truncate font-body text-[12px] leading-snug text-ink-200">
        {auction.leading === null ? (
          <>Opens at {auction.reserve.toLocaleString()}. He will not take less.</>
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

/**
 * The clock on a lot: how long until he packs up, oxblood inside the last five minutes.
 *
 * `mm:ss` inside the hour, the game's two-unit duration above it, exactly as the Bar's clock
 * reads, because a player who has learned one countdown should not have to learn another.
 */
export function LotClock({
  auction,
  now,
  size = 'sm',
  testId,
}: {
  auction: VendorAuction;
  now: Date;
  size?: 'sm' | 'lg';
  testId?: string;
}) {
  const left = Date.parse(auction.closesAt) - now.getTime();
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
        {closed ? 'Packed up' : 'Packs up in'}
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

/** Every crew's standing bid on the lot, newest first: a raise replaces the crew's earlier row. */
function LotHistory({ auction, zone }: { auction: VendorAuction; zone: string }) {
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
 * The one control: a figure and a button, with the three quick steps a player uses instead of
 * typing. Floored at the lot's price rather than at the standing minimum, for the reason the Bar
 * gives: the minimum is a race and the server is the authority on whether a bid cleared it, so a
 * figure under it is warned about before the press and refused in the server's words after.
 */
function LotBidPanel({
  auction,
  name,
  caps,
  now,
}: {
  auction: VendorAuction;
  name: string;
  caps: number;
  /** The server's clock, ticking: whether he has packed up is its call, never the browser's. */
  now: Date;
}) {
  const bid = usePlaceVendorBid();
  const [amount, setAmount] = useState(auction.nextBid);
  // The floor follows the table: other crews are bidding into this lot under an open window.
  useEffect(() => {
    setAmount((current) => (current < auction.nextBid ? auction.nextBid : current));
  }, [auction.nextBid]);

  const closed = Date.parse(auction.closesAt) <= now.getTime();
  const leading = auction.leading?.yours === true;
  const refusal = closed
    ? 'He has packed up. Whoever was in front has it.'
    : leading
      ? 'You are already leading this lot.'
      : null;
  const short = amount > caps;
  const stepFrom = (value: number) => Math.max(1, nextLotBid(auction.reserve, value) - value);
  // Never past the field's own ceiling: a button that types a figure the field refuses is a
  // button that does nothing visible.
  const ceiling = Math.max(auction.nextBid, caps, auction.reserve);
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
        <ResourceIcon kind="caps" className="h-5 w-5 shrink-0" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          disabled={refusal !== null}
          onClick={() => setAmount((current) => current + stepFrom(current))}
          data-testid="lot-step"
        >
          + 1 step
        </Button>
        <Button size="sm" variant="ghost" disabled={refusal !== null} onClick={raiseBy(5)}>
          + 5%
        </Button>
        <Button size="sm" variant="ghost" disabled={refusal !== null} onClick={raiseBy(10)}>
          + 10%
        </Button>
      </div>
      <Button
        disabled={refusal !== null || short || bid.isPending}
        onClick={() => bid.mutate({ lineId: auction.lineId, amount })}
        data-testid="lot-place"
      >
        {bid.isPending ? 'Saying it…' : 'Place bid'}
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
          You have {caps.toLocaleString()} caps. He will want the whole figure when he packs up.
        </p>
      )}
      {refusal === null && !short && amount < auction.nextBid && (
        <p className="font-body text-[12px] leading-relaxed text-brass-100" data-testid="lot-under">
          {auction.leading === null
            ? `He will not take under ${auction.reserve.toLocaleString()}.`
            : `Somebody is at ${auction.leading.amount.toLocaleString()}. You need at least ${auction.nextBid.toLocaleString()}.`}
        </p>
      )}
      {bid.error !== null && (
        <p role="alert" className="font-body text-[12px] leading-relaxed text-oxblood-300">
          {bid.error.message}
        </p>
      )}
    </div>
  );
}
