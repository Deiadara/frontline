import { z } from 'zod';
import { AssigneeStateSchema } from './assignees/placement.js';
import { BuildQueueSchema, BuildingSchema } from './building/index.js';
import { CommanderSchema } from './commander.js';
import { TrainingStateSchema, startingTraining } from './crew/training.js';
import { InventorySchema } from './items/inventory.js';
import { FittedUpgradesSchema } from './units/upgrades.js';
import { FleetSchema } from './building/vehicles.js';
import { ArmySchema, TrainingQueueSchema } from './units/index.js';
import { EconomyStateSchema } from './economy/state.js';
import { IdSchema, IsoDateTimeSchema } from './primitives.js';
import { ProgressionStateSchema } from './progression/state.js';
import { ResearchStateSchema } from './research/state.js';
import { ResourcesSchema } from './resources.js';

/**
 * How long a faction's name may be.
 *
 * Long enough for "The Ninth Street Reclamation Company", short enough that the HUD's identity
 * line and the city map's marker can both render it whole at 1024px: the board's zero-cut-text
 * bar is a layout constraint, so the length that satisfies it belongs in the schema rather than
 * in a CSS truncation nobody can see coming.
 */
export const FACTION_NAME_MAX = 40;
export const FactionNameSchema = z.string().trim().min(2).max(FACTION_NAME_MAX);

/** A player's faction and the district it holds (GDD §A1). */
export const BaseSchema = z.object({
  id: IdSchema,
  ownerId: IdSchema,
  /**
   * The faction's name: the crew, not the place. Player-chosen and renameable, and the one label
   * every other player sees on the city map.
   */
  name: FactionNameSchema,
  districtId: IdSchema,
  level: z.number().int().min(1),
  /** AI-controlled rival base. Bot bases are raidable; human bases are not. */
  isBot: z.boolean(),
  resources: ResourcesSchema,
  /** Meters, action tally and wage book (GDD §D, §H7). Owner-only: never in a public projection. */
  economy: EconomyStateSchema,
  /** XP banked towards the next `level` (GDD §I). Owner-only; `level` itself is public above. */
  progression: ProgressionStateSchema,
  /** The research project in flight and what it has taught this crew (GDD §B9). Owner-only. */
  research: ResearchStateSchema,
  /**
   * Where the fungible assignee pool is standing (GDD §G). Owner-only. Only the *placements* are
   * here: the pool size is a pure function of `level` (§G8) and is never stored twice.
   */
  assignees: AssigneeStateSchema,
  buildings: z.array(BuildingSchema),
  /** Up to six orders in flight (§A1). Owner-only, and settled lazily like everything else. */
  buildQueue: BuildQueueSchema,
  /**
   * Units standing at home and available to send (§A5).
   *
   * Only the ones *here*. Units left on a captured place live on that place's control row, because
   * a garrison belongs to the ground rather than to the crew. It is what changes hands, or dies,
   * when the place does.
   */
  army: ArmySchema.default({}),
  /** Up to five training orders in flight (§A5). */
  trainingQueue: TrainingQueueSchema,
  commanders: z.array(CommanderSchema),
  /**
   * The Overseer's and the officers' own drilling (§F2). Owner-only.
   *
   * Defaulted rather than required, because it arrived after bases existed: a district written
   * before the Training tab has no `training_json`, and a schema that refused to parse it would
   * take every one of those accounts offline instead of giving them today's five sessions.
   */
  training: TrainingStateSchema.default(() => startingTraining(new Date().toISOString())),
  /**
   * Everything held that is not a resource: blueprints, components, relics. Owner-only.
   *
   * Defaulted like `training`, and for the same reason: a district written before the market
   * existed has no column, and a schema that refused to parse it would take the account offline
   * rather than open it with an empty satchel.
   */
  inventory: InventorySchema.default({}),
  /**
   * Workshop upgrades the crew has fitted. Applies to every unit of the affected tiers, forever:
   * see `upgradedStats`, which folds them at read time so a refit reaches units already trained.
   */
  fittedUpgrades: FittedUpgradesSchema.default([]),
  /** What is in the Garage. Counted, not itemised: one motorcycle is like any other. */
  fleet: FleetSchema.default({}),
  createdAt: IsoDateTimeSchema,
});
export type Base = z.infer<typeof BaseSchema>;

/**
 * Public projection of a base, safe to show to other players on the city map.
 * `isBot` is public on purpose: the map styles hostile markers from it.
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
