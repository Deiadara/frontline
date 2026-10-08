import { CITY_DISTRICTS, findDistrict } from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';

/**
 * The quietest district in Ashfall to hold whole, for a fixture that needs a district board open.
 *
 * A board opens on the whole district now (maintainer, 2026-10-07), so a fixture cannot pick one
 * harmless location any more: it takes everything the district pays with it. The Annexes is the
 * least intrusive of the eight. Nothing on it moves a mission's clock, its pay, its haul, its XP
 * or its infamy, which is what the tests around these fixtures measure; what it does pay is
 * `build_speed`, `intel`, `research_speed`, `resource`, `intimidation` and `unit_vitality`, with
 * `unit_stealth` for holding it whole, so a test about a **fight** should expect a crew that is a
 * little harder to kill.
 */
export const QUIET_BOARD = 'annexes';

/** Hands this crew every location in `districtId`, which is what opens its board. */
export function holdDistrictWhole(repos: Repositories, baseId: string, districtId: string): void {
  const district = findDistrict(districtId);
  if (!district) throw new Error(`fixture: no district ${districtId}`);
  if (district.locations.length === 0) throw new Error(`fixture: ${districtId} has no plots`);
  for (const location of district.locations) {
    const control = repos.city.control(location.id);
    if (!control) throw new Error(`fixture: no control row for ${location.id}`);
    repos.city.put({ ...control, holder: { kind: 'crew', baseId }, garrison: {} });
  }
}

/**
 * Every contested district of Ashfall held end to end, so every board is open (maintainer,
 * 2026-10-07: a district hires only a crew that holds it entirely).
 *
 * It used to take one quiet location per district, chosen for having no bonus that moves a
 * mission's clock or its pay, so a test about an arithmetic still measured the catalogue rather
 * than the ground this fixture handed over. That is no longer possible: a board opens on the whole
 * district, and every contested district in Ashfall has at least two locations paying on one of
 * those channels. A test that needs *every* board gets the whole city's bonuses with it, which is
 * why most callers want {@link holdDistrictWhole} with {@link QUIET_BOARD} instead.
 */
export function holdEveryBoard(repos: Repositories, baseId: string): void {
  for (const district of CITY_DISTRICTS) {
    if (district.kind !== 'contested') continue;
    holdDistrictWhole(repos, baseId, district.id);
  }
}
