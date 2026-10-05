import {
  OFFICER_ROLES,
  RESEARCH_ITEMS,
  RESEARCH_TIME_KNEE,
  researchTimeCut,
  researchTimeReduction,
  createCommander,
  importanceOf,
  itemsInTrack,
  makeAttributes,
  markFromPoints,
  researchItemMinutes,
  researchTimeCutPercent,
  seatPoints,
  skillsThatMatter,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  withReduction,
  type Base,
  type Commander,
  type Overseer,
  type OverseerPreset,
  type ResearchState,
  OVERSEER_PRESETS,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { officerFitReader, standingEffectsFor, type OfficerFitReader } from '../crew/standing.js';
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
 * where it belongs. What is here is the part that cannot live in shared at all: the Researcher's
 * points shortening the clock, and nobody but the Lab shortening the bill (maintainer, 2026-10-04:
 * no officer cuts the price of a programme any more).
 */

const NOW = new Date('2026-09-03T09:00:00.000Z');

/**
 * The lifted-fit reader every projection on this page now takes.
 *
 * On an empty set of repos there is no Overseer, no held ground and no finished Lab rung, so the
 * lift is zero and every figure below is the one the officer's own sheet buys. Deliberate: these
 * tests are about the score, and the lift has a test of its own beside them.
 */
function fitFor(base: Base, repos = fakeRepos().repos): OfficerFitReader {
  return officerFitReader(repos, base, NOW);
}
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
 * An officer with every attribute at `rating`.
 *
 * A flat sheet scores the same in every chair, because every chair tags one irreplaceable, two
 * essential and four useful skills (2026-10-04): 12 reads as 10.50 seat points, 13 as 11.65, 20 as
 * 20.40, 29 as 31.39, 55 as 59.59 and 93 as 93.95. Every test below is about a *score*, and that is what
 * makes a flat sheet usable here.
 */
function officerAt(id: string, role: Commander['role'], rating: number): Commander {
  const officer = createCommander(id, `Officer ${id}`, role, makeAttributes(rating));
  if (role !== null) {
    expect(seatPoints(officer.attributes, role)).toBeCloseTo(
      seatPoints(makeAttributes(rating), 'veteran'),
      10,
    );
  }
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
    // A Lab at its top, so the tier gate (P7-C, 2026-10-02) opens every rung and the chairs are
    // what these tests measure.
    buildings: [{ id: 'lab', kind: 'lab', level: 20, modifications: [] }],
    buildQueue: [],
    army: {},
    musterQueue: [],
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
      pendingLevelUp: () => undefined,
      setPendingLevelUp: () => undefined,
      updateAddons: () => undefined,
      updateDistrict: () => undefined,
    },
    overseers: { updateAttributes: () => undefined },
    city: { controls: () => new Map() },
    users: { findById: () => undefined },
    // ...and at no table: the cards a faction deals are folded into the same standing.
    factions: { membershipOf: () => undefined },
    // ...and whether the crew's gate is breached, which zeroes what it gives.
    sieges: { gate: () => undefined },
  } as unknown as Parameters<typeof settleResearch>[0];
  return { repos, written };
}

/** The first rung of the Veteran's track: the one nothing but the two chairs can shut. */
const FIRST_MEDIC = itemsInTrack('veteran')[0];
if (!FIRST_MEDIC) throw new Error('the Veteran track has no first rung');

/** The deepest rung of the same track, where a rounded minute is a smaller share of the clock. */
const LAST_MEDIC = itemsInTrack('veteran')[9];
if (!LAST_MEDIC) throw new Error('the Veteran track has no tenth rung');

/**
 * Two Researchers whose chairs score differently and whose crews research at the same speed.
 *
 * The crew's own research speed (`standingEffectsFor`) is perks, ground and the Lab, and since
 * 2026-10-04 no officer's sheet feeds it: a chair's skills reach the crew only through its passive.
 * So the two bases differ in the Researcher's score and in nothing else a clock reads, and moving
 * Intuition, which the `researcher` chair weighs heavily, moves only that score. The test below
 * still asserts it as a control rather than trusting it.
 */
const DIM_HEAD = createCommander('h', 'Dim Head', 'researcher', makeAttributes(20));
const SHARP_HEAD = createCommander('h', 'Sharp Head', 'researcher', {
  ...makeAttributes(20),
  intuition: 100,
});

/** Starts a rung and hands back what landed on the row and what was charged. */
function start(base: Base, techId: string) {
  const { repos, written } = fakeRepos();
  const result = startResearch(repos, {
    base,
    project: { kind: 'technology', techId },
    id: 'r-1',
    now: NOW,
  });
  return { result, written };
}

describe('§C3a: the Researcher shortens every clock', () => {
  /**
   * The Head's cut, isolated as a ratio.
   *
   * The absolute minutes also carry the Lab's reduction and the crew's own research speed, and
   * both of those are somebody else's numbers to tune. A ratio between two clocks that differ only
   * in the Head cancels them, so what is left is the one thing §C3a asks for.
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
    expect(seatPoints(SHARP_HEAD.attributes, 'researcher')).toBeGreaterThan(
      seatPoints(DIM_HEAD.attributes, 'researcher'),
    );

    /*
     * Written out. A Head flat at 20 scores 19.70 seat points and buys (9.70/90) x 45 = 4.9%; the
     * same sheet with Intuition (essential) at the ceiling scores 30.39, which buys 10.2%. The
     * Head's points join the Lab's and the crew's on one sum (2026-10-01), and both crews sit under
     * the taper's knee, so the second clock is 5.3 points of the catalogue's minutes shorter and
     * every other source cancels out of the difference.
     */
    const slow = minutesFor(repos, dim, LAST_MEDIC, fitFor(dim, repos));
    const quick = minutesFor(repos, sharp, LAST_MEDIC, fitFor(sharp, repos));
    expect(quick).toBeLessThan(slow);
    expect((slow - quick) / LAST_MEDIC.minutes).toBeCloseTo(0.053, 2);

    // A crew with nothing at all pays the catalogue clock, which anchors the scale.
    expect(minutesFor(repos, makeBase([]), LAST_MEDIC, fitFor(makeBase([]), repos))).toBe(
      LAST_MEDIC.minutes,
    );
    expect(LAST_MEDIC.minutes).toBe(270);
  });

  /*
   * The Lab, its cards, the crew's research speed and the Head on one sum under one taper
   * (maintainer, 2026-10-01: "make them add"). A deep crew is past the knee, so the clock is the
   * taper of the sum, and not the three cuts one after another it used to be.
   */
  it('adds the Lab and its cards to the crew and the Head, under one taper', () => {
    const { repos } = fakeRepos();
    const lab: Base['buildings'] = [
      {
        id: 'lab',
        kind: 'lab',
        level: 20,
        modifications: ['lab_quantum_modeling', 'lab_neural_drafting_table'],
      },
    ];
    const deep = { ...makeBase([SHARP_HEAD]), buildings: lab };
    const fit = fitFor(deep, repos);
    const head = researchHead(fakeRepos().repos, deep, fit)!.timeCutPercent;
    const points =
      researchTimeReduction(lab) + standingEffectsFor(repos, deep, NOW).researchSpeedPercent + head;
    expect(points, 'the fixture has to be past the knee').toBeGreaterThan(RESEARCH_TIME_KNEE);
    expect(minutesFor(repos, deep, LAST_MEDIC, fit)).toBe(
      Math.round(LAST_MEDIC.minutes * (1 - researchTimeCut(points) / 100)),
    );
  });

  it('carries the cut through to the row the project actually runs on', () => {
    const { repos } = fakeRepos();
    const medic = officerAt('m', 'veteran', 93);
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
    // ...and the row runs on the rung's own clock rather than on one flat number for the whole
    // Lab: the first rung of a track and the tenth are hours apart, which is what settles it.
    expect(FIRST_MEDIC.minutes).toBe(45);
    expect(minutesFor(repos, makeBase([]), LAST_MEDIC, fitFor(makeBase([]), repos))).toBe(270);
  });

  /**
   * The Master of Whispers' clocks are the maintainer's ledger (2026-09-28), set by hand on the
   * catalogue rather than left to `researchItemMinutes`. The Lab read the formula by depth, so The
   * Whole Wire ran on 270 minutes where the ledger says 1000, and the page quoted the same.
   */
  it("runs a Master of Whispers rung on the ledger's clock, not the depth formula", () => {
    const { repos } = fakeRepos();
    const bare = makeBase([]);
    const fit = fitFor(bare, repos);
    const onThePage = new Map(labResearchItems(repos, bare, fit).map((row) => [row.id, row]));
    const track = itemsInTrack('master_of_whispers');
    // The control: the ledger and the formula part company, or this proves nothing.
    expect(track.filter((spec) => spec.minutes !== researchItemMinutes(spec.step)).length).toBe(8);
    for (const spec of track) {
      expect(minutesFor(repos, bare, spec, fit), spec.id).toBe(spec.minutes);
      expect(onThePage.get(spec.id)?.minutes, spec.id).toBe(spec.minutes);
    }
    expect(track.at(-1)?.minutes).toBe(1000);
  });

  it('moves when a single attribute the chair reads is trained by one point', () => {
    // A useful skill already past its tier: the cheapest point the chair still pays for.
    const weakest = skillsThatMatter('researcher').find(
      (name) => importanceOf('researcher', name) === 'useful',
    );
    if (!weakest) throw new Error('the chair tags nothing useful');
    const before = makeAttributes(40);
    const after = { ...before, [weakest]: before[weakest] + 1 };

    const beforePoints = seatPoints(before, 'researcher');
    const afterPoints = seatPoints(after, 'researcher');
    expect(afterPoints).toBeGreaterThan(beforePoints);
    // Both sit inside one mark band, so the letter cannot be what moved.
    expect(markFromPoints(afterPoints)).toBe(markFromPoints(beforePoints));
    expect(researchTimeCutPercent(afterPoints)).toBeGreaterThan(
      researchTimeCutPercent(beforePoints),
    );
  });

  it('reports the cut on the wire, and nothing to work the score back from beyond a tenth', () => {
    const head = researchHead(
      fakeRepos().repos,
      makeBase([officerAt('h', 'researcher', 55)]),
      fitFor(makeBase([officerAt('h', 'researcher', 55)])),
    );
    // Flat 55 is 59.59 seat points: a C+, and (49.59/90) x 50 = 27.5% off the clock. The crew's
    // own research points are nothing on this fixture now that skills stopped reaching the fold
    // (2026-10-04), so what the Researcher adds to the joined cut is the whole of it.
    expect(head).toEqual({
      name: 'Officer h',
      mark: 'C+',
      timeCutPercent: 27.5,
      addsPercent: 27.5,
    });
    expect(researchHead(fakeRepos().repos, makeBase([]), fitFor(makeBase([])))).toBeNull();
  });
});

describe('§C1d: nobody but the Lab shortens the bill (2026-10-04)', () => {
  it('charges the same whoever is in the chair', () => {
    const head = officerAt('h', 'researcher', 12);
    const sharp = start(makeBase([officerAt('m', 'veteran', 93), head]), FIRST_MEDIC.id);
    const dim = start(makeBase([officerAt('m', 'veteran', 13), head]), FIRST_MEDIC.id);
    if (sharp.result.kind !== 'started' || dim.result.kind !== 'started') {
      throw new Error('expected both to start');
    }
    // 600 caps at the catalogue, and the fixture's Lab at 20 takes 30% off (P7-C): 420 for both.
    expect(dim.written.caps).toBe(500_000 - 420);
    expect(sharp.written.caps).toBe(500_000 - 420);
  });

  it('does not let the Researcher discount anything, and the Lab does', () => {
    const medic = officerAt('m', 'veteran', 40);
    const poor = priceOf(makeBase([medic, DIM_HEAD]), FIRST_MEDIC);
    const good = priceOf(makeBase([medic, SHARP_HEAD]), FIRST_MEDIC);
    expect(good).toEqual(poor);
    // The positive control: the Lab's cut does move this price.
    const noLab = makeBase([medic, DIM_HEAD]);
    noLab.buildings = noLab.buildings.filter((building) => building.kind !== 'lab');
    expect(priceOf(noLab, FIRST_MEDIC).caps).toBeGreaterThan(poor.caps ?? 0);
  });

  it("puts the chair's passive on the wire per track, and nothing on a chair nobody is in", () => {
    const statuses = trackStatuses(
      makeBase([officerAt('m', 'veteran', 100)]),
      fitFor(makeBase([officerAt('m', 'veteran', 100)])),
    );
    const medic = statuses.find((entry) => entry.role === 'veteran');
    const spy = statuses.find((entry) => entry.role === 'master_of_whispers');
    expect(statuses).toHaveLength(OFFICER_ROLES.length);
    expect(medic?.passive).toBe('50% off the cost of mustering units.');
    expect(medic?.mark).toBe('S+');
    expect(spy).toEqual({
      role: 'master_of_whispers',
      officerName: null,
      mark: null,
      passive: null,
      done: 0,
    });
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
  /** A flat sheet at `rating` with one attribute lifted by a point. */
  function lifted(rating: number, name: 'dexterity' | 'medicine' | 'intuition' | 'logic') {
    const flat = makeAttributes(rating);
    return { ...flat, [name]: flat[name] + 1 };
  }

  it('runs one clock for two Heads whose cuts round to the same tenth', () => {
    const { repos } = fakeRepos();
    // Flat 14 with Logic (useful) or Intuition (essential) a point up: 1.653% and 1.667% off the
    // clock, both printed as 1.7%. No skill reaches the crew's own research speed any more, so it
    // cannot tell the two apart.
    const flat = createCommander('a', 'Officer a', 'researcher', lifted(14, 'logic'));
    const nudged = createCommander('b', 'Officer b', 'researcher', lifted(14, 'intuition'));
    const flatPoints = seatPoints(flat.attributes, 'researcher');
    const nudgedPoints = seatPoints(nudged.attributes, 'researcher');
    expect(nudgedPoints).toBeGreaterThan(flatPoints);
    expect(
      researchHead(fakeRepos().repos, makeBase([flat]), fitFor(makeBase([flat])))?.timeCutPercent,
    ).toBe(1.7);
    expect(
      researchHead(fakeRepos().repos, makeBase([nudged]), fitFor(makeBase([nudged])))
        ?.timeCutPercent,
    ).toBe(1.7);

    // The other two reductions in the clock are the Lab and the crew's own research speed. Neither
    // may move between the two bases, or a difference in the clock would not be about the cut.
    expect(standingEffectsFor(repos, makeBase([nudged])).researchSpeedPercent).toBe(
      standingEffectsFor(repos, makeBase([flat])).researchSpeedPercent,
    );

    const clocked = (officer: Commander) =>
      labResearchItems(repos, makeBase([officer]), fitFor(makeBase([officer]), repos)).map(
        (item) => item.minutes,
      );
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
  it('refuses a rung with no Researcher, and says so', () => {
    const base = makeBase([officerAt('m', 'veteran', 93)]);
    expect(start(base, FIRST_MEDIC.id).result).toEqual({ kind: 'refused', reason: 'locked' });
    expect(itemBlocker(base, FIRST_MEDIC.id, fitFor(base))).toBe('Needs a Researcher');
  });

  it('refuses a rung whose own chair is empty', () => {
    const base = makeBase([officerAt('h', 'researcher', 93)]);
    expect(start(base, FIRST_MEDIC.id).result).toEqual({ kind: 'refused', reason: 'locked' });
    expect(itemBlocker(base, FIRST_MEDIC.id, fitFor(base))).toBe('Needs a Veteran');
  });

  it('refuses an officer under the rung mark, and lets them through at it', () => {
    const fourth = itemsInTrack('veteran')[3];
    if (!fourth) throw new Error('need a fourth rung');
    const done = itemsInTrack('veteran')
      .filter((spec) => spec.step < 4)
      .map((spec) => spec.id);
    const research = { ...startingResearch(), technologies: done };

    // The rung wants E- from the medic and E from the Head. A medic at F- is short.
    const short = makeBase(
      [officerAt('m', 'veteran', 12), officerAt('h', 'researcher', 93)],
      research,
    );
    expect(itemBlocker(short, fourth.id, fitFor(short))).toBe('Your Veteran must be E- or better');

    // Flat 29 is 30.56 seat points, an E, which clears the E- the rung asks of the medic.
    const enough = makeBase(
      [officerAt('m', 'veteran', 29), officerAt('h', 'researcher', 93)],
      research,
    );
    expect(itemBlocker(enough, fourth.id, fitFor(enough))).toBeNull();

    // ...and the Head's own threshold is separately real.
    const shortHead = makeBase(
      [officerAt('m', 'veteran', 93), officerAt('h', 'researcher', 12)],
      research,
    );
    expect(itemBlocker(shortHead, fourth.id, fitFor(shortHead))).toBe(
      'Your Researcher must be E or better',
    );
  });

  it('refuses what is already done, and admin mode does not waive that', () => {
    const base = makeBase([officerAt('m', 'veteran', 93), officerAt('h', 'researcher', 93)], {
      ...startingResearch(),
      technologies: [FIRST_MEDIC.id],
    });
    const { repos } = fakeRepos();
    const result = startResearch(repos, {
      base,
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
      project: { kind: 'technology', techId: FIRST_MEDIC.id },
      id: 'r-1',
      now: NOW,
      admin: true,
    });
    expect(result.kind).toBe('started');
  });

  it('refuses a rung that does not exist', () => {
    const base = makeBase([officerAt('m', 'veteran', 93), officerAt('h', 'researcher', 93)]);
    expect(start(base, 'tech_nothing_at_all').result).toEqual({
      kind: 'refused',
      reason: 'unknown_research',
    });
  });
});

describe('a finished rung', () => {
  it('lands on the crew as a finished technology, once', () => {
    const base = makeBase([officerAt('m', 'veteran', 93), officerAt('h', 'researcher', 93)]);
    const { repos } = fakeRepos();
    const started = startResearch(repos, {
      base,
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
    const base = makeBase([officerAt('m', 'veteran', 93), officerAt('h', 'researcher', 93)]);
    const shipped = labResearchItems(repos, base, fitFor(base, repos));
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
    const spyRung = shipped.find((item) => item.track === 'master_of_whispers' && item.step === 1);
    expect(spyRung?.blocker).toBe('Needs a Master of Whispers');
  });

  /**
   * The catalogue projection hoists the crew fold, the head cut and the thirteen chairs out of its
   * loop, because doing them per rung is a fold per rung, 130 of them, on a route polled every fifteen seconds. That
   * makes it a second implementation of three answers, and a second implementation drifts.
   */
  it('agrees rung for rung with the one-at-a-time paths it was optimised away from', () => {
    const { repos } = fakeRepos();
    const base = makeBase([
      officerAt('m', 'veteran', 40),
      officerAt('s', 'cartographer', 93),
      officerAt('h', 'researcher', 55),
    ]);
    const shipped = labResearchItems(repos, base, fitFor(base, repos));
    for (const item of shipped) {
      const spec = RESEARCH_ITEMS.find((entry) => entry.id === item.id);
      if (!spec) throw new Error(`no spec for ${item.id}`);
      expect(item.cost, item.id).toEqual(priceOf(base, spec));
      expect(item.minutes, item.id).toBe(minutesFor(repos, base, spec, fitFor(base, repos)));
      expect(item.blocker, item.id).toBe(itemBlocker(base, spec.id, fitFor(base)));
    }
    // The control: the three chairs above mean the answers are not all the same anyway.
    expect(new Set(shipped.map((item) => item.blocker)).size).toBeGreaterThan(2);
    // One clock per distinct catalogue clock: ten by depth, and the Master of Whispers' ledger.
    expect(new Set(shipped.map((item) => item.minutes)).size).toBe(
      new Set(RESEARCH_ITEMS.map((spec) => spec.minutes)).size,
    );
  });
});

/**
 * §B8: nothing on the research payload is finer than the grain we chose to publish at.
 *
 * The leak is not a bug that gets fixed once, it is a property that erodes. Every figure here is a
 * monotone function of one seated officer's seat points, so any new field derived from a cut, or an
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
    const officer = awkward('master_of_whispers', 'probe');
    const raw = researchTimeCutPercent(seatPoints(officer.attributes, 'master_of_whispers'));
    expect(onGrain(raw), `raw cut ${raw} is already on the grain, so rounding is untestable`).toBe(
      false,
    );
  });

  it('rounds every percentage it ships to the grain', () => {
    const seated = OFFICER_ROLES.map((role) => awkward(role, `off-${role}`));
    const base = makeBase(seated);

    const offGrain: string[] = [];
    // Every figure in a chair's line, the multiplier and the market's rates included.
    for (const status of trackStatuses(base, fitFor(base))) {
      for (const figure of (status.passive ?? '').match(/\d+(\.\d+)?/g) ?? []) {
        if (!onGrain(Number(figure))) offGrain.push(`${status.role}.passive=${status.passive}`);
      }
    }
    const head = researchHead(fakeRepos().repos, base, fitFor(base));
    expect(
      head,
      'the fixture seated no Researcher, so half the payload is unchecked',
    ).not.toBeNull();
    if (head && !onGrain(head.timeCutPercent)) {
      offGrain.push(`head.timeCutPercent=${head.timeCutPercent}`);
    }
    expect(offGrain, 'these ship at a finer grain than we publish at').toEqual([]);
  });
});

/**
 * Carry Both, at the seam every consumer reads (maintainer, 2026-09-18).
 *
 * `researchEffects` turning the switch on is asserted in shared. What cannot be asserted there is
 * that the switch survives the fold this side does on top of it: `standingEffectsFor` merges the
 * Lab into the ground and the people, then adds the table, the Gate and the rank. A boolean has
 * been dropped by that chain before, which is why
 * `mergeCrewEffects` has an arm of its own for it, and why a sibling switch is folded beside this
 * one here rather than trusted to behave the same.
 */
describe('a recovered unit carrying its share home, through the standing fold', () => {
  // The Veteran's fourth rung since the Chief Medic's chair went (2026-10-04).
  const CARRY_BOTH = itemsInTrack('veteran')[3];
  if (!CARRY_BOTH) throw new Error('the Veteran track has no fourth rung');

  /** The sibling switch: a permission a rung grants, ored into the same struct. */
  const YARD = RESEARCH_ITEMS.find((spec) => spec.payout.bonus?.kind === 'carriers_fight');
  if (!YARD) throw new Error('expected a carriers_fight rung');

  const standingWith = (...technologies: string[]) =>
    standingEffectsFor(
      fakeRepos().repos,
      makeBase([], { ...startingResearch(), technologies }),
      NOW,
    );

  it('is off for a crew that has not finished it', () => {
    expect(standingWith().recoveredCarryLoot).toBe(false);
    // ...including a crew that has finished the three rungs below it and stopped there.
    const below = itemsInTrack('veteran')
      .filter((spec) => spec.step < 4)
      .map((spec) => spec.id);
    expect(standingWith(...below).recoveredCarryLoot).toBe(false);
  });

  it('is on once it is finished, and reaches the fold the same way the sibling switch does', () => {
    const only = standingWith(CARRY_BOTH.id);
    expect(only.recoveredCarryLoot).toBe(true);
    expect(only.carriersFight).toBe(false);

    const sibling = standingWith(YARD.id);
    expect(sibling.carriersFight).toBe(true);
    expect(sibling.recoveredCarryLoot).toBe(false);

    const both = standingWith(CARRY_BOTH.id, YARD.id);
    expect(both.recoveredCarryLoot).toBe(true);
    expect(both.carriersFight).toBe(true);
  });

  it('survives a raid, the way a permission should', () => {
    // A raid cuts what the structures make and nothing in this fold (2026-09-29). The pin stays
    // because it once took a share off the whole struct, and half a permission is not a thing: a
    // raided crew that had bought this still gets its people home with their packs.
    const raided = makeBase([], { ...startingResearch(), technologies: [CARRY_BOTH.id] });
    raided.economy = {
      ...raided.economy,
      disruption: {
        until: new Date(NOW.getTime() + 3_600_000).toISOString(),
        since: new Date(NOW.getTime() - 3_600_000).toISOString(),
        percent: 25,
      },
    };
    expect(standingEffectsFor(fakeRepos().repos, raided, NOW).recoveredCarryLoot).toBe(true);
  });
});
