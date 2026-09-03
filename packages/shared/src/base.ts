import { z } from 'zod';
import {
  AddonsSchema,
  BuildQueueSchema,
  BuildingSchema,
  noAddons,
  type Addons,
} from './building/index.js';
import { CommanderSchema } from './commander.js';
import { isPaintableDistrictName } from './city/districts.js';
import { TrainingStateSchema, startingTraining } from './crew/training.js';
import { InventorySchema } from './items/inventory.js';
import { FittedUpgradesSchema } from './units/upgrades.js';
import { UnitLoadoutsSchema } from './units/loadout.js';
import { FleetSchema } from './building/vehicles.js';
import { ArmySchema, TrainingQueueSchema } from './units/index.js';
import { EconomyStateSchema } from './economy/state.js';
import { IdSchema, IsoDateTimeSchema } from './primitives.js';
import { ProgressionStateSchema } from './progression/state.js';
import { ResearchStateSchema } from './research/state.js';
import { ResourcesSchema } from './resources.js';

/**
 * How long a allegiance's name may be.
 *
 * Long enough for "The Ninth Street Reclamation Company", short enough that the HUD's identity
 * line and the city map's marker can both render it whole at 1024px: the board's zero-cut-text
 * bar is a layout constraint, so the length that satisfies it belongs in the schema rather than
 * in a CSS truncation nobody can see coming.
 */
/**
 * 40 once, and it did not fit the game it is drawn in.
 *
 * The standing bar carries the plaque alongside six stockpile chips, three doors, two meters and
 * an avatar. Measured at 1280: the row has about 1160px of budget and a 40-character plaque takes
 * 302px against the 222px a 21-character one takes, so the bar wrapped to a second line and cost
 * 64px off the top of every screen under it. Fitting 40 inside that budget needs about 9px type,
 * which is below the size Special Elite is legible at.
 *
 * 28 is what the bar can carry at readable size. See `plaqueType` in `FactionPlaque`.
 */
export const DISTRICT_NAME_MAX = 28;
export const DistrictNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(DISTRICT_NAME_MAX)
  // A name has to be made of characters that paint. See `isPaintableDistrictName`: the uniqueness
  // rule collapses case and space, and a zero-width character walks straight through it.
  .refine(isPaintableDistrictName, 'That name uses characters that do not show on a plaque');

/** A player's allegiance and the district it holds (GDD §A1). */
export const BaseSchema = z.object({
  id: IdSchema,
  ownerId: IdSchema,
  /**
   * The allegiance's name: the crew, not the place. Player-chosen and renameable, and the one label
   * every other player sees on the city map.
   */
  name: DistrictNameSchema,
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
  /**
   * Which of those built upgrades are bolted to which unit, three slots apiece
   * (`units/loadout.ts`). Only what is slotted pays: the stock above is what the crew *owns*.
   */
  unitLoadouts: UnitLoadoutsSchema.default({}),
  /** What is in the Garage. Counted, not itemised: one motorcycle is like any other. */
  fleet: FleetSchema.default({}),
  /**
   * §B9/§E: the blueprints the Lab has finished and the add-ons the Scrapyard has built.
   *
   * Separate from what is *fitted*, which lives on the structures themselves. Owning an add-on and
   * having it installed used to be one fact, which left §E's "a slot can be emptied" with nowhere
   * to put what came out. Migration 0056 fills it from what is already bolted on.
   *
   * **Optional**, not defaulted, for the same reason `BuildingSchema.damagedAt` is: a default makes
   * the field required on the way *out* of the parser, which would mean writing an empty shelf into
   * every `Base` literal in the codebase, most of them fixtures with nothing to do with the
   * Scrapyard. Absent and empty are the same state; read it through {@link addonsOf}.
   */
  addons: AddonsSchema.optional(),
  createdAt: IsoDateTimeSchema,
});
export type Base = z.infer<typeof BaseSchema>;

/** The crew's add-on shelf, empty for a district that has never bought one. */
export function addonsOf(base: Pick<Base, 'addons'>): Addons {
  return base.addons ?? noAddons();
}

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
