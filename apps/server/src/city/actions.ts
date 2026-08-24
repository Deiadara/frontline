import { randomUUID } from 'node:crypto';
import {
  FORTIFY_MAX_LEVEL,
  MAX_LOCATION_LEVEL,
  addResources,
  adjustMeter,
  addToArmy,
  canAfford,
  disruptionFrom,
  fortifyCost,
  fortifySeconds,
  infamyForRaidWon,
  isHeldBy,
  lootCapacityOf,
  raidLootBonus,
  nextFortifyLevel,
  battlefieldFor,
  districtDefense,
  type TerritoryEffects,
  homeBattlefield,
  plunder,
  raidTargetOf,
  recordRaidOutcome,
  refreshDisruption,
  spendResources,
  takeFromArmy,
  weightOf,
  type Army,
  type Base,
  type BattleResult,
  type District,
  type EconomyState,
  type Location,
  type LocationControl,
  type SkirmishEngine,
  recoverCasualties,
} from '@frontline/shared';
import { forceSize, hasForce, mergeArmies, removeForce } from '../battle/forces.js';
import { standingEffectsFor } from '../crew/standing.js';
import type { Repositories } from '../db/repos/index.js';

/**
 * Taking ground by force is the loudest *infamous* action in the game (GDD §D7), and §D8 keeps its
 * own record of whose ground it was.
 *
 * Both halves move on the same event and neither is stored twice: the meter is nudged and the
 * stance tally is appended, from one reading of the district. `raidTargetOf` is the shared answer
 * to "whose was it", so the map is the only location that is authored.
 */
function recordTaking(
  economy: EconomyState,
  district: District,
  winner: 'attacker' | 'defender',
  now: Date,
): EconomyState {
  const target = raidTargetOf(district);
  return {
    ...economy,
    infamy:
      winner === 'attacker'
        ? adjustMeter(
            economy.infamy,
            infamyForRaidWon({
              fromTheState: target.faction === 'government',
              seatOfPower: target.isSeatOfPower,
            }),
          )
        : economy.infamy,
    reputationTally: recordRaidOutcome(economy.reputationTally, { winner, target }, now),
  };
}

/**
 * Doing things to the city (GDD §A4).
 *
 * Every action here resolves **immediately**. Travel time is computed and shown — it is what the
 * Rail Yard and the Skate Ground are for — but a force does not yet spend it in transit.
 *
 * TODO-LATER: forces in transit. A sent force should arrive after `travelMinutes` and resolve
 * then, the way a mission does (§E2), which also makes intercepting one possible. That is a
 * scheduling shape this game already has twice over; it is left out here so the map ships with the
 * territory rules rather than half of both.
 */

export const CITY_REFUSALS = [
  'unscouted',
  'no_force',
  'not_enough_units',
  'already_held',
  'not_held',
  'not_contested',
  'not_raidable',
  'at_max_fortification',
  'already_fortifying',
  'cannot_afford',
] as const;
export type CityRefusal = (typeof CITY_REFUSALS)[number];

export type CityActionResult<T> = { kind: 'refused'; reason: CityRefusal } | ({ kind: 'ok' } & T);

/**
 * Finishes any fortification *or upgrade* whose clock has run out.
 *
 * Called at the top of every city read and write, which is the same lazy contract the rest of the
 * game runs on. Returns the controls it settled so callers do not read them twice.
 *
 * Both clocks in one pass on purpose: they live on the same row, they bank the same way, and a
 * second settler over the same table is a second chance to forget to call one of them.
 */
export function settleFortifications(repos: Repositories, now: Date): Map<string, LocationControl> {
  const controls = repos.city.controls();
  for (const control of controls.values()) {
    const dug =
      control.fortifyingUntil !== null && Date.parse(control.fortifyingUntil) <= now.getTime();
    const worked =
      control.upgradingUntil !== null && Date.parse(control.upgradingUntil) <= now.getTime();
    if (!dug && !worked) continue;

    const settled: LocationControl = {
      ...control,
      fortification: dug
        ? Math.min(FORTIFY_MAX_LEVEL, control.fortification + 1)
        : control.fortification,
      fortifyingUntil: dug ? null : control.fortifyingUntil,
      level: worked ? Math.min(MAX_LOCATION_LEVEL, control.level + 1) : control.level,
      upgradingUntil: worked ? null : control.upgradingUntil,
    };
    repos.city.put(settled);
    controls.set(control.locationId, settled);
  }
  return controls;
}

// --- taking a location ---

export interface AttackInput {
  base: Base;
  location: Location;
  /** The ground the location stands on — §D7/§D8 read *whose* it was, not which location it was. */
  district: District;
  force: Army;
  scouted: boolean;
  now: Date;
}

export interface AttackOutcome {
  result: BattleResult;
  captured: boolean;
  /** Survivors that came home — the whole force on a win, whoever ran on a loss. */
  returned: Army;
  base: Base;
}

/**
 * One location, one fight.
 *
 * On a win the location changes hands, its fortification is levelled and its garrison is gone — a
 * captured position is not a captured position *plus the enemy's diggings*. On a loss the attacking
 * force routs: the ones who ran come home, the ones who did not are dead.
 *
 * There is no one-off haul for taking a location. The reward is holding it, which is the point of the
 * whole system — a location that paid out on capture would be worth taking and abandoning.
 */
export function attackPlace(
  repos: Repositories,
  engine: SkirmishEngine,
  input: AttackInput,
): CityActionResult<AttackOutcome> {
  const { base, location, district, force, scouted, now } = input;
  if (!scouted) return { kind: 'refused', reason: 'unscouted' };
  if (forceSize(force) === 0) return { kind: 'refused', reason: 'no_force' };
  if (!hasForce(base.army, force)) return { kind: 'refused', reason: 'not_enough_units' };

  const control = repos.city.control(location.id);
  if (!control) return { kind: 'refused', reason: 'not_contested' };
  if (isHeldBy(control, base.id)) return { kind: 'refused', reason: 'already_held' };

  const outcome = engine.resolve({
    seed: randomUUID(),
    attackerName: base.name,
    defenderName:
      control.holder.kind === 'faction' ? 'the crew holding it' : holderWord(control.holder.kind),
    locationName: location.name,
    attacking: force,
    defending: control.garrison,
    // The ground the fight actually happens on (§A4): what kind of location it is, how far into it
    // the holder has dug, and whether it is dark. `locationDefense` folded all three into one number,
    // which the engine can no longer use — a sheet that says "below street level" needs to be told
    // that it *is* below street level, not handed a total.
    battlefield: battlefieldFor({
      locationName: location.name,
      kind: location.kind,
      fortifyDifficulty: location.fortifyDifficulty,
      fortifyLevel: control.fortification,
      at: now,
    }),
    attackerTerritory: standingEffectsFor(repos, base),
  });

  const captured = outcome.winner === 'attacker';
  // Winning is not free. `outcome.winnerLosses` is what the victor paid, and it used to be computed
  // by the engine and read by nobody — so a successful attack returned the *whole* force including
  // its dead, and the attrition the engine spends six modules calculating never reached the game.
  // §F2 — Medicine takes some of them off the casualty list before it is applied. The infirmary
  // is at home, so this is only ever *our* dead: the defender's medics are not ours to call on.
  const survived = recoverCasualties(
    outcome.winnerLosses,
    standingEffectsFor(repos, base).casualtyRecoveryPercent,
  );
  const returned = captured ? removeForce(force, survived) : outcome.fled;

  if (captured) {
    repos.city.put({
      locationId: location.id,
      holder: { kind: 'faction', baseId: base.id },
      // §A4 — a capture resets the work. Level 1 and no clock: nobody inherits what the last
      // holder poured in, which is the whole reason a well-developed location is worth taking.
      level: 1,
      upgradingUntil: null,
      fortification: 0,
      fortifyingUntil: null,
      garrison: {},
    });
    returnRoutedDefenders(repos, control, outcome.fled);
  } else {
    // The holder held, and paid for it. Without this a garrison could turn back any number of
    // assaults at no cost at all.
    repos.city.put({ ...control, garrison: removeForce(control.garrison, outcome.winnerLosses) });
  }

  const army = mergeArmies(removeForce(base.army, force), returned);
  const economy = recordTaking(base.economy, district, outcome.winner, now);
  const next: Base = { ...base, army, economy };
  repos.bases.updateArmy(next.id, next.army, next.trainingQueue);
  repos.bases.updateEconomy(next.id, next.economy);

  return {
    kind: 'ok',
    result: { winner: outcome.winner, log: outcome.log, rewards: {} },
    captured,
    returned,
    base: next,
  };
}

/** A routed *defending* crew gets its runners back; the Combine and the looters do not. */
function returnRoutedDefenders(repos: Repositories, control: LocationControl, fled: Army): void {
  if (control.holder.kind !== 'faction') return;
  const owner = repos.bases.findById(control.holder.baseId);
  if (!owner) return;
  const army = mergeArmies(owner.army, fled);
  repos.bases.updateArmy(owner.id, army, owner.trainingQueue);
}

function holderWord(kind: LocationControl['holder']['kind']): string {
  switch (kind) {
    case 'government':
      return 'The Combine';
    case 'looters':
      return 'The looters';
    case 'unoccupied':
      return 'Nobody';
    default:
      return 'The holder';
  }
}

// --- raiding a home district ---

export interface RaidInput {
  base: Base;
  district: District;
  target: Base;
  force: Army;
  now: Date;
}

export interface RaidOutcome {
  result: BattleResult;
  returned: Army;
  carriedKg: number;
  base: Base;
}

/**
 * Robbing somebody's home (§A4).
 *
 * It can never be captured, so a win is measured in what left with you and what you left broken:
 * a share of the stockpile bounded by what the force can physically carry, and a district running
 * at reduced effectiveness for a few hours afterwards.
 */
/**
 * A defender's territory effects with what they built folded in.
 *
 * Kept as a function rather than inlined so the two territory lookups the first version made —
 * one for the spread and one for the addition — cannot drift apart.
 */
function withGate(effects: TerritoryEffects, buildings: Base['buildings']): TerritoryEffects {
  return { ...effects, defensePercent: effects.defensePercent + districtDefense(buildings) };
}

export function raidDistrict(
  repos: Repositories,
  engine: SkirmishEngine,
  input: RaidInput,
): CityActionResult<RaidOutcome> {
  const { base, target, force, district, now } = input;
  if (forceSize(force) === 0) return { kind: 'refused', reason: 'no_force' };
  if (!hasForce(base.army, force)) return { kind: 'refused', reason: 'not_enough_units' };

  const effects = standingEffectsFor(repos, base);
  const outcome = engine.resolve({
    seed: randomUUID(),
    attackerName: base.name,
    defenderName: target.name,
    locationName: district.name,
    attacking: force,
    defending: target.army,
    // A home district is streets and structures — there is no location kind and nothing dug in.
    battlefield: homeBattlefield(district.name, now),
    attackerTerritory: effects,
    // The Gate, finally. `districtDefense` folds in the Gate's level and any modification that
    // raises it, and until now it was computed and read by nothing — the one structure whose whole
    // job is raid protection did not appear in a raid.
    defenderTerritory: withGate(standingEffectsFor(repos, target), target.buildings),
  });

  const won = outcome.winner === 'attacker';
  // Both halves of the haul bonus: what the crew holds in the city (`effects`) and what they built
  // at home (`raidLootBonus` — the Garage and its modifications). The second was computed by
  // `standing.ts` and read by nobody, the same dead wiring the Gate had.
  const capacity = lootCapacityOf(
    force,
    effects.lootCapacityPercent + raidLootBonus(base.buildings),
  );
  const haul = won ? plunder(target.resources, capacity) : {};

  if (won) {
    repos.bases.updateResources(target.id, spendResources(target.resources, haul));
    repos.bases.updateEconomy(target.id, {
      ...target.economy,
      disruption: refreshDisruption(target.economy.disruption, disruptionFrom(now)),
    });
  }

  const survived = recoverCasualties(outcome.winnerLosses, effects.casualtyRecoveryPercent);
  const returned = won ? removeForce(force, survived) : outcome.fled;
  const army = mergeArmies(removeForce(base.army, force), returned);
  // The defender's own books. A raided crew used to lose resources and not one body, whether they
  // beat the raid off or lost it outright — the whole defending army survived either way.
  repos.bases.updateArmy(
    target.id,
    won ? outcome.fled : removeForce(target.army, outcome.winnerLosses),
    target.trainingQueue,
  );
  const next: Base = {
    ...base,
    army,
    resources: addResources(base.resources, haul),
    economy: recordTaking(base.economy, district, outcome.winner, now),
  };
  repos.bases.updateArmy(next.id, next.army, next.trainingQueue);
  repos.bases.updateEconomy(next.id, next.economy);
  if (won) repos.bases.updateResources(next.id, next.resources);

  return {
    kind: 'ok',
    result: { winner: outcome.winner, log: outcome.log, rewards: haul },
    returned,
    carriedKg: Math.round(weightOf(haul) * 10) / 10,
    base: next,
  };
}

// --- holding it ---

export interface GarrisonInput {
  base: Base;
  location: Location;
  /** Positive leaves units on the location; negative brings them home. */
  changes: Record<string, number>;
}

export function setGarrison(
  repos: Repositories,
  input: Omit<GarrisonInput, 'now'>,
): CityActionResult<{ base: Base }> {
  const { base, location, changes } = input;
  const control = repos.city.control(location.id);
  if (!control) return { kind: 'refused', reason: 'not_contested' };
  if (!isHeldBy(control, base.id)) return { kind: 'refused', reason: 'not_held' };

  let army = base.army;
  let garrison = { ...control.garrison };

  for (const [unitId, delta] of Object.entries(changes)) {
    if (delta === 0) continue;
    if (delta > 0) {
      if ((army[unitId] ?? 0) < delta) return { kind: 'refused', reason: 'not_enough_units' };
      army = takeFromArmy(army, unitId, delta);
      garrison = addToArmy(garrison, unitId, delta);
    } else {
      const back = Math.min(-delta, garrison[unitId] ?? 0);
      if (back === 0) continue;
      garrison = takeFromArmy(garrison, unitId, back);
      army = addToArmy(army, unitId, back);
    }
  }

  repos.city.setGarrison(location.id, garrison);
  const next: Base = { ...base, army };
  repos.bases.updateArmy(next.id, next.army, next.trainingQueue);
  return { kind: 'ok', base: next };
}

export interface FortifyInput {
  base: Base;
  location: Location;
  now: Date;
}

/** Starts one level of digging in. Charged up front; it lands on a later read. */
export function startFortifying(
  repos: Repositories,
  input: FortifyInput,
): CityActionResult<{ base: Base }> {
  const { base, location, now } = input;
  const control = repos.city.control(location.id);
  if (!control) return { kind: 'refused', reason: 'not_contested' };
  if (!isHeldBy(control, base.id)) return { kind: 'refused', reason: 'not_held' };
  if (control.fortifyingUntil !== null) return { kind: 'refused', reason: 'already_fortifying' };

  const level = nextFortifyLevel(control.fortification);
  if (level === null) return { kind: 'refused', reason: 'at_max_fortification' };

  const cost = fortifyCost(level);
  if (!canAfford(base.resources, cost)) return { kind: 'refused', reason: 'cannot_afford' };

  repos.city.put({
    ...control,
    fortifyingUntil: new Date(now.getTime() + fortifySeconds(level) * 1000).toISOString(),
  });

  const next: Base = { ...base, resources: spendResources(base.resources, cost) };
  repos.bases.updateResources(next.id, next.resources);
  return { kind: 'ok', base: next };
}
