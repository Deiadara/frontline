import {
  RAID_DISRUPTION_HOURS,
  RAID_DISRUPTION_PERCENT,
  STARTING_RESOURCES,
  createCommander,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Base,
  type Building,
  type BonusLine,
} from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { trainingBreakdownFor } from './breakdown.js';
import { projectUnits } from './roster.js';
import { trainingRatesFor } from './training.js';

/**
 * The page has to add up to the figure it explains.
 *
 * `breakdown.ts` walks the contributors a second time to keep their names, and the fold that
 * produces the totals is the one the game charges with. Two walks of one set of rules is the shape
 * this repo has been bitten by before, so the agreement is a test rather than a promise: every
 * assertion here sums a list and compares it with `trainingRatesFor`, which is what the roster
 * ships and what the training route bills.
 *
 * The fixtures are deliberately *rich*. A crew with nothing gives three empty lists that agree with
 * three zeroes, which is a test that cannot fail: each case below puts something on at least two of
 * the channels, and the "everything at once" case turns on every kind of contributor there is.
 */

const dbs: AppDatabase[] = [];
afterEach(() => dbs.splice(0).forEach((db) => db.close()));

const NOW = new Date('2026-09-17T12:00:00.000Z');

function openStack(): Repositories {
  const db = openDatabase(':memory:');
  dbs.push(db);
  runMigrations(db);
  return createRepositories(db);
}

const build = (kind: Building['kind'], level: number, modifications: string[] = []): Building => ({
  id: `b-${kind}`,
  kind,
  level,
  modifications,
  damage: 0,
});

function seedBase(repos: Repositories, patch: Partial<Base> = {}): Base {
  repos.users.insert({
    id: 'user-1',
    username: 'Builder',
    passwordHash: 'x',
    createdAt: NOW.toISOString(),
  });
  const base: Base = {
    id: 'base-1',
    ownerId: 'user-1',
    name: 'The Ninth Street Crew',
    districtId: 'neon-docks',
    level: 12,
    isBot: false,
    resources: STARTING_RESOURCES,
    economy: { ...startingEconomy(NOW.toISOString()), productionSettledAt: NOW.toISOString() },
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [build('nexus', 6), build('generator', 3)],
    buildQueue: [],
    army: {},
    trainingQueue: [],
    training: startingTraining(NOW.toISOString()),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [],
    createdAt: NOW.toISOString(),
    ...patch,
  };
  repos.bases.insert(base);
  return base;
}

const sum = (lines: readonly BonusLine[]): number =>
  lines.reduce((total, line) => total + line.percent, 0);

/** The three sums against the three figures, which is the whole contract of the file. */
function expectAddsUp(repos: Repositories, base: Base, now: Date = NOW): void {
  /*
   * Both sides priced at the *same* instant, which is the whole of what makes this comparable.
   *
   * `trainingRatesFor` used to read the wall clock however it was called, so once real time walked
   * past this fixture's raid-disruption window the rate came back undisrupted while the breakdown,
   * handed `now`, still subtracted the raid. A test that passes in the morning and fails in the
   * evening was the symptom; the cause was a function quietly using a different clock from its
   * caller, and that is fixed in `training.ts` rather than papered over here.
   */
  const rates = trainingRatesFor(repos, base, now);
  const page = trainingBreakdownFor(repos, base, now);
  expect(sum(page.cost), `cost lines: ${JSON.stringify(page.cost)}`).toBeCloseTo(
    rates.costPercent,
    6,
  );
  expect(sum(page.speed), `speed lines: ${JSON.stringify(page.speed)}`).toBeCloseTo(
    rates.speedPercent,
    6,
  );
  expect(sum(page.supplies), `supplies lines: ${JSON.stringify(page.supplies)}`).toBeCloseTo(
    rates.suppliesPercent,
    6,
  );
}

describe('where a training percentage comes from', () => {
  it('adds up for a crew that holds nothing but its own structures', () => {
    const repos = openStack();
    const base = seedBase(repos, {
      buildings: [build('nexus', 6), build('gauntlet', 9), build('greenhouse', 7)],
    });
    // The premise: there is something to explain. Without it the sums below are 0 against 0.
    const rates = trainingRatesFor(repos, base, NOW);
    expect(rates.speedPercent).toBeGreaterThan(0);
    expect(rates.suppliesPercent).toBeGreaterThan(0);
    expectAddsUp(repos, base);
  });

  /**
   * The Gauntlet's ceiling, which is the first place a line and a total can part company.
   *
   * A level-40 Gauntlet is 80 points of raw and 40 of charged, so a page that printed the raw
   * figure would promise a player twice the drill they are getting.
   */
  it('prints the Gauntlet at its ceiling rather than at its level', () => {
    const repos = openStack();
    const base = seedBase(repos, { buildings: [build('nexus', 20), build('gauntlet', 40)] });
    const page = trainingBreakdownFor(repos, base, NOW);
    const gauntlet = page.speed.find((line) => line.source === 'The Gauntlet');
    expect(gauntlet?.percent).toBe(40);
    expect(gauntlet?.note).toContain('capped');
    expectAddsUp(repos, base);
  });

  /**
   * An officer, by name, which is the line the maintainer asked for ("20% from X officer").
   *
   * Chemistry is `trainingCostPercent` and Cybernetics is `trainingSpeedPercent`
   * (`ATTRIBUTE_EFFECTS`), so one person rated in both pays into two of the three lists at once.
   */
  it('names the officer carrying the skill, and only the best of them', () => {
    const repos = openStack();
    // Seated rather than benched: an officer is paid their full rating only in the attributes
    // their own chair uses, so the chair is part of what the line is measuring.
    const chemist = createCommander('c-1', 'Ola Nkemdirim', 'wetware_chief', {
      chemistry: 90,
      cybernetics: 70,
    });
    const lesser = createCommander('c-2', 'Someone Else', 'fabricator', { chemistry: 40 });
    const base = seedBase(repos, { commanders: [chemist, lesser] });

    const page = trainingBreakdownFor(repos, base, NOW);
    const named = page.cost.filter((line) => line.source === 'Ola Nkemdirim');
    expect(named).toHaveLength(1);
    expect(named[0]?.note).toContain('Chemistry');
    expect(named[0]?.percent).toBeGreaterThan(0);
    // Best-of, so the weaker chemist is not a second line: the game does not charge for them.
    expect(page.cost.some((line) => line.source === 'Someone Else')).toBe(false);
    expect(page.speed.some((line) => line.source === 'Ola Nkemdirim')).toBe(true);
    expectAddsUp(repos, base);
  });

  /** The Lab's finished rungs, each by the programme's own name. */
  it('names the programme behind a researched discount', () => {
    const repos = openStack();
    const base = seedBase(repos, {
      research: { ...startingResearch(), technologies: ['tech_unit_costing', 'tech_drill_yard'] },
    });
    const page = trainingBreakdownFor(repos, base, NOW);
    expect(page.cost.map((line) => line.source)).toContain('Unit Costing');
    expect(page.speed.map((line) => line.source)).toContain('Drill Yard');
    expectAddsUp(repos, base);
  });

  /**
   * Everything at once, which is the case the sum is actually for.
   *
   * People, the Lab, the Gauntlet, the Greenhouse and a deck of cards in both, so every branch in
   * the file contributes and the three sums have something to be wrong about.
   */
  it('adds up with people, programmes, structures and fitted cards all paying', () => {
    const repos = openStack();
    const base = seedBase(repos, {
      commanders: [
        createCommander('c-1', 'Ola Nkemdirim', 'wetware_chief', {
          chemistry: 88,
          cybernetics: 74,
        }),
      ],
      research: {
        ...startingResearch(),
        technologies: ['tech_unit_costing', 'tech_drill_yard', 'tech_batch_runs'],
      },
      buildings: [
        build('nexus', 20),
        build('gauntlet', 12, ['gauntlet_turnout_drills', 'gauntlet_night_course']),
        build('greenhouse', 9, ['greenhouse_sealed_growrooms', 'greenhouse_grey_water_loop']),
      ],
    });
    const rates = trainingRatesFor(repos, base, NOW);
    expect(rates.costPercent).toBeGreaterThan(0);
    expect(rates.speedPercent).toBeGreaterThan(0);
    expect(rates.suppliesPercent).toBeGreaterThan(0);
    expectAddsUp(repos, base);
  });

  /**
   * The other ceiling: `districtEffects` stops every reduction at seventy points.
   *
   * Eight cards' worth of drill across five structures comes to seventy-nine, and the district
   * charges seventy. Without a line saying so the page adds up to nine points the bill does not
   * give, which is the same lie as the uncapped Gauntlet and harder to spot, because no single card
   * on the list is wrong.
   */
  it('shows what the district refuses when the cards add up past its ceiling', () => {
    const repos = openStack();
    const base = seedBase(repos, {
      buildings: [
        build('nexus', 20),
        build('gauntlet', 12, [
          'gauntlet_salvaged_simulators',
          'gauntlet_night_course',
          'gauntlet_range_optics',
        ]),
        build('quarters', 9, ['quarters_turnout_drills']),
        build('apothecary', 9, ['apothecary_stimulant_line']),
        build('lab', 9, ['lab_written_drill']),
        build('infirmary', 9, ['infirmary_prosthetics_bench']),
      ],
    });
    const page = trainingBreakdownFor(repos, base, NOW);
    const cards = page.speed.filter((line) => line.source !== 'The Gauntlet' && line.percent > 0);
    expect(
      cards.reduce((total, line) => total + line.percent, 0),
      'the fixture has to exceed the ceiling or there is nothing to cap',
    ).toBeGreaterThan(70);
    const capped = page.speed.find((line) => line.percent < 0);
    expect(capped?.note).toContain('70%');
    expectAddsUp(repos, base);
  });

  /**
   * §A4: a unit's own ground, which the crew-wide lists do not cover and should not.
   *
   * The Doghouse makes Cyberhounds cheaper and does nothing at all for a Razor, so it is shipped
   * per row (`homeBonus`) rather than on the response. What is pinned here is the same contract the
   * three crew-wide lists have: the lines add up to the figure beside them, `homeCostReduction` and
   * `homeSpeedBonus`, which is what the training route actually charges and clocks with.
   */
  it("names the ground a unit calls home, and adds up to that unit's own figures", () => {
    const repos = openStack();
    const base = seedBase(repos);
    // A Doghouse at level 6, held by this crew: five levels above the first, which is what pays.
    repos.city.put({
      locationId: 'rustyard-kennels',
      holder: { kind: 'crew', baseId: base.id },
      level: 6,
      upgradingUntil: null,
      fortification: 0,
      fortifyingUntil: null,
      garrison: {},
    });

    const roster = projectUnits(repos, base, NOW);
    const hounds = roster.units.find((unit) => unit.id === 'cyber_dogs')!;
    expect(hounds.homeCostReduction ?? 0, 'the fixture has to grant something').toBeGreaterThan(0);
    expect(sum(hounds.homeBonus?.cost ?? [])).toBe(hounds.homeCostReduction);
    expect(sum(hounds.homeBonus?.speed ?? [])).toBe(hounds.homeSpeedBonus);
    expect(hounds.homeBonus?.cost[0]?.source).toBe('The Doghouse');
    expect(hounds.homeBonus?.cost[0]?.note).toContain('6');

    // And it is private to the unit: a Razor trains nowhere the Doghouse helps.
    const razors = roster.units.find((unit) => unit.id === 'razors')!;
    expect(razors.homeBonus).toBeUndefined();
    expect(razors.homeCostReduction ?? 0).toBe(0);
  });

  /**
   * §A4: a raid is a cut, and the page says so on its own line.
   *
   * The arithmetic is the half worth pinning. `disrupted` scales the crew's whole positive fold, so
   * one line of `-(total * off)` at the bottom reproduces it exactly, and a page that instead
   * shaved a quarter off each contributor would still sum correctly while telling the player their
   * chemist got worse.
   */
  it('shows a raid as one line off the crew half, and still adds up', () => {
    const repos = openStack();
    const raided = seedBase(repos, {
      commanders: [createCommander('c-1', 'Ola Nkemdirim', 'wetware_chief', { chemistry: 88 })],
      buildings: [build('nexus', 20), build('gauntlet', 12)],
    });
    repos.bases.replace({
      ...raided,
      economy: {
        ...raided.economy,
        disruption: {
          until: new Date(NOW.getTime() + RAID_DISRUPTION_HOURS * 3_600_000).toISOString(),
          percent: RAID_DISRUPTION_PERCENT,
        },
      },
    });
    const base = repos.bases.findById(raided.id)!;

    const page = trainingBreakdownFor(repos, base, NOW);
    const cut = page.cost.find((line) => line.source === 'Raided');
    expect(cut, 'a raided crew should be told it is raided').toBeDefined();
    expect(cut!.percent).toBeLessThan(0);
    // The Gauntlet is not in the crew fold, so a raid does not reach it: its line stays whole.
    expect(page.speed.find((line) => line.source === 'The Gauntlet')?.percent).toBe(24);
    expectAddsUp(repos, base);
  });
});
