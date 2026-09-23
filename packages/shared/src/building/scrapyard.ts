import type { TrapSpec } from '../battle/traps.js';
import type { ModificationRarity } from '../modification-rarity.js';
import { RESOURCE_KEYS, type PartialResources } from '../resources.js';
import type { UnitModificationSpec } from '../units/modifications.js';
import { isAdvancedModification } from './addons.js';
import { OFFICER_MARK_CEILING, OFFICER_MARK_FLOOR } from '../crew/marks.js';
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
 * SCRAPYARD_LEVEL_FOR_ADVANCED_MODIFICATION}; each rarity of unit card
 * ({@link SCRAPYARD_LEVEL_FOR_RARITY}) and each trap has a level of its own. The thresholds sit on
 * the rungs the yard already had, so a crew reaches them by growing the district rather than by
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
export function scrapyardPrice(
  cost: PartialResources,
  level: number,
  /** The Fabricator's cut, 0 when the chair is empty. See {@link yardCostCutPercent}. */
  officerCutPercent = 0,
): PartialResources {
  const off = scrapyardDiscountPercent(level) / 100;
  const officerOff = Math.max(0, Math.min(MAX_YARD_COST_CUT, officerCutPercent)) / 100;
  const priced: PartialResources = {};
  for (const key of RESOURCE_KEYS) {
    const amount = cost[key];
    if (amount === undefined) continue;
    // Multiplied rather than summed, so the two discounts compose instead of racing each other to
    // a hundred: a maxed yard and a perfect Fabricator take 30% off what is left, not 30 points
    // off a number that was already most of the way to free.
    priced[key] = Math.max(1, Math.round(amount * (1 - off) * (1 - officerOff)));
  }
  return priced;
}

/**
 * §C1d, second half: what the Fabricator takes off the yard's bill (maintainer, 2026-09-22).
 *
 * The Fabricator's sheet used to reach nothing at all outside its own research track. It gated no
 * Scrapyard card (it is named as `OFFICER_FOR_UNIT_FALLBACK`, and every unit card already has a
 * louder stat, so the fallback never fired), and nothing else in the game read it. A chair whose
 * only effect is to unlock its own reading list is a chair a player has no reason to fill well.
 *
 * So it buys price, exactly as each research chair buys price on its own track: the same curve,
 * the same ceiling, and points rather than marks, so a better Fabricator is continuously cheaper
 * rather than merely opening a door. Their duties are craft, engineering, salvage and dexterity,
 * which is a description of the person who runs a cutting yard.
 *
 * Applied after the yard's own level discount and before the per-line floor, so nothing is free
 * however good they are.
 */
export const MAX_YARD_COST_CUT = 30;

export function yardCostCutPercent(points: number): number {
  const above = Math.max(0, Math.min(OFFICER_MARK_CEILING, points) - OFFICER_MARK_FLOOR);
  return (above / (OFFICER_MARK_CEILING - OFFICER_MARK_FLOOR)) * MAX_YARD_COST_CUT;
}

/** The plain bolt-ons: open the day the yard is standing. */
export const SCRAPYARD_LEVEL_FOR_BASIC = 1;
/** The advanced entries of a structure's seven: the ones behind a retrofit document. */
export const SCRAPYARD_LEVEL_FOR_ADVANCED_MODIFICATION = 4;
/**
 * Unit modification cards by rarity: BASIC is open with the yard, MASTERPIECE waits for a serious
 * one.
 *
 * The four rungs are the ones the yard already opened things at, so the swap from the three refit
 * tiers (1, 3, 7) moved no player's threshold: INTRICATE sits where tier two did, MASTERPIECE where
 * tier three did, and ADVANCED shares the rung the advanced building modifications open at, so the
 * word "advanced" means one yard level on both benches. `scrapyard.test.ts` holds that the ladder
 * climbs strictly with the rarity, in the order `MODIFICATION_RARITIES` lists them.
 */
export const SCRAPYARD_LEVEL_FOR_RARITY: Readonly<Record<ModificationRarity, number>> = {
  basic: SCRAPYARD_LEVEL_FOR_BASIC,
  intricate: 3,
  advanced: SCRAPYARD_LEVEL_FOR_ADVANCED_MODIFICATION,
  masterpiece: 7,
};
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

export function scrapyardLevelForUpgrade(spec: UnitModificationSpec): number {
  return SCRAPYARD_LEVEL_FOR_RARITY[spec.rarity];
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
  upgrades: readonly UnitModificationSpec[];
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
