import type { TrapSpec } from '../battle/traps.js';
import { RESOURCE_KEYS, type PartialResources } from '../resources.js';
import type { UpgradeSpec } from '../units/upgrades.js';
import { isAdvancedModification } from './addons.js';
import type { ModificationSpec } from './modifications.js';

/**
 * What the Scrapyard's own level is worth (maintainer request, 2026-09-10).
 *
 * Until now the yard was a switch: standing at level one it sold the whole catalogue at list price,
 * and nineteen more levels bought nothing but scrap output. A structure whose levels change nothing
 * about what it does is a structure nobody raises on purpose. Two things move with the level now,
 * and both are read here and nowhere else, so the page's info box and the server's bill cannot
 * disagree.
 *
 * **What it can cut.** The plain bolt-ons are open from the first level. The advanced modifications
 * (the ones that want a retrofit document and good metal) open at {@link
 * SCRAPYARD_LEVEL_FOR_ADVANCED_MODIFICATION}; each refit tier and each trap has a level of its own.
 * The thresholds sit on the Nexus ladder's own rungs (`NEXUS_LADDERS.scrapyard` opens yard level 4
 * at Nexus 5 and level 7 at Nexus 9), so a crew reaches them by growing the district rather than by
 * grinding one structure.
 *
 * **What it charges.** {@link SCRAPYARD_DISCOUNT_PER_LEVEL} percent off every line of every bill
 * per level above the first, capped at {@link MAX_SCRAPYARD_DISCOUNT}. Scrap and metal only, still:
 * a discount cannot add a resource to a bill, and the floor of one per line means nothing is ever
 * free.
 */

export const SCRAPYARD_DISCOUNT_PER_LEVEL = 2;
export const MAX_SCRAPYARD_DISCOUNT = 30;

/** Percent off every yard bill at this level. Zero at level one, thirty from level sixteen. */
export function scrapyardDiscountPercent(level: number): number {
  const above = Math.max(0, Math.trunc(level) - 1);
  return Math.min(MAX_SCRAPYARD_DISCOUNT, above * SCRAPYARD_DISCOUNT_PER_LEVEL);
}

/**
 * A bill with the yard's discount on it.
 *
 * Every line present stays present and no line drops below one: a discount that removed the metal
 * line from an advanced bracket would silently break the rule that metal is what marks one out.
 */
export function scrapyardPrice(cost: PartialResources, level: number): PartialResources {
  const off = scrapyardDiscountPercent(level) / 100;
  const priced: PartialResources = {};
  for (const key of RESOURCE_KEYS) {
    const amount = cost[key];
    if (amount === undefined) continue;
    priced[key] = Math.max(1, Math.round(amount * (1 - off)));
  }
  return priced;
}

/** The plain bolt-ons: open the day the yard is standing. */
export const SCRAPYARD_LEVEL_FOR_BASIC = 1;
/** The advanced entries of a structure's seven: the ones behind a retrofit document. */
export const SCRAPYARD_LEVEL_FOR_ADVANCED_MODIFICATION = 4;
/** Refits by tier: the first rung of every line is open, the top rung waits for a serious yard. */
export const SCRAPYARD_LEVEL_FOR_UPGRADE_TIER: readonly number[] = [1, 3, 7];
/**
 * Traps by id, one rung each, in the order they are worth having.
 *
 * Written out rather than derived off the bill so a retune of a trap's price cannot quietly move
 * the level it opens at; `scrapyard.test.ts` checks every trap in the catalogue has a line here
 * and that the ladder never opens something worse than the rung below it.
 *
 * The order was inverted when the three new traps landed on the even rungs beside the three old
 * ones on the odd: Razor Wire sat at level 2 and takes 4% off an attack, against Pressure Plates
 * at level 1 taking 6%. A level a player worked for has to open something better than the one
 * below, so the two swapped.
 */
export const SCRAPYARD_LEVEL_FOR_TRAP: Readonly<Record<string, number>> = {
  trap_razor_wire: 1,
  trap_pressure_plates: 2,
  trap_gas_shell: 3,
  trap_fuel_fougasse: 4,
  trap_collapse: 5,
  trap_flooded_cellar: 6,
};

export function scrapyardLevelForModification(spec: ModificationSpec): number {
  return isAdvancedModification(spec)
    ? SCRAPYARD_LEVEL_FOR_ADVANCED_MODIFICATION
    : SCRAPYARD_LEVEL_FOR_BASIC;
}

export function scrapyardLevelForUpgrade(spec: UpgradeSpec): number {
  const top = SCRAPYARD_LEVEL_FOR_UPGRADE_TIER[SCRAPYARD_LEVEL_FOR_UPGRADE_TIER.length - 1] ?? 1;
  return SCRAPYARD_LEVEL_FOR_UPGRADE_TIER[spec.tier - 1] ?? top;
}

export function scrapyardLevelForTrap(spec: TrapSpec): number {
  return SCRAPYARD_LEVEL_FOR_TRAP[spec.id] ?? SCRAPYARD_LEVEL_FOR_BASIC;
}

/** The player-facing reason an entry is shut by the yard's level, or null when it is open. */
export function scrapyardLevelRefusal(level: number, required: number): string | null {
  return level >= required ? null : `Needs the Scrapyard at level ${required}`;
}

/** One rung of the yard's ladder: what the next level worth reaching opens. */
export interface ScrapyardUnlock {
  level: number;
  modifications: number;
  upgrades: number;
  traps: number;
}

/**
 * Every level at which the yard opens something, with what it opens, lowest first.
 *
 * Read by the page's info box ("level 4 opens 30 modifications") off the catalogues rather than
 * off a hand-written sentence, so a retune of any threshold above changes the box on its own.
 */
export function scrapyardUnlockLadder(catalogue: {
  modifications: readonly ModificationSpec[];
  upgrades: readonly UpgradeSpec[];
  traps: readonly TrapSpec[];
}): ScrapyardUnlock[] {
  const rungs = new Map<number, ScrapyardUnlock>();
  const rung = (level: number): ScrapyardUnlock => {
    const existing = rungs.get(level);
    if (existing) return existing;
    const fresh = { level, modifications: 0, upgrades: 0, traps: 0 };
    rungs.set(level, fresh);
    return fresh;
  };
  for (const spec of catalogue.modifications)
    rung(scrapyardLevelForModification(spec)).modifications++;
  for (const spec of catalogue.upgrades) rung(scrapyardLevelForUpgrade(spec)).upgrades++;
  for (const spec of catalogue.traps) rung(scrapyardLevelForTrap(spec)).traps++;
  return [...rungs.values()].sort((a, b) => a.level - b.level);
}

/** The first rung of the ladder still above this level, or null when the yard has opened it all. */
export function nextScrapyardUnlock(
  level: number,
  ladder: readonly ScrapyardUnlock[],
): ScrapyardUnlock | null {
  return ladder.find((rung) => rung.level > level) ?? null;
}
