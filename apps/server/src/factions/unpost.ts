import type { BattleSide } from '@frontline/shared';
import { fightPlaceFor } from '../battle/alignment.js';
import { mergeArmies } from '../battle/forces.js';
import { defendingBaseOf } from '../battle/ground.js';
import { turnRound } from '../battle/movement.js';
import type { Repositories } from '../db/repos/index.js';
import { walkHome } from '../moves/moves.js';

/**
 * Walks posted units home when the alliance that put them there ends (bug pass, 2026-09-27;
 * maintainer, 2026-09-28).
 *
 * A crew can post units on an ally's ground (`moves/moves.ts`). Leaving, being removed or the
 * faction disbanding only ever touched the membership rows, so the units stayed where they were:
 * still defending the former ally's ground (and fighting their own crew if it attacked it),
 * unreachable from the move dialog, which only lists allied ground, and still drawing on the
 * owner's unit slots. They leave the moment the tie is cut.
 *
 * They **walk** (maintainer, 2026-09-28: "Nothing sends units immediately, you need to move
 * them"). They used to be back on the roster in the same instant, which made leaving a faction a
 * way to bring an army home from across the city in no time. The walk is an ordinary move home
 * from the location, and it is not held by a fight's last hour (`battle/lock.ts`): the lock keeps a
 * side's units on the ground, and these are nobody's side there any more, so a posting left
 * standing would only be parked (`battle/alignment.ts`).
 *
 * The same goes for the fights (maintainer, 2026-10-06): every row a crew has standing on a side
 * another crew leads, and every column it has on the road to one, leaves the moment the tie is cut
 * and walks home, even inside the fight's last hour. `sideOf` already refused such a crew a
 * withdrawal, so its units were stuck until the mark walked them home (bug pass item 21). A crew's
 * own call and its own defence are its own and stay.
 *
 * `leaving` are the users whose tie ends; `staying` are the ones it ends with. For a disband the
 * two are the same list, which works because a crew never posts on its own ground and never
 * reinforces its own fight.
 */
export function bringPostedUnitsHome(
  repos: Repositories,
  leaving: readonly string[],
  staying: readonly string[],
  now: Date = new Date(),
): void {
  const baseOf = (userId: string) => repos.bases.findByOwnerId(userId);
  const leavingBases = new Set(leaving.flatMap((id) => baseOf(id)?.id ?? []));
  const stayingBases = new Set(staying.flatMap((id) => baseOf(id)?.id ?? []));

  const recall = (from: ReadonlySet<string>, on: ReadonlySet<string>) => {
    for (const baseId of from) {
      for (const posting of repos.alliedGarrisons.forBase(baseId)) {
        const holder = repos.city.control(posting.locationId)?.holder;
        const heldBy = holder?.kind === 'crew' ? holder.baseId : null;
        if (heldBy === null || !on.has(heldBy) || heldBy === baseId) continue;
        const owner = repos.bases.findById(baseId);
        if (!owner) continue;
        repos.alliedGarrisons.set(posting.locationId, baseId, {});
        walkHome(
          repos,
          owner,
          { kind: 'location', locationId: posting.locationId },
          posting.army,
          {},
          now,
        );
      }
    }
  };
  recall(leavingBases, stayingBases);
  recall(stayingBases, leavingBases);
  recallFromFights(repos, leavingBases, stayingBases, now);
  recallFromFights(repos, stayingBases, leavingBases, now);
}

/** Every row and column of a crew in `from` on a fight whose side is led by a crew in `on`. */
function recallFromFights(
  repos: Repositories,
  from: ReadonlySet<string>,
  on: ReadonlySet<string>,
  now: Date,
): void {
  for (const battle of repos.sieges.pending()) {
    const leaders: Record<BattleSide, string | null> = {
      attacker: battle.attackerBaseId,
      defender: defendingBaseOf(repos, battle)?.id ?? null,
    };
    const helping = (baseId: string, side: BattleSide): boolean => {
      const leader = leaders[side];
      return from.has(baseId) && leader !== null && leader !== baseId && on.has(leader);
    };
    for (const row of repos.sieges.deployments(battle.id)) {
      if (row.baseId === null || !helping(row.baseId, row.side)) continue;
      const owner = repos.bases.findById(row.baseId);
      if (!owner) continue;
      repos.sieges.removeDeployment(battle.id, row.side, row.baseId);
      const force = mergeArmies(row.army, row.perimeter);
      walkHome(repos, owner, fightPlaceFor(battle, owner), force, row.vehicles, now);
    }
    for (const column of repos.movements.forBattle(battle.id)) {
      if (helping(column.baseId, column.side)) turnRound(repos, column, now);
    }
  }
}
