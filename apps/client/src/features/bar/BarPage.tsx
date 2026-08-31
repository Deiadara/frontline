import {
  BENCH_LABEL,
  type PayrollLedger,
  OFFICER_ROLE_LABELS,
  OFFICER_ROLES,
  notorietyTier,
  officerPortraitId,
  plateAspect,
  type BarOfficer,
  type BarRecruit,
  type JoinBlocker,
  type Negotiation,
  type OfficerRole,
} from '@frontline/shared';
import { useCallback, useState, type ReactNode } from 'react';
import { AttributeSheet } from '../overseer/AttributeSheet';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { Modal } from '../../components/ui/Modal';
import { Dropdown } from '../../components/ui/Dropdown';
import { OfficerPortrait } from '../overseer/OfficerPortrait';
import { StepArrow } from '../../components/ui/StepArrow';
import { cn } from '../../lib/cn';
import { useBar, useHireRecruit, useIncreasePayroll, useReleaseOfficer } from '../../lib/queries';
import { InfoNote } from '../game/PageShell';
import { OnArt, OnPlate, PlateRoom } from '../game/PlateRoom';
import { NegotiationDialog } from './NegotiationDialog';
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

/** A trait's whole mechanical effect, written out. `+8 stealth` is the rule; the name is flavour. */
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
  /**
   * §C2: which chair to read this person's sheet against, if the player has picked one.
   *
   * Lives on the seat screen rather than on the card, so it survives stepping to the next person:
   * the question a player is asking is "who here fits the Head Spy's chair", and having to
   * re-choose the chair for every candidate is the screen answering a different question.
   */
  highlightRole: OfficerRole | null;
  onHighlightRole: (role: OfficerRole | null) => void;
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

  const data = barQuery.data;
  const recruits = data?.recruits ?? [];
  const officers = data?.officers ?? [];
  const full = data !== undefined && data.slotsUsed >= data.slotsTotal;
  // §H2b: the shared room's other limit. Distinct from `full`: one is about the crew's own
  // recruit slots, the other about how many people the whole city may take out of the room today.
  const signedToday = data !== undefined && data.hiresLeftToday === 0;

  const onOffer = (recruitId: string, role: OfficerRole | null, offerWage: number) => {
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
  /**
   * Which chair the sheet is being read against, held here rather than on the card.
   *
   * The player's question is "who at this bar fits the Head Spy's chair", so the chair survives
   * stepping to the next person. Held on the card it would reset every time an arrow was pressed,
   * which turns one question into nineteen.
   */
  const [highlightRole, setHighlightRole] = useState<OfficerRole | null>(null);

  // Through the window's own stack rather than a listener of its own, so the arrows go quiet while
  // the negotiation is open on top of this screen. See `Modal`'s `onKey`.
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
            filledRoles={filledRoles}
            agreed={agreed}
            signedToday={signedToday}
            payrollLeft={payrollLeft}
            full={full}
            negotiation={negotiation}
            now={now}
            highlightRole={highlightRole}
            onHighlightRole={setHighlightRole}
            onNegotiate={onNegotiate}
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

function RecruitCard({
  recruit,
  filledRoles,
  payrollLeft,
  full,
  signedToday,
  agreed,
  negotiation,
  now,
  highlightRole,
  onHighlightRole,
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
      className="card-paper rivets taped edge-lit flex min-w-0 flex-1 flex-col gap-4 rounded-sm border border-brass-500/30 p-4 shadow-panel sm:p-5"
      data-testid={`recruit-${recruit.id}`}
    >
      {/*
       * Who they are, across the top, and what they cost on the right of it.
       *
       * The card used to be a tall left column against the attribute sheet, which meant the three
       * attribute groups sat in a block and the fourth dropped underneath: an L, and an L reads as
       * a layout that ran out of room. Identity is a band now and the sheet is a full-width row of
       * four, so the card is two rectangles and every group is the same width as every other.
       */}
      <div className="grid min-w-0 gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
        {/*
         * The dossier column: their name, their face, and what they want, in that order.
         *
         * Name on top, the painting under it, everything else under that: what they want, what
         * they carry, what they cost, and the door. The face used to be a 96px thumbnail tucked
         * beside the heading, which is a stamp on a form; this screen asks one question about one
         * person, so the person is the column. Board's layout.
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
           * something set into the card instead of an image dropped on top of one. Full column
           * width at 4:5, which is about two and a half times what it was.
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
           * This slot held "What they are after": an ambition and a moral compass, two personality
           * tags that told a player something true about the character and nothing at all about
           * what hiring them would do. The perks are the opposite, and they are the reason to read
           * this card rather than the one beside it.
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

          {/* The price and the door, stacked under the dossier: they are one decision and they
              belong with the person they are about, not across the card from them. */}
          <div className="flex min-w-0 flex-col gap-3">
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
                className="icon-plate flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-brass-300 [&_svg]:h-6 [&_svg]:w-6"
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
                  <span className="mt-1.5 font-display text-[20px] font-bold tabular-nums text-brass-100">
                    {(asking ?? 0).toLocaleString()} / wk
                  </span>
                )}
              </span>
            </div>

            <div className="min-w-0">{door}</div>
          </div>

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
         * It also comes out about as tall as the dossier beside it, so the card is a rectangle
         * with nothing empty in it rather than a tall left column against a short right one.
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
            <span className="tabular-nums text-ink-200">{officer.weeklyWage}</span> caps/wk
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
 * The Bar (GDD §H1): today's roster and the crew it has already given you.
 *
 * The roster is the same for every player on the same UTC day (§H2), which the header says out
 * loud: it is a shared room, not a personalised shortlist.
 */
