import type { Base, BattleTarget, MovePlace } from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { walkHome } from '../moves/moves.js';
import { reportTickFailure, settleEach } from '../world/guard.js';
import { fightPlaceFor } from './alignment.js';
import { mergeArmies } from './forces.js';
import { turnRound } from './movement.js';

const STAGE = 'unreadable fights';

/**
 * Drops every fight still to run that this build cannot read, and every deployment row it cannot
 * read on one (maintainer, 2026-10-06). Answers how many it dropped.
 *
 * The reads already skipped such a fight with a warning, so the rest of the world ran, but the
 * fight stayed pending for ever with its units held: every cleanup path read it through the same
 * parser that refused it (bug pass item 20). A deployment row that would not parse was worse, since
 * it threw out of every read of its fight and the fight was retried and refused on every tick.
 *
 * Each one is reported through the tick's failure sink, so the log says what was dropped and why,
 * and then dropped: the fight is closed with no winner, which refunds every bet on it, its columns
 * turn round, and every row that still reads walks home from the place of the fight with what it
 * brought. A row that does not read is deleted, since nothing can say what was in it.
 */
export function dropUnreadableFights(repos: Repositories, now: Date): number {
  const { fights, deployments } = repos.sieges.unreadable();
  for (const row of deployments) {
    reportTickFailure({
      stage: STAGE,
      item: `deployment on ${row.battleId} (${row.side}, ${row.baseId ?? 'no crew'})`,
      error: row.error,
    });
    repos.sieges.dropDeployment(row.battleId, row.side, row.baseId);
  }
  const closed = settleEach(
    repos,
    STAGE,
    fights,
    (fight) => fight.id,
    (fight) => {
      reportTickFailure({ stage: STAGE, item: fight.id, error: fight.error });
      repos.sieges.abandon(fight.id, now.toISOString());
      for (const movement of repos.movements.forBattle(fight.id)) turnRound(repos, movement, now);
      for (const row of repos.sieges.deployments(fight.id)) {
        const owner = row.baseId === null ? undefined : repos.bases.findById(row.baseId);
        if (!owner) continue;
        const force = mergeArmies(row.army, row.perimeter);
        walkHome(repos, owner, placeOf(fight.target, owner), force, row.vehicles, now);
      }
    },
  );
  return closed + deployments.length;
}

/** Where a crew's units at this fight stand, or home when not even the target reads. */
function placeOf(target: BattleTarget | null, owner: Base): MovePlace {
  return target === null ? { kind: 'district' } : fightPlaceFor({ target }, owner);
}
