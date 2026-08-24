import { z } from 'zod';
import type { ItemCost } from '../items/inventory.js';
import type { ItemId } from '../items/catalog.js';
import type { PartialResources } from '../resources.js';

/**
 * What the Garage builds (GDD §A1, garage extension).
 *
 * The Garage was a structure with a hold bonus and nothing to do. It is now the only place in the
 * game that shortens the *road* — every other bonus makes a fight go better or a build go faster,
 * and none of them touch the hours a crew spends walking to a district three streets over. On a
 * map where travel time is the real cost of acting, that is the most valuable thing a building can
 * sell.
 *
 * Two tiers, and the gap between them is the whole mid-to-late game:
 *
 * - **Motorcycles** are scrap and a gyro. Any crew that has built a Garage can have them, and they
 *   take a serious bite out of the road.
 * - **Rotorcraft** need a blueprint the Runner sells perhaps twice a month, a Rotor Hub nobody can
 *   fabricate, and a Garage at level twelve. They are an end-game statement, and they halve the
 *   map.
 *
 * A fleet is *counted*, not fitted: each machine is worth a diminishing slice of speed, so the
 * fifth motorcycle is worth less than the first and there is a point where building another is
 * worse than spending the scrap on anything else. Without that the correct play is always "one
 * more bike", forever.
 */

export const VEHICLE_IDS = ['motorcycle', 'rotorcraft'] as const;
export const VehicleIdSchema = z.enum(VEHICLE_IDS);
export type VehicleId = z.infer<typeof VehicleIdSchema>;

export interface VehicleSpec {
  id: (typeof VEHICLE_IDS)[number];
  name: string;
  description: string;
  /** Garage level required before the first one can be laid down. */
  requiresGarageLevel: number;
  /** The blueprint that unlocks it at all, when there is one. */
  requiresBlueprint: ItemId | null;
  cost: PartialResources;
  parts: ItemCost;
  buildSeconds: number;
  /** Percent off the road, for the first of its kind. Later ones are worth less — see the fold. */
  travelSpeedPercent: number;
  /** However many are built, this line contributes at most this much. */
  maxTravelSpeedPercent: number;
}

const SPECS: readonly VehicleSpec[] = [
  {
    id: 'motorcycle',
    name: 'Motorcycle',
    description:
      'Two wheels, a rebuilt engine and no lights. Gets a crew across the district before anybody has finished deciding.',
    requiresGarageLevel: 2,
    requiresBlueprint: null,
    cost: { scrap: 1400, oil: 300, caps: 600 },
    parts: { gyro_assembly: 1, scrap_servo: 2 },
    buildSeconds: 45 * 60,
    travelSpeedPercent: 8,
    maxTravelSpeedPercent: 30,
  },
  {
    id: 'rotorcraft',
    name: 'Rotorcraft',
    description:
      'It should not fly and everyone who has seen it says so. The map stops being a map with one of these in the yard.',
    requiresGarageLevel: 12,
    requiresBlueprint: 'blueprint_rotorcraft',
    cost: { scrap: 9000, highQualityMetal: 1200, oil: 2400, caps: 7500 },
    parts: { rotor_hub: 1, coolant_cell: 3, gyro_assembly: 2 },
    buildSeconds: 6 * 3600,
    travelSpeedPercent: 22,
    maxTravelSpeedPercent: 50,
  },
];

export const VEHICLES: readonly VehicleSpec[] = SPECS;

const BY_ID = new Map(SPECS.map((spec) => [spec.id, spec]));

export function findVehicle(id: string): VehicleSpec | undefined {
  return BY_ID.get(id as VehicleId);
}

/** How many of each machine a crew has finished. Sparse: a zero is not stored. */
export const FleetSchema: z.ZodType<Partial<Record<VehicleId, number>>> = z.partialRecord(
  VehicleIdSchema,
  z.number().int().positive(),
);
export type Fleet = z.infer<typeof FleetSchema>;

/** The rate each additional machine of a kind is worth, against the one before it. */
const DIMINISH = 0.6;

/**
 * What a fleet takes off the road, in percent.
 *
 * A geometric fold: the first machine is worth its full rating, the second sixty percent of that,
 * the third sixty percent of *that*. It converges, and the per-line cap catches it before the tail
 * gets silly. Rounded once at the end rather than per machine, so ten cheap bikes are not worth
 * more than the arithmetic says because of ten roundings in the player's favour.
 */
export function fleetTravelSpeedPercent(fleet: Fleet): number {
  let total = 0;
  for (const spec of SPECS) {
    const count = fleet[spec.id] ?? 0;
    let line = 0;
    for (let index = 0; index < count; index++) {
      line += spec.travelSpeedPercent * Math.pow(DIMINISH, index);
    }
    total += Math.min(spec.maxTravelSpeedPercent, line);
  }
  return Math.round(total);
}

export type VehicleRefusal =
  | 'unknown_vehicle'
  | 'garage_too_low'
  | 'needs_blueprint'
  | 'cannot_afford'
  | 'missing_parts'
  | 'fleet_full';

/** However rich a crew gets, the yard holds this many of one kind. */
export const MAX_PER_VEHICLE = 6;

export function vehicleRefusal(
  id: string,
  fleet: Fleet,
  garageLevel: number,
  hasBlueprint: (item: ItemId) => boolean,
  affordable: (cost: PartialResources) => boolean,
  hasParts: (parts: ItemCost) => boolean,
): VehicleRefusal | null {
  const spec = findVehicle(id);
  if (!spec) return 'unknown_vehicle';
  if ((fleet[spec.id] ?? 0) >= MAX_PER_VEHICLE) return 'fleet_full';
  if (spec.requiresBlueprint !== null && !hasBlueprint(spec.requiresBlueprint)) {
    return 'needs_blueprint';
  }
  if (garageLevel < spec.requiresGarageLevel) return 'garage_too_low';
  if (!affordable(spec.cost)) return 'cannot_afford';
  if (!hasParts(spec.parts)) return 'missing_parts';
  return null;
}
