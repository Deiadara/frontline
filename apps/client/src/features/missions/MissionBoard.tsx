import {
  type Fleet,
  carriedSpeedPercent,
  VEHICLES,
  MISSION_STANCE_SPECS,
  findUnit,
  formatDuration,
  isCombatUnit,
  missionCarry,
  requiresOfficer,
  type Army,
  type CrewOfficer,
  type MissionArea,
  type MissionKind,
  type MissionOffer,
  type MissionStance,
} from '@frontline/shared';
import { useState } from 'react';
import { RewardLine } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { Dropdown } from '../../components/ui/Dropdown';
import { HoverCard } from '../../components/ui/HoverCard';
import { InfoWindow } from '../../components/ui/InfoWindow';
import { Modal } from '../../components/ui/Modal';
import { NumberField } from '../../components/ui/NumberField';
import { StepArrow } from '../../components/ui/StepArrow';
import { cn } from '../../lib/cn';

/**
 * The mission board, one area at a time (GDD §E4, §A4).
 *
 * Three jobs, side by side, and arrows to the next part of the city. That shape is the whole
 * change: the board used to be one scrolling grid of every job in the game, which said nothing
 * about *where* a crew was going and gave a player nothing to choose between. Now the choice is
 * two decisions stacked: which district is worth working, and which of its three jobs is worth
 * taking, knowing that taking one closes the other two until that crew is home.
 *
 * The arrows are the game's one stepper (`StepArrow`), the same pair the Bar puts either side of a
 * recruit, and they stop at the ends of the list for the reason written there.
 *
 * ## Nothing scrolls
 *
 * The inner board is a fixed three-column row and every section inside a card is a fixed height,
 * so `Leading` is on the same line on all three and the eye can compare across rather than down.
 * A player reading three offers is comparing them; a column that shifts because one brief is two
 * lines longer makes that comparison work.
 */

const KIND_LABEL: Record<MissionKind, string> = { standard: 'Standard', battle: 'Battle' };

/** Battles read hot, standard work reads cool: the §E5 risk difference at a glance. */
const KIND_STYLE: Record<MissionKind, string> = {
  standard: 'border-brass-300/50 text-brass-300',
  battle: 'border-oxblood-500/50 text-oxblood-300',
};

const STANCE_STYLE: Record<MissionStance, string> = {
  against_government: 'border-warning/50 text-warning',
  for_government: 'border-surface-500 text-ink-200',
  unaligned: 'border-surface-600 text-ink-300',
};

/** What a keyword on a card actually means, drawn rather than left to the operating system. */
const KIND_BLURB: Record<MissionKind, string> = {
  standard:
    'Work nobody is going to shoot at you for. It pays less than a fight, and it can be run by porters alone.',
  battle:
    'Somebody is on that ground and intends to stay there. It pays a premium, and it needs people who can fight.',
};

/**
 * A keyword, and the window that says what it is.
 *
 * `Combine Contract` and `Anti-Combine` are the two words on this screen a new player cannot
 * derive from anything else on it, and they were being shown as bare tags with an operating-system
 * tooltip at best. The sentences already existed in `MISSION_STANCE_SPECS`, written by whoever
 * designed the mechanic, and were on screen nowhere.
 */
function Keyword({
  label,
  title,
  body,
  className,
  eyebrow,
}: {
  label: string;
  title: string;
  body: string;
  className?: string;
  eyebrow: string;
}) {
  return (
    <HoverCard
      label={label}
      size="window"
      card={
        <InfoWindow eyebrow={eyebrow} title={title}>
          <p className="font-body text-[14px] leading-relaxed text-ink-100">{body}</p>
        </InfoWindow>
      }
    >
      <span
        className={cn(
          'inline-flex shrink-0 items-center rounded-sm border px-1.5 py-0.5 font-display text-[9px] font-bold uppercase tracking-[0.14em]',
          className,
        )}
      >
        {label}
      </span>
    </HoverCard>
  );
}

/**
 * The §G roster, in the three states the send window has to draw differently.
 *
 * "Loading" and "nobody" are not the same fact, and reading one as the other is the lie MOU-248
 * found: a fully staffed player told, on every hard job, to go and hire the officers they had.
 */
export type Roster =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; officers: readonly CrewOfficer[] };

export interface MissionBoardProps {
  areas: readonly MissionArea[];
  /** What is at home to send. */
  army: Army;
  /** §C3: what is parked in the Garage, for the send dialog's "what carries them" rows. */
  fleet: Fleet;
  roster: Roster;
  /** Every crew is out: no job on any board can be taken. */
  atCapacity: boolean;
  pendingTemplateId: string | null;
  /**
   * The last refusal, and which job it was for.
   *
   * Carried with its template rather than as a bare string, because the message has to land in
   * the card the player pressed: the board is three cards wide and a refusal under the wrong one
   * is a refusal nobody reads. Not keyed off `pending`, which is false again by the time the
   * server has answered.
   */
  refusal: { templateId: string; message: string } | null;
  onLaunch: (
    areaId: string,
    templateId: string,
    force: Army,
    officerId?: string,
    vehicles?: Fleet,
  ) => void;
}

/** A one-press amount beside a `NumberField`: drawn, because it is a note rather than a machine. */
function Quick({
  label,
  onClick,
  disabled,
  testId,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className="ink-box px-2 py-1 font-stamp text-[11px] leading-none text-brass-200 transition-colors hover:text-brass-100 disabled:opacity-40"
    >
      {label}
    </button>
  );
}

export function MissionBoard({
  areas,
  army,
  fleet,
  roster,
  atCapacity,
  pendingTemplateId,
  refusal,
  onLaunch,
}: MissionBoardProps) {
  const [index, setIndex] = useState(0);
  const [sending, setSending] = useState<MissionOffer | null>(null);

  if (areas.length === 0) {
    return (
      <p className="px-4 py-8 text-center font-display text-[11px] uppercase tracking-[0.2em] text-ink-300">
        Nowhere is hiring. Scout something.
      </p>
    );
  }

  // Clamped rather than wrapped on the state itself: the list of open areas changes under this
  // component whenever a district is scouted or taken, and an index left past the end would render
  // an empty board rather than the last one.
  const at = Math.min(index, areas.length - 1);
  const area = areas[at] as MissionArea;

  /*
   * Where a press would land, and it is the *only* statement of the bounds on purpose.
   *
   * The board stops at the ends rather than rolling round, the same as the Bar's roster: an arrow
   * that wraps never tells a player they have seen every area, so a board of four reads as a board
   * of infinitely many and they keep pressing. The first version of that fix wrote the rule twice,
   * once as a clamp here and once as a `disabled` expression on each arrow, and a test could not
   * tell them apart: reintroducing the wrap left the arrows disabled, so nothing moved and the
   * gate stayed green over a component that had gone back to wrapping. One function answers both
   * questions now, so breaking it breaks something a test can see.
   */
  const boardAfter = (delta: number): number => Math.max(0, Math.min(areas.length - 1, at + delta));
  const step = (delta: number) => setIndex(boardAfter(delta));

  return (
    <div className="flex flex-col" data-testid="mission-board">
      {/* Where you are, and the way out either side of it. */}
      <header className="flex items-center gap-3 border-b border-surface-700 px-4 py-3">
        <StepArrow
          direction="back"
          label="Previous area"
          size="small"
          testId="board-left"
          disabled={boardAfter(-1) === at}
          onStep={() => step(-1)}
        />
        <div className="min-w-0 flex-1 text-center">
          <h3
            className="truncate font-display text-base font-bold uppercase tracking-[0.16em] text-brass-300"
            data-testid="board-area"
          >
            {area.name}
          </h3>
          <p className="mt-0.5 truncate font-body text-[12px] leading-snug text-ink-300">
            {area.blurb}
          </p>
        </div>
        <StepArrow
          direction="on"
          label="Next area"
          size="small"
          testId="board-right"
          disabled={boardAfter(1) === at}
          onStep={() => step(1)}
        />
      </header>

      <div className="flex items-center justify-between gap-3 border-b border-surface-700 px-4 py-2">
        <span className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
          Board <span className="tabular-nums text-ink-200">{at + 1}</span> of{' '}
          <span className="tabular-nums text-ink-200">{areas.length}</span>
        </span>
        <span className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
          {area.payPercent > 0 ? (
            <>
              Ground pays{' '}
              <span className="tabular-nums text-brass-300">+{Math.round(area.payPercent)}%</span>
            </>
          ) : (
            'Standing rate'
          )}
        </span>
      </div>

      {area.offers.length === 0 ? (
        <p
          className="px-4 py-10 text-center font-body text-[13px] leading-relaxed text-ink-300"
          data-testid="area-worked"
        >
          One of your crews is working this area. Nothing else here is on offer until they are home.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-3 p-4">
          {area.offers.map((offer) => (
            <OfferCard
              key={offer.templateId}
              offer={offer}
              disabled={atCapacity}
              pending={pendingTemplateId === offer.templateId}
              refusal={refusal?.templateId === offer.templateId ? refusal.message : null}
              onSend={() => setSending(offer)}
            />
          ))}
        </div>
      )}

      {sending && (
        <SendDialog
          offer={sending}
          areaName={area.name}
          army={army}
          fleet={fleet}
          roster={roster}
          onClose={() => setSending(null)}
          onSend={(force, officerId, vehicles) => {
            onLaunch(area.id, sending.templateId, force, officerId, vehicles);
            setSending(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * One job, in a card whose every section is a fixed height.
 *
 * The heights are what make three cards comparable: the brief, the clock, the haul and the
 * keywords each occupy the same band on all three, so `Leading` and the button underneath it are
 * always on the same line. A card that sized itself to its own content would put the deploy button
 * of a two-line brief above the deploy button of a three-line one, and the player would be
 * comparing layouts instead of jobs.
 */
function OfferCard({
  offer,
  disabled,
  pending,
  refusal,
  onSend,
}: {
  offer: MissionOffer;
  disabled: boolean;
  pending: boolean;
  refusal: string | null;
  onSend: () => void;
}) {
  return (
    <article
      className="card-paper washed edge-lit flex min-w-0 flex-col rounded-sm border border-surface-700 p-3"
      data-testid={`offer-${offer.templateId}`}
    >
      <h4 className="h-9 min-w-0 break-words font-display text-[13px] font-semibold uppercase leading-tight tracking-[0.12em] text-ink-100">
        {offer.name}
      </h4>

      <p className="h-16 min-w-0 overflow-hidden break-words font-body text-[12px] leading-snug text-ink-300">
        {offer.brief}
      </p>

      {/* The clock, broken out the way §E8 asks for it: two legs and the work between them. */}
      <dl className="mt-1 grid h-14 grid-cols-2 gap-x-2 border-y border-surface-700/70 py-1.5">
        <Cell label="Travel" value={formatDuration(offer.travelMinutes)} hint="each way, ×2" />
        <Cell label="On site" value={formatDuration(offer.durationMinutes)} hint="the job" />
      </dl>
      <div className="flex h-7 items-center justify-between gap-2">
        <span className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
          Round trip
        </span>
        <span className="font-display text-[13px] font-bold tabular-nums text-brass-300">
          {formatDuration(offer.totalMinutes)}
        </span>
      </div>

      {/* Tall enough for a payout that wraps, at the narrowest card the board ever draws.
       *
       * The band is a fixed height because every band on this card is, and that is also how a card
       * comes to overlap itself: the Deep Expedition pays six resources, which is one row of chips
       * at 1600px, two at 1280 and *three* in a 300px card at 1024, and a band sized for one put
       * its own last line straight through the experience row below.
       *
       * 7rem is the measured worst case (109px) plus a little. It is sized to the widest payout
       * the catalogue can produce at the narrowest card, because the whole point of the fixed
       * heights is that the row beneath never moves, at any width. */}
      <div className="flex h-28 flex-col gap-1 overflow-hidden border-t border-surface-700/70 pt-1.5">
        <span className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
          Expected haul
        </span>
        <RewardLine rewards={offer.rewards} />
        <span
          className="font-display text-[10px] uppercase tracking-[0.14em] text-ink-300"
          data-tip="Loot slots. Send enough bags or you leave some of it on the floor"
        >
          <span className="tabular-nums text-ink-200">{offer.payoutSlots}</span> to carry
        </span>
      </div>

      {/* §I1: what the crew learns from it, which is half of what a job is worth and was on no
          screen at all. Both figures, because a run that comes home empty still pays a fifth and
          a player choosing between a safe job and a risky one is choosing between those two. */}
      <div
        className="flex h-7 items-center justify-between gap-2 border-t border-surface-700/70 pt-1.5"
        data-tip={`${offer.failedXp.toLocaleString()} XP even if it goes wrong`}
      >
        <span className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
          Experience
        </span>
        <span className="font-display text-[12px] font-bold tabular-nums text-hextech-100">
          +{offer.xp.toLocaleString()}
          <span className="ml-1 font-display text-[10px] uppercase tracking-[0.14em] text-ink-300">
            / {offer.failedXp.toLocaleString()} lost
          </span>
        </span>
      </div>

      {/* The keywords, where the loot line used to be, and each one says what it means. */}
      <div className="flex h-8 flex-wrap content-start items-start gap-1 pt-1.5">
        <Keyword
          label={KIND_LABEL[offer.kind]}
          title={KIND_LABEL[offer.kind]}
          body={KIND_BLURB[offer.kind]}
          className={KIND_STYLE[offer.kind]}
          eyebrow="Kind of work"
        />
        {offer.stance !== 'unaligned' && (
          <Keyword
            label={MISSION_STANCE_SPECS[offer.stance].label}
            title={MISSION_STANCE_SPECS[offer.stance].label}
            body={MISSION_STANCE_SPECS[offer.stance].description}
            className={STANCE_STYLE[offer.stance]}
            eyebrow="Who is paying"
          />
        )}
      </div>

      {refusal && (
        <p
          role="alert"
          className="h-10 overflow-hidden break-words text-[11px] leading-snug text-oxblood-300"
        >
          {refusal}
        </p>
      )}

      <div className="mt-auto pt-2">
        <Button
          size="sm"
          className="w-full"
          variant={offer.kind === 'battle' ? 'danger' : 'primary'}
          disabled={disabled || pending}
          onClick={onSend}
          data-testid={`send-${offer.templateId}`}
        >
          {pending ? 'Sending…' : disabled ? 'No crew free' : 'Send a crew'}
        </Button>
      </div>
    </article>
  );
}

function Cell({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate font-display text-[9px] uppercase tracking-[0.16em] text-ink-300">
        {label}
      </dt>
      <dd className="truncate font-display text-[13px] font-bold tabular-nums text-ink-100">
        {value}
      </dd>
      <dd className="truncate font-display text-[9px] uppercase tracking-[0.14em] text-ink-300">
        {hint}
      </dd>
    </div>
  );
}

/**
 * Who goes (§A5, §E).
 *
 * A window rather than a row of steppers on the card, because picking a crew is a decision with
 * two numbers in it and neither fits in a third of a board: how many bodies can be spared, and
 * whether they can carry what the job pays. Both are drawn here against the job's own figure, so
 * the answer to "did I send enough" is on screen before the crew leaves rather than in the report.
 */
function SendDialog({
  offer,
  areaName,
  army,
  fleet,
  roster,
  onClose,
  onSend,
}: {
  offer: MissionOffer;
  areaName: string;
  army: Army;
  /** §C3: what is parked in the Garage and could carry them there. */
  fleet: Fleet;
  roster: Roster;
  onClose: () => void;
  onSend: (force: Army, officerId?: string, vehicles?: Fleet) => void;
}) {
  const officers = roster.status === 'ready' ? roster.officers : [];
  const [force, setForce] = useState<Army>({});
  const [riding, setRiding] = useState<Fleet>({});
  const [pickedId, setPickedId] = useState('');

  const available = Object.entries(army)
    .flatMap(([unitId, count]) => {
      const unit = findUnit(unitId);
      return unit && count > 0 ? [{ unit, count }] : [];
    })
    .sort((a, b) => a.unit.name.localeCompare(b.unit.name));

  const going = Object.values(force).reduce((total, count) => total + count, 0);
  const carry = missionCarry(force);
  // What the machines picked are worth against the crew picked: see `carriedSpeedPercent`.
  const ridingSpeed = Math.round(carriedSpeedPercent(riding, going));
  const fighters = Object.entries(force).some(
    ([unitId, count]) => count > 0 && isCombatUnit(unitId),
  );
  const needsFighters = offer.kind === 'battle' && !fighters;

  const leader =
    officers.find((officer) => officer.officerId === pickedId) ??
    (requiresOfficer(offer.difficulty) ? officers[0] : undefined);
  const unled = requiresOfficer(offer.difficulty) && leader === undefined;

  const set = (unitId: string, value: number, max: number) => {
    const clamped = Math.max(0, Math.min(max, Math.trunc(value)));
    setForce((current) => {
      const next = { ...current };
      if (clamped === 0) delete next[unitId];
      else next[unitId] = clamped;
      return next;
    });
  };

  return (
    <Modal onClose={onClose} size="wide" labelledBy="send-crew-title">
      <div className="flex flex-col gap-3 p-4">
        <div>
          <h2
            id="send-crew-title"
            className="font-display text-[15px] font-bold uppercase tracking-[0.16em] text-brass-300"
          >
            {offer.name}
          </h2>
          <p className="mt-1 font-body text-[13px] leading-relaxed text-ink-200">
            {areaName} · {formatDuration(offer.totalMinutes)} there and back. Pick who goes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-y border-surface-700 py-2">
          <Readout label="Going" value={String(going)} />
          <Readout
            label="Can carry"
            value={String(Math.round(carry))}
            tone={carry >= offer.payoutSlots ? 'good' : 'warn'}
          />
          <Readout label="Job pays" value={`${offer.payoutSlots} slots`} />
        </div>

        {available.length === 0 ? (
          <p className="py-6 text-center font-body text-[13px] text-ink-300">
            Nobody is at home. Train somebody first.
          </p>
        ) : (
          <ul className="flex max-h-[18rem] flex-col gap-1 overflow-y-auto">
            {available.map(({ unit, count }) => (
              <li
                key={unit.id}
                className="flex items-center gap-3 rounded-sm border border-surface-700 bg-surface-950/40 px-3 py-1.5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-100">
                    {unit.name}
                  </span>
                  <span className="block font-display text-[10px] uppercase tracking-[0.14em] text-ink-300">
                    {count} at home · carries {unit.stats.lootCapacity}
                    {isCombatUnit(unit) ? '' : ' · cannot fight'}
                  </span>
                </span>
                {/* Half and Max beside the field.
                    Sending everybody, or half of them, are the two amounts a player actually picks
                    on a carrier row, and stepping to them one arrow-press at a time on a stack of
                    forty scavengers is not a decision, it is typing. The field itself still takes a
                    typed number and still has its steppers. */}
                <span className="flex shrink-0 items-center gap-1">
                  <Quick
                    label="Half"
                    disabled={count < 2}
                    testId={`half-${unit.id}`}
                    onClick={() => set(unit.id, Math.floor(count / 2), count)}
                  />
                  <Quick
                    label="Max"
                    disabled={count < 1}
                    testId={`max-${unit.id}`}
                    onClick={() => set(unit.id, count, count)}
                  />
                  <NumberField
                    label={`How many ${unit.name}`}
                    value={force[unit.id] ?? 0}
                    min={0}
                    max={count}
                    onChange={(value) => set(unit.id, value, count)}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}

        <label className="flex flex-col gap-1">
          <span className="font-display text-[10px] uppercase tracking-[0.18em] text-ink-300">
            Leading
          </span>
          {roster.status !== 'ready' ? (
            /*
             * Three states, and the two that are not "ready" are said out loud rather than drawn
             * as an empty list. A roster still in flight is not an empty roster, and a read that
             * failed is neither: both used to render as "nobody on the books", which told a fully
             * staffed player to go and hire the officers they already had.
             */
            <p className="font-body text-[13px] text-ink-300" data-testid="roster-state">
              {roster.status === 'loading'
                ? 'Reading the roster…'
                : 'Could not read your officers.'}
            </p>
          ) : officers.length === 0 ? (
            <p className="font-body text-[13px] text-ink-300" data-testid="roster-state">
              Nobody on your books. Hire one at the Bar.
            </p>
          ) : (
            <Dropdown
              label={`Officer leading ${offer.name}`}
              value={leader?.officerId ?? ''}
              onChange={setPickedId}
              options={[
                ...(requiresOfficer(offer.difficulty)
                  ? []
                  : [{ value: '', label: 'Nobody: send them alone' }]),
                ...officers.map((officer) => ({
                  value: officer.officerId,
                  label: officer.name,
                })),
              ]}
              data-testid="send-leader"
            />
          )}
        </label>

        {/*
         * §C3: what carries them there.
         *
         * Under the crew rather than beside it, because it is a decision made *after* the one
         * above: how many seats you need is a fact about how many people you are sending. Drawn
         * only when the yard has something in it, so a crew without a Garage sees the dialog it
         * has always seen.
         *
         * The saving is quoted live and against the force actually picked, because an empty seat
         * buys nothing: sending two people in a war hauler is a truck full of air, and the number
         * says so before the crew leaves rather than in the report afterwards.
         */}
        {Object.values(fleet).some((count) => (count ?? 0) > 0) && (
          <div className="flex flex-col gap-1.5" data-testid="mission-vehicles">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-display text-[11px] uppercase tracking-[0.18em] text-brass-300">
                What carries them
              </span>
              <span className="font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
                {ridingSpeed > 0 ? (
                  <>
                    <span className="tabular-nums text-brass-300">{ridingSpeed}%</span> off the road
                  </>
                ) : (
                  'On foot'
                )}
              </span>
            </div>
            <ul className="flex flex-col gap-1">
              {VEHICLES.filter((spec) => (fleet[spec.id] ?? 0) > 0).map((spec) => (
                <li
                  key={spec.id}
                  className="flex items-center justify-between gap-2 rounded-sm border border-surface-600/70 px-2.5 py-1.5"
                >
                  <span className="min-w-0 font-display text-[12px] text-ink-200">
                    {spec.name}
                    <span className="ml-1.5 text-[10px] uppercase tracking-[0.12em] text-ink-400">
                      seats {spec.capacity}
                    </span>
                  </span>
                  <NumberField
                    label={`How many ${spec.name}`}
                    value={riding[spec.id] ?? 0}
                    min={0}
                    max={fleet[spec.id] ?? 0}
                    onChange={(value) => setRiding((held) => ({ ...held, [spec.id]: value }))}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}

        {unled && (
          <p role="alert" className="font-body text-[12px] text-oxblood-300">
            That job is too hard to run without an officer leading it.
          </p>
        )}
        {needsFighters && (
          <p role="alert" className="font-body text-[12px] text-oxblood-300">
            Somebody there has to be able to fight. Porters do not go in alone.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Not yet
          </Button>
          <Button
            variant={offer.kind === 'battle' ? 'danger' : 'primary'}
            disabled={going === 0 || unled || needsFighters}
            onClick={() => onSend(force, leader?.officerId, riding)}
            data-testid="confirm-send"
          >
            Send them
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Readout({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
        {label}
      </span>
      <span
        className={cn(
          'font-display text-[15px] font-bold tabular-nums',
          tone === 'good'
            ? 'text-verdigris-100'
            : tone === 'warn'
              ? 'text-warning'
              : 'text-ink-100',
        )}
      >
        {value}
      </span>
    </span>
  );
}
