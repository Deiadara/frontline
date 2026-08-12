import { z } from 'zod';

/** The four base-building currencies. */
export const ResourcesSchema = z.object({
  credits: z.number().nonnegative(),
  power: z.number().nonnegative(),
  data: z.number().nonnegative(),
  alloy: z.number().nonnegative(),
});
export type Resources = z.infer<typeof ResourcesSchema>;

/** Partial bundle — used for costs, outputs and battle rewards. */
export const PartialResourcesSchema = ResourcesSchema.partial();
export type PartialResources = z.infer<typeof PartialResourcesSchema>;

/** Stockpile every new base starts with. */
export const STARTING_RESOURCES: Resources = {
  credits: 500,
  power: 100,
  data: 50,
  alloy: 200,
};

/** Immutable add: returns `a` with `b`'s amounts applied on top. */
export function addResources(a: Resources, b: PartialResources): Resources {
  return {
    credits: a.credits + (b.credits ?? 0),
    power: a.power + (b.power ?? 0),
    data: a.data + (b.data ?? 0),
    alloy: a.alloy + (b.alloy ?? 0),
  };
}
