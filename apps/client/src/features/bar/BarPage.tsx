import {
  type LevelUp,
  BENCH_LABEL,
  type PayrollLedger,
  OFFICER_ROLE_LABELS,
  OFFICER_ROLES,
  notorietyTier,
  officerPortraitId,
  plateAspect,
  type BarAuction,
  type BarAuctionResult,
  type BarOfficer,
  type BarRecruit,
  type JoinBlocker,
  type OfficerRole,
} from '@frontline/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AttributeSheet } from '../overseer/AttributeSheet';
import { LevelUpBanner } from '../../components/LevelUp';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { LoadFailure } from '../../components/ui/LoadFailure';
import { Modal } from '../../components/ui/Modal';
import { Dropdown } from '../../components/ui/Dropdown';
import { OfficerPortrait } from '../overseer/OfficerPortrait';
import { StepArrow } from '../../components/ui/StepArrow';
import { cn } from '../../lib/cn';
import { useBar, useIncreasePayroll, useReleaseOfficer } from '../../lib/queries';
import { InfoNote } from '../game/PageShell';
import { OnArt, OnPlate, PlateRoom } from '../game/PlateRoom';
import { useServerClock } from '../missions/useServerClock';
import { AuctionWindow } from './AuctionWindow';
import {
  AuctionClock,
  LAST_CALL_MS,
  LockedChip,
  PhaseBadge,
  StandingChip,
  countdownText,
  deadlineOf,
  leaderName,
  phaseOf,
  standingOf,
} from './AuctionParts';
import { PerkTags } from '../../components/PerkTags';
import { PayrollMeter, RaisePayroll } from '../../components/Payroll';

/** Devotion reads in the player's own accent; a walkout reads as a warning. */
const BLOCKER_LABEL: Record<JoinBlocker, string> = {
  notoriety: 'Your name is not big enough',
  level: 'Wants a crew that has been doing this longer',
};

/** A labelled block on the seat screen's identity band: the word above, the thing below. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="font-display text-[9.5px] font-bold uppercase tracking-[0.2em] text-ink-300">
        {label}
      </span>
      {children}
    </div>
  );
}

interface RecruitCardProps {
  recruit: BarRecruit;
  /** §H7: this person's table, as this reader sees it. */
  auction: BarAuction | undefined;
  filledRoles: readonly OfficerRole[];
  /** The server's clock, so every countdown runs against the one that enforces the deadline. */
  now: Date;
  /**
   * §C2: which chair to read this person's sheet against, if the player has picked one.
   *
   * Lives on the seat screen rather than on the card, so it survives stepping to the next person:
   * the question a player is asking is "who here fits the Head Spy's chair", and having to
   * re-choose the chair for every candidate is the screen answering a different question.
   */
  highlightRole: OfficerRole | null;
  onHighlightRole: (role: OfficerRole | null) => void;
  onBid: (recruitId: string) => void;
}

/**
 * Where `Sit down` stands, in fractions of the painting.
 *
 * **The gap between the counter and the seat, not the seat itself.** The empty stool is the thing
 * the control is about, so covering it with the control is the one placement that cannot be right:
 * a player looking for the free seat finds a plaque where it should be.
 *
 * Measured off the delivered plate rather than guessed. On the current 1926×817 room the counter's
 * underside runs at 55.7% of the painting's height and the stool's cushion starts at 64.3%, and the
 * stool stands at 50.2% across rather than dead centre.
 *
 * Anchored by its **bottom edge** at the top of the cushion, not centred in the gap between the
 * two. Centring only keeps the seat clear while the plaque is shorter than the gap, so it is a
 * placement that silently starts covering the thing it is about the day somebody adds a line to
 * the button. Hung from the cushion, the plaque grows upward onto the blank panel under the
 * counter, which has nothing on it to cover.
 *
 * Fractions of the *image*, not of the frame, which is why `PlateRoom` draws the picture whole and
 * the button lives inside that box: a percentage of the viewport would slide off the stool the
 * moment somebody resized a window.
 */
const STOOL = { x: 0.502, y: 0.638 } as const;

/**
 * The plate's own shape. Used to size the box the stool is positioned in.
 *
 * Read off `plate-bar`'s delivery in the manifest rather than restated, because these two numbers
 * disagreeing is not a visual bug with a symptom: the painting is drawn at one shape and the stool
 * is placed at another, so the plaque slides off the seat by an amount that depends on the window.
 */
const BAR_ASPECT = plateAspect('bar');

export function BarPage() {
  const barQuery = useBar();
  /** Which screen is over the room: the stool, the book, the crew, the results, or none of them. */
  const [open, setOpen] = useState<'stool' | 'payroll' | 'crew' | 'results' | null>(null);
  /** Which chair the stool screen is showing. An index, so the arrows are arithmetic. */
  const [seat, setSeat] = useState(0);
  /** §H7: which table's bidding screen is open, if any. */
  const [biddingOn, setBiddingOn] = useState<string | null>(null);
  /*
   * §I1: the Bar settles yesterday's tables on read, and a signing pays, so the read that runs
   * the settle is the only one that ever knows a level was crossed. Latched, because the next
   * `/bar` poll carries nothing about it: an announcement nobody catches has no second chance.
   */
  const [levelUp, setLevelUp] = useState<LevelUp | null>(null);
  const announced = barQuery.data?.levelUp;
  useEffect(() => {
    if (announced) setLevelUp(announced);
  }, [announced]);

  const data = barQuery.data;
  const recruits = data?.recruits ?? [];
  const officers = data?.officers ?? [];
  const auctions = data?.auctions ?? [];
  const results = data?.results ?? [];
  const full = data !== undefined && data.slotsUsed >= data.slotsTotal;

  // Derived once here rather than per card: the bidding window needs the same list, and two
  // derivations of "which roles are open" is how a window offers a seat the card says is taken.
  const filledRoles = data?.filledRoles ?? [];

  /*
   * The auctions are sent in roster order, so the pairing is by index in principle and by id in
   * fact. By id, because "in roster order" is a promise about two arrays staying in step, and a
   * screen that reads a wage off the wrong person because one of them was filtered is a defect
   * nothing on the page can show.
   */
  const auctionFor = (recruitId: string): BarAuction | undefined =>
    auctions.find((auction) => auction.recruitId === recruitId);

  /** The tables this crew has money on, in roster order, which is the order the room is read in. */
  const yourTables = auctions.filter(
    (auction) => auction.yourBid !== null || auction.yourSealed !== null,
  );

  /*
   * The server's clock, and it has to *tick*.
   *
   * Every deadline on this screen belongs to the server: when the open phase ends, when the table
   * signs. `useServerClock` corrects for a skewed browser clock and adds the second hand, so a
   * countdown on a page nobody is touching is still the real remaining time.
   */
  const serverNow = useServerClock(data?.serverNow, barQuery.dataUpdatedAt);

  // Clamped rather than wrapped on read: the roster can shrink under an open screen when the room
  // turns over, and an index past the end would render nothing with no way back.
  const chair = recruits.length === 0 ? 0 : Math.min(seat, recruits.length - 1);
  const shown = recruits[chair];
  /*
   * Stops at both ends. It used to wrap, and wrapping is wrong for this screen: the roster is a
   * row of people sitting along a bar, not a carousel, and a player who has read to the end of it
   * and pressed on once more should be told they are at the end rather than be put back in front
   * of the first person as though they had missed them. The arrows go dead there to say so.
   */
  const step = (by: number) =>
    setSeat((current) => {
      if (recruits.length === 0) return 0;
      const from = Math.min(current, recruits.length - 1);
      return Math.max(0, Math.min(recruits.length - 1, from + by));
    });

  const bidding = recruits.find((recruit) => recruit.id === biddingOn);
  const biddingTable = biddingOn === null ? undefined : auctionFor(biddingOn);

  /*
   * A failed read used to draw the room as an empty one.
   *
   * `barQuery.isError` was consulted nowhere: after the retries were spent, `isLoading` was false
   * and `data` undefined, so the plaque read "Nobody in tonight", the stool was dead and the two
   * readouts showed a crew of 0 on a payroll of 0. Every one of those is a game state a player can
   * really be in, so nothing on the screen said the request had failed. That is worse than a stuck
   * spinner: it is a confident lie in the game's own voice.
   */
  if (data === undefined && barQuery.isError) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <LoadFailure
          what="The Bar"
          onRetry={() => void barQuery.refetch()}
          detail="Nothing has been lost. Whoever is in tonight is still in tonight."
        />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      {/*
       * The room, full bleed, the way the district is its own screen rather than a picture on one.
       *
       * The chrome floats over it: the painting runs under the standing bar and the nav, and the
       * three controls on it are positioned against the *painting* rather than against the sheet.
       */}
      <PlateRoom plate="bar" aspect={BAR_ASPECT} fit="whole" testId="bar-room">
        {/* The seat. `anchor="bottom"` is what makes the placement above mean anything: it hangs
            the plaque *from* the top of the cushion rather than centring it on that line. */}
        <OnPlate at={STOOL} anchor="bottom">
          <SitDown
            count={recruits.length}
            disabled={barQuery.isLoading || recruits.length === 0}
            onOpen={() => setOpen('stool')}
          />
        </OnPlate>
      </PlateRoom>

      {levelUp && (
        <div
          className="pointer-events-none absolute inset-x-0 z-20 flex justify-center px-4 pt-3"
          style={{ top: 'var(--hud-h, 0px)' }}
        >
          <div className="pointer-events-auto flex w-full max-w-2xl flex-col gap-2">
            <LevelUpBanner levelUp={levelUp} />
            <button
              type="button"
              onClick={() => setLevelUp(null)}
              className="self-end font-display text-[11px] uppercase tracking-[0.18em] text-ink-300 hover:text-ink-200"
            >
              Noted
            </button>
          </div>
        </div>
      )}

      {/* The standing readouts, on the glass over the room. */}
      {/* The same inset the room takes, or they sit under the nav: this layer is over the whole
          viewport, and the chrome floats on top of it. */}
      <div
        className="pointer-events-none absolute inset-0 flex flex-col gap-3 p-4"
        style={{ paddingTop: 'var(--hud-h, 0px)', paddingBottom: 'calc(var(--nav-h, 0px) + 16px)' }}
      >
        {/* Your tables at the top left of the room (board request, 2026-09-09); the note and the
            readouts keep the foot, pushed there by `mt-auto` so they stay put whether or not this
            crew has a table. */}
        {yourTables.length > 0 && (
          <YourTables
            auctions={yourTables}
            recruits={recruits}
            used={data?.auctionsUsed ?? yourTables.length}
            allowed={data?.auctionsAllowed ?? 0}
            now={serverNow}
            onOpen={setBiddingOn}
          />
        )}

        <div className="mt-auto flex flex-wrap items-end justify-between gap-3">
          <OnArt className="max-w-sm p-1">
            <InfoNote tone="warn" label="How the Bar works">
              Every crew in the city is bidding on these same people, and the bids are open until
              half an hour before midnight. After that everybody gets one sealed final value, and at
              midnight the highest signs them at exactly what they bid. Nothing is negotiated: what
              you put down is what they cost you every week.
            </InfoNote>
          </OnArt>

          <OnArt className="flex items-stretch divide-x divide-surface-600/70">
            <button
              type="button"
              onClick={() => setOpen('payroll')}
              data-testid="open-payroll"
              className="group flex items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-brass-300/10"
            >
              <span
                aria-hidden
                className="icon-plate flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-brass-300 [&_svg]:h-5 [&_svg]:w-5"
              >
                <Icon name="caps" />
              </span>
              <span className="flex flex-col leading-none">
                <span className="font-display text-[10px] font-bold uppercase tracking-[0.16em] text-ink-300">
                  Payroll left
                </span>
                <span className="mt-1 font-display text-[15px] font-bold tabular-nums text-ink-100">
                  {(data?.payroll.available ?? 0).toLocaleString()}
                </span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => setOpen('crew')}
              data-testid="open-crew"
              className="group flex items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-brass-300/10"
            >
              <span
                aria-hidden
                className="icon-plate flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-brass-300 [&_svg]:h-5 [&_svg]:w-5"
              >
                <Icon name="crew" />
              </span>
              <span className="flex flex-col leading-none">
                <span className="font-display text-[10px] font-bold uppercase tracking-[0.16em] text-ink-300">
                  Your crew
                </span>
                <span
                  className={cn(
                    'mt-1 font-display text-[15px] font-bold tabular-nums',
                    full ? 'text-warning' : 'text-ink-100',
                  )}
                >
                  {data?.slotsUsed ?? 0} / {data?.slotsTotal ?? 0}
                </span>
              </span>
            </button>

            {/* §H7: how yesterday's tables ended. A door rather than a panel, because it is a
                thing a player reads once a day and then stops thinking about. */}
            <button
              type="button"
              onClick={() => setOpen('results')}
              data-testid="open-results"
              className="group flex items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-brass-300/10"
            >
              <span
                aria-hidden
                className="icon-plate flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-brass-300 [&_svg]:h-5 [&_svg]:w-5"
              >
                <Icon name="standings" />
              </span>
              <span className="flex flex-col leading-none">
                <span className="font-display text-[10px] font-bold uppercase tracking-[0.16em] text-ink-300">
                  Last night
                </span>
                <span className="mt-1 font-display text-[15px] font-bold tabular-nums text-ink-100">
                  {results.length}
                </span>
              </span>
            </button>
          </OnArt>
        </div>
      </div>

      {open === 'stool' && shown !== undefined && (
        <StoolDialog
          recruit={shown}
          auction={auctionFor(shown.id)}
          seat={chair}
          of={recruits.length}
          filledRoles={filledRoles}
          now={serverNow}
          day={data?.day ?? ''}
          onStep={step}
          onBid={setBiddingOn}
          onClose={() => setOpen(null)}
        />
      )}

      {open === 'payroll' && (
        <PayrollDialog
          ledger={data?.payroll ?? null}
          caps={data?.caps ?? 0}
          onClose={() => setOpen(null)}
        />
      )}

      {open === 'crew' && (
        <CrewDialog
          officers={officers}
          caps={data?.caps ?? 0}
          used={data?.slotsUsed ?? 0}
          total={data?.slotsTotal ?? 0}
          loading={barQuery.isLoading}
          onClose={() => setOpen(null)}
        />
      )}

      {open === 'results' && <ResultsDialog results={results} onClose={() => setOpen(null)} />}

      {bidding !== undefined && biddingTable !== undefined && data !== undefined && (
        <AuctionWindow
          recruit={bidding}
          auction={biddingTable}
          now={serverNow}
          bidCeiling={data.bidCeiling}
          auctionsUsed={data.auctionsUsed}
          auctionsAllowed={data.auctionsAllowed}
          chairsFree={Math.max(0, data.slotsTotal - data.slotsUsed)}
          onClose={() => setBiddingOn(null)}
        />
      )}
    </div>
  );
}

/**
 * The one control on the painting: a lit brass plaque over the empty stool.
 *
 * It is deliberately not a button in a toolbar. The room has a seat in it, and the whole
 * interaction of the Bar is *taking* that seat, so the control is drawn where the seat is and says
 * how many people are waiting to be looked at.
 */
function SitDown({
  count,
  disabled,
  onOpen,
}: {
  count: number;
  disabled: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      data-testid="sit-down"
      className={cn(
        'group relative flex flex-col items-center gap-1.5 transition-transform duration-200',
        disabled ? 'cursor-not-allowed opacity-60' : 'hover:-translate-y-1',
      )}
    >
      {/* The glow under the seat, so the plaque reads as lit by the lamp above it rather than
          pasted on the floor. */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-32 w-52 -translate-x-1/2 -translate-y-1/2 rounded-[50%] bg-brass-300/25 blur-2xl transition-opacity duration-200 group-hover:bg-brass-300/40"
      />
      <span
        className={cn(
          'glass-strong brushed rivets edge-lit flex items-center gap-2.5 rounded-md border px-4 py-2.5 shadow-panel transition-colors duration-200',
          disabled
            ? 'border-surface-500/70 text-ink-300'
            : 'border-brass-300/80 text-brass-100 group-hover:border-brass-100 group-hover:bg-brass-300/15',
        )}
      >
        <span aria-hidden className="[&_svg]:h-5 [&_svg]:w-5">
          <Icon name="bar" />
        </span>
        <span className="font-display text-[13px] font-bold uppercase tracking-[0.18em]">
          Sit down
        </span>
      </span>
      <span className="rounded-sm bg-surface-950/70 px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-[0.16em] text-brass-300">
        {count === 0 ? 'Nobody in tonight' : `${count} in tonight`}
      </span>
    </button>
  );
}

/**
 * The tables this crew has money on, standing on the room itself (§H7).
 *
 * The cap is the thing a player has to hold in their head all evening: two tables, three past
 * level 40, and a bid is a commitment until the table closes. Putting it behind the stool would
 * make "can I afford to get into this one" a question you answer by opening something.
 */
function YourTables({
  auctions,
  recruits,
  used,
  allowed,
  now,
  onOpen,
}: {
  auctions: readonly BarAuction[];
  recruits: readonly BarRecruit[];
  used: number;
  allowed: number;
  now: Date;
  onOpen: (recruitId: string) => void;
}) {
  return (
    <OnArt className="max-w-lg self-start p-2.5" data-testid="your-tables">
      <div className="flex min-w-0 flex-col gap-2">
        <span className="font-display text-[10px] font-bold uppercase tracking-[0.16em] text-ink-300">
          Your tables{' '}
          <span className={cn('tabular-nums', used >= allowed ? 'text-warning' : 'text-ink-100')}>
            {used}
          </span>
          <span className="tabular-nums text-ink-100"> of {allowed}</span>
        </span>
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {auctions.map((auction) => {
            const name =
              recruits.find((recruit) => recruit.id === auction.recruitId)?.name ?? 'Somebody';
            const phase = phaseOf(auction, now);
            const standing = standingOf(auction);
            const mark =
              auction.yourSealed !== null
                ? 'Locked'
                : standing === 'leading'
                  ? 'Leading'
                  : 'Outbid';
            const left = phase === 'closed' ? null : deadlineOf(auction, phase) - now.getTime();
            return (
              <button
                key={auction.recruitId}
                type="button"
                onClick={() => onOpen(auction.recruitId)}
                data-testid={`table-${auction.recruitId}`}
                className={cn(
                  'flex min-w-0 items-center gap-2 rounded-sm border px-2 py-1 text-left transition-colors',
                  standing === 'leading' && auction.yourSealed === null
                    ? 'border-verdigris-300/50 hover:bg-verdigris-300/10'
                    : auction.yourSealed !== null
                      ? 'border-brass-300/60 hover:bg-brass-300/10'
                      : 'border-oxblood-300/50 hover:bg-oxblood-500/10',
                )}
              >
                <span className="min-w-0 max-w-[11rem] truncate font-body text-[12px] text-ink-100">
                  {name}
                </span>
                <span className="shrink-0 font-display text-[10px] font-bold uppercase tracking-[0.14em] text-ink-300">
                  {mark}
                </span>
                <span
                  className={cn(
                    'shrink-0 font-display text-[12px] font-bold tabular-nums',
                    left !== null && left <= LAST_CALL_MS ? 'text-oxblood-300' : 'text-brass-100',
                  )}
                >
                  {left === null ? 'closed' : countdownText(left)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </OnArt>
  );
}

/**
 * The table, as its own screen: one person at a time, and an arrow to either side.
 *
 * A grid of ten sheets is a spreadsheet of strangers. One at a time is a *conversation*: the
 * player looks at somebody, decides, and moves on, which is the thing the Bar is actually for. The
 * arrows are on the outside of the card at the vertical middle, where a lightbox puts them, and the
 * keyboard drives the same two steps.
 */
function StoolDialog({
  recruit,
  auction,
  seat,
  of,
  filledRoles,
  now,
  day,
  onStep,
  onBid,
  onClose,
}: {
  recruit: BarRecruit;
  auction: BarAuction | undefined;
  seat: number;
  of: number;
  filledRoles: readonly OfficerRole[];
  now: Date;
  day: string;
  onStep: (by: number) => void;
  onBid: (id: string) => void;
  onClose: () => void;
}) {
  /**
   * Which chair the sheet is being read against, held here rather than on the card.
   *
   * The player's question is "who at this bar fits the Head Spy's chair", so the chair survives
   * stepping to the next person. Held on the card it would reset every time an arrow was pressed,
   * which turns one question into nineteen.
   */
  const [highlightRole, setHighlightRole] = useState<OfficerRole | null>(null);

  // Through the window's own stack rather than a listener of its own, so the arrows go quiet while
  // the bidding screen is open on top of this one. See `Modal`'s `onKey`.
  const onArrow = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') onStep(-1);
      if (event.key === 'ArrowRight') onStep(1);
    },
    [onStep],
  );

  return (
    <Modal
      onClose={onClose}
      onKey={onArrow}
      labelledBy="recruit-name"
      size="room"
      className="border-brass-300/30"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-surface-600/60 px-5 py-3">
        <span
          aria-hidden
          className="icon-plate flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-brass-300 [&_svg]:h-5 [&_svg]:w-5"
        >
          <Icon name="bar" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[10px] font-bold uppercase tracking-[0.2em] text-ink-300">
            Tonight{day === '' ? '' : `, ${day}`}
          </span>
          <span className="block font-display text-[12px] uppercase tracking-[0.14em] text-brass-300">
            <span className="tabular-nums">{seat + 1}</span> of{' '}
            <span className="tabular-nums">{of}</span> at the bar
          </span>
        </span>
        {/* The stools, as a row of marks: where along the bar this person is sitting, without
            having to read the count to find out. */}
        <span
          aria-hidden
          data-testid="seat-dots"
          className="hidden items-center gap-1.5 pr-1 sm:flex"
        >
          {Array.from({ length: of }, (_, at) => (
            <span
              key={at}
              className={cn(
                'block rounded-full transition-colors duration-150',
                at === seat ? 'h-2 w-2 bg-brass-300' : 'h-1.5 w-1.5 bg-surface-600',
              )}
            />
          ))}
        </span>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Leave it
        </Button>
      </header>

      {/*
       * The arrows are outside the scroller, not in it.
       *
       * At 1024 the sheet is taller than the window and the card scrolls; arrows sitting inside
       * that scroll went up the screen with it, so a player who read to the bottom of the record
       * had no way left to reach the next person. The row owns the height, the card scrolls inside
       * it, and the two tokens stay level with the middle of what is actually on screen.
       */}
      <div className="flex min-h-0 flex-1 gap-2 px-3 py-4 sm:gap-3 sm:px-4">
        <StepArrow
          direction="back"
          label="The person before"
          testId="seat-back"
          disabled={seat === 0}
          onStep={() => onStep(-1)}
        />
        <div className="flex min-h-0 min-w-0 flex-1 overflow-y-auto" data-testid="bar-file">
          <RecruitCard
            recruit={recruit}
            auction={auction}
            filledRoles={filledRoles}
            now={now}
            highlightRole={highlightRole}
            onHighlightRole={setHighlightRole}
            onBid={onBid}
          />
        </div>
        <StepArrow
          direction="on"
          label="The next person"
          testId="seat-on"
          disabled={seat >= of - 1}
          onStep={() => onStep(1)}
        />
      </div>
    </Modal>
  );
}

/** §H7: the book, as a screen of its own rather than a panel above the room it governs. */
function PayrollDialog({
  ledger,
  caps,
  onClose,
}: {
  ledger: PayrollLedger | null;
  caps: number;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} labelledBy="payroll-dialog-title" className="border-brass-300/30">
      <div className="flex shrink-0 items-center gap-3 border-b border-surface-600/60 px-5 py-4">
        <span
          aria-hidden
          className="icon-plate flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-brass-300 [&_svg]:h-5 [&_svg]:w-5"
        >
          <Icon name="caps" />
        </span>
        <h2 id="payroll-dialog-title" className="font-stamp text-[19px] leading-tight text-ink-100">
          The payroll book
        </h2>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="min-h-0 overflow-y-auto">
        <PayrollPanel ledger={ledger} caps={caps} />
      </div>
    </Modal>
  );
}

/** How each of yesterday's tables ended for this crew (§H7). */
const OUTCOME_FACE: Record<BarAuctionResult['outcome'], string> = {
  won: 'border-verdigris-300/60 bg-verdigris-300/10 text-verdigris-100',
  lost: 'border-oxblood-300/60 bg-oxblood-500/15 text-oxblood-100',
  passed: 'border-brass-300/60 bg-brass-300/10 text-brass-100',
  unsold: 'border-surface-500 bg-surface-900/80 text-ink-300',
};

const OUTCOME_WORD: Record<BarAuctionResult['outcome'], string> = {
  won: 'Signed',
  lost: 'Lost',
  passed: 'Passed',
  unsold: 'Unsold',
};

/** What happened, in one sentence, with the figures a player would want to argue with. */
function resultLine(result: BarAuctionResult): string {
  const price = result.price?.toLocaleString() ?? '';
  switch (result.outcome) {
    case 'won':
      return `Yours at ${price} a week.`;
    case 'lost':
      return `${result.winner ?? 'Somebody'} took them at ${price}. You were at ${result.yourFinal.toLocaleString()}.`;
    case 'passed':
      return `You were highest at ${result.yourFinal.toLocaleString()} and could not take them, so they went to ${result.winner ?? 'the next bid'} at ${price}.`;
    case 'unsold':
      return `Nobody could take them. You were at ${result.yourFinal.toLocaleString()}.`;
  }
}

function ResultsDialog({
  results,
  onClose,
}: {
  results: readonly BarAuctionResult[];
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} labelledBy="results-dialog-title" className="border-brass-300/30">
      <div className="flex shrink-0 items-center gap-3 border-b border-surface-600/60 px-5 py-4">
        <span
          aria-hidden
          className="icon-plate flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-brass-300 [&_svg]:h-5 [&_svg]:w-5"
        >
          <Icon name="standings" />
        </span>
        <span className="flex min-w-0 flex-col">
          <h2
            id="results-dialog-title"
            className="font-stamp text-[19px] leading-tight text-ink-100"
          >
            How the night ended
          </h2>
          {results[0] !== undefined && (
            <span
              className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300"
              data-testid="results-day"
            >
              The tables of {results[0].day}
            </span>
          )}
        </span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="min-h-0 overflow-y-auto" data-testid="auction-results">
        {results.length === 0 ? (
          <EmptyRow text="You bid on nobody" />
        ) : (
          <ul className="flex flex-col divide-y divide-surface-700">
            {results.map((result) => (
              <li key={result.recruitId} className="flex min-w-0 flex-col gap-1.5 px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 break-words font-stamp text-[15px] leading-tight text-ink-100">
                    {result.name}
                  </span>
                  <span
                    data-testid={`outcome-${result.outcome}`}
                    className={cn(
                      'shrink-0 rounded-sm border px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-[0.14em]',
                      OUTCOME_FACE[result.outcome],
                    )}
                  >
                    {OUTCOME_WORD[result.outcome]}
                  </span>
                </div>
                <p className="min-w-0 break-words font-body text-[12px] leading-relaxed text-ink-200">
                  {resultLine(result)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/** The crew on the books, as a screen of its own. Scrolls: a full roster is thirteen people. */
function CrewDialog({
  officers,
  caps,
  used,
  total,
  loading,
  onClose,
}: {
  officers: readonly BarOfficer[];
  caps: number;
  used: number;
  total: number;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} labelledBy="crew-dialog-title" size="wide">
      <div className="flex shrink-0 items-center gap-3 border-b border-surface-600/60 px-5 py-4">
        <span
          aria-hidden
          className="icon-plate flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-brass-300 [&_svg]:h-5 [&_svg]:w-5"
        >
          <Icon name="crew" />
        </span>
        <h2 id="crew-dialog-title" className="font-stamp text-[19px] leading-tight text-ink-100">
          Your crew
        </h2>
        <span className="font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
          <span className={cn('tabular-nums', used >= total ? 'text-warning' : 'text-ink-200')}>
            {used}
          </span>
          <span className="tabular-nums"> / {total}</span> recruits
        </span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="min-h-0 overflow-y-auto" data-testid="crew-list">
        {loading ? (
          <EmptyRow text="Reading the room…" />
        ) : officers.length === 0 ? (
          <EmptyRow text="You are drinking alone" />
        ) : (
          <ul className="flex flex-col divide-y divide-surface-700">
            {officers.map((officer) => (
              <OfficerRow key={officer.commander.id} officer={officer} caps={caps} />
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/**
 * "Highlight important attributes for role": read this sheet against a chair.
 *
 * The four tiers are a property of the *seat*, and at the Bar nobody is in one yet, so a candidate's
 * sheet has nothing to be edged against until the player says which job they are shopping for. This
 * is that. Pick a chair and the gold, silver and blue appear on the rows that chair leans on, so
 * "are they any good" becomes "are they any good *at this*", which is the question the Bar is
 * actually asking.
 *
 * Only the open chairs are offered: highlighting against a seat that is already filled would be
 * answering a question the player cannot act on tonight.
 */
function RoleHighlight({
  role,
  open,
  onChange,
}: {
  role: OfficerRole | null;
  open: readonly OfficerRole[];
  onChange: (role: OfficerRole | null) => void;
}) {
  if (open.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-2">
      {/* `value` is a plain string on the way in: `null` is "no chair chosen", which is not one of
          the options, and the picker already draws its placeholder for a value it does not know. */}
      <Dropdown<OfficerRole>
        value={(role ?? '') as OfficerRole}
        options={open.map((one) => ({ value: one, label: OFFICER_ROLE_LABELS[one] }))}
        onChange={onChange}
        label="Highlight important attributes for role"
        placeholder="Highlight important attributes for role"
        data-testid="highlight-role"
        className="min-w-[16rem]"
      />
      {role !== null && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onChange(null)}
          data-testid="clear-highlight"
        >
          Clear
        </Button>
      )}
    </span>
  );
}

/**
 * One person, as a dossier on the bar, with their table under it.
 *
 * The whole file, laid out the way somebody would actually read it across a counter: who they are
 * and what the room is currently paying for them down the left, the thirty-three numbers across
 * the right, and the one door at the bottom of the left column where a hand would be.
 */
function RecruitCard({
  recruit,
  auction,
  filledRoles,
  now,
  highlightRole,
  onHighlightRole,
  onBid,
}: RecruitCardProps) {
  const open = OFFICER_ROLES.filter((role) => !filledRoles.includes(role));

  return (
    <article
      className="card-paper rivets taped edge-lit flex min-w-0 flex-1 flex-col gap-4 rounded-sm border border-brass-500/30 p-4 shadow-panel sm:p-5"
      data-testid={`recruit-${recruit.id}`}
    >
      {/*
       * Who they are, across the top, and what the room is bidding on the right of it.
       *
       * The card used to be a tall left column against the attribute sheet, which meant the three
       * attribute groups sat in a block and the fourth dropped underneath: an L, and an L reads as
       * a layout that ran out of room. Identity is a band now and the sheet is a full-width row of
       * four, so the card is two rectangles and every group is the same width as every other.
       */}
      <div className="grid min-w-0 gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
        {/*
         * The dossier column: their name, their face, and their table, in that order.
         */}
        <div className="flex min-w-0 flex-col gap-2.5">
          {/*
           * The nameplate, above the picture and the width of it.
           *
           * Smaller type than the old heading and it has to be: a name reading across a whole card
           * can be 26px, and the same name over a 240px portrait cannot. It wraps rather than
           * truncating, because a recruit whose name is cut in half on the one screen that is
           * about them is worse than a plate that is three lines tall.
           */}
          <h3
            className="min-w-0 break-words border-b border-brass-500/30 pb-1.5 font-stamp text-[19px] leading-tight text-ink-100"
            data-testid="recruit-name"
          >
            {recruit.name}
          </h3>

          {/*
           * The portrait, mounted rather than floated.
           *
           * A ring of the card's own brass with a dark mount inside it, so the picture reads as
           * something set into the card instead of an image dropped on top of one.
           */}
          <div className="edge-lit rounded-sm border-2 border-brass-500/45 bg-surface-950 p-1 shadow-panel">
            <OfficerPortrait
              portraitId={officerPortraitId(recruit.id)}
              name={recruit.name}
              className="w-full rounded-[2px] border border-surface-950/80"
              style={{ aspectRatio: '4 / 5' }}
            />
          </div>

          {/*
           * What they bring, under their face.
           *
           * The perks are the reason to read this card rather than the one beside it.
           */}
          <Field label="What they bring">
            {recruit.perks.length > 0 ? (
              <PerkTags perks={recruit.perks} tone="panel" />
            ) : (
              <p className="font-body text-[12px] italic leading-snug text-ink-400">
                Nothing but the sheet. Some of the best of them are.
              </p>
            )}
          </Field>

          <AuctionStrip
            recruit={recruit}
            auction={auction}
            now={now}
            onBid={() => onBid(recruit.id)}
          />

          {(recruit.requirement.minNotoriety > 0 || recruit.requirement.minLevel > 1) && (
            <div className="flex min-w-0 flex-col gap-1 border-l-2 border-surface-600 pl-2.5">
              {recruit.requirement.minNotoriety > 0 && (
                <p className="min-w-0 break-words font-display text-[10px] uppercase leading-snug tracking-[0.14em] text-ink-300">
                  Will sit down with a crew the street calls{' '}
                  <span className="text-ink-100">
                    {notorietyTier(recruit.requirement.minNotoriety)}
                  </span>
                </p>
              )}
              {recruit.requirement.minLevel > 1 && (
                <p className="min-w-0 break-words font-display text-[10px] uppercase leading-snug tracking-[0.14em] text-ink-300">
                  And a crew that has reached{' '}
                  <span className="text-ink-100">level {recruit.requirement.minLevel}</span>
                </p>
              )}
            </div>
          )}
        </div>

        {/*
         * What they can do, beside the dossier rather than under the whole card.
         *
         * **Two groups across, not four**, and that is what makes it fit here: the sheet needs
         * about 210px a group before `Communication` truncates, four of them do not fit next to a
         * portrait, and a 2x2 gives each group half of a column that is already most of the card.
         */}
        <div className="flex min-w-0 flex-col gap-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <span className="shrink-0 font-display text-[11px] font-bold uppercase tracking-[0.2em] text-brass-300">
              What they can do
            </span>
            <span aria-hidden className="ink-rule block min-w-0 flex-1" />
            <RoleHighlight role={highlightRole} open={open} onChange={onHighlightRole} />
          </div>
          <AttributeSheet attributes={recruit.attributes} columns={2} roomy role={highlightRole} />
        </div>
      </div>
    </article>
  );
}

/**
 * This person's table, on their card (§H7).
 *
 * Everything a player needs to decide whether to open the bidding screen: where the price is now,
 * who is holding it, how many crews are in, what phase the table is in and how long that lasts.
 * The door itself is one press, because the decision is made in front of the figures rather than
 * inside the window.
 */
function AuctionStrip({
  recruit,
  auction,
  now,
  onBid,
}: {
  recruit: BarRecruit;
  auction: BarAuction | undefined;
  now: Date;
  onBid: () => void;
}) {
  if (auction === undefined) {
    return (
      <p className="font-body text-[12px] leading-relaxed text-ink-400">
        No table on them tonight.
      </p>
    );
  }

  const phase = phaseOf(auction, now);
  const standing = standingOf(auction);

  return (
    <div className="flex min-w-0 flex-col gap-2.5" data-testid={`auction-${recruit.id}`}>
      <div
        className={cn(
          'edge-lit flex min-w-0 flex-col gap-2 rounded-md border px-3 py-2.5',
          standing === 'leading'
            ? 'border-verdigris-300/50'
            : standing === 'outbid'
              ? 'border-oxblood-300/50'
              : 'border-brass-300/60',
        )}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <PhaseBadge phase={phase} />
          <StandingChip standing={standing} />
          {auction.yourSealed !== null && <LockedChip amount={auction.yourSealed} />}
        </div>

        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-display text-[9.5px] font-bold uppercase tracking-[0.18em] text-ink-300">
            {auction.leading === null ? 'Opens at' : 'Leading bid'}
          </span>
          <span
            className="font-display text-[22px] font-bold leading-none tabular-nums text-brass-100"
            data-testid={`leading-${recruit.id}`}
          >
            {(auction.leading?.amount ?? auction.reserve).toLocaleString()}
          </span>
        </div>

        <span className="min-w-0 truncate font-body text-[11px] leading-snug text-ink-300">
          {auction.leading === null
            ? 'Their floor, and nobody is in yet.'
            : `Held by ${leaderName(auction)} · their floor is ${auction.reserve.toLocaleString()} · ${auction.bidders.toLocaleString()} ${auction.bidders === 1 ? 'crew is' : 'crews are'} in`}
        </span>

        <AuctionClock auction={auction} now={now} testId={`clock-${recruit.id}`} />
      </div>

      {!recruit.assessment.interested ? (
        <ul className="flex min-w-0 flex-col gap-1">
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
      ) : (
        <Button onClick={onBid} data-testid={`bid-${recruit.id}`}>
          {phase === 'closed' ? 'See the table' : phase === 'sealed' ? 'Final value' : 'Bid'}
        </Button>
      )}
    </div>
  );
}

/** One officer on the books: what they bring, and what they cost. */
function OfficerRow({ officer, caps }: { officer: BarOfficer; caps: number }) {
  const { commander } = officer;
  const release = useReleaseOfficer();
  const [confirming, setConfirming] = useState(false);
  const affordable = caps >= officer.dismissalFee;
  return (
    <li className="flex min-w-0 gap-3 px-4 py-3">
      {/* A plated mark down the left, so a roster of thirteen reads as a list of people rather
          than as thirteen paragraphs. */}
      <span
        aria-hidden
        className="icon-plate mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-sm text-brass-300 [&_svg]:h-6 [&_svg]:w-6"
      >
        <Icon name="crew" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 items-baseline justify-between gap-3">
          <span className="min-w-0 break-words font-stamp text-[15px] leading-tight text-ink-100">
            {commander.name}
          </span>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="min-w-0 truncate font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
            {commander.role === null ? BENCH_LABEL : OFFICER_ROLE_LABELS[commander.role]}
          </span>
          <span className="shrink-0 font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
            <span className="tabular-nums text-ink-200">{officer.weeklyWage.toLocaleString()}</span>{' '}
            caps/wk
          </span>
        </div>
        {/* What they bring to the crew. This row used to carry an alignment meter and a line of
            attribute chips the officer's mood was currently worth; both went with §H5. */}
        <PerkTags perks={commander.perks} tone="panel" side="top" />
        {/*
         * §H7: letting somebody go, behind a confirmation.
         *
         * Two clicks because it is expensive and irreversible: their slice of the book comes back
         * immediately and five weeks of it leaves the stockpile on the spot. The figure is on the
         * button rather than in a dialog, so the price is read before the second click rather than
         * after it.
         */}
        {confirming ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-surface-700 pt-2">
            <span className="font-body text-[12px] leading-snug text-ink-200">
              {officer.dismissalFee.toLocaleString()} caps to end it, paid now.
            </span>
            <Button
              size="sm"
              variant="danger"
              disabled={!affordable || release.isPending}
              onClick={() => release.mutate({ officerId: commander.id })}
              data-testid={`confirm-release-${commander.id}`}
            >
              {release.isPending ? 'Ending it…' : 'Let them go'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep them
            </Button>
            {!affordable && (
              <span className="font-body text-[12px] text-oxblood-300">You cannot cover it.</span>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            data-testid={`release-${commander.id}`}
            className="self-start font-display text-[10px] uppercase tracking-[0.16em] text-ink-300 transition-colors hover:text-oxblood-300"
          >
            Let them go
          </button>
        )}
        {release.error !== null && (
          <p role="alert" className="font-body text-[12px] text-oxblood-300">
            {release.error.message}
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * The book: the ceiling, what is committed against it, and what one more step costs.
 *
 * A step is a fixed size at a price the server quotes and that climbs with every step already
 * bought, so the price is shown rather than derived here: `payrollStepCost` owns it, and a second
 * copy of that curve on the client is a copy that can disagree.
 */
function PayrollPanel({ ledger, caps }: { ledger: PayrollLedger | null; caps: number }) {
  const raise = useIncreasePayroll();
  if (!ledger) return <EmptyRow text="Counting it up…" />;

  return (
    <div className="flex flex-col gap-3 p-4" data-testid="payroll-book">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-display text-[11px] uppercase tracking-[0.18em] text-ink-300">
          Committed
        </span>
        <span className="font-display text-lg font-bold tabular-nums text-brass-300">
          {ledger.committed.toLocaleString()}
          <span className="text-ink-300"> / {ledger.capacity.toLocaleString()}</span>
          <span className="ml-1 font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
            caps / wk
          </span>
        </span>
      </div>
      <PayrollMeter ledger={ledger} />
      <p className="font-body text-[13px] leading-relaxed text-ink-200">
        <span className="font-semibold tabular-nums text-ink-100">
          {ledger.available.toLocaleString()}
        </span>{' '}
        left to promise. An officer takes a slice of this for as long as they are on the books, and
        nothing is deducted from the stockpile week to week.
      </p>
      <RaisePayroll
        ledger={ledger}
        caps={caps}
        onRaise={() => raise.mutate({})}
        pending={raise.isPending}
        error={raise.error?.message ?? null}
        testId="increase-payroll"
        showShortfall
      />
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <p className="px-4 py-6 text-center font-display text-[11px] uppercase tracking-[0.2em] text-ink-300">
      {text}
    </p>
  );
}

/**
 * The Bar (GDD §H1): tonight's tables and the crew they have already given you.
 *
 * The roster is the same for every player on the same game day (§H2), and so is the bidding: the
 * header says so out loud, because it is a shared room and not a personalised shortlist.
 */
