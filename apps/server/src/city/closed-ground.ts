import {
  EVERY_LOCATION,
  cityIsOpen,
  findDistrict,
  startingControl,
  type Location,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { walkHome } from '../moves/moves.js';
import { settleEach } from '../world/guard.js';

/**
 * Ground a crew holds in a city that is not open yet goes back to the atlas (maintainer, 2026-09-29).
 *
 * A shut city's ground (Saltmarch's then, Reliquary's now) is real rows on the control map, and until the doors into a closed city were
 * shut, a column could walk onto an empty plot there and claim it. The door is shut now
 * (`city_closed` on the move, the plant and the spy), and the rooms refuse a closed city whatever
 * is held in it (`canEnterCity`). What is left is the rows already claimed: this hands each one
 * back to the holder and garrison the atlas authored for it, and walks the crew's units home, with
 * anybody an ally had posted there, because nothing sends units anywhere instantly.
 *
 * Run once at boot. It changes nothing on a save with no such rows, which after the first boot is
 * every save, so it needs no marker of its own.
 */
export function releaseClosedCityGround(
  repos: Repositories,
  now: Date,
): { locations: number; unitsSentHome: number } {
  return repos.tx(() => {
    const controls = repos.city.controls();
    let locations = 0;
    let unitsSentHome = 0;
    // Plot by plot, each a savepoint: one holder this build cannot read is logged and its plot
    // left for the next boot, rather than stopping the server (bug pass, 2026-10-06).
    settleEach(
      repos,
      'boot: closed-city ground',
      EVERY_LOCATION,
      (location) => location.id,
      (location) => {
        const district = findDistrict(location.districtId);
        if (!district || cityIsOpen(district.cityId)) return;
        const control = controls.get(location.id);
        if (control?.holder.kind !== 'crew') return;

        let sent = sendHome(repos, location, control.holder.baseId, control.garrison, now);
        for (const posting of repos.alliedGarrisons.at(location.id)) {
          sent += sendHome(repos, location, posting.baseId, posting.army, now);
        }
        repos.alliedGarrisons.clearAt(location.id);
        repos.city.put(startingControl(location, district));
        unitsSentHome += sent;
        locations += 1;
      },
    );
    return { locations, unitsSentHome };
  });
}

/** One crew's units off a released plot, on the ordinary walk home. Answers how many. */
function sendHome(
  repos: Repositories,
  location: Location,
  baseId: string,
  army: Record<string, number>,
  now: Date,
): number {
  const owner = repos.bases.findById(baseId);
  if (!owner) return 0;
  walkHome(repos, owner, { kind: 'location', locationId: location.id }, army, {}, now);
  return Object.values(army).reduce((total, count) => total + count, 0);
}
