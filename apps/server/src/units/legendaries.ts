import { LEGENDARY_CAP, capLegendaries, findUnit, type Army } from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { settleEach } from '../world/guard.js';

/**
 * One of each legendary and no more, across every roster already on disk (maintainer,
 * 2026-09-19).
 *
 * "Add a general rule in the game that you can have up to 1 of each legendary unit, no more, and
 * remove any excess that the console / admin version currently gives you."
 *
 * The rule itself was never missing from the door a player uses: `musterUnits` has refused a
 * second unique since uniques existed, and `maxMusterable` has offered at most one. What was
 * missing was everywhere else. `applyUnlockedSandbox` wrote `fullArmy()`, which was a dozen of
 * every id in the catalogue, so a console build handed out twelve of all seven legendaries; and
 * any account that had been raised that way kept them for good, because nothing walks a stored
 * army looking for a cap it might be over.
 *
 * `fullArmy` is capped at the source now, which fixes tomorrow. This fixes yesterday: a boot
 * sweep, in the shape of `backfillPortraits` next door, because the fault is in rows that are
 * already written and the alternative is a SQL migration that would have to know which unit ids
 * are unique, which is a fact about the TypeScript catalogue and not about the schema.
 *
 * Idempotent, so a second boot trims nothing and reports zero. It touches only rosters that are
 * actually over, so on every normal world it is one read of the summaries and no writes at all.
 */
export interface LegendaryTrim {
  /** How many rosters were over the cap on at least one sheet. */
  crews: number;
  /** ...and how many individual legendaries were struck off, across all of them. */
  removed: number;
}

/** What one roster is holding over the cap, as a count of bodies. */
function excessIn(army: Army): number {
  let over = 0;
  for (const [unitId, count] of Object.entries(army)) {
    if (findUnit(unitId)?.unique !== true) continue;
    over += Math.max(0, (count ?? 0) - LEGENDARY_CAP);
  }
  return over;
}

export function trimLegendaries(repos: Repositories): LegendaryTrim {
  const trim: LegendaryTrim = { crews: 0, removed: 0 };
  // Guarded per crew, like the face backfill beside it at boot (bug pass, 2026-10-06).
  settleEach(
    repos,
    'boot: legendary cap',
    repos.bases.listSummaries(),
    (summary) => summary.id,
    (summary) => {
      const base = repos.bases.findById(summary.id);
      if (!base) return;
      const over = excessIn(base.army);
      if (over === 0) return;
      /*
       * The queue is left exactly as it is.
       *
       * A batch on the bench is already bounded by the door that accepted it, and a muster order
       * is a thing the crew paid for: taking one off here would be refunding nothing and deleting
       * a purchase. The roster is the only place an ungated grant could have landed.
       */
      repos.bases.updateArmy(base.id, capLegendaries(base.army), base.musterQueue);
      trim.crews += 1;
      trim.removed += over;
    },
  );
  return trim;
}
