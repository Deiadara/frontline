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
 * `leaving` are the users whose tie ends; `staying` are the ones it ends with. For a disband the
 * two are the same list, which works because a crew never posts on its own ground.
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
}
