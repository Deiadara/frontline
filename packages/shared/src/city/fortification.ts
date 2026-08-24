import { RESOURCE_KEYS, type PartialResources } from '../resources.js';
import {
  FORTIFY_PERCENT_PER_LEVEL,
  LOCATION_CATALOG,
  type FortifyDifficulty,
  type Location,
} from './locations.js';

/**
 * Digging in (GDD §A4).
 *
 * Five levels on any location you hold, each costing more materials and more time than the last. What
 * differs between one location and another is not the price. It is what the work is *worth*, and
 * that is a property of the ground: rubble and rebar you can keep adding to, spire ferrocrete you
 * can barely drill.
 *
 * The inversion is deliberate and is the board's: **easy ground pays the most per level.** Hard
 * ground is already defensible, the catalogue's `baseDefense` says so, so what you can add to it
 * is marginal. A location that is both hard to take *and* rewards fortifying would be strictly best,
 * and there would be nothing to choose.
 */

export const FORTIFY_MAX_LEVEL = 5;

/** Materials for the first level. Every level after multiplies the whole bundle. */
export const FORTIFY_BASE_COST: PartialResources = {
  caps: 120,
  scrap: 200,
  oil: 40,
  highQualityMetal: 8,
};

/** Level 5 costs ~8.4x level 1: a real commitment on one location rather than a rounding error. */
export const FORTIFY_COST_GROWTH = 1.7;

/** Seconds for the first level. Level 5 lands a little over an hour later. */
export const FORTIFY_BASE_SECONDS = 300;
export const FORTIFY_TIME_GROWTH = 1.9;

/** The defence percentage `level` of fortification is worth on this kind of ground. */
export function fortifyBonusPercent(difficulty: FortifyDifficulty, level: number): number {
  const at = Math.min(FORTIFY_MAX_LEVEL, Math.max(0, Math.trunc(level)));
  return FORTIFY_PERCENT_PER_LEVEL[difficulty] * at;
}

/** The most fortification is ever worth on this ground: 25% / 20% / 15%. */
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
  const growth = FORTIFY_COST_GROWTH ** (level - 1);
  return Object.fromEntries(
    RESOURCE_KEYS.flatMap((key) => {
      const amount = FORTIFY_BASE_COST[key];
      return amount === undefined ? [] : [[key, Math.round(amount * growth)] as const];
    }),
  );
}

/** How long raising a location to `level` takes, in seconds. */
export function fortifySeconds(level: number): number {
  return Math.round(FORTIFY_BASE_SECONDS * FORTIFY_TIME_GROWTH ** (level - 1));
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
