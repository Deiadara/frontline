import { randomUUID } from 'node:crypto';
import { tallyUnitsMustered, tallyVehicleBuilt } from '../feats/tally.js';
import {
  findVehicle,
  EVERY_LOCATION,
  MAX_MUSTER_QUEUE,
  VEHICLES,
  buildingLevel,
  vehicleBuildSeconds,
  vehicleBatchSeconds,
  clampLevel,
  homeMusterBonus,
  musterSuppliesReduction,
  chairPassiveOf,
  musterTimeReduction,
  addToArmy,
  alreadyHolds,
  blueprintGateMet,
  canAfford,
  findUnit,
  heldPlaceKindsOf,
  doorsOn,
  baseBonusesOf,
  isHeldBy,
  isUnitUnlocked,
  LEGENDARY_CAP,
  spendResources,
  splitDueMuster,
  musterCancellable,
  musterCost,
  musterRefund,
  resequencedMuster,
  musterSecondsFor,
  musterStartsAt,
  xpForClock,
  type Army,
  type Base,
  type PartialResources,
  type LocationKind,
  type PlayerXpAward,
  type MusterOrder,
  type UnitSpec,
  type UnitTier,
  type UnlockContext,
  type Fleet,
  type VehicleSpec,
} from '@frontline/shared';
import { adminCost, adminSeconds, adminWaives } from '../admin/mode.js';
import { standingEffectsFor } from '../crew/standing.js';
import type { Repositories } from '../db/repos/index.js';
import { creditBase, refuseWaste } from '../district/stores.js';
import { awardPlayerXp } from '../progression/award.js';
import { districtUnitSlots, unitsAbroad } from '../district/unit-slots.js';
import { mergeArmies } from '../battle/forces.js';
import { garrisonedUnits } from './roster.js';

/**
 * Making units (GDD §A5).
 *
 * The same lazy contract as everything else: orders carry an absolute clock frozen at order time,
 * and whatever has come due is applied the next time the crew is read.
 */

/*
 * `unknown_unit` is not on this list. `queueMuster` is handed a `UnitSpec`, so by the time it runs
 * the unit exists; the route resolves the id and 404s on its own before it gets here. A refusal
 * nothing returns is a sentence a player can never be shown and a waiver nobody can classify.
 */
export const MUSTER_REFUSALS = [
  'locked',
  'queue_full',
  'already_have_one',
  // As many as the ground allows (`UnitSpec.capPerHold`): the Death Cloaks' fifty a Mausoleum.
  'at_the_cap',
  'no_unit_slots',
  'cannot_afford',
] as const;
export type MusterRefusal = (typeof MUSTER_REFUSALS)[number];

export type MusterResult =
  { kind: 'refused'; reason: MusterRefusal } | { kind: 'queued'; base: Base; order: MusterOrder };

/**
 * §B6: the machines the Garage could turn out today, by id.
 *
 * "Can build", not "has built": the Road Reavers' gate is that the yard *makes* motorcycles, so a
 * crew that sends its last bike out on a mission does not lose the ability to muster them. Read off
 * the vehicle catalogue's own two unlock clauses, its Garage level and its blueprint document
 * (§D12c), and deliberately not off its price: being short of scrap this afternoon is not a
 * campaign gate.
 */
export function buildableVehiclesFor(base: Base): Set<string> {
  const garage = buildingLevel(base.buildings, 'garage');
  return new Set(
    VEHICLES.filter(
      (spec) =>
        garage >= spec.requiresGarageLevel && blueprintGateMet(base.inventory, 'vehicle', spec.id),
    ).map((spec) => spec.id),
  );
}

/** What this crew's territory does to unlocks: the place kinds it currently holds. */
export function unlockContextFor(repos: Repositories, base: Base): UnlockContext {
  const controls = repos.city.controls();
  const held = (locationId: string): boolean => {
    const control = controls.get(locationId);
    return control !== undefined && isHeldBy(control, base.id);
  };
  return {
    buildings: base.buildings,
    heldPlaceKinds: heldPlaceKindsOf(EVERY_LOCATION, held),
    // The doors authored on the ground itself (Arca, 2026-10-07): the Shrine the Saint
    // answers to is one location, not a kind of place.
    heldDoors: new Set(
      EVERY_LOCATION.filter((location) => held(location.id)).flatMap((location) =>
        doorsOn(baseBonusesOf(location)),
      ),
    ),
    buildableVehicles: buildableVehiclesFor(base),
    // §D12a: thirteen units are behind a blueprint document, and the document lives in the inventory.
    inventory: base.inventory,
    // §D7: the heaviest sheets will not muster for a nobody.
    notoriety: base.economy.notoriety,
  };
}

/**
 * §A4: the best level this crew holds, per location kind.
 *
 * The input to `homeMusterBonus`, and the reason it is a map of *kinds* rather than of locations:
 * two Doghouses are one Doghouse as far as the Cyberhounds are concerned, and the one that counts
 * is the better of them. A kind nobody in this crew holds is simply absent, which is what makes
 * "somebody else's level does nothing for you" fall out rather than need saying.
 */
export function heldLocationLevels(
  repos: Repositories,
  base: Base,
): ReadonlyMap<LocationKind, number> {
  const controls = repos.city.controls();
  const levels = new Map<LocationKind, number>();
  for (const location of EVERY_LOCATION) {
    const control = controls.get(location.id);
    if (!control || !isHeldBy(control, base.id)) continue;
    const level = clampLevel(control.level);
    if (level > (levels.get(location.kind) ?? 0)) levels.set(location.kind, level);
  }
  return levels;
}

/**
 * Everything this district takes off a muster bill and a muster clock.
 *
 * Folded once, here, so the roster's quoted price, `Max`, and the route's charge are by
 * construction the same numbers. The Greenhouse's is deliberately kept apart from the general
 * discount all the way down to `musterCost`, because §B5 says it lands on the supplies line and
 * on nothing else.
 *
 * `locationLevels` rides along rather than being folded in, because what it is worth depends on
 * *which unit* is being priced: see `ratesForUnit`. Everything else here is true of every unit on
 * the roster at once.
 */
export function musterRatesFor(
  repos: Repositories,
  base: Base,
  /**
   * The instant to price at. Defaults to now, which is every caller but a test.
   *
   * Threaded rather than left to the wall clock (2026-09-17). `standingEffectsFor` takes one
   * because §A4's raid disruption expires, and this dropped it: `projectUnits(repos, base, now)`
   * was handed an instant, priced the roster off `new Date()` instead, and so could disagree with
   * every other figure on the same response about whether a raid was still biting. In production
   * the two are the same millisecond and nothing shows; in a test with a fixed clock it is the
   * difference between a rate of 11 and a rate of 8.25, and the disagreement only appears once
   * real time has walked past the fixture's disruption window.
   */
  now: Date = new Date(),
): MusterRates {
  const effects = standingEffectsFor(repos, base, now);
  return {
    costPercent: effects.musterCostPercent,
    // The Hiring Hall (maintainer, 2026-10-06): off the rabble's price only, applied per unit.
    costPercentByTier: effects.musterCostByTier,
    // §B5: the Greenhouse, and the modifications that grow with it.
    suppliesPercent: musterSuppliesReduction(base.buildings),
    veteranPercent: chairPassiveOf(effects, 'veteran', 'muster_cost'),
    // §B6: the Gauntlet takes time off every unit on the roster, the ones it cannot muster included.
    speedPercent: effects.musterSpeedPercent + musterTimeReduction(base.buildings),
    locationLevels: heldLocationLevels(repos, base),
  };
}

/**
 * The same rates as one unit sees them: the crew-wide ones plus whatever its own home adds.
 *
 * Pure, and takes the rates rather than the repositories, so the roster can price forty units off
 * one walk of the control table instead of forty.
 */
export function ratesForUnit(rates: MusterRates, unit: UnitSpec): MusterRates {
  const home = homeMusterBonus(unit, rates.locationLevels);
  return {
    ...rates,
    costPercent: rates.costPercent + home.costPercent + (rates.costPercentByTier[unit.tier] ?? 0),
    speedPercent: rates.speedPercent + home.speedPercent,
  };
}

export interface MusterRates {
  costPercent: number;
  /** Off one tier's price only (the Hiring Hall's rabble). Read only through {@link ratesForUnit}. */
  costPercentByTier: Partial<Record<UnitTier, number>>;
  suppliesPercent: number;
  /** The Veteran's passive, off every line after the other cuts (2026-10-04). */
  veteranPercent: number;
  speedPercent: number;
  /** §A4: the best level held per location kind. Read only through {@link ratesForUnit}. */
  locationLevels: ReadonlyMap<LocationKind, number>;
}

export interface MusterSettlement {
  base: Base;
  /** §I1: one award per batch that landed. Empty on a read that finished nothing. */
  awards: PlayerXpAward[];
  /**
   * Orders that handed over their **last** unit on this read.
   *
   * Not the same thing as `delivered`: a batch trickles out one unit at a time, so a receipt per
   * unit would ring every forty-five seconds for an order of ten. `unit_mustered` says "a batch has
   * finished mustering", and this is the set that has.
   */
  finished: MusterOrder[];
}

/**
 * Units that have finished mustering join the army at home.
 *
 * §I1 pays per *unit*, at a rate priced off what that unit takes to muster.
 *
 * The two halves answer each other. Per unit, because a batch hands its units over one at a time
 * and paying on whichever read caught the last one would make the reward depend on how often the
 * page was open. Priced off the unit's own clock, because per-unit at a flat rate is what would
 * make the cheapest rabble the fastest way to level: a Razor is 45 seconds and a Colossus is an
 * hour and a half, and the curve is what stops the faucet without going back to per-order.
 */
export function settleMuster(repos: Repositories, base: Base, now: Date): MusterSettlement {
  const { delivered, pending } = splitDueMuster(base.musterQueue, now);
  if (delivered.length === 0) return { base, awards: [], finished: [] };

  // An order only leaves the queue when it has handed over its last unit, so what is missing from
  // `pending` is exactly what finished on this read.
  const stillWaiting = new Set(pending.map((order) => order.id));
  const finished = base.musterQueue.filter((order) => !stillWaiting.has(order.id));

  /*
   * A finished batch goes to the roster or to the yard, depending on what it was.
   *
   * One bench builds both (maintainer request, 2026-09-15), so the delivery has to branch here:
   * a unit is a count in `army` and a machine is a count in `fleet`, and they are stored in
   * different columns. `findVehicle` is the discriminator rather than a flag on the order, because
   * the id already says which catalogue it came from and a second field could disagree with it.
   */
  /*
   * Narrowed through the catalogue rather than by a cast.
   *
   * `MusterOrder.unitId` is a union of the two id enums, and `Fleet` is keyed by the vehicle one
   * alone, so indexing it with the union does not typecheck. `findVehicle` returns the spec, whose
   * `id` **is** a `VehicleId`, which is the honest narrowing: the catalogue is what decides which
   * kind an id is, and this way a machine and its count travel together.
   */
  const machines = delivered.flatMap((batch) => {
    const spec = findVehicle(batch.unitId);
    return spec === undefined ? [] : [{ id: spec.id, count: batch.count }];
  });
  const recruits = delivered.filter((batch) => findVehicle(batch.unitId) === undefined);

  const army: Army = recruits.reduce(
    (into, batch) => addToArmy(into, batch.unitId, batch.count),
    base.army,
  );
  const fleet: Fleet = machines.reduce(
    (into, machine) => ({ ...into, [machine.id]: (into[machine.id] ?? 0) + machine.count }),
    base.fleet,
  );
  const settled: Base = { ...base, army, fleet, musterQueue: pending };
  repos.bases.updateArmy(settled.id, settled.army, settled.musterQueue);
  if (machines.length > 0) {
    repos.bases.updateFleet(settled.id, fleet);
    // Feats: machines built, counted here now that the yard is not what grants them. `fleet` is a
    // current count and a machine lost in a fight takes one off it, so the lifetime figure cannot
    // be read off the yard.
    for (const machine of machines) tallyVehicleBuilt(repos, settled.id, machine.count);
  }

  // Feats: per unit, for the same reason the XP below is per unit. A read that happens to catch
  // the last unit of a batch must not be worth more than the read before it.
  tallyUnitsMustered(repos, settled.id, recruits);

  /*
   * §I1 pays per *unit*, not per order.
   *
   * A batch hands its units over one at a time now, so paying an order's worth of XP on whichever
   * read happened to catch the last one would make the reward depend on how often the page was
   * open. One award per unit delivered is the same total whatever the polling does.
   */
  let carried = settled;
  const awards: PlayerXpAward[] = [];
  for (const batch of recruits) {
    // Priced off what one of *this* unit takes on the bench, on the shared curve: a Razor is
    // 45 seconds and a Colossus is an hour and a half, and a flat table entry paid the same for
    // both. The catalogue's figure rather than the order's frozen one, deliberately: a workshop
    // discount should make the batch arrive sooner, not be worth less to have mustered.
    const perUnit = xpForClock('unitMustered', findUnit(batch.unitId)?.musterSeconds ?? 0);
    for (let i = 0; i < batch.count; i += 1) {
      // At the settle's instant, as every award is (bug pass, 2026-10-06).
      const { base: progressed, award } = awardPlayerXp(
        repos,
        carried,
        'unitMustered',
        0,
        perUnit,
        now,
      );
      carried = progressed;
      awards.push(award);
    }
  }
  return { base: carried, awards, finished };
}

export interface MusterInput {
  base: Base;
  unit: UnitSpec;
  count: number;
  now: Date;
  /**
   * Testing mode: five seconds on the bench, no materials, and the progress and capacity gates on
   * `WAIVED_REFUSALS` let through (`admin/mode.ts`), the unit-slot cap (`no_unit_slots`) among
   * them. A second unique unit is still refused: that is a save that cannot be parsed, not a door.
   */
  admin?: boolean;
}

/**
 * Puts a batch on the bench.
 *
 * Unit slots are claimed at **order** time, counting the queue as well as the standing army: a crew
 * cannot queue five Colossi against a cap that holds one and discover the problem an hour later.
 */
/**
 * Calling a batch off (§A5), inside its window.
 *
 * The refund is read off the order rather than recomputed, and the order is removed rather than
 * marked: a bench with a hole in it would break `musterStartsAt`, which reads the tail of the
 * queue to decide when the next order begins.
 */
export type CancelRefusal = 'unknown_order' | 'window_closed';

export type CancelResult =
  | { kind: 'refused'; reason: CancelRefusal }
  | { kind: 'cancelled'; base: Base; refund: PartialResources };

export function cancelMuster(
  repos: Repositories,
  base: Base,
  orderId: string,
  now: Date,
  acceptWaste?: boolean,
): CancelResult {
  const order = base.musterQueue.find((entry) => entry.id === orderId);
  if (!order) return { kind: 'refused', reason: 'unknown_order' };
  if (!musterCancellable(order, now)) return { kind: 'refused', reason: 'window_closed' };

  const refund = musterRefund(order);
  // Back into the stores as far as they have room, warned about first (maintainer ruling,
  // 2026-09-28).
  const credit = creditBase(repos, base, refund, now);
  refuseWaste(credit, acceptWaste);
  // Closed up, not merely shortened. Every order's clock is absolute and was frozen at the
  // completion time of the order in front of it, so taking one out of the middle left the ones
  // behind it waiting out a batch that no longer exists.
  const left = resequencedMuster(
    base.musterQueue.filter((entry) => entry.id !== orderId),
    now,
  );
  const cancelled: Base = {
    ...base,
    resources: credit.resources,
    musterQueue: left,
  };
  repos.bases.updateResources(cancelled.id, cancelled.resources);
  repos.bases.updateArmy(cancelled.id, cancelled.army, cancelled.musterQueue);
  return { kind: 'cancelled', base: cancelled, refund };
}

/** The shared bench with no room for another order: the units' and the Garage's both. */
export const BENCH_FULL_MESSAGE = 'The bench is full';

/**
 * Put a machine on the same bench the units are built on (maintainer request, 2026-09-15).
 *
 * A vehicle used to land in the yard the instant it was paid for: the only thing in the game with
 * a price and no clock, and the reason every vehicle spec's `buildSeconds` was dead data. It goes
 * through the queue now, so a machine is something you wait for and can watch, the way a Razor is.
 *
 * Its own function rather than a branch inside `queueMuster`, because almost none of that
 * function's gates apply to a machine: there is no unlock ladder, no unique-unit rule, and its
 * price comes off the Garage's discount rather than the Gauntlet's rates. What the two share is
 * the bench, and the bench is exactly the queue and the clock below.
 *
 * The beds are shared as well since 2026-09-15, but the comparison is not here: a machine costs
 * one bed and `garage/routes.ts` asks for it in `blockerFor`, so the page's greyed button and this
 * door quote the same sentence. `unitSlotDraw` charges the order from the moment it is written,
 * which is what stops a crew ordering one machine at a time into a district with one bed left.
 *
 * The queue's length cap **is** shared, deliberately: it is a cap on the bench, and a bench that
 * held five orders of units and another seven of machines would not be one bench.
 */
export function queueVehicle(
  repos: Repositories,
  input: {
    base: Base;
    vehicle: VehicleSpec;
    /** Already discounted by the Garage, so a refund is against the price paid. The whole batch. */
    cost: PartialResources;
    /** How many, as one order: the bench delivers them one at a time like a batch of Razors. */
    count: number;
    now: Date;
    admin?: boolean;
  },
): { kind: 'queued'; base: Base; order: MusterOrder } | { kind: 'refused'; reason: string } {
  const { base, vehicle, cost, count, now, admin = false } = input;

  if (base.musterQueue.length >= MAX_MUSTER_QUEUE && !adminWaives('queue_full', admin)) {
    return { kind: 'refused', reason: BENCH_FULL_MESSAGE };
  }

  const charged = adminCost(cost, admin);
  const order: MusterOrder = {
    id: randomUUID(),
    unitId: vehicle.id,
    count,
    delivered: 0,
    // Behind whatever is already on the bench, which is what makes it one bench rather than a
    // second queue that happens to be drawn in the same list.
    startedAt: musterStartsAt(base.musterQueue, now).toISOString(),
    // §B6: the yard's own level takes time off the build (`vehicleBuildSeconds`), and the batch
    // rule the units follow takes more off every machine after the first. The Gauntlet's muster
    // cut deliberately does not reach a machine: it is built, not mustered.
    durationSeconds: adminSeconds(
      vehicleBatchSeconds(
        vehicleBuildSeconds(vehicle, buildingLevel(base.buildings, 'garage')),
        count,
      ),
      admin,
    ),
    paid: charged,
  };

  const queued: Base = {
    ...base,
    resources: spendResources(base.resources, charged),
    musterQueue: [...base.musterQueue, order],
  };
  repos.bases.updateResources(queued.id, queued.resources);
  repos.bases.updateArmy(queued.id, queued.army, queued.musterQueue);
  return { kind: 'queued', base: queued, order };
}

/**
 * How many more of a legendary this crew may hold: none once it has one anywhere.
 *
 * Everywhere the crew has people, not only at home (bug pass, 2026-09-27): a legendary standing on
 * a location, at the gate or out on a job was invisible to the muster door, so a second could be
 * mustered and the first brought home beside it. The Console's unit grant asks the same question
 * (bug pass, 2026-09-29), so there is one answer to it.
 */
export function legendaryRoom(repos: Repositories, base: Base, unit: UnitSpec): number {
  return Math.max(
    0,
    LEGENDARY_CAP - alreadyHolds(unit, everywhereArmy(repos, base), base.musterQueue),
  );
}

/** Everybody the crew has, wherever they stand: home, on held ground, abroad and at the gate. */
function everywhereArmy(repos: Repositories, base: Base): Army {
  return mergeArmies(
    mergeArmies(base.army, garrisonedUnits(repos, base)),
    mergeArmies(unitsAbroad(repos, base), base.gateArmy ?? {}),
  );
}

/**
 * How many more of a unit capped on held ground the crew may raise, or null for a unit with no
 * such cap (`UnitSpec.capPerHold`, 2026-10-06).
 *
 * Counted everywhere the crew has people, like `legendaryRoom`, and against every held location of
 * the kind: a Death Cloak congregation is fifty a tomb, wherever it is standing.
 */
export function heldCapRoom(repos: Repositories, base: Base, unit: UnitSpec): number | null {
  const cap = unit.capPerHold;
  if (cap === undefined) return null;
  const controls = repos.city.controls();
  const held = EVERY_LOCATION.filter((location) => {
    const control = controls.get(location.id);
    return (
      location.kind === cap.locationKind && control !== undefined && isHeldBy(control, base.id)
    );
  }).length;
  return Math.max(
    0,
    cap.each * held - alreadyHolds(unit, everywhereArmy(repos, base), base.musterQueue),
  );
}

export function queueMuster(repos: Repositories, input: MusterInput): MusterResult {
  const { base, unit, count, now, admin = false } = input;

  // Every gate below is stated as the rule and then filtered through `adminWaives`, so the rules
  // read the same in both modes and what the testing build actually waives is one list in
  // `admin/mode.ts` rather than an `if` on each line. `already_have_one` is not on it: a second
  // unique unit is a district that cannot be parsed, not a door.
  const refuse = (reason: MusterRefusal): MusterResult | null =>
    adminWaives(reason, admin) ? null : { kind: 'refused', reason };

  if (!isUnitUnlocked(unit, unlockContextFor(repos, base))) {
    const refused = refuse('locked');
    if (refused) return refused;
  }
  if (base.musterQueue.length >= MAX_MUSTER_QUEUE) {
    const refused = refuse('queue_full');
    if (refused) return refused;
  }
  if (unit.unique && count > legendaryRoom(repos, base, unit)) {
    return { kind: 'refused', reason: 'already_have_one' };
  }
  const room = heldCapRoom(repos, base, unit);
  if (room !== null && count > room) {
    const refused = refuse('at_the_cap');
    if (refused) return refused;
  }

  // §A4: the unit's own rates, so a worked Doghouse actually shows up on the Cyberhounds' bill.
  const rates = ratesForUnit(musterRatesFor(repos, base, now), unit);
  // §A1: soldiers come out of the district's unit slots, alongside the officers and the placed
  // assignees. `districtUnitSlots` has already counted everything standing, garrisons and the
  // muster bench included, so what this order needs is only what it adds on top.
  const slots = districtUnitSlots(repos, base);
  if (unit.unitSlots * count > slots.spare) {
    const refused = refuse('no_unit_slots');
    if (refused) return refused;
  }

  const cost = musterCost(
    unit,
    count,
    rates.costPercent,
    rates.suppliesPercent,
    rates.veteranPercent,
  );
  if (!canAfford(base.resources, cost)) {
    const refused = refuse('cannot_afford');
    if (refused) return refused;
  }

  const charged = adminCost(cost, admin);
  const order: MusterOrder = {
    id: randomUUID(),
    unitId: unit.id,
    count,
    delivered: 0,
    startedAt: musterStartsAt(base.musterQueue, now).toISOString(),
    durationSeconds: adminSeconds(musterSecondsFor(unit, count, rates.speedPercent), admin),
    // What was actually taken, so a refund is against the price paid rather than the price today.
    // A discount finished after the order was placed must not turn cancelling into a profit.
    paid: charged,
  };

  const queued: Base = {
    ...base,
    resources: spendResources(base.resources, charged),
    musterQueue: [...base.musterQueue, order],
  };
  repos.bases.updateResources(queued.id, queued.resources);
  repos.bases.updateArmy(queued.id, queued.army, queued.musterQueue);

  return { kind: 'queued', base: queued, order };
}
