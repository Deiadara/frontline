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

/** Stockpile every new base starts with. */
export const STARTING_RESOURCES: Resources = {
  caps: 500,
  food: 300,
  oil: 120,
  scrap: 200,
  highQualityMetal: 40,
};

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
