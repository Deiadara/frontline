import {
  emptyDeployment,
  type Army,
  type BattleDeployment,
  type BattleSide,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { mergeArmies, removeForce } from './forces.js';

/**
 * A side of a fight, which is no longer one crew.
 *
 * Before factions, `battle_deployments` held one row per side and every consumer read it directly.
 * An ally reinforcing your battle is a second contributor: their units leave their army, their
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
 * The names are the **principal's**: a boost is bought for a fight and a side gets as many as the
 * principal's own `battleBoostsFlat` allows (`battle/boosts.ts`), so reinforcements bringing their
 * own would multiply an effect the design gives out a fixed number of times. `/battles/boost` is
 * where that is enforced, and it is enforced by naming the principal. This end merely folds every
 * row's list together, distinctly, so an ally who burned the same name the principal already did
 * adds nothing.
 *
 * It does **not** re-apply the cap, which is why the door has to be right: for a while the door
 * read the principal off `battle.defender`, which is `unoccupied` on every lived-in district, and
 * an ally's name landed here and stacked. A row written under that reading still stacks, because
 * nothing goes back and unburns a name somebody paid for.
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
      // Every name on the side, in the order they were burned, with no duplicates: an ally who
      // burns the same name the principal already did adds nothing to the fight.
      boostIds: [...new Set([...total.boostIds, ...row.boostIds])],
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
 * The engine answers for the side as a whole: so many of each unit survived. Those units belong to
 * different people, and handing them all back to the declarer would quietly transfer an ally's army
 * to whoever called the fight.
 *
 * Generic over the row rather than tied to `BattleDeployment`, because the same apportionment
 * answers the same question for the regime: a district's defence is drawn off several control rows
 * and its survivors have to go back to the plots that sent them (`resolve.ts`, `spendGarrisons`).
 * All this needs of a row is a key and, through `pick`, what that key put in.
 *
 * Distribution is **largest remainder** per unit id, proportional to what each crew committed. The
 * naive `floor(share)` loses units to rounding on every unit type with more than one contributor,
 * and over a long war those losses land entirely on the smaller contributor. Largest remainder
 * hands back exactly the number that survived, every time, which is the property
 * `factions.test.ts` pins.
 */
export function splitSurvivors<Row extends { baseId: string | null }>(
  rows: readonly Row[],
  survived: Army,
  pick: (row: Row) => Army,
): Map<string | null, Army> {
  const out = new Map<string | null, Army>(rows.map((row) => [row.baseId, {}]));

  for (const [unitId, total] of Object.entries(survived)) {
    if (total <= 0) continue;
    const sent = rows.map((row) => ({ baseId: row.baseId, count: pick(row)[unitId] ?? 0 }));
    const committed = sent.reduce((sum, entry) => sum + entry.count, 0);
    if (committed === 0) continue;

    // Whole units first, then the remainders decide who gets the odd one, biggest share first.
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

/**
 * A whole number split by weight, largest remainder first: {@link splitSurvivors} on one count.
 *
 * For a side's figures that are not units, such as the kills the feats credit crew by crew. The same
 * rounding as the survivors, so the shares always add back up to `total` and the odd one goes to
 * the heaviest remainder rather than always to the first row.
 */
export function apportion(
  total: number,
  weights: ReadonlyMap<string | null, number>,
): Map<string | null, number> {
  const rows = [...weights].map(([baseId, weight]) => ({ baseId, weight }));
  const shares = splitSurvivors(rows, { share: total }, (row) => ({ share: row.weight }));
  return new Map(rows.map(({ baseId }) => [baseId, shares.get(baseId)?.share ?? 0]));
}

/**
 * What each crew put into one side's line, keyed by crew, with `null` for the regime or the looters.
 *
 * The principal (the crew that called the fight, or the one defending) is credited with everything
 * on the side that no ally sent, which is the reading the defending side's survivor split takes in
 * `battle/resolve.ts`: a home roster, a location's garrison and the Combine's plots have no row of
 * their own. Each ally is credited with its own contributions: its deployment row and, on the
 * defence, its posting on the ground.
 */
export function lineByCrew(side: {
  principal: string | null;
  whole: Army;
  allies: readonly { baseId: string | null; army: Army }[];
}): Map<string | null, Army> {
  const lines = new Map<string | null, Army>();
  for (const ally of side.allies) {
    if (ally.baseId === side.principal) continue;
    lines.set(ally.baseId, mergeArmies(lines.get(ally.baseId) ?? {}, ally.army));
  }
  const sent = [...lines.values()].reduce<Army>((total, army) => mergeArmies(total, army), {});
  lines.set(side.principal, removeForce(side.whole, sent));
  return lines;
}
