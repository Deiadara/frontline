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
import { useState, type ReactNode } from 'react';
import { AttributeSheet } from '../overseer/AttributeSheet';
import { Button } from '../../components/ui/Button';
import { DescribedTag } from '../../components/ui/DescribedTag';
import { Icon, type IconName } from '../../components/ui/Icon';
import { Modal } from '../../components/ui/Modal';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import { RATING_FILL, RATING_TEXT, ratingBand, ratingPercent } from '../../lib/rating';
import { useBar, useHireRecruit, useIncreasePayroll, useReleaseOfficer } from '../../lib/queries';
import { InfoNote, PageShell } from '../game/PageShell';
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
 * One name on the rail: who they are, and the one word that says whether to sit down.
 *
 * The room used to be a grid of full cards, each carrying the whole thirty-three-attribute sheet.
 * Ten of those is a page nobody reads top to bottom: the question a player is answering as they
 * scan the room is "which of these is worth an evening", and the sheet is what they open to answer
 * "is this one". So the rail carries the name, the post they would take and the price, and the
 * sheet lives in the middle of the screen where it has the width to be read.
 */
function RecruitRow({
  recruit,
  selected,
  now,
  onSelect,
}: {
  recruit: BarRecruit;
  selected: boolean;
  now: Date;
  onSelect: () => void;
}) {
  const cold = coldFor(recruit, now);
  const state = recruit.hired ? (
    <span className="text-bile-300">Signed</span>
  ) : cold !== null ? (
    <span className="text-oxblood-300">Back in {cold}</span>
  ) : !recruit.assessment.interested ? (
    <span className="text-oxblood-300">Not talking</span>
  ) : (
    <span className="tabular-nums text-brass-300">{recruit.askingWage ?? 0}/wk</span>
  );

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-testid={`recruit-row-${recruit.id}`}
      className={cn(
        // The same lit left edge the Training and Research rails use.
        'flex w-full items-center gap-3 border-l-[3px] py-2.5 pl-2.5 pr-3 text-left transition-all duration-150',
        selected
          ? 'border-brass-300 bg-brass-300/10'
          : 'border-transparent hover:border-iris-300/60 hover:bg-surface-800/70',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'icon-plate flex h-9 w-9 shrink-0 items-center justify-center rounded-sm [&_svg]:h-5 [&_svg]:w-5',
          selected ? 'text-brass-300' : 'text-ink-300',
        )}
      >
        <Icon name="crew" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block break-words font-stamp text-[13px] leading-[1.15] text-ink-100">
          {recruit.name}
        </span>
        <span className="block font-display text-[10px] uppercase tracking-[0.12em] text-ink-300">
          {MORAL_COMPASS_SPECS[recruit.moralCompass].label}
        </span>
      </span>
      <span className="shrink-0 font-display text-[10px] uppercase tracking-[0.12em]">{state}</span>
    </button>
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
  onNegotiate,
}: RecruitCardProps) {
  const open = OFFICER_ROLES.filter((role) => !filledRoles.includes(role));
  const asking = recruit.askingWage;
  // Whether their opening price fits what is left of the book. Shown before the conversation
  // rather than after it, because a fee that cannot be committed is not a fee worth haggling over.
  const fits = asking === null || asking <= payrollLeft;
  const cold = coldFor(recruit, now);

  return (
    <article
      className="card-paper washed rivets edge-lit flex min-w-0 flex-col gap-3 rounded-sm border border-surface-500/70 p-4 shadow-panel"
      data-testid={`recruit-${recruit.id}`}
    >
      <header className="flex min-w-0 items-start justify-between gap-3">
        {/* The stamped face and a real size: this is a *name*, and it is the heading of the one
            file on screen rather than one card of ten. */}
        <h3
          className="min-w-0 break-words font-stamp text-[20px] leading-tight text-ink-100"
          data-testid="recruit-name"
        >
          {recruit.name}
        </h3>
        {recruit.hired ? (
          <Tag label="On your books" className="border-bile-300/50 text-bile-300" />
        ) : recruit.assessment.interested ? (
          <Tag label={`${asking ?? 0} caps/wk`} className="border-brass-300/50 text-brass-300" />
        ) : (
          <Tag label="Not talking" className="border-oxblood-500/50 text-oxblood-300" />
        )}
      </header>

      <Disposition ambition={recruit.ambition} moralCompass={recruit.moralCompass} />

      {/* Four columns, because this sheet now has a full-width pane to itself. At two, each
          group column is ~590px wide and the fixed short track strands at the far right with a
          hand's width of nothing between it and its label. */}
      <AttributeSheet attributes={recruit.attributes} columns={4} />

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

      {recruit.requirement.minNotoriety > 0 && (
        <p className="min-w-0 break-words font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
          Will sit down with a crew the street calls{' '}
          <span className="text-ink-200">{notorietyTier(recruit.requirement.minNotoriety)}</span>
        </p>
      )}

      {recruit.requirement.minLevel > 1 && (
        <p className="min-w-0 break-words font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
          And a crew that has reached{' '}
          <span className="text-ink-200">level {recruit.requirement.minLevel}</span>
        </p>
      )}

      {recruit.hired ? null : cold !== null ? (
        /*
         * A chair this crew walked out of. Six hours, and their price has already gone up ten
         * percent for the next conversation, which is the half that persists: see
         * `standoffAfterWalkout`.
         */
        <div className="mt-auto flex min-w-0 flex-col gap-1 pt-1">
          <p className="min-w-0 break-words font-stamp text-[14px] leading-snug text-oxblood-300">
            You walked out on them.
          </p>
          <p className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
            Back in {cold} · their price is up {recruit.standoff?.walkouts ?? 1}0%
          </p>
        </div>
      ) : recruit.assessment.interested ? (
        <div className="mt-auto flex min-w-0 flex-col gap-2 pt-1">
          {negotiation !== undefined && !negotiation.closed && (
            <p className="min-w-0 break-words font-stamp text-[14px] leading-snug text-brass-100">
              Mid-conversation. They are asking {negotiation.standing.toLocaleString()} a week.
            </p>
          )}
          {agreed !== null && (
            <p
              className="min-w-0 break-words text-[12px] leading-relaxed text-verdigris-100"
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
            size="sm"
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
            <p className="text-[12px] leading-relaxed text-oxblood-300">
              Your payroll will not stretch to {asking.toLocaleString()} a week. Raise it at the
              Nexus.
            </p>
          )}
        </div>
      ) : (
        <ul className="mt-auto flex min-w-0 flex-col gap-1 pt-1">
          {recruit.assessment.blockers.map((blocker) => (
            <li
              key={blocker}
              className="min-w-0 break-words font-display text-[10px] uppercase tracking-[0.16em] text-oxblood-300/80"
            >
              {BLOCKER_LABEL[blocker]}
            </li>
          ))}
        </ul>
      )}
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
/** A door on the top strip: a plated mark, a name, and the one figure behind it. */
function DeskButton({
  icon,
  label,
  value,
  tone = 'ink',
  onOpen,
  testId,
}: {
  icon: IconName;
  label: string;
  value: ReactNode;
  tone?: 'ink' | 'warn';
  onOpen: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={testId}
      className={cn(
        'door-tile flex items-center gap-2.5 rounded-md border px-3 py-2 transition-all duration-150',
        'hover:-translate-y-0.5 hover:border-brass-300 focus-visible:outline-none',
        tone === 'warn' ? 'border-oxblood-500/60' : 'border-surface-500/70',
      )}
    >
      <span aria-hidden className="relative z-[2] text-brass-300 [&_svg]:h-[18px] [&_svg]:w-[18px]">
        <Icon name={icon} />
      </span>
      <span className="relative z-[2] flex flex-col items-start leading-none">
        <span className="font-display text-[10px] font-bold uppercase tracking-[0.16em] text-ink-300">
          {label}
        </span>
        <span className="mt-1 font-display text-[13px] font-bold tabular-nums text-ink-100">
          {value}
        </span>
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
            setTalkingTo((open) => (open === recruitId ? null : open));
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

  const [selected, setSelected] = useState<string | null>(null);
  const [desk, setDesk] = useState<'payroll' | 'crew' | null>(null);
  // The one in the middle: whatever was clicked, or the first person in the room.
  const shown = recruits.find((recruit) => recruit.id === selected) ?? recruits[0];

  return (
    <PageShell
      quote="Everyone in here is for hire. The trick is working out what they are worth before they tell you."
      wide
      fills
    >
      {/*
       * One screen: the room down the left, whoever is being read in the middle, and the two
       * things that are *about the crew rather than the room* behind doors on the strip.
       *
       * It was a scrolling column of three panels, and the recruits were the third of them: ten
       * cards, each carrying the whole thirty-three-attribute sheet, so the room a player came
       * here for started two screens down and the sheet they came to read was in a 61px column.
       */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <DeskButton
          icon="caps"
          label="Payroll"
          value={`${data?.payroll.available ?? 0} left`}
          onOpen={() => setDesk('payroll')}
          testId="open-payroll"
        />
        <DeskButton
          icon="crew"
          label="Your crew"
          value={`${data?.slotsUsed ?? 0} / ${data?.slotsTotal ?? 0}`}
          tone={full ? 'warn' : 'ink'}
          onOpen={() => setDesk('crew')}
          testId="open-crew"
        />
        <span className="ml-auto font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
          {full ? (
            <span className="text-warning">No room for another</span>
          ) : signedToday ? (
            <span className="text-warning" data-testid="daily-hire-limit">
              Signed somebody today. Back tomorrow
            </span>
          ) : (
            <>Tonight, {data?.day ?? ''}</>
          )}
        </span>
        <InfoNote tone="warn" label="How the Bar works">
          Every crew in the city is reading this same list, and signing somebody takes them off it
          for all of them. You get one signature a day. So the question is never whether you can
          afford this person. It is whether they are the one worth spending today on.
        </InfoNote>
      </div>

      <div className="grid min-h-0 flex-1 items-stretch gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Panel title="In the room" className="min-h-0 flex-1 border border-surface-500/70">
          {barQuery.isLoading ? (
            <EmptyRow text="Reading the room…" />
          ) : (
            <ul
              className="min-h-0 flex-1 divide-y divide-surface-700 overflow-y-auto"
              data-testid="bar-room"
            >
              {recruits.map((recruit) => (
                <li key={recruit.id}>
                  <RecruitRow
                    recruit={recruit}
                    selected={recruit.id === shown?.id}
                    now={serverNow}
                    onSelect={() => setSelected(recruit.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="min-h-0 overflow-y-auto" data-testid="bar-file">
          {barQuery.isLoading ? (
            <EmptyRow text="Reading the room…" />
          ) : shown === undefined ? (
            <EmptyRow text="Nobody in tonight." />
          ) : (
            <RecruitCard
              recruit={shown}
              filledRoles={filledRoles}
              agreed={agreed[shown.id] ?? null}
              signedToday={signedToday}
              payrollLeft={data?.payroll.available ?? 0}
              full={full}
              negotiation={negotiationFor(shown.id)}
              now={serverNow}
              onNegotiate={setTalkingTo}
            />
          )}
        </div>
      </div>

      {desk === 'payroll' && (
        <PayrollDialog
          ledger={data?.payroll ?? null}
          caps={data?.caps ?? 0}
          onClose={() => setDesk(null)}
        />
      )}
      {desk === 'crew' && (
        <CrewDialog
          officers={officers}
          caps={data?.caps ?? 0}
          used={data?.slotsUsed ?? 0}
          total={data?.slotsTotal ?? 0}
          loading={barQuery.isLoading}
          onClose={() => setDesk(null)}
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
    </PageShell>
  );
}
