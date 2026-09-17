import {
  CITY_LOCATIONS,
  districtHolder,
  districtIsShut,
  findDistrict,
  findLocation,
  gateIsBroken,
  type BattleTarget,
  type Base,
  type District,
  type DistrictStanding,
  type LocationControl,
  type LocationHolder,
  type ScheduledBattle,
  districtDisplayName,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';

/**
 * Reading the ground a declaration names (GDD §A4, battle rework).
 *
 * One module, because the three questions a declaration asks: *is this district shut*, *is its gate
 * currently down*, and *who am I actually calling out*: are all read off the same two tables and
 * were going to be answered three times over otherwise: once by the route that validates a call,
 * once by the settler that runs it, and once by the screen that draws it. Three readings of the
 * control table is three chances for the map and the rules to disagree.
 */

/** The whole state of a district, as the declaration rules need it. */
export function districtStandingFor(
  repos: Repositories,
  district: District,
  now: Date,
): DistrictStanding {
  const controls = repos.city.controls();
  const holder = districtHolder(district, controls);
  const inhabited = isInhabited(district, districtsLivedIn(repos));

  return {
    shut: districtIsShut(holder, inhabited),
    breached: gateIsBroken(repos.sieges.gate(district.id), now),
    inhabited,
  };
}

/** Every district a crew has a base in, read once. */
export function districtsLivedIn(repos: Repositories): ReadonlySet<string> {
  return new Set(repos.bases.listSummaries().map((summary) => summary.districtId));
}

/**
 * Whether a crew *lives* on this plot, which is the fact that shuts a home and gives a breach
 * something to raid.
 *
 * Residential ground only, and the kind check is load-bearing rather than defensive. A base row
 * whose district is contested ground is a state the game does not create but the test suite does,
 * and counting it as a resident would shut a district full of locations: the locations in it would
 * become undeclarable and the only legal call would be a gate fight the map has no gate for.
 */
export function isInhabited(district: District, lived: ReadonlySet<string>): boolean {
  return district.kind === 'residential' && lived.has(district.id);
}

/**
 * Who a declaration is actually calling out.
 *
 * For a location, whoever holds it. For a gate or the district behind one, whoever holds the
 * district: on contested ground a gate is only armed when one party holds all of it, so that is a
 * single answer rather than a committee. Residential ground has no locations to hold, so it answers
 * `unoccupied` and the crew being called out is found from who *lives* there instead
 * ({@link defendingBaseOf}).
 */
export function defenderOf(
  repos: Repositories,
  target: BattleTarget,
  district: District,
): LocationHolder {
  if (target.kind === 'location') {
    return repos.city.control(target.locationId)?.holder ?? { kind: 'unoccupied' };
  }
  return districtHolder(district, repos.city.controls()) ?? { kind: 'unoccupied' };
}

/** Every control row in a district, in map order. */
export function controlsIn(
  repos: Repositories,
  districtId: string,
): { locationId: string; control: LocationControl }[] {
  const controls = repos.city.controls();
  return CITY_LOCATIONS.filter((location) => location.districtId === districtId).flatMap(
    (location) => {
      const control = controls.get(location.id);
      return control ? [{ locationId: location.id, control }] : [];
    },
  );
}

/** The ground's name, in the words the map uses. */
export function targetName(target: BattleTarget, resident?: Base): string {
  switch (target.kind) {
    case 'location':
      return findLocation(target.locationId)?.name ?? 'somewhere';
    case 'gate':
      return `the gate at ${districtLabel(target.districtId, resident)}`;
    case 'district':
      return `a raid on ${districtLabel(target.districtId, resident)}`;
  }
}

/**
 * What to call a district on a receipt, as the crew who lives on it would give it.
 *
 * The resident is the viewer on purpose: a report about a raid on somebody's home should say whose
 * home it was, and both crews in that fight already know. The map is the screen that numbers plots
 * instead, because there the reader is a stranger to nine of them. Contested ground has no resident
 * and answers with its authored name either way.
 */
function districtLabel(districtId: string, resident: Base | undefined): string {
  const district = findDistrict(districtId);
  if (!district) return 'somewhere';
  return districtDisplayName(district, {
    ownDistrictId: district.id,
    ownName: resident?.name ?? null,
  });
}

/**
 * The crew living in a district, if one does. Null for contested ground.
 *
 * A person beats a seeded crew on the same ground (maintainer, 2026-09-17). Three of the four
 * residential districts hold a bot from the boot seed, and this took the first base in the
 * district by `created_at`, which is always the seed. Once new crews were spread across the plots
 * rather than all planted on the starter, a player living in one of those three was invisible: the
 * bot answered for their home, the bot's roster defended it, the report named the bot's crew, and
 * the player was never told a fight had been called on the ground they live on.
 */
export function residentOf(repos: Repositories, districtId: string): Base | undefined {
  const living = repos.bases
    .listSummaries()
    .filter((candidate) => candidate.districtId === districtId);
  const summary = living.find((candidate) => !candidate.isBot) ?? living[0];
  return summary ? repos.bases.findById(summary.id) : undefined;
}

/**
 * The crew a call on this ground is actually a call on, if it is a crew at all.
 *
 * A location names its holder. A gate or a raid names a district rather than a party, and a
 * lived-in district has a crew behind it whether or not the control table calls them the holder:
 * residential ground has no locations to hold, so its holder reads `unoccupied` while somebody
 * very much lives there. Read the same way at declaration (the price), at resolution (who is
 * defending), on the board (the red mark) and by `sideOf` (whose fight it is), so the four cannot
 * name different people.
 */
export function crewCalledOut(
  repos: Repositories,
  target: BattleTarget,
  defender: LocationHolder,
): Base | undefined {
  if (defender.kind === 'crew') return repos.bases.findById(defender.baseId);
  if (target.kind !== 'location') return residentOf(repos, target.districtId);
  return undefined;
}

/**
 * The crew standing behind the defending side of a declared fight, if one is.
 *
 * Lives here rather than in `declare.ts` because `sideOf` (`deploy.ts`) has to ask it too, and
 * `declare.ts` is downstream of the deploy module. That it could not ask was the bug: a crew whose
 * home gate was called read `You are not in this one.` on the board and was refused by
 * `/battles/deploy`, while the settler fought the fight with their whole roster and wrote the
 * survivors back over it.
 */
export function defendingBaseOf(repos: Repositories, battle: ScheduledBattle): Base | undefined {
  return crewCalledOut(repos, battle.target, battle.defender);
}
