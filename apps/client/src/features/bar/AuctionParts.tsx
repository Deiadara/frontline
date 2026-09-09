import { auctionPhaseAt, type AuctionPhase, type BarAuction } from '@frontline/shared';
import { Icon } from '../../components/ui/Icon';
import { cn } from '../../lib/cn';
import { formatRemaining } from '../base/format';

/**
 * The pieces every part of the Bar's auction draws: the phase, the clock and where the reader
 * stands. Shared between the roster card's strip, the tables chip on the room, and the bid window,
 * because those three saying different things about the same table is the whole defect class here.
 */

/** Inside this much of the deadline the clock turns. Five minutes, on both boundaries. */
export const LAST_CALL_MS = 5 * 60_000;

const HOUR_MS = 60 * 60_000;

/**
 * The phase, derived from the server's own two timestamps rather than read off `phase`.
 *
 * The wire carries `phase` as well, and it is the same answer: this runs `auctionPhaseAt`, the
 * function the settle uses, against `sealedFrom` and `closesAt`, which are the server's. The
 * difference is that this one is live. `phase` is a snapshot of the moment the response was
 * built, and the Bar polls every ten seconds, so a table read off that field goes on taking open
 * bids for up to ten seconds after it has sealed, with its own countdown sitting at 00:00.
 */
export function phaseOf(auction: BarAuction, now: Date): AuctionPhase {
  // `day` is on `AuctionWindow` for the settle, which is server work. Only the two boundaries are
  // read here, and they come from the response.
  return auctionPhaseAt(now, {
    day: '',
    sealedFrom: new Date(auction.sealedFrom),
    closesAt: new Date(auction.closesAt),
  });
}

/** What the clock on a table is counting down to, in this phase. */
export function deadlineOf(auction: BarAuction, phase: AuctionPhase): number {
  return Date.parse(phase === 'open' ? auction.sealedFrom : auction.closesAt);
}

/**
 * A countdown, in the two forms this screen needs.
 *
 * `mm:ss` once the deadline is inside the hour, which is the form the last half hour is read in
 * and the only one where a second matters. Above that it is the game's ordinary two-unit
 * duration: `5h 30m` counting down a second at a time would be a digit nobody can see change.
 */
export function countdownText(ms: number): string {
  const left = Math.max(0, ms);
  if (left >= HOUR_MS) return formatRemaining(left);
  const seconds = Math.ceil(left / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

const PHASE_WORD: Record<AuctionPhase, string> = {
  open: 'Open',
  sealed: 'Sealed: final values only',
  closed: 'Closed',
};

const PHASE_FACE: Record<AuctionPhase, string> = {
  open: 'border-verdigris-300/50 bg-verdigris-300/10 text-verdigris-100',
  sealed: 'border-brass-300/60 bg-brass-300/10 text-brass-100',
  closed: 'border-surface-500 bg-surface-900/80 text-ink-300',
};

export function PhaseBadge({ phase }: { phase: AuctionPhase }) {
  return (
    <span
      data-testid="auction-phase"
      data-phase={phase}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-sm border px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-[0.14em]',
        PHASE_FACE[phase],
      )}
    >
      {phase === 'sealed' && <Icon name="lock" aria-hidden className="h-3 w-3 shrink-0" />}
      {PHASE_WORD[phase]}
    </span>
  );
}

/** What the clock is called, which is a different deadline in each phase. */
const CLOCK_LABEL: Record<AuctionPhase, string> = {
  open: 'Sealed bidding in',
  sealed: 'Signs in',
  closed: 'Closed',
};

/**
 * The clock on a table.
 *
 * Oxblood inside the last five minutes of whichever deadline it is counting to, so the two moments
 * that change what a player can do, the open phase ending and the table signing, announce
 * themselves rather than being read off the digits.
 */
export function AuctionClock({
  auction,
  now,
  size = 'sm',
  testId,
}: {
  auction: BarAuction;
  now: Date;
  size?: 'sm' | 'lg';
  testId?: string;
}) {
  const phase = phaseOf(auction, now);
  const left = deadlineOf(auction, phase) - now.getTime();
  const lastCall = phase !== 'closed' && left <= LAST_CALL_MS;
  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5 rounded-sm border px-2 py-1',
        lastCall
          ? 'border-oxblood-300/60 bg-oxblood-500/10'
          : 'border-surface-600/80 bg-surface-950/50',
      )}
      data-testid={testId}
    >
      <Icon
        name="clock"
        aria-hidden
        className={cn('h-3.5 w-3.5 shrink-0', lastCall ? 'text-oxblood-300' : 'text-brass-300')}
      />
      <span className="font-display text-[10px] uppercase tracking-[0.14em] text-ink-300">
        {CLOCK_LABEL[phase]}
      </span>
      {phase !== 'closed' && (
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

/** Where the reader stands on the open bids. Their sealed value is a separate mark: see below. */
export type Standing = 'leading' | 'outbid' | 'out';

export function standingOf(auction: BarAuction): Standing {
  if (auction.leading?.yours === true) return 'leading';
  return auction.yourBid === null ? 'out' : 'outbid';
}

const STANDING_FACE: Record<Exclude<Standing, 'out'>, string> = {
  leading: 'border-verdigris-300/60 bg-verdigris-300/10 text-verdigris-100',
  outbid: 'border-oxblood-300/60 bg-oxblood-500/15 text-oxblood-100',
};

/** `Leading` / `Outbid`, and nothing at all for a table the reader has not bid on. */
export function StandingChip({ standing }: { standing: Standing }) {
  if (standing === 'out') return null;
  return (
    <span
      data-testid={`standing-${standing}`}
      className={cn(
        'inline-flex shrink-0 items-center rounded-sm border px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-[0.14em]',
        STANDING_FACE[standing],
      )}
    >
      {standing === 'leading' ? 'Leading' : 'Outbid'}
    </span>
  );
}

/** The reader's locked final value. Only ever theirs, and only after they have locked one. */
export function LockedChip({ amount }: { amount: number }) {
  return (
    <span
      data-testid="locked-chip"
      className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-brass-300/60 bg-brass-300/10 px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-[0.14em] text-brass-100"
    >
      <Icon name="lock" aria-hidden className="h-3 w-3 shrink-0" />
      Locked {amount.toLocaleString()}
    </span>
  );
}

/** Who is in front, in words, wherever the figure itself is drawn separately. */
export function leaderName(auction: BarAuction): string {
  if (auction.leading === null) return 'Nobody has bid';
  return auction.leading.yours ? 'You' : auction.leading.username;
}
