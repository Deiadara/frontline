import {
  BUILD_BOOST_MS,
  BUILD_BOOST_PERCENT,
  boostedQueue,
  buildBoostActive,
  buildBoostOilCost,
  canAfford,
  spendResources,
  type Base,
  type BuildBoostRefusal,
  type PartialResources,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';

/**
 * Buying the Generator's two-hour burn (§B4).
 *
 * One write, and it does three things at once because they have to happen together: it takes the
 * oil, it stamps the district's `buildBoostUntil`, and it re-times everything already in the build
 * queue. The third is the part that would be easy to leave out and is exactly what the board asked
 * for: "the boost applies to work already in the queue as well as work queued during it".
 *
 * Buying a second burn while one runs is **refused**, not stacked and not extended. The refusal is
 * a rule about arithmetic rather than a balance decision: `boostedQueue` shortens what is left of
 * each order, so running it twice would take a quarter off a quarter and a player who bought two
 * hours twice would get a bigger discount than one who bought four.
 */

export type BoostResult =
  | { kind: 'refused'; reason: BuildBoostRefusal }
  | { kind: 'lit'; base: Base; paid: PartialResources };

export function buyBuildBoost(
  repos: Repositories,
  base: Base,
  now: Date,
  admin = false,
): BoostResult {
  const oil = buildBoostOilCost(base.buildings);
  if (oil <= 0) return { kind: 'refused', reason: 'no_generator' };
  if (buildBoostActive(base.economy.buildBoostUntil, now)) {
    return { kind: 'refused', reason: 'already_running' };
  }

  const price: PartialResources = admin ? {} : { oil };
  if (!canAfford(base.resources, price)) return { kind: 'refused', reason: 'cannot_afford' };

  const lit: Base = {
    ...base,
    resources: spendResources(base.resources, price),
    // Re-timed once, here. Every later read of the queue sees ordinary frozen durations, so
    // nothing else in the game has to learn that a burn exists.
    buildQueue: boostedQueue(base.buildQueue, now, BUILD_BOOST_PERCENT),
    economy: {
      ...base.economy,
      buildBoostUntil: new Date(now.getTime() + BUILD_BOOST_MS).toISOString(),
    },
  };

  repos.bases.updateResources(lit.id, lit.resources);
  repos.bases.updateDistrict(lit.id, lit.buildings, lit.buildQueue);
  repos.bases.updateEconomy(lit.id, lit.economy);
  return { kind: 'lit', base: lit, paid: price };
}
