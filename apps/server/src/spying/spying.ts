import { randomUUID } from 'node:crypto';
import {
  HOLDER_LABELS,
  LOCATION_CATALOG,
  SPY_ACCURACY_RESEARCH_ID,
  SPY_ESTIMATE_RESEARCH_ID,
  SPY_GATE_PLACE,
  SPY_NOTICE_RESEARCH_ID,
  SPY_QUIET_RESEARCH_ID,
  SPY_SLEEPERS_RESEARCH_ID,
  SPY_TIER_SPECS,
  SPY_TRACE_RESEARCH_ID,
  SPY_WHOLE_WIRE_RESEARCH_ID,
  SPY_WRITTEN_RESEARCH_ID,
  buildingLevel,
  canAfford,
  capRating,
  cityIsOpen,
  counterScore,
  displayNameOf,
  districtHolder,
  expose,
  findDistrict,
  findLocation,
  findUnit,
  fittedFor,
  officerBattleStats,
  spendResources,
  spyJobMinutes,
  spyRecallable,
  spyRecalledReturnsAt,
  spyReportStands,
  spyFoundOut,
  spyPartiesAllowed,
  spyReportSummary,
  spyScore,
  spyTierOpen,
  spyUnnoticedChance,
  travelMinutesBetween,
  unitSlotsUsed,
  upgradedStats,
  type Army,
  type Base,
  type Commander,
  type CounterStrength,
  type District,
  type Exposure,
  type LocationHolder,
  type SpyRefusal,
  type SpyReport,
  type SpyReportHolder,
  type SpyRun,
  type SpyRunView,
  type SpyStrength,
  type SpyTarget,
  type SpyTier,
} from '@frontline/shared';
import { adminCaps, adminWaives } from '../admin/mode.js';
import { mergeArmies } from '../battle/forces.js';
import { livingIn, residentOf } from '../battle/ground.js';
import { sidesReader } from '../battle/alignment.js';
import { withoutTheLeader } from '../battle/resolve.js';
import { gateFor } from '../city/gates.js';
import { crewEffectsFor, officerFitReader, standingEffectsFor } from '../crew/standing.js';
import type { Repositories } from '../db/repos/index.js';
import { tallySpyJobReturned, tallySpyJobUnnoticed, tallySpyReport } from '../feats/tally.js';
import { notifyBase } from '../social/notify.js';
import { workingOfficer } from '../crew/roster.js';
import { settleEach } from '../world/guard.js';

/**
 * Spying (maintainer ruling, 2026-09-22): a paid look at somebody else's ground.
 *
 * The Master of Whispers sends it from the chair, nobody of yours walks, it is priced off their
 * sheet and the road, it can be turned round in the first tenth of the job, and it is settled by
 * the world clock. It costs caps, taken at the send and never given back; it points at one place;
 * and it comes home with a **report**.
 *
 * The arithmetic is `@frontline/shared`'s `spying/spying.ts`: this module's job is to gather the
 * two sides of it from the save. For the spying side it reads the chair's `roleFit` and the
 * crew's `intelYieldPercent` (people and ground together, the fold the Watchtower pays into; the
 * chair's own track pays none since 2026-09-28).
 * For the other side it reads the holder's Consigliere, their `intelResistancePercent` (people
 * only: the gate is its own term) and the gate over the place.
 *
 * ## What can be looked at
 *
 * - A **location** in a contested district, held by anybody but this crew, anywhere on the map
 *   (the whole city is visible since 2026-09-29). Once one party holds the district whole its gate
 *   is armed, and the only thing a spy can read from outside is the gate: `not_the_gate`.
 * - A **gate**: a player's district, or a contested district held whole. Behind a player's gate
 *   stands their gate garrison (`Base.gateArmy`); behind a captured gate, every garrison in the
 *   district.
 *
 * Unoccupied ground refuses (`nothing_there`): "nobody holds it" is the whole of what a report
 * on it could say, and the district screen already says so for free.
 */

/**
 * Who sends the runners: the Master of Whispers, fit to work and not merely seated. An injured one
 * runs nothing while they are out (maintainer, 2026-09-23). The job is priced off their sheet, but
 * they never leave the chair and nothing holds them.
 */
export function whispersAtWork(base: Base, now: Date = new Date()): Commander | undefined {
  return workingOfficer(base.commanders, 'master_of_whispers', now);
}

/**
 * The one thing a job needs: somebody in the chair (maintainer, 2026-09-22). No rung: the caps are
 * the price, and a crew can pay it the moment the chair is filled.
 */
export function spyBlocker(base: Base): 'no_whispers' | null {
  return whispersAtWork(base) === undefined ? 'no_whispers' : null;
}

export interface SpyGround {
  district: District;
  placeName: string;
  holder: LocationHolder;
  /** Who is standing there, other crews' Sleepers included when the reader's rung allows. */
  army: Army;
  counter: CounterStrength;
  /** The stealth each unit of theirs actually fields, cards and channel in. */
  stealthOf: (unitId: string) => number;
}

export type SpyGroundResult =
  { kind: 'refused'; reason: SpyRefusal } | { kind: 'ground'; ground: SpyGround };

function crewStealthReader(repos: Repositories, holder: Base): (unitId: string) => number {
  /*
   * Off the holder's whole standing, not the people-only fold (bug pass, 2026-09-23).
   *
   * `crewEffectsFor` is the officers and the Overseer; `standingEffectsFor` is those plus the
   * ground they hold and the table they sit at. `unitStealthPercent` is paid by the Sewer
   * Junction, +15% at level one up to +83% at its ceiling, and both of the other readers of this
   * channel (`battle/effects.ts` and `battle/deploy.ts`) take the standing fold. So a crew that
   * had bought and held the one location in the game whose whole reward line is "they will not see
   * you" got it in a fight and got nothing at all against a spy, which is the half it was bought
   * for. The same mistake `missions/resolve.ts` records having made once with `infamy_gain`.
   */
  const percent = standingEffectsFor(repos, holder).unitStealthPercent;
  return (unitId) => {
    const unit = findUnit(unitId);
    if (!unit) return 0;
    const fitted = upgradedStats(unit.stats, fittedFor(holder.unitLoadouts, unitId));
    return capRating(Math.round(fitted.stealth * (1 + percent / 100)));
  };
}

const printedStealth = (unitId: string): number => findUnit(unitId)?.stats.stealth ?? 0;

/** A crew's counter: their Consigliere's fit for the chair, their people's counter-intel, the gate. */
function crewCounter(repos: Repositories, holder: Base, gateLevel: number): CounterStrength {
  // Working, not merely seated (maintainer, 2026-09-23): an injured Consigliere counters nothing.
  const consigliere = workingOfficer(holder.commanders, 'consigliere');
  return {
    kind: 'crew',
    consigliereChairPoints: consigliere
      ? officerFitReader(repos, holder).pointsFor(consigliere, 'consigliere')
      : null,
    /*
     * The **people-only** fold here, deliberately, and not the standing one (bug pass,
     * 2026-09-23: tried and reverted).
     *
     * `standingEffectsFor` folds in the district's own buildings, and the Gate is a building whose
     * `intelResistancePercent` this contest already counts explicitly, in points, a few lines
     * down. Reading the wider fold counted the same door twice and doubled what a maxed Gate was
     * worth against a spy. `crewStealthReader` above takes the standing fold because the channel
     * it reads is paid by a held *location* nothing else in this contest counts.
     */
    intelResistancePercent: crewEffectsFor(repos, holder).intelResistancePercent,
    gateLevel,
  };
}

/**
 * Whether units of this crew's would stand against the reader if it called a fight on the holder.
 *
 * The rule the settle applies at the mark (`battle/alignment.ts`, maintainer 2026-09-28): the
 * holder's and its faction's units defend, the reader's own and its faction's would attack beside
 * it, and a neutral's are parked and "don't show up in spying". A report is a count of what the
 * reader would have to beat, so only the first kind is in it.
 */
function standsAgainst(
  repos: Repositories,
  reader: Base,
  holderBaseId: string | null,
): (ownerBaseId: string) => boolean {
  const sideOf = sidesReader(repos, reader.id, holderBaseId);
  return (owner) => sideOf(owner) === 'defender';
}

/** The Sleepers other crews have planted on this ground, which a late rung lets a report list. */
function plantedOn(
  repos: Repositories,
  locationIds: readonly string[],
  against: (ownerBaseId: string) => boolean,
): Army {
  return locationIds
    .flatMap((locationId) => repos.sleepers.waitingOn(locationId))
    .filter((cell) => against(cell.baseId))
    .reduce<Army>((all, cell) => mergeArmies(all, cell.army), {});
}

/**
 * The ground behind a target, from this crew's side.
 *
 * Refusals are in the order a player would want to hear them: your own ground before an empty
 * one, an empty one before a gate you should have pointed at instead.
 */
export function groundBehind(
  repos: Repositories,
  reader: Base,
  target: SpyTarget,
): SpyGroundResult {
  const refused = (reason: SpyRefusal): SpyGroundResult => ({ kind: 'refused', reason });
  const controls = repos.city.controls();
  const sleeperRung = reader.research.technologies.includes(SPY_SLEEPERS_RESEARCH_ID);

  if (target.kind === 'location') {
    const location = findLocation(target.locationId);
    const district = location ? findDistrict(location.districtId) : undefined;
    const control = location ? controls.get(location.id) : undefined;
    // A location stands only on contested ground, which is also the only ground with a difficulty
    // to read the counter off: a plot's gate is the residential branch below.
    if (!location || district?.kind !== 'contested' || !control) return refused('nothing_there');
    if (control.holder.kind === 'crew' && control.holder.baseId === reader.id) {
      return refused('own_ground');
    }
    if (control.holder.kind === 'unoccupied') return refused('nothing_there');
    if (districtHolder(district, controls) !== null) return refused('not_the_gate');

    // The holder's garrison, the postings on it and, with the rung, the cells, of whoever would
    // defend it against the reader (`standsAgainst`).
    const against = standsAgainst(
      repos,
      reader,
      control.holder.kind === 'crew' ? control.holder.baseId : null,
    );
    const posted = repos.alliedGarrisons
      .at(location.id)
      .filter((row) => against(row.baseId))
      .reduce<Army>((all, row) => mergeArmies(all, row.army), {});
    const army = mergeArmies(
      mergeArmies(control.garrison, posted),
      sleeperRung ? plantedOn(repos, [location.id], against) : {},
    );
    if (control.holder.kind === 'crew') {
      const holder = repos.bases.findById(control.holder.baseId);
      if (!holder) return refused('nothing_there');
      return {
        kind: 'ground',
        ground: {
          district,
          placeName: location.name,
          holder: control.holder,
          army,
          counter: crewCounter(repos, holder, 0),
          stealthOf: crewStealthReader(repos, holder),
        },
      };
    }
    return {
      kind: 'ground',
      ground: {
        district,
        placeName: location.name,
        holder: control.holder,
        army,
        counter: {
          kind: control.holder.kind,
          districtDifficulty: district.difficulty,
          baseDefense: LOCATION_CATALOG[location.kind].baseDefense,
        },
        stealthOf: printedStealth,
      },
    };
  }

  const district = findDistrict(target.districtId);
  if (!district) return refused('nothing_there');

  if (district.kind === 'residential') {
    const resident = residentOf(repos, district.id);
    if (!resident) return refused('nothing_there');
    if (resident.id === reader.id) return refused('own_ground');
    return {
      kind: 'ground',
      ground: {
        district,
        placeName: SPY_GATE_PLACE,
        holder: { kind: 'crew', baseId: resident.id },
        // What stands behind a player's gate: the gate garrison, since the split (2026-09-22), and
        // the gate garrison of any neighbour on the resident's side (`battle/alignment.ts`). A
        // neighbour exists only in a database from before 2026-09-28, when a plot could hold two
        // crews; the merge goes with the bots (the TODO in `seed/index.ts`).
        army: livingIn(repos, district.id)
          .filter((neighbour) => neighbour.id !== resident.id)
          .filter((neighbour) => standsAgainst(repos, reader, resident.id)(neighbour.id))
          .reduce<Army>(
            (all, neighbour) => mergeArmies(all, neighbour.gateArmy ?? {}),
            resident.gateArmy ?? {},
          ),
        counter: crewCounter(repos, resident, buildingLevel(resident.buildings, 'gate')),
        stealthOf: crewStealthReader(repos, resident),
      },
    };
  }

  const holder = districtHolder(district, controls);
  if (holder === null || holder.kind === 'unoccupied') return refused('nothing_there');
  if (holder.kind === 'crew' && holder.baseId === reader.id) return refused('own_ground');
  /*
   * What meets a fight at this gate, and nothing else (bug pass, 2026-09-28). A crew holding the
   * district from somewhere else defends its gate with what it sends to the fight: its location
   * garrisons stay on their locations (`assemble` in `battle/resolve.ts`), so counting them showed
   * sixty units behind a gate nobody was standing at. The regime's plots do stand at their gate.
   * Sleepers never fight at a gate (`presenceAt`), so no cell is counted either.
   */
  if (holder.kind === 'crew') {
    const crew = repos.bases.findById(holder.baseId);
    if (!crew) return refused('nothing_there');
    return {
      kind: 'ground',
      ground: {
        district,
        placeName: SPY_GATE_PLACE,
        holder,
        army: {},
        counter: crewCounter(repos, crew, gateFor(repos, district.id).level),
        stealthOf: crewStealthReader(repos, crew),
      },
    };
  }
  // Every plot's garrison but the district's legendary, who fights only on his own plot and so is
  // not behind the gate (`withoutTheLeader`).
  const army = district.locations.reduce<Army>(
    (all, location) =>
      mergeArmies(all, withoutTheLeader(location.id, controls.get(location.id)?.garrison ?? {})),
    {},
  );
  return {
    kind: 'ground',
    ground: {
      district,
      placeName: SPY_GATE_PLACE,
      holder,
      army,
      counter: {
        kind: holder.kind,
        districtDifficulty: district.difficulty,
        // The hardest ground in the district is what its gate is read against.
        baseDefense: Math.max(
          0,
          ...district.locations.map((location) => LOCATION_CATALOG[location.kind].baseDefense),
        ),
      },
      stealthOf: printedStealth,
    },
  };
}

/** This crew's side of the contest, as the shared arithmetic wants it. */
export function spyStrengthFor(repos: Repositories, base: Base, tier: SpyTier): SpyStrength {
  const whispers = whispersAtWork(base);
  return {
    chairPoints: whispers
      ? officerFitReader(repos, base).pointsFor(whispers, 'master_of_whispers')
      : 0,
    intelPercent: standingEffectsFor(repos, base).intelYieldPercent,
    tier,
  };
}

const MINUTE_MS = 60_000;

export interface SpyPlan {
  minutes: number;
  travelMinutes: number;
  returnsAt: Date;
  caps: number;
}

/** What a job on ground in `districtId` would take, before it is committed to. Null with nobody to send. */
export function planSpy(
  repos: Repositories,
  base: Base,
  districtId: string,
  tier: SpyTier,
  now: Date,
): SpyPlan | null {
  const whispers = whispersAtWork(base);
  if (!whispers) return null;
  const travelMinutes = walkMinutes(repos, base, districtId, whispers);
  if (travelMinutes === null) return null;
  const minutes = spyJobMinutes(travelMinutes, whispers.attributes);
  return {
    minutes,
    travelMinutes,
    returnsAt: new Date(now.getTime() + minutes * MINUTE_MS),
    caps: SPY_TIER_SPECS[tier].caps,
  };
}

/**
 * The walk out, or null when the map has no road between the two ends.
 *
 * The same arithmetic a column reads, so a Rail Yard shortens a job exactly as much as it shortens
 * a march. The pace is the Master of Whispers' own speed off their sheet, and the ground's
 * reductions stack on top of that the way they do for a march.
 */
function walkMinutes(
  repos: Repositories,
  base: Base,
  districtId: string,
  whispers: Commander,
): number | null {
  const from = findDistrict(base.districtId);
  const to = findDistrict(districtId);
  if (!from || !to) return null;
  const effects = standingEffectsFor(repos, base);
  return travelMinutesBetween(from, to, {
    speed: officerBattleStats(whispers.attributes).speed,
    reductionPercent: effects.travelSpeedPercent,
    flatMinutesOff: effects.roadMinutesOff,
  });
}

/** How many jobs this crew may have out at once: one, and another with Two Sets of Eyes. */
export function spyPartiesFor(repos: Repositories, base: Base): number {
  return spyPartiesAllowed(standingEffectsFor(repos, base).spyPartiesFlat);
}

export type SendSpyResult =
  { kind: 'refused'; reason: SpyRefusal } | { kind: 'sent'; run: SpyRun; base: Base };

/**
 * Send the runners. The caps are taken here and are not coming back: a job turned round in its
 * first tenth walks home without a report and without a refund (maintainer, 2026-09-22).
 */
export function sendSpy(
  repos: Repositories,
  input: {
    base: Base;
    target: SpyTarget;
    tier: SpyTier;
    now: Date;
    /** Testing mode: the caps are quoted and not taken (`admin/mode.ts`). */
    admin?: boolean;
  },
): SendSpyResult {
  const { base, target, tier, now, admin = false } = input;
  const blocked = spyBlocker(base);
  if (blocked !== null) return { kind: 'refused', reason: blocked };
  if (!spyTierOpen(tier, base.research.technologies)) {
    return { kind: 'refused', reason: 'tier_locked' };
  }
  if (repos.spying.activeFor(base.id).length >= spyPartiesFor(repos, base)) {
    return { kind: 'refused', reason: 'already_out' };
  }

  const looked = groundBehind(repos, base, target);
  if (looked.kind === 'refused') return looked;
  // The Combine holds Saltmarch's seat and its Hulls, so there is always somebody to read there,
  // and nothing a crew could do with the report (bug pass, 2026-09-29).
  if (!cityIsOpen(looked.ground.district.cityId)) return { kind: 'refused', reason: 'city_closed' };

  const plan = planSpy(repos, base, looked.ground.district.id, tier, now);
  // The chair was checked above, so a null plan is no road, not an empty chair (`SPY_REFUSALS`).
  if (!plan) return { kind: 'refused', reason: 'no_road' };
  const cost = { caps: plan.caps };
  if (!canAfford(base.resources, cost) && !adminWaives('cannot_afford', admin)) {
    return { kind: 'refused', reason: 'cannot_afford' };
  }

  // `capsPaid` below keeps the quoted figure: the report prints it, and the screens show real prices.
  const charged = { caps: adminCaps(plan.caps, admin) };
  const paid: Base = { ...base, resources: spendResources(base.resources, charged) };
  repos.bases.updateResources(paid.id, paid.resources);

  const run: SpyRun = {
    id: randomUUID(),
    baseId: base.id,
    target,
    tier,
    capsPaid: plan.caps,
    departedAt: now.toISOString(),
    returnsAt: plan.returnsAt.toISOString(),
    travelMinutes: plan.travelMinutes,
    recalledAt: null,
  };
  repos.spying.insert(run);
  return { kind: 'sent', run, base: paid };
}

export type RecallSpyResult =
  { kind: 'refused'; reason: 'nobody_out' | 'window_closed' } | { kind: 'recalled'; run: SpyRun };

/** Turn one job round: the one named, or the first still walking out when none is. */
export function recallSpy(
  repos: Repositories,
  base: Base,
  now: Date,
  runId?: string,
): RecallSpyResult {
  const run = repos.spying
    .activeFor(base.id)
    .find((active) => active.recalledAt === null && (runId === undefined || active.id === runId));
  if (!run) return { kind: 'refused', reason: 'nobody_out' };
  if (!spyRecallable(run, now)) return { kind: 'refused', reason: 'window_closed' };
  const returnsAt = spyRecalledReturnsAt(run, now).toISOString();
  repos.spying.markRecalled(run.id, now.toISOString(), returnsAt);
  return { kind: 'recalled', run: { ...run, recalledAt: now.toISOString(), returnsAt } };
}

/** The holder as the report heads itself, frozen as text the night it was written. */
function holderOf(repos: Repositories, holder: LocationHolder): SpyReportHolder {
  if (holder.kind !== 'crew') {
    return { kind: holder.kind, name: HOLDER_LABELS[holder.kind], player: null, faction: null };
  }
  const crew = repos.bases.findById(holder.baseId);
  const user = crew ? repos.users.findById(crew.ownerId) : undefined;
  const membership = crew ? repos.factions.membershipOf(crew.ownerId) : undefined;
  const faction = membership ? repos.factions.find(membership.factionId) : undefined;
  return {
    kind: 'crew',
    name: crew?.name ?? 'a crew nobody knows',
    player: user ? displayNameOf(user) : null,
    faction: faction?.name ?? null,
  };
}

/** Where a target is and what it is called, for the report's heading and the Monitor's row. */
function placeOf(target: SpyTarget): { district: District | undefined; placeName: string } {
  if (target.kind === 'gate') {
    return { district: findDistrict(target.districtId), placeName: SPY_GATE_PLACE };
  }
  const location = findLocation(target.locationId);
  return {
    district: location ? findDistrict(location.districtId) : undefined,
    placeName: location?.name ?? 'somewhere',
  };
}

/**
 * Whether a refusal at writing time means the runners found nothing to look at, rather than
 * being kept from looking.
 *
 * Empty ground and the reader's own ground are true answers, written up as an empty report under
 * whoever holds it now. A district that shut behind its gate or ground that fell out of sight
 * while they walked is neither: the garrison is still standing there and nobody saw it, so the job
 * failed (bug pass, 2026-09-28). Written up as empty, it read as a clean report of empty ground at
 * full accuracy, and the holder was never told anybody had come.
 */
const FOUND_NOTHING: ReadonlySet<SpyRefusal> = new Set(['nothing_there', 'own_ground']);

/** A job that could not look at all: refused for a reason other than finding nothing there. */
function keptOutOf(looked: SpyGroundResult): boolean {
  return looked.kind === 'refused' && !FOUND_NOTHING.has(looked.reason);
}

/** Whoever holds the target as the runners find it, for the report's heading and the warning. */
function holderFound(
  repos: Repositories,
  looked: SpyGroundResult,
  target: SpyTarget,
): LocationHolder {
  if (looked.kind === 'ground') return looked.ground.holder;
  return target.kind === 'location'
    ? (repos.city.control(target.locationId)?.holder ?? { kind: 'unoccupied' })
    : { kind: 'unoccupied' };
}

/** What this crew's track lets a report say, frozen onto the report the night it is written. */
interface ReportRules {
  /** Written Reports: the units by name, rather than their unit slots alone. */
  unitsShown: boolean;
  /** Second Source. */
  accuracyShown: boolean;
  /** Counting the Empty Beds, until The Whole Wire makes it an exact figure instead. */
  unseenShown: boolean;
  /** The Whole Wire: the exact unit slots standing there, whatever the job managed. */
  totalShown: boolean;
  /** Sleeper Lists: planted cells are in the count at all. */
  sleepersSeen: boolean;
}

function reportRules(base: Base): ReportRules {
  const holds = (id: string) => base.research.technologies.includes(id);
  const wholeWire = holds(SPY_WHOLE_WIRE_RESEARCH_ID);
  return {
    unitsShown: holds(SPY_WRITTEN_RESEARCH_ID),
    accuracyShown: holds(SPY_ACCURACY_RESEARCH_ID),
    // "This level drops the estimation of what you missed" (maintainer, 2026-09-28): with the
    // exact total on the page there is nothing left to estimate.
    unseenShown: holds(SPY_ESTIMATE_RESEARCH_ID) && !wholeWire,
    totalShown: wholeWire,
    sleepersSeen: holds(SPY_SLEEPERS_RESEARCH_ID),
  };
}

/** Whether a spy can ever count this unit: never a Specter, and a Sleeper only with the rung. */
function countable(rules: ReportRules): (unitId: string) => boolean {
  return (unitId) => {
    const unit = findUnit(unitId);
    if (!unit || unit.unspyable === true) return false;
    return unit.sleeper !== true || rules.sleepersSeen;
  };
}

/** The unit slots of everything a spy could have counted there, for The Whole Wire's figure. */
function countableSlots(army: Army, visible: (unitId: string) => boolean): number {
  return unitSlotsUsed(
    Object.fromEntries(Object.entries(army).filter(([unitId]) => visible(unitId))),
  );
}

/** Everything a report needs that is not the arithmetic: which job, what it cost, whether it was seen. */
export interface ReportHeading {
  id: string;
  target: SpyTarget;
  tier: SpyTier | null;
  capsPaid: number;
  foundOut: boolean;
}

/**
 * A report off a read of the ground, in the words this crew's track allows.
 *
 * Shared by the job and by the courier, which differ only in how the read was bought and whether
 * it can fail. `keptOut` is a job that could not look at all; `exposure` is what was read.
 */
export function composeSpyReport(
  repos: Repositories,
  base: Base,
  heading: ReportHeading,
  read: { looked: SpyGroundResult; exposure: Exposure; keptOut: boolean },
  now: Date,
): SpyReport {
  const { looked, exposure, keptOut } = read;
  const { district, placeName } = placeOf(heading.target);
  const rules = reportRules(base);
  const failed = keptOut || !spyReportStands(exposure.accuracy);
  const seenSlots = failed ? 0 : unitSlotsUsed(exposure.exposed);
  const total =
    rules.totalShown && looked.kind === 'ground'
      ? countableSlots(looked.ground.army, countable(rules))
      : null;
  return {
    id: heading.id,
    baseId: base.id,
    target: heading.target,
    districtId: district?.id ?? '',
    districtName: district?.name ?? 'somewhere',
    placeName,
    holder: holderOf(repos, holderFound(repos, looked, heading.target)),
    tier: heading.tier,
    capsPaid: heading.capsPaid,
    writtenAt: now.toISOString(),
    failed,
    // A failed report says nothing below its heading, and neither readout is sent with it: the
    // two together are the count `exposed` is emptied to withhold (`SpyReportSchema`). Before
    // Written Reports the units are withheld the same way, and the slots are the whole report.
    exposed: failed || !rules.unitsShown ? {} : exposure.exposed,
    exposedSlots: seenSlots,
    unitsShown: rules.unitsShown,
    totalSlots: total,
    foundOut: heading.foundOut,
    accuracy: rules.accuracyShown && !failed ? exposure.accuracy : null,
    unseen: rules.unseenShown && !failed ? exposure.unseen : null,
    accuracyShown: rules.accuracyShown,
  };
}

/**
 * Read the ground behind a target with this budget, as this crew's track lets it count.
 *
 * `Infinity` reads everything countable, which is the courier's report.
 */
export function readGround(
  base: Base,
  looked: SpyGroundResult,
  budget: number,
): { looked: SpyGroundResult; exposure: Exposure; keptOut: boolean } {
  const exposure = expose({
    army: looked.kind === 'ground' ? looked.ground.army : {},
    stealthOf: looked.kind === 'ground' ? looked.ground.stealthOf : printedStealth,
    visible: countable(reportRules(base)),
    budget,
  });
  return { looked, exposure, keptOut: keptOutOf(looked) };
}

/**
 * The crew a job on this ground could be seen by, or null.
 *
 * Only a crew, never the reader, and only when the runners got as far as the place: a job that
 * found the ground empty or its own has nobody to be seen by. A job kept out by a gate that shut
 * while they walked was at the gate, and the crew behind it is who would see them.
 */
function watcherOf(
  repos: Repositories,
  reader: Base,
  looked: SpyGroundResult,
  target: SpyTarget,
): string | null {
  const holder = holderFound(repos, looked, target);
  if (holder.kind !== 'crew' || holder.baseId === reader.id) return null;
  return looked.kind === 'ground' || keptOutOf(looked) ? holder.baseId : null;
}

/**
 * Write the report for a run that got there, on the ground as it stands **now**.
 *
 * Now rather than at the send, because the runners look when they arrive: a garrison that
 * marched off in the meantime is not in the report, and one that marched in is. A target that
 * emptied, or is the reader's own by the time they get there, is written up as empty ground; one
 * that can no longer be looked at from outside is a failed report ({@link FOUND_NOTHING}).
 *
 * Whether the holder saw them is rolled here, once, off the run's id (maintainer, 2026-09-28):
 * always before Traffic Analysis, then less often the better the chair's grade.
 */
export function writeSpyReport(repos: Repositories, base: Base, run: SpyRun, now: Date): SpyReport {
  const looked = groundBehind(repos, base, run.target);
  const strength = spyStrengthFor(repos, base, run.tier);
  const budget =
    looked.kind === 'ground' ? spyScore(strength) - counterScore(looked.ground.counter) : 0;
  const quiet = base.research.technologies.includes(SPY_QUIET_RESEARCH_ID);
  const foundOut =
    watcherOf(repos, base, looked, run.target) !== null &&
    spyFoundOut(run.id, spyUnnoticedChance(quiet, strength.chairPoints));
  return composeSpyReport(
    repos,
    base,
    { id: randomUUID(), target: run.target, tier: run.tier, capsPaid: run.capsPaid, foundOut },
    readGround(base, looked, budget),
    now,
  );
}

/** "Wire (watcher)": the crew and the player behind it, the way a found-out notice names them. */
function spyingName(repos: Repositories, reader: Base): string {
  const user = repos.users.findById(reader.ownerId);
  return user ? `${displayNameOf(user)} (${reader.name})` : reader.name;
}

/**
 * Tell the holder what they are owed: who, when the runners were seen, and whatever their
 * Consigliere adds on top (maintainer, 2026-09-22 and 2026-09-28).
 *
 * One notice rather than two. Seen, the holder is told the player's name whatever their track;
 * Reading the Room is the anonymous word for a job nobody saw, and Names and Faces adds whose and
 * what they counted either way. Unseen with neither rung, nobody hears anything.
 */
function tellHolder(
  repos: Repositories,
  reader: Base,
  report: SpyReport,
  crewId: string,
  at: Date,
): void {
  const crew = repos.bases.findById(crewId);
  if (!crew) return;
  const holds = (id: string) => crew.research.technologies.includes(id);
  const noticed = holds(SPY_NOTICE_RESEARCH_ID);
  const traced = holds(SPY_TRACE_RESEARCH_ID);
  if (!report.foundOut && !noticed) return;

  const where = `${report.placeName}, ${report.districtName}`;
  const counted = report.failed
    ? 'came away with nothing'
    : `counted ${report.exposedSlots} unit slots of yours`;
  const named = spyingName(repos, reader);
  const title = report.foundOut
    ? `${named} has been spying on ${report.placeName}`
    : `Somebody has been looking at ${report.placeName}`;
  const body = report.foundOut
    ? traced
      ? `Their runners were seen at ${where}. Your Consigliere says they ${counted}.`
      : `Their runners were seen at ${where}.`
    : traced
      ? `${reader.name}'s spies were at ${where} and ${counted}.`
      : `Your Consigliere caught wind of eyes on ${where}. Whose, and what they saw, is beyond them.`;
  notifyBase(repos, crew.id, {
    kind: 'spied_on',
    title,
    body,
    link: `/game/city/${report.districtId}`,
    subjectId: report.districtId,
    at,
  });
}

/**
 * Bring home every job whose mark has passed, and write what it found.
 *
 * On the world clock rather than on a read path: a report is a receipt, and a receipt is worth
 * having when it arrives.
 */
export function settleSpying(repos: Repositories, now: Date): number {
  const due = repos.spying.due(now.toISOString());
  // One transaction per run: marking it settled and writing its report are one fact, and a throw
  // between them used to lose the report the caps were spent on (`world/guard.ts`).
  return settleEach(
    repos,
    'spying',
    due,
    (run) => run.id,
    (run) => {
      repos.spying.markSettled(run.id, now.toISOString());
      // Turned round: home without a report. The caps went at the send.
      if (run.recalledAt !== null) return;
      const base = repos.bases.findById(run.baseId);
      if (!base) return;

      const report = writeSpyReport(repos, base, run, now);
      repos.spying.insertReport(report);
      // Feats: every job that came home with a report, stood or failed. The one below is stricter.
      tallySpyJobReturned(repos, base.id);
      /*
       * The ladder counts what was **learnt**.
       *
       * A report on ground with nobody standing on it stands (there was nothing to miss, so the
       * accuracy is one) and it is worth filing: "the place was empty when they looked" is the
       * answer a player paid for. It is not a feat, though. Every crew's gate starts with nobody
       * at it, so counting it would make `spy_reports` a hundred caps a rung. Slots rather than
       * the units, which a report before Written Reports does not name.
       */
      if (!report.failed && report.exposedSlots > 0) tallySpyReport(repos, base.id);
      // Both bells are dated at the job's mark, when the runners came home, not at the tick.
      const home = new Date(run.returnsAt);
      fileReportNotice(repos, base.id, report, home);
      const watcher = watcherOf(repos, base, groundBehind(repos, base, run.target), run.target);
      if (watcher === null) return;
      if (!report.foundOut) tallySpyJobUnnoticed(repos, base.id);
      tellHolder(repos, base, report, watcher, home);
    },
  );
}

/** Ring the reader's bell for a report, the job's or the courier's. */
export function fileReportNotice(
  repos: Repositories,
  baseId: string,
  report: SpyReport,
  at: Date,
): void {
  const where = `${report.placeName}, ${report.districtName}`;
  notifyBase(repos, baseId, {
    kind: 'spy_report',
    title: report.failed
      ? 'Your spies came back with nothing'
      : report.tier === null
        ? "The courier's report is in"
        : 'A spy report is in',
    body: report.failed
      ? `${where}: nothing they would put their name to.`
      : `${where}: ${spyReportSummary(report)}.`,
    link: `/game/battles?spy=${report.id}`,
    subjectId: report.id,
    at,
  });
}

/** One job, named for the screens. */
function runView(run: SpyRun): SpyRunView {
  const { district, placeName } = placeOf(run.target);
  return {
    id: run.id,
    target: run.target,
    districtId: district?.id ?? '',
    districtName: district?.name ?? 'somewhere',
    placeName,
    tier: run.tier,
    capsPaid: run.capsPaid,
    departedAt: run.departedAt,
    returnsAt: run.returnsAt,
    travelMinutes: run.travelMinutes,
    recalledAt: run.recalledAt,
  };
}

/** The jobs this crew has out, named for the screens, soonest home first. */
export function spyRunViews(repos: Repositories, base: Base): SpyRunView[] {
  return repos.spying.activeFor(base.id).map(runView);
}
