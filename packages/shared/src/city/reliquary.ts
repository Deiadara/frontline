/**
 * Reliquary's own numbers (maintainer, 2026-10-06 and 2026-10-07): the figures the city's
 * mechanics read by level or by rule, kept together so the server, the engine and the client
 * quote one copy.
 */

/**
 * The Scriptorium's daily page, and the Chop Shop's daily component: the odds of each rarity at
 * each level, basic through masterpiece, summing to 100. Level 1 pays almost only the common
 * pages; level 5 pays a masterpiece one day in ten. The middle three are interpolated.
 */
export const RARITY_ODDS_BY_LEVEL: readonly (readonly [number, number, number, number])[] = [
  [70, 25, 5, 0],
  [60, 28, 10, 2],
  [50, 31, 15, 4],
  [40, 33, 20, 7],
  [30, 35, 25, 10],
];

/** The Trophy Hall's pay per unit type killed while held, at level 1, and how it climbs. */
export const TROPHY_PAY = { highQualityMetal: 10, each: 100 } as const;
export const TROPHY_PAY_SCALE: readonly number[] = [1, 1.5, 2, 2.5, 3];

/** What a pinned unit loses against the wall's holder, in percent of damage and vitality. */
export const PAMPHLET_PENALTY_PERCENT = 5;
/** Changing one pin at a full, maxed wall: the price, and the wait between changes. */
export const PAMPHLET_SWAP_CAPS = 5_000;
export const PAMPHLET_SWAP_COOLDOWN_MS = 12 * 3_600_000;

/** The Tolling Tower: how long after a throw of the switch it may be thrown again. */
export const NOISE_SWITCH_COOLDOWN_MS = 12 * 3_600_000;
/** The Noisy the tower lays on the district's ground while it is on. */
export const NOISE_SWITCH_TIER = 1;

/** One level of ANTI-COMBINE: this much more damage and vitality against the Combine. */
export const ANTI_COMBINE_PERCENT = 10;

/** The Saint at a level-5 Shrine: +1 damage and vitality a unit slot beside him, to this ceiling. */
export const SAINT_CONGREGATION_CAP = 1_000;
/** The Condemned: +30 damage and vitality for every door level above the first. */
export const CONDEMNED_PER_LEVEL = 30;
/** LAST CHANCE: the odds a dying Condemned strikes once more. */
export const LAST_CHANCE_PERCENT = 20;
/** PAPERCUT: armour stripped from every enemy unit by each of the Dancer's attacks. */
export const PAPERCUT_ARMOR = 5;
