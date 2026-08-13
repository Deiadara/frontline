import { z } from 'zod';

/**
 * The five base resources (GDD §D1 food, §D2 caps, §D3 oil, §D5 scrap, §D6 high-quality metal).
 *
 * `caps` is the currency: officer wages are paid in caps (§D2, §H7). `scrap` and high-quality
 * metal are deliberately distinct (§D6) — scrap is the salvage floor, high-quality metal is the
 * scarce input. This set *replaces* the MVP's credits/power/data/alloy outright (§D9); there is
 * no live player data, so the migration is destructive.
 */
export const ResourcesSchema = z.object({
  caps: z.number().nonnegative(),
  food: z.number().nonnegative(),
  oil: z.number().nonnegative(),
  scrap: z.number().nonnegative(),
  highQualityMetal: z.number().nonnegative(),
});
export type Resources = z.infer<typeof ResourcesSchema>;
export type ResourceKey = keyof Resources;

/**
 * Every resource key in display order — derived from the schema, so a resource added to
 * `ResourcesSchema` can never be silently missing from a readout.
 */
export const RESOURCE_KEYS = Object.keys(ResourcesSchema.shape) as readonly ResourceKey[];

/** Partial bundle — used for costs, outputs and battle rewards. */
export const PartialResourcesSchema = ResourcesSchema.partial();
export type PartialResources = z.infer<typeof PartialResourcesSchema>;

/**
 * Stockpile every new base starts with.
 *
 * Sized against the level-1 `BUILDING_CATALOG` prices so the opening is tight but not dead: every
 * empty plot is affordable on its own, three of them can be raised, and then **oil** is what runs
 * out — GDD §D3's sink is what ends the first session, not an arbitrary wall. The level-2 Command
 * Center stays out of reach, so the cap that holds the village down has to be earned.
 * `build.test.ts` pins both halves of that shape.
 */
export const STARTING_RESOURCES: Resources = {
  caps: 600,
  food: 300,
  oil: 120,
  scrap: 500,
  highQualityMetal: 40,
};

/** Whether `stock` covers every line of `cost`. The affordability half of any purchase. */
export function canAfford(stock: Resources, cost: PartialResources): boolean {
  return RESOURCE_KEYS.every((key) => stock[key] >= (cost[key] ?? 0));
}

/**
 * Immutable spend: `stock` with `cost` taken off it.
 *
 * Callers must check {@link canAfford} first — `ResourcesSchema` refuses negatives, so an
 * unaffordable spend would be caught only on the way back out of the database, one layer too late
 * to say anything useful to the player.
 */
export function spendResources(stock: Resources, cost: PartialResources): Resources {
  return Object.fromEntries(
    RESOURCE_KEYS.map((key) => [key, stock[key] - (cost[key] ?? 0)]),
  ) as Resources;
}

/** Immutable add: returns `a` with `b`'s amounts applied on top. */
export function addResources(a: Resources, b: PartialResources): Resources {
  return {
    caps: a.caps + (b.caps ?? 0),
    food: a.food + (b.food ?? 0),
    oil: a.oil + (b.oil ?? 0),
    scrap: a.scrap + (b.scrap ?? 0),
    highQualityMetal: a.highQualityMetal + (b.highQualityMetal ?? 0),
  };
}
