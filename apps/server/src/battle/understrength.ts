import { MIN_ATTACK_UNIT_SLOTS, unitSlotsUsed, type ScheduledBattle } from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { notifyBase } from '../social/notify.js';
import { mergeArmies } from './forces.js';
import { insideLock } from './lock.js';
import { callOff } from './resolve.js';
import { targetName } from './ground.js';

/**
 * What the attacking side has put into a fight, in unit slots: every row standing on it and every
 * column still on the road to it, line and ring, allies included.
 */
export function attackingSlots(repos: Repositories, battle: ScheduledBattle): number {
  const standing = repos.sieges
    .side(battle.id, 'attacker')
    .reduce((sum, row) => sum + unitSlotsUsed(mergeArmies(row.army, row.perimeter)), 0);
  const marching = repos.movements
    .forBattle(battle.id)
    .filter((column) => column.side === 'attacker')
    .reduce((sum, column) => sum + unitSlotsUsed(mergeArmies(column.army, column.perimeter)), 0);
  return standing + marching;
}

/**
 * Calls off every fight that reached its lock with the attacking side under
 * `MIN_ATTACK_UNIT_SLOTS` (maintainer, 2026-10-05). Runs on the world tick before the battles, so
 * a fight the server slept through is judged the same way as one it watched.
 *
 * `callOff` sends every column and row home whole and closes the fight with no winner, which is
 * what refunds every Stackhouse bet on it. The infamy paid to call it stays spent.
 */
export function callOffUnderstrength(repos: Repositories, now: Date): number {
  let called = 0;
  for (const battle of repos.sieges.pending()) {
    if (!insideLock(battle, now)) continue;
    const slots = attackingSlots(repos, battle);
    if (slots >= MIN_ATTACK_UNIT_SLOTS) continue;
    const crews = new Set(
      repos.sieges.deployments(battle.id).flatMap((row) => (row.baseId ? [row.baseId] : [])),
    );
    crews.add(battle.attackerBaseId);
    repos.tx(() => {
      callOff(repos, battle, now);
      for (const baseId of crews) {
        notifyBase(repos, baseId, {
          kind: 'battle_report',
          title: 'A fight was called off',
          body: `The attack on ${targetName(battle.target)} had ${slots} unit slots committed at the lock, under the ${MIN_ATTACK_UNIT_SLOTS} a fight needs. Everybody walks home.`,
          link: '/game/battles',
          subjectId: battle.id,
          at: now,
        });
      }
    });
    called += 1;
  }
  return called;
}
