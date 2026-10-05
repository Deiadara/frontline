import {
  RESEARCH_ITEMS,
  buildingLevel,
  labResearchCostCut,
  describeResearchItemRefusal,
  describeResearchPayout,
  findResearchItem,
  markFromPoints,
  researchItemPrice,
  researchItemRefusal,
  researchTimeCutPercent,
  researchTimeCut,
  researchTimeReduction,
  trackProgress,
  type Base,
  type ChairMarks,
  type Commander,
  type LabTech,
  type OfficerRole,
  type PartialResources,
  type ResearchHead,
  type ResearchItemSpec,
  type ResearchTrackStatus,
} from '@frontline/shared';
import {
  chairLineFor,
  standingEffectsFor,
  type ChairLineContext,
  type OfficerFitReader,
} from '../crew/standing.js';
import type { Repositories } from '../db/repos/index.js';

/**
 * §C: what the thirteen research tracks cost this particular crew, and which of them are open.
 *
 * This is the only module in the feature that reads the hidden requirement table, and it is
 * server-side for that reason (§B8, §B8a). What leaves it is a **mark**, which is the coarse hint
 * the guard's own note allows, and two percentages derived from the score. Nothing else: no score,
 * nothing keyed by role.
 *
 * ## Why the percentages ship at all
 *
 * §C3a asks for the Researcher's points to cut the clock and §C3b asks that every bonus read
 * the points rather than the letter, so that training moves the number. A player who cannot see
 * the cut cannot tell whether the afternoon they spent training bought anything, and the duration
 * on the card gives it away regardless. So the derived figure ships and the score does not.
 */

/** The officer sitting in a chair, or `undefined`. */
/**
 * Whoever is working `role` right now, on the **request's** clock.
 *
 * Working, not merely seated (maintainer, 2026-09-23): an injured officer's track stops with the
 * rest of what they were worth, for the twelve hours they are out.
 *
 * It asked `workingOfficer(base.commanders, role)`, which defaults its clock to `new Date()`. The
 * fit reader beside it already holds the instant the request is reasoning about, so the two could
 * disagree: the page said `head: null` while the rung under it had no blocker, and which way it
 * went depended on the wall clock rather than on the crew. One clock now, the reader's.
 */
function seated(fit: OfficerFitReader, role: OfficerRole): Commander | undefined {
  return fit.workingIn(role);
}

/**
 * The one precision either derived percentage is ever seen at, in percentage points.
 *
 */
/**
 * How coarsely a cut is published.
 *
 * Every published figure is a monotone function of one seated officer's seat points. Until
 * 2026-09-30 those were the hidden role table's weighted mean, and this grain was the price of
 * recovering that table by seating officers one at a time and reading the cuts back (5.6 officers
 * per role at a tenth, 60.7 at 5). The seat now reads the public tags (`seatPoints`), so there is
 * nothing left to recover through here and the grain only has §C3b to answer to: a point of
 * training in the chair's irreplaceable skill has to move the card. At a tenth it does; at a whole
 * point a player could train several before the figure changed.
 */
export const PUBLISHED_CUT_GRAIN = 0.1;

/**
 * Everything the response computes from a cut goes through this first, and that is the point. A
 * price and a clock derived from the raw score while the card printed it rounded put the score back
 * on the wire at full precision: ten integer prices per track, each rounding a different four-digit
 * catalogue figure, between them pinned it to a single value. Measured over every score the scale
 * admits: pricing off the raw number left exactly one candidate, pricing off this one leaves four.
 * So the wire says the published figure and nothing behind it.
 */
function published(percent: number): number {
  // Divided by the steps per point rather than multiplied by the grain: 247 * 0.1 is
  // 24.700000000000003 in binary, and that is what the card would have printed.
  return Math.round(percent / PUBLISHED_CUT_GRAIN) / Math.round(1 / PUBLISHED_CUT_GRAIN);
}

/** Every role has a track, and the response ships them in the catalogue's own order. */
const RESEARCH_TRACKS: readonly OfficerRole[] = [
  ...new Set(RESEARCH_ITEMS.map((spec) => spec.track)),
];

/**
 * §C1c/§C3a: the Researcher, and what their sheet takes off every research clock.
 *
 * Every figure on this page is measured through {@link officerFitReader}, which reads the sheet an
 * officer actually has rather than the one printed on their card. The Lab used to read
 * `officer.attributes` at all five of these sites, so the Overseer's teaching perks, the peers'
 * perks, the ground's `officer_group` and the Lab's own `officer_attribute` rungs raised a number
 * that gated nothing: a crew could finish Field Promotions and watch every research gate refuse
 * the officer it had just promoted.
 */
export function researchHead(
  repos: Repositories,
  base: Base,
  fit: OfficerFitReader,
): ResearchHead | null {
  const officer = seated(fit, 'researcher');
  if (!officer) return null;
  const points = fit.pointsFor(officer, 'researcher');
  const clock = researchClockFor(repos, base, fit);
  const others = clock.buildingPercent + clock.crewSpeedPercent;
  return {
    name: officer.name,
    mark: markFromPoints(points),
    timeCutPercent: clock.headCutPercent,
    /*
     * What the Head actually adds (maintainer ruling P7-C, 2026-10-02). The clock cut joins the
     * Lab's cards, the crew's points and the Head and curves the sum, so a Head printed at "45%
     * off" moved a crew's clock by far less than that. This is the curved share with them, less
     * the curved share without.
     */
    addsPercent: published(
      researchTimeCut(others + clock.headCutPercent) - researchTimeCut(others),
    ),
  };
}

/**
 * What the track's own officer does for the crew from their chair, in words, or null with the chair
 * empty. It was what they took off every price on their own track until 2026-10-04, when the
 * maintainer ruled that no officer cuts the price of a programme.
 */
function chairPassiveFor(
  track: OfficerRole,
  fit: OfficerFitReader,
  context?: ChairLineContext,
): string | null {
  const officer = seated(fit, track);
  return officer ? chairLineFor(officer, track, fit.pointsFor(officer, track), context) : null;
}

/** The two chairs a rung is gated on (§C1b, §C1c). */
export function chairMarksFor(track: OfficerRole, fit: OfficerFitReader): ChairMarks {
  return {
    trackMark: fit.markFor(track),
    headMark: fit.markFor('researcher'),
  };
}

/** The thirteen tracks in `OFFICER_ROLES` order, with who is standing on each. */
export function trackStatuses(
  base: Base,
  fit: OfficerFitReader,
  /** The crew's side of the chair lines (`chairLineContext` in `crew/roster.ts`). */
  context?: ChairLineContext,
): ResearchTrackStatus[] {
  return RESEARCH_TRACKS.map((role) => {
    const officer = seated(fit, role);
    return {
      role,
      officerName: officer?.name ?? null,
      mark: fit.markFor(role),
      passive: chairPassiveFor(role, fit, context),
      done: trackProgress(base.research.technologies, role),
    };
  });
}

/** What this crew would actually pay for a rung: the listed price less the Lab's cut. */
export function priceOf(base: Base, spec: ResearchItemSpec): PartialResources {
  return researchItemPrice(spec, labResearchCostCut(base.buildings));
}

/**
 * The three cuts a research clock gets, none of which depends on which rung is being run.
 *
 * Read once per request rather than once per rung: `standingEffectsFor` folds the whole city and
 * the whole roster, and doing that 180 times to answer one page is the difference between a read
 * that costs nothing and one that does not.
 */
interface ResearchClock {
  buildingPercent: number;
  crewSpeedPercent: number;
  headCutPercent: number;
}

function researchClockFor(repos: Repositories, base: Base, fit: OfficerFitReader): ResearchClock {
  const head = seated(fit, 'researcher');
  return {
    buildingPercent: researchTimeReduction(base.buildings),
    crewSpeedPercent: standingEffectsFor(repos, base).researchSpeedPercent,
    // Settled in, like every chair's passive (bug pass, 2026-10-05): a Researcher seated an hour
    // ago gates research at once but speeds none of it, or a hop in to start a long programme at
    // half time and a hop out would beat the cooldown, since a project's clock is frozen at start.
    headCutPercent:
      head && fit.chairSettled('researcher')
        ? published(researchTimeCutPercent(fit.pointsFor(head, 'researcher')))
        : 0,
  };
}

/**
 * How long a rung takes once those three are applied: the Lab's research cards, the crew's
 * own research speed and §C3a's Researcher, **added** into one sum and cut by
 * `researchTimeCut`'s taper (maintainer, 2026-10-01: "make them add"). They used to be applied one
 * after another, the Lab cut at 70, so three bounds compounded.
 *
 * Floored at a minute, because the whole screen is built around a clock and a project that lands
 * inside the request that started it never has one.
 *
 * Off the rung's own `minutes`, never the depth formula: the Master of Whispers' clocks are the
 * maintainer's ledger (45 to 1000 minutes), and reading the formula ran The Whole Wire on 270.
 */
function minutesWith(clock: ResearchClock, spec: ResearchItemSpec): number {
  const off = researchTimeCut(
    clock.buildingPercent + clock.crewSpeedPercent + clock.headCutPercent,
  );
  return Math.max(1, Math.round(spec.minutes * (1 - off / 100)));
}

/** The same, for a caller that has one rung in hand rather than the catalogue. */
export function minutesFor(
  repos: Repositories,
  base: Base,
  spec: ResearchItemSpec,
  fit: OfficerFitReader,
): number {
  return minutesWith(researchClockFor(repos, base, fit), spec);
}

/** Why a rung cannot be started, in the player's words, or `null`. */
export function itemBlocker(base: Base, id: string, fit: OfficerFitReader): string | null {
  const spec = findResearchItem(id);
  if (!spec) return 'No such research';
  const refusal = researchItemRefusal(
    id,
    base.research.technologies,
    chairMarksFor(spec.track, fit),
    buildingLevel(base.buildings, 'lab'),
  );
  return refusal === null ? null : describeResearchItemRefusal(refusal, spec);
}

/**
 * The whole catalogue, with each rung's state worked out for this crew.
 *
 * Everything that does not depend on the rung is computed once, up front. `GET /research` is
 * polled every fifteen seconds and this answers 130 rungs; folding the crew's standing effects and
 * re-reading every chair inside the loop meant a territory-and-roster fold per rung (180 per read
 * when the catalogue was 170 rungs), which is the whole cost of the route for a number that is the
 * same on every row.
 */
export function labResearchItems(
  repos: Repositories,
  base: Base,
  fit: OfficerFitReader,
): LabTech[] {
  const known = new Set(base.research.technologies);
  const clock = researchClockFor(repos, base, fit);
  const labLevel = buildingLevel(base.buildings, 'lab');
  const labCut = labResearchCostCut(base.buildings);
  const headMark = fit.markFor('researcher');
  const perTrack = new Map(
    RESEARCH_TRACKS.map((role) => [role, { chairs: { trackMark: fit.markFor(role), headMark } }]),
  );

  return RESEARCH_ITEMS.map((spec) => {
    const track = perTrack.get(spec.track);
    const refusal = known.has(spec.id)
      ? null
      : researchItemRefusal(
          spec.id,
          base.research.technologies,
          track?.chairs ?? NO_CHAIRS,
          labLevel,
        );
    return {
      id: spec.id,
      track: spec.track,
      step: spec.step,
      name: spec.name,
      description: spec.description,
      cost: researchItemPrice(spec, labCut),
      minutes: minutesWith(clock, spec),
      effect: describeResearchPayout(spec),
      requiresMark: spec.requiresMark,
      requiresHeadMark: spec.requiresHeadMark,
      known: known.has(spec.id),
      blocker: refusal === null ? null : describeResearchItemRefusal(refusal, spec),
    };
  });
}

const NO_CHAIRS: ChairMarks = { trackMark: null, headMark: null };
