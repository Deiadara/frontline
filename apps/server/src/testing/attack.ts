import { MIN_ATTACK_UNIT_SLOTS, emptyDeployment, type Army } from '@frontline/shared';
import { mergeArmies } from '../battle/forces.js';
import type { Repositories } from '../db/repos/index.js';

/**
 * Puts the attacking side's least commitment on a fight a test inserted straight into the table.
 *
 * A fight is called off at the lock unless the attacking side has `MIN_ATTACK_UNIT_SLOTS` committed
 * (maintainer, 2026-10-05). A test that writes a `scheduled_battles` row by hand and then lets the
 * world tick or a route's settle reach its last hour would see the fight vanish, which is the rule
 * working, not the thing the test is about. This adds a real deployment row for the caller, the
 * same row `/battles/deploy` writes, so the fight stands for the reason a real one would.
 */
export function armTheAttack(
  repos: Repositories,
  battleId: string,
  attackerBaseId: string,
  army: Army = { razors: MIN_ATTACK_UNIT_SLOTS },
): void {
  const battle = repos.sieges.find(battleId);
  if (!battle) throw new Error(`armTheAttack: no fight ${battleId}`);
  const row =
    repos.sieges.deployment(battleId, 'attacker', attackerBaseId) ??
    emptyDeployment(battleId, attackerBaseId, 'attacker', new Date().toISOString());
  repos.sieges.putDeployment({ ...row, army: mergeArmies(row.army, army) });
}
