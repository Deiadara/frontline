import {
  type Fleet,
  BATTLE_TIER_LABELS,
  LEADER_HOLD_LABELS,
  ATTRIBUTE_LABELS,
  IMPORTANCE_LABELS,
  IMPORTANCE_WEIGHT,
  LEANING_PROFILES,
  MISSION_LEANING_LABELS,
  MISSION_LEANING_REASONS,
  UNLED_PENALTY,
  VEHICLES,
  battleOdds,
  bestLeader,
  composeProfile,
  enemyStrength,
  fieldStrength,
  findUnit,
  fleetCapacity,
  formatDuration,
  hastenedMinutes,
  hastenedRoadMinutes,
  isCombatUnit,
  leaderFit,
  missionCarry,
  missionOdds,
  missionTimings,
  ridingUnitSlots,
  standsInLine,
  UNIT_RULE_IDS,
  type Army,
  type BlueprintCategory,
  type MissionArea,
  type UnitRuleId,
  type AttributeImportance,
  type AttributeName,
  type LineRules,
  type MissionKind,
  type MissionLeaning,
  type MissionLeader,
  type MissionOffer,
  type UnitLoadouts,
  type UnitsResponse,
  type UnledRule,
  vehicleNoun,
} from '@frontline/shared';
import { useMemo, useState } from 'react';
import { RewardLine } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { Dropdown } from '../../components/ui/Dropdown';
import { HoverCard } from '../../components/ui/HoverCard';
import { InfoWindow } from '../../components/ui/InfoWindow';
import { Modal } from '../../components/ui/Modal';
import { NumberField } from '../../components/ui/NumberField';
import { StepArrow } from '../../components/ui/StepArrow';
import { cn } from '../../lib/cn';
import { walksAlways } from '../units/rules';
import { readColumn } from '../battle/column';
import { UnitCard } from '../units/UnitCard';
import { MissionGauge, type GaugeReading } from './MissionGauge';

/**
 * §F1b: how a promised page reads on the card, by category and no further.
 *
 * Keyed on `BlueprintCategory` rather than on a hand-written copy of the same three strings, so a
 * fourth category is a compile error here rather than an `undefined` on a card.
 */
const PAGE_PRIZE_LABELS: Readonly<Record<BlueprintCategory, string>> = {
  unit: "A unit blueprint's page",
  upgrade: "An upgrade blueprint's page",
  consumable: "A consumable blueprint's page",
};

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
 * A bare tag with an operating-system tooltip at best is not an explanation, and the words on this
 * card are ones a new player cannot derive from anything else on it. It carried the stance labels
 * as well until 2026-09-12; those are gone and the kind of work is what is left.
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
 * What a job wants said about it in one line of chips.
 *
 * A standard job says what it leans on, which is the reader's half of the leader picker: a player
 * who can see that a run is a long road understands why the navigator's fit is 71% and the raid
 * boss's is 22%. A battle says its tier and nothing else. What a battle actually fields is the
 * job's secret, and a tier is the most the screen is allowed to give away about it.
 */
/**
 * How long this run takes, for the column that is actually being sent (maintainer request, 2026-09-12).
 *
 * It used to be a clause in the header: "1h 25m there and back **at most**". The "at most" was
 * meaningless to read, because the clock beside it was already exact: `clockMinutes` runs the
 * launch's own `hastenedRoadMinutes` over the chosen units and the chosen machines, so the moment
 * anybody is picked it is the real figure, and calling it a ceiling invited a player to assume the
 * run would come in quicker. The one state where it genuinely is a ceiling is an empty column,
 * where `columnSpeed` returns 0 and the road comes back at its full base length: nobody picked
 * reads as a unit that cannot move, which is the slowest the run can possibly be.
 *
 * So: the exact time once anybody is going, the worst case before that, and the label says which
 * of the two is on screen. Drawn at the foot of the leader column, right-aligned under it, where
 * it sits level with the leaning chips and moves every time the roster below it changes.
 */
function RoundTrip({ minutes, going }: { minutes: number; going: number }) {
  const picked = going > 0;
  return (
    <div className="mt-auto flex flex-col items-end pt-2" data-testid="round-trip">
      <span className="font-display text-[10px] uppercase tracking-[0.18em] text-ink-300">
        {picked ? 'Total roundtrip time' : 'At most, with nobody picked'}
      </span>
      <span
        className={cn(
          'font-display text-[26px] font-bold leading-none tabular-nums tracking-[0.04em]',
          picked ? 'text-brass-300' : 'text-ink-300',
        )}
        data-testid="round-trip-clock"
      >
        {formatDuration(minutes)}
      </span>
    </div>
  );
}

interface JobChipSpec {
  readonly label: string;
  /** Set on a leaning chip, which explains itself on hover. Null on a battle tier, which does not. */
  readonly leaning: MissionLeaning | null;
}

function jobChips(offer: MissionOffer): readonly JobChipSpec[] {
  if (offer.kind === 'battle' && offer.battleTier !== null) {
    return [{ label: BATTLE_TIER_LABELS[offer.battleTier], leaning: null }];
  }
  return offer.leanings.map((leaning) => ({ label: MISSION_LEANING_LABELS[leaning], leaning }));
}

/**
 * One of those chips. Battles read hot here for the same reason the kind tag does.
 *
 * A leaning opens a window saying which attributes the job reads and why (maintainer request,
 * 2026-09-12). The chips were a row of words a player had to already know: `Quiet work` is only
 * advice if it also says that it is asking for stealth, and that a leader without it gets caught.
 * The attribute list comes from the same `LEANING_PROFILES` the leader picker scores against, so
 * the window cannot promise something the arithmetic does not do.
 */
function JobChip({ label, leaning, hot }: JobChipSpec & { hot: boolean }) {
  const chip = (
    <span
      className={cn(
        // Bigger than they were (maintainer, 2026-09-19): at 9px in a 1.5/0.5 box, A HAUL and
        // SALVAGE were the smallest type on a window whose whole left column is about what kind
        // of job this is.
        'inline-flex shrink-0 items-center rounded-sm border px-2 py-1 font-display text-[10px] uppercase tracking-[0.12em]',
        hot ? 'border-oxblood-500/50 text-oxblood-300' : 'border-surface-600 text-ink-300',
      )}
    >
      {label}
    </span>
  );
  if (leaning === null) return chip;
  return (
    <HoverCard label={label} size="window" card={<LeaningWindow label={label} leaning={leaning} />}>
      {chip}
    </HoverCard>
  );
}

/** What one leaning wants: the sentence, then the attributes it reads, hardest first. */
function LeaningWindow({ label, leaning }: { label: string; leaning: MissionLeaning }) {
  const wants = Object.entries(LEANING_PROFILES[leaning])
    .map(([name, importance]) => ({
      name: ATTRIBUTE_LABELS[name as AttributeName],
      importance,
    }))
    .sort((a, b) => IMPORTANCE_WEIGHT[b.importance] - IMPORTANCE_WEIGHT[a.importance]);

  return (
    <InfoWindow eyebrow="What it leans on" title={label}>
      <p className="font-body text-[14px] leading-relaxed text-ink-100">
        {MISSION_LEANING_REASONS[leaning]}
      </p>
      <ul className="mt-2 space-y-0.5 border-t border-surface-700/70 pt-2">
        {wants.map((want) => (
          <li key={want.name} className="flex items-baseline justify-between gap-3">
            <span className="font-display text-[10px] uppercase tracking-[0.14em] text-ink-200">
              {want.name}
            </span>
            <span
              className={cn(
                'font-display text-[9px] uppercase tracking-[0.14em]',
                IMPORTANCE_TONE[want.importance],
              )}
            >
              {IMPORTANCE_LABELS[want.importance]}
            </span>
          </li>
        ))}
      </ul>
    </InfoWindow>
  );
}

/** The same three tones the officer sheet paints importance in, so one word means one thing. */
const IMPORTANCE_TONE: Record<AttributeImportance, string> = {
  irreplaceable: 'text-brass-300',
  essential: 'text-ink-100',
  useful: 'text-ink-300',
  insignificant: 'text-ink-400',
};

/** How a leader is described beside their name. The Overseer is not on the books; officers are. */
const LEADER_KIND_LABEL: Readonly<Record<MissionLeader['kind'], string>> = {
  overseer: 'Overseer',
  officer: 'Officer',
};

const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;

/**
 * Why a name in the picker cannot be taken, and when it can be.
 *
 * The reason is the server's own (`held`), not a guess off the board: a leader can be held by a
 * run, a declared fight, a scouting party or a bed, and "out until they are back" said none of
 * them and was wrong about a fight, which has no clock at all. Where the server knows the mark
 * (`heldUntil`) the row counts down to it, so a player deciding whether to wait can see how long
 * the wait is.
 */
function holdHint(leader: MissionLeader, now: Date): string {
  if (leader.held === null) return '';
  const label = LEADER_HOLD_LABELS[leader.held];
  if (leader.heldUntil === null) return label;
  // The server's clock, like every other countdown on this page (`useServerClock`): a machine an
  // hour fast would otherwise have the picker and the run card beside it disagreeing about the
  // same officer by an hour.
  const minutes = Math.ceil((Date.parse(leader.heldUntil) - now.getTime()) / 60_000);
  return minutes > 0 ? `${label}, back in ${formatDuration(minutes)}` : label;
}

export interface MissionBoardProps {
  areas: readonly MissionArea[];
  /** What is at home to send. */
  army: Army;
  /** §C3: what is parked in the Garage, for the send dialog's "what carries them" rows. */
  fleet: Fleet;
  /** §C3: the crew's brackets. The armour line takes speed off a sheet, so the road reads them. */
  loadouts: UnitLoadouts;
  /** Everybody who could lead a run, the Overseer first. Somebody out is drawn and not offered. */
  leaders: readonly MissionLeader[];
  /** Whether a run may go out with nobody leading it, and on what terms. */
  unledRule: UnledRule;
  /** The player's level: what a battle job's tier fields is scaled by it (`enemyStrength`). */
  level: number;
  /**
   * The clock, corrected to the server's (`useServerClock`).
   *
   * The picker prints how long a held leader is held for, and that is a countdown like any other
   * on this page: read off `Date.now()` it would disagree with the run card two panels away by
   * whatever the player's machine is out by.
   */
  now: Date;
  /**
   * §A4: what the crew's holdings and perks add to every haul, as a percentage, and the marks they
   * have been granted. Both pay the settle (`missions/resolve.ts`), so the dialog's "loot they
   * could lift" has to read them or it quotes a smaller bag than the job brings home.
   */
  bagPercent: number;
  marks: Readonly<Record<string, readonly string[]>>;
  /**
   * The two crew switches that lift a hard rule off a unit sheet (`UnitsResponse`).
   *
   * Neither can ride on `effects`, which is a record of numbers, and the picker was drawing both
   * of them wrong off the catalogue: `carriersFight` is `carriers_fight`, which puts this crew's
   * porters in a line, and `anyRide` is `any_ride`, which gets a `no_ride` sheet into a truck.
   * The settle reads both (`missions/resolve.ts` passes the crew's whole fold), so a board that
   * read neither said "cannot fight" beside a unit that fights and quoted a road hours too long.
   */
  carriersFight: boolean;
  anyRide: boolean;
  /**
   * The roster, for the card a unit's name opens in the send window.
   *
   * A prop rather than a `useUnits()` inside the dialog, and the reason is testability: the
   * picker is a pure component that four test files render on their own, and reaching for a
   * query inside it made every one of them need a `QueryClientProvider` to draw a name. The
   * page above already reads `/units` for the two crew switches, so this costs nothing.
   */
  roster: UnitsResponse | undefined;
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
    leaderId?: string,
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
      className="ink-box px-2 py-1 font-stamp text-[11px] leading-none text-brass-300 transition-colors hover:text-brass-100 disabled:opacity-40"
    >
      {label}
    </button>
  );
}

export function MissionBoard({
  areas,
  army,
  fleet,
  loadouts,
  leaders,
  unledRule,
  level,
  now,
  bagPercent,
  marks,
  carriersFight,
  anyRide,
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
    <div className="flex flex-col xl:min-h-0 xl:flex-1" data-testid="mission-board">
      {/* Where you are, and the way out either side of it. */}
      {/* `py-2.5`, and the board count on this line rather than a row of its own (maintainer,
          2026-09-21): the page gained the crews-out line above the board, and a 34px row holding
          five words of small capitals was the cheapest thing on the screen to give back. */}
      <header className="flex items-center gap-3 border-b border-surface-700 px-4 py-1.5">
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
          <p className="truncate font-body text-[12px] leading-snug text-ink-300">{area.blurb}</p>
        </div>
        {/*
         * The area's pay premium used to sit under the header ("Ground pays +18%", or "Standing
         * rate" on the misc board). Removed at the maintainer's request (2026-09-10): the figure
         * is still folded into every haul on the cards below, so the header was saying the same
         * number a third time. `area.payPercent` stays on the wire for the cards and the launch
         * freeze. What is left of that row is the board count, here beside the arrow it belongs
         * to.
         */}
        <span className="shrink-0 font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
          Board <span className="tabular-nums text-ink-200">{at + 1}</span> of{' '}
          <span className="tabular-nums text-ink-200">{areas.length}</span>
        </span>
        <StepArrow
          direction="on"
          label="Next area"
          size="small"
          testId="board-right"
          disabled={boardAfter(1) === at}
          onStep={() => step(1)}
        />
      </header>

      {area.offers.length === 0 ? (
        <p
          className="px-4 py-10 text-center font-body text-[13px] leading-relaxed text-ink-300"
          data-testid="area-worked"
        >
          One of your crews is working this area. Nothing else here is on offer until they are home.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-3 p-2 xl:min-h-0 xl:flex-1">
          {/*
           * The grid takes the slack the header leaves, so the cards finish on the same line as the
           * crews beside them. `items-stretch` is the grid default and is what carries it into the
           * cards: each one is `h-full`, and the haul band inside is the part that grows.
           */}
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
          loadouts={loadouts}
          leaders={leaders}
          unledRule={unledRule}
          level={level}
          now={now}
          bagPercent={bagPercent}
          marks={marks}
          carriersFight={carriersFight}
          anyRide={anyRide}
          roster={roster}
          onClose={() => setSending(null)}
          onSend={(force, leaderId, vehicles) => {
            onLaunch(area.id, sending.templateId, force, leaderId, vehicles);
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
      className="card-paper washed edge-lit flex h-full min-w-0 flex-col rounded-sm border border-surface-700 p-2.5"
      data-testid={`offer-${offer.templateId}`}
    >
      {/* Some of these bands gave up a few pixels on 2026-09-21, when the crews-out line arrived
          above the board: the brief's floor is a three-line brief, and the rows under it are one
          line of their own face plus their padding.

          The title is **not** one of them, and the 4px it was going to give were put back the
          same day. Measured, the longest name the catalogue can deal ("Checkpoint Shakedown" and
          "Reservoir Expedition", both 20 characters) wraps to two lines and fills exactly 32px of
          a 32px box at every width the game is drawn at: an `h-8` here is not a band with a tight
          fit, it is a band with none, and the first name a character longer sits on the brief. */}
      <h4 className="h-9 min-w-0 break-words font-display text-[13px] font-semibold uppercase leading-tight tracking-[0.12em] text-ink-100 xl:text-[14px]">
        {offer.name}
      </h4>

      <p className="h-16 min-w-0 overflow-hidden break-words font-body text-[12px] leading-snug text-ink-300 xl:h-auto xl:min-h-[3.5rem] xl:flex-1 xl:text-[13px]">
        {offer.brief}
      </p>

      {/* The clock, broken out the way §E8 asks for it: two legs and the work between them. */}
      <dl className="mt-1 grid h-14 grid-cols-2 gap-x-2 border-y border-surface-700/70 py-1.5">
        <Cell label="Travel" value={formatDuration(offer.travelMinutes)} hint="each way, ×2" />
        <Cell label="On site" value={formatDuration(offer.durationMinutes)} hint="the job" />
      </dl>
      <div className="flex h-6 items-center justify-between gap-2">
        <span className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
          Round trip
        </span>
        <span className="font-display text-[13px] font-bold tabular-nums text-brass-300 xl:text-[14px]">
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
      {/* 7rem, and 8 from `xl`. The band was sized for a card a third of the board at full width.
          From `xl` the board shares the sheet with the crews in flight, the cards are a fifth
          narrower, a six-resource haul wraps one row deeper, and the page badge under it went 8px
          past the fold. Below `xl` the board has the whole width and the old height still fits: at
          1024x768 the extra rem pushed the card's own bottom tags under the fold of the screen.
          Fixed either way, for the same reason as before: three cards, one line of buttons. */}
      {/* A line shorter than it was (2026-09-21): the loot-slot count sits on the label's own
          line, right of it, rather than on a line of its own under the chips. That is 20px off
          the band in every case, the six-resource worst case included, so the fixed heights come
          down by the same: 6rem and 6.75rem where they were 7 and 8. */}
      <div className="flex h-24 shrink-0 flex-col gap-1 overflow-hidden border-t border-surface-700/70 pt-1.5 xl:h-[6.75rem]">
        <span className="flex items-baseline justify-between gap-2 font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
          <span>Expected haul</span>
          <span
            className="shrink-0 tracking-[0.14em]"
            data-tip="Loot slots. Send enough bags or you leave some of it on the floor"
          >
            <span className="tabular-nums text-ink-200">{offer.payoutSlots}</span> loot slots to
            carry
          </span>
        </span>
        <RewardLine rewards={offer.rewards} />
        {/* §F1b: the category, and never the page. Which sheet it turns out to be is not decided
            until the crew is home, so a card that named it would turn a run into a shopping trip
            and the anticipation is most of what the reward is. */}
        {offer.pagePrize !== null && (
          <span
            className="font-display text-[10px] uppercase tracking-[0.14em] text-brass-300"
            data-testid={`page-prize-${offer.templateId}`}
            data-tip="Which page it is, you find out when they get back"
          >
            {PAGE_PRIZE_LABELS[offer.pagePrize]}
          </span>
        )}
      </div>

      {/* §I1: what the crew learns from it, which is half of what a job is worth and was on no
          screen at all. Both figures, because a run that comes home empty still pays a fifth and
          a player choosing between a safe job and a risky one is choosing between those two. */}
      <div
        className="flex h-6 items-center justify-between gap-2 border-t border-surface-700/70 pt-1.5"
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
      </div>

      {/* What the job leans on, or a battle's tier: the one line on the card about *who should
          lead it*. Fixed height and clipped like every other band here, because a four-leaning
          job wraps to two rows and the deploy buttons across three cards stay on one line. */}
      <div
        className="flex h-9 flex-wrap content-start items-start gap-1 overflow-hidden pt-1.5"
        data-testid={`job-chips-${offer.templateId}`}
      >
        {jobChips(offer).map((chip) => (
          <JobChip
            key={chip.label}
            label={chip.label}
            leaning={chip.leaning}
            hot={offer.kind === 'battle'}
          />
        ))}
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
 * two numbers in it and neither fits in a third of a board: how many units can be spared, and
 * whether they can carry what the job pays. Both are drawn here against the job's own figure, so
 * the answer to "did I send enough" is on screen before the crew leaves rather than in the report.
 */
function SendDialog({
  offer,
  areaName,
  army,
  fleet,
  loadouts,
  leaders,
  unledRule,
  level,
  now,
  bagPercent,
  marks,
  carriersFight,
  anyRide,
  roster,
  onClose,
  onSend,
}: {
  offer: MissionOffer;
  areaName: string;
  army: Army;
  /** §C3: what is parked in the Garage and could carry them there. */
  fleet: Fleet;
  /** §C3: the crew's brackets, folded into the pace the same way the launch folds them. */
  loadouts: UnitLoadouts;
  leaders: readonly MissionLeader[];
  unledRule: UnledRule;
  level: number;
  /** The server's clock, for the wait printed beside a leader somebody else has. */
  now: Date;
  /** §A4: what the crew's holdings and perks add to every haul, as a percentage. */
  bagPercent: number;
  /** ...and the marks they have been granted, which can add `picker` to a sheet that lacks it. */
  marks: Readonly<Record<string, readonly string[]>>;
  /** §E: this crew's porters stand in a line (`carriers_fight`), so "cannot fight" is not true. */
  carriersFight: boolean;
  /** §C3: this crew's machines seat anything (`any_ride`), so a Colossus does not walk. */
  anyRide: boolean;
  /** §A5: the sheets, for the card a unit's name opens. Undefined draws the name bare. */
  roster: UnitsResponse | undefined;
  onClose: () => void;
  onSend: (force: Army, leaderId?: string, vehicles?: Fleet) => void;
}) {
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
  /*
   * This crew's own reading of a unit sheet, which is what the settle uses.
   *
   * One object rather than a copy per reader: the haul asks it whether a granted `picker` is on
   * the Haulers, and the roster row asks it whether a porter stands in the line. They were two
   * literals and the second one did not exist, which is how `carriers_fight` ended up labelled
   * "cannot fight" on the one screen that decides who goes.
   */
  const lineRules: LineRules = {
    carriersFight,
    // Narrowed against the catalogue rather than asserted: the payload is a record of strings, and
    // a mark this build has never heard of is one the arithmetic must not pretend to understand.
    unitMarks: Object.fromEntries(
      Object.entries(marks).map(([unitId, granted]) => [
        unitId,
        granted.filter((mark): mark is UnitRuleId =>
          (UNIT_RULE_IDS as readonly string[]).includes(mark),
        ),
      ]),
    ),
  };
  // With the crew's brackets, as the settle pays it (`missions/resolve.ts` passes the same map):
  // a Counterweight Harness on the Haulers was being quoted a smaller bag than the job paid.
  // ...and with the crew's own bag on top of them. `lootCapacityPercent` (the Pawn Shop, the raid
  // modifications, `sig_scavenger_king`) and granted `picker` marks both pay the settle, so a board
  // that read the printed sheet quoted a smaller haul than the job brought home.
  const carry = missionCarry(force, loadouts, bagPercent, lineRules);
  /*
   * §C3: the machines actually being driven, with the zeros taken out.
   *
   * `setRiding` writes `{...held, [id]: value}` and a stepper taken back to nothing leaves the
   * key behind with a zero in it. `FleetSchema` is a partial record of **positive** integers, so
   * that payload came back from the launch as `Too small: expected number to be >0 at
   * vehicles.motorcycle`: a refusal with a zod path in it, for a crew that had simply changed its
   * mind about a bike. Cleaned once, here, and everything below reads the clean one.
   */
  const fleetOut: Fleet = Object.fromEntries(
    Object.entries(riding).filter(([, count]) => (count ?? 0) > 0),
  );
  /** §C3: whether anything is being driven at all, which is what makes "walks" worth saying. */
  const anyRiding = Object.keys(fleetOut).length > 0;

  /*
   * §C3: the seats are the ceiling, on this board as well as in the deploy window.
   *
   * The rule the maintainer asked for on 2026-09-19 has two halves and they pull in opposite
   * directions, which is why both are written here rather than left to one clamp:
   *
   * - **Going up, the stepper stops at what fits.** A crew that has picked a truck cannot then
   *   pick more people than it seats.
   * - **Going the other way, nothing is taken back.** Adding a machine *after* the people are
   *   picked must not silently drop anybody: "it doesn't change the units, you have to do that
   *   yourself until the button is clickable". So an overloaded column is a refusal with a
   *   sentence on it, not a quiet edit.
   *
   * Priced through `fleetCapacity` and `ridingUnitSlots`, the same two functions the launch and
   * the settle spend, so the window cannot stop a batch the server would take or take one it
   * would refuse.
   */
  const seats = fleetCapacity(fleetOut);
  const aboard = ridingUnitSlots(force, anyRide);
  const capped = seats > 0;
  const overloaded = capped && aboard > seats;
  /*
   * §C3: what this crew travels at, which is the pace of its slowest group.
   *
   * `columnSpeed` is the server's own function (`missions/launch.ts` runs it over the same force
   * and the same machines), so what the dialog quotes is what the launch charges. It replaced
   * `carriedSpeedPercent`, which averaged the machines' percentages weighted by the seats they
   * filled: two bikes in front of forty walkers made all forty measurably faster, and they do not.
   * They arrive first and wait.
   */
  const column = readColumn(fleetOut, force, loadouts, anyRide);
  const fighters = Object.entries(force).some(
    ([unitId, count]) => count > 0 && isCombatUnit(unitId),
  );
  const needsFighters = offer.kind === 'battle' && !fighters;

  /*
   * Who leads it, and what that is worth.
   *
   * The job's leanings compose into one profile (`composeProfile`), every leader is scored
   * against it (`leaderFit`), and the odds are `missionOdds` and nothing else: the same function
   * the launch is priced with, so the dial cannot quote a figure the server does not charge.
   *
   * Nobody is picked by default. That is the state the unled rule is about, and defaulting to the
   * first name on the list would hide it behind a choice the player never made.
   */
  const profile = useMemo(() => composeProfile(offer.leanings), [offer.leanings]);
  const free = leaders.filter((one) => one.held === null);
  const leader = free.find((one) => one.id === pickedId) ?? null;
  const best = bestLeader(free, profile);

  /*
   * The cut this run gets, exactly as `launchMission` works it out.
   *
   * The ground's share plus the officer's, added and then spent once, rather than each taken off
   * separately. The dialog used to know about neither: it applied the column's pace to
   * `offer.travelMinutes`, a figure the board had already reduced and rounded, which rounded twice
   * where the launch rounds once, and it could not see `arrivalPercent` at all. A run led by
   * somebody with Short Way was quoted up to ten per cent long, on the one line the maintainer asked to
   * be exact. See `MissionOfferSchema.rawTravelMinutes`.
   *
   * The Overseer's `arrivalPercent` is zero, because the launch pays that cut only to an officer.
   */
  const runSpeedPercent = offer.speedPercent + Math.max(0, leader?.arrivalPercent ?? 0);

  /*
   * The clock, with the machines two sections below already taken off it.
   *
   * `offer.totalMinutes` is the bare template: `missions/board.ts` builds the board with
   * `templateTimings`. The launch runs `hastenedRoadMinutes(TRAVEL_BAND_MINUTES[band],
   * missionSpeedPercent + carried)` on the road, so the dialog was printing "3h 20m there and back"
   * beside "-55% off the road" and neither number described the run.
   *
   * The road only, exactly as the launch does it: a van gets a crew to the site sooner and does not
   * make the work go faster. This is an **upper bound**, and says so: the crew's own
   * `missionSpeedPercent` and any delegation terms come off it as well, and neither is on this
   * payload. Both only ever shorten it, so the run is this or quicker, never longer.
   */
  /*
   * One leg, held in one place, because two lines print it.
   *
   * The round trip at the foot of the leader column and the "on the road" figure beside the
   * machines are the same walk, and they used to be worked out twice: this one from the raw band,
   * that one from `offer.travelMinutes` with the column's pace over it and no reduction at all.
   * A run with an officer on Short Way had the two disagreeing by minutes in one open dialog.
   */
  const oneWayMinutes = hastenedRoadMinutes(offer.rawTravelMinutes, column.speed, runSpeedPercent);
  const clockMinutes = missionTimings({
    travelMinutes: oneWayMinutes,
    durationMinutes: hastenedMinutes(offer.rawDurationMinutes, runSpeedPercent),
  }).totalMinutes;
  const odds = missionOdds({
    authored: offer.authoredChance,
    leader: leader?.attributes ?? null,
    profile,
    unled: unledRule,
  });

  /*
   * A battle is banded, never numbered: the crew fights a force it cannot see, with the real
   * engine, so the honest reading is how what is being sent compares with what the tier fields at
   * this level. The leader's edge rides in as a share of the force, and `odds.edge` is the right
   * number for it either way: a leader's own edge when there is one, the unled penalty when there
   * is not.
   */
  const reading: GaugeReading =
    offer.kind === 'battle' && offer.battleTier !== null
      ? {
          kind: 'battle',
          odds: battleOdds({
            ours: fieldStrength(force),
            theirs: enemyStrength(offer.battleTier, level),
            edge: odds.edge,
          }),
        }
      : { kind: 'chance', chance: odds.chance };
  const gaugeLabel = reading.kind === 'battle' ? 'How the fight looks' : 'Chance it comes off';

  /*
   * What the seats leave for one sheet, on top of what is at home.
   *
   * The other rows' claim is `aboard` less this row's own, so raising a row never counts itself
   * twice, and a sheet that will not ride (`no_ride` without the waiver) is never measured
   * against the seats at all. Returns `atHome` untouched when nothing is loaded, which is the
   * walk and has no ceiling.
   */
  const ceilingFor = (unitId: string, atHome: number): number => {
    if (!capped) return atHome;
    const slots = Math.max(1, findUnit(unitId)?.unitSlots ?? 1);
    if (ridingUnitSlots({ [unitId]: 1 }, anyRide) === 0) return atHome;
    const others = aboard - (force[unitId] ?? 0) * slots;
    return Math.min(atHome, Math.max(0, Math.floor((seats - others) / slots)));
  };

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
    <Modal onClose={onClose} size="broad" labelledBy="send-crew-title">
      {/*
       * Header, unit, footer, and only the unit scrolls.
       *
       * The window is taller than it was: the dial and the leader picker are a section of their
       * own now. At 1280x720 a flat column of everything in here is taller than the frame allows
       * (`max-h-[calc(100vh-2rem)]`), and the first thing off the bottom of a dialog that cannot
       * scroll is the pair of buttons that dismisses it. Pinning those and scrolling the middle is
       * the only arrangement where the way out is on screen at every viewport.
       */}
      <div className="flex min-h-0 flex-col">
        <div className="flex flex-col gap-3 px-4 pb-3 pt-4">
          <div>
            <h2
              id="send-crew-title"
              className="font-display text-[15px] font-bold uppercase tracking-[0.16em] text-brass-300"
            >
              {offer.name}
            </h2>
            <p className="mt-1 font-body text-[13px] leading-relaxed text-ink-200">{areaName}</p>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-y border-surface-700 py-2">
            <Readout label="Going" value={String(going)} />
            <Readout
              label="Can carry"
              value={`${Math.round(carry)} loot slots`}
              tone={carry >= offer.payoutSlots ? 'good' : 'warn'}
            />
            <Readout label="Job pays" value={`${offer.payoutSlots} loot slots`} />
          </div>
        </div>

        {/*
         * The whole of the middle scrolls, inside a frame (maintainer, 2026-09-19).
         *
         * Two things were wrong and they were one thing. The unit list carried its own
         * `max-h-[18rem] overflow-y-auto` *inside* this scroller, so the window had a scroller
         * within a scroller and a wheel over the roster moved whichever one the pointer happened
         * to be on. And this box ran edge to edge under the header with nothing drawn at its top,
         * so content scrolling up "disappeared into nowhere" rather than under a visible edge.
         *
         * One scroller now, bounded by a ruled box with its own inset, so the top and the bottom
         * of what moves are both drawn.
         */}
        <div className="min-h-0 flex-1 px-4 pb-1">
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-sm border border-surface-600/70 bg-surface-950/30">
            <div
              className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3"
              data-testid="send-scroll"
            >
              {/*
               * The odds, and the one decision that moves them.
               *
               * Side by side because they are one thought: the dial answers "how does this look" and
               * the picker beside it is the only control on this screen that changes the answer
               * without changing who goes. The chips under the dial are why a given name fits.
               */}
              <div className="grid gap-4 sm:grid-cols-[13.75rem_minmax(0,1fr)]">
                <div className="flex min-w-0 flex-col items-center gap-2">
                  <span className="font-display text-[10px] uppercase tracking-[0.18em] text-ink-300">
                    {gaugeLabel}
                  </span>
                  <MissionGauge reading={reading} label={gaugeLabel} />
                  <ul className="flex flex-wrap justify-center gap-1" data-testid="job-leanings">
                    {jobChips(offer).map((chip) => (
                      <li key={chip.label}>
                        <JobChip
                          label={chip.label}
                          leaning={chip.leaning}
                          hot={offer.kind === 'battle'}
                        />
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex min-w-0 flex-col gap-2">
                  <span className="font-display text-[10px] uppercase tracking-[0.18em] text-ink-300">
                    Leading
                  </span>
                  {leaders.length === 0 ? (
                    <p className="font-body text-[13px] text-ink-300" data-testid="roster-state">
                      Nobody on your books. Hire one at the Bar.
                    </p>
                  ) : (
                    <>
                      <Dropdown
                        label={`Who leads ${offer.name}`}
                        value={leader?.id ?? ''}
                        onChange={setPickedId}
                        placeholder="Nobody yet"
                        options={[
                          ...(unledRule === 'forbidden'
                            ? []
                            : [{ value: '', label: 'Nobody: send them alone' }]),
                          ...leaders.map((one) => ({
                            value: one.id,
                            label: one.name,
                            // The kind, and what they are worth *on this job*: a raid boss and a
                            // navigator are different people on a long road, and the percentage is
                            // the only place that difference is a number before the crew leaves.
                            hint:
                              one.held !== null
                                ? `${LEADER_KIND_LABEL[one.kind]} · ${holdHint(one, now)}`
                                : `${LEADER_KIND_LABEL[one.kind]} · fits this job ${percent(
                                    leaderFit(one.attributes, profile).fit,
                                  )}`,
                            disabled: one.held !== null,
                          })),
                        ]}
                        data-testid="send-leader"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={best === null}
                        onClick={() => best && setPickedId(best.id)}
                        data-testid="best-leader"
                      >
                        Use the most suitable leader for this job
                      </Button>
                    </>
                  )}
                  {leader !== null && (
                    <p
                      className="font-display text-[11px] uppercase tracking-[0.14em] text-ink-300"
                      data-testid="leader-fit"
                    >
                      {LEADER_KIND_LABEL[leader.kind]} · fits this job{' '}
                      <span className="tabular-nums text-brass-300">
                        {percent(leaderFit(leader.attributes, profile).fit)}
                      </span>
                    </p>
                  )}
                  {/*
                   * What going unled costs, in the three states the research leaves it in. Free says
                   * nothing at all: a rule the crew has bought out of is not news on every job.
                   */}
                  {leader === null && unledRule === 'forbidden' && (
                    <p
                      role="alert"
                      className="font-body text-[12px] leading-snug text-oxblood-300"
                      data-testid="unled-note"
                    >
                      Nobody leads this. Research unled runs, or send somebody.
                    </p>
                  )}
                  {leader === null && unledRule === 'penalised' && (
                    <p
                      className="font-body text-[12px] leading-snug text-warning"
                      data-testid="unled-note"
                    >
                      Nobody leading them, which is{' '}
                      <span className="tabular-nums">{Math.round(UNLED_PENALTY * 100)}</span> points
                      off the odds.
                    </p>
                  )}
                  <RoundTrip minutes={clockMinutes} going={going} />
                </div>
              </div>

              {available.length === 0 ? (
                <p className="py-6 text-center font-body text-[13px] text-ink-300">
                  Nobody is at home. Train somebody first.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5" data-testid="mission-units">
                  {/* Titled like the Vehicles block under it, because they are the same kind of
                  decision and only one of them used to say what it was. */}
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-display text-[11px] uppercase tracking-[0.18em] text-brass-300">
                      Units
                    </span>
                    <span className="font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
                      <span className="tabular-nums text-brass-300">{going}</span> going
                    </span>
                  </div>
                  <ul className="flex flex-col gap-1">
                    {available.map(({ unit, count }) => (
                      <li
                        key={unit.id}
                        className="flex items-center gap-3 rounded-sm border border-surface-700 bg-surface-950/40 px-3 py-1.5"
                      >
                        <span className="min-w-0 flex-1">
                          {/* §A5: the sheet, on hover, the way the deploy window and the roster
                              already offer it. Deciding who goes is exactly the moment a player
                              wants to read a unit's numbers, and this was the one picker in the
                              game where the name was just a name. */}
                          <UnitName unitId={unit.id} name={unit.name} roster={roster} />
                          <span className="block font-display text-[10px] uppercase tracking-[0.14em] text-ink-300">
                            {count} at home · carries {unit.stats.lootCapacity} loot slots
                            {/* §E: the sheet says a porter cannot fight and `carriers_fight` says this
                          crew's can. The settle reads the crew (`standsInLine`), so the row does
                          too: a Scavenger that is going to stand in the line must not be labelled
                          as one that will not. */}
                            {standsInLine(unit, lineRules) ? '' : ' · cannot fight'}
                            {/* §C3: this one is not getting on the truck, so the column waits for it.
                          Only worth saying once something is loaded: with nothing picked everybody
                          walks and the note is noise on every row. */}
                            {anyRiding && walksAlways(unit.id, anyRide) && (
                              <span className="text-oxblood-300" data-testid={`walks-${unit.id}`}>
                                {' · '}walks
                              </span>
                            )}
                          </span>
                        </span>
                        {/* Half and Max beside the field.
                      Sending everybody, or half of them, are the two amounts a player actually
                      picks on a carrier row, and stepping to them one arrow-press at a time on a
                      stack of forty scavengers is not a decision, it is typing. The field itself
                      still takes a typed number and still has its steppers. */}
                        <span className="flex shrink-0 items-center gap-1">
                          <Quick
                            label="Half"
                            disabled={count < 2}
                            testId={`half-${unit.id}`}
                            onClick={() =>
                              set(unit.id, Math.floor(count / 2), ceilingFor(unit.id, count))
                            }
                          />
                          <Quick
                            label="Max"
                            disabled={count < 1}
                            testId={`max-${unit.id}`}
                            onClick={() => set(unit.id, count, ceilingFor(unit.id, count))}
                          />
                          <NumberField
                            label={`How many ${unit.name}`}
                            value={force[unit.id] ?? 0}
                            min={0}
                            max={ceilingFor(unit.id, count)}
                            onChange={(value) => set(unit.id, value, ceilingFor(unit.id, count))}
                          />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/*
               * §C3: what carries them there.
               *
               * Under the crew rather than beside it, because it is a decision made *after* the one
               * above: how many seats you need is a fact about how many people you are sending. Drawn
               * only when the yard has something in it, so a crew without a Garage sees the dialog it
               * has always seen.
               *
               * The saving is quoted live and against the force actually picked, because an empty seat
               * buys nothing: sending two people in a thirty-seat bus is a run mostly full of air, and
               * the number says so before the crew leaves rather than in the report afterwards.
               */}
              {Object.values(fleet).some((count) => (count ?? 0) > 0) && (
                <div className="flex flex-col gap-1.5" data-testid="mission-vehicles">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-display text-[11px] uppercase tracking-[0.18em] text-brass-300">
                      Vehicles
                    </span>
                    <span
                      className="font-display text-[11px] uppercase tracking-[0.14em] text-ink-300"
                      data-testid="mission-column"
                    >
                      {column.speed > 0 ? (
                        <>
                          {column.heldBy === null ? 'Rides at' : 'Held to'}{' '}
                          <span className="tabular-nums text-brass-300">{column.speed}</span>
                          {column.heldBy !== null && <> by {column.heldBy}</>}
                          {' · '}
                          {formatDuration(oneWayMinutes)} on the road
                        </>
                      ) : (
                        'Nobody picked yet'
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
                            {spec.capacity} unit slots
                          </span>
                        </span>
                        <NumberField
                          label={`How many ${vehicleNoun(spec.name)}`}
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
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-surface-700 px-4 pb-4 pt-3">
          {needsFighters && (
            <p role="alert" className="font-body text-[12px] text-oxblood-300">
              Somebody there has to be able to fight. Porters do not go in alone.
            </p>
          )}
          {/* §C3: picked the people first and the truck second. Said rather than fixed: the
              maintainer's rule is that the window does not quietly put anybody back. */}
          {overloaded && (
            <p
              role="alert"
              className="font-body text-[12px] text-oxblood-300"
              data-testid="mission-overloaded"
            >
              They do not all fit. <span className="tabular-nums">{aboard}</span> unit slots picked
              and <span className="tabular-nums">{seats}</span> seats loaded: take somebody off, or
              bring another machine.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Not yet
            </Button>
            <Button
              variant={offer.kind === 'battle' ? 'danger' : 'primary'}
              disabled={going === 0 || !odds.allowed || needsFighters || overloaded}
              onClick={() => onSend(force, leader?.id, fleetOut)}
              data-testid="confirm-send"
            >
              Send them
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/**
 * A unit's name, opening its card.
 *
 * Keyed off the id rather than handed a `UnitOption`, because the picker's own list is built from
 * the catalogue and the roster is a separate read that may not have landed yet. No option, no
 * card, and the name renders exactly as it always did.
 */
function UnitName({
  unitId,
  name,
  roster,
}: {
  unitId: string;
  name: string;
  roster: UnitsResponse | undefined;
}) {
  const label = (
    <span className="block truncate font-display text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-100">
      {name}
    </span>
  );
  const option = roster?.units.find((one) => one.id === unitId);
  if (!option || !roster) return label;
  return (
    <HoverCard
      label={name}
      size="card"
      className="w-full min-w-0"
      card={
        <UnitCard
          unit={option}
          garrisoned={roster.garrisoned[unitId] ?? 0}
          abroad={roster.abroad[unitId] ?? 0}
          carriersFight={roster.carriersFight ?? false}
        />
      }
    >
      {label}
    </HoverCard>
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
