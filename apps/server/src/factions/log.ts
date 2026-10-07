import { randomUUID } from 'node:crypto';
import {
  armySize,
  displayNameOf,
  type Army,
  type Base,
  type BattleSide,
  type ScheduledBattle,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { defendingBaseOf, residentOf, targetName } from '../battle/ground.js';

/**
 * The faction room's log, written when things happen (maintainer, 2026-10-06).
 *
 * The room used to build its fight lines off the open fights and stamp them with the mark, so a
 * call made this morning sat at the top dated tomorrow and was gone once the fight was over. These
 * two writes keep the moment instead.
 */

/** A fight called: a line in the caller's faction, and in the faction of a crew it was called on. */
export function logFightCalled(
  repos: Repositories,
  battle: ScheduledBattle,
  caller: Base,
  now: Date,
): void {
  const where = targetName(battle.target, residentOf(repos, battle.target.districtId));
  const write = (base: Base | undefined, side: BattleSide): void => {
    if (!base) return;
    const seat = repos.factions.membershipOf(base.ownerId);
    const user = repos.users.findById(base.ownerId);
    if (!seat || !user) return;
    repos.factions.logEvent(seat.factionId, {
      id: randomUUID(),
      kind: 'fight',
      at: now.toISOString(),
      userId: base.ownerId,
      name: displayNameOf(user),
      targetName: where,
      side,
      units: 0,
    });
  };
  write(caller, 'attacker');
  write(defendingBaseOf(repos, battle), 'defender');
}

/** Help sent into a mate's fight: a line in the sender's faction. */
export function logHelpSent(
  repos: Repositories,
  input: { battle: ScheduledBattle; sender: Base; side: BattleSide; army: Army; now: Date },
): void {
  const seat = repos.factions.membershipOf(input.sender.ownerId);
  const user = repos.users.findById(input.sender.ownerId);
  if (!seat || !user) return;
  repos.factions.logEvent(seat.factionId, {
    id: randomUUID(),
    kind: 'help',
    at: input.now.toISOString(),
    userId: input.sender.ownerId,
    name: displayNameOf(user),
    targetName: targetName(input.battle.target, residentOf(repos, input.battle.target.districtId)),
    side: input.side,
    units: armySize(input.army),
  });
}
