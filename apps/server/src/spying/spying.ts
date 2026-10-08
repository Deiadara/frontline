import { randomUUID } from 'node:crypto';
import {
  combinePresenceOver,
  sameSpyTarget,
  chairIsSettled,
  chairPassiveOf,
  HOLDER_LABELS,
  LOCATION_CATALOG,
  SPY_ACCURACY_RESEARCH_ID,
  SPY_ESTIMATE_RESEARCH_ID,
  SPY_GATE_PLACE,
  SPY_QUIET_RESEARCH_ID,
  SPY_SLEEPERS_RESEARCH_ID,
  SPY_TIER_SPECS,
  SPY_WHOLE_WIRE_RESEARCH_ID,
  SPY_WRITTEN_RESEARCH_ID,
  buildingLevel,
  canAfford,
  capRating,
  counterIntelPoints,
  cityIsOpen,
  counterScore,
  displayNameOf,
  expose,
  findDistrict,
  findLocation,
  findUnit,
  fittedFor,
  gateIsBroken,
  officerBattleStats,
  roughAccuracy,
  roughUnseen,
  spendResources,
  spyJobMinutes,
  spyRecallable,
  spyRecalledReturnsAt,
  spyReportStands,
  spyFoundOut,
  spyPartiesAllowed,
  spyReportSummary,
  spyDefenceMean,
  spyDefencePercent,
  spyScore,
  spyTierOpen,
  spyUnnoticedChance,
  travelMinutesBetween,
  unitSlotsUsed,
  upgradedStats,
  type Army,
  type Attributes,
  type Base,
  type Commander,
  type CounterStrength,
  type District,
  type Exposure,
  type LocationHolder,
  type SpiedForce,
  type SpyRefusal,
  type SpyReport,
  type SpyReportHolder,
  type SpyRun,
  type SpyRunView,
  type SpyStrength,
  type SpyTarget,
  type SpyTier,
  type SpyPoints,
  SPY_TIERS,
  openSpyTiers,
  territoryEffectsFor,
  EVERY_LOCATION,
} from '@frontline/shared';
import { adminCaps, adminWaives } from '../admin/mode.js';
import { mergeArmies } from '../battle/forces.js';
import { livingIn, residentOf } from '../battle/ground.js';
import { sidesReader } from '../battle/alignment.js';
import { withoutTheLeader } from '../battle/resolve.js';
import { gateFor } from '../city/gates.js';
import {
  crewEffectsFor,
  liftedOfficerSheet,
  liftedOverseerSheet,
  officerFitReader,
  officerLiftRoom,
  standingEffectsFor,
} from '../crew/standing.js';
import type { Repositories } from '../db/repos/index.js';
import { alliesOf, tableOf, wholeHolderOf } from '../city/holding.js';
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
 * two sides of it from the save. For the spying side it reads the chair's seat points and the
 * crew's `intelYieldPercent` (the standing fold, which is perks and held ground: no rating and no
 * rung pays it since 2026-10-01, when the grade became the whole of the officer side).
 * For the other side it reads the holder's own Master of Whispers (the same seat points, so two
 * equal chairs cancel), their `intelResistancePercent` (perks only, the same ruling; the gate is
 * its own term), their counter-intelligence cards, and the gate over the place.
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
export function spyBlocker(base: Base, now: Date = new Date()): 'no_whispers' | null {
  return whispersAtWork(base, now) === undefined ? 'no_whispers' : null;
}

export interface SpyGround {
  district: District;
  placeName: string;
  holder: LocationHolder;
  /** Who is standing there, other crews' Sleepers included when the reader's rung allows. */
  army: Army;
  /**
   * The same units, one force per owner, each read at the stealth its owner fields (maintainer,
   * 2026-10-01). `army` is these merged.
   */
  forces: SpiedForce[];
  counter: CounterStrength;
  /** A captured gate held by a crew living elsewhere: nobody stands there between fights (P3-A). */
  heldFromAway?: boolean;
}

export type SpyGroundResult =
  { kind: 'refused'; reason: SpyRefusal } | { kind: 'ground'; ground: SpyGround };

function crewStealthReader(
  repos: Repositories,
  holder: Base,
  now: Date,
): (unitId: string) => number {
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
  const percent = standingEffectsFor(repos, holder, now).unitStealthPercent;
  return (unitId) => {
    const unit = findUnit(unitId);
    if (!unit) return 0;
    const fitted = upgradedStats(unit.stats, fittedFor(holder.unitLoadouts, unitId));
    return capRating(Math.round(fitted.stealth * (1 + percent / 100)));
  };
}

const printedStealth = (unitId: string): number => findUnit(unitId)?.stats.stealth ?? 0;

/** One owner's units at that owner's stealth: their cards and the ground they hold. */
function crewForce(
  repos: Repositories,
  owner: Base | undefined,
  army: Army,
  now: Date,
): SpiedForce {
  return { army, stealthOf: owner ? crewStealthReader(repos, owner, now) : printedStealth };
}

/** The forces on a place, merged into the one army a report counts. */
function mergedForces(forces: readonly SpiedForce[]): Army {
  return forces.reduce<Army>((all, force) => mergeArmies(all, force.army), {});
}

/**
 * A gate's level as the contest counts it: none while it is broken (maintainer, 2026-09-27: a
 * broken door "holds no one out and hides nothing, until the breach closes"). The fight and the
 * standing fold already read a breach that way; this read the level and charged a spy for a wall
 * lying in the street.
 */
function gateStanding(repos: Repositories, districtId: string, level: number, now: Date): number {
  return gateIsBroken(repos.sieges.gate(districtId), now) ? 0 : level;
}

/**
 * What the holder's people add to its guard against spies, as a percentage (maintainer,
 * 2026-10-01, and 2026-10-04 for the Overseer): Signals and Cryptography, averaged over everybody
 * seated and working but the Master of Whispers, whose grade guards on its own, and over the
 * Overseer, off the sheets the room lifts them to. These two skills are the one thing every person
 * in the room still gives whatever chair they sit in. The bench and the injured are not in it.
 */
function officersSpyDefencePercent(repos: Repositories, holder: Base, now: Date): number {
  const room = officerLiftRoom(repos, holder, now);
  const sheets = room.fit
    .filter((officer) => officer.role !== 'master_of_whispers')
    .map((officer) => liftedOfficerSheet(officer, room).attributes);
  const owner = repos.users.findById(holder.ownerId);
  const overseer = owner?.overseerId ? repos.overseers.findById(owner.overseerId) : undefined;
  if (overseer) sheets.push(liftedOverseerSheet(overseer.attributes, room));
  return spyDefencePercent(spyDefenceMean(sheets));
}

/**
 * A crew's counter: their own Master of Whispers' fit for the chair, their perks' counter-intel,
 * the cards, the gate.
 *
 * The chair's points are read exactly as `spyStrengthFor` reads them for that crew's own jobs
 * (maintainer, 2026-10-01): "a master of whispers in defense ... cancels out a spying master of
 * whispers with equivalent strength". Working, not merely seated (maintainer, 2026-09-23): an
 * injured one defends nothing.
 */
function crewCounter(
  repos: Repositories,
  holder: Base,
  gateLevel: number,
  now: Date,
): CounterStrength {
  return {
    kind: 'crew',
    whispersChairPoints: whispersChairPoints(repos, holder, now),
    /*
     * The **people-only** fold here, deliberately, and not the standing one (bug pass,
     * 2026-09-23: tried and reverted).
     *
     * `standingEffectsFor` folds in the district's own buildings, and the Gate is a building whose
     * `intelResistancePercent` this contest already counts explicitly, in points, a few lines
     * down. Reading the wider fold counted the same door twice and doubled what a maxed Gate was
     * worth against a spy. `crewStealthReader` above takes the standing fold because the channel
     * it reads is paid by a held *location* nothing else in this contest counts.
     *
     * On this channel the people fold is the perks alone since 2026-10-01: no rating and no rung
     * pays points against spies, the holder's own grade above being the officer side.
     */
    // ...and the district's counter-intelligence cards (Encrypted Core), which are points of the
    // same kind and are in neither fold (2026-10-01).
    // ...and the ground's own points against spies (the Chapter of Silence, 2026-10-07), off the
    // territory fold alone, which is the standing fold less the gate counted below.
    intelResistancePercent:
      crewEffectsFor(repos, holder, now).intelResistancePercent +
      territoryEffectsFor(
        holder.id,
        EVERY_LOCATION,
        repos.city.controls(),
        alliesOf(repos, holder.id),
      ).intelResistancePercent +
      counterIntelPoints(holder.buildings),
    gateLevel,
    officersPercent: officersSpyDefencePercent(repos, holder, now),
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

/**
 * What other crews have on this ground and would defend it with, one force per posting and per
 * Sleeper cell, each at its owner's stealth. Cells only with the reader's Sleeper Lists rung.
 */
function othersOn(
  repos: Repositories,
  locationId: string,
  against: (ownerBaseId: string) => boolean,
  sleepersSeen: boolean,
  now: Date,
): SpiedForce[] {
  const postings = repos.alliedGarrisons.at(locationId);
  const cells = sleepersSeen ? repos.sleepers.waitingOn(locationId) : [];
  return [...postings, ...cells]
    .filter((row) => against(row.baseId))
    .map((row) => crewForce(repos, repos.bases.findById(row.baseId), row.army, now));
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
  /**
   * The instant the ground is read at. Whether the holder's Master of Whispers is out of bed is a
   * fact about this instant, and a settle reasons about the tick's, not the wall clock's.
   */
  now: Date = new Date(),
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
    // Shut by one holder or by a table holding it together (2026-10-07).
    if (wholeHolderOf(repos, district) !== null) return refused('not_the_gate');
    /*
     * The Curate's Propaganda (maintainer, 2026-10-07): while she is alive on her plot, no
     * location in her district can be read at all. Refused here rather than answered with an empty
     * or a wrong report, so the player is told there is a reason and can go and kill it.
     */
    const over = combinePresenceOver(district.id, [...repos.city.controls().values()]);
    if (over?.power.kind === 'curate') return refused('only_lies');

    // The holder's garrison, the postings on it and, with the rung, the cells, of whoever would
    // defend it against the reader (`standsAgainst`).
    const against = standsAgainst(
      repos,
      reader,
      control.holder.kind === 'crew' ? control.holder.baseId : null,
    );
    const others = othersOn(repos, location.id, against, sleeperRung, now);
    if (control.holder.kind === 'crew') {
      const holder = repos.bases.findById(control.holder.baseId);
      if (!holder) return refused('nothing_there');
      const forces = [crewForce(repos, holder, control.garrison, now), ...others];
      return {
        kind: 'ground',
        ground: {
          district,
          placeName: location.name,
          holder: control.holder,
          army: mergedForces(forces),
          forces,
          counter: crewCounter(repos, holder, 0, now),
        },
      };
    }
    const forces = [{ army: control.garrison, stealthOf: printedStealth }, ...others];
    return {
      kind: 'ground',
      ground: {
        district,
        placeName: location.name,
        holder: control.holder,
        army: mergedForces(forces),
        forces,
        counter: {
          kind: control.holder.kind,
          districtDifficulty: district.difficulty,
          baseDefense: LOCATION_CATALOG[location.kind].baseDefense,
        },
      },
    };
  }

  const district = findDistrict(target.districtId);
  if (!district) return refused('nothing_there');

  if (district.kind === 'residential') {
    const resident = residentOf(repos, district.id);
    if (!resident) return refused('nothing_there');
    if (resident.id === reader.id) return refused('own_ground');
    // What stands behind a player's gate: the gate garrison, since the split (2026-09-22), and
    // the gate garrison of any neighbour on the resident's side (`battle/alignment.ts`). A
    // neighbour exists only in a database from before 2026-09-28, when a plot could hold two
    // crews; the merge goes with the bots (the TODO in `seed/index.ts`).
    const forces = [
      crewForce(repos, resident, resident.gateArmy ?? {}, now),
      ...livingIn(repos, district.id)
        .filter((neighbour) => neighbour.id !== resident.id)
        .filter((neighbour) => standsAgainst(repos, reader, resident.id)(neighbour.id))
        .map((neighbour) => crewForce(repos, neighbour, neighbour.gateArmy ?? {}, now)),
    ];
    return {
      kind: 'ground',
      ground: {
        district,
        placeName: SPY_GATE_PLACE,
        holder: { kind: 'crew', baseId: resident.id },
        army: mergedForces(forces),
        forces,
        counter: crewCounter(
          repos,
          resident,
          gateStanding(repos, district.id, buildingLevel(resident.buildings, 'gate'), now),
          now,
        ),
      },
    };
  }

  // The table's named defender answers for a gate held together (2026-10-07).
  const holder = wholeHolderOf(repos, district);
  if (holder === null || holder.kind === 'unoccupied') return refused('nothing_there');
  /*
   * Nobody at the table (maintainer, 2026-10-07). Only the *named* member was refused until then,
   * so a mate could run a job against their own faction's gate and read the counter-intel, the
   * gate level and the whispers points of the crew standing in it. A gate a faction holds is the
   * faction's own ground whichever member the map happens to name on it.
   */
  if (holder.kind === 'crew' && tableOf(repos, reader.id).has(holder.baseId)) {
    return refused('own_ground');
  }
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
        forces: [],
        counter: crewCounter(
          repos,
          crew,
          gateStanding(repos, district.id, gateFor(repos, district.id).level, now),
          now,
        ),
        heldFromAway: true,
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
      forces: [{ army, stealthOf: printedStealth }],
      counter: {
        kind: holder.kind,
        districtDifficulty: district.difficulty,
        // The hardest ground in the district is what its gate is read against.
        baseDefense: Math.max(
          0,
          ...district.locations.map((location) => LOCATION_CATALOG[location.kind].baseDefense),
        ),
      },
    },
  };
}

/**
 * The Master of Whispers' grade as the contest reads it, on either side, or null with nobody
 * settled in the chair.
 *
 * Settled, not merely working (maintainer, 2026-10-05): the grade counts once they have been in
 * the chair `CHAIR_SETTLE_HOURS`. The job itself does not wait, so somebody seated a moment ago
 * can send runners, at no grade. One reader for both sides, so the cooldown cannot hold on attack
 * and leak on defence.
 */
export function whispersChairPoints(repos: Repositories, base: Base, now: Date): number | null {
  const whispers = whispersAtWork(base, now);
  if (!whispers || !chairIsSettled(whispers, now)) return null;
  return officerFitReader(repos, base, now).pointsFor(whispers, 'master_of_whispers');
}

/** This crew's side of the contest, as the shared arithmetic wants it. */
export function spyStrengthFor(
  repos: Repositories,
  base: Base,
  tier: SpyTier,
  now: Date = new Date(),
): SpyStrength {
  return {
    chairPoints: whispersChairPoints(repos, base, now) ?? 0,
    intelPercent: standingEffectsFor(repos, base, now).intelYieldPercent,
    tier,
  };
}

/**
 * The crew's own two totals (maintainer, 2026-10-07), for the Master of Whispers' seat, the Spy
 * Reports tab and the district reports: what its spies score at the best tier its Lab has opened,
 * and what a spy on its own gate meets. Both run the same arithmetic the contest does, so the
 * figures a player reads are the ones a job is settled on.
 */
export function spyPointsFor(repos: Repositories, base: Base, now: Date): SpyPoints {
  const tiers = openSpyTiers(base.research.technologies);
  const best = tiers[tiers.length - 1] ?? SPY_TIERS[0];
  const defence = crewCounter(
    repos,
    base,
    gateStanding(repos, base.districtId, buildingLevel(base.buildings, 'gate'), now),
    now,
  );
  return {
    offence: Math.round(spyScore(spyStrengthFor(repos, base, best, now))),
    defence: Math.round(counterScore(defence)),
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
  const whispers = whispersAtWork(base, now);
  if (!whispers) return null;
  /*
   * The lifted sheet (maintainer, 2026-09-30), the one the crew screen draws and every officer
   * fights and is graded on. The quote on the district screen and the send both come through here
   * with the same `now`, so the job a player is quoted is the job that is frozen.
   */
  const sheet = liftedOfficerSheet(whispers, officerLiftRoom(repos, base, now)).attributes;
  const travelMinutes = walkMinutes(repos, base, districtId, sheet, now);
  if (travelMinutes === null) return null;
  const minutes = spyJobMinutes(travelMinutes, sheet);
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
 * a march. The pace is the Master of Whispers' own speed off their lifted sheet, and the ground's
 * reductions stack on top of that the way they do for a march.
 */
function walkMinutes(
  repos: Repositories,
  base: Base,
  districtId: string,
  sheet: Attributes,
  now: Date,
): number | null {
  const from = findDistrict(base.districtId);
  const to = findDistrict(districtId);
  if (!from || !to) return null;
  const effects = standingEffectsFor(repos, base, now);
  return travelMinutesBetween(from, to, {
    speed: officerBattleStats(sheet).speed,
    reductionPercent: effects.travelSpeedPercent,
    baseCutPercent: chairPassiveOf(effects, 'cartographer', 'travel_time'),
  });
}

/** How many jobs this crew may have out at once: one, and another with Two Sets of Eyes. */
export function spyPartiesFor(repos: Repositories, base: Base, now: Date = new Date()): number {
  return spyPartiesAllowed(standingEffectsFor(repos, base, now).spyPartiesFlat);
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
  const blocked = spyBlocker(base, now);
  if (blocked !== null) return { kind: 'refused', reason: blocked };
  if (!spyTierOpen(tier, base.research.technologies)) {
    return { kind: 'refused', reason: 'tier_locked' };
  }
  const out = repos.spying.activeFor(base.id);
  // One job per place (maintainer, 2026-10-05): checked before the party count, so a crew with a
  // second party free is told why this one cannot go rather than that every party is out.
  if (out.some((run) => sameSpyTarget(run.target, target))) {
    return { kind: 'refused', reason: 'watching_here' };
  }
  if (out.length >= spyPartiesFor(repos, base, now)) {
    return { kind: 'refused', reason: 'already_out' };
  }

  const looked = groundBehind(repos, base, target, now);
  if (looked.kind === 'refused') return looked;
  // A shut city has garrisons on its ground, so there is always somebody to read there, and
  // nothing a crew could do with the report (bug pass, 2026-09-29).
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

  // The score is fixed here, the way the clock and the price are (maintainer, 2026-10-01).
  const { chairPoints, intelPercent } = spyStrengthFor(repos, base, tier, now);
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
    chairPoints,
    intelPercent,
  };
  repos.spying.insert(run);
  return { kind: 'sent', run, base: paid };
}

export type RecallSpyResult =
  { kind: 'refused'; reason: 'nobody_out' | 'window_closed' } | { kind: 'recalled'; run: SpyRun };

/**
 * Turn one job round: the one named, or the first still open to a recall when none is.
 *
 * Unnamed, the first whose window is still open, not merely the first out (bug pass, 2026-10-01):
 * with Two Sets of Eyes the older job is usually past its tenth, and picking it refused a recall
 * the newer one was still entitled to.
 */
export function recallSpy(
  repos: Repositories,
  base: Base,
  now: Date,
  runId?: string,
): RecallSpyResult {
  const out = repos.spying
    .activeFor(base.id)
    .filter((active) => active.recalledAt === null && (runId === undefined || active.id === runId));
  const run = out.find((active) => spyRecallable(active, now)) ?? out[0];
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
  // Nobody stands at such a gate between fights, so there is no accuracy to print and nothing to
  // estimate: the report says who is there right now, which is nobody (maintainer, 2026-10-02).
  const heldFromAway = looked.kind === 'ground' && looked.ground.heldFromAway === true;
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
    // Both rounded (maintainer, 2026-10-01): exact, the pair gave back the count The Whole Wire
    // is sold for.
    accuracy:
      rules.accuracyShown && !failed && !heldFromAway ? roughAccuracy(exposure.accuracy) : null,
    unseen: rules.unseenShown && !failed && !heldFromAway ? roughUnseen(exposure.unseen) : null,
    accuracyShown: rules.accuracyShown,
    heldFromAway,
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
    forces: looked.kind === 'ground' ? looked.ground.forces : [],
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
 * This run's side of the contest: what was frozen at the send, or for a run sent before the freeze,
 * the chair as it stands now.
 */
function frozenStrength(repos: Repositories, base: Base, run: SpyRun, now: Date): SpyStrength {
  if (run.chairPoints === null || run.intelPercent === null) {
    return spyStrengthFor(repos, base, run.tier, now);
  }
  return { chairPoints: run.chairPoints, intelPercent: run.intelPercent, tier: run.tier };
}

/**
 * Write the report for a run that got there, on the ground as it stands **now**.
 *
 * Now rather than at the send, because the runners look when they arrive: a garrison that
 * marched off in the meantime is not in the report, and one that marched in is. A target that
 * emptied, or is the reader's own by the time they get there, is written up as empty ground; one
 * that can no longer be looked at from outside is a failed report ({@link FOUND_NOTHING}). The
 * spying side is the one frozen at the send (maintainer, 2026-10-01): benching or swapping the
 * Master of Whispers while the runners are out changes nothing about the job.
 *
 * Whether the holder saw them is rolled here, once, off the run's id (maintainer, 2026-09-28):
 * always before Traffic Analysis, then less often the better the chair's grade.
 */
export function writeSpyReport(repos: Repositories, base: Base, run: SpyRun, now: Date): SpyReport {
  const looked = groundBehind(repos, base, run.target, now);
  const strength = frozenStrength(repos, base, run, now);
  // Off the ground there is no counter to beat: nothing to read, and nothing to fail against.
  const budget =
    looked.kind === 'ground' ? spyScore(strength) - counterScore(looked.ground.counter) : Infinity;
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
 * Tell the holder who came, when the runners were seen (maintainer, 2026-09-22 and 2026-09-28).
 * A job nobody saw is never heard of: the Consigliere's rungs that told of one left the game with
 * the chair (maintainer, 2026-10-01).
 */
function tellHolder(
  repos: Repositories,
  reader: Base,
  report: SpyReport,
  crewId: string,
  at: Date,
): void {
  if (!report.foundOut) return;
  const crew = repos.bases.findById(crewId);
  if (!crew) return;
  notifyBase(repos, crew.id, {
    kind: 'spied_on',
    title: `${spyingName(repos, reader)} has been spying on ${report.placeName}`,
    body: `Their runners were seen at ${report.placeName}, ${report.districtName}.`,
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
/**
 * The runners read the ground when they reach it (maintainer, 2026-10-02, P3-B).
 *
 * The report used to be written at the return, so a garrison that moved while they walked home was
 * on the report as if they had seen it. The read is taken here, the moment they arrive, kept on the
 * run, and delivered by {@link settleSpying} when they are home, dated when they looked.
 */
export function snapshotSpying(repos: Repositories, now: Date): number {
  const arrived = repos.spying
    .unread()
    .filter((run) => spyArrivesAt(run).getTime() <= now.getTime());
  return settleEach(
    repos,
    'spy snapshots',
    arrived,
    (run) => run.id,
    (run) => {
      const base = repos.bases.findById(run.baseId);
      if (!base) return;
      /*
       * Dated when the ground was read, which is now (maintainer, 2026-10-06). Normally that is
       * the second they arrived; after a restart over a fight it is the restart, and dating it at
       * the arrival showed the ground as the later fight left it under an earlier time.
       */
      repos.spying.putSnapshot(run.id, {
        report: writeSpyReport(repos, base, run, now),
        // Whose ground it was when they looked: the crew that could have seen them (review,
        // 2026-10-02). Read at the return, a place that changed hands meanwhile told its new
        // holder about a look taken on the old one's ground.
        watcher: watcherOf(repos, base, groundBehind(repos, base, run.target, now), run.target),
      });
    },
  );
}

/** When the runners reach the target: the way out, before the look and the way home. */
function spyArrivesAt(run: Pick<SpyRun, 'departedAt' | 'travelMinutes'>): Date {
  return new Date(Date.parse(run.departedAt) + run.travelMinutes * 60_000);
}

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

      // The read taken when they arrived, or one taken now for a run sent before reads were kept.
      const snapshot = repos.spying.snapshotOf(run.id);
      const report = snapshot?.report ?? writeSpyReport(repos, base, run, now);
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
      const watcher =
        snapshot?.watcher !== undefined
          ? snapshot.watcher
          : watcherOf(repos, base, groundBehind(repos, base, run.target, now), run.target);
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
