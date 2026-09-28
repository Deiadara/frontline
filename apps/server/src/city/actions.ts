import { MAX_LOCATION_LEVEL, type LocationControl } from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { settleBasesById } from '../district/settle.js';
import { settleEach } from '../world/guard.js';

/**
 * Doing things to the city (GDD §A4): what is left of it here is the upgrade clock on held ground.
 *
 * It used to open with a promise that forces would one day walk. They do: every unit that goes
 * anywhere is a column on the clock (`moves/moves.ts`, `battle/movement.ts`), and the instant
 * garrison door that was the last thing here to skip the road is gone.
 */

/**
 * Finishes any location upgrade whose clock has run out.
 *
 * Called at the top of every city read and write, which is the same lazy contract the rest of the
 * game runs on, and by the world clock. Returns the controls it settled so callers do not read them
 * twice. It settled dug-in fortification on the same row as well, until fortification left the game
 * (maintainer, 2026-09-26).
 */
export function settleLocationUpgrades(
  repos: Repositories,
  now: Date,
): Map<string, LocationControl> {
  const controls = repos.city.controls();
  const due = [...controls.values()].filter(
    (control) =>
      control.upgradingUntil !== null && Date.parse(control.upgradingUntil) <= now.getTime(),
  );
  settleEach(
    repos,
    'location upgrades',
    due,
    (control) => control.locationId,
    (control) => {
      const settled: LocationControl = {
        ...control,
        level: Math.min(MAX_LOCATION_LEVEL, control.level + 1),
        upgradingUntil: null,
      };
      putControl(repos, settled, now);
      controls.set(control.locationId, settled);
    },
  );
  return controls;
}

/*
 * `setGarrison` was here, the whole of `POST /city/garrison`, and it went with the route
 * (maintainer, 2026-09-28: "Nothing sends units immediately, you need to move them"). It put units
 * on a held location, or brought them home, in the same instant and across cities. Standing units on
 * ground is a move now (`moves/moves.ts`), which walks, and the rules this door enforced (a porter
 * is not a line, a legend will not stand for a nobody, nothing leaves in a fight's last hour) are
 * `sendMove`'s. `CITY_REFUSALS` went with it: nothing else returned one.
 */

/**
 * Writes a location's control row, settling first every crew whose output the write moves.
 *
 * Ground pays its holder by the hour (`perHour` and `resourceYieldPercent` in the standing fold),
 * and production is lazy: it is priced at the crew's next read against whatever it holds *then*.
 * A change of holder or level written without a settle was applied to the whole window since
 * each crew last looked, so the crew that took a Gas Station was paid for the hours before it
 * did, and the crew that lost it lost those hours too (audit, 2026-09-28). Both crews are settled
 * against the row as it stands, then the row is written.
 *
 * The settle writes the crews' rows, so a caller holding a copy of either must re-read it after.
 */
export function putControl(repos: Repositories, next: LocationControl, now: Date): void {
  const before = repos.city.control(next.locationId);
  if (before && (holderOf(before) !== holderOf(next) || before.level !== next.level)) {
    settleBasesById(repos, [holderOf(before), holderOf(next)], now);
  }
  repos.city.put(next);
}

function holderOf(control: LocationControl): string | null {
  return control.holder.kind === 'crew' ? control.holder.baseId : null;
}
