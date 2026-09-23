import {
  RESEARCH_ITEMS,
  describeResearchItemRefusal,
  describeResearchPayout,
  findResearchItem,
  markFromPoints,
  researchItemMinutes,
  researchItemPrice,
  researchItemRefusal,
  researchTimeCutPercent,
  researchTimeReduction,
  speedMultiplier,
  trackCostCutPercent,
  trackProgress,
  withReduction,
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
import { standingEffectsFor, type OfficerFitReader } from '../crew/standing.js';
import type { Repositories } from '../db/repos/index.js';
import { workingOfficer } from '../crew/roster.js';

/**
 * §C: what the nineteen research tracks cost this particular crew, and which of them are open.
 *
 * This is the only module in the feature that reads the hidden requirement table, and it is
 * server-side for that reason (§B8, §B8a). What leaves it is a **mark**, which is the coarse hint
 * the guard's own note allows, and two percentages derived from the score. Nothing else: no score,
 * nothing keyed by role.
 *
 * ## Why the percentages ship at all
 *
 * §C3a asks for the Head of Research's points to cut the clock and §C3b asks that every bonus read
 * the points rather than the letter, so that training moves the number. A player who cannot see
 * the cut cannot tell whether the afternoon they spent training bought anything, and the duration
 * on the card gives it away regardless. So the derived figure ships and the score does not.
 */

/** The officer sitting in a chair, or `undefined`. */
function seated(base: Base, role: OfficerRole): Commander | undefined {
  // Working, not merely seated (maintainer, 2026-09-23): an injured officer's track stops with
  // the rest of what they were worth, for the twelve hours they are out.
  return workingOfficer(base.commanders, role);
}

/**
 * The one precision either derived percentage is ever seen at, in percentage points.
 *
 */
/**
 * How coarsely a cut is published, and the one dial on the §B8 trade.
 *
 * Every published figure is a monotone function of one seated officer's `roleFit`, so seating
 * officers one at a time and reading them back always recovers a role's weight vector eventually.
 * Only the grain sets the price of that attack. Measured against real Bar rosters, counting
 * officers seated per role until the vector is unique (all 19 roles recovered correctly every run):
 *
 * | grain | officers per role, mean / worst |
 * | ----- | ------------------------------ |
 * | 0.1   | 5.6 / 7                        |
 * | 0.5   | 13.0 / 26                      |
 * | 1     | 23.7 / 43                      |
 * | 2     | 42.7 / 80                      |
 * | 5     | 60.7 / 109                     |
 *
 * For scale: the marks alone, with no research payload at all, cost 30.3 per role, and recruit
 * sheets already let the table be reconstructed without seating anybody (MOU-160 F1). So the
 * research payload is currently the cheapest route in, by about five times.
 *
 * It stays at a tenth because §C3b is an explicit requirement and coarsening breaks it: one point
 * of training in the chair's primary attribute moves the score by 5/13, so it moves the cost cut by
 * 0.128 and the time cut by 0.192. At a 1 grain a player trains eight points before the card
 * changes, which is the opposite of what C3b asks for. Buying parity with the marks costs C3b, and
 * that is a balance call rather than an engineering one.
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
  return Math.round(percent / PUBLISHED_CUT_GRAIN) * PUBLISHED_CUT_GRAIN;
}

/** Every role has a track, and the response ships them in the catalogue's own order. */
const RESEARCH_TRACKS: readonly OfficerRole[] = [
  ...new Set(RESEARCH_ITEMS.map((spec) => spec.track)),
];

/**
 * §C1c/§C3a: the Head of Research, and what their sheet takes off every research clock.
 *
 * Every figure on this page is measured through {@link officerFitReader}, which reads the sheet an
 * officer actually has rather than the one printed on their card. The Lab used to read
 * `officer.attributes` at all five of these sites, so the Overseer's teaching perks, the peers'
 * perks, the ground's `officer_group` and the Lab's own `officer_attribute` rungs raised a number
 * that gated nothing: a crew could finish Field Promotions and watch every research gate refuse
 * the officer it had just promoted.
 */
export function researchHead(base: Base, fit: OfficerFitReader): ResearchHead | null {
  const officer = seated(base, 'head_of_research');
  if (!officer) return null;
  const points = fit.pointsFor(officer, 'head_of_research');
  return {
    name: officer.name,
    mark: markFromPoints(points),
    timeCutPercent: published(researchTimeCutPercent(points)),
  };
}

/** §C1d: what the track's own officer takes off every price on their own track, as published. */
function trackCostCutFor(base: Base, track: OfficerRole, fit: OfficerFitReader): number {
  const officer = seated(base, track);
  return officer ? published(trackCostCutPercent(fit.pointsFor(officer, track))) : 0;
}

/** The two chairs a rung is gated on (§C1b, §C1c). */
export function chairMarksFor(track: OfficerRole, fit: OfficerFitReader): ChairMarks {
  return {
    trackMark: fit.markFor(track),
    headMark: fit.markFor('head_of_research'),
  };
}

/** The nineteen tracks in `OFFICER_ROLES` order, with who is standing on each. */
export function trackStatuses(base: Base, fit: OfficerFitReader): ResearchTrackStatus[] {
  return RESEARCH_TRACKS.map((role) => {
    const officer = seated(base, role);
    return {
      role,
      officerName: officer?.name ?? null,
      mark: fit.markFor(role),
      costCutPercent: trackCostCutFor(base, role, fit),
      done: trackProgress(base.research.technologies, role),
    };
  });
}

/** What this crew would actually pay for a rung, with the track officer's cut applied. */
export function priceOf(
  base: Base,
  spec: ResearchItemSpec,
  fit: OfficerFitReader,
): PartialResources {
  return researchItemPrice(spec, trackCostCutFor(base, spec.track, fit));
}

/**
 * The three cuts a research clock gets, none of which depends on which rung is being run.
 *
 * Read once per request rather than once per rung: `standingEffectsFor` folds the whole city and
 * the whole roster, and doing that 190 times to answer one page is the difference between a read
 * that costs nothing and one that does not.
 */
interface ResearchClock {
  buildingPercent: number;
  crewSpeedPercent: number;
  headCutPercent: number;
}

function researchClockFor(repos: Repositories, base: Base, fit: OfficerFitReader): ResearchClock {
  const head = seated(base, 'head_of_research');
  return {
    buildingPercent: researchTimeReduction(base.buildings),
    crewSpeedPercent: standingEffectsFor(repos, base).researchSpeedPercent,
    headCutPercent: head
      ? published(researchTimeCutPercent(fit.pointsFor(head, 'head_of_research')))
      : 0,
  };
}

/**
 * How long a rung takes once those three are applied, in the order they are earned: the Lab
 * building, the crew's own research speed, then §C3a's Head of Research.
 *
 * Floored at a minute, because the whole screen is built around a clock and a project that lands
 * inside the request that started it never has one.
 */
function minutesWith(clock: ResearchClock, spec: ResearchItemSpec): number {
  const afterBuilding = withReduction(researchItemMinutes(spec.step), clock.buildingPercent);
  const afterCrew = afterBuilding / speedMultiplier(clock.crewSpeedPercent);
  return Math.max(1, Math.round(withReduction(afterCrew, clock.headCutPercent)));
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
  );
  return refusal === null ? null : describeResearchItemRefusal(refusal, spec);
}

/**
 * The whole catalogue, with each rung's state worked out for this crew.
 *
 * Everything that does not depend on the rung is computed once, up front. `GET /research` is
 * polled every fifteen seconds and this answers 190 rungs; folding the crew's standing effects and
 * re-reading nineteen chairs inside the loop meant 190 territory-and-roster folds per read, which
 * is the whole cost of the route for a number that is the same on every row.
 */
export function labResearchItems(
  repos: Repositories,
  base: Base,
  fit: OfficerFitReader,
): LabTech[] {
  const known = new Set(base.research.technologies);
  const clock = researchClockFor(repos, base, fit);
  const headMark = fit.markFor('head_of_research');
  const perTrack = new Map(
    RESEARCH_TRACKS.map((role) => {
      const officer = seated(base, role);
      return [
        role,
        {
          costCut: officer ? published(trackCostCutPercent(fit.pointsFor(officer, role))) : 0,
          chairs: { trackMark: fit.markFor(role), headMark },
        },
      ];
    }),
  );

  return RESEARCH_ITEMS.map((spec) => {
    const track = perTrack.get(spec.track);
    const refusal = known.has(spec.id)
      ? null
      : researchItemRefusal(spec.id, base.research.technologies, track?.chairs ?? NO_CHAIRS);
    return {
      id: spec.id,
      track: spec.track,
      step: spec.step,
      name: spec.name,
      description: spec.description,
      cost: researchItemPrice(spec, track?.costCut ?? 0),
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
