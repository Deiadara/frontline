import {
  type Fleet,
  FIGHT_CATEGORY_LABELS,
  LEADER_HOLD_LABELS,
  ATTRIBUTE_LABELS,
  IMPORTANCE_LABELS,
  IMPORTANCE_WEIGHT,
  LEANING_PROFILES,
  MISSION_LEANING_LABELS,
  VEHICLES,
  battleOdds,
  type BattleOdds,
  type FightLeaderQuoteRequest,
  type FightLeaderQuoteResponse,
  type FightLeaderRating,
  bestLeader,
  composeProfile,
  enemyStrength,
  fieldStrength,
  findUnit,
  fleetCapacity,
  formatDuration,
  hastenedMinutes,
  hastenedRoadMinutes,
  missionCarry,
  fightCategory,
  leaderMark,
  missionOdds,
  missionTimings,
  rampedTimings,
  ridingUnitSlots,
  standsInLine,
  RESOURCE_KG,
  carriedHome,
  payoutSlots,
  creditStores,
  describeWaste,
  type Army,
  type MissionArea,
  type AttributeImportance,
  type AttributeName,
  type MissionLeaning,
  type MissionLeader,
  type MissionOffer,
  type MissionRoad,
  type PartialResources,
  type Resources,
  type StoreCeilings,
  type UnitLoadouts,
  type UnitsResponse,
  vehicleNoun,
  meetsNotoriety,
  notorietyToField,
  notorietyTier,
  HOME_LOCKED_TEXT,
} from '@frontline/shared';
import { useEffect, useMemo, useState } from 'react';
import { RewardLine } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { Dropdown } from '../../components/ui/Dropdown';
import { HoverCard } from '../../components/ui/HoverCard';
import { Modal } from '../../components/ui/Modal';
import { NumberField } from '../../components/ui/NumberField';
import { QuickAmount } from '../../components/ui/QuickAmount';
import { StepArrow } from '../../components/ui/StepArrow';
import { cn } from '../../lib/cn';
import { walksAlways } from '../units/rules';
import { readColumn, shownPace } from '../battle/column';
import { UnitCard } from '../units/UnitCard';
import { DifficultyStamp } from './DifficultyStamp';
import { MissionGauge, type GaugeReading } from './MissionGauge';
import { crewLineRules } from './missionLines';
import { ErrorNote } from '../../components/ui/ErrorNote';

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

/**
 * What a job wants said about it in one line of chips.
 *
 * A plain job says what it leans on, which is the reader's half of the leader picker: a player
 * who can see that a run is a long road understands why the navigator's fit is 71% and the raid
 * boss's is 22%. A fight says its category (Skirmish, Battle, Siege or Mayhem) first. What a
 * fight actually fields is the job's secret, and the category is the most the screen is allowed
 * to give away about it.
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
  /** Set on a leaning chip, which explains itself on hover. Null on a fight's category, which does not. */
  readonly leaning: MissionLeaning | null;
}

/**
 * The chips under a job: a fight's category first (Skirmish, Battle, Siege, Mayhem), then what the
 * job leans on in its leader. A fight leans on the fight alone (maintainer, 2026-09-28), so its
 * row is the category and nothing else: who should lead it is settled by fighting it, not by
 * reading a sheet.
 */
function jobChips(offer: MissionOffer): readonly JobChipSpec[] {
  const leanings = offer.leanings
    .filter((leaning) => offer.kind !== 'battle' || leaning !== 'fight')
    .map((leaning) => ({ label: MISSION_LEANING_LABELS[leaning], leaning }));
  return offer.kind === 'battle'
    ? [{ label: FIGHT_CATEGORY_LABELS[fightCategory(offer.grade)], leaning: null }, ...leanings]
    : leanings;
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
  // A fight's category chip explains nothing on purpose: what it fields is the job's secret.
  if (leaning === null) return chip;
  return (
    <HoverCard label={label} size="tip" card={<LeaningWindow label={label} leaning={leaning} />}>
      {chip}
    </HoverCard>
  );
}

/**
 * What one leaning wants: the attributes it reads, hardest first, and nothing else.
 *
 * It carried an eyebrow, the leaning's sentence and the list (maintainer, 2026-09-23: keep the
 * title, a little bigger, and the attributes with how much they matter). The frame is the info
 * window's own so it reads as the same kind of thing, drawn at the size the list needs.
 */
function LeaningWindow({ label, leaning }: { label: string; leaning: MissionLeaning }) {
  const wants = Object.entries(LEANING_PROFILES[leaning])
    .map(([name, importance]) => ({
      name: ATTRIBUTE_LABELS[name as AttributeName],
      importance,
    }))
    .sort((a, b) => IMPORTANCE_WEIGHT[b.importance] - IMPORTANCE_WEIGHT[a.importance]);

  return (
    <div
      className="glass-strong painted washed rivets brushed relative min-w-[13rem] rounded-md border-2 border-brass-300/60 px-3.5 py-3 shadow-panel"
      data-testid="leaning-window"
    >
      <p className="font-stamp text-[17px] leading-tight text-brass-100">{label}</p>
      <ul className="mt-2 space-y-1 border-t border-surface-700/70 pt-2">
        {wants.map((want) => (
          <li key={want.name} className="flex items-baseline justify-between gap-4">
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
    </div>
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

/**
 * Why a name in the picker cannot be taken, and when it can be.
 *
 * The reason is the server's own (`held`), not a guess off the board: a leader can be held by a
 * run, a declared fight, the bench or a bed, and "out until they are back" said none of
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

/** A crew with nothing off its roads, which is what a board read without the figures quotes. */
const NO_ROAD: MissionRoad = { travelSpeedPercent: 0, roadMinutesOff: 0, unitSpeedPercent: 0 };

/**
 * The gauge's band off a rated leader: the share of practice fights won, in the same four words
 * `battleOdds` uses for a force it can only size. Undefined until the engine has answered.
 */
function fightBand(rating: FightLeaderRating | undefined): BattleOdds | undefined {
  if (!rating || rating.fights <= 0) return undefined;
  const share = rating.wins / rating.fights;
  if (share < 0.35) return 'low';
  if (share < 0.55) return 'moderate';
  if (share < 0.8) return 'good';
  return 'very_high';
}

/** What the crew holds and what its stores hold at most, for the send window's room check. */
export interface MissionStores {
  resources: Resources;
  ceilings: StoreCeilings;
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
  /**
   * Who should lead a fight, asked of the server for the force being filled in
   * (`quoteFightLeaders`). Optional, and its absence is what a board with no server behind it
   * gets: the bench reads "not rated yet" and the first free leader stands.
   */
  onQuoteFightLeaders?: (body: FightLeaderQuoteRequest) => Promise<FightLeaderQuoteResponse>;
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
  /**
   * The crew's rank, which decides who will take a contract from it (`notorietyToField`): the
   * launch refuses a party with anybody past it in, and the dialog let them be picked (bug pass,
   * 2026-10-02).
   */
  notoriety: number;
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
   * The crew's own cuts off every road it walks (`MissionRoadSchema`), which the launch spends on
   * the run's clock and the card cannot carry. Defaulted to none, the bare road.
   */
  road?: MissionRoad;
  /**
   * The roster, for the card a unit's name opens in the send window.
   *
   * A prop rather than a `useUnits()` inside the dialog, and the reason is testability: the
   * picker is a pure component that four test files render on their own, and reaching for a
   * query inside it made every one of them need a `QueryClientProvider` to draw a name. The
   * page above already reads `/units` for the two crew switches, so this costs nothing.
   */
  roster: UnitsResponse | undefined;
  /**
   * The stockpile and its ceilings, so the send window can say how much of the haul fits today
   * (maintainer ruling, 2026-09-28). Undefined until the crew has been read, and the window then
   * says nothing about room rather than guessing.
   */
  stores?: MissionStores | undefined;
  /** Every crew is out: no job on any board can be taken. */
  atCapacity: boolean;
  /**
   * §C2b: a standing order is on, so the whole board is the Right Hand's and nothing may be sent
   * by hand. The server refuses the launch as well; this is the screen saying so first.
   */
  automated: boolean;
  /** A raid lands on home within the hour, and the launch refuses every party until it has. */
  homeLocked?: boolean;
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
  /**
   * `card` is the offer as the player read it: the server launches exactly that card, named by
   * its board key and grade, or refuses (maintainer, 2026-09-29).
   */
  onLaunch: (
    areaId: string,
    card: Pick<MissionOffer, 'templateId' | 'boardKey' | 'grade'>,
    force: Army,
    leaderId: string,
    vehicles?: Fleet,
  ) => void;
}

export function MissionBoard({
  areas,
  army,
  fleet,
  loadouts,
  leaders,
  onQuoteFightLeaders,
  now,
  bagPercent,
  notoriety,
  marks,
  carriersFight,
  anyRide,
  road = NO_ROAD,
  roster,
  stores,
  atCapacity,
  automated,
  homeLocked = false,
  pendingTemplateId,
  refusal,
  onLaunch,
}: MissionBoardProps) {
  const [index, setIndex] = useState(0);
  const [sending, setSending] = useState<MissionOffer | null>(null);

  if (areas.length === 0) {
    return (
      <p className="px-4 py-8 text-center font-display text-[11px] uppercase tracking-[0.2em] text-ink-300">
        Nowhere is hiring. Take a place in a district and its board opens.
      </p>
    );
  }

  // Clamped rather than wrapped on the state itself: the list of open areas changes under this
  // component whenever a district is taken or lost, and an index left past the end would render
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
      <header className="flex items-center gap-3 border-b border-surface-700 px-4 py-1.5 xl:py-2">
        <StepArrow
          direction="back"
          label="Previous area"
          size="small"
          testId="board-left"
          disabled={boardAfter(-1) === at}
          onStep={() => step(-1)}
        />
        <div className="min-w-0 flex-1 text-center">
          {/* Bigger from `xl`, where the board has height to spare and the cards below give it up
              (maintainer, 2026-09-28). The blurb stays one line: `truncate` holds it there. */}
          <h3
            className="truncate font-display text-base font-bold uppercase tracking-[0.16em] text-brass-300 xl:text-[19px]"
            data-testid="board-area"
          >
            {area.name}
          </h3>
          <p
            className="truncate font-body text-[12px] font-semibold leading-snug text-ink-200 xl:mt-0.5 xl:text-[14px]"
            // A district's blurb runs past one line; the whole of it is on the hover.
            data-tip={area.blurb}
          >
            {area.blurb}
          </p>
        </div>
        {/*
         * Two things used to live on this line and both have gone.
         *
         * The area's pay premium went on 2026-09-10: the figure is folded into every haul on the
         * cards below, so the header was saying the same number a third time. `area.payPercent`
         * stays on the wire for the cards and the launch freeze.
         *
         * `Board 2 of 4` went on 2026-09-22, at the maintainer's request. The two arrows either
         * side already say there is more than one board and which way is which, and the board's
         * own name is in the middle of the line in capitals: the count was a third way of saying
         * where you are, in the smallest type on the screen, and it disabled the arrow at each
         * end anyway.
         */}
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
        /*
         * A worked area, said once and in the middle (maintainer, 2026-09-23). It was a line of
         * body text at the top of an empty board, which read as a caption on nothing. It is the
         * whole board's state, so it takes the board's whole frame: centred, in the pen the paper
         * screens are written in, inside the same hand-inked box the sheets around it wear.
         */
        <div className="flex flex-1 items-center justify-center p-6 xl:min-h-0">
          <p
            className="ink-frame card-paper washed grain relative max-w-md rounded-sm px-8 py-7 text-center font-stamp text-[19px] leading-snug text-brass-100 shadow-panel"
            data-testid="area-worked"
          >
            One of your crews is working this area. Nothing else here is on offer until they are
            home.
          </p>
        </div>
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
              disabled={atCapacity || automated || homeLocked}
              heldBy={
                automated ? 'The Right Hand has the board' : homeLocked ? HOME_LOCKED_TEXT : null
              }
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
          now={now}
          {...(onQuoteFightLeaders ? { onQuoteFightLeaders } : {})}
          bagPercent={bagPercent}
          notoriety={notoriety}
          marks={marks}
          carriersFight={carriersFight}
          anyRide={anyRide}
          road={road}
          roster={roster}
          stores={stores}
          onClose={() => setSending(null)}
          onSend={(force, leaderId, vehicles) => {
            onLaunch(area.id, sending, force, leaderId, vehicles);
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
export function OfferCard({
  offer,
  disabled = false,
  heldBy = null,
  pending = false,
  refusal = null,
  onSend = () => undefined,
  readOnly = false,
}: {
  /** Who has the board when it is disabled for a reason other than a full roster, or null. */
  heldBy?: string | null;
  offer: MissionOffer;
  disabled?: boolean;
  pending?: boolean;
  refusal?: string | null;
  onSend?: () => void;
  /**
   * The card as a thing to read rather than to act on (maintainer, 2026-09-23): the Monitor
   * shows a crew's job as the card it was chosen from, with no crew left to send.
   */
  readOnly?: boolean;
}) {
  return (
    <article
      className="card-paper washed edge-lit flex h-full min-w-0 flex-col rounded-sm border border-surface-700 p-2.5"
      data-testid={readOnly ? `offer-view-${offer.templateId}` : `offer-${offer.templateId}`}
      // A fight is red and plain work is not: the one mark of kind the card wears since the
      // Standard and Battle keywords came off it (maintainer, 2026-09-23).
      data-kind={offer.kind}
    >
      {/* Some of these bands gave up a few pixels on 2026-09-21, when the crews-out line arrived
          above the board: the brief's floor is a three-line brief, and the rows under it are one
          line of their own face plus their padding.

          The title is **not** one of them, and the 4px it was going to give were put back the
          same day. Measured, the longest name the catalogue can deal ("Checkpoint Shakedown" and
          "Reservoir Expedition", both 20 characters) wraps to two lines and fills exactly 32px of
          a 32px box at every width the game is drawn at: an `h-8` here is not a band with a tight
          fit, it is a band with none, and the first name a character longer sits on the brief. */}
      {/* Typed onto the order, the way a job handed across a table would be (maintainer,
          2026-09-28): the title and the brief in the typewriter face the paper screens use. */}
      {/* In the colour of the button that sends it (maintainer, 2026-09-28): red for a fight,
          brass for everything else. */}
      <h4
        className={cn(
          'h-10 min-w-0 break-words border-b border-surface-700/70 font-stamp text-[15px] uppercase leading-[1.2] tracking-[0.08em] xl:text-[17px]',
          offer.kind === 'battle' ? 'text-oxblood-300' : 'text-brass-300',
        )}
      >
        {offer.name}
      </h4>

      {/* Five tight lines below `xl`: the longest brief in the catalogue (154 characters) is four
          lines of the typewriter at 12px on the narrowest card, and a fifth once it runs round the
          stamp. From `xl` the brief takes the room left over. The rule parting it from the title
          is the title's own bottom edge, so it costs the band nothing. */}
      {/* The difficulty stamp sits in the brief's bottom right corner, like a stamp on a page
          (maintainer, 2026-09-28), and the text runs round it rather than under it. The
          zero-width float above it is as tall as the band less the stamp and its margins, which is
          what pushes the stamp to the bottom: a float cannot be sent there any other way. The
          margins are the room its tilt swings a corner into, since the band clips. */}
      <div
        className="mt-1 h-[4.75rem] min-w-0 overflow-hidden break-words font-stamp text-[12px] leading-tight text-ink-200 xl:h-auto xl:min-h-[3.5rem] xl:flex-1 xl:text-[14px] xl:leading-[1.3]"
        data-testid={`brief-${offer.templateId}`}
      >
        <span
          aria-hidden
          className="float-right h-[calc(100%-3.25rem)] w-0 xl:h-[calc(100%-4.5rem)]"
        />
        <DifficultyStamp
          mark={offer.grade}
          className="float-right clear-right my-1 ml-1.5 mr-1 h-11 w-[3.9rem] xl:h-16 xl:w-[5.7rem]"
        />
        <p>{offer.brief}</p>
      </div>

      {/* The clock, broken out the way §E8 asks for it: two legs and the work between them. */}
      <dl className="mt-1 grid h-[3.25rem] grid-cols-2 gap-x-2 border-y border-surface-700/70 py-1 xl:h-[3.75rem]">
        <Cell label="Travel" value={formatDuration(offer.travelMinutes)} hint="each way, ×2" />
        <Cell label="On site" value={formatDuration(offer.durationMinutes)} hint="the job" />
      </dl>
      <div className="flex h-6 items-center justify-between gap-2">
        <span className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300 xl:text-[11px]">
          Round trip
        </span>
        <span className="font-display text-[13px] font-bold tabular-nums text-brass-300 xl:text-[16px]">
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
      <div className="flex h-24 shrink-0 flex-col gap-1 overflow-hidden border-t border-surface-700/70 pt-1.5 xl:h-[6.25rem]">
        <span className="flex items-baseline justify-between gap-2 font-display text-[10px] uppercase tracking-[0.16em] text-ink-300 xl:text-[11px]">
          <span className="shrink-0 whitespace-nowrap">Expected haul</span>
          {/* Four figures once the pay is graded (2026-09-28): "to carry" came off so the line
              stays one line at the narrowest card, and the hover still says what the slots are. */}
          <span
            className="shrink-0 whitespace-nowrap tracking-[0.14em]"
            data-tip="Loot slots to carry. Send enough bags or you leave some of it on the floor"
          >
            <span className="tabular-nums text-ink-200">{offer.payoutSlots.toLocaleString()}</span>{' '}
            loot slots
          </span>
        </span>
        <RewardLine rewards={offer.rewards} size="md" />
      </div>

      {/* §I1: what the crew learns from it, which is half of what a job is worth and was on no
          screen at all. Both figures, because a run that comes home empty still pays a fifth and
          a player choosing between a safe job and a risky one is choosing between those two. */}
      <div
        className="flex h-6 items-center justify-between gap-2 border-t border-surface-700/70 pt-1.5"
        data-tip={`${offer.failedXp.toLocaleString()} XP even if it goes wrong`}
      >
        <span className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300 xl:text-[11px]">
          Experience
        </span>
        <span className="font-display text-[12px] font-bold tabular-nums text-hextech-100 xl:text-[14px]">
          +{offer.xp.toLocaleString()}
          <span className="ml-1 font-display text-[10px] uppercase tracking-[0.14em] text-ink-300">
            / {offer.failedXp.toLocaleString()} lost
          </span>
        </span>
      </div>

      {/* What the job leans on, and a battle's fight category: the one line on the card about
          *who should lead it*. Fixed height and clipped like every other band here, because a
          four-leaning job wraps to two rows and the deploy buttons across three cards stay on one
          line. */}
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

      {!readOnly && refusal && <ErrorNote>{refusal}</ErrorNote>}

      {!readOnly && (
        <div className="mt-auto pt-2">
          <Button
            size="sm"
            className="w-full"
            variant={offer.kind === 'battle' ? 'danger' : 'primary'}
            disabled={disabled || pending}
            onClick={onSend}
            data-testid={`send-${offer.templateId}`}
          >
            {pending ? 'Sending…' : disabled ? (heldBy ?? 'No crew free') : 'Send a crew'}
          </Button>
        </div>
      )}
    </article>
  );
}

function Cell({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate font-display text-[9px] uppercase tracking-[0.16em] text-ink-300 xl:text-[10px]">
        {label}
      </dt>
      <dd className="truncate font-display text-[13px] font-bold tabular-nums text-ink-100 xl:text-[16px]">
        {value}
      </dd>
      <dd className="truncate font-display text-[9px] uppercase tracking-[0.14em] text-ink-300 xl:text-[10px]">
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
  onQuoteFightLeaders,
  now,
  bagPercent,
  notoriety,
  marks,
  carriersFight,
  anyRide,
  road,
  roster,
  stores,
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
  /**
   * Who should lead a fight, asked of the server for the force being filled in
   * (`quoteFightLeaders`). Optional, and its absence is what a board with no server behind it
   * gets: the bench reads "not rated yet" and the first free leader stands.
   */
  onQuoteFightLeaders?: (body: FightLeaderQuoteRequest) => Promise<FightLeaderQuoteResponse>;
  /** The server's clock, for the wait printed beside a leader somebody else has. */
  now: Date;
  /** §A4: what the crew's holdings and perks add to every haul, as a percentage. */
  bagPercent: number;
  /** The crew's rank: a unit past it will not take the contract, and the launch refuses it. */
  notoriety: number;
  /** ...and the marks they have been granted, which can add `picker` to a sheet that lacks it. */
  marks: Readonly<Record<string, readonly string[]>>;
  /** §E: this crew's porters stand in a line (`carriers_fight`), so "cannot fight" is not true. */
  carriersFight: boolean;
  /** §C3: this crew's machines seat anything (`any_ride`), so a Colossus does not walk. */
  anyRide: boolean;
  /** §C3: the crew's own cuts off the road, spent the way the launch spends them. */
  road: MissionRoad;
  /** §A5: the sheets, for the card a unit's name opens. Undefined draws the name bare. */
  roster: UnitsResponse | undefined;
  /** The stockpile and its ceilings, for how much of the haul fits. Undefined says nothing. */
  stores: MissionStores | undefined;
  onClose: () => void;
  onSend: (force: Army, leaderId: string, vehicles?: Fleet) => void;
}) {
  const [force, setForce] = useState<Army>({});
  const [riding, setRiding] = useState<Fleet>({});
  /*
   * Who leads it, and what that is worth.
   *
   * The job's leanings compose into one profile (`composeProfile`), every leader is graded
   * against it (`leaderMark`), and the odds are `missionOdds` and nothing else: the same function
   * the launch is priced with, so the dial cannot quote a figure the server does not charge.
   *
   * The most suitable free leader is picked to start with (2026-09-28). Every run has a leader
   * now, and the Overseer is always on the list, so an empty pick was only ever a button that
   * would not press.
   */
  const profile = useMemo(() => composeProfile(offer.leanings), [offer.leanings]);
  const free = leaders.filter((one) => one.held === null);
  const [pickedId, setPickedId] = useState('');
  /*
   * Whether the player has chosen a leader by hand. Until they do, the pick follows the best
   * free leader, and for a fight that answer arrives from the server a moment after the window
   * opens and moves again as the force is filled.
   */
  const [chosenByHand, setChosenByHand] = useState(false);

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
  const lineRules = crewLineRules(carriersFight, marks);
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
  const column = readColumn(fleetOut, force, loadouts, anyRide, road.unitSpeedPercent);
  // The row's own question (`standsInLine`), so a porter the row says can fight counts here too:
  // under `carriers_fight` a party of Haulers is a party that fights, and the launch agrees.
  const fighters = Object.entries(force).some(([unitId, count]) => {
    const unit = findUnit(unitId);
    return count > 0 && unit !== undefined && standsInLine(unit, lineRules);
  });
  const needsFighters = offer.kind === 'battle' && !fighters;

  const leader = free.find((one) => one.id === pickedId) ?? null;
  // An officer's loot perks pay only on a run an officer leads, so the take follows the picker.
  const pay = leader?.kind === 'officer' ? (offer.ledRewards ?? offer.rewards) : offer.rewards;
  // What of the job's pay this party brings home, trimmed the way the settle trims it, and counted
  // in the loot slots the card prints its pay in so the two numbers read against each other.
  const home = carriedHome(pay, carry, RESOURCE_KG);
  const paySlots = Math.round(payoutSlots(pay, RESOURCE_KG));
  const carriedSlots = Math.min(paySlots, Math.round(payoutSlots(home, RESOURCE_KG)));
  // What of the haul the carry brings home the stores could not take today: `wastedOnArrival`.
  const lostAtTheGate = stores ? wastedOnArrival(home, stores) : undefined;
  /*
   * Who should lead a fight: the engine's answer for this force (`useFightLeaderQuote`), asked
   * again as the party changes. A plain job grades the bench on the card's leanings, as before;
   * a fight's bench is rated by fighting it, so the sheet the picker reads is the engine's.
   */
  const quoteKey =
    offer.kind === 'battle' && going > 0 && onQuoteFightLeaders
      ? JSON.stringify({
          templateId: offer.templateId,
          grade: offer.grade,
          force,
          // The cleaned yard, not `riding`: a stepper taken back to nothing leaves a zero behind,
          // `FleetSchema` refuses a zero, and the quote came back a 400 that read as "not rated".
          vehicles: fleetOut,
        })
      : null;
  // One object per distinct body, so the effect below runs on a change of force and not on a
  // render: a fresh literal each time would ask again every time the answer landed.
  const quoteBody = useMemo(
    () => (quoteKey === null ? null : (JSON.parse(quoteKey) as FightLeaderQuoteRequest)),
    [quoteKey],
  );
  const [fightQuote, setFightQuote] = useState<{
    key: string;
    leaders: FightLeaderRating[];
  } | null>(null);
  useEffect(() => {
    if (quoteKey === null || quoteBody === null || !onQuoteFightLeaders) return;
    let live = true;
    // A breath after the last change, so a player stepping a count up five times asks once.
    const timer = setTimeout(() => {
      onQuoteFightLeaders(quoteBody)
        .then((answer) => {
          if (live) setFightQuote({ key: quoteKey, leaders: answer.leaders });
        })
        .catch(() => {
          if (live) setFightQuote({ key: quoteKey, leaders: [] });
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [quoteKey, quoteBody, onQuoteFightLeaders]);
  /** The bench as rated for the force on screen now; undefined while the answer is on its way. */
  const rated = fightQuote !== null && fightQuote.key === quoteKey ? fightQuote.leaders : undefined;
  const ratingOf = (id: string): FightLeaderRating | undefined =>
    rated?.find((one) => one.id === id);
  const best: MissionLeader | null =
    offer.kind === 'battle'
      ? (rated
          ?.map((rating) => free.find((one) => one.id === rating.id))
          .find((one) => one !== undefined) ??
        free[0] ??
        null)
      : bestLeader(free, profile);
  // The most suitable free leader is picked to start with (2026-09-28), and followed until the
  // player chooses by hand: for a fight the answer lands after the window opens.
  useEffect(() => {
    if (!chosenByHand && best !== null && best.id !== pickedId) setPickedId(best.id);
  }, [best, chosenByHand, pickedId]);
  const fightWords = (rating: FightLeaderRating | undefined): string =>
    rating
      ? `wins ${rating.wins} of ${rating.fights} practice fights`
      : quoteKey !== null && rated === undefined
        ? 'sizing up the fight'
        : 'not rated yet';

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
   * make the work go faster. The crew's own road cuts (`road`) come off it here too, so the figure
   * is the run's and not an upper bound on it.
   */
  /*
   * One leg, held in one place, because two lines print it.
   *
   * The round trip at the foot of the leader column and the "on the road" figure beside the
   * machines are the same walk, and they used to be worked out twice: this one from the raw band,
   * that one from `offer.travelMinutes` with the column's pace over it and no reduction at all.
   * A run with an officer on Short Way had the two disagreeing by minutes in one open dialog.
   */
  // ...with the crew's own road cuts on the road alone, as the launch spends them: their
  // `travelSpeedPercent` beside the ground's and the officer's, and the shortcut's minutes off.
  const oneWayMinutes = hastenedRoadMinutes(
    offer.rawTravelMinutes,
    column.speed,
    runSpeedPercent + road.travelSpeedPercent,
    road.roadMinutesOff,
    road.baseCutPercent ?? 0,
  );
  const walked = missionTimings({
    travelMinutes: oneWayMinutes,
    // The job's own clock takes the ground's cut alone: Short Way is spent on the road
    // (maintainer, 2026-10-01), exactly as `launchMission` spends it.
    durationMinutes: hastenedMinutes(offer.rawDurationMinutes, offer.speedPercent),
  });
  /*
   * The opening band, applied last, exactly where `launchMission` applies it.
   *
   * This line was missing and the omission was worth 55x. The three `*Minutes` on the offer carry
   * the band, but this dialog cannot use them: it re-runs the launch's arithmetic from the raw
   * template so the column's pace and the leader's Short Way can come off, and raw is raw. So a
   * crew on their first three runs read "at most 1h 50m" under a card that said "round trip 2m",
   * and the 1h 50m was the figure on the screen they commit from.
   */
  const clockMinutes = (offer.ramp === null ? walked : rampedTimings(walked, offer.ramp))
    .totalMinutes;
  const odds = missionOdds({ grade: offer.grade, leader: leader?.attributes ?? null, profile });

  /*
   * A battle is banded, never numbered: the crew fights a force it cannot see, with the real
   * engine, so the honest reading is how what is being sent compares with what the grade fields.
   * With a leader rated, the band is what the practice fights said (`fightBand`); before the
   * answer lands it is the force against the grade's figure, with nobody's edge on it.
   */
  const reading: GaugeReading =
    offer.kind === 'battle'
      ? {
          kind: 'battle',
          odds:
            (leader === null ? undefined : fightBand(ratingOf(leader.id))) ??
            battleOdds({ ours: fieldStrength(force), theirs: enemyStrength(offer.grade), edge: 0 }),
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
    // Nobody past the crew's rank: the launch refuses the whole party for one of them.
    if (!meetsNotoriety(notoriety, notorietyToField(unitId))) return 0;
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
            {/* One readout where there were two, "Can carry" and "Job pays" (maintainer,
                2026-09-30): the question is how much of the pay comes home, and the answer is a
                share of the card's own figure rather than two numbers to subtract. */}
            <Readout
              label="Carries"
              value={`${carriedSlots.toLocaleString()} of ${paySlots.toLocaleString()} loot slots`}
              tone={carriedSlots >= paySlots ? 'good' : 'warn'}
              testId="send-carries"
            />
            {stores && (
              <Readout
                label="Stores take"
                value={lostAtTheGate === undefined ? 'all of it' : 'part of it'}
                tone={lostAtTheGate === undefined ? 'good' : 'warn'}
              />
            )}
          </div>
          {lostAtTheGate && (
            <p
              className="break-words font-body text-[12px] leading-snug text-warning"
              data-testid="send-waste"
            >
              Your stores are short of room today: {describeWaste(lostAtTheGate)} of this haul would
              go to waste if it came home now.
            </p>
          )}
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
        {/*
         * `flex flex-col` on this wrapper, and `flex-1 min-h-0` rather than `h-full` on the box
         * inside it (maintainer, 2026-09-22: "goes below the screen and has no scroll").
         *
         * The window's height is a `max-height`, which is a ceiling and not a height, so nothing
         * in this chain is definite and a `h-full` on the box resolved against `auto`: the box
         * grew to its content, the scroller inside it never had anything to scroll, and a roster
         * of twelve sheets pushed the Send button off the bottom of a 720px screen. A flex item
         * with `flex-1 min-h-0` takes what its flex parent has left and no more, which is the one
         * arrangement that does not need a definite height anywhere above it.
         */}
        <div className="flex min-h-0 flex-1 flex-col px-4 pb-1">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-sm border border-surface-600/70 bg-surface-950/30">
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
                        onChange={(id) => {
                          setChosenByHand(true);
                          setPickedId(id);
                        }}
                        placeholder="Nobody yet"
                        options={[
                          ...leaders.map((one) => ({
                            value: one.id,
                            label: one.name,
                            // The kind, and their grade *for this job*: a raid boss and a navigator
                            // are different people on a long road, and the grade beside the job's
                            // own is the whole of the odds (maintainer, 2026-09-28).
                            hint:
                              one.held !== null
                                ? `${LEADER_KIND_LABEL[one.kind]} · ${holdHint(one, now)}`
                                : offer.kind === 'battle'
                                  ? `${LEADER_KIND_LABEL[one.kind]} · ${fightWords(ratingOf(one.id))}`
                                  : `${LEADER_KIND_LABEL[one.kind]} · ${leaderMark(
                                      one.attributes,
                                      profile,
                                    )} for this job`,
                            disabled: one.held !== null,
                          })),
                        ]}
                        data-testid="send-leader"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={best === null}
                        onClick={() => {
                          if (!best) return;
                          setChosenByHand(false);
                          setPickedId(best.id);
                        }}
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
                      {offer.kind === 'battle' ? (
                        <>
                          {LEADER_KIND_LABEL[leader.kind]} ·{' '}
                          <span className="tabular-nums text-brass-300">
                            {fightWords(ratingOf(leader.id))}
                          </span>{' '}
                          with this crew
                        </>
                      ) : (
                        <>
                          {LEADER_KIND_LABEL[leader.kind]} · grades{' '}
                          <span className="tabular-nums text-brass-300">
                            {leaderMark(leader.attributes, profile)}
                          </span>{' '}
                          for this {offer.grade} job
                        </>
                      )}
                    </p>
                  )}
                  {leader === null && (
                    <ErrorNote data-testid="leader-note">Somebody has to lead this.</ErrorNote>
                  )}
                  <RoundTrip minutes={clockMinutes} going={going} />
                </div>
              </div>

              {available.length === 0 ? (
                <p className="py-6 text-center font-body text-[13px] text-ink-300">
                  Nobody is at home. Muster somebody first.
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
                            {/* This crew's own figure for one of them, cards, bag and marks on, the
                                same `missionCarry` the header sums (bug pass, 2026-10-02). */}
                            {count} at home · carries{' '}
                            {missionCarry({ [unit.id]: 1 }, loadouts, bagPercent, lineRules)} loot
                            slots
                            {/* §E: the sheet says a porter cannot fight and `carriers_fight` says this
                          crew's can. The settle reads the crew (`standsInLine`), so the row does
                          too: a Scavenger that is going to stand in the line must not be labelled
                          as one that will not. */}
                            {standsInLine(unit, lineRules) ? '' : ' · cannot fight'}
                            {!meetsNotoriety(notoriety, notorietyToField(unit.id)) && (
                              <span
                                className="text-oxblood-300"
                                data-testid={`beyond-rank-${unit.id}`}
                              >
                                {' · '}will not sign for a crew under{' '}
                                {notorietyTier(notorietyToField(unit.id))}
                              </span>
                            )}
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
                          <QuickAmount
                            label="Half"
                            disabled={count < 2 || ceilingFor(unit.id, count) === 0}
                            testId={`half-${unit.id}`}
                            onClick={() =>
                              set(unit.id, Math.floor(count / 2), ceilingFor(unit.id, count))
                            }
                          />
                          <QuickAmount
                            label="Max"
                            disabled={count < 1 || ceilingFor(unit.id, count) === 0}
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
                          <span className="tabular-nums text-brass-300">
                            {shownPace(column.speed)}
                          </span>
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

        {/* One row: why it cannot go on the left, the two buttons on the right, both centred on
            the same line (maintainer, 2026-09-25). The buttons hold their place with `ml-auto`
            whether or not there is anything to say. */}
        <div className="flex items-center gap-3 border-t border-surface-700 px-4 pb-4 pt-3">
          {(needsFighters || overloaded) && (
            <div className="flex min-w-0 flex-col gap-1.5">
              {needsFighters && (
                <ErrorNote>
                  Somebody there has to be able to fight. Porters do not go in alone.
                </ErrorNote>
              )}
              {/* §C3: picked the people first and the truck second. Said rather than fixed: the
                  maintainer's rule is that the window does not quietly put anybody back. */}
              {overloaded && (
                <ErrorNote data-testid="mission-overloaded">
                  They do not all fit. <span className="tabular-nums">{aboard}</span> unit slots
                  picked and <span className="tabular-nums">{seats}</span> seats loaded: take
                  somebody off, or bring another machine.
                </ErrorNote>
              )}
            </div>
          )}
          <div className="ml-auto flex shrink-0 gap-2">
            <Button variant="ghost" onClick={onClose}>
              Not yet
            </Button>
            <Button
              variant={offer.kind === 'battle' ? 'danger' : 'primary'}
              disabled={going === 0 || !odds.allowed || needsFighters || overloaded}
              onClick={() => leader && onSend(force, leader.id, fleetOut)}
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

/**
 * What of this haul the stores would throw away if it came home now (maintainer ruling,
 * 2026-09-28).
 *
 * A run's pay lands up to the ceiling and the rest is lost at the gate, and nobody can be asked
 * then: the crew arrives while the player is elsewhere. So the question is put here, where they
 * commit, against the stock they hold today. It is a warning and not a refusal, because production,
 * spending and other runs all move the stock before this one is back.
 */
function wastedOnArrival(
  haul: PartialResources,
  stores: MissionStores,
): PartialResources | undefined {
  return creditStores(stores.resources, haul, stores.ceilings).wasted;
}

function Readout({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'warn';
  testId?: string;
}) {
  return (
    <span className="flex items-baseline gap-1.5" data-testid={testId}>
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
