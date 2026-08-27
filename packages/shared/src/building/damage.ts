import type { PartialResources, Resources } from '../resources.js';
import { RESOURCE_KEYS } from '../resources.js';
import { fortifyBonusPercent } from '../city/fortification.js';
import { findBuilding, type Building } from './state.js';

/**
 * What a broken gate lets somebody do to your district (GDD §A4, battle rework).
 *
 * A home district still cannot be taken: that rule has not moved and it is not going to. What a
 * breach buys instead is a window in which the structures themselves can be hit: things get carried
 * out and what is left runs badly for a while. That is the whole design. A player who loses a siege
 * loses *tempo and stock*, not the thing they have spent three weeks building, so a bad night is
 * something to come back from rather than a reason to stop playing.
 *
 * ## Damage is a percentage, and it is capped at half
 *
 * A structure carries 0..100 damage and gives up {@link MAX_DAMAGE_PENALTY} of its output at 100.
 * The board's ceiling, and the right one: a Greenhouse wrecked to a standstill would take a crew's
 * supplies to zero and starve a roster that had nothing to do with the fight, which is a punishment
 * loop rather than a setback. Half is enough to hurt and not enough to end anything.
 *
 * ## Digging the gate in
 *
 * The other half of the same screen. Watches used to live here: a count on every structure that
 * bought defence and cost nothing, which is not a decision. What replaced them is the same three
 * levels of fortification the city's locations use, on the Gate alone, paid for in materials. See
 * `gateFortifyPercent` and `city/fortification.ts`.
 */

/** The most of a structure's job that damage can ever take away. */
export const MAX_DAMAGE_PENALTY = 0.5;

/**
 * How much of its job a structure is still doing, 0.5..1.
 *
 * One function, read by production, storage, housing and the Gate, so "what does damage actually
 * do" has exactly one answer and a structure cannot end up damaged for the purposes of one clock
 * and undamaged for another.
 */
export function buildingEffectiveness(building: Building | undefined): number {
  if (!building) return 1;
  return 1 - MAX_DAMAGE_PENALTY * (damageOf(building) / 100);
}

/**
 * A structure's damage, 0..100, and never `NaN`.
 *
 * `damage` is a *defaulted* field on `BuildingSchema`, which means every row that goes through the
 * parser has one, and every row that does not, does not. That gap cost a save: a `Building` that
 * had skipped the parser reached `Math.max(0, undefined)`, which is `NaN`, and NaN spreads. It went
 * effectiveness → storage ceiling → the sandbox's stockpile → `JSON.stringify`, which writes NaN as
 * `null` without complaint, and the next boot could not parse its own resources column. One missing
 * key, and the server would not start.
 *
 * A default on a schema protects the boundary it is written on. This protects the arithmetic, which
 * is the thing that actually cannot survive a hole.
 */
function damageOf(building: Building): number {
  const damage = building.damage;
  return Number.isFinite(damage) ? Math.min(100, Math.max(0, damage)) : 0;
}

/** The district's average effectiveness, weighted by level: what its clocks run at. */
export function districtEffectiveness(buildings: readonly Building[]): number {
  let levels = 0;
  let weighted = 0;
  for (const building of buildings) {
    levels += building.level;
    weighted += building.level * buildingEffectiveness(building);
  }
  return levels === 0 ? 1 : weighted / levels;
}

/**
 * Percentage points the Gate's own fortification adds to what it takes to get into the district.
 *
 * Only the Gate. Digging in is work on the way *in*, and the way in is the Gate: spreading it
 * across every structure was what made watches read as a tick-box on a list rather than as a
 * position on the map. Read off the medium curve, because a home district has no ground type of
 * its own the way a location does.
 */
export function gateFortifyPercent(buildings: readonly Building[]): number {
  const gate = findBuilding(buildings, 'gate');
  return gate ? fortifyBonusPercent('medium', gate.fortification) : 0;
}

/**
 * How hard a raid hits the structures.
 *
 * Scaled by how badly the defence lost, so a fight that went to twelve rounds leaves the district
 * scratched and one nobody turned up to leaves it wrecked. Floored well above zero: a breach that
 * did nothing measurable is a siege the attacker paid for and got nothing from.
 */
export const MIN_STRIKE_DAMAGE = 8;
export const MAX_STRIKE_DAMAGE = 40;

export function strikeDamage(defenderLossShare: number): number {
  const share = Math.min(1, Math.max(0, defenderLossShare));
  return Math.round(MIN_STRIKE_DAMAGE + (MAX_STRIKE_DAMAGE - MIN_STRIKE_DAMAGE) * share);
}

/**
 * One structure, damaged. Clamped at 100. There is no such thing as more than wrecked.
 *
 * `at` restarts the repair clock, and it restarts it *whole* rather than crediting the hours
 * already served. Two strikes a day apart are two nights of a district running badly; letting the
 * second inherit the first's progress would make a district cheaper to wreck the more often it was
 * wrecked, which is backwards.
 */
export function damageBuilding(building: Building, amount: number, at: string): Building {
  const damage = Math.min(100, Math.max(0, building.damage + amount));
  return { ...building, damage, damagedAt: damage > 0 ? at : null };
}

/**
 * How long a **wrecked** structure takes to come all the way back on its own (§A4).
 *
 * The board's number, and the reason a bad night is a bad night rather than a permanent tax. The
 * crew patch the place up: nobody buys the repair, nobody queues it, and a player who logs in the
 * next evening finds their district working again. What the raid actually cost them is the day:
 * the production, the storage and the defence they did not have while it was being put right: plus
 * whatever was carried out of the door.
 */
export const REPAIR_HOURS = 24;

/**
 * Points of damage the crew clear per hour.
 *
 * A **rate**, not a countdown, and the difference is the whole design. Twenty-four hours is what it
 * takes to undo a *total* wreck; a structure that was only scratched is back long before that,
 * because the same crew are working on less. A flat "it is fixed at hour 24 whatever happened to
 * it" would make a light strike and a devastating one cost exactly the same day, which is the one
 * thing that would make the size of a raid stop mattering.
 */
export const REPAIR_PER_HOUR = 100 / REPAIR_HOURS;

/**
 * A structure part-way through repairing itself, at `now`.
 *
 * **Settled lazily**, the same shape as every other clock in this game (§H7 payroll, §E2 missions,
 * §A1 production). A district nobody has looked at for a week owes exactly the same repair whenever
 * it is next read, and there is no background job to keep alive.
 *
 * The clock is moved up to `now` on every settle, which is what makes it safe to run any number of
 * times. Decaying from the *original* strike instead, the obvious spelling, compounds: a
 * structure settled at twelve hours and again at eighteen would apply the eighteen-hour fraction to
 * a figure the twelve-hour settle had already reduced, and the same damage would clear faster the
 * more often somebody looked at it.
 */
export function repairedByTime(building: Building, now: Date): Building {
  const damagedAt = building.damagedAt ?? null;
  if (damagedAt === null || building.damage <= 0) {
    // An intact structure carrying a stale clock is a row from before the settle ran. Clear it, so
    // "damaged" and "has a repair clock" cannot disagree.
    return damagedAt === null ? building : { ...building, damagedAt: null };
  }

  const hours = (now.getTime() - Date.parse(damagedAt)) / 3_600_000;
  if (!Number.isFinite(hours) || hours <= 0) return building;

  // Whole points only: `damage` is quoted as a percentage everywhere it is shown, and a structure
  // reading 37.4188% wrecked is a number nobody asked for.
  const cleared = Math.floor(REPAIR_PER_HOUR * hours);
  if (cleared <= 0) return building;

  // The clock moves up by exactly the hours that were *paid for*, not to `now`, and that is what
  // keeps the remainder. Snapping it to `now` would throw the leftover minutes away on every read,
  // and a client polling the district once a second would round a fraction of a point up to a
  // whole one thousands of times an hour and repair the place in under a minute.
  const consumedMs = (cleared / REPAIR_PER_HOUR) * 3_600_000;
  const damage = Math.max(0, building.damage - cleared);
  return damage <= 0
    ? { ...building, damage: 0, damagedAt: null }
    : {
        ...building,
        damage,
        damagedAt: new Date(Date.parse(damagedAt) + consumedMs).toISOString(),
      };
}

/** Every structure in a district, brought up to date with the repair clock. */
export function repairedDistrict(buildings: readonly Building[], now: Date): Building[] {
  return buildings.map((building) => repairedByTime(building, now));
}

/**
 * Raising a structure a level puts right whatever was done to it, on top of the clock.
 *
 * The impatient path. {@link repairedByTime} gets a district back on its feet in a day for nothing;
 * this is what a player does when they do not have the day: the level they were going to buy
 * anyway clears `RECOVERY_PER_LEVEL` of the damage the moment it lands. There is still no repair
 * button and no second economy to balance.
 */
export const RECOVERY_PER_LEVEL = 50;

export function repairedByBuilding(building: Building): Building {
  const damage = Math.max(0, building.damage - RECOVERY_PER_LEVEL);
  return { ...building, damage, ...(damage === 0 ? { damagedAt: null } : {}) };
}

/**
 * What a breach carries out, on top of the wrecking.
 *
 * Heavier than a street raid. This is somebody standing inside your warehouse rather than jumping
 * a truck, and still bounded by what the force could physically carry, which `raid.ts` decides.
 * The share here is the ceiling before that bound applies.
 */
export const BREACH_LOOT_SHARE = 0.35;

export function breachLoot(stock: Resources, share = BREACH_LOOT_SHARE): PartialResources {
  return Object.fromEntries(
    RESOURCE_KEYS.flatMap((key) => {
      const taken = Math.floor(stock[key] * share);
      return taken > 0 ? [[key, taken] as const] : [];
    }),
  );
}
