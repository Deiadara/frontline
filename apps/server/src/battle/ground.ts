import {
  EVERY_LOCATION,
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
import { wholeHolderOf } from '../city/holding.js';

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
  // A table holding the district together arms the gate as one holder would (2026-10-07).
  const holder = wholeHolderOf(repos, district);
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
 * single answer rather than a committee. A faction holding it together is one party, and the
 * member named is the one holding the most of it (`wholeHolderAmong`, 2026-10-07). Residential
 * ground has no locations to hold, so it answers `unoccupied` and the crew being called out is
 * found from who *lives* there instead ({@link defendingBaseOf}).
 */
export function defenderOf(
  repos: Repositories,
  target: BattleTarget,
  district: District,
): LocationHolder {
  if (target.kind === 'location') {
    return repos.city.control(target.locationId)?.holder ?? { kind: 'unoccupied' };
  }
  return wholeHolderOf(repos, district) ?? { kind: 'unoccupied' };
}

/**
 * Every control row in a district, in map order.
 *
 * Filtered out of the world's locations rather than Ashfall's (2026-09-24). A district in a second
 * city matched nothing here, so it answered "no control rows": the fight over a Terminus location
 * would have been resolved against an empty district, with nobody defending and no neighbours.
 */
export function controlsIn(
  repos: Repositories,
  districtId: string,
): { locationId: string; control: LocationControl }[] {
  const controls = repos.city.controls();
  return EVERY_LOCATION.filter((location) => location.districtId === districtId).flatMap(
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
    /*
     * The place in caps and the words around it as written (maintainer, 2026-09-20).
     *
     * Cased here rather than by a class on the client, which is what `DeclareDialog` does, because
     * this one is a **composed sentence on the wire**: the fights list, the fight's own header,
     * the faction feed and a movement row all print the string this function returns, and the
     * client cannot case the place inside it without being told where the place starts. Either
     * every one of those grows a second field, or the sentence arrives the way it is meant to
     * read. It is already player-facing copy written here; the case is part of the copy.
     */
    case 'gate':
      return `the gate at ${districtLabel(target.districtId, resident).toUpperCase()}`;
    case 'district':
      return `a raid on ${districtLabel(target.districtId, resident).toUpperCase()}`;
  }
}

/**
 * What to call a district on a receipt, as the crew who lives on it would give it.
 *
 * A plot is called after the crew living on it, so a report about a raid on somebody's home says
 * whose home it was. Contested ground has no resident and answers with its authored name either way.
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
 *
 * Since 2026-09-28 a plot holds one crew and a player is never seated on a bot's, so the preference
 * only matters in a database from before that; it goes with the bots (the TODO in `seed/index.ts`).
 */
export function residentOf(repos: Repositories, districtId: string): Base | undefined {
  const summary = residentAmong(repos.bases.listSummaries(), districtId);
  return summary ? repos.bases.findById(summary.id) : undefined;
}

/** {@link residentOf}'s rule over summaries already read: nothing in a crew's row is parsed. */
function residentAmong(summaries: readonly CrewTag[], districtId: string): CrewTag | undefined {
  const living = summaries.filter((candidate) => candidate.districtId === districtId);
  return living.find((candidate) => !candidate.isBot) ?? living[0];
}

/** What a summary row says about a crew, and all the call's price needs of one. */
type CrewTag = Pick<Base, 'id' | 'districtId' | 'isBot'>;

/**
 * A home plot nobody lives on, from where `viewer` stands: closed to them until a crew claims it
 * (maintainer, 2026-09-28). A crew's own plot is never closed to it.
 */
export function isClosedPlot(
  repos: Repositories,
  district: Pick<District, 'id' | 'kind'>,
  viewer: Pick<Base, 'districtId'>,
): boolean {
  // Whether anybody lives there, off the summaries (bug pass, 2026-10-06): a full parse of the
  // resident's row only to test that it exists made one unreadable row blank the district for
  // every viewer.
  return (
    district.kind === 'residential' &&
    district.id !== viewer.districtId &&
    residentAmong(repos.bases.listSummaries(), district.id) === undefined
  );
}

/**
 * Every crew living in a district: the resident, and anybody sharing the ground with them. Only a
 * database from before 2026-09-28 has anybody sharing; that case leaves with the bots.
 */
export function livingIn(repos: Repositories, districtId: string): Base[] {
  return repos.bases
    .listSummaries()
    .filter((summary) => summary.districtId === districtId)
    .flatMap((summary) => repos.bases.findById(summary.id) ?? []);
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
 * {@link crewCalledOut}, answered off summaries already read rather than off each crew's row.
 *
 * For the board's price list, which asks it of every target in the world since the whole city
 * became visible (2026-09-29). Reading each crew's full row there meant one unparseable save took
 * every other player's battle board down with it (`robustness/simulation.test.ts`).
 */
export function crewCalledOutAmong(
  summaries: readonly CrewTag[],
  target: BattleTarget,
  defender: LocationHolder,
): CrewTag | undefined {
  if (defender.kind === 'crew') return summaries.find((one) => one.id === defender.baseId);
  if (target.kind !== 'location') return residentAmong(summaries, target.districtId);
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

/**
 * Every crew with a stake in a declared fight: the caller, every crew with a row on either side,
 * and the crew being called out.
 *
 * The last is the one a list of rows misses. A raid or a gate call writes the defending row with
 * no crew on it (`declare.ts`), so a resident who never deployed has no row at all, and yet they
 * are the one crew certain to have heard about the fight: `district_attacked` rang for them at the
 * call, and a player cannot switch it off. A fight called off without them in this list vanished
 * from their board with nothing said.
 */
export function crewsInFight(repos: Repositories, battle: ScheduledBattle): Set<string> {
  return new Set(
    [
      battle.attackerBaseId,
      ...repos.sieges.deployments(battle.id).map((row) => row.baseId),
      defendingBaseOf(repos, battle)?.id,
    ].filter((id): id is string => typeof id === 'string'),
  );
}
