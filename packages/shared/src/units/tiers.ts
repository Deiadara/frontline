import { z } from 'zod';

/**
 * What kind of thing a unit is (GDD §A5).
 *
 * Its own module, and deliberately a **leaf**: it imports nothing from the rest of the package.
 * `units/catalog.ts` reads `city/locations.ts` for the location a unit can be unlocked by, so the
 * moment `locations.ts` wanted to name a tier (for the tier-scoped bonuses) the two modules would
 * have imported each other at runtime. A tier is a bare label with no dependencies of its own, so
 * the fix is for it to sit below both rather than inside either.
 *
 * The names are the board's. Six of them, and every unit belongs to exactly one: the tier is the
 * answer to "what kind of thing is this", and a unit that does not obviously belong to one of them
 * is a unit whose design is not finished.
 *
 * `carrier` was `support`, renamed for the same reason: "support" describes a role in a fight and
 * these two are never in one. They carry.
 */
export const UNIT_TIERS = [
  'carrier',
  'rabble',
  'specialist',
  'wonder',
  'heavy',
  'legendary',
] as const;
export const UnitTierSchema = z.enum(UNIT_TIERS);
export type UnitTier = z.infer<typeof UnitTierSchema>;

export const UNIT_TIER_LABELS: Record<UnitTier, string> = {
  carrier: 'Carriers',
  rabble: 'Rabble',
  specialist: 'Specialists',
  wonder: 'Wonders of Engineering',
  heavy: 'Heavy',
  legendary: 'Legendary',
};

/**
 * The three unit stats a bonus can be scoped to one tier.
 *
 * Not every stat: these are the three that decide whether a unit wins its exchange, which is what
 * a player is buying when they back one kind of unit over another. Stealth and speed are situational
 * enough that a tier-scoped version of them would be a bonus most crews could not feel.
 */
export const UNIT_TIER_STATS = ['offense', 'vitality', 'armor'] as const;
export const UnitTierStatSchema = z.enum(UNIT_TIER_STATS);
export type UnitTierStat = z.infer<typeof UnitTierStatSchema>;

export const UNIT_TIER_STAT_LABELS: Record<UnitTierStat, string> = {
  offense: 'damage',
  vitality: 'vitality',
  armor: 'armour',
};

/**
 * The number on a bonus to one of these stats, with its unit.
 *
 * Armour is points on a 0..100 rating: `battle/effects.ts` adds a tier's or a unit's armour flat,
 * the way it adds `unitArmorPercent`. The cards said `+20% Ironsides armour` and the engine gave
 * twenty points, which on a sheet of 64 is half as much again as the percentage would have been.
 */
export function tierStatAmount(stat: UnitTierStat, amount: number): string {
  return stat === 'armor' ? `+${amount}` : `+${amount}%`;
}
