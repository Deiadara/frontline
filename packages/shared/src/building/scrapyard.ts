import type { TrapSpec } from '../battle/traps.js';
import type { ModificationRarity } from '../modification-rarity.js';
import { RESOURCE_KEYS, type PartialResources, type ResourceKey } from '../resources.js';
import { UNIT_MODIFICATIONS, type UnitModificationSpec } from '../units/modifications.js';
import { CHAIR_PASSIVE_CAP } from '../crew/passives.js';
import { MODIFICATIONS, type ModificationSpec } from './modifications.js';

/**
 * What the Scrapyard's own level is worth (maintainer request, 2026-09-10).
 *
 * Until now the yard was a switch: standing at level one it sold the whole catalogue at list price,
 * and nineteen more levels bought nothing but scrap output. A structure whose levels change nothing
 * about what it does is a structure nobody raises on purpose. Two things move with the level now,
 * and both are read here and nowhere else, so the page's info box and the server's bill cannot
 * disagree.
 *
 * **What it can cut.** Each rarity of modification card, structure and unit alike
 * ({@link SCRAPYARD_LEVEL_FOR_RARITY}), and each trap has a level of its own. The thresholds sit on
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
 * The two lines of a Scrapyard bill the Salvager cuts (maintainer, 2026-10-04: "the salvager
 * reduces anything built by the scrapyards' scrap and HQ metal by X%").
 */
export const SALVAGER_CUT_LINES: readonly ResourceKey[] = ['scrap', 'highQualityMetal'];

/**
 * A bill with the yard's discount on it, and the Salvager's on its scrap and HQ metal.
 *
 * Every line present stays present and no line drops below one: a discount that removed the metal
 * line from an advanced bracket would silently break the rule that metal is what marks one out.
 */
export function scrapyardPrice(
  cost: PartialResources,
  level: number,
  /** The Salvager's passive (`passives.ts`), 0 when the chair is empty. */
  salvagerCutPercent = 0,
): PartialResources {
  const off = scrapyardDiscountPercent(level) / 100;
  const salvagerOff =
    Math.max(0, Math.min(CHAIR_PASSIVE_CAP.scrapyard_cost, salvagerCutPercent)) / 100;
  const priced: PartialResources = {};
  for (const key of RESOURCE_KEYS) {
    const amount = cost[key];
    if (amount === undefined) continue;
    // Multiplied rather than summed, so the two discounts compose instead of racing each other to
    // a hundred: a maxed yard and a perfect Salvager take half off what is left, not 50 points off
    // a number that was already most of the way to free.
    const salvaged = SALVAGER_CUT_LINES.includes(key) ? 1 - salvagerOff : 1;
    priced[key] = Math.max(1, Math.round(amount * (1 - off) * salvaged));
  }
  return priced;
}

/**
 * What the yard's level takes off every bill, as the plate prints it. The Salvager's cut is not in
 * it since it reaches two lines only (2026-10-04); the response carries it on its own.
 */
export function scrapyardBillCutPercent(level: number): number {
  return Math.round(scrapyardDiscountPercent(level));
}

/** The plain bolt-ons: open the day the yard is standing. */
export const SCRAPYARD_LEVEL_FOR_BASIC = 1;

/**
 * The levels each rarity of card opens across, unit and structure alike (maintainer ruling
 * P13-A, 2026-10-02: every Scrapyard level unlocks something, and the most advanced cards and
 * traps need the top levels).
 *
 * It was four rungs, 1, 3, 4 and 7, so the catalogue was fully open at level 7 and levels 8 to 20
 * bought only scrap. The bands cover all twenty, and each card opens at a level inside its band
 * (`spreadOverBands`), the cheaper first, so every level of the yard opens cards of its own.
 */
export const SCRAPYARD_RARITY_BANDS: Readonly<
  Record<ModificationRarity, readonly [from: number, to: number]>
> = {
  basic: [SCRAPYARD_LEVEL_FOR_BASIC, 3],
  intricate: [4, 8],
  advanced: [9, 13],
  masterpiece: [14, 20],
};

/** Where each rarity's band starts: the first level a card of that grade can be cut at. */
export const SCRAPYARD_LEVEL_FOR_RARITY: Readonly<Record<ModificationRarity, number>> = {
  basic: SCRAPYARD_RARITY_BANDS.basic[0],
  intricate: SCRAPYARD_RARITY_BANDS.intricate[0],
  advanced: SCRAPYARD_RARITY_BANDS.advanced[0],
  masterpiece: SCRAPYARD_RARITY_BANDS.masterpiece[0],
};
/** The ADVANCED rung of {@link SCRAPYARD_LEVEL_FOR_RARITY}. */
export const SCRAPYARD_LEVEL_FOR_ADVANCED_MODIFICATION = SCRAPYARD_LEVEL_FOR_RARITY.advanced;

/**
 * Each card's level inside its rarity's band: the cards of a rarity sorted by what they are worth
 * (dearest last, ties by id) and dealt evenly across the band, so every level opens some.
 */
function spreadOverBands<T extends { id: string; rarity: ModificationRarity }>(
  cards: readonly T[],
  worth: (card: T) => number,
): ReadonlyMap<string, number> {
  const levels = new Map<string, number>();
  for (const [rarity, [from, to]] of Object.entries(SCRAPYARD_RARITY_BANDS) as [
    ModificationRarity,
    readonly [number, number],
  ][]) {
    const ofRarity = cards
      .filter((card) => card.rarity === rarity)
      .sort((a, b) => worth(a) - worth(b) || a.id.localeCompare(b.id));
    const width = to - from + 1;
    ofRarity.forEach((card, index) => {
      levels.set(card.id, from + Math.floor((index * width) / ofRarity.length));
    });
  }
  return levels;
}

// A structure card is priced off its magnitude (`modificationPrice`), a unit card off its bill.
const STRUCTURE_CARD_LEVELS = spreadOverBands(
  MODIFICATIONS.filter((spec) => spec.yardLevel === undefined),
  (spec) => spec.magnitude,
);
const UNIT_CARD_LEVELS = spreadOverBands(UNIT_MODIFICATIONS, (spec) =>
  RESOURCE_KEYS.reduce((total, key) => total + (spec.cost[key] ?? 0), 0),
);
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
  // Spread over the whole yard since 2026-10-02 (P13-A): the two that bite hardest need its top.
  trap_razor_wire: 1,
  trap_pressure_plates: 3,
  trap_gas_shell: 6,
  trap_fuel_fougasse: 10,
  trap_collapse: 15,
  trap_flooded_cellar: 20,
};

/**
 * A structure card opens on its grade's rung, the unit cards' ladder (maintainer, 2026-09-29:
 * "even the yard ladder"). It opened by magnitude before, at 1 or 4, so an INTRICATE structure card
 * was open two levels before an INTRICATE unit card and a MASTERPIECE one three before, and a player
 * who had learnt the ladder on one bench had learnt the wrong thing about the other.
 */
export function scrapyardLevelForModification(spec: ModificationSpec): number {
  // A card cut below its old band keeps the rung it opened at (`ModificationSpec.yardLevel`).
  return (
    spec.yardLevel ?? STRUCTURE_CARD_LEVELS.get(spec.id) ?? SCRAPYARD_LEVEL_FOR_RARITY[spec.rarity]
  );
}

export function scrapyardLevelForUpgrade(spec: UnitModificationSpec): number {
  return UNIT_CARD_LEVELS.get(spec.id) ?? SCRAPYARD_LEVEL_FOR_RARITY[spec.rarity];
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
