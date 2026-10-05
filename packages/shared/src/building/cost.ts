import { CHAIR_PASSIVE_CAP } from '../crew/passives.js';
import { RESOURCE_KEYS, type PartialResources } from '../resources.js';
import { softCap } from '../battle/soft-cap.js';
import { districtEffects } from './effects.js';
import {
  BUILDING_CATALOG,
  CENTRAL_BUILDING,
  levelCapForNexus,
  nexusLevelForUpgrade,
  type BuildingKind,
} from './kinds.js';
import { storageCapacityFor } from './production.js';
import { buildingLevel, type Building } from './state.js';

/**
 * What a level costs and how long it takes (§A1, §D3: oil is what building consumes).
 *
 * Two separate curves on purpose. Materials climb gently enough that a level-20 structure is a
 * campaign rather than a wall; the clock climbs much harder, because *time* is what paces a
 * base-builder and materials are only what paces the first hour of it.
 *
 * ## The discount is the Generator's, and only on the clock (§B4)
 *
 * It used to be the Nexus's, and it came off both. The Nexus now spends its whole budget on
 * permission (see `NEXUS_LADDERS`), which is a bigger job than a percentage: it decides *what* a
 * district can be, not how quickly. The board moved the discount to the Generator and asked only
 * for **time**, so the materials discount is not moved, it is **gone**. Nothing in the game takes
 * a flat percentage off what a structure costs any more except a modification a player chose and a
 * perk they hired, which is the version where the number is a decision rather than a tax rebate.
 */

/** Materials multiply by this per level: level 20 costs ~100x level 1. */
export const BUILDING_COST_GROWTH = 1.28;

/**
 * The level a structure's `BuildingSpec.lateCost` lines first appear on, and the level they
 * scale from.
 *
 * One number for every structure that has such lines, rather than a per-structure `fromLevel`. A
 * material that turns up on the fifth level of a Gate and the ninth of a Greenhouse is a rule a
 * player has to learn per building; one that turns up on everybody's fifth is a rule they learn
 * once, on the first structure they take that far.
 *
 * Five is early enough that nobody finishes the opening without meeting it and late enough that a
 * new district is never blocked on high quality metal it has no Scrapyard to make.
 */
export const LATE_COST_FROM_LEVEL = 5;

/**
 * The clock multiplies by this per level: level 20 takes ~598x level 1.
 *
 * With the catalogue's 125 to 180 second first levels that is the ladder the maintainer asked for:
 * low minutes at the start, about an hour by level 10, hours through the teens and 20 to 30 at the
 * twentieth, before the Generator takes its cut. One rate for every structure, which is what makes
 * the openers as tightly grouped as the endings: see `BuildingSpec.baseSeconds` for why that
 * tradeoff went the way it did.
 */
export const BUILDING_TIME_GROWTH = 1.4;

/**
 * Percentage points the Generator takes off every *other* structure's clock, per level.
 *
 * 2.5 a level, so a finished Generator is 50 points, added to the cards and the crew's own before
 * {@link buildTimeCut} tapers the sum. The same rate the Nexus used to
 * charge for time, deliberately: this is a move, not a buff, and a district that had the discount
 * yesterday should not find its queue slower today for having built the wrong structure.
 */
export const GENERATOR_TIME_DISCOUNT_PER_LEVEL = 2.5;

/**
 * How much the Generator is worth to a build, in percentage points off the clock.
 *
 * Zero for the Generator itself: a structure that speeds up its own next level compounds into
 * itself, which is the same reason the Nexus never discounted its own.
 */
export function generatorTimeDiscount(kind: BuildingKind, buildings: readonly Building[]): number {
  if (kind === 'generator') return 0;
  return buildingLevel(buildings, 'generator') * GENERATOR_TIME_DISCOUNT_PER_LEVEL;
}

/**
 * One sum, one bound (maintainer, 2026-10-01: "make them add").
 *
 * A build's price and clock used to take the structures' cut first (cards and the Generator, cut
 * at 70) and the crew's on what was left (cut at 60 on price, a divisor on the clock), so two
 * ceilings compounded: six cost cards and a crew discount of 40 took 77% off, past both. The
 * structures' points and the crew's are now added, and the sum goes through one taper: in full to
 * the knee, then less for every point after, closing on a ceiling it never reaches. The ceilings
 * are below 100, and every line of a bill is floored at one, so nothing is ever free or instant.
 *
 * Sized so a crew's ordinary play lands near where it was: a mid-game crew on 10 points of cards
 * and 15 of its own pays 24.55% less, about what it did. The late end was cut on 2026-10-04
 * (maintainer: "nerf a little the non passive bonuses ... so that in the end the discount is 15-20%
 * less"): a deep late crew on 62 and 40 pays 44.9% less where it paid 77.1% less, because the
 * Engineer's passive now takes up to half of what is left on top (`buildingCost`), and with a
 * perfect one and the 10% dearer catalogue (`BUILDING_PRICE_RISE`) that crew pays about 30% of the
 * old list where it paid 11.5%.
 */
export const BUILD_COST_KNEE = 20;
export const BUILD_COST_CEILING = 46;
/** The clock's taper. A Generator 10, one 10-point card and a crew on 15 is 48% off (was 43.5%). */
export const BUILD_TIME_KNEE = 35;
export const BUILD_TIME_CEILING = 85;

/**
 * Percent off a bill for this many points of build discount, every source added.
 *
 * Below zero it is a surcharge, point for point: the taper only ever shortens a reward.
 */
export function buildCostCut(points: number): number {
  return softCap(points, BUILD_COST_KNEE, BUILD_COST_CEILING);
}

/** Percent off a build clock for this many points, every source added. See {@link buildCostCut}. */
export function buildTimeCut(points: number): number {
  return softCap(points, BUILD_TIME_KNEE, BUILD_TIME_CEILING);
}

/**
 * The points on this build from the district itself (the Generator and the cards) and from the
 * crew, added, and the percent each sum takes off after the taper.
 *
 * `crew` is what the server's fold holds for this structure: `buildCostPercent` plus any
 * per-structure perk, and `buildSpeedPercent`. Defaulted to nothing, which is the list price a
 * screen with no crew in hand quotes.
 */
export function buildDiscountFor(
  kind: BuildingKind,
  buildings: readonly Building[],
  crew: { costPercent?: number; timePercent?: number } = {},
): { costPercent: number; timePercent: number } {
  const effects = districtEffects(buildings);
  return {
    costPercent: buildCostCut(effects.build_cost_reduction + (crew.costPercent ?? 0)),
    timePercent: buildTimeCut(
      generatorTimeDiscount(kind, buildings) +
        effects.build_time_reduction +
        (crew.timePercent ?? 0),
    ),
  };
}

/** `amount` with `percent` off it. A negative percent is a surcharge. */
function lessBy(amount: number, percent: number): number {
  return amount * (1 - percent / 100);
}

/** Every line of `bill`, multiplied by `growth` and rounded. Absent lines stay absent. */
function scaleBill(bill: PartialResources, growth: number): PartialResources {
  const scaled = RESOURCE_KEYS.flatMap((key) => {
    const amount = bill[key];
    return amount === undefined ? [] : [[key, Math.round(amount * growth)] as const];
  });
  return Object.fromEntries(scaled);
}

/**
 * The undiscounted price of raising `kind` **to** `level`: level 1 being the first construction.
 *
 * Two bundles, added. `baseCost` is charged from the first level and scales from it; `lateCost` is
 * charged from {@link LATE_COST_FROM_LEVEL} and scales from *that* level, so the figure in the
 * catalogue is what the structure asks for the first time it asks at all rather than a level-1
 * price nobody is ever quoted. Added per line rather than replacing, so a structure could one day
 * charge more of something it already charges without the two tables disagreeing about which one
 * wins.
 */
/**
 * Every structure's bill, a tenth dearer than the catalogue's figures (maintainer, 2026-10-04: "make
 * the buildings and location upgrades about 10% more expensive"), beside the Engineer's passive.
 */
export const BUILDING_PRICE_RISE = 1.1;

export function baseBuildingCost(kind: BuildingKind, level: number): PartialResources {
  const { baseCost, lateCost } = BUILDING_CATALOG[kind];
  const bill = scaleBill(baseCost, BUILDING_PRICE_RISE * BUILDING_COST_GROWTH ** (level - 1));
  if (lateCost !== undefined && level >= LATE_COST_FROM_LEVEL) {
    const late = scaleBill(
      lateCost,
      BUILDING_PRICE_RISE * BUILDING_COST_GROWTH ** (level - LATE_COST_FROM_LEVEL),
    );
    for (const [key, amount] of Object.entries(late)) {
      const resource = key as keyof PartialResources;
      bill[resource] = (bill[resource] ?? 0) + (amount ?? 0);
    }
  }
  return fittedToTheStore(bill, apothecaryAllowedFor(kind, level));
}

/**
 * Where a price starts bending under the store it has to fit in, as a share of that store.
 *
 * Every list price fits the store the required Nexus allows (maintainer ruling P4-A,
 * 2026-10-02). Seventeen did not: Quarters 16 asked 8,113 supplies of a store that held 3,896 at
 * the most its Nexus allowed, and Gauntlet 20 asked 32,667 of the 28,457 the top Apothecary holds.
 * A line below this share of the store is the catalogue's own figure; above it, it closes on the
 * store along `softCap` and never reaches it, so a higher level still costs more than a lower one.
 */
export const STORE_FIT_KNEE = 0.8;

/**
 * The biggest Apothecary a crew can have standing when it orders `kind` at `level`: the one the
 * Nexus that order needs allows, and for the Apothecary itself the level below the one ordered.
 */
export function apothecaryAllowedFor(kind: BuildingKind, level: number): number {
  if (kind === 'apothecary') return Math.max(0, level - 1);
  const nexus = kind === CENTRAL_BUILDING ? level - 1 : nexusLevelForUpgrade(kind, level);
  return levelCapForNexus('apothecary', nexus);
}

/** Every line of `bill` bent under what an Apothecary at `apothecary` holds of it. */
export function fittedToTheStore(bill: PartialResources, apothecary: number): PartialResources {
  const store = [
    { id: 'store', kind: 'apothecary' as const, level: apothecary, modifications: [] },
  ];
  const fitted: PartialResources = {};
  for (const [key, amount] of Object.entries(bill) as [keyof PartialResources, number][]) {
    const ceiling = storageCapacityFor(store, key);
    fitted[key] = Number.isFinite(ceiling)
      ? Math.floor(softCap(amount, ceiling * STORE_FIT_KNEE, ceiling))
      : amount;
  }
  return fitted;
}

/**
 * What this district actually pays to raise `kind` to `level`.
 *
 * The whole bundle scales, not just the oil, so a structure never gets cheaper in any one resource
 * as it climbs. Rounded to whole units, resources are counted, not measured, and floored at 1 for
 * any line the catalogue charges at all, so a deep discount can never make a material free.
 */
/**
 * The level a bill is written at, once a crew's credit is taken off (the `building_credit` perk).
 *
 * Never below the first level, which is the whole of the clamp: a credit big enough to price a
 * level-2 Lab at level zero would be asking {@link BUILDING_COST_GROWTH} for a negative exponent,
 * and the answer is a bill smaller than the catalogue's own floor rather than a free structure.
 * The *order* is still for the real level; only the price moves. That distinction is load-bearing:
 * the queue, the clock and the cap all read the level the structure is actually going to.
 */
export function creditedLevel(level: number, credit = 0): number {
  return Math.max(1, level - Math.max(0, Math.trunc(credit)));
}

export function buildingCost(
  kind: BuildingKind,
  level: number,
  buildings: readonly Building[],
  /** The crew's points off a build: `buildCostPercent` and any perk naming this structure. */
  crewCostPercent = 0,
  /**
   * The Engineer's passive (`passives.ts`, maintainer 2026-10-04): up to half off, after the
   * tapered discount rather than inside it, so a crew already at the taper's ceiling still feels a
   * better Engineer.
   */
  engineerPercent = 0,
): PartialResources {
  const { costPercent } = buildDiscountFor(kind, buildings, { costPercent: crewCostPercent });
  const engineer = Math.max(0, Math.min(CHAIR_PASSIVE_CAP.building_cost, engineerPercent));
  const base = baseBuildingCost(kind, level);
  const discounted = Object.entries(base).map(([key, amount]) => [
    key,
    Math.max(1, Math.round(lessBy(lessBy(amount ?? 0, costPercent), engineer))),
  ]);
  return Object.fromEntries(discounted) as PartialResources;
}

/** The undiscounted clock for raising `kind` to `level`, in seconds. */
export function baseBuildSeconds(kind: BuildingKind, level: number): number {
  return Math.round(BUILDING_CATALOG[kind].baseSeconds * BUILDING_TIME_GROWTH ** (level - 1));
}

/**
 * How long this district takes to raise `kind` to `level`, in seconds.
 *
 * Floored at one second: a build that resolves in the same instant it is ordered has no queue
 * position to occupy and would make the six-slot queue meaningless at the bottom of the tree.
 */
export function buildingBuildSeconds(
  kind: BuildingKind,
  level: number,
  buildings: readonly Building[],
  /** The crew's `buildSpeedPercent`: points off the clock, added to the Generator's and the cards'. */
  crewSpeedPercent = 0,
): number {
  const { timePercent } = buildDiscountFor(kind, buildings, { timePercent: crewSpeedPercent });
  return Math.max(1, Math.round(lessBy(baseBuildSeconds(kind, level), timePercent)));
}
