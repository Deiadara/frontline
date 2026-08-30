import {
  emptyDeployment,
  type Army,
  type BattleDeployment,
  type BattleSide,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { mergeArmies } from './forces.js';

/**
 * A side of a fight, which is no longer one crew.
 *
 * Before factions, `battle_deployments` held one row per side and every consumer read it directly.
 * An ally reinforcing your battle is a second contributor: their bodies leave their army, their
 * survivors go back to *them*, and they get their own report. So a side is now a list of rows, and
 * there are exactly two questions anybody asks about it:
 *
 *   * **What is standing on this ground?** The engine, the perimeter and every screen that draws
 *     the enemy want the whole side folded into one force. That is {@link combinedSide}.
 *   * **What did *this crew* send?** Withdrawing, arriving reinforcements and "what have I
 *     committed" want one contributor's own row, which the repo's `deployment` still answers.
 *
 * Keeping the fold in one place is what stops the two questions being confused at a call site: a
 * consumer that asked for "the deployment" and silently got only the declarer's would have shown a
 * player a smaller enemy than the one they were about to meet.
 */

/**
 * Everything one side has on the ground, as a single deployment.
 *
 * The boost is the **declarer's**, not the sum: a boost is bought for a fight and a side gets one
 * (`battle/boosts.ts`), so reinforcements bringing their own would multiply an effect the design
 * gives out once. The route refuses a boost from anybody but the declarer; this is the read side of
 * the same rule, and it takes the first row that has one so the two cannot disagree.
 */
export function combinedSide(
  rows: readonly BattleDeployment[],
  battleId: string,
  side: BattleSide,
  at: string,
): BattleDeployment {
  const first = rows[0];
  if (!first) return emptyDeployment(battleId, null, side, at);
  return rows.slice(1).reduce<BattleDeployment>(
    (total, row) => ({
      ...total,
      army: mergeArmies(total.army, row.army),
      perimeter: mergeArmies(total.perimeter, row.perimeter),
      boostId: total.boostId ?? row.boostId,
    }),
    { ...first },
  );
}

/** The whole of one side, read and folded. */
export function sideForce(
  repos: Repositories,
  battleId: string,
  side: BattleSide,
  at: string,
): BattleDeployment {
  return combinedSide(repos.sieges.side(battleId, side), battleId, side, at);
}

/**
 * Splits a side's outcome back to the crews that paid for it.
 *
 * The engine answers for the side as a whole: so many of each unit survived. Those bodies belong to
 * different people, and handing them all back to the declarer would quietly transfer an ally's army
 * to whoever called the fight.
 *
 * Distribution is **largest remainder** per unit id, proportional to what each crew committed. The
 * naive `floor(share)` loses bodies to rounding on every unit type with more than one contributor,
 * and over a long war those losses land entirely on the smaller contributor. Largest remainder
 * hands back exactly the number that survived, every time, which is the property
 * `factions.test.ts` pins.
 */
export function splitSurvivors(
  rows: readonly BattleDeployment[],
  survived: Army,
  pick: (row: BattleDeployment) => Army,
): Map<string | null, Army> {
  const out = new Map<string | null, Army>(rows.map((row) => [row.baseId, {}]));

  for (const [unitId, total] of Object.entries(survived)) {
    if (total <= 0) continue;
    const sent = rows.map((row) => ({ baseId: row.baseId, count: pick(row)[unitId] ?? 0 }));
    const committed = sent.reduce((sum, entry) => sum + entry.count, 0);
    if (committed === 0) continue;

    // Whole bodies first, then the remainders decide who gets the odd one, biggest share first.
    const shares = sent.map((entry) => {
      const exact = (entry.count * total) / committed;
      const whole = Math.floor(exact);
      return { baseId: entry.baseId, whole, remainder: exact - whole };
    });
    let left = total - shares.reduce((sum, share) => sum + share.whole, 0);
    for (const share of [...shares].sort((a, b) => b.remainder - a.remainder)) {
      if (left <= 0) break;
      share.whole += 1;
      left -= 1;
    }
    for (const share of shares) {
      if (share.whole <= 0) continue;
      const army = out.get(share.baseId) ?? {};
      army[unitId] = (army[unitId] ?? 0) + share.whole;
      out.set(share.baseId, army);
    }
  }
  return out;
}
