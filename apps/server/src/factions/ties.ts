import { ALL_DISTRICTS, CAPTURED_GATE_START_LEVEL, districtWholeFor } from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { bringPostedUnitsHome } from './unpost.js';

/**
 * What ends when a tie at the table is cut (faction ruling, 2026-10-07): a member leaving, being
 * removed, or the faction disbanding.
 *
 * Two things, in this order. Every district that was whole on the strength of the members
 * together, and is whole for nobody once they part, loses its gate: it goes back to level 1 with
 * any raise dropped, as a district broken up through a breach does (`resetGateOnDistrictLost`).
 * Then the units posted across the tie walk home (`bringPostedUnitsHome`). The gate first, while
 * the control rows still say who held what: the walk home changes none of them, but the order
 * should not have to rely on that.
 *
 * `leaving` and `staying` are user ids, as the routes have them. For a disband the two lists are
 * the same, and afterwards every member stands alone: a district one of them held outright keeps
 * its gate, because it was never the table's.
 */
export function cutFactionTies(
  repos: Repositories,
  leaving: readonly string[],
  staying: readonly string[],
  now: Date,
): void {
  const baseOf = (userId: string): string | null => repos.bases.findByOwnerId(userId)?.id ?? null;
  const bases = (userIds: Iterable<string>): Set<string> =>
    new Set([...userIds].flatMap((id) => baseOf(id) ?? []));
  const leavers = new Set(leaving);
  const stayers = new Set(staying);
  const disbanding = [...leavers].every((id) => stayers.has(id));
  const after = disbanding
    ? [...leavers].map((id) => bases([id]))
    : [
        bases([...stayers].filter((id) => !leavers.has(id))),
        bases([...leavers].filter((id) => !stayers.has(id))),
      ];
  dropGatesNoLongerWhole(repos, bases([...leavers, ...stayers]), after);
  bringPostedUnitsHome(repos, leaving, staying, now);
}

/** Puts back to level 1 the gate of every district whole for `before` and for none of `after`. */
export function dropGatesNoLongerWhole(
  repos: Repositories,
  before: ReadonlySet<string>,
  after: readonly ReadonlySet<string>[],
): string[] {
  const controls = repos.city.controls();
  const fallen: string[] = [];
  for (const district of ALL_DISTRICTS) {
    if (!districtWholeFor(district, controls, before)) continue;
    if (after.some((party) => districtWholeFor(district, controls, party))) continue;
    repos.capturedGates.put({
      districtId: district.id,
      level: CAPTURED_GATE_START_LEVEL,
      upgradingTo: null,
      upgradingUntil: null,
      upgradingSince: null,
    });
    fallen.push(district.id);
  }
  return fallen;
}
