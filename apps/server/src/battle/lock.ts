import type { Base, MovePlace, ScheduledBattle } from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';

/**
 * What a fight called on a place does to the ground before it lands (maintainer, 2026-09-27 and
 * 2026-09-28).
 *
 * In the last hour nothing leaves the place of a fight: not a location's garrison or a posting on
 * it, not the gate garrison before a gate fight, not the district army before a raid, and not a
 * column already standing in the fight's own deployment. A defender who could empty a plot a
 * second before the mark handed the attacker bare ground and lost nothing, and one who could pull
 * the line off and put it back played the clock rather than the fight. Arrivals are the other way
 * round and are welcome to the last second: whatever is standing there at the mark fights, on the
 * side its owner is on (`battle/alignment.ts`).
 *
 * And ground with a fight called on it cannot be claimed by a third crew until it is over: the
 * fight was called against whoever held it then, and a crew walking in would fight a battle it was
 * never told about, with no way to deploy, set a trap or name a leader.
 */
export const GARRISON_LOCK_MS = 60 * 60 * 1000;

/** Whether a fight still to come is called on this location. */
export function fightCalledOn(repos: Repositories, locationId: string): boolean {
  return repos.sieges
    .pending()
    .some((battle) => battle.target.kind === 'location' && battle.target.locationId === locationId);
}

/** Whether this fight's last hour has begun. A mark already passed and not yet run counts. */
export function insideLock(battle: Pick<ScheduledBattle, 'scheduledFor'>, now: Date): boolean {
  return Date.parse(battle.scheduledFor) - now.getTime() <= GARRISON_LOCK_MS;
}

/** Whether units on this location are held there by a fight inside its last hour. */
export function garrisonLocked(repos: Repositories, locationId: string, now: Date): boolean {
  return repos.sieges
    .pending()
    .some(
      (battle) =>
        battle.target.kind === 'location' &&
        battle.target.locationId === locationId &&
        insideLock(battle, now),
    );
}

/**
 * Whether this crew's units at `place` are held there by a fight inside its last hour.
 *
 * The gate and the district are this crew's own, so the fights that hold them are a call on its
 * own gate and a raid through its own breach. `exceptBattleId` is the fight the units are going
 * *to*: turning the home army out onto the ring of the raid it is about to meet is not leaving
 * the place of that fight.
 */
export function placeLocked(
  repos: Repositories,
  base: Pick<Base, 'districtId'>,
  place: MovePlace,
  now: Date,
  exceptBattleId?: string,
): boolean {
  if (place.kind === 'location') return garrisonLocked(repos, place.locationId, now);
  if (place.kind === 'street') return false;
  const kind = place.kind === 'gate' ? 'gate' : 'district';
  return repos.sieges
    .pending()
    .some(
      (battle) =>
        battle.id !== exceptBattleId &&
        battle.target.kind === kind &&
        battle.target.districtId === base.districtId &&
        insideLock(battle, now),
    );
}
