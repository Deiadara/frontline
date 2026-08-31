import { z } from 'zod';
import { PartialResourcesSchema, ResourcesSchema } from './resources.js';
import { FleetSchema, VehicleClassSchema, VehicleIdSchema } from './building/vehicles.js';
import { IdSchema } from './primitives.js';

/**
 * The Garage, on the wire (GDD §B11, §C).
 *
 * Its own module rather than a section of `api.ts`, so the page can grow a field without anybody
 * else's screen being rebased on it.
 *
 * The page works the way the units tab does, and the payload is shaped for that: one row per
 * machine, every row carrying what it costs, what it gives and, when it is locked, **why**. A row
 * that is simply missing teaches nothing; a row that says "needs the plans" is a thing to go and
 * do.
 */

export const GarageVehicleSchema = z.object({
  id: VehicleIdSchema,
  name: z.string(),
  class: VehicleClassSchema,
  description: z.string(),
  /** How many are parked in the yard right now. */
  owned: z.number().int().nonnegative(),
  cost: PartialResourcesSchema,
  buildSeconds: z.number().int().positive(),
  /** Bodies it carries, which is also what the enemy earns for destroying it (§C3). */
  capacity: z.number().int().positive(),
  /** Percentage points off the road, for the force it is actually carrying. */
  speedPercent: z.number().int().nonnegative(),
  requiresGarageLevel: z.number().int().nonnegative(),
  /** The plans it needs, named, or null. Named rather than flagged: the player has to find it. */
  requiresBlueprint: z.string().nullable(),
  /** Whether the crew already holds those plans. False is what the lock line is about. */
  hasBlueprint: z.boolean(),
  /** Null when it can be built right now; otherwise the one thing standing in the way. */
  refusal: z.string().nullable(),
});
export type GarageVehicle = z.infer<typeof GarageVehicleSchema>;

export const GarageResponseSchema = z.object({
  /** The stockpile, so a cost line can grey what the crew cannot cover without a second query. */
  resources: ResourcesSchema,
  /** The Garage's own level, or 0 when it has not been built. The gate every row reads against. */
  garageLevel: z.number().int().nonnegative(),
  /** What is parked, by id. */
  fleet: FleetSchema,
  /** Seats across the whole yard: what the crew could put on wheels at once. */
  capacity: z.number().int().nonnegative(),
  vehicles: z.array(GarageVehicleSchema),
});
export type GarageResponse = z.infer<typeof GarageResponseSchema>;

/**
 * Build one.
 *
 * One at a time and paid immediately, like a workshop upgrade rather than like a building: the
 * Garage has no queue of its own and adding one would be a second build queue with its own screen,
 * its own settle and its own bugs for a mechanic whose interesting decision is *which* machine.
 *
 * Moved here from `api.ts` with the rest of the yard when §B11 gave the Garage its own page.
 */
export const BuildVehicleRequestSchema = z.object({
  vehicleId: VehicleIdSchema,
});
export type BuildVehicleRequest = z.infer<typeof BuildVehicleRequestSchema>;

/** Every write on this page answers with the whole page plus the stockpile it just spent. */
export const GarageMutationResponseSchema = z.object({
  garage: GarageResponseSchema,
});
export type GarageMutationResponse = z.infer<typeof GarageMutationResponseSchema>;

/**
 * §C3: which machines this crew is taking to a fight.
 *
 * Absolute rather than a delta, unlike a deployment's units. A fleet is small (a dozen machines at
 * the very top end against hundreds of bodies) and the picker is a set of counters rather than a
 * pair of send/withdraw buttons, so the honest request is "this is what I am taking".
 */
export const TakeVehiclesRequestSchema = z.object({
  battleId: IdSchema,
  vehicles: FleetSchema,
});
export type TakeVehiclesRequest = z.infer<typeof TakeVehiclesRequestSchema>;
