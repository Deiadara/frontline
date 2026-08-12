import { z } from 'zod';
import { BuildingSchema } from './building.js';
import { CommanderSchema } from './commander.js';
import { IdSchema, IsoDateTimeSchema } from './primitives.js';
import { ResourcesSchema } from './resources.js';

/** A player's base, anchored to a city district. */
export const BaseSchema = z.object({
  id: IdSchema,
  ownerId: IdSchema,
  name: z.string().min(1),
  districtId: IdSchema,
  level: z.number().int().min(1),
  /** AI-controlled rival base. Bot bases are raidable; human bases are not. */
  isBot: z.boolean(),
  resources: ResourcesSchema,
  buildings: z.array(BuildingSchema),
  commanders: z.array(CommanderSchema),
  createdAt: IsoDateTimeSchema,
});
export type Base = z.infer<typeof BaseSchema>;

/**
 * Public projection of a base, safe to show to other players on the city map.
 * `isBot` is public on purpose — the map styles hostile markers from it.
 */
export const BaseSummarySchema = BaseSchema.pick({
  id: true,
  ownerId: true,
  name: true,
  districtId: true,
  level: true,
  isBot: true,
});
export type BaseSummary = z.infer<typeof BaseSummarySchema>;
