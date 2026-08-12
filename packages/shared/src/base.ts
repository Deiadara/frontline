import { z } from 'zod';
import { BuildingSchema } from './building.js';
import { IdSchema, IsoDateTimeSchema } from './primitives.js';
import { ResourcesSchema } from './resources.js';

/** A player's base, anchored to a city district. */
export const BaseSchema = z.object({
  id: IdSchema,
  ownerId: IdSchema,
  name: z.string().min(1),
  districtId: IdSchema,
  level: z.number().int().min(1),
  resources: ResourcesSchema,
  buildings: z.array(BuildingSchema),
  createdAt: IsoDateTimeSchema,
});
export type Base = z.infer<typeof BaseSchema>;

/** Public projection of a base, safe to show to other players on the city map. */
export const BaseSummarySchema = BaseSchema.pick({
  id: true,
  ownerId: true,
  name: true,
  districtId: true,
  level: true,
});
export type BaseSummary = z.infer<typeof BaseSummarySchema>;
