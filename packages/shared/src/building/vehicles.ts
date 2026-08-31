import { z } from 'zod';
import type { ItemId } from '../items/catalog.js';
import type { PartialResources } from '../resources.js';

/**
 * What the Garage builds (GDD §C, buildings-and-combat patch).
 *
 * The Garage used to hold two machines that existed only as a flat percentage on the base: a
 * motorcycle in the yard made every column in the game faster, forever, whether or not anybody got
 * on it. That is a building bonus wearing a vehicle's name, and it is replaced entirely.
 *
 * A vehicle is now a **thing you load people onto**:
 *
 * - It carries up to {@link VehicleSpec.capacity} bodies and no more.
 * - It shortens the road only for the force it is actually carrying, so what is parked at home is
 *   worth nothing at all.
 * - **If every unit riding it dies, it is destroyed**, and whoever killed them earns infamy equal
 *   to its capacity: a truck is a bigger prize than a bike because it was carrying more.
 * - Whatever comes home goes back in the yard.
 *
 * ## The four classes
 *
 * Ascending, and the ladder is capacity *and* speed rather than one or the other, which is what
 * keeps the choice from being "always the newest thing": a motorbike column is faster per body than
 * a truck column and cannot move an army, and a crew that wants forty people somewhere by dawn is
 * choosing between six trips and one slower one.
 *
 * Every machine past the first needs a **blueprint** in the satchel (the Black Market's, see
 * `market/blackmarket.ts`) as well as a Garage level. The scrap-welded motorcycle is the one
 * exception and it is deliberate: `road_reavers` are gated on motorcycles being buildable, and a
 * unit whose only gate is a blueprint that turns up on a shelf twice a month is a unit that might
 * never be reachable at all.
 */

export const VEHICLE_CLASSES = ['motorbike', 'car', 'truck', 'flying'] as const;
export const VehicleClassSchema = z.enum(VEHICLE_CLASSES);
export type VehicleClass = z.infer<typeof VehicleClassSchema>;

export const VEHICLE_CLASS_LABELS: Record<VehicleClass, string> = {
  motorbike: 'Motorbikes',
  car: 'Cars',
  truck: 'Trucks',
  flying: 'Flying',
};

/** What each class is *for*, in one line, at the head of its section on the Garage page. */
export const VEHICLE_CLASS_BLURBS: Record<VehicleClass, string> = {
  motorbike: 'Two wheels and no doors. Fastest per body, and it carries almost nobody.',
  car: 'Room for a squad and something to hide behind on the way.',
  truck: 'Moves an army. Slower than a bike and it does not need six trips.',
  flying: 'Straight over the map. Nothing on the ground is in the way of one of these.',
};

export const VEHICLE_IDS = [
  'motorcycle',
  'dirt_runner',
  'scrap_car',
  'armoured_car',
  'flatbed',
  'war_hauler',
  'gas_balloon',
  'rotorcraft',
] as const;
export const VehicleIdSchema = z.enum(VEHICLE_IDS);
export type VehicleId = (typeof VEHICLE_IDS)[number];

export interface VehicleSpec {
  id: VehicleId;
  name: string;
  class: VehicleClass;
  description: string;
  /** Garage level required before the first one can be laid down. */
  requiresGarageLevel: number;
  /** The blueprint that has to be in the satchel, or null for the one machine that needs none. */
  requiresBlueprint: ItemId | null;
  /** Scrap, oil and high-quality metal, and nothing else: §C1 prices the yard in three things. */
  cost: PartialResources;
  buildSeconds: number;
  /**
   * Percentage points off the road, for the force this machine is carrying.
   *
   * Not a fleet bonus. See {@link carriedSpeedPercent}: what a column travels at is the *weighted*
   * contribution of the machines actually under it, so a fast bike carrying two does not speed up
   * the forty people walking behind it.
   */
  speedPercent: number;
  /** Bodies it can carry. Also what it is worth in infamy to whoever destroys it (§C3). */
  capacity: number;
}

const SPECS: readonly VehicleSpec[] = [
  {
    id: 'motorcycle',
    name: 'Motorcycle',
    class: 'motorbike',
    description:
      'Two wheels, a rebuilt engine and no lights. Gets a pair across the district before anybody has finished deciding.',
    requiresGarageLevel: 1,
    requiresBlueprint: null,
    cost: { scrap: 900, oil: 200 },
    buildSeconds: 30 * 60,
    speedPercent: 22,
    capacity: 2,
  },
  {
    id: 'dirt_runner',
    name: 'Dirt Runner',
    class: 'motorbike',
    description: 'Knobbled tyres and a welded frame. Goes where the road stopped being a road.',
    requiresGarageLevel: 3,
    requiresBlueprint: 'blueprint_munitions',
    cost: { scrap: 1600, oil: 420, highQualityMetal: 60 },
    buildSeconds: 55 * 60,
    speedPercent: 30,
    capacity: 3,
  },
  {
    id: 'scrap_car',
    name: 'Scrap Car',
    class: 'car',
    description:
      'Three donor bodies and one working engine. Everybody fits and nobody is comfortable.',
    requiresGarageLevel: 4,
    requiresBlueprint: 'blueprint_munitions',
    cost: { scrap: 2600, oil: 800, highQualityMetal: 180 },
    buildSeconds: 2 * 3600,
    speedPercent: 26,
    capacity: 8,
  },
  {
    id: 'armoured_car',
    name: 'Armoured Car',
    class: 'car',
    description: 'Plated to the sills. Arrives with the same number of people it left with.',
    requiresGarageLevel: 7,
    requiresBlueprint: 'blueprint_composite_armour',
    cost: { scrap: 4200, oil: 1400, highQualityMetal: 460 },
    buildSeconds: 3 * 3600,
    speedPercent: 32,
    capacity: 12,
  },
  {
    id: 'flatbed',
    name: 'Flatbed',
    class: 'truck',
    description:
      'A deck, a rail and a tarpaulin. Twenty people sitting down is still twenty people.',
    requiresGarageLevel: 6,
    requiresBlueprint: 'blueprint_composite_armour',
    cost: { scrap: 5200, oil: 2000, highQualityMetal: 520 },
    buildSeconds: 4 * 3600,
    speedPercent: 20,
    capacity: 24,
  },
  {
    id: 'war_hauler',
    name: 'War Hauler',
    class: 'truck',
    description: 'Six axles and a cab nobody can see into. The whole crew, in one thing, at once.',
    requiresGarageLevel: 10,
    requiresBlueprint: 'blueprint_cybernetics',
    cost: { scrap: 8400, oil: 3200, highQualityMetal: 1250 },
    buildSeconds: 6 * 3600,
    speedPercent: 28,
    capacity: 40,
  },
  {
    id: 'gas_balloon',
    name: 'Gas Balloon',
    class: 'flying',
    description:
      'Lifting gas nobody will say the source of, and a basket. Silent, and over the wall rather than through it.',
    requiresGarageLevel: 9,
    requiresBlueprint: 'blueprint_signal_theory',
    cost: { scrap: 6800, oil: 2600, highQualityMetal: 940 },
    buildSeconds: 5 * 3600,
    speedPercent: 40,
    capacity: 10,
  },
  {
    id: 'rotorcraft',
    name: 'Rotorcraft',
    class: 'flying',
    description:
      'It should not fly and everyone who has seen it says so. The map stops being a map with one of these in the yard.',
    requiresGarageLevel: 12,
    requiresBlueprint: 'blueprint_rotorcraft',
    cost: { scrap: 11000, oil: 4200, highQualityMetal: 2400 },
    buildSeconds: 8 * 3600,
    speedPercent: 55,
    capacity: 18,
  },
];

export const VEHICLES: readonly VehicleSpec[] = SPECS;

const BY_ID = new Map<string, VehicleSpec>(SPECS.map((spec) => [spec.id, spec]));

export function findVehicle(id: string): VehicleSpec | undefined {
  return BY_ID.get(id);
}

/** The catalogue in class order, for a page that draws one section per class. */
export function vehiclesOfClass(kind: VehicleClass): VehicleSpec[] {
  return SPECS.filter((spec) => spec.class === kind);
}

/** How many of each machine a crew has finished. Sparse: a zero is not stored. */
export const FleetSchema: z.ZodType<Partial<Record<VehicleId, number>>> = z.partialRecord(
  VehicleIdSchema,
  z.number().int().positive(),
);
export type Fleet = z.infer<typeof FleetSchema>;

/** However rich a crew gets, the yard holds this many of one kind. */
export const MAX_PER_VEHICLE = 12;

/** Machines in a fleet, of every kind. */
export function fleetSize(fleet: Fleet): number {
  return Object.values(fleet).reduce((total, count) => total + (count ?? 0), 0);
}

/** Bodies a fleet could carry if every seat were filled. */
export function fleetCapacity(fleet: Fleet): number {
  let seats = 0;
  for (const [id, count] of Object.entries(fleet)) {
    seats += (findVehicle(id)?.capacity ?? 0) * (count ?? 0);
  }
  return seats;
}

/**
 * What a column of `bodies` travels at, given the machines it took (§C3).
 *
 * The board's rule in one function: *"the force's speed is decided by what is actually carried,
 * not by what is parked at home"*. Each machine contributes its own percentage weighted by the
 * share of the force it is carrying, so:
 *
 * - Nobody riding is worth nothing, which is what stops a yard full of bikes from being a passive
 *   travel bonus the way the old model was.
 * - Two bikes taking four people out of a force of forty move four people, and the other
 *   thirty-six are still walking. The column arrives when the walkers do.
 * - Seats past the size of the force are wasted, because there is nobody to put in them.
 *
 * Seats are filled from the **fastest** machine down, so a crew that brings a Rotorcraft and a
 * Flatbed for eighteen people gets the Rotorcraft's number for all of them rather than an average
 * that punishes them for owning a truck.
 */
export function carriedSpeedPercent(fleet: Fleet, bodies: number): number {
  if (bodies <= 0) return 0;
  const riding = [...Object.entries(fleet)]
    .flatMap(([id, count]) => {
      const spec = findVehicle(id);
      return spec ? Array.from({ length: count ?? 0 }, () => spec) : [];
    })
    .sort((a, b) => b.speedPercent - a.speedPercent);

  let seated = 0;
  let weighted = 0;
  for (const spec of riding) {
    if (seated >= bodies) break;
    const carried = Math.min(spec.capacity, bodies - seated);
    weighted += spec.speedPercent * carried;
    seated += carried;
  }
  return Math.round(weighted / bodies);
}

/**
 * The machines a force can actually load, given how many bodies are going.
 *
 * Trims what the player picked down to what there is somebody to sit in, fastest first, so a crew
 * that ticks the whole yard sends the machines that matter and leaves the rest at home rather than
 * marching an empty truck into a fight where it can be destroyed for free.
 */
export function loadable(chosen: Fleet, bodies: number): Fleet {
  const taken: Fleet = {};
  let seated = 0;
  const riding = [...Object.entries(chosen)]
    .flatMap(([id, count]) => {
      const spec = findVehicle(id);
      return spec ? Array.from({ length: count ?? 0 }, () => spec) : [];
    })
    .sort((a, b) => b.speedPercent - a.speedPercent);
  for (const spec of riding) {
    if (seated >= bodies) break;
    taken[spec.id] = (taken[spec.id] ?? 0) + 1;
    seated += spec.capacity;
  }
  return taken;
}

/**
 * What the enemy earns for wrecking these (§C3): the sum of what they could carry.
 *
 * Capacity rather than price, because capacity is what the fight actually took off the board: a
 * War Hauler is a bigger thing to have destroyed than a Motorcycle whatever either cost to build.
 */
export function vehicleInfamy(destroyed: Fleet): number {
  let earned = 0;
  for (const [id, count] of Object.entries(destroyed)) {
    earned += (findVehicle(id)?.capacity ?? 0) * (count ?? 0);
  }
  return earned;
}

/**
 * What a fight left in the yard, and what it did not (§C3).
 *
 * *"If every unit riding a vehicle dies, the vehicle is destroyed."* Riders are not tracked
 * individually, so this reads the share of the force that came home and wrecks that share of the
 * machines, fastest first: the machines at the front of the column are the ones in the fighting.
 * A force that was wiped loses everything it took; a force that walked it off loses nothing.
 *
 * Rounded down on destruction, so a scratch is never a write-off: half a squad lost off two bikes
 * wrecks one bike, and losing one body out of forty in a truck wrecks nothing.
 */
export function wrecked(took: Fleet, survivingShare: number): Fleet {
  const lost = Math.min(1, Math.max(0, 1 - survivingShare));
  const destroyed: Fleet = {};
  const riding = [...Object.entries(took)]
    .flatMap(([id, count]) => {
      const spec = findVehicle(id);
      return spec ? Array.from({ length: count ?? 0 }, () => spec) : [];
    })
    .sort((a, b) => b.speedPercent - a.speedPercent);

  const count = Math.floor(riding.length * lost);
  for (const spec of riding.slice(0, count)) {
    destroyed[spec.id] = (destroyed[spec.id] ?? 0) + 1;
  }
  return destroyed;
}

/** Two fleets, added. */
export function mergeFleets(a: Fleet, b: Fleet): Fleet {
  const total: Fleet = { ...a };
  for (const [id, count] of Object.entries(b)) {
    const amount = (total[id as VehicleId] ?? 0) + (count ?? 0);
    if (amount > 0) total[id as VehicleId] = amount;
  }
  return total;
}

/** One fleet less another. Never goes below zero, and a zero is dropped rather than stored. */
export function removeFleet(from: Fleet, taken: Fleet): Fleet {
  const left: Fleet = { ...from };
  for (const [id, count] of Object.entries(taken)) {
    const key = id as VehicleId;
    const amount = (left[key] ?? 0) - (count ?? 0);
    if (amount > 0) left[key] = amount;
    else delete left[key];
  }
  return left;
}

export type VehicleRefusal =
  'unknown_vehicle' | 'garage_too_low' | 'needs_blueprint' | 'cannot_afford' | 'fleet_full';

/** Why the yard will not build this one, in the order a player wants to hear it, or null. */
export function vehicleRefusal(
  id: string,
  fleet: Fleet,
  garageLevel: number,
  hasBlueprint: (item: ItemId) => boolean,
  affordable: (cost: PartialResources) => boolean,
): VehicleRefusal | null {
  const spec = findVehicle(id);
  if (!spec) return 'unknown_vehicle';
  if ((fleet[spec.id] ?? 0) >= MAX_PER_VEHICLE) return 'fleet_full';
  if (garageLevel < spec.requiresGarageLevel) return 'garage_too_low';
  if (spec.requiresBlueprint !== null && !hasBlueprint(spec.requiresBlueprint)) {
    return 'needs_blueprint';
  }
  if (!affordable(spec.cost)) return 'cannot_afford';
  return null;
}

/** What each refusal says on the Garage page. */
export const VEHICLE_REFUSAL_MESSAGES: Readonly<Record<VehicleRefusal, string>> = {
  unknown_vehicle: 'The yard has never heard of that',
  garage_too_low: 'The Garage is not big enough to lay one down',
  needs_blueprint: 'Nobody here knows how. You need the plans',
  cannot_afford: 'Not enough in the yard to build it',
  fleet_full: 'There is nowhere left to park another one',
};

/** Which machines the yard could turn out today: what `units/unlocks.ts` asks for (§B6). */
export function buildableVehicleIds(
  garageLevel: number,
  hasBlueprint: (item: ItemId) => boolean,
): Set<string> {
  return new Set(
    SPECS.filter(
      (spec) =>
        garageLevel >= spec.requiresGarageLevel &&
        (spec.requiresBlueprint === null || hasBlueprint(spec.requiresBlueprint)),
    ).map((spec) => spec.id),
  );
}
