import {
  OFFICER_ROLES,
  RESEARCH_ITEMS,
  createCommander,
  itemsInTrack,
  makeAttributes,
  markFromPoints,
  researchItemMinutes,
  researchItemPrice,
  researchTimeCutPercent,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  trackCostCutPercent,
  withReduction,
  type Base,
  type Commander,
  type Overseer,
  type OverseerPreset,
  type ResearchState,
  OVERSEER_PRESETS,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { standingEffectsFor } from '../crew/standing.js';
import { roleFit, weightedAttributesOf } from '../roles/requirements.js';
import { settleResearch } from './settle.js';
import { startResearch } from './start.js';
import {
  itemBlocker,
  labResearchItems,
  minutesFor,
  priceOf,
  researchHead,
  trackStatuses,
  PUBLISHED_CUT_GRAIN,
} from './tracks.js';

/**
 * §C on the server: the half that reads the score.
 *
 * Everything about the ladder itself is asserted in `packages/shared/src/research/tracks.test.ts`,
 * where it belongs. What is here is the part that cannot live in shared at all: the Head of
 * Research's points shortening the clock, the track officer's points shortening the bill, and the
 * two of them not doing each other's job (§C1d, §C3a, §C3b).
 */

const NOW = new Date('2026-09-03T09:00:00.000Z');
const MINUTE_MS = 60_000;

const [firstPreset] = OVERSEER_PRESETS;
if (!firstPreset) throw new Error('expected an overseer preset');
const PRESET: OverseerPreset = firstPreset;

const overseer: Overseer = {
  id: 'ov-1',
  name: PRESET.name,
  archetype: PRESET.archetype,
  portraitId: PRESET.portraitId,
  bio: PRESET.bio,
  attributes: PRESET.attributes,
  perks: PRESET.perks,
};

/**
 * An officer whose score in their own chair is exactly `points`.
 *
 * A flat sheet is the one input where that is true whatever the chair weighs, which is what makes
 * it usable here: every test below is about a *score*, and building one attribute at a time would
 * make each expectation depend on a table this file must not describe.
 */
function officerAt(id: string, role: Commander['role'], points: number): Commander {
  const officer = createCommander(id, `Officer ${id}`, role, makeAttributes(points));
  if (role !== null) expect(roleFit(officer.attributes, role)).toBeCloseTo(points, 10);
  return officer;
}

function makeBase(commanders: Commander[], research = startingResearch()): Base {
  return {
    id: 'base-1',
    ownerId: 'user-1',
    name: 'Test Hold',
    districtId: 'neon-docks',
    level: 1,
    isBot: false,
    resources: {
      caps: 500_000,
      supplies: 9000,
      oil: 9000,
      scrap: 500_000,
      highQualityMetal: 9000,
      planks: 9000,
    },
    economy: startingEconomy(NOW.toISOString()),
    progression: startingProgression(),
    research,
    buildings: [],
    buildQueue: [],
    army: {},
    trainingQueue: [],
    training: startingTraining('2026-09-06T00:00:00.000Z'),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders,
    createdAt: NOW.toISOString(),
  };
}

function fakeRepos(): {
  repos: Parameters<typeof settleResearch>[0];
  written: { research?: ResearchState; caps?: number; scrap?: number };
} {
  const written: { research?: ResearchState; caps?: number; scrap?: number } = {};
  const repos = {
    bases: {
      updateResearch: (_id: string, research: ResearchState) => {
        written.research = research;
      },
      updateResources: (_id: string, resources: { caps: number; scrap: number }) => {
        written.caps = resources.caps;
        written.scrap = resources.scrap;
      },
      updateEconomy: () => undefined,
      updateCommanders: () => undefined,
      updateProgression: () => undefined,
      updateAddons: () => undefined,
      updateDistrict: () => undefined,
    },
    overseers: { updateAttributes: () => undefined },
    city: { controls: () => new Map() },
    users: { findById: () => undefined },
  } as unknown as Parameters<typeof settleResearch>[0];
  return { repos, written };
}

/** The first rung of the Chief Medic's track: the one nothing but the two chairs can shut. */
const FIRST_MEDIC = itemsInTrack('chief_medic')[0];
if (!FIRST_MEDIC) throw new Error('the Chief Medic track has no first rung');

/** The deepest rung of the same track, where a rounded minute is a smaller share of the clock. */
const LAST_MEDIC = itemsInTrack('chief_medic')[9];
if (!LAST_MEDIC) throw new Error('the Chief Medic track has no tenth rung');

/**
 * Two Heads of Research whose chairs score differently and whose crews research at the same speed.
 *
 * The crew's own research speed is a fold over everybody's sheet (`crew/standing.ts`), so two
 * bases that differ in an officer's sheet usually differ in that channel too, and a clock
 * comparison between them would be measuring two levers at once. Intuition is the way out: the
 * `head_of_research` chair weighs it heavily and nothing feeding research speed reads it at all,
 * so moving it alone moves the score and leaves the crew where it was. The test below asserts
 * that as a control rather than trusting it.
 */
const DIM_HEAD = createCommander('h', 'Dim Head', 'head_of_research', makeAttributes(20));
const SHARP_HEAD = createCommander('h', 'Sharp Head', 'head_of_research', {
  ...makeAttributes(20),
  intuition: 100,
});

/** Starts a rung and hands back what landed on the row and what was charged. */
function start(base: Base, techId: string) {
  const { repos, written } = fakeRepos();
  const result = startResearch(repos, {
    base,
    overseer,
    project: { kind: 'technology', techId },
    id: 'r-1',
    now: NOW,
  });
  return { result, written };
}

describe('§C3a: the Head of Research shortens every clock', () => {
  /**
   * The Head's cut, isolated as a ratio.
   *
   * The absolute minutes also carry the Lab's reduction and the crew's own research speed, and
   * both of those are somebody else's numbers to tune. A ratio between two clocks that differ only
   * in the Head cancels them, so what is left is the one thing §C3a asks for. The figures are
   * written out: a Head at 12 points buys (2/90) x 45 = 1.0%, one at 93 buys (83/90) x 45 = 41.5%,
   * so the second clock is 58.5/99 = 0.5909 of the first.
   */
  it('cuts the clock by the percentage their points buy, and by nothing else', () => {
    const { repos } = fakeRepos();
    const dim = makeBase([DIM_HEAD]);
    const sharp = makeBase([SHARP_HEAD]);

    // The control. Without this the ratio below is a comparison of two things that also differ in
    // the crew's own research speed, and it would pass on a build where the Head's cut did nothing.
    expect(standingEffectsFor(repos, sharp, NOW).researchSpeedPercent).toBe(
      standingEffectsFor(repos, dim, NOW).researchSpeedPercent,
    );
    expect(roleFit(SHARP_HEAD.attributes, 'head_of_research')).toBeGreaterThan(
      roleFit(DIM_HEAD.attributes, 'head_of_research'),
    );

    /*
     * Written out. A Head at 20 points buys (10/90) x 45 = 5.0%; the same sheet with Intuition at
     * the ceiling scores 38.46, which buys (28.46/90) x 45 = 14.23%. The second clock is therefore
     * 85.77/95 = 0.9028 of the first, and every other reduction cancels out of the ratio.
     */
    const slow = minutesFor(repos, dim, LAST_MEDIC);
    const quick = minutesFor(repos, sharp, LAST_MEDIC);
    expect(quick).toBeLessThan(slow);
    expect(quick / slow).toBeCloseTo(0.9028, 2);

    // A crew with nothing at all pays the catalogue clock, which anchors the scale.
    expect(minutesFor(repos, makeBase([]), LAST_MEDIC)).toBe(LAST_MEDIC.minutes);
    expect(LAST_MEDIC.minutes).toBe(270);
  });

  it('carries the cut through to the row the project actually runs on', () => {
    const { repos } = fakeRepos();
    const medic = officerAt('m', 'chief_medic', 93);
    const dim = makeBase([medic, DIM_HEAD]);
    const sharp = makeBase([medic, SHARP_HEAD]);

    // Same control as above: the two crews research at the same speed, so anything that moves
    // between them moved because of the Head's own score.
    expect(standingEffectsFor(repos, sharp, NOW).researchSpeedPercent).toBe(
      standingEffectsFor(repos, dim, NOW).researchSpeedPercent,
    );

    const slow = start(dim, FIRST_MEDIC.id);
    const quick = start(sharp, FIRST_MEDIC.id);
    if (slow.result.kind !== 'started' || quick.result.kind !== 'started') {
      throw new Error('expected both to start');
    }
    expect(quick.result.active.durationMinutes).toBeLessThan(slow.result.active.durationMinutes);
    // ...and the row runs on the rung's own clock, not on the desk table: 45 catalogue minutes
    // rather than the 45 an investigation happens to share, so the tenth rung settles it.
    expect(FIRST_MEDIC.minutes).toBe(45);
    expect(minutesFor(repos, makeBase([]), LAST_MEDIC)).toBe(270);
  });

  it('moves when a single attribute the chair reads is trained by one point', () => {
    const weakest = weightedAttributesOf('head_of_research').at(-1);
    if (!weakest) throw new Error('the chair reads nothing');
    const before = makeAttributes(40);
    const after = { ...before, [weakest]: before[weakest] + 1 };

    const beforePoints = roleFit(before, 'head_of_research');
    const afterPoints = roleFit(after, 'head_of_research');
    expect(afterPoints).toBeGreaterThan(beforePoints);
    // Both sit inside one mark band, so the letter cannot be what moved.
    expect(markFromPoints(afterPoints)).toBe(markFromPoints(beforePoints));
    expect(researchTimeCutPercent(afterPoints)).toBeGreaterThan(
      researchTimeCutPercent(beforePoints),
    );
  });

  it('reports the cut on the wire, and nothing to work the score back from beyond a tenth', () => {
    const head = researchHead(makeBase([officerAt('h', 'head_of_research', 55)]));
    expect(head).toEqual({ name: 'Officer h', mark: markFromPoints(55), timeCutPercent: 22.5 });
    expect(researchHead(makeBase([]))).toBeNull();
  });
});

describe('§C1d: the track officer shortens the bill, and only the bill', () => {
  it('charges less the better the officer in that chair is', () => {
    const head = officerAt('h', 'head_of_research', 12);
    const cheap = start(makeBase([officerAt('m', 'chief_medic', 93), head]), FIRST_MEDIC.id);
    const dear = start(makeBase([officerAt('m', 'chief_medic', 12), head]), FIRST_MEDIC.id);
    if (cheap.result.kind !== 'started' || dear.result.kind !== 'started') {
      throw new Error('expected both to start');
    }
    // 600 caps at the catalogue. A Chief Medic at 12 points buys (2/90) x 30 = 0.67% off, which
    // is 596; one at 93 buys (83/90) x 30 = 27.7%, which is 434.
    expect(dear.written.caps).toBe(500_000 - 596);
    expect(cheap.written.caps).toBe(500_000 - 434);
  });

  it('does not let the Head of Research discount anything', () => {
    const medic = officerAt('m', 'chief_medic', 40);
    const poor = priceOf(makeBase([medic, DIM_HEAD]), FIRST_MEDIC);
    const good = priceOf(makeBase([medic, SHARP_HEAD]), FIRST_MEDIC);
    expect(good).toEqual(poor);
    // The positive control: the medic's own chair does move this price.
    expect(
      priceOf(makeBase([officerAt('m', 'chief_medic', 93), DIM_HEAD]), FIRST_MEDIC).caps,
    ).toBeLessThan(poor.caps ?? 0);
  });

  it('puts the cut on the wire per track, and zero on a chair nobody is in', () => {
    const statuses = trackStatuses(makeBase([officerAt('m', 'chief_medic', 100)]));
    const medic = statuses.find((entry) => entry.role === 'chief_medic');
    const spy = statuses.find((entry) => entry.role === 'head_spy');
    expect(statuses).toHaveLength(19);
    expect(medic?.costCutPercent).toBe(30);
    expect(medic?.mark).toBe('S+');
    expect(spy).toEqual({
      role: 'head_spy',
      officerName: null,
      mark: null,
      costCutPercent: 0,
      done: 0,
    });
    expect(trackCostCutPercent(100)).toBe(30);
  });
});

/**
 * §B8: the response says a tenth of a percent, so a tenth of a percent is all it may be worth.
 *
 * Both cuts are monotone in a score the player never sees, so whatever the wire computes from one
 * is a reading of it. Rounding the *display* and then pricing off the raw number is the worst of
 * both: the card says 0.4% and the ten integer prices under it, each rounding a different catalogue
 * figure, put the score back at full precision. Measured over every score the scale admits, pricing
 * off the raw number leaves exactly one candidate and pricing off the published tenth leaves four.
 *
 * So the invariant is that the wire is a function of the figure it prints: two officers who publish
 * the same cut are indistinguishable in everything derived from it. Both tests below build that
 * pair out of one flat sheet and one attribute lifted by a point, and both carry the control that
 * the raw scores really do part company.
 */
describe('§B8: the price and the clock read the published cut, not the score', () => {
  /** A flat sheet with the `rank`th most heavily weighted attribute of `role` lifted by a point. */
  function lifted(role: 'chief_medic' | 'head_of_research', points: number, rank: number) {
    const name = weightedAttributesOf(role)[rank];
    if (!name) throw new Error(`the ${role} chair reads fewer than ${rank + 1} attributes`);
    const flat = makeAttributes(points);
    return { ...flat, [name]: flat[name] + 1 };
  }

  it('quotes one price for two medics whose cuts round to the same tenth', () => {
    const { repos } = fakeRepos();
    // 11 + 1/13 and 11 + 3/13 points: 0.359% and 0.410% off, both printed as 0.4%.
    const near = createCommander('a', 'Officer a', 'chief_medic', lifted('chief_medic', 11, 4));
    const far = createCommander('b', 'Officer b', 'chief_medic', lifted('chief_medic', 11, 1));
    const nearPoints = roleFit(near.attributes, 'chief_medic');
    const farPoints = roleFit(far.attributes, 'chief_medic');

    // The pair is only worth anything if the two scores differ and the two printed cuts do not.
    expect(farPoints).toBeGreaterThan(nearPoints);
    const printed = (officer: Commander) =>
      trackStatuses(makeBase([officer])).find((entry) => entry.role === 'chief_medic')
        ?.costCutPercent;
    expect(printed(near)).toBe(0.4);
    expect(printed(far)).toBe(0.4);

    const priced = (officer: Commander) =>
      labResearchItems(repos, makeBase([officer]))
        .filter((item) => item.track === 'chief_medic')
        .map((item) => item.cost);
    expect(priced(far)).toEqual(priced(near));

    // The control: off the raw scores these two are not the same bill, so the equality above is
    // the rounding doing its job rather than ten rungs that were never going to differ.
    const raw = (points: number) =>
      itemsInTrack('chief_medic').map((spec) =>
        researchItemPrice(spec, trackCostCutPercent(points)),
      );
    expect(raw(farPoints)).not.toEqual(raw(nearPoints));
  });

  it('runs one clock for two Heads whose cuts round to the same tenth', () => {
    const { repos } = fakeRepos();
    // 11 and 11 + 1/13 points: 0.500% and 0.538% off the clock, both printed as 0.5%.
    const flat = officerAt('a', 'head_of_research', 11);
    const nudged = createCommander(
      'b',
      'Officer b',
      'head_of_research',
      lifted('head_of_research', 11, 4),
    );
    const flatPoints = roleFit(flat.attributes, 'head_of_research');
    const nudgedPoints = roleFit(nudged.attributes, 'head_of_research');
    expect(nudgedPoints).toBeGreaterThan(flatPoints);
    expect(researchHead(makeBase([flat]))?.timeCutPercent).toBe(0.5);
    expect(researchHead(makeBase([nudged]))?.timeCutPercent).toBe(0.5);

    // The other two reductions in the clock are the Lab and the crew's own research speed. Neither
    // may move between the two bases, or a difference in the clock would not be about the cut.
    expect(standingEffectsFor(repos, makeBase([nudged])).researchSpeedPercent).toBe(
      standingEffectsFor(repos, makeBase([flat])).researchSpeedPercent,
    );

    const clocked = (officer: Commander) =>
      labResearchItems(repos, makeBase([officer])).map((item) => item.minutes);
    expect(clocked(nudged)).toEqual(clocked(flat));

    // The control: off the raw scores the two clocks part company on at least one rung.
    const raw = (points: number) =>
      RESEARCH_ITEMS.map((spec) =>
        Math.max(
          1,
          Math.round(withReduction(researchItemMinutes(spec.step), researchTimeCutPercent(points))),
        ),
      );
    expect(raw(nudgedPoints)).not.toEqual(raw(flatPoints));
  });
});

describe('§C1b/§C1c: the gates, at the seam the route uses', () => {
  it('refuses a rung with no Head of Research, and says so', () => {
    const base = makeBase([officerAt('m', 'chief_medic', 93)]);
    expect(start(base, FIRST_MEDIC.id).result).toEqual({ kind: 'refused', reason: 'locked' });
    expect(itemBlocker(base, FIRST_MEDIC.id)).toBe('Needs a Head of Research');
  });

  it('refuses a rung whose own chair is empty', () => {
    const base = makeBase([officerAt('h', 'head_of_research', 93)]);
    expect(start(base, FIRST_MEDIC.id).result).toEqual({ kind: 'refused', reason: 'locked' });
    expect(itemBlocker(base, FIRST_MEDIC.id)).toBe('Needs a Chief Medic');
  });

  it('refuses an officer under the rung mark, and lets them through at it', () => {
    const fourth = itemsInTrack('chief_medic')[3];
    if (!fourth) throw new Error('need a fourth rung');
    const done = itemsInTrack('chief_medic')
      .filter((spec) => spec.step < 4)
      .map((spec) => spec.id);
    const research = { ...startingResearch(), technologies: done };

    // The rung wants E- from the medic and E from the Head. A medic at F- is short.
    const short = makeBase(
      [officerAt('m', 'chief_medic', 12), officerAt('h', 'head_of_research', 93)],
      research,
    );
    expect(itemBlocker(short, fourth.id)).toBe('Your Chief Medic must be E- or better');

    // 29 points is an E, which clears the E- the rung asks of the medic.
    const enough = makeBase(
      [officerAt('m', 'chief_medic', 29), officerAt('h', 'head_of_research', 93)],
      research,
    );
    expect(itemBlocker(enough, fourth.id)).toBeNull();

    // ...and the Head's own threshold is separately real.
    const shortHead = makeBase(
      [officerAt('m', 'chief_medic', 93), officerAt('h', 'head_of_research', 12)],
      research,
    );
    expect(itemBlocker(shortHead, fourth.id)).toBe('Your Head of Research must be E or better');
  });

  it('refuses what is already done, and admin mode does not waive that', () => {
    const base = makeBase(
      [officerAt('m', 'chief_medic', 93), officerAt('h', 'head_of_research', 93)],
      { ...startingResearch(), technologies: [FIRST_MEDIC.id] },
    );
    const { repos } = fakeRepos();
    const result = startResearch(repos, {
      base,
      overseer,
      project: { kind: 'technology', techId: FIRST_MEDIC.id },
      id: 'r-1',
      now: NOW,
      admin: true,
    });
    expect(result).toEqual({ kind: 'refused', reason: 'already_researched' });
  });

  it('lets the testing build walk past a shut chair', () => {
    const { repos } = fakeRepos();
    const result = startResearch(repos, {
      base: makeBase([]),
      overseer,
      project: { kind: 'technology', techId: FIRST_MEDIC.id },
      id: 'r-1',
      now: NOW,
      admin: true,
    });
    expect(result.kind).toBe('started');
  });

  it('refuses a rung that does not exist', () => {
    const base = makeBase([
      officerAt('m', 'chief_medic', 93),
      officerAt('h', 'head_of_research', 93),
    ]);
    expect(start(base, 'tech_nothing_at_all').result).toEqual({
      kind: 'refused',
      reason: 'unknown_research',
    });
  });
});

describe('a finished rung', () => {
  it('lands on the crew as a finished technology, once', () => {
    const base = makeBase([
      officerAt('m', 'chief_medic', 93),
      officerAt('h', 'head_of_research', 93),
    ]);
    const { repos } = fakeRepos();
    const started = startResearch(repos, {
      base,
      overseer,
      project: { kind: 'technology', techId: FIRST_MEDIC.id },
      id: 'r-1',
      now: NOW,
    });
    if (started.kind !== 'started') throw new Error(`refused: ${started.reason}`);

    const after = new Date(NOW.getTime() + started.active.durationMinutes * MINUTE_MS);
    const settled = settleResearch(repos, started.base, overseer, after);
    expect(settled.base.research.technologies).toEqual([FIRST_MEDIC.id]);
    expect(settled.base.research.active).toBeNull();

    // Settling the same landed row twice cannot bank a second copy: the row is already cleared.
    const again = settleResearch(repos, settled.base, overseer, after);
    expect(again.base.research.technologies).toEqual([FIRST_MEDIC.id]);
  });
});

describe('the catalogue on the wire', () => {
  it('ships every rung, priced and clocked for this crew, with a reason for each shut one', () => {
    const { repos } = fakeRepos();
    const base = makeBase([
      officerAt('m', 'chief_medic', 93),
      officerAt('h', 'head_of_research', 93),
    ]);
    const shipped = labResearchItems(repos, base);
    expect(shipped).toHaveLength(RESEARCH_ITEMS.length);

    const first = shipped.find((item) => item.id === FIRST_MEDIC.id);
    expect(first?.blocker).toBeNull();
    // Discounted by the medic's own sheet, and clocked with the Head's cut on it.
    expect(first?.cost.caps).toBeLessThan(FIRST_MEDIC.cost.caps ?? 0);
    expect(first?.minutes).toBeLessThan(FIRST_MEDIC.minutes);

    // Every rung that is not startable says why, in words a player can act on.
    for (const item of shipped) {
      if (item.blocker === null || item.known) continue;
      expect(item.blocker.length, item.id).toBeGreaterThan(4);
    }
    // A track with nobody on it is shut on the chair rather than on the mark.
    const spyRung = shipped.find((item) => item.track === 'head_spy' && item.step === 1);
    expect(spyRung?.blocker).toBe('Needs a Head Spy');
  });

  /**
   * The catalogue projection hoists the crew fold, the head cut and the nineteen chairs out of its
   * loop, because doing them per rung is 190 folds on a route polled every fifteen seconds. That
   * makes it a second implementation of three answers, and a second implementation drifts.
   */
  it('agrees rung for rung with the one-at-a-time paths it was optimised away from', () => {
    const { repos } = fakeRepos();
    const base = makeBase([
      officerAt('m', 'chief_medic', 40),
      officerAt('s', 'scout', 93),
      officerAt('h', 'head_of_research', 55),
    ]);
    const shipped = labResearchItems(repos, base);
    for (const item of shipped) {
      const spec = RESEARCH_ITEMS.find((entry) => entry.id === item.id);
      if (!spec) throw new Error(`no spec for ${item.id}`);
      expect(item.cost, item.id).toEqual(priceOf(base, spec));
      expect(item.minutes, item.id).toBe(minutesFor(repos, base, spec));
      expect(item.blocker, item.id).toBe(itemBlocker(base, spec.id));
    }
    // The control: the three chairs above mean the answers are not all the same anyway.
    expect(new Set(shipped.map((item) => item.blocker)).size).toBeGreaterThan(2);
    expect(new Set(shipped.map((item) => item.minutes)).size).toBe(10);
  });
});

/**
 * §B8: nothing on the research payload is finer than the grain we chose to publish at.
 *
 * The leak is not a bug that gets fixed once, it is a property that erodes. Every figure here is a
 * monotone function of one seated officer's `roleFit`, so any new field derived from a cut, or an
 * existing one that stops going through `published`, quietly puts the score back on the wire at
 * full precision. That is exactly how it shipped: the card printed a tenth while the prices were
 * computed off the raw number, and ten integer prices between them pinned the score exactly.
 *
 * So this asserts the property rather than the fix. It fails on a new unrounded field without
 * anybody having to remember this file exists.
 */
describe('the research payload publishes nothing finer than its grain (§B8)', () => {
  const onGrain = (value: number): boolean => {
    const steps = value / PUBLISHED_CUT_GRAIN;
    return Math.abs(steps - Math.round(steps)) < 1e-9;
  };

  /** A sheet whose weighted score is a repeating fraction, so rounding has something to do. */
  const awkward = (role: Exclude<Commander['role'], null>, id: string): Commander => {
    const officer = createCommander(id, `Officer ${id}`, role, makeAttributes(61));
    return { ...officer, attributes: { ...officer.attributes, logic: 62, reflexes: 47 } };
  };

  it('has a fixture whose raw cuts are off the grain, or it proves nothing', () => {
    const officer = awkward('head_spy', 'probe');
    const raw = trackCostCutPercent(roleFit(officer.attributes, 'head_spy'));
    expect(onGrain(raw), `raw cut ${raw} is already on the grain, so rounding is untestable`).toBe(
      false,
    );
  });

  it('rounds every percentage it ships to the grain', () => {
    const seated = OFFICER_ROLES.map((role) => awkward(role, `off-${role}`));
    const base = makeBase(seated);

    const offGrain: string[] = [];
    for (const status of trackStatuses(base)) {
      if (!onGrain(status.costCutPercent)) {
        offGrain.push(`${status.role}.costCutPercent=${status.costCutPercent}`);
      }
    }
    const head = researchHead(base);
    expect(
      head,
      'the fixture seated no Head of Research, so half the payload is unchecked',
    ).not.toBeNull();
    if (head && !onGrain(head.timeCutPercent)) {
      offGrain.push(`head.timeCutPercent=${head.timeCutPercent}`);
    }
    expect(offGrain, 'these ship at a finer grain than we publish at').toEqual([]);
  });
});
