/**
 * What must hold after every scene, whatever the players did.
 *
 * Read straight off the repositories rather than through the API: the point is to catch a state
 * the API would happily serve, so the check must not depend on the API's own projection of it.
 */
import {
  RESOURCE_KEYS,
  playerXpToNextLevel,
  storageCapacity,
  storageCapacityFor,
  type Army,
  type Base,
} from '@frontline/shared';
import { crewEffectsFor } from '../src/crew/standing.js';
import type { Harness, Player } from './playthrough-harness.js';
import type { Cast } from './playthrough-cast.js';

/** Last scene's figures, so an overflow can be told apart from a store that was already over. */
const lastSeen = new Map<string, Record<string, number>>();

export function checkInvariants(h: Harness, cast: Cast): void {
  for (const player of cast.players.values()) {
    const base = h.repos.bases.findById(player.baseId);
    if (!base) continue;
    checkBase(h, player, base);
  }
}

function checkBase(h: Harness, player: Player, base: Base): void {
  const who = `${player.label} (${player.username})`;
  const counted: [string, number | undefined][] = [
    ...RESOURCE_KEYS.map((key): [string, number] => [`resource ${key}`, base.resources[key]]),
    ...Object.entries(base.army).map(([id, n]): [string, number | undefined] => [`army ${id}`, n]),
    ...Object.entries(base.gateArmy ?? {}).map(([id, n]): [string, number | undefined] => [
      `gate army ${id}`,
      n,
    ]),
    ...Object.entries(base.fleet).map(([id, n]): [string, number | undefined] => [
      `fleet ${id}`,
      n,
    ]),
    ...Object.entries(base.inventory).map(([id, n]): [string, number | undefined] => [
      `item ${id}`,
      n,
    ]),
    ['infamy', base.economy.infamy],
    ['notoriety', base.economy.notoriety],
    ['level', base.level],
    ['xp into level', base.progression.xpIntoLevel],
  ];
  for (const [what, n] of counted) {
    h.check(
      n !== undefined && Number.isInteger(n) && n >= 0,
      `${who}: ${what} is ${String(n)}, which is not a whole non-negative number`,
    );
  }

  // Storage: nothing may raise a store over its ceiling (maintainer ruling, 2026-09-28). Loot,
  // pay, trades, refunds and feats all land through `district/stores.ts`. A store the scene found
  // already over (the harness's own fixtures) may stay there, but may not grow.
  const bulk = storageCapacity(
    base.buildings,
    crewEffectsFor(h.repos, base, h.now()).storageCapacityPercent,
  );
  const previous = lastSeen.get(base.id) ?? {};
  for (const key of RESOURCE_KEYS) {
    const ceiling = storageCapacityFor(base.buildings, key, bulk);
    const held = base.resources[key];
    const grew = held > (previous[key] ?? Number.POSITIVE_INFINITY);
    if (held > ceiling && grew) {
      h.check(false, `${who}: ${key} rose to ${held}, over its storage ceiling of ${ceiling}`);
    }
  }
  lastSeen.set(base.id, { ...base.resources });

  // Level and experience agree: what is carried into a level is always short of the next one.
  const needed = playerXpToNextLevel(base.level);
  h.check(
    base.progression.xpIntoLevel < needed,
    `${who}: ${base.progression.xpIntoLevel} XP carried into level ${base.level}, which needs only ${needed}`,
  );

  // A chair holds one officer, and nobody is on the books twice.
  const ids = base.commanders.map((officer) => officer.id);
  h.check(new Set(ids).size === ids.length, `${who}: an officer is on the books twice`);
  const seated = base.commanders.flatMap((officer) => (officer.role ? [officer.role] : []));
  h.check(new Set(seated).size === seated.length, `${who}: two officers sit in one chair`);

  // The bench never delivers more than it was ordered.
  for (const order of base.trainingQueue) {
    h.check(
      order.delivered >= 0 && order.delivered <= order.count,
      `${who}: training order ${order.id} delivered ${order.delivered} of ${order.count}`,
    );
  }

  // A crew out on a run is not also at home: the run's force left the roster when it went, so a
  // resolved run must not still be counted as out, and an active one must have somebody in it.
  for (const stored of h.repos.missions.listActiveByBaseId(base.id)) {
    const size = Object.values(stored.mission.force).reduce((sum, n) => sum + (n ?? 0), 0);
    h.check(size > 0, `${who}: active mission ${stored.mission.id} has nobody in it`);
  }
}

/**
 * Every unit a crew owns, wherever it is: home, the gate, out on a run, on a fight's ground, on the
 * road to one, garrisoned, planted as sleepers, or walking between the crew's own places.
 *
 * Summed per unit id. An action that only moves people (launching or recalling a run, deploying,
 * garrisoning, moving) must leave this unchanged: a unit that is both home and out shows up here
 * as a count that grew.
 */
export function unitLedger(h: Harness, baseId: string): Army {
  const base = h.repos.bases.findById(baseId);
  const total: Record<string, number> = {};
  const add = (army: Army | undefined): void => {
    for (const [id, n] of Object.entries(army ?? {})) total[id] = (total[id] ?? 0) + (n ?? 0);
  };
  if (!base) return total;
  add(base.army);
  add(base.gateArmy);
  for (const stored of h.repos.missions.listActiveByBaseId(baseId)) add(stored.mission.force);
  for (const row of h.repos.sieges.deploymentsFor(baseId)) {
    const battle = h.repos.sieges.find(row.battleId);
    if (battle && battle.resolvedAt === null) {
      add(row.army);
      add(row.perimeter);
    }
  }
  for (const movement of h.repos.movements.forBase(baseId)) {
    add(movement.army);
    add(movement.perimeter);
  }
  for (const control of h.repos.city.controls().values()) {
    if (control.holder.kind === 'crew' && control.holder.baseId === baseId) add(control.garrison);
  }
  for (const cell of h.repos.sleepers.forBase(baseId)) add(cell.army);
  for (const move of h.repos.moves.activeFor(baseId)) add(move.army);
  for (const posted of h.repos.alliedGarrisons.forBase(baseId)) add(posted.army);
  return total;
}

/** The difference between two ledgers, as `unit: before -> after` for every unit that moved. */
export function ledgerDrift(before: Army, after: Army): string[] {
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  const drift: string[] = [];
  for (const id of ids) {
    const was = before[id] ?? 0;
    const now = after[id] ?? 0;
    if (was !== now) drift.push(`${id}: ${was} -> ${now}`);
  }
  return drift;
}
