import { MIN_ATTACK_UNIT_SLOTS, unitSlotsUsed, type ScheduledBattle } from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { notifyBase } from '../social/notify.js';
import { mergeArmies } from './forces.js';
import { GARRISON_LOCK_MS } from './lock.js';
import { callOff } from './resolve.js';
import { targetName } from './ground.js';
import { settleEach } from '../world/guard.js';

/**
 * What the attacking side has put into a fight, in unit slots: every row standing on it and every
 * column on the road that gets there by the mark, line and ring, allies included.
 *
 * A column landing after the mark does not count (bug pass, 2026-10-06): `sendColumn` lets one go
 * and `settleMovements` never puts it in the fight, so twenty slots sent too late kept a two-slot
 * attack alive past the lock.
 */
export function attackingSlots(repos: Repositories, battle: ScheduledBattle): number {
  const standing = repos.sieges
    .side(battle.id, 'attacker')
    .reduce((sum, row) => sum + unitSlotsUsed(mergeArmies(row.army, row.perimeter)), 0);
  const marching = repos.movements
    .forBattle(battle.id)
    .filter(
      (column) =>
        column.side === 'attacker' &&
        Date.parse(column.arrivesAt) <= Date.parse(battle.scheduledFor),
    )
    .reduce((sum, column) => sum + unitSlotsUsed(mergeArmies(column.army, column.perimeter)), 0);
  return standing + marching;
}

/**
 * Calls off every fight that reached its lock with the attacking side under
 * `MIN_ATTACK_UNIT_SLOTS` (maintainer, 2026-10-05). Runs on the world tick before the battles, so
 * a fight the server slept through is judged the same way as one it watched.
 *
 * Judged once, at the lock, and never again (maintainer, 2026-10-06). The check used to run on
 * every tick for the whole last hour, so a column sent just before the lock could be turned round
 * in its first tenth after it, while the defender's line was frozen, and void a fight that had
 * passed, refunding every bet on it. A fight is marked judged in the same transaction as the call
 * it gets, so nothing that happens after the lock is looked at.
 *
 * `callOff` sends every column and row home whole and closes the fight with no winner, which is
 * what refunds every Stackhouse bet on it. The infamy paid to call it stays spent.
 */
export function callOffUnderstrength(repos: Repositories, now: Date): number {
  let called = 0;
  // One fight at a time (bug pass, 2026-10-06): a bare loop let one fight that throws abort the
  // stage, and every later fight under strength was then fought at its mark instead.
  settleEach(
    repos,
    'under-strength calls',
    repos.sieges.awaitingStrengthCheck(new Date(now.getTime() + GARRISON_LOCK_MS).toISOString()),
    (battle) => battle.id,
    (battle) => {
      repos.sieges.markStrengthJudged(battle.id);
      const slots = attackingSlots(repos, battle);
      if (slots >= MIN_ATTACK_UNIT_SLOTS) return;
      const crews = new Set(
        repos.sieges.deployments(battle.id).flatMap((row) => (row.baseId ? [row.baseId] : [])),
      );
      crews.add(battle.attackerBaseId);
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
      called += 1;
    },
  );
  return called;
}
