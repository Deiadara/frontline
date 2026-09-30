import {
  MISC_AREA_ID,
  UNIT_RULE_IDS,
  findDistrict,
  findUnit,
  type Army,
  type LineRules,
  type Mission,
  type MissionLeader,
  type UnitRuleId,
} from '@frontline/shared';

/**
 * The sentences a run is described in, shared by the rows on the missions page and by the report
 * window one of those rows opens.
 *
 * They live here rather than in `MissionsPage` because the collapsed row and the window have to
 * agree word for word: the row says a run succeeded and the window says who led it, and a player
 * who reads both in the same second must not be told two different things by two copies of the
 * same helper.
 */

/**
 * Who was in charge of a run, in the words the report prints.
 *
 * The Overseer is not on the books, so they cannot be named by `officerId`: `overseerLed` is the
 * only record that the player themselves led it. An officer who has since left the crew is off
 * the leader list by the time a finished run is drawn, and the line says so rather than being
 * dropped: who led a run is a fact about the run, and it does not stop being true.
 *
 * `overseerName` comes from the board's own `leaders` wherever it can (see the call site): the
 * name has to arrive with the row that needs it, not from a second query that may not have
 * landed yet.
 */
export function ledBy(
  mission: Mission,
  leaders: readonly MissionLeader[],
  overseerName: string,
): string {
  if (mission.overseerLed) return overseerName;
  if (mission.officerId === null) return 'Nobody leading them';
  return leaders.find((one) => one.id === mission.officerId)?.name ?? 'Somebody off the books';
}

/**
 * "Razors 3, Scavengers 1": units by name, which is how a player counts what they sent.
 *
 * Name then count, which is how every other list of units in the game is written (the mission
 * report's own force line, the faction panel's garrison). Putting the count first read `1 Razors`
 * for every single unit, because a unit's name in the catalogue is already a plural: there is no
 * singular of `Razors` for the client to reach for, and inventing one is not this line's job.
 */
export function describeArmy(army: Army): string {
  return Object.entries(army)
    .filter(([, count]) => count > 0)
    .map(([unitId, count]) => `${findUnit(unitId)?.name ?? unitId} ${count}`)
    .join(', ');
}

/** `force` less `lost`: who walked back through the gate. */
export function cameHome(mission: Mission): Army {
  const home: Army = {};
  for (const [unitId, count] of Object.entries(mission.force)) {
    const left = count - (mission.lost[unitId] ?? 0);
    if (left > 0) home[unitId] = left;
  }
  return home;
}

/**
 * Where a job was, in the player's words.
 *
 * Through the map rather than through the board's `areas`, which are only the boards this crew may
 * *read* right now: a finished run's ground is often not among them, and the map authored every
 * district and never forgets one.
 */
export function areaName(areaId: string): string {
  if (areaId === MISC_AREA_ID) return 'Odd jobs';
  return findDistrict(areaId)?.name ?? areaId;
}

/**
 * This crew's own reading of a unit sheet, off the two things the screen is sent about it: whether
 * its porters stand in the line (`carriers_fight`) and the marks its research and holdings have
 * granted (`unit_mark`).
 *
 * One function because two windows read it and must agree with the settle: the send window asks
 * it who can fight and how much the party can lift, and the report asks it how much the party
 * could lift. Marks are narrowed against the catalogue rather than asserted: the payload is a
 * record of strings, and a mark this build has never heard of is one the arithmetic must not
 * pretend to understand.
 */
export function crewLineRules(
  carriersFight: boolean,
  marks: Readonly<Record<string, readonly string[]>>,
): LineRules {
  return {
    carriersFight,
    unitMarks: Object.fromEntries(
      Object.entries(marks).map(([unitId, granted]) => [
        unitId,
        granted.filter((mark): mark is UnitRuleId =>
          (UNIT_RULE_IDS as readonly string[]).includes(mark),
        ),
      ]),
    ),
  };
}
