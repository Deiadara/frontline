import { randomUUID } from 'node:crypto';
import {
  HOLDER_LABELS,
  LOCATION_CATALOG,
  SPY_ACCURACY_RESEARCH_ID,
  SPY_ESTIMATE_RESEARCH_ID,
  SPY_GATE_PLACE,
  SPY_NOTICE_RESEARCH_ID,
  SPY_SLEEPERS_RESEARCH_ID,
  SPY_TIER_SPECS,
  SPY_TRACE_RESEARCH_ID,
  armySize,
  buildingLevel,
  canAfford,
  capRating,
  counterScore,
  displayNameOf,
  districtHolder,
  expose,
  findDistrict,
  findLocation,
  findUnit,
  fittedFor,
  spendResources,
  spyRecallable,
  spyRecalledReturnsAt,
  spyReportStands,
  spyScore,
  upgradedStats,
  type Army,
  type Base,
  type CounterStrength,
  type District,
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
import { mergeArmies } from '../battle/forces.js';
import { residentOf } from '../battle/ground.js';
import { gateFor } from '../city/gates.js';
import { visibleDistricts } from '../city/view.js';
import { crewEffectsFor, officerFitReader, standingEffectsFor } from '../crew/standing.js';
import type { Repositories } from '../db/repos/index.js';
import { tallySpyReport } from '../feats/tally.js';
import { planScout, scoutParty } from '../scouting/scouting.js';
import { notifyBase } from '../social/notify.js';

/**
 * Spying (maintainer ruling, 2026-09-22): a paid look at somebody else's ground.
 *
 * The shape is a scout party's. The Master of Whispers sends it from the chair, nobody of yours
 * walks, it is priced off their sheet and the road, it can be turned round in the first tenth of
 * the way out, and it is settled by the world clock. Three things are different: it costs caps,
 * taken at the send and never given back; it points at one place rather than a district; and it
 * comes home with a **report** rather than opening the ground.
 *
 * The arithmetic is `@frontline/shared`'s `spying/spying.ts`: this module's job is to gather the
 * two sides of it from the save. For the spying side it reads the chair's `roleFit` and the
 * crew's `intelYieldPercent` (people and ground together, the fold the Watchtower pays into).
 * For the other side it reads the holder's Consigliere, their `intelResistancePercent` (people
 * only: the gate is its own term) and the gate over the place.
 *
 * ## What can be looked at
 *
 * - A **location** in a contested district, held by anybody but this crew, while the district is
 *   open. Once one party holds the district whole its gate is armed, and the only thing a spy can
 *   read from outside is the gate: `not_the_gate`.
 * - A **gate**: a player's district, or a contested district held whole. Behind a player's gate
 *   stands their gate garrison (`Base.gateArmy`); behind a captured gate, every garrison in the
 *   district.
 *
 * Unoccupied ground refuses (`nothing_there`): "nobody holds it" is the whole of what a report
 * on it could say, and the district screen already says so for free.
 */

/**
 * The one thing a job needs: somebody in the chair (maintainer, 2026-09-22).
 *
 * A scout party also needs the Scouting rung, because the party *is* what that rung buys. A spy
 * job is not: the caps are the price, and the maintainer's call is that a crew can pay it the
 * moment the chair is filled.
 */
export function spyBlocker(base: Base): 'no_whispers' | null {
  return scoutParty(base) === undefined ? 'no_whispers' : null;
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
  // Off the holder's own books: fitted cards, then the crew's channel, the order the line uses.
  const percent = crewEffectsFor(repos, holder).unitStealthPercent;
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
  const consigliere = holder.commanders.find((officer) => officer.role === 'consigliere');
  return {
    kind: 'crew',
    consigliereChairPoints: consigliere
      ? officerFitReader(repos, holder).pointsFor(consigliere, 'consigliere')
      : null,
    intelResistancePercent: crewEffectsFor(repos, holder).intelResistancePercent,
    gateLevel,
  };
}

/** The Sleepers other crews have planted on this ground, which a late rung lets a report list. */
function plantedOn(repos: Repositories, reader: Base, locationIds: readonly string[]): Army {
  return locationIds
    .flatMap((locationId) => repos.sleepers.waitingOn(locationId))
    .filter((cell) => cell.baseId !== reader.id)
    .reduce<Army>((all, cell) => mergeArmies(all, cell.army), {});
}

/**
 * The ground behind a target, from this crew's side of the fog.
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
  const visible = visibleDistricts(repos, reader, controls, standingEffectsFor(repos, reader));
  const sleeperRung = reader.research.technologies.includes(SPY_SLEEPERS_RESEARCH_ID);

  if (target.kind === 'location') {
    const location = findLocation(target.locationId);
    const district = location ? findDistrict(location.districtId) : undefined;
    const control = location ? controls.get(location.id) : undefined;
    if (!location || !district || !control) return refused('nothing_there');
    if (!visible.has(district.id)) return refused('unscouted');
    if (control.holder.kind === 'crew' && control.holder.baseId === reader.id) {
      return refused('own_ground');
    }
    if (control.holder.kind === 'unoccupied') return refused('nothing_there');
    if (districtHolder(district, controls) !== null) return refused('not_the_gate');

    // The holder's garrison, any faction ally's posting on it, and planted cells with the rung.
    const posted = repos.alliedGarrisons
      .at(location.id)
      .reduce<Army>((all, row) => mergeArmies(all, row.army), {});
    const army = mergeArmies(
      mergeArmies(control.garrison, posted),
      sleeperRung ? plantedOn(repos, reader, [location.id]) : {},
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
  if (!visible.has(district.id)) return refused('unscouted');

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
        // What stands behind a player's gate: the gate garrison, since the split (2026-09-22).
        army: resident.gateArmy ?? {},
        counter: crewCounter(repos, resident, buildingLevel(resident.buildings, 'gate')),
        stealthOf: crewStealthReader(repos, resident),
      },
    };
  }

  const holder = districtHolder(district, controls);
  if (holder === null || holder.kind === 'unoccupied') return refused('nothing_there');
  if (holder.kind === 'crew' && holder.baseId === reader.id) return refused('own_ground');
  const locationIds = district.locations.map((location) => location.id);
  const standing = district.locations.reduce<Army>(
    (all, location) => mergeArmies(all, controls.get(location.id)?.garrison ?? {}),
    {},
  );
  const army = mergeArmies(standing, sleeperRung ? plantedOn(repos, reader, locationIds) : {});
  if (holder.kind === 'crew') {
    const crew = repos.bases.findById(holder.baseId);
    if (!crew) return refused('nothing_there');
    return {
      kind: 'ground',
      ground: {
        district,
        placeName: SPY_GATE_PLACE,
        holder,
        army,
        counter: crewCounter(repos, crew, gateFor(repos, district.id).level),
        stealthOf: crewStealthReader(repos, crew),
      },
    };
  }
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
  const whispers = scoutParty(base);
  return {
    chairPoints: whispers
      ? officerFitReader(repos, base).pointsFor(whispers, 'master_of_whispers')
      : 0,
    intelPercent: standingEffectsFor(repos, base).intelYieldPercent,
    tier,
  };
}

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
  const whispers = scoutParty(base);
  if (!whispers) return null;
  // The same clock as a scout party: the road twice and the looking, off the same sheet.
  const walk = planScout(repos, base, districtId, whispers, now);
  if (!walk) return null;
  return {
    minutes: walk.minutes,
    travelMinutes: walk.travelMinutes,
    returnsAt: walk.returnsAt,
    caps: SPY_TIER_SPECS[tier].caps,
  };
}

export type SendSpyResult =
  { kind: 'refused'; reason: SpyRefusal } | { kind: 'sent'; run: SpyRun; base: Base };

/**
 * Send the runners. The caps are taken here and are not coming back: a job turned round in its
 * first tenth walks home without a report and without a refund (maintainer, 2026-09-22).
 */
export function sendSpy(
  repos: Repositories,
  input: { base: Base; target: SpyTarget; tier: SpyTier; now: Date },
): SendSpyResult {
  const { base, target, tier, now } = input;
  const blocked = spyBlocker(base);
  if (blocked !== null) return { kind: 'refused', reason: blocked };
  if (repos.spying.activeFor(base.id).length > 0) return { kind: 'refused', reason: 'already_out' };

  const looked = groundBehind(repos, base, target);
  if (looked.kind === 'refused') return looked;

  const plan = planSpy(repos, base, looked.ground.district.id, tier, now);
  if (!plan) return { kind: 'refused', reason: 'no_whispers' };
  const cost = { caps: plan.caps };
  if (!canAfford(base.resources, cost)) return { kind: 'refused', reason: 'cannot_afford' };

  const paid: Base = { ...base, resources: spendResources(base.resources, cost) };
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

export function recallSpy(repos: Repositories, base: Base, now: Date): RecallSpyResult {
  const run = repos.spying.activeFor(base.id).find((active) => active.recalledAt === null);
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
 * Write the report for a run that got there, on the ground as it stands **now**.
 *
 * Now rather than at the send, because the runners look when they arrive: a garrison that
 * marched off in the meantime is not in the report, and one that marched in is. A target that
 * can no longer be looked at (the place emptied, or is the reader's own by the time they get
 * there) is written up as empty ground under whoever holds it now, which is the true answer.
 */
export function writeSpyReport(repos: Repositories, base: Base, run: SpyRun, now: Date): SpyReport {
  const looked = groundBehind(repos, base, run.target);
  const { district, placeName } = placeOf(run.target);
  const holder: LocationHolder =
    looked.kind === 'ground'
      ? looked.ground.holder
      : run.target.kind === 'location'
        ? (repos.city.control(run.target.locationId)?.holder ?? { kind: 'unoccupied' })
        : { kind: 'unoccupied' };

  const budget =
    looked.kind === 'ground'
      ? spyScore(spyStrengthFor(repos, base, run.tier)) - counterScore(looked.ground.counter)
      : 0;
  const sleeperRung = base.research.technologies.includes(SPY_SLEEPERS_RESEARCH_ID);
  const exposure = expose({
    army: looked.kind === 'ground' ? looked.ground.army : {},
    stealthOf: looked.kind === 'ground' ? looked.ground.stealthOf : printedStealth,
    visible: (unitId) => {
      const unit = findUnit(unitId);
      if (!unit || unit.unspyable === true) return false;
      return unit.sleeper !== true || sleeperRung;
    },
    budget,
  });
  const failed = !spyReportStands(exposure.accuracy);

  return {
    id: randomUUID(),
    baseId: base.id,
    target: run.target,
    districtId: district?.id ?? '',
    districtName: district?.name ?? 'somewhere',
    placeName,
    holder: holderOf(repos, holder),
    tier: run.tier,
    capsPaid: run.capsPaid,
    writtenAt: now.toISOString(),
    failed,
    exposed: failed ? {} : exposure.exposed,
    accuracy: exposure.accuracy,
    unseen: base.research.technologies.includes(SPY_ESTIMATE_RESEARCH_ID) ? exposure.unseen : null,
    accuracyShown: base.research.technologies.includes(SPY_ACCURACY_RESEARCH_ID),
  };
}

/** Tell the holder, if their Consigliere has the rung for it; tell them who, with the rung after. */
function warnHolder(
  repos: Repositories,
  reader: Base,
  report: SpyReport,
  holder: LocationHolder,
  now: Date,
): void {
  if (holder.kind !== 'crew') return;
  const crew = repos.bases.findById(holder.baseId);
  if (!crew || !crew.research.technologies.includes(SPY_NOTICE_RESEARCH_ID)) return;
  const traced = crew.research.technologies.includes(SPY_TRACE_RESEARCH_ID);
  const where = `${report.placeName}, ${report.districtName}`;
  const seen = armySize(report.exposed);
  notifyBase(repos, crew.id, {
    kind: 'spied_on',
    title: `Somebody has been looking at ${report.placeName}`,
    body: traced
      ? report.failed
        ? `${reader.name}'s spies were at ${where} and came away with nothing.`
        : `${reader.name}'s spies read ${where}: they saw ${seen} of yours.`
      : `Your Consigliere caught wind of eyes on ${where}. Whose, and what they saw, is beyond them.`,
    link: `/game/city/${report.districtId}`,
    subjectId: report.districtId,
    now,
  });
}

/**
 * Bring home every job whose mark has passed, and write what it found.
 *
 * On the world clock rather than on a read path, for the reason a scout party is: a report is a
 * receipt, and a receipt is worth having when it arrives.
 */
export function settleSpying(repos: Repositories, now: Date): number {
  const due = repos.spying.due(now.toISOString());
  for (const run of due) {
    repos.spying.markSettled(run.id, now.toISOString());
    // Turned round: home without a report. The caps went at the send.
    if (run.recalledAt !== null) continue;
    const base = repos.bases.findById(run.baseId);
    if (!base) continue;

    const report = writeSpyReport(repos, base, run, now);
    repos.spying.insertReport(report);
    /*
     * The ladder counts what was **learnt**.
     *
     * A report on ground with nobody standing on it stands (there was nothing to miss, so the
     * accuracy is one) and it is worth filing: "the place was empty when they looked" is the
     * answer a player paid for. It is not a feat, though. Every crew's gate starts with nobody
     * at it, so counting it would make `spy_reports` a hundred caps a rung.
     */
    if (!report.failed && armySize(report.exposed) > 0) tallySpyReport(repos, base.id);
    notifyBase(repos, base.id, {
      kind: 'spy_report',
      title: report.failed ? 'Your spies came back with nothing' : 'A spy report is in',
      body: report.failed
        ? `${report.placeName}, ${report.districtName}: nothing they would put their name to.`
        : `${report.placeName}, ${report.districtName}: ${armySize(report.exposed)} seen.`,
      link: `/game/battles?spy=${report.id}`,
      subjectId: report.id,
      now,
    });
    const looked = groundBehind(repos, base, run.target);
    if (looked.kind === 'ground') warnHolder(repos, base, report, looked.ground.holder, now);
  }
  return due.length;
}

/** The run this crew has out, named for the screens, or null. */
export function spyRunView(repos: Repositories, base: Base): SpyRunView | null {
  const run = repos.spying.activeFor(base.id)[0];
  if (!run) return null;
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
