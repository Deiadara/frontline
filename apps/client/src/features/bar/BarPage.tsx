import {
  type PayrollLedger,
  ALIGNMENT_BAND_LABELS,
  AMBITION_SPECS,
  ATTRIBUTE_LABELS,
  MORAL_COMPASS_SPECS,
  OFFICER_ROLE_LABELS,
  OFFICER_ROLES,
  TRAIT_CATALOG,
  isFlaw,
  notorietyTier,
  type AlignmentBand,
  type AttributeName,
  type BarOfficer,
  type BarRecruit,
  type JoinBlocker,
  type Negotiation,
  type OfficerRole,
  type TraitId,
} from '@frontline/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { AttributeSheet } from '../overseer/AttributeSheet';
import { Button } from '../../components/ui/Button';
import { DescribedTag } from '../../components/ui/DescribedTag';
import { Icon } from '../../components/ui/Icon';
import { Modal } from '../../components/ui/Modal';
import { deliveredUrl } from '../../assets/delivered';
import { cn } from '../../lib/cn';
import { useMeasuredSize, type MeasuredSize } from '../../lib/useMeasuredHeight';
import { RATING_FILL, RATING_TEXT, ratingBand, ratingPercent } from '../../lib/rating';
import { useBar, useHireRecruit, useIncreasePayroll, useReleaseOfficer } from '../../lib/queries';
import { InfoNote } from '../game/PageShell';
import { NegotiationDialog } from './NegotiationDialog';

/** Devotion reads in the player's own accent; a walkout reads as a warning. */
const BAND_STYLE: Record<AlignmentBand, string> = {
  leaving: 'border-oxblood-500/50 text-oxblood-300',
  unsettled: 'border-surface-600 text-ink-200',
  settled: 'border-brass-300/50 text-brass-300',
  devoted: 'border-bile-300/50 text-bile-300',
};

const BLOCKER_LABEL: Record<JoinBlocker, string> = {
  notoriety: 'Your name is not big enough',
  level: 'Wants a crew that has been doing this longer',
};

/**
 * `className` carries the *whole* colour, border included, and replaces the neutral default rather
 * than layering over it.
 *
 * `cn` is `clsx`: it concatenates classes and does not resolve Tailwind conflicts, so a base
 * `text-ink-300` and a caller's `text-oxblood-300` both land on the element and the generated
 * stylesheet's order silently picks the winner, which was the base. Every coloured tag on this
 * page was rendering steel because of it. Keeping the base to layout only makes the override the
 * only colour in play, so what a caller asks for is what renders.
 */
const TAG_NEUTRAL = 'border-surface-600 text-ink-300';

function Tag({ label, className = TAG_NEUTRAL }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center border px-2 py-1 font-display text-[10px] uppercase tracking-[0.18em]',
        className,
      )}
    >
      {label}
    </span>
  );
}

/**
 * §H5: the meter itself, so "too low" and "high" are visible rather than inferred.
 *
 * On the same four bands every other 0-100 rating in the game is read on (`lib/rating.ts`) rather
 * than on the three §H5 bands. Those are still here and still mean what they meant: the *word*
 * beside the meter is `Devoted` or `Threatening to walk`, and that is a domain rule about what
 * happens next. Colouring the bar by it as well spent the one channel a player has already learned
 * to read as "how big is this number" on a fact the tag was already carrying.
 */
function AlignmentMeter({ value }: { value: number }) {
  const rating = Math.round(value);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="paint-track h-2 min-w-0 flex-1 overflow-hidden rounded-sm">
        <span
          className={cn('paint-fill block h-full', RATING_FILL[ratingBand(rating)])}
          style={{ width: `${ratingPercent(rating)}%` }}
        />
      </span>
      <span
        className={cn(
          'shrink-0 font-display text-[12px] font-bold tabular-nums',
          RATING_TEXT[ratingBand(rating)],
        )}
      >
        {rating}
      </span>
    </div>
  );
}

/**
 * What a character wants and how far they will go for it (§H4).
 *
 * Both words decide whether this person will sign at all, read against the crew's own reputation
 * word, so the card says which reputations each one is drawn to and which put it off. That is the
 * whole rule, and it is the difference between a player choosing a reputation and a player finding
 * out afterwards that nobody good will talk to them.
 */
function Disposition({ ambition, moralCompass }: Pick<BarRecruit, 'ambition' | 'moralCompass'>) {
  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      <DescribedTag
        label={AMBITION_SPECS[ambition].label}
        description={AMBITION_SPECS[ambition].description}
        className="border-hextech-100/40 text-hextech-100"
      />
      <DescribedTag
        label={MORAL_COMPASS_SPECS[moralCompass].label}
        description={MORAL_COMPASS_SPECS[moralCompass].description}
      />
    </div>
  );
}

/** A trait's whole mechanical effect, written out. `+8 stealth` is the rule; the name is flavour. */
function traitDetail(trait: TraitId): string {
  return Object.entries(TRAIT_CATALOG[trait].bonus)
    .map(
      ([name, amount]) =>
        `${amount > 0 ? '+' : ''}${amount} ${ATTRIBUTE_LABELS[name as AttributeName]}`,
    )
    .join(' · ');
}

interface RecruitCardProps {
  recruit: BarRecruit;
  filledRoles: readonly OfficerRole[];
  /** §H7: caps a week still uncommitted on the payroll book. */
  payrollLeft: number;
  /** §H8: every slot is taken, so no offer can be made however willing the character is. */
  full: boolean;
  /** §H2b: this crew has already signed somebody today. Same effect, different reason. */
  signedToday: boolean;
  /** §H7: a fee struck in the negotiation window, so the card can say so once it closes. */
  agreed: number | null;
  /** §H7: the conversation with this character, if one has been opened today. */
  negotiation: Negotiation | undefined;
  /** The server's clock, so a standoff counts down against the same one that enforces it. */
  now: Date;
  onNegotiate: (recruitId: string) => void;
}

/** `4h 12m` until they will sit down again, or `null` once the chair is warm. */
function coldFor(recruit: BarRecruit, now: Date): string | null {
  if (!recruit.standoff) return null;
  const remaining = Date.parse(recruit.standoff.until) - now.getTime();
  if (remaining <= 0) return null;
  const hours = Math.floor(remaining / (60 * 60 * 1000));
  const minutes = Math.floor((remaining % (60 * 60 * 1000)) / 60_000);
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`;
}

/**
 * One person at the Bar (§H1-§H4, §H7).
 *
 * Nothing on this card says what role they would be *good* at: the player reads the sheet and
 * decides, which is what §B8 asks for. The role picker is a hiring choice (§C2), not a hint.
 */
/**
 * The stool in the middle of the painting, in fractions of it.
 *
 * The plate is a room with one empty seat in it, and the seat is the control: `Sit down` is drawn
 * over it rather than in a toolbar somewhere. Fractions of the *image*, not of the frame, which is
 * why the picture below is sized to cover and the button lives inside that box: a percentage of
 * the viewport would slide off the stool the moment somebody resized a window.
 */
const STOOL = { x: 0.492, y: 0.665 } as const;

/** The plate's own shape. Used to size the box the stool is positioned in. */
const BAR_ASPECT = 1264 / 848;

/**
 * The largest box of the plate's shape that still covers `room`, centred on it.
 *
 * Cover rather than contain: a letterboxed painting with bars down the sides reads as a screenshot
 * pasted on, and this one is meant to be the room you are standing in. The overflow is clipped by
 * the frame, and because the box keeps the plate's aspect exactly, the stool stays under the button
 * at every viewport.
 */
function covering(room: MeasuredSize): { width: number; height: number } {
  if (room.width <= 0 || room.height <= 0) return { width: 0, height: 0 };
  const byWidth = { width: room.width, height: room.width / BAR_ASPECT };
  return byWidth.height >= room.height
    ? byWidth
    : { width: room.height * BAR_ASPECT, height: room.height };
}

/** A control that floats on the painting: dark glass, a lit edge, and enough contrast to read. */
function OnArt({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'glass-strong edge-lit rivets pointer-events-auto rounded-md border border-surface-500/70 shadow-panel',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function BarPage() {
  const barQuery = useBar();
  const hire = useHireRecruit();
  /**
   * Wages struck in the negotiation window and not yet signed.
   *
   * Deliberately **not** the same map as `counters`. A counter-offer is a refusal carrying a price
   * ("turned it down; they will sign for N"); an agreement is a yes. Writing an accepted wage into
   * the counter map is the bug this pair of maps exists to make impossible: it made the card
   * announce "Turned it down" the moment somebody said yes, and hired nobody.
   */
  const [agreed, setAgreed] = useState<Record<string, number>>({});
  /** §H7, which conversation is open, if any. One at a time: it is a table, not a phone bank. */
  const [talkingTo, setTalkingTo] = useState<string | null>(null);
  /**
   * Conversations this session has moved on, over the ones the read arrived with.
   *
   * The negotiate call deliberately does not refetch the Bar: a whole-roster reload mid-sentence
   * would swap the window's state out from under the player, so the card behind the window needs
   * somewhere to learn that the standing demand has changed.
   */
  const [talks, setTalks] = useState<Record<string, Negotiation>>({});
  /** Which screen is over the room: the stool, the book, the crew, or none of them. */
  const [open, setOpen] = useState<'stool' | 'payroll' | 'crew' | null>(null);
  /** Which chair the stool screen is showing. An index, so the arrows are arithmetic. */
  const [seat, setSeat] = useState(0);

  const [roomRef, room] = useMeasuredSize<HTMLDivElement>();
  const plate = deliveredUrl({ type: 'plate', plate: 'bar' });
  const picture = covering(room);

  const data = barQuery.data;
  const recruits = data?.recruits ?? [];
  const officers = data?.officers ?? [];
  const full = data !== undefined && data.slotsUsed >= data.slotsTotal;
  // §H2b: the shared room's other limit. Distinct from `full`: one is about the crew's own
  // recruit slots, the other about how many people the whole city may take out of the room today.
  const signedToday = data !== undefined && data.hiresLeftToday === 0;

  const onOffer = (recruitId: string, role: OfficerRole, offerWage: number) => {
    hire.reset();
    hire.mutate(
      { recruitId, role, offerWage },
      {
        onSuccess: (result) => {
          if (result.accepted) {
            // Signed: the deal is spent, and the window (if this came from one) has done its job.
            setAgreed((current) => {
              const { [recruitId]: _done, ...rest } = current;
              return rest;
            });
            setTalkingTo((talking) => (talking === recruitId ? null : talking));
          }
        },
      },
    );
  };

  // Derived once here rather than per card: the negotiation window needs the same list, and two
  // derivations of "which roles are open" is how a window offers a seat the card says is taken.
  const filledRoles = data?.filledRoles ?? [];
  const openRoles = OFFICER_ROLES.filter((role) => !filledRoles.includes(role));

  const negotiationFor = (recruitId: string): Negotiation | undefined =>
    talks[recruitId] ?? data?.negotiations[recruitId];

  const talking = recruits.find((recruit) => recruit.id === talkingTo);
  // The server's clock, so a standoff counts down against the one that enforces it rather than
  // against a browser that may be minutes off.
  const serverNow = data ? new Date(data.serverNow) : new Date();

  // Clamped rather than wrapped on read: the roster can shrink under an open screen when somebody
  // is signed, and an index past the end would render nothing with no way back.
  const chair = recruits.length === 0 ? 0 : Math.min(seat, recruits.length - 1);
  const shown = recruits[chair];
  const step = (by: number) =>
    setSeat((current) => {
      if (recruits.length === 0) return 0;
      const from = Math.min(current, recruits.length - 1);
      return (from + by + recruits.length) % recruits.length;
    });

  return (
    <div className="relative h-full w-full">
      {/*
       * The room, full bleed, the way the district is its own screen rather than a picture on one.
       *
       * The chrome floats over it: the painting runs under the standing bar and the nav, and the
       * three controls on it are positioned against the *painting* rather than against the sheet.
       */}
      <div
        ref={roomRef}
        className="absolute inset-0 overflow-hidden bg-surface-950"
        data-testid="bar-room"
        style={{ paddingTop: 'var(--hud-h, 0px)', paddingBottom: 'var(--nav-h, 0px)' }}
      >
        <div className="relative h-full w-full overflow-hidden">
          {/* Sized in pixels from a measurement rather than by CSS, for the reason the district
              scene spells out: `aspect-ratio` plus a `max-height` clamps the height without giving
              the width back, and the box quietly stops being the picture's shape. */}
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ width: picture.width, height: picture.height }}
          >
            {plate !== null && (
              <img
                src={plate}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 h-full w-full object-fill"
              />
            )}
            {/* A little more dark at the edges than the plate paints, so the controls on it read
                without a scrim over the middle of the room. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'radial-gradient(ellipse 70% 60% at 50% 55%, transparent 35%, rgb(6 5 10 / 0.72) 100%)',
              }}
            />

            {/* The seat. */}
            <div
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${STOOL.x * 100}%`, top: `${STOOL.y * 100}%` }}
            >
              <SitDown
                count={recruits.length}
                disabled={barQuery.isLoading || recruits.length === 0}
                onOpen={() => setOpen('stool')}
              />
            </div>
          </div>
        </div>
      </div>

      {/* The two standing readouts, on the glass over the room. */}
      {/* The same inset the room takes, or the two readouts sit under the nav: this layer is over
          the whole viewport, and the chrome floats on top of it. */}
      <div
        className="pointer-events-none absolute inset-0 flex flex-col justify-end p-4"
        style={{ paddingTop: 'var(--hud-h, 0px)', paddingBottom: 'calc(var(--nav-h, 0px) + 16px)' }}
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <OnArt className="max-w-sm p-1">
            <InfoNote tone="warn" label="How the Bar works">
              Every crew in the city is reading this same list, and signing somebody takes them off
              it for all of them. You get one signature a day. So the question is never whether you
              can afford this person. It is whether they are the one worth spending today on.
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
          </OnArt>
        </div>
      </div>

      {open === 'stool' && shown !== undefined && (
        <StoolDialog
          recruit={shown}
          seat={chair}
          of={recruits.length}
          filledRoles={filledRoles}
          agreed={agreed[shown.id] ?? null}
          signedToday={signedToday}
          payrollLeft={data?.payroll.available ?? 0}
          full={full}
          negotiation={negotiationFor(shown.id)}
          now={serverNow}
          day={data?.day ?? ''}
          onStep={step}
          onNegotiate={setTalkingTo}
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

      {talking !== undefined && (
        <NegotiationDialog
          recruit={talking}
          standing={negotiationFor(talking.id) ?? null}
          payrollLeft={data?.payroll.available ?? 0}
          onClose={() => setTalkingTo(null)}
          onTurn={(negotiation) =>
            setTalks((current) => ({ ...current, [talking.id]: negotiation }))
          }
          onAgreed={(wage) => setAgreed((current) => ({ ...current, [talking.id]: wage }))}
          openRoles={openRoles}
          onSign={(role, wage) => onOffer(talking.id, role, wage)}
          signing={hire.isPending && hire.variables?.recruitId === talking.id}
          signBlocked={
            full
              ? 'Your crew is full. Free a recruit slot and they will still be here tomorrow.'
              : signedToday
                ? 'You have already signed somebody today. This one keeps until tomorrow.'
                : null
          }
          signError={
            hire.error !== null && hire.variables?.recruitId === talking.id
              ? hire.error.message
              : null
          }
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
      <span className="rounded-sm bg-surface-950/70 px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-[0.16em] text-brass-200 shadow-panel">
        {count === 0 ? 'Nobody in tonight' : `${count} in tonight`}
      </span>
    </button>
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
  seat,
  of,
  filledRoles,
  agreed,
  signedToday,
  payrollLeft,
  full,
  negotiation,
  now,
  day,
  onStep,
  onNegotiate,
  onClose,
}: {
  recruit: BarRecruit;
  seat: number;
  of: number;
  filledRoles: readonly OfficerRole[];
  agreed: number | null;
  signedToday: boolean;
  payrollLeft: number;
  full: boolean;
  negotiation: Negotiation | undefined;
  now: Date;
  day: string;
  onStep: (by: number) => void;
  onNegotiate: (id: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') onStep(-1);
      if (event.key === 'ArrowRight') onStep(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onStep]);

  return (
    <Modal onClose={onClose} labelledBy="recruit-name" size="full" className="border-brass-300/30">
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
        <Button size="sm" variant="ghost" onClick={onClose}>
          Leave it
        </Button>
      </header>

      <div className="relative flex min-h-0 items-stretch">
        <Chair direction="back" onStep={() => onStep(-1)} />
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3" data-testid="bar-file">
          <RecruitCard
            recruit={recruit}
            filledRoles={filledRoles}
            agreed={agreed}
            signedToday={signedToday}
            payrollLeft={payrollLeft}
            full={full}
            negotiation={negotiation}
            now={now}
            onNegotiate={onNegotiate}
          />
        </div>
        <Chair direction="on" onStep={() => onStep(1)} />
      </div>
    </Modal>
  );
}

/** One of the two arrows: a full-height strip rather than a small target floating in a corner. */
function Chair({ direction, onStep }: { direction: 'back' | 'on'; onStep: () => void }) {
  return (
    <button
      type="button"
      onClick={onStep}
      aria-label={direction === 'back' ? 'The person before' : 'The next person'}
      data-testid={direction === 'back' ? 'seat-back' : 'seat-on'}
      className="group flex w-10 shrink-0 items-center justify-center text-ink-300 transition-colors hover:bg-brass-300/10 hover:text-brass-100"
    >
      <span
        aria-hidden
        className={cn(
          'transition-transform duration-150 [&_svg]:h-6 [&_svg]:w-6',
          direction === 'back'
            ? 'rotate-90 group-hover:-translate-x-0.5'
            : '-rotate-90 group-hover:translate-x-0.5',
        )}
      >
        <Icon name="chevron-down" />
      </span>
    </button>
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
 * One person, as a dossier on the bar.
 *
 * The whole file, laid out the way somebody would actually read it across a counter: who they are
 * and what they want down the left, the thirty-three numbers across the right, and the one door at
 * the bottom of the left column where a hand would be.
 *
 * The split is not decoration. It was four columns of the sheet across the full width of a modal,
 * which left each column about 130px and cut `Communication` to `Communicati…`: fixed copy that
 * ellipsises is a permanent defect rather than a fat-content edge case, and the board's bar rules
 * it out. Giving the sheet the wide side and the identity the narrow one fixes the arithmetic and
 * reads better besides.
 */
function RecruitCard({
  recruit,
  filledRoles,
  payrollLeft,
  full,
  signedToday,
  agreed,
  negotiation,
  now,
  onNegotiate,
}: RecruitCardProps) {
  const open = OFFICER_ROLES.filter((role) => !filledRoles.includes(role));
  const asking = recruit.askingWage;
  // Whether their opening price fits what is left of the book. Shown before the conversation
  // rather than after it, because a fee that cannot be committed is not a fee worth haggling over.
  const fits = asking === null || asking <= payrollLeft;
  const cold = coldFor(recruit, now);

  const door = recruit.hired ? null : cold !== null ? (
    /*
     * A chair this crew walked out of. Six hours, and their price has already gone up ten
     * percent for the next conversation, which is the half that persists: see
     * `standoffAfterWalkout`.
     */
    <div className="flex min-w-0 flex-col gap-1">
      <p className="min-w-0 break-words font-stamp text-[15px] leading-snug text-oxblood-300">
        You walked out on them.
      </p>
      <p className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
        Back in {cold} · their price is up {recruit.standoff?.walkouts ?? 1}0%
      </p>
    </div>
  ) : recruit.assessment.interested ? (
    <div className="flex min-w-0 flex-col gap-2">
      {negotiation !== undefined && !negotiation.closed && (
        <p className="min-w-0 break-words font-stamp text-[15px] leading-snug text-brass-100">
          Mid-conversation. They are asking {negotiation.standing.toLocaleString()} a week.
        </p>
      )}
      {agreed !== null && (
        <p
          className="min-w-0 break-words font-body text-[13px] leading-relaxed text-verdigris-100"
          data-testid={`signed-${recruit.id}`}
        >
          Signed at {agreed.toLocaleString()} caps a week.
        </p>
      )}
      {/*
       * One door, and it is a window (§H7).
       *
       * The card used to carry a number field and an Offer button beside the Negotiate one,
       * which meant the whole conversation was optional and the two paths could disagree about
       * what had been agreed: a player could shake on a figure in the window, close it, and
       * have the card report "Turned it down" from a stale counter. Hiring now happens in one
       * place, in front of the person doing it.
       */}
      <Button
        disabled={negotiation?.closed === true || signedToday || full || open.length === 0}
        onClick={() => onNegotiate(recruit.id)}
        data-testid={`negotiate-${recruit.id}`}
      >
        {negotiation?.closed === true
          ? 'Finished'
          : signedToday
            ? 'Not today'
            : full
              ? 'No room'
              : open.length === 0
                ? 'No post open'
                : 'Sit down with them'}
      </Button>
      {asking !== null && !fits && (
        <p className="font-body text-[12px] leading-relaxed text-oxblood-300">
          Your payroll will not stretch to {asking.toLocaleString()} a week. Raise it at the Nexus.
        </p>
      )}
    </div>
  ) : (
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
  );

  return (
    <article
      className="card-paper rivets taped edge-lit grid min-w-0 gap-4 rounded-sm border border-brass-500/30 p-4 shadow-panel lg:grid-cols-[19rem_minmax(0,1fr)]"
      data-testid={`recruit-${recruit.id}`}
    >
      {/* Who, and what they want. */}
      <div className="flex min-w-0 flex-col gap-3">
        <header className="flex min-w-0 flex-col gap-2">
          <h3
            className="min-w-0 break-words font-stamp text-[22px] leading-tight text-ink-100"
            data-testid="recruit-name"
          >
            {recruit.name}
          </h3>
          <span aria-hidden className="ink-rule block w-full" />
        </header>

        {/* The price, as a plate on the counter rather than a tag in a corner: it is the number
            the whole conversation is about. */}
        <div
          className={cn(
            'edge-lit flex items-center gap-3 rounded-md border px-3 py-2.5',
            recruit.hired
              ? 'border-bile-300/50'
              : recruit.assessment.interested
                ? 'border-brass-300/60'
                : 'border-oxblood-500/50',
          )}
        >
          <span
            aria-hidden
            className="icon-plate flex h-10 w-10 shrink-0 items-center justify-center rounded-sm text-brass-300 [&_svg]:h-6 [&_svg]:w-6"
          >
            <Icon name={recruit.hired ? 'check' : 'caps'} />
          </span>
          <span className="flex min-w-0 flex-col leading-none">
            <span className="font-display text-[10px] font-bold uppercase tracking-[0.16em] text-ink-300">
              {recruit.hired
                ? 'On your books'
                : recruit.assessment.interested
                  ? 'Opens at'
                  : 'Not talking'}
            </span>
            {/* Only when there is a figure. The two other states are already named on the line
                above, and a placeholder glyph under `Not talking` is a second way of saying the
                same nothing. */}
            {recruit.assessment.interested && !recruit.hired && (
              <span className="mt-1.5 font-display text-[18px] font-bold tabular-nums text-brass-100">
                {(asking ?? 0).toLocaleString()} / wk
              </span>
            )}
          </span>
        </div>

        <Disposition ambition={recruit.ambition} moralCompass={recruit.moralCompass} />

        {recruit.traits.length > 0 && (
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {/* §B7: a flaw is a reason *not* to hire, so it must not read as another credential. */}
            {recruit.traits.map((trait) => (
              <DescribedTag
                key={trait}
                label={TRAIT_CATALOG[trait].name}
                description={TRAIT_CATALOG[trait].description}
                detail={traitDetail(trait)}
                className={
                  isFlaw(trait)
                    ? 'border-oxblood-500 text-oxblood-300'
                    : 'border-surface-600 text-ink-300'
                }
              />
            ))}
          </div>
        )}

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

        {/* The door sits at the foot of this column, where a hand would be. */}
        <div className="mt-auto min-w-0 pt-1">{door}</div>
      </div>

      {/* What they can do. */}
      <div className="flex min-w-0 flex-col gap-2">
        <span className="font-display text-[10px] font-bold uppercase tracking-[0.2em] text-brass-300">
          What they can do
        </span>
        <span aria-hidden className="ink-rule block w-full" />
        {/*
         * Two columns, not four.
         *
         * `AttributeSheet`'s four-column mode switches on a *viewport* media query, so inside a
         * modal it renders four columns in whatever width the modal actually has: 720px here,
         * which is 165px a column and cuts `Communication` to `Communicati…`. Two columns give
         * each label 350px and the sheet reads better for it; the panes it was written for still
         * get four.
         */}
        <AttributeSheet attributes={recruit.attributes} columns={3} />
      </div>
    </article>
  );
}

/** One officer on the books, with their §H5 standing and §H6 level. */
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
          <Tag label={ALIGNMENT_BAND_LABELS[officer.band]} className={BAND_STYLE[officer.band]} />
        </div>
        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="min-w-0 truncate font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
            {OFFICER_ROLE_LABELS[commander.role]} · Lv {commander.level}
          </span>
          <span className="shrink-0 font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
            <span className="tabular-nums text-ink-200">{officer.weeklyWage}</span> caps/wk
          </span>
        </div>
        <AlignmentMeter value={commander.alignment} />
        {/* What they are worth on a job, as chips rather than a comma-separated sentence: it is
            three attributes and a figure, which is a set of facts and not a paragraph. */}
        {officer.skillBonus > 0 && (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {officer.bonusAttributes.map((name) => (
              <span
                key={name}
                className="rounded-sm border border-bile-300/50 px-1.5 py-0.5 font-display text-[10px] uppercase tracking-[0.12em] text-bile-300"
              >
                {/* Named off the shared table: `bonusAttributes` carries field names, and two of
                    them do not title-case to their real spelling. */}
                {ATTRIBUTE_LABELS[name]} <span className="tabular-nums">+{officer.skillBonus}</span>
              </span>
            ))}
          </div>
        )}
        {officer.threateningToLeave && (
          <p className="min-w-0 break-words text-[12px] leading-relaxed text-oxblood-300">
            Says they are done unless something changes.
          </p>
        )}
        {commander.unspentPoints > 0 && (
          <p className="min-w-0 break-words font-display text-[10px] uppercase tracking-[0.14em] text-brass-300">
            {commander.unspentPoints} point{commander.unspentPoints === 1 ? '' : 's'} to assign
          </p>
        )}
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

  const pct = ledger.capacity > 0 ? Math.min(100, (ledger.committed / ledger.capacity) * 100) : 0;
  const affordable = caps >= ledger.nextStepCost;

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
      <span className="block h-2 w-full overflow-hidden rounded-sm bg-surface-950">
        <span
          className={cn('block h-full rounded-sm', pct >= 100 ? 'bg-oxblood-300' : 'bg-brass-300')}
          style={{ width: `${pct}%` }}
        />
      </span>
      <p className="font-body text-[13px] leading-relaxed text-ink-200">
        <span className="font-semibold tabular-nums text-ink-100">
          {ledger.available.toLocaleString()}
        </span>{' '}
        left to promise. An officer takes a slice of this for as long as they are on the books, and
        nothing is deducted from the stockpile week to week.
      </p>
      <div className="flex flex-wrap items-center gap-2.5 border-t border-surface-700 pt-3">
        <Button
          size="sm"
          disabled={!affordable || raise.isPending}
          onClick={() => raise.mutate({})}
          data-testid="increase-payroll"
        >
          {raise.isPending ? 'Raising…' : `Increase payroll · +${ledger.stepSize}`}
        </Button>
        <span className="font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
          {ledger.nextStepCost.toLocaleString()} caps, once
        </span>
      </div>
      {!affordable && (
        <p className="font-body text-[12px] leading-snug text-oxblood-300">
          {(ledger.nextStepCost - caps).toLocaleString()} caps short of the next step.
        </p>
      )}
      {raise.error !== null && (
        <p role="alert" className="font-body text-[12px] text-oxblood-300">
          {raise.error.message}
        </p>
      )}
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
 * The Bar (GDD §H1): today's roster and the crew it has already given you.
 *
 * The roster is the same for every player on the same UTC day (§H2), which the header says out
 * loud: it is a shared room, not a personalised shortlist.
 */
