import { z } from 'zod';
import {
  RESOURCE_KEYS,
  type PartialResources,
  type ResourceKey,
  type Resources,
} from './resources.js';
import { findUnit, type Army } from './units/index.js';

/**
 * Raiding a home district (GDD §A4).
 *
 * A crew's own district is the thirteen structures of §A1, and it **cannot be taken**: losing
 * everything you have built because you were asleep is not a strategy game. What it can be is
 * *robbed*, and left limping afterwards.
 *
 * Two consequences, and they are different kinds of thing on purpose:
 *
 *   * **What leaves** is bounded by what the raiders can physically carry. That is what
 *     `lootCapacity` on the unit sheet is for, and it is why a stack of Road Reavers is worth
 *     bringing on a raid you intend to win and worth nothing on one you intend to fight.
 *   * **What stays broken** is disruption: the district's structures run at reduced effectiveness
 *     for a while. It costs the victim time rather than stock, which is the part they cannot buy
 *     back.
 */

/**
 * Load per unit of each resource: what one of the thing takes up in a unit's carry.
 *
 * Whole numbers of *slots* rather than kilograms. The screen used to print `25 kg`, which asks a
 * player to convert twice: once from the resource to a weight and once from the weight back to
 * "how much can this unit actually bring home". A load is compared directly against a unit's
 * `lootCapacity`, so the sum is the answer.
 *
 * The spread is the whole point of measuring the carry at all: high-quality metal is dense and
 * precious and costs five, supplies and oil come in drums and cans at three, and the bulk materials a
 * city is made of cost one apiece. A light fast raid is a real strategy rather than a worse
 * version of a heavy one, because *what* you carry out is a decision.
 */
export const RESOURCE_KG: Record<ResourceKey, number> = {
  caps: 1,
  supplies: 3,
  oil: 3,
  scrap: 1,
  planks: 1,
  highQualityMetal: 5,
};

/**
 * The order raiders empty a stockpile in: most value per kilogram first.
 *
 * Fixed rather than computed from a price table, because there is no market yet and a hard order
 * is honest about that. When §D5 lands this should read off it instead.
 */
export const PLUNDER_PRIORITY: readonly ResourceKey[] = [
  'caps',
  'highQualityMetal',
  'oil',
  'scrap',
  // Beside scrap, which is what it is: a kilogram of salvaged building material. It was missing
  // from this list entirely while being priced in `RESOURCE_KG` and stocked by every base, so no
  // raid in the game had ever taken a plank and a defender could bank them behind a broken gate
  // for nothing. `raid.test.ts` now derives this list from `RESOURCE_KEYS` so a seventh resource
  // cannot arrive un-lootable the same way.
  'planks',
  'supplies',
];

/**
 * The most a single raid can take of any one resource, whatever the raiders can carry.
 *
 * Without it a big enough force empties a district completely, and a player who logs in to
 * nothing has no move to make. A quarter hurts and leaves a game.
 */
export const MAX_RAID_SHARE = 0.25;

/**
 * Loads a body with the `picker` mark brings home over and above its sheet (`UnitSpec.picker`).
 *
 * Twelve, which is a Sniper's whole carry and a bit over half a Razor's. Sized so that a handful of
 * pickers in a raiding party is worth roughly as much as the +25% carry the deepest `loot_capacity`
 * holdings buy, and no more: the rule is meant to be a reason to bring a few of them, not a second
 * economy that runs beside the one the map already pays for.
 */
export const PICKER_EXTRA_LOAD = 12;

/**
 * How much this force can carry home, in kilograms.
 *
 * The picker's flat load is added **after** the percentage rather than into the base, and that is
 * the whole difference between this mark and a bigger `lootCapacity`. A percentage on the base
 * pays the crews that already carry well the most; a flat load per body is worth the same to
 * everybody, which is what the sheet promises.
 */
export function lootCapacityOf(army: Army, bonusPercent = 0): number {
  let base = 0;
  let extra = 0;
  for (const [unitId, count] of Object.entries(army)) {
    const unit = findUnit(unitId);
    if (!unit) continue;
    base += unit.stats.lootCapacity * count;
    if (unit.picker === true) extra += PICKER_EXTRA_LOAD * count;
  }
  return Math.max(0, base) * (1 + Math.max(0, bonusPercent) / 100) + Math.max(0, extra);
}

/**
 * What a successful raid actually takes off `stock`.
 *
 * Walks {@link PLUNDER_PRIORITY}, taking up to {@link MAX_RAID_SHARE} of each line and stopping
 * when the raiders run out of arms. Rounded **down** at every step: a raid never carries away a
 * fraction of a unit, and rounding up would let a tiny force take a whole one.
 *
 * `without` names lines the raiders leave alone. A raid on a home skips `caps`: caps are the only
 * resource a player spends on everything, they are first in the priority order and they weigh a
 * kilogram apiece, so a raid that could take them filled its whole hold with somebody's wallet and
 * left the interesting half of the stockpile standing. The rest of the order is unchanged, so an
 * excluded line costs the raiders nothing but their place in the queue.
 */
export function plunder(
  stock: Resources,
  capacityKg: number,
  without: readonly ResourceKey[] = [],
): PartialResources {
  let left = Math.max(0, capacityKg);
  const taken: Record<string, number> = {};
  const skip = new Set(without);

  for (const key of PLUNDER_PRIORITY) {
    if (left <= 0) break;
    if (skip.has(key)) continue;
    const available = Math.floor(stock[key] * MAX_RAID_SHARE);
    if (available <= 0) continue;

    const perUnit = RESOURCE_KG[key];
    const affordable = perUnit <= 0 ? available : Math.floor(left / perUnit);
    const amount = Math.min(available, affordable);
    if (amount <= 0) continue;

    taken[key] = amount;
    left -= amount * perUnit;
  }

  return taken;
}

/** The weight of a bundle: what a defender's readout means by "they could carry it all". */
export function weightOf(bundle: PartialResources): number {
  return RESOURCE_KEYS.reduce((total, key) => total + (bundle[key] ?? 0) * RESOURCE_KG[key], 0);
}

// --- disruption: what a raid leaves behind ---

/** How much of a district's output a raid knocks out while the disruption lasts. */
export const RAID_DISRUPTION_PERCENT = 25;

/** And for how long. Long enough to matter, short enough to be worth logging in to fix. */
export const RAID_DISRUPTION_HOURS = 6;

export const DisruptionSchema = z.object({
  /** When the district stops running at reduced effectiveness. Null when it is not. */
  until: z.string().datetime().nullable(),
  /** Percentage points off production and build speed while it lasts. */
  percent: z.number().min(0).max(100),
});
export type Disruption = z.infer<typeof DisruptionSchema>;

export function noDisruption(): Disruption {
  return { until: null, percent: 0 };
}

/** A fresh raid's worth of disruption, starting now. */
export function disruptionFrom(now: Date): Disruption {
  return {
    until: new Date(now.getTime() + RAID_DISRUPTION_HOURS * 3_600_000).toISOString(),
    percent: RAID_DISRUPTION_PERCENT,
  };
}

/**
 * How disrupted a district is *right now*, as a percentage.
 *
 * Derived from the stored expiry rather than stored as a live number, so it expires without
 * anything having to run: the same reason nothing else in this game has a scheduler.
 */
export function disruptionPercentAt(disruption: Disruption, now: Date): number {
  if (disruption.until === null) return 0;
  return now.getTime() < Date.parse(disruption.until) ? disruption.percent : 0;
}

/**
 * A second raid does not stack: it **refreshes**.
 *
 * Stacking would let a coordinated pair of crews hold a district at zero output indefinitely,
 * which is a grief tactic rather than a strategy. Taking the later expiry keeps repeat raids
 * meaningful without making them terminal.
 */
export function refreshDisruption(current: Disruption, next: Disruption): Disruption {
  if (current.until === null) return next;
  if (next.until === null) return current;
  return Date.parse(next.until) > Date.parse(current.until) ? next : current;
}
