import { CITY_DISTRICTS, baseBonusesOf } from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';

/**
 * Bonus kinds a fixture's foothold must not pay, because the mission and fight tests that need
 * every board open measure clocks, pay and fights against the catalogue's own arithmetic.
 */
const MOVES_THE_ARITHMETIC: ReadonlySet<string> = new Set([
  'travel_speed',
  'road_shortcut',
  'rail_link',
  'mission_speed',
  'mission_spoils',
  'loot_capacity',
  'resource_yield',
  'xp_gain',
  'infamy_gain',
  'carriers_fight',
  'any_ride',
  'steady_nerve',
  'unit_mark',
  'unit_speed',
  'unit_offense',
  'unit_vitality',
  'unit_armor',
  'unit_tier',
  'unit_kind',
  'unit_morale',
  'unit_stealth',
  'cohesion',
  'casualty_recovery',
  'intimidation',
  'defense_percent',
]);

/**
 * One location held in every contested district of Ashfall, so every board is open (maintainer,
 * 2026-09-29: a district hires only a crew that holds a place in it).
 *
 * The place taken is the first one whose bonuses leave missions and fights alone, so a test about
 * a clock or a payout still measures the catalogue and not the ground this fixture handed over.
 */
export function holdEveryBoard(repos: Repositories, baseId: string): void {
  for (const district of CITY_DISTRICTS) {
    if (district.kind !== 'contested') continue;
    const quiet = district.locations.find((location) =>
      baseBonusesOf(location).every((bonus) => !MOVES_THE_ARITHMETIC.has(bonus.kind)),
    );
    if (!quiet) throw new Error(`fixture: ${district.id} has no place that leaves missions alone`);
    const control = repos.city.control(quiet.id);
    if (!control) throw new Error(`fixture: no control row for ${quiet.id}`);
    repos.city.put({ ...control, holder: { kind: 'crew', baseId }, garrison: {} });
  }
}
