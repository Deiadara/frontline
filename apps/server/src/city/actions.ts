import {
  findUnit,
  FORTIFY_MAX_LEVEL,
  MAX_LOCATION_LEVEL,
  addToArmy,
  canAfford,
  fortifyCost,
  fortifySeconds,
  isHeldBy,
  nextFortifyLevel,
  spendResources,
  takeFromArmy,
  unitsBeyondNotoriety,
  type Army,
  type Base,
  type Location,
  type LocationControl,
} from '@frontline/shared';
import { isFightingForce } from '../battle/forces.js';
import type { Repositories } from '../db/repos/index.js';

/**
 * Doing things to the city (GDD §A4).
 *
 * Every action here resolves **immediately**. Travel time is computed and shown. It is what the
 * Rail Yard and the Skate Ground are for, but a force does not yet spend it in transit.
 *
 * TODO-LATER: forces in transit. A sent force should arrive after `travelMinutes` and resolve
 * then, the way a mission does (§E2), which also makes intercepting one possible. That is a
 * scheduling shape this game already has twice over; it is left out here so the map ships with the
 * territory rules rather than half of both.
 */

export const CITY_REFUSALS = [
  'unscouted',
  'no_force',
  'needs_infamy',
  'not_enough_units',
  /** §A5: a porter is not a soldier. The support tier may never be sent to a fight. */
  'not_a_fighting_force',
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

  /*
   * §D7: the rank a unit will not take the field without, asked for here as well as at a battle.
   *
   * `assemble` merges a location's garrison into the defending force, so standing a unit on held
   * ground is putting it where it fights. `battle/deploy.ts` was the only caller of
   * `unitsBeyondNotoriety`, which left this as the door with no lock on it: a crew nobody had
   * heard of could park a Specter on a rooftop and have it fight for them, which is the exact
   * thing the rule exists to refuse. Only what is being *sent out* is checked, so bringing a unit
   * home is never blocked by a rank the crew has since lost.
   */
  const sending: Army = Object.fromEntries(
    Object.entries(changes).filter(([, delta]) => delta > 0),
  );
  /*
   * §A5: and the same argument again, for the same reason.
   *
   * A garrison *is* a defending force: `assemble` merges it into the line when somebody comes for
   * the ground. So the support tier may not be posted to one, exactly as it may not be deployed
   * to a fight or sent on a raid. Without this a player could park Scavengers on a rooftop and
   * have them killed for a share of an exchange they cannot take part in, which is precisely what
   * `isFightingForce` exists to refuse at every other door.
   *
   * Only what is being *sent out* is checked, so bringing anybody home is never blocked.
   */
  if (!isFightingForce(sending)) return { kind: 'refused', reason: 'not_a_fighting_force' };
  if (unitsBeyondNotoriety(sending, base.economy.notoriety).length > 0) {
    return { kind: 'refused', reason: 'needs_infamy' };
  }

  let army = base.army;
  let garrison = { ...control.garrison };

  for (const [unitId, delta] of Object.entries(changes)) {
    if (delta === 0) continue;
    /*
     * A key that does not name a unit is refused, whichever direction it goes.
     *
     * The two guards above read `sending`, which is the positive deltas only, so a *withdrawal*
     * naming `constructor` or `toString` met neither and reached `garrison[unitId]` below. On a
     * plain object that is a function, not `undefined`: `Math.min(-delta, fn)` is `NaN`, the
     * `back === 0` guard does not catch `NaN`, and a `NaN` count went into the roster and the
     * garrison. `GarrisonRequestSchema` now keys on the unit id so nothing like that arrives, and
     * this is the second lock, matching the one on the deployment path.
     */
    if (!findUnit(unitId)) return { kind: 'refused', reason: 'not_a_fighting_force' };
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
