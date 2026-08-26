import { RESOURCE_KEYS, type PartialResources } from '../resources.js';
import { LOCATION_CATALOG, type FortifyDifficulty, type Location } from './locations.js';

/**
 * Digging in (GDD §A4).
 *
 * Three levels on any location you hold, and the third is the one you have to mean. What differs
 * between one location and another is not the price. It is what the work is *worth*, and that is a
 * property of the ground: rubble and rebar you can keep adding to, spire ferrocrete you can barely
 * drill.
 *
 * The inversion is deliberate and is the board's: **easy ground pays the most per level.** Hard
 * ground is already defensible, the catalogue's `baseDefense` says so, so what you can add to it
 * is marginal. A location that is both hard to take *and* rewards fortifying would be strictly best,
 * and there would be nothing to choose.
 *
 * ## Why the curve accelerates
 *
 * The three levels are worth 2.5%, 5% and 10% on medium ground: each one doubles the last, and the
 * third costs five times the first. That shape is the whole decision. Levels 1 and 2 are cheap
 * enough to spread thin across everything you hold; level 3 is expensive enough that you can only
 * afford it on the ground you have actually decided to keep, which is what makes "where is their
 * real position" a readable question on the map rather than a uniform smear of digging.
 */

/** Three, and the third is a commitment. */
export const FORTIFY_MAX_LEVEL = 3;

/**
 * What each level is worth, per kind of ground, in defence percentage points.
 *
 * Medium is the authored curve (2.5 / 5 / 10) and the other two are it, tilted: easy ground pays
 * 1.2x, hard ground 0.8x, which keeps the board's easy-pays-most inversion intact while every row
 * still doubles. Read as a total at that level, not as what the level alone adds.
 */
export const FORTIFY_LEVEL_PERCENT: Record<FortifyDifficulty, readonly number[]> = {
  easy: [3, 6, 12],
  medium: [2.5, 5, 10],
  hard: [2, 4, 8],
};

/** Materials for the first level. Each level multiplies the whole bundle by `FORTIFY_COST_STEPS`. */
export const FORTIFY_BASE_COST: PartialResources = {
  caps: 120,
  scrap: 200,
  // A dug-in position is revetting and bracing before it is anything else, so timber leads the
  // bundle. It is the one thing in the game that costs more planks than scrap.
  planks: 260,
  oil: 40,
  highQualityMetal: 8,
};

/**
 * The cost multiplier at each level: level 3 is five times level 1 and two and a half times level 2.
 *
 * Not a smooth exponent, because the point is the step rather than the slope: a curve that grew
 * evenly would make the top level merely the next purchase instead of the one you have to choose a
 * location for.
 */
export const FORTIFY_COST_STEPS: readonly number[] = [1, 2, 5];

/** Seconds at each level, on the same shape as the cost and gentler. */
export const FORTIFY_BASE_SECONDS = 300;
export const FORTIFY_TIME_STEPS: readonly number[] = [1, 2, 4];

/** Clamps a level to `0..FORTIFY_MAX_LEVEL`, which every reader here wants first. */
function atLevel(level: number): number {
  return Math.min(FORTIFY_MAX_LEVEL, Math.max(0, Math.trunc(level)));
}

/** The defence percentage `level` of fortification is worth on this kind of ground. */
export function fortifyBonusPercent(difficulty: FortifyDifficulty, level: number): number {
  const at = atLevel(level);
  return at === 0 ? 0 : (FORTIFY_LEVEL_PERCENT[difficulty][at - 1] ?? 0);
}

/** The most fortification is ever worth on this ground: 12% / 10% / 8%. */
export function maxFortifyBonusPercent(difficulty: FortifyDifficulty): number {
  return fortifyBonusPercent(difficulty, FORTIFY_MAX_LEVEL);
}

/**
 * What raising a location **to** `level` costs.
 *
 * The price is the same on every kind of ground: the board's call, and it is what keeps the
 * easy/medium/hard axis about *reward* rather than quietly becoming a second cost axis.
 */
export function fortifyCost(level: number): PartialResources {
  const growth = FORTIFY_COST_STEPS[atLevel(level) - 1] ?? 1;
  return Object.fromEntries(
    RESOURCE_KEYS.flatMap((key) => {
      const amount = FORTIFY_BASE_COST[key];
      return amount === undefined ? [] : [[key, Math.round(amount * growth)] as const];
    }),
  );
}

/** How long raising a location to `level` takes, in seconds. */
export function fortifySeconds(level: number): number {
  return Math.round(FORTIFY_BASE_SECONDS * (FORTIFY_TIME_STEPS[atLevel(level) - 1] ?? 1));
}

/** The level a further order would produce, or `null` when the location is already dug in fully. */
export function nextFortifyLevel(current: number): number | null {
  const next = Math.max(0, Math.trunc(current)) + 1;
  return next > FORTIFY_MAX_LEVEL ? null : next;
}

/** Everything a fortification row needs to render, for one location at one level. */
export interface FortifyQuote {
  level: number;
  cost: PartialResources;
  seconds: number;
  /** The defence this level takes the location to, in total, not what the level alone adds. */
  bonusPercent: number;
}

export function quoteFortify(location: Location, current: number): FortifyQuote | null {
  const level = nextFortifyLevel(current);
  if (level === null) return null;
  return {
    level,
    cost: fortifyCost(level),
    seconds: fortifySeconds(level),
    bonusPercent: fortifyBonusPercent(location.fortifyDifficulty, level),
  };
}

/**
 * How much harder this location is to take than the bare ground, as a multiplier.
 *
 * Reported rather than folded into `baseDefense` so a location card can say what the *digging* is
 * doing separately from what the ground was worth to begin with.
 */
export function fortifiedDefense(location: Location, level: number): number {
  const ground = LOCATION_CATALOG[location.kind].baseDefense;
  return (
    Math.round(ground * (1 + fortifyBonusPercent(location.fortifyDifficulty, level) / 100) * 10) /
    10
  );
}
