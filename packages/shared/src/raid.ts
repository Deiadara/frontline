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

/** How much this force can carry home, in kilograms. */
export function lootCapacityOf(army: Army, bonusPercent = 0): number {
  const base = Object.entries(army).reduce((total, [unitId, count]) => {
    const unit = findUnit(unitId);
    return unit ? total + unit.stats.lootCapacity * count : total;
  }, 0);
  return Math.max(0, base) * (1 + Math.max(0, bonusPercent) / 100);
}

/**
 * What a successful raid actually takes off `stock`.
 *
 * Walks {@link PLUNDER_PRIORITY}, taking up to {@link MAX_RAID_SHARE} of each line and stopping
 * when the raiders run out of arms. Rounded **down** at every step: a raid never carries away a
 * fraction of a unit, and rounding up would let a tiny force take a whole one.
 */
export function plunder(stock: Resources, capacityKg: number): PartialResources {
  let left = Math.max(0, capacityKg);
  const taken: Record<string, number> = {};

  for (const key of PLUNDER_PRIORITY) {
    if (left <= 0) break;
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
