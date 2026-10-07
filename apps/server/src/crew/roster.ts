import {
  brokerRate,
  chairSettlesAt,
  supplyMarkup,
  officerIsWorking,
  markFromPoints,
  seatPoints,
  describeOverseerPassive,
  type AttributeLift,
  type Attributes,
  type Base,
  type Commander,
  type CrewOfficer,
  type CrewOverseer,
  type CrewResponse,
  type OfficerRole,
  type SeatedOfficer,
} from '@frontline/shared';
import {
  chairLineFor,
  officerFitReader,
  standingEffectsFor,
  type ChairLineContext,
  type OfficerFitReader,
  liftedOfficerSheet,
  liftedOverseerReceipt,
  officerLiftRoom,
  type LiftRoom,
} from './standing.js';
import { ledgerFor } from '../bar/hire.js';
import { researchHead } from '../research/tracks.js';
import type { Repositories } from '../db/repos/index.js';
import { districtUnitSlots, type DistrictUnitSlots } from '../district/unit-slots.js';

/**
 * Reading the crew (GDD §G): who is in which chair, and everything about them.
 *
 * This was the assignee layer, and most of it was pool arithmetic derived from `Base.level`: how
 * many units the level had granted, how many were placed, what one more under an officer would
 * pay. None of that exists any more. What is left is a projection of the officers themselves, which
 * is the only part of the payload a player was ever reading.
 */

/**
 * One officer as the crew screen shows them: the person, not a unit count.
 *
 * `lifted` defaults to the person's own sheet so the two callers that have no room around them
 * (a single officer projected out of a mutation response) keep working and simply show no lift.
 */
export function projectCrewOfficer(
  officer: Commander,
  lifted: { attributes: Attributes; lift: AttributeLift[] } = {
    attributes: officer.attributes,
    lift: [],
  },
  /** The crew's side of the chair's line, when the caller has it (`chairLineContext`). */
  context?: ChairLineContext,
  now: Date = new Date(),
): CrewOfficer {
  return {
    officerId: officer.id,
    name: officer.name,
    portraitId: officer.portraitId ?? null,
    role: officer.role,
    attributes: officer.attributes,
    lifted: lifted.attributes,
    lift: lifted.lift,
    perks: officer.perks,
    weeklyWage: officer.weeklyWage,
    // §D4: sent as the raw clock rather than as a boolean, so the card can count down to it.
    injuredUntil: officer.injuredUntil,
    /*
     * How well they fit the chair, as a mark: the seat's points (`seatPoints`, the public tags and
     * their tiers) said out loud.
     *
     * Null on the bench. A mark is a statement about a fit, and somebody with no chair has nothing
     * to fit: the same officer reads differently in two roles, which is the point of showing it.
     *
     * Off `lifted.attributes`, which is the sheet two lines above this one on the same card. It
     * used to read `officer.attributes` and the card contradicted itself: the bars drew 20 base
     * plus 2 from the Overseer and the mark under them was the mark for 20. Whichever of the two
     * is right, they cannot both be on the same card.
     */
    mark:
      officer.role === null ? null : markFromPoints(seatPoints(lifted.attributes, officer.role)),
    // What the chair gives, off the points it is paid on (`chairLineFor`, 2026-10-04). Nothing
    // for somebody laid up: the chair pays nothing while they are (bug pass, the same day).
    passive:
      officer.role === null || !officerIsWorking(officer, now)
        ? null
        : chairLineFor(officer, officer.role, seatPoints(lifted.attributes, officer.role), context),
    // Seated in the last few hours: the card counts down to when the chair starts giving.
    chairFrom: officer.role === null ? null : (chairSettlesAt(officer, now)?.toISOString() ?? null),
  };
}

/** The Overseer's card on the crew screen, or null before one is chosen (2026-10-04). */
function projectCrewOverseer(repos: Repositories, base: Base, room: LiftRoom): CrewOverseer | null {
  const owner = repos.users.findById(base.ownerId);
  const overseer = owner?.overseerId ? repos.overseers.findById(owner.overseerId) : undefined;
  if (!overseer) return null;
  const lifted = liftedOverseerReceipt(overseer.attributes, room);
  const points = room.overseerPoints ?? seatPoints(lifted.attributes, 'overseer');
  return {
    name: overseer.name,
    portraitId: overseer.portraitId,
    attributes: overseer.attributes,
    lifted: lifted.attributes,
    lift: lifted.lift,
    perks: overseer.perks,
    mark: markFromPoints(points),
    passive: describeOverseerPassive(points),
  };
}

/** The §A1 pool as the screen quotes it: beds, which officers still take one of each. */
function housingOf(slots: DistrictUnitSlots): CrewResponse['housing'] {
  return { used: slots.total, capacity: slots.capacity };
}

/** The whole crew screen in one payload. */
export function projectCrew(repos: Repositories, base: Base): CrewResponse {
  /*
   * The room every officer is lifted by, read once for the screen.
   *
   * The same three sources the effects fold uses (`crewSheetsFor`), through the same function, so
   * the figure on the card is the figure the game fights and builds with. An officer in a bed is
   * out of the room in both directions: they lift nobody, and `crewSheetsFor` drops them.
   */
  const room = officerLiftRoom(repos, base);
  const context = chairLineContext(repos, base, officerFitReader(repos, base));
  return {
    level: base.level,
    housing: housingOf(districtUnitSlots(repos, base)),
    // §H7: the book is widened from this screen too (maintainer, 2026-09-30), at the crew's price.
    payroll: ledgerFor(base, standingEffectsFor(repos, base)),
    overseer: projectCrewOverseer(repos, base, room),
    officers: base.commanders.map((officer) =>
      projectCrewOfficer(officer, liftedOfficerSheet(officer, room), context),
    ),
  };
}

/**
 * What the chair lines need from the crew (`ChairLineContext`): the Researcher's share of the
 * curved research sum, and the market's own rates at this crew's level and discount.
 */
export function chairLineContext(
  repos: Repositories,
  base: Base,
  fit: OfficerFitReader,
  now: Date = new Date(),
): ChairLineContext {
  const discount = standingEffectsFor(repos, base, now).marketDiscountPercent;
  return {
    researchAddsPercent: researchHead(repos, base, fit)?.addsPercent ?? null,
    marketRates: {
      worth: brokerRate(base.level, discount, null),
      markup: supplyMarkup(discount, null),
    },
  };
}

/**
 * The chairs that are actually taken.
 *
 * `commanders.map(o => o.role)` was the idiom everywhere and it stopped being right the day an
 * officer could have no chair: it answered a list with `null` in it, and every caller was asking
 * "which seats are filled". Named, so the question is asked once and the answer cannot drift.
 */
export function seatedRoles(commanders: readonly Commander[]): OfficerRole[] {
  return commanders
    .map((officer) => officer.role)
    .filter((role): role is OfficerRole => role !== null);
}

/**
 * The people who are actually working, which is not everybody on the books (maintainer, 2026-09-23).
 *
 * An injured officer is **out**: no ratings, no perks, no lift on anybody else, and none of the
 * services their chair unlocks, until their twelve hours are up (`OFFICER_INJURY_HOURS`). The
 * sheet fold already honoured that (`officerLiftRoom` leaves them out of the room); the chairs did
 * not, so a crew whose Master of Whispers was in a hospital bed still ran the network, and
 * their Fabricator still cut cards.
 *
 * An officer on the bench is out the same way (maintainer, 2026-09-28), through the same
 * predicate (`officerIsWorking`), so this list and the fold drop the same people.
 *
 * Deliberately separate from {@link seatedRoles}, which answers a different question and must keep
 * answering it: the Bar asks "is this chair taken" so it can refuse to seat two people in one, and
 * a chair does not come free because the person in it is hurt.
 */
export function workingOfficers(
  commanders: readonly Commander[],
  now: Date = new Date(),
): SeatedOfficer<Commander>[] {
  return commanders.filter((officer) => officerIsWorking(officer, now));
}

/** The chair, if somebody is in it and fit to work. See {@link workingOfficers}. */
export function workingOfficer(
  commanders: readonly Commander[],
  role: OfficerRole,
  now: Date = new Date(),
): SeatedOfficer<Commander> | undefined {
  return workingOfficers(commanders, now).find((officer) => officer.role === role);
}

/** The chairs whose services are open right now. See {@link workingOfficers}. */
export function workingRoles(
  commanders: readonly Commander[],
  now: Date = new Date(),
): OfficerRole[] {
  return seatedRoles(workingOfficers(commanders, now));
}
