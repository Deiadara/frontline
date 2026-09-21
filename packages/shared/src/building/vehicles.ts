import { z } from 'zod';
import type { PartialResources } from '../resources.js';
import { effectiveSpeed } from '../time/speed.js';
import { MAX_EFFECT_REDUCTION, withReduction } from './effects.js';

/**
 * What the Garage builds (GDD §C, buildings-and-combat patch).
 *
 * The Garage used to hold two machines that existed only as a flat percentage on the base: a
 * motorcycle in the yard made every column in the game faster, forever, whether or not anybody got
 * on it. That is a building bonus wearing a vehicle's name, and it is replaced entirely.
 *
 * A vehicle is now a **thing you load people onto**:
 *
 * - It carries up to {@link VehicleSpec.capacity} **unit slots** and no more, which is the same
 *   currency the district houses people in: a machine with thirty seats twenty Haulers at one slot
 *   each and five Ironsides at two, and nothing at all that costs more slots than it has left.
 * - It shortens the road only for the force it is actually carrying, so what is parked at home is
 *   worth nothing at all.
 * - **If every unit riding it dies, it is destroyed**, and whoever killed them earns infamy equal
 *   to its capacity: a truck is a bigger prize than a bike because it was carrying more.
 * - Whatever comes home goes back in the yard.
 *
 * ## Speed is the same stat units have
 *
 * A machine no longer carries a percentage off the road. It carries a **speed**, 0 to 100, on the
 * same scale as `UnitStats.speed`, and everybody it is carrying travels at exactly that number
 * (the board: *"everybody riding the vehicle has exactly the speed of the vehicle"*).
 * What a speed is worth on a clock is `time/speed.ts`: `base / (1 + speed/100)`, so 95 takes a
 * twenty-minute road down to about ten and 45 takes it to fourteen.
 *
 * That makes a machine comparable with the people in it, which is the point: the Road Reavers ride
 * at 65 and the Scrappy they ride is 65, so putting a Reaver on a bike changes nothing and putting
 * a Warden on one nearly doubles their pace. A handful of sheets outrun most of the yard on their
 * own legs (Cyberhounds, Kite Crews, three of the legendaries), and only the Heli Porter beats all
 * of them.
 *
 * ## The four classes
 *
 * The classes trade speed against capacity, and the trade is the whole design: a motorbike column is
 * faster per unit than a truck column and cannot move an army, so a crew that wants thirty people
 * somewhere by dawn is choosing between fifteen trips on the Scrappy and one slower one on the
 * Cheese Wagon. Every machine in a class outruns every machine in the class that carries more than
 * it, and `vehicles.test.ts` pins that rather than trusting the table to stay sorted.
 *
 * It did not stay sorted. The biggest truck in the game was written at 28 against the bike's 22, so
 * the thing this doc used as its example of "slow but it moves an army" outran the thing it used as
 * the opposite, and the plated saloon at 32 beat both bikes while carrying twelve. The ladder is a
 * rule now, with a test under it.
 *
 * Within a class the later machine is the upgrade: more seats and a little quicker, gated on a
 * Garage level, a blueprint and a much larger bill. Across classes it is a trade.
 *
 * The class is a rule about the numbers, not a heading. The Garage page lists every machine in
 * one run, in the order the Garage lets them out, so the catalogue below is kept in Garage-level
 * order and `vehicles.test.ts` pins that too.
 *
 * ## Every machine needs its blueprint, and this module does not know which (§D12c)
 *
 * A vehicle used to name a flat `blueprint_*` item off the Black Market's shelf, and the
 * scrap-welded motorcycle named none at all so that Road Reavers could not be locked behind a
 * shelf that restocks twice a month. Both of those are gone. Every machine is behind its own
 * blueprint **document** now, the motorcycle included, and a document is assembled out of pages
 * that missions drop: a gate a crew works towards rather than one it waits on.
 *
 * The mapping from machine to document lives in `blueprints/catalog.ts`, on the document, because
 * one document can gate more than one thing (§D12b: the motorcycle and the Road Reavers who ride
 * it). So {@link vehicleRefusal} takes the answer as a predicate rather than importing the
 * blueprint catalogue: `building/` sits below `blueprints/` in the import graph, and the callers
 * that have an inventory to hand pass `blueprintGateMet(inventory, 'vehicle', id)` straight in.
 */

export const VEHICLE_CLASSES = ['motorbike', 'car', 'truck', 'flying'] as const;
export const VehicleClassSchema = z.enum(VEHICLE_CLASSES);
export type VehicleClass = z.infer<typeof VehicleClassSchema>;

export const VEHICLE_IDS = [
  'motorcycle',
  'dirt_runner',
  'scrap_car',
  'armoured_car',
  'gas_balloon',
  'rotorcraft',
  'heli_porter',
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
  /** Scrap, oil and high-quality metal, and nothing else: §C1 prices the yard in three things. */
  cost: PartialResources;
  buildSeconds: number;
  /**
   * 0 to 100, the same stat a unit's sheet carries, and what everybody aboard travels at.
   *
   * Not a fleet bonus and not a percentage off a clock. See {@link columnSpeed}: a column moves at
   * its slowest group, so a fast bike carrying two does nothing at all for the forty people
   * walking behind it, and the yard at home is worth nothing to anybody.
   */
  speed: number;
  /**
   * **Unit slots** it can carry, not a head count. Also what it is worth in infamy to whoever
   * destroys it (§C3).
   *
   * One currency with the district's beds and with the deploy window's ceiling: a machine with
   * thirty takes thirty slots of anybody, so thirty Razors at one slot each, or fifteen Ironsides
   * at two, or twenty Haulers and five Ironsides. A unit that costs more slots than the machine
   * has left does not get on it.
   */
  capacity: number;
  /**
   * Built in somebody's yard out of what was to hand, and it shows when the shooting starts.
   *
   * Read by {@link wrecked} and by nothing else: at any given loss share the fragile machines are
   * written off before the sound ones, so a Rotorcraft and a Heli Porter on the same mauling lose
   * the Rotorcraft. It is the price of the Rotorcraft being the cheap way into the air, and its
   * description says so in the yard rather than leaving a player to find out.
   *
   * Optional the way `UnitSpec.taunts` is: most machines are not, and writing `fragile: false` on
   * six of seven rows buries the one that matters.
   */
  fragile?: boolean;
}

const SPECS: readonly VehicleSpec[] = [
  {
    id: 'motorcycle',
    name: 'The Scrappy',
    class: 'motorbike',
    description:
      'Two wheels, a rebuilt engine and no lights. Gets a pair across the district before anybody has finished deciding.',
    requiresGarageLevel: 1,
    cost: { scrap: 900, oil: 200 },
    buildSeconds: 30 * 60,
    speed: 65,
    capacity: 2,
  },
  {
    id: 'scrap_car',
    // The id stays `scrap_car`: it keys every stored fleet and every art asset, and renaming it is a
    // migration for a label change. What players read is this.
    name: 'The Scar',
    class: 'car',
    description:
      'Three donor bodies and one working engine. Everybody fits and nobody is comfortable.',
    requiresGarageLevel: 4,
    cost: { scrap: 2600, oil: 800, highQualityMetal: 180 },
    buildSeconds: 2 * 3600,
    speed: 55,
    capacity: 8,
  },
  {
    // The id stays `dirt_runner`, as `scrap_car` did for the Scar: it keys every stored fleet, the
    // art asset and the blueprint pages already in inventories. The machine behind it changed class
    // entirely: the board replaced the second bike with a reinforced pickup, so this is the bigger
    // car now, above the Scar on seats, speed, price and Garage level.
    id: 'dirt_runner',
    name: 'The Offie',
    class: 'car',
    description:
      'A pickup with plate welded over everything that mattered and a bull bar over what did not. A squad rides in the bed, and it gets there with all of them.',
    requiresGarageLevel: 5,
    cost: { scrap: 3300, oil: 1050, highQualityMetal: 300 },
    buildSeconds: 2 * 3600 + 30 * 60,
    speed: 58,
    capacity: 10,
  },
  {
    // The id stays `armoured_car` for the reason the two above give. The board replaced the plated
    // saloon with a school bus in plate: a truck by the numbers, slower than either car and the
    // only machine on the ground that moves most of a crew in one go.
    id: 'armoured_car',
    name: 'The Cheese Wagon',
    class: 'truck',
    description:
      'A school bus with plate riveted over every window and a plough where the bumper was. Thirty in the seats, and it has never once stopped for anybody.',
    requiresGarageLevel: 7,
    cost: { scrap: 6400, oil: 2400, highQualityMetal: 760 },
    buildSeconds: 4 * 3600 + 30 * 60,
    speed: 48,
    capacity: 30,
  },
  {
    id: 'gas_balloon',
    name: 'The Gas Balloon',
    class: 'flying',
    description:
      'Lifting gas nobody will say the source of, and a basket. Silent, and over the wall rather than through it.',
    requiresGarageLevel: 8,
    cost: { scrap: 6800, oil: 2600, highQualityMetal: 940 },
    buildSeconds: 5 * 3600,
    speed: 70,
    capacity: 10,
  },
  {
    id: 'rotorcraft',
    name: 'The Rotorcraft',
    class: 'flying',
    description:
      'Somebody built a helicopter in a yard out of two other helicopters. It flies, it is quick, and it comes apart on days the Heli Porter walks away from.',
    requiresGarageLevel: 9,
    cost: { scrap: 11000, oil: 4200, highQualityMetal: 2400 },
    buildSeconds: 8 * 3600,
    speed: 78,
    capacity: 18,
    // The cheap way into the air, and the only machine in the yard that is written off first. See
    // `VehicleSpec.fragile` and `wrecked`.
    fragile: true,
  },
  {
    // The board's strongest machine, and the top of the whole catalogue: nothing on the ground or
    // in the air is quicker, and only three legendaries and a pack of Cyberhounds keep up with it
    // on foot. Deliberately the last thing a Garage lets out and the dearest thing in it.
    id: 'heli_porter',
    name: 'The Heli Porter',
    class: 'flying',
    description:
      'A real transport helicopter, kept flying by people who understand it. Thirty in the cabin, over everything in the way, and it lands where it was told to.',
    requiresGarageLevel: 10,
    cost: { scrap: 15000, oil: 5800, highQualityMetal: 3400 },
    buildSeconds: 11 * 3600,
    speed: 95,
    capacity: 30,
  },
];

/**
 * A machine's name with its article taken off, for a sentence that supplies its own.
 *
 * Every machine is `The Something` since 2026-09-20 (maintainer: "make all the vehicle titles
 * start with THE"), and several lines in the game already put a word where the article goes: a
 * count on a receipt, `One more ...` on a stepper, `How many ...` on a field. Those read as
 * `2 The Scrappy` and `One more The Scrappy` unless the name gives its article up.
 *
 * One function rather than a `slice(4)` at each site, because the rule is about names and the next
 * name may not start with `The `. The repo has been here before: `units/unlocks.ts` records a
 * template that produced "hold a The Doghouse" and the same resolution.
 */
export function vehicleNoun(name: string): string {
  return name.startsWith('The ') ? name.slice(4) : name;
}

export const VEHICLES: readonly VehicleSpec[] = SPECS;

const BY_ID = new Map<string, VehicleSpec>(SPECS.map((spec) => [spec.id, spec]));

/**
 * Points off a machine's clock per Garage level (maintainer, 2026-09-18).
 *
 * Five, so a maxed Garage at its ceiling of ten halves the build. The same shape and roughly the
 * same top as the Generator's cut on structures (2.5 a level over twenty), which is deliberate: a
 * player who has learned what one deep structure is worth should not have to learn a second rule
 * for the yard.
 *
 * The Garage's own role line promises this in as many words, and until now it did not happen: a
 * vehicle's `buildSeconds` was a flat number and the yard's level changed nothing about it. The
 * Gauntlet's training cut deliberately does **not** reach here, which is the maintainer's rule:
 * machines are built, not trained, and the two clocks answer to different structures.
 */
export const GARAGE_TIME_DISCOUNT_PER_LEVEL = 5;

/**
 * How long this machine takes in a yard of this size, in seconds.
 *
 * One function, so the Garage screen quotes the figure the queue actually charges. Quoting the
 * catalogue while charging something else is the defect this game has already shipped once, on
 * the unit price box.
 */
export function vehicleBuildSeconds(spec: VehicleSpec, garageLevel: number): number {
  const off = Math.min(
    MAX_EFFECT_REDUCTION,
    Math.max(0, garageLevel) * GARAGE_TIME_DISCOUNT_PER_LEVEL,
  );
  return Math.max(1, Math.round(withReduction(spec.buildSeconds, off)));
}

export function findVehicle(id: string): VehicleSpec | undefined {
  return BY_ID.get(id);
}

/** The machines of one class, for the ladder tests. */
export function vehiclesOfClass(kind: VehicleClass): VehicleSpec[] {
  return SPECS.filter((spec) => spec.class === kind);
}

/** How many of each machine a crew has finished. Sparse: a zero is not stored. */
export const FleetSchema: z.ZodType<Partial<Record<VehicleId, number>>> = z.partialRecord(
  VehicleIdSchema,
  z.number().int().positive(),
);
export type Fleet = z.infer<typeof FleetSchema>;

/**
 * A stored fleet with the machines that no longer exist taken out of it.
 *
 * The same fault line `withoutRetiredUnits` covers for armies: `VehicleIdSchema` is a *key* schema
 * over the live catalogue, so a fleet naming a retired machine does not lose a field, it fails
 * `FleetSchema.parse` outright. On the server that is a row refusing to load, which is an account
 * that will not open and a world tick that throws when it reaches that base. Every reader of a
 * stored fleet runs this, and the migration that sweeps the rows is the tidy path rather than the
 * only defence: a backup restored from before it still opens.
 *
 * Only unknown keys are dropped. A negative count or a string where a number belongs is corruption
 * rather than history, and the schema still judges it exactly as it did.
 */
export function withoutRetiredVehicles(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(([id]) => findVehicle(id) !== undefined),
  );
}

/** However rich a crew gets, the yard holds this many of one kind. */
export const MAX_PER_VEHICLE = 12;

/** Machines in a fleet, of every kind. */
export function fleetSize(fleet: Fleet): number {
  return Object.values(fleet).reduce((total, count) => total + (count ?? 0), 0);
}

/** Unit slots a fleet could carry if every seat were filled. */
export function fleetCapacity(fleet: Fleet): number {
  let seats = 0;
  for (const [id, count] of Object.entries(fleet)) {
    seats += (findVehicle(id)?.capacity ?? 0) * (count ?? 0);
  }
  return seats;
}

/**
 * A machine's speed after whatever raises it, never past 100.
 *
 * Nothing raises one today: no location bonus, no perk and no refit pays into a vehicle. The cap is
 * written anyway because the rule is the same one units get (`time/speed.ts`, `effectiveSpeed`),
 * and the first channel that does pay into it should find the ceiling already here rather than
 * discover that the Heli Porter at 95 plus a flat +8 halves a road twice.
 */
export function effectiveVehicleSpeed(spec: VehicleSpec, bonusPercent = 0, flat = 0): number {
  return effectiveSpeed(spec.speed, { percent: bonusPercent, flat });
}

/**
 * One unit type's contribution to a column: how fast it walks, and whether it will get in.
 *
 * `columnSpeed` sits in `building/`, which is below `units/` in the import graph, so it cannot read
 * a sheet or a rule table for itself. The caller looks both up and hands them over; `units/` ships
 * {@link ColumnUnit} producers so no caller has to write the lookup twice.
 */
export interface ColumnUnit {
  /** 0..100, after the crew's `unitSpeedPercent` channel and any flat bonus. */
  speed: number;
  /** False for a sheet carrying the `no_ride` rule. The Colossus does not fit in anything. */
  rides: boolean;
  /**
   * What **one** of this unit takes off a machine's {@link VehicleSpec.capacity}.
   *
   * The unit's own unit slots, the same figure the district charges it a bed at, because a seat and
   * a bed are one currency now. Without it this function seated by head count while the deploy
   * window capped by unit slots, and a Cheese Wagon carried thirty Ironsides on the server and
   * fifteen on the screen.
   */
  unitSlots: number;
}

/** The units to be moved, by unit id. Sparse, and a zero is the same as absent. */
export type ColumnForce = Readonly<Record<string, number>>;

const ridingOrder = (fleet: Fleet): VehicleSpec[] =>
  [...Object.entries(fleet)]
    .flatMap(([id, count]) => {
      const spec = findVehicle(id);
      return spec ? Array.from({ length: count ?? 0 }, () => spec) : [];
    })
    .sort((a, b) => b.speed - a.speed);

/**
 * One machine loaded out of the queue of groups still on foot, mutating their `left`.
 *
 * `wanted` says whether anybody in the queue would have taken a seat on it at all, which is a
 * different question from whether anybody did: a Scrappy with two slots in front of a column of
 * Ironsides at three apiece carries nobody and is not what the column is waiting for, but the
 * Cheese Wagon behind it still has thirty slots for them. Only `wanted === false` ends the yard,
 * because the machines are in speed order and a slower one would be declined too.
 */
function fill(
  machine: VehicleSpec,
  boarding: { speed: number; unitSlots: number; left: number }[],
): { carried: number; wanted: boolean } {
  let seats = machine.capacity;
  let carried = 0;
  let wanted = false;
  for (const group of boarding) {
    // `boarding` is slowest first, so the first group this machine cannot outrun is also the last:
    // nobody behind it would be helped by a seat either.
    if (group.speed >= machine.speed) break;
    if (group.left === 0) continue;
    wanted = true;
    // Unit slots, not heads: a machine with four slots left takes four Razors or one Ironside. A
    // group too heavy for what is left is stepped over, because a lighter group behind it still
    // fits: thirty slots is twenty Haulers *and* three Ironsides.
    const aboard = Math.min(Math.floor(seats / group.unitSlots), group.left);
    if (aboard === 0) continue;
    group.left -= aboard;
    seats -= aboard * group.unitSlots;
    carried += aboard;
  }
  return { carried, wanted };
}

/**
 * What a column travels at (§C3): the speed of its **slowest group**.
 *
 * A column arrives when its last people do. That sentence has been at the top of this module since
 * the vehicles were rewritten and the arithmetic under it said something else: the old
 * `carriedSpeedPercent` averaged the machines' percentages weighted by the share of the force they
 * seated, so two bikes in front of forty walkers made all forty of them measurably faster. They do
 * not. They arrive first and wait.
 *
 * The column is a set of groups, each moving at one speed: every unit type still on foot at its own
 * effective speed, and every machine carrying anybody at that machine's speed. The answer is the
 * minimum over the groups that have somebody in them, and nothing else.
 *
 * Four loading rules follow from that, and every one of them is what a crew would actually do:
 *
 * - **Seats go to the slowest walkers first.** Putting the Cyberhounds in the truck and leaving the
 *   Ironsides on foot does nothing at all, because the Ironsides are still the answer. Seating the
 *   Ironsides is the only way a seat raises the column.
 * - **The fastest machines are filled first**, so a crew that owns a truck is never punished for it.
 * - **A seat is priced in unit slots**, the same currency the district houses a unit in
 *   ({@link ColumnUnit.unitSlots}). Thirty seats is thirty Razors, or ten Ironsides, or twenty
 *   Haulers and three Ironsides. A unit that costs more than a machine has left does not get on
 *   it, and a machine too small for the sheet in front of it is stepped over rather than ending
 *   the fill: the bus behind the bike can still take them.
 * - **Nobody boards a machine slower than their own legs.** A seat is an offer, not an order: two
 *   Cyberhounds on 90 handed a Scrappy on 65 do not climb on and lose twenty-five points of pace,
 *   they run alongside it. Without this the two rules above are not enough to keep the promise
 *   they make, because the fill is otherwise unconditional and an early bike could hold a column
 *   of fast sheets below its own speed.
 *
 * A unit whose sheet refuses to ride (`ColumnUnit.rides`) never takes a seat and drags the column
 * at its own pace whatever is in the yard. Seats past the size of the force are worth nothing,
 * because there is nobody to put in them, and an empty force has no speed at all.
 */

export function columnSpeed(
  fleet: Fleet,
  force: ColumnForce,
  effectiveSpeedOf: (unitId: string) => ColumnUnit,
): number {
  const groups = [...Object.entries(force)]
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([unitId, count]) => {
      const unit = effectiveSpeedOf(unitId);
      // Floored at one so a sheet that answers zero slots cannot divide a machine's seats into
      // infinitely many riders. Nobody rides for free.
      return { ...unit, unitSlots: Math.max(1, unit.unitSlots), left: count ?? 0 };
    });
  if (groups.length === 0) return 0;

  // Slowest first, and only the ones that will get in: those are the seats worth spending.
  const boarding = groups.filter((group) => group.rides).sort((a, b) => a.speed - b.speed);
  let slowest = Number.POSITIVE_INFINITY;
  for (const machine of ridingOrder(fleet)) {
    const { carried, wanted } = fill(machine, boarding);
    // Nobody left who would take a seat on this, either because everybody is aboard or because
    // everybody still walking is quicker than it. Machines are in speed order, so neither can come
    // back and the rest of the yard is worth nothing.
    if (!wanted) break;
    // Carried nobody but somebody wanted in: this machine is too small for what is in front of it
    // (a Scrappy at two slots and a queue of Ironsides at three). The bigger machine behind it can
    // still take them, so it is stepped over rather than ending the fill, and its own speed stays
    // out of the answer because the column is not waiting on an empty bike.
    if (carried === 0) continue;
    slowest = Math.min(slowest, machine.speed);
  }

  for (const group of groups) {
    if (group.left > 0) slowest = Math.min(slowest, group.speed);
  }
  return slowest;
}

/** One sheet's worth of riders: what each of them costs a machine, and how many are waiting. */
export interface RiderGroup {
  /** Unit slots per rider, the currency {@link VehicleSpec.capacity} is written in. */
  unitSlots: number;
  count: number;
}

/**
 * The machines a force can actually load.
 *
 * Trims what the player picked down to what there is somebody to sit in, fastest first, so a crew
 * that ticks the whole yard sends the machines that matter and leaves the rest at home rather than
 * marching an empty truck into a fight where it can be destroyed for free.
 *
 * The riders are groups rather than one total, and that is the whole of what this function got
 * wrong. It used to add capacities up and stop once the pool covered the unit slots going, which
 * is not how anybody gets into a vehicle: six motorcycles at two slots each are twelve slots of
 * pool and no seat at all for a Juggernaut at six, so all six were marched to the fight, carried
 * nobody, and were wrecked and paid out as infamy for it. A machine is taken here on the same
 * terms `columnSpeed` seats people on: it comes only if it can seat somebody who is still walking.
 *
 * A caller counts a `no_ride` sheet out first (`ridingGroups`): a Colossus cannot fill a seat and
 * must not keep a truck on the road.
 */
export function loadable(chosen: Fleet, riders: readonly RiderGroup[]): Fleet {
  // Heaviest sheet first, so a machine is offered the riders that are hardest to place before the
  // ones that fit anywhere. `fill` steps over a group too heavy for what is left, so nobody is
  // stranded by the order; what it decides is which machine each rider ends up on.
  const boarding = riders
    .filter((group) => group.count > 0 && group.unitSlots > 0)
    .map((group) => ({ speed: 0, unitSlots: group.unitSlots, left: group.count }))
    .sort((a, b) => b.unitSlots - a.unitSlots);

  const taken: Fleet = {};
  for (const spec of ridingOrder(chosen)) {
    // `fill` refuses a machine slower than the rider, and pace is not this question: what a column
    // does about a slow bike is `columnSpeed`'s answer. A speed of zero on every group turns that
    // rule off here without touching it there, since no machine in the catalogue is slower.
    const { carried, wanted } = fill(spec, boarding);
    if (!wanted) break;
    if (carried === 0) continue;
    taken[spec.id] = (taken[spec.id] ?? 0) + 1;
  }
  return taken;
}

/**
 * What the enemy earns for wrecking these (§C3): the sum of what they could carry.
 *
 * Capacity rather than price, because capacity is what the fight actually took off the board: a
 * Cheese Wagon is a bigger thing to have destroyed than a Scrappy whatever either cost to build.
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
 * `survivingShare` is measured in **unit slots**, the currency the seats are sold in, so a heavy
 * sheet lost off a column weighs what it took to carry rather than what it would weigh as one head.
 *
 * Rounded down on destruction, so a scratch is never a write-off: half a squad lost off two bikes
 * wrecks one bike, and losing one slot out of thirty in a bus wrecks nothing.
 *
 * Fragile machines go first at any share (`VehicleSpec.fragile`), which is the whole of what "less
 * reliable" buys the Rotorcraft's price: a crew flying a Rotorcraft and a Heli Porter into the same
 * mauling loses the Rotorcraft.
 */
export function wrecked(took: Fleet, survivingShare: number): Fleet {
  const lost = Math.min(1, Math.max(0, 1 - survivingShare));
  const destroyed: Fleet = {};
  const riding = ridingOrder(took).sort(
    (a, b) => Number(b.fragile ?? false) - Number(a.fragile ?? false),
  );

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

/**
 * Whether the crew holds the blueprint document that gates a machine, by vehicle id.
 *
 * Injected rather than read here for the reason in this module's header: pass
 * `(vehicleId) => blueprintGateMet(inventory, 'vehicle', vehicleId)`. A machine nothing gates
 * answers true, so the predicate is total and no caller has to special-case one.
 */
export type VehicleBlueprintGate = (vehicleId: string) => boolean;

/** Why the yard will not build this one, in the order a player wants to hear it, or null. */
export function vehicleRefusal(
  id: string,
  fleet: Fleet,
  garageLevel: number,
  blueprintUnlocked: VehicleBlueprintGate,
  affordable: (cost: PartialResources) => boolean,
): VehicleRefusal | null {
  const spec = findVehicle(id);
  if (!spec) return 'unknown_vehicle';
  if ((fleet[spec.id] ?? 0) >= MAX_PER_VEHICLE) return 'fleet_full';
  if (garageLevel < spec.requiresGarageLevel) return 'garage_too_low';
  if (!blueprintUnlocked(spec.id)) return 'needs_blueprint';
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
  blueprintUnlocked: VehicleBlueprintGate,
): Set<string> {
  return new Set(
    SPECS.filter(
      (spec) => garageLevel >= spec.requiresGarageLevel && blueprintUnlocked(spec.id),
    ).map((spec) => spec.id),
  );
}
