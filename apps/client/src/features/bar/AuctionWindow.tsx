import {
  GAME_TIMEZONE,
  formatClock,
  nextMinimumBid,
  notorietyTier,
  officerPortraitId,
  type BarAuction,
  type BarRecruit,
  type JoinBlocker,
} from '@frontline/shared';
import { useEffect, useState } from 'react';
import { AttributeSheet } from '../overseer/AttributeSheet';
import { Button } from '../../components/ui/Button';
import { Confirm } from '../../components/ui/Confirm';
import { Icon } from '../../components/ui/Icon';
import { Modal } from '../../components/ui/Modal';
import { NumberField } from '../../components/ui/NumberField';
import { OfficerPortrait } from '../overseer/OfficerPortrait';
import { PerkTags } from '../../components/PerkTags';
import { cn } from '../../lib/cn';
import { useMe, usePlaceBid, useSealBid } from '../../lib/queries';
import { AuctionClock, PhaseBadge, leaderName, phaseOf, standingOf } from './AuctionParts';

/** §H3, in the player's own accent. The same two doors the roster card reads. */
const BLOCKER_LABEL: Record<JoinBlocker, string> = {
  notoriety: 'Your name is not big enough',
  level: 'Wants a crew that has been doing this longer',
};

/**
 * The bidding screen (§H7).
 *
 * One table, drawn as a table: who is in front and for how much, how long is left, every open bid
 * in the order they were made, and the one control that changes any of it. The room behind it is a
 * roster of eight people and this is the screen where a player decides what one of them is worth,
 * so it gets the person's whole record down the left rather than a name and a number.
 *
 * The two phases are two different screens inside the same frame, and deliberately so: in the open
 * phase the controls are a bid against a figure everybody can see, and in the last half hour they
 * are one irreversible value nobody can see. Leaving the open controls drawn but dead through the
 * sealed phase would say the second thing is a variation on the first, and it is not.
 */
export function AuctionWindow({
  recruit,
  auction,
  now,
  bidCeiling,
  auctionsUsed,
  auctionsAllowed,
  chairsFree,
  onClose,
}: {
  recruit: BarRecruit;
  auction: BarAuction;
  now: Date;
  /** The most this crew can put on a table: the book after its own negotiators (`bidCeiling`). */
  bidCeiling: number;
  auctionsUsed: number;
  auctionsAllowed: number;
  /** Chairs left on the books. A win with none free passes to the next crew at the close. */
  chairsFree: number;
  onClose: () => void;
}) {
  // Bid times are printed on the player's own clock, never the wire's UTC.
  const me = useMe();
  const zone = me.data?.user.timezone ?? GAME_TIMEZONE;
  const phase = phaseOf(auction, now);
  const standing = standingOf(auction);
  const inThisOne = auction.yourBid !== null || auction.yourSealed !== null;

  return (
    <Modal
      onClose={onClose}
      labelledBy="auction-title"
      size="wide"
      data-testid="auction-window"
      className="border-brass-300/30"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-surface-600/60 px-5 py-3">
        <span
          aria-hidden
          className="icon-plate flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-brass-300 [&_svg]:h-5 [&_svg]:w-5"
        >
          <Icon name="caps" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[10px] font-bold uppercase tracking-[0.2em] text-ink-300">
            Bidding for
          </span>
          <h2
            id="auction-title"
            className="min-w-0 break-words font-stamp text-[18px] leading-tight text-ink-100"
          >
            {recruit.name}
          </h2>
        </span>
        <PhaseBadge phase={phase} />
        <Button size="sm" variant="ghost" onClick={onClose}>
          Leave it
        </Button>
      </header>

      {/*
       * The scroller is the two columns together, not each of them.
       *
       * At 1024x768 the person's record is taller than the frame and the bid panel is not, so two
       * independent scrollers put the controls at the top of a short column with a long empty
       * space under them and the sheet scrolling beside it. One scroller keeps the window reading
       * as one screen.
       */}
      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-[minmax(0,1fr)_19rem]">
        <Dossier recruit={recruit} />
        <div className="flex min-w-0 flex-col gap-3">
          <Standing auction={auction} now={now} />
          <BidPanel
            recruit={recruit}
            auction={auction}
            phase={phase}
            standing={standing}
            inThisOne={inThisOne}
            bidCeiling={bidCeiling}
            auctionsUsed={auctionsUsed}
            auctionsAllowed={auctionsAllowed}
            chairsFree={chairsFree}
          />
          <BidHistory auction={auction} zone={zone} />
        </div>
      </div>
    </Modal>
  );
}

/** Who this is, on the left: the face, what they bring, and the two §H3 doors. */
function Dossier({ recruit }: { recruit: BarRecruit }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 gap-3">
        <div className="edge-lit w-28 shrink-0 rounded-sm border-2 border-brass-500/45 bg-surface-950 p-1 shadow-panel">
          <OfficerPortrait
            portraitId={officerPortraitId(recruit.id)}
            name={recruit.name}
            className="w-full rounded-[2px] border border-surface-950/80"
            style={{ aspectRatio: '4 / 5' }}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="font-display text-[9.5px] font-bold uppercase tracking-[0.2em] text-ink-300">
            What they bring
          </span>
          {recruit.perks.length > 0 ? (
            <PerkTags perks={recruit.perks} tone="panel" />
          ) : (
            <p className="font-body text-[12px] italic leading-snug text-ink-400">
              Nothing but the sheet. Some of the best of them are.
            </p>
          )}
          {!recruit.assessment.interested && (
            <ul className="flex min-w-0 flex-col gap-1" data-testid="auction-blockers">
              {recruit.assessment.blockers.map((blocker) => (
                <li
                  key={blocker}
                  className="flex items-start gap-1.5 font-display text-[10px] uppercase leading-snug tracking-[0.14em] text-oxblood-300/90"
                >
                  <Icon name="lock" className="mt-px h-3 w-3 shrink-0" />
                  {BLOCKER_LABEL[blocker]}
                </li>
              ))}
            </ul>
          )}
          {(recruit.requirement.minNotoriety > 0 || recruit.requirement.minLevel > 1) && (
            <div className="flex min-w-0 flex-col gap-1 border-l-2 border-surface-600 pl-2.5">
              {recruit.requirement.minNotoriety > 0 && (
                <p className="min-w-0 break-words font-display text-[10px] uppercase leading-snug tracking-[0.14em] text-ink-300">
                  Signs with a crew the street calls{' '}
                  <span className="text-ink-100">
                    {notorietyTier(recruit.requirement.minNotoriety)}
                  </span>
                </p>
              )}
              {recruit.requirement.minLevel > 1 && (
                <p className="min-w-0 break-words font-display text-[10px] uppercase leading-snug tracking-[0.14em] text-ink-300">
                  And one that has reached{' '}
                  <span className="text-ink-100">level {recruit.requirement.minLevel}</span>
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <span className="shrink-0 font-display text-[11px] font-bold uppercase tracking-[0.2em] text-brass-300">
          What they can do
        </span>
        <span aria-hidden className="ink-rule block min-w-0 flex-1" />
      </div>
      <AttributeSheet attributes={recruit.attributes} columns={2} />
    </div>
  );
}

/** The figure the whole screen is about, and where the reader stands against it. */
function Standing({ auction, now }: { auction: BarAuction; now: Date }) {
  const standing = standingOf(auction);
  const word =
    auction.leading === null
      ? 'Nobody has bid'
      : standing === 'leading'
        ? 'You are leading'
        : 'You have been outbid';
  return (
    <div
      className={cn(
        'edge-lit flex flex-col gap-2 rounded-sm border bg-surface-950/50 p-3',
        standing === 'leading'
          ? 'border-verdigris-300/50'
          : standing === 'outbid'
            ? 'border-oxblood-300/50'
            : 'border-surface-600',
      )}
      data-testid="auction-standing"
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
        <span
          className="font-display text-[34px] font-bold leading-none tabular-nums text-brass-100"
          data-testid="leading-bid"
        >
          {(auction.leading?.amount ?? auction.reserve).toLocaleString()}
        </span>
        <span className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
          caps / wk
        </span>
      </span>
      <span className="min-w-0 truncate font-body text-[12px] leading-snug text-ink-200">
        {auction.leading === null ? (
          <>Opens at {auction.reserve.toLocaleString()}, which is their floor.</>
        ) : (
          <>
            Held by <span className="text-ink-100">{leaderName(auction)}</span> ·{' '}
            {auction.bidders.toLocaleString()}{' '}
            {auction.bidders === 1 ? 'crew is in' : 'crews are in'}
          </>
        )}
      </span>
      <AuctionClock auction={auction} now={now} size="lg" testId="auction-clock" />
    </div>
  );
}

/** Every open bid on the table, newest first. Sealed values are never here: that is the point. */
function BidHistory({ auction, zone }: { auction: BarAuction; zone: string }) {
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
        <ul className="flex flex-col divide-y divide-surface-800" data-testid="bid-history">
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
 * The controls, which are a different pair of controls in each phase.
 *
 * Open: a figure and a button, with the three quick steps a player actually uses instead of typing
 * (the increment, five percent, ten). Sealed: one value, one press, and a confirmation, because it
 * cannot be taken back. Closed: nothing, and a line saying so.
 */
function BidPanel({
  recruit,
  auction,
  phase,
  standing,
  inThisOne,
  bidCeiling,
  auctionsUsed,
  auctionsAllowed,
  chairsFree,
}: {
  recruit: BarRecruit;
  auction: BarAuction;
  phase: ReturnType<typeof phaseOf>;
  standing: ReturnType<typeof standingOf>;
  inThisOne: boolean;
  bidCeiling: number;
  auctionsUsed: number;
  auctionsAllowed: number;
  chairsFree: number;
}) {
  const bid = usePlaceBid();
  const seal = useSealBid();

  const [amount, setAmount] = useState(auction.nextBid);
  /*
   * The floor follows the table.
   *
   * Other crews are bidding into this while it is open, so the minimum moves under an open window.
   * A field left sitting below it is not an offer, it is a refusal the player has to be told about
   * after pressing the button; carrying it up with the floor says the same thing before.
   */
  useEffect(() => {
    setAmount((current) => (current < auction.nextBid ? auction.nextBid : current));
  }, [auction.nextBid]);

  /** §H7: a sealed value below any of these cannot win, so it is refused before it is locked. */
  const sealFloor = Math.max(auction.reserve, auction.yourBid ?? 0, auction.leading?.amount ?? 0);
  const [sealAmount, setSealAmount] = useState(sealFloor);
  useEffect(() => {
    setSealAmount((current) => (current < sealFloor ? sealFloor : current));
  }, [sealFloor]);
  const [confirming, setConfirming] = useState(false);

  const atCap = !inThisOne && auctionsUsed >= auctionsAllowed;
  const headroom = bidCeiling;

  /*
   * Why the button is dead, in the order a player would ask it.
   *
   * Only the first is shown. Four reasons stacked under one button is a wall, and they are not
   * independent: a crew at its table cap is not also being told their payroll is short on a table
   * they cannot enter anyway.
   */
  const shut = !recruit.assessment.interested
    ? 'They will not sit down with your crew. Nothing you bid changes that.'
    : chairsFree <= 0
      ? 'Your books are full. Let somebody go before you bid on anybody.'
      : atCap
        ? `You are at ${auctionsAllowed} tables already. Let one close first.`
        : null;
  // A win the crew cannot seat passes to the next final at the close. Said before the bid, not
  // after midnight: two tables and one chair is a choice, and it should be made on purpose.
  const tables = auctionsUsed + (inThisOne ? 0 : 1);
  const overChairs = shut === null && chairsFree < tables;
  /*
   * Leading stops an open bid and nothing else.
   *
   * Nobody can outbid themselves, so the open controls go out while this crew is in front. A
   * sealed value is a different number for a different moment: the crew leading the open bids at
   * the seal is exactly the crew that most needs to decide how far they will really go, and a lock
   * panel greyed out because they are winning would be the screen refusing the one decision the
   * last half hour exists for.
   */
  const refusal = shut ?? (standing === 'leading' ? 'You are already leading this table.' : null);

  const overBook = amount > headroom;
  const sealOverBook = sealAmount > headroom;
  const error = bid.error?.message ?? seal.error?.message ?? null;

  /** The increment from wherever the field currently stands, so `+1 step` is the legal next number. */
  const stepFrom = (value: number) => Math.max(1, nextMinimumBid(auction.reserve, value) - value);
  const raiseBy = (percent: number) => () =>
    setAmount((current) => Math.ceil(current * (1 + percent / 100)));

  return (
    <div className="flex min-w-0 flex-col gap-2.5" data-testid="bid-panel">
      <Headroom headroom={headroom} used={auctionsUsed} allowed={auctionsAllowed} />
      {overChairs && (
        <p
          className="font-body text-[12px] leading-relaxed text-brass-100"
          data-testid="chairs-warning"
        >
          {chairsFree === 1 ? 'One chair' : `${chairsFree} chairs`} free for {tables} tables. A win
          you cannot seat passes to the next crew.
        </p>
      )}

      {phase === 'open' && (
        <div className="flex min-w-0 flex-col gap-2">
          <span className="font-display text-[10px] font-bold uppercase tracking-[0.18em] text-brass-300">
            Your bid
          </span>
          <div className="flex min-w-0 items-center gap-2">
            {/*
             * Floored at the person's reserve, not at the standing minimum.
             *
             * The minimum is a race. Other crews are bidding into this table and the screen is
             * ten seconds old at worst, so a field that refused to hold anything under the
             * `nextBid` it was drawn with would be enforcing a number that has already moved, and
             * the one authority on whether a bid cleared the leader is the server. The floor that
             * *is* a fact is the reserve: the person will not go under it. Everything between the
             * two is warned about on the line below and still sent.
             */}
            <NumberField
              value={amount}
              onChange={setAmount}
              min={auction.reserve}
              max={Math.max(auction.nextBid, headroom)}
              step={stepFrom(amount)}
              label={`Bid for ${recruit.name}`}
              disabled={refusal !== null}
              className="min-w-0 flex-1"
              data-testid="bid-amount"
            />
            <span className="shrink-0 font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
              / wk
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              disabled={refusal !== null}
              onClick={() => setAmount((current) => current + stepFrom(current))}
              data-testid="bid-step"
            >
              + 1 step
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={refusal !== null}
              onClick={raiseBy(5)}
              data-testid="bid-plus-5"
            >
              + 5%
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={refusal !== null}
              onClick={raiseBy(10)}
              data-testid="bid-plus-10"
            >
              + 10%
            </Button>
          </div>
          <Button
            disabled={refusal !== null || overBook || bid.isPending}
            onClick={() => bid.mutate({ recruitId: auction.recruitId, amount })}
            data-testid="place-bid"
          >
            {bid.isPending ? 'Saying it…' : `Place bid`}
          </Button>
          {refusal !== null && (
            <p
              className="font-body text-[12px] leading-relaxed text-oxblood-300"
              data-testid="bid-refusal"
            >
              {refusal}
            </p>
          )}
          {refusal === null && overBook && (
            <p
              className="font-body text-[12px] leading-relaxed text-oxblood-300"
              data-testid="bid-refusal"
            >
              Your book holds up to {headroom.toLocaleString()} a week. Raise it at the Nexus.
            </p>
          )}
          {refusal === null && !overBook && amount < auction.nextBid && (
            <p
              className="font-body text-[12px] leading-relaxed text-brass-100"
              data-testid="bid-under"
            >
              {auction.leading === null
                ? `They will not go under ${auction.reserve.toLocaleString()}.`
                : `Somebody is at ${auction.leading.amount.toLocaleString()}. You need at least ${auction.nextBid.toLocaleString()}.`}
            </p>
          )}
        </div>
      )}

      {phase === 'sealed' &&
        (auction.yourSealed !== null ? (
          <div
            className="edge-lit flex flex-col gap-1.5 rounded-sm border border-brass-300/60 bg-brass-300/5 p-3"
            data-testid="sealed-card"
          >
            <span className="flex items-center gap-1.5 font-display text-[10px] font-bold uppercase tracking-[0.18em] text-brass-300">
              <Icon name="lock" aria-hidden className="h-3.5 w-3.5" />
              Locked
            </span>
            <span className="font-display text-[26px] font-bold leading-none tabular-nums text-brass-100">
              {auction.yourSealed.toLocaleString()}
            </span>
            <p className="font-body text-[12px] leading-relaxed text-ink-200">
              Revealed at midnight. Nobody sees it before then, and it cannot be changed.
            </p>
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-2" data-testid="lock-panel">
            <span className="font-display text-[10px] font-bold uppercase tracking-[0.18em] text-brass-300">
              Your final value
            </span>
            <p className="font-body text-[12px] leading-relaxed text-ink-200">
              One number, locked, revealed at midnight. It cannot be raised afterwards and it cannot
              be taken back.
            </p>
            <div className="flex min-w-0 items-center gap-2">
              <NumberField
                value={sealAmount}
                onChange={setSealAmount}
                min={sealFloor}
                max={Math.max(sealFloor, headroom)}
                step={stepFrom(sealAmount)}
                label={`Final value for ${recruit.name}`}
                disabled={shut !== null}
                className="min-w-0 flex-1"
                data-testid="seal-amount"
              />
              <span className="shrink-0 font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
                / wk
              </span>
            </div>
            <Button
              disabled={shut !== null || sealOverBook || seal.isPending}
              onClick={() => setConfirming(true)}
              data-testid="lock-final"
            >
              {seal.isPending ? 'Locking…' : 'Lock final value'}
            </Button>
            {shut !== null && (
              <p
                className="font-body text-[12px] leading-relaxed text-oxblood-300"
                data-testid="bid-refusal"
              >
                {shut}
              </p>
            )}
            {shut === null && sealOverBook && (
              <p
                className="font-body text-[12px] leading-relaxed text-oxblood-300"
                data-testid="bid-refusal"
              >
                Your book holds up to {headroom.toLocaleString()} a week. Raise it at the Nexus.
              </p>
            )}
          </div>
        ))}

      {phase === 'closed' && (
        <p
          className="font-body text-[13px] leading-relaxed text-ink-200"
          data-testid="auction-closed"
        >
          The table has closed. Who signed, and for how much, arrives with tomorrow's room.
        </p>
      )}

      {error !== null && (
        <p role="alert" className="font-body text-[12px] leading-relaxed text-oxblood-300">
          {error}
        </p>
      )}

      {confirming && (
        <Confirm
          title="Lock this in?"
          body={`${sealAmount.toLocaleString()} caps a week, sealed until midnight. You get one final value on this table and this is it: it cannot be changed, raised or withdrawn.`}
          confirm="Lock it"
          testId="confirm-seal"
          onConfirm={() => {
            setConfirming(false);
            seal.mutate({ recruitId: auction.recruitId, amount: sealAmount });
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

/**
 * §H7 and the table cap, side by side above the controls.
 *
 * The payroll is here rather than a click away because it is the number that decides whether a bid
 * can be honoured at midnight, and a player who finds that out from a refusal has already spent the
 * table on it.
 */
function Headroom({
  headroom,
  used,
  allowed,
}: {
  headroom: number;
  used: number;
  allowed: number;
}) {
  return (
    <div className="flex min-w-0 items-stretch divide-x divide-surface-700 rounded-sm border border-surface-700 bg-surface-950/40">
      <span className="flex min-w-0 flex-1 flex-col gap-1 px-2.5 py-1.5">
        <span className="font-display text-[9.5px] font-bold uppercase tracking-[0.16em] text-ink-300">
          Bid up to
        </span>
        <span
          className="font-display text-[15px] font-bold tabular-nums text-brass-100"
          data-testid="bid-headroom"
        >
          {headroom.toLocaleString()}
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1 px-2.5 py-1.5">
        <span className="font-display text-[9.5px] font-bold uppercase tracking-[0.16em] text-ink-300">
          Your tables
        </span>
        <span
          className={cn(
            'font-display text-[15px] font-bold tabular-nums',
            used >= allowed ? 'text-warning' : 'text-ink-100',
          )}
        >
          {used} / {allowed}
        </span>
      </span>
    </div>
  );
}
