import { z } from 'zod';
import { AssigneeStateSchema } from './assignees/placement.js';
import { BuildingSchema } from './building.js';
import { CommanderSchema } from './commander.js';
import { EconomyStateSchema } from './economy/state.js';
import { IdSchema, IsoDateTimeSchema } from './primitives.js';
import { ProgressionStateSchema } from './progression/state.js';
import { ResearchStateSchema } from './research/state.js';
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
  /** Meters, action tally and wage book (GDD §D, §H7). Owner-only — never in a public projection. */
  economy: EconomyStateSchema,
  /** XP banked towards the next `level` (GDD §I). Owner-only; `level` itself is public above. */
  progression: ProgressionStateSchema,
  /** The research project in flight and what it has taught this crew (GDD §B9). Owner-only. */
  research: ResearchStateSchema,
  /**
   * Where the fungible assignee pool is standing (GDD §G). Owner-only. Only the *placements* are
   * here — the pool size is a pure function of `level` (§G8) and is never stored twice.
   */
  assignees: AssigneeStateSchema,
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
