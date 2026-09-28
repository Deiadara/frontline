import {
  emptyDeployment,
  mergeFleets,
  type Army,
  type Base,
  type BattleDeployment,
  type BattleSide,
  type Fleet,
  type MovePlace,
  type ScheduledBattle,
  type SleeperCell,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { walkHome } from '../moves/moves.js';
import { forceSize, mergeArmies } from './forces.js';
import { defendingBaseOf, livingIn } from './ground.js';

/**
 * Who fights for whom, decided at the mark (maintainer, 2026-09-28).
 *
 * *"Whatever units are in the location of the fight, if they are the attackers' or from a player
 * that is in the same faction as the attackers they attack, if they're the defenders' or the
 * defenders' [faction] they defend, and if they're a neutral's they don't affect anything and don't
 * show up in spying, they're just there from a neutral, parked."*
 *
 * Before this the side a unit fought on was wherever it had been written: a deployment row's side,
 * and the defender's for everything else on the ground. So a crew that posted units on a friend's
 * plot and then called a fight on it met its own posting in the enemy line, an ally who had left
 * the faction since reinforcing still fought for it, and a faction-mate's Sleepers waiting on the
 * ground slept through a fight they were planted for.
 *
 * ## The place, per kind of fight
 *
 * - **A location**: the holder's garrison, every posting on it, every cell waiting on it, and the
 *   deployment rows (columns that arrived).
 * - **A gate**: the resident's gate garrison, any other crew living in the district's own gate
 *   garrison, and the rows.
 * - **A raid**: the resident's home army, any other crew living in the district's home army, and
 *   the rows.
 *
 * The holder's garrison and the resident's own army are the defender's by identity. The regime's
 * plots and the muster it turns out are keyed to nobody and are the defender's too.
 */

export type Alignment = BattleSide | null;

/**
 * Reads the side a crew's units are on in this fight, as the factions stand right now.
 *
 * The two principals by identity first, so a fight called on a faction-mate still has the two
 * crews it names on opposite sides. Everybody else by faction; a crew whose faction is on both
 * sides of an in-faction fight is on neither.
 */
export function alignmentReader(
  repos: Repositories,
  battle: ScheduledBattle,
): (ownerBaseId: string | null) => Alignment {
  return sidesReader(repos, battle.attackerBaseId, defendingBaseOf(repos, battle)?.id ?? null);
}

/**
 * The same rule for two named crews, fight or no fight: a spy is a crew asking what it would meet
 * if it called one on the holder (`spying/spying.ts`).
 */
export function sidesReader(
  repos: Repositories,
  attackerId: string,
  defenderId: string | null,
): (ownerBaseId: string | null) => Alignment {
  const factions = new Map<string, string | null>();
  const factionOf = (baseId: string): string | null => {
    if (!factions.has(baseId)) {
      const owner = repos.bases.findById(baseId)?.ownerId;
      factions.set(baseId, owner ? (repos.factions.membershipOf(owner)?.factionId ?? null) : null);
    }
    return factions.get(baseId) ?? null;
  };
  const attackerFaction = factionOf(attackerId);
  const defenderFaction = defenderId === null ? null : factionOf(defenderId);

  return (owner) => {
    // The Combine's and the looters' rows and plots: nobody's crew, always the ground's.
    if (owner === null) return 'defender';
    if (owner === attackerId) return 'attacker';
    if (owner === defenderId) return 'defender';
    const faction = factionOf(owner);
    if (faction === null) return null;
    const withAttacker = faction === attackerFaction;
    const withDefender = faction === defenderFaction;
    if (withAttacker === withDefender) return null;
    return withAttacker ? 'attacker' : 'defender';
  };
}

/**
 * Where a crew's units stand when they are at this fight, as a place a column can leave from.
 *
 * A location is itself. A gate or a raid on the crew's own district is its own gate or district;
 * on anybody else's it is the streets there, which is where a column walks home from.
 */
export function fightPlaceFor(battle: ScheduledBattle, base: Pick<Base, 'districtId'>): MovePlace {
  const { target } = battle;
  if (target.kind === 'location') return { kind: 'location', locationId: target.locationId };
  if (target.districtId !== base.districtId)
    return { kind: 'street', districtId: target.districtId };
  return target.kind === 'gate' ? { kind: 'gate' } : { kind: 'district' };
}

/** Everything at the place of a fight that is not simply on the side its row says. */
export interface Presence {
  /** Deployment rows whose owner is now on the other side of the fight, or on neither. */
  misaligned: { row: BattleDeployment; side: Alignment }[];
  /** Postings on the location, each with the side its crew is on. */
  postings: { baseId: string; army: Army; side: Alignment }[];
  /** Cells waiting on the location, each with the side its crew is on. */
  cells: { cell: SleeperCell; side: Alignment }[];
  /**
   * Other crews living in the district of a gate fight or a raid, with what stands at the place.
   * Only a database from before 2026-09-28 can have any: a plot holds one crew now, and this goes
   * with the bots (the TODO in `seed/index.ts`).
   */
  neighbours: { base: Base; army: Army; side: Alignment }[];
}

/**
 * Whether a cell was on the ground by the mark (bug pass, 2026-09-28).
 *
 * Off the walk it set out on, not `arrivesAt`: landing rewrites that to the moment the settle got
 * there, and cells land before fights in the same tick, so after a late tick or a restart a cell
 * due twenty minutes after the mark was woken into the fight it had not reached.
 */
function landedBy(cell: SleeperCell, mark: string): boolean {
  return Date.parse(cell.departedAt) + cell.travelMs <= Date.parse(mark);
}

/** Reads the place of a fight without changing it. The board draws this; the settle spends it. */
export function presenceAt(repos: Repositories, battle: ScheduledBattle): Presence {
  const sideOf = alignmentReader(repos, battle);
  const misaligned = repos.sieges
    .deployments(battle.id)
    .filter((row) => row.baseId !== null)
    .map((row) => ({ row, side: sideOf(row.baseId) }))
    .filter(({ row, side }) => side !== row.side);

  const { target } = battle;
  if (target.kind === 'location') {
    return {
      misaligned,
      postings: repos.alliedGarrisons
        .at(target.locationId)
        .map((posting) => ({ ...posting, side: sideOf(posting.baseId) })),
      cells: repos.sleepers
        .waitingOn(target.locationId)
        .filter((cell) => landedBy(cell, battle.scheduledFor))
        .map((cell) => ({ cell, side: sideOf(cell.baseId) })),
      neighbours: [],
    };
  }

  const defenderId = defendingBaseOf(repos, battle)?.id;
  const neighbours = livingIn(repos, target.districtId)
    .filter((base) => base.id !== defenderId)
    .flatMap((base) => {
      const army = target.kind === 'gate' ? (base.gateArmy ?? {}) : base.army;
      return forceSize(army) > 0 ? [{ base, army, side: sideOf(base.id) }] : [];
    });
  return { misaligned, postings: [], cells: [], neighbours };
}

/**
 * What stands at the place for `side` without a deployment row of its own: postings, cells and
 * neighbours. The holder's garrison and the resident's own army are not in it; `assemble` folds
 * those in by name.
 */
export function unrowedFor(presence: Presence, side: BattleSide): Army {
  const on = <T extends { side: Alignment }>(entries: readonly T[]) =>
    entries.filter((entry) => entry.side === side);
  return [
    ...on(presence.postings).map((posting) => posting.army),
    ...on(presence.cells).map(({ cell }) => cell.army),
    ...on(presence.neighbours).map((neighbour) => neighbour.army),
  ].reduce<Army>((all, army) => mergeArmies(all, army), {});
}

/** Adds units to one crew's own row on one side of a fight, creating the row if it has none. */
function joinSide(
  repos: Repositories,
  battle: ScheduledBattle,
  baseId: string,
  side: BattleSide,
  force: { army: Army; perimeter?: Army; vehicles?: Fleet },
): void {
  const row =
    repos.sieges.deployment(battle.id, side, baseId) ??
    emptyDeployment(battle.id, baseId, side, battle.scheduledFor);
  repos.sieges.putDeployment({
    ...row,
    army: mergeArmies(row.army, force.army),
    perimeter: mergeArmies(row.perimeter, force.perimeter ?? {}),
    vehicles: mergeFleets(row.vehicles, force.vehicles ?? {}),
  });
}

/**
 * Puts everything at the place of a fight on the side its owner is on, at the mark.
 *
 * Run by the settle before the lines are drawn, inside the fight's own transaction. Afterwards the
 * deployment rows hold every crew that fights, on the side it fights for, and the rest of the
 * settle needs no rule of its own about who is whose:
 *
 * - A row on the wrong side moves to the right one, army and machines. Its ring goes with it to a
 *   defence and walks home from an attack, since only a defender posts a ring. Its officer, trap
 *   and boosts stay behind: they were named for the other side.
 * - A row whose crew is on neither side is taken off the fight and walks home, machines and all.
 * - A posting whose crew now attacks leaves the posting and joins that crew's attacking row.
 *   Postings on the defending side are already in the line (`assemble`), and a neutral's stay
 *   where they are.
 * - A cell whose crew is on a side wakes into that crew's row, the way the declarer's own cell
 *   does at the declaration. A neutral's keeps sleeping.
 * - A neighbour on a side turns out its gate garrison or home army into its own row. That is the
 *   legacy case of two crews on one plot, from before 2026-09-28; it leaves with the bots.
 *
 * Returns whether a cell of the declarer's own woke here, which the `planted` feat counts as
 * surely as one woken at the declaration.
 */
export function musterAtTheMark(
  repos: Repositories,
  battle: ScheduledBattle,
  presence: Presence,
  now: Date,
): { declarerCellWoke: boolean } {
  for (const { row, side } of presence.misaligned) {
    if (row.baseId === null) continue;
    const owner = repos.bases.findById(row.baseId);
    repos.sieges.removeDeployment(battle.id, row.side, row.baseId);
    if (!owner) continue;
    const place = fightPlaceFor(battle, owner);
    if (side === null) {
      walkHome(repos, owner, place, mergeArmies(row.army, row.perimeter), row.vehicles, now);
      continue;
    }
    const keepsRing = side === 'defender';
    joinSide(repos, battle, owner.id, side, {
      army: row.army,
      perimeter: keepsRing ? row.perimeter : {},
      vehicles: row.vehicles,
    });
    if (!keepsRing) walkHome(repos, owner, place, row.perimeter, {}, now);
  }

  const { target } = battle;
  if (target.kind === 'location') {
    for (const posting of presence.postings) {
      if (posting.side !== 'attacker') continue;
      repos.alliedGarrisons.set(target.locationId, posting.baseId, {});
      joinSide(repos, battle, posting.baseId, 'attacker', { army: posting.army });
    }
  }

  let declarerCellWoke = false;
  for (const { cell, side } of presence.cells) {
    if (side === null) continue;
    repos.sleepers.remove(cell.id);
    joinSide(repos, battle, cell.baseId, side, { army: cell.army });
    if (cell.baseId === battle.attackerBaseId) declarerCellWoke = true;
  }

  for (const { base, army, side } of presence.neighbours) {
    if (side === null) continue;
    if (target.kind === 'gate') repos.bases.updateGateArmy(base.id, {});
    else repos.bases.updateArmy(base.id, {}, base.trainingQueue);
    joinSide(repos, battle, base.id, side, { army });
  }
  return { declarerCellWoke };
}
