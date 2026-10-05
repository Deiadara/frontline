import {
  EVERY_LOCATION,
  MAX_MUSTER_DISCOUNT,
  OFFICER_ROLES,
  STARTING_RESOURCES,
  MUSTER_SPEED_KNEE,
  createCommander,
  findUnit,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  musterCost,
  musterSecondsFor,
  musterSpeedAfterTaper,
  suppliesLineCut,
  suppliesOnlyCut,
  type Base,
  type Building,
  type BonusLine,
} from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { musterBreakdownFor } from './breakdown.js';
import { projectUnits } from './roster.js';
import { ratesForUnit, musterRatesFor } from './muster.js';

/**
 * The page has to add up to the figure it explains.
 *
 * `breakdown.ts` walks the contributors a second time to keep their names, and the fold that
 * produces the totals is the one the game charges with. Two walks of one set of rules is the shape
 * this repo has been bitten by before, so the agreement is a test rather than a promise: every
 * assertion here sums a list and compares it with the figure the roster ships, which is
 * `musterRatesFor` stopped at the bench's own ceilings, the ones the muster route bills with.
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
    musterQueue: [],
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
   * `musterRatesFor` used to read the wall clock however it was called, so once real time walked
   * past this fixture's raid-disruption window the rate came back undisrupted while the breakdown,
   * handed `now`, still subtracted the raid. A test that passes in the morning and fails in the
   * evening was the symptom; the cause was a function quietly using a different clock from its
   * caller, and that is fixed in `muster.ts` rather than papered over here.
   */
  const roster = projectUnits(repos, base, now);
  const page = musterBreakdownFor(repos, base, now);
  expect(sum(page.cost), `cost lines: ${JSON.stringify(page.cost)}`).toBeCloseTo(
    roster.musterCostReduction,
    6,
  );
  // The speed and the supplies cut ship as sums and the bench tapers them, so each page ends on
  // the taper's line and adds up to the tapered figure. The supplies page is what the supplies-only
  // points add on the line beside the cost cut (`suppliesOnlyCut`).
  expect(sum(page.speed), `speed lines: ${JSON.stringify(page.speed)}`).toBeCloseTo(
    musterSpeedAfterTaper(roster.musterSpeedBonus),
    6,
  );
  expect(sum(page.supplies), `supplies lines: ${JSON.stringify(page.supplies)}`).toBeCloseTo(
    suppliesOnlyCut(roster.musterCostReduction, roster.musterSuppliesReduction ?? 0),
    6,
  );
}

describe('where a muster percentage comes from', () => {
  it('adds up for a crew that holds nothing but its own structures', () => {
    const repos = openStack();
    const base = seedBase(repos, {
      buildings: [build('nexus', 6), build('gauntlet', 9), build('greenhouse', 7)],
    });
    // The premise: there is something to explain. Without it the sums below are 0 against 0.
    const rates = musterRatesFor(repos, base, NOW);
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
    const page = musterBreakdownFor(repos, base, NOW);
    const gauntlet = page.speed.find((line) => line.source === 'The Gauntlet');
    expect(gauntlet?.percent).toBe(40);
    expect(gauntlet?.note).toContain('capped');
    expectAddsUp(repos, base);
  });

  /**
   * An officer, by name, which is the line the maintainer asked for ("20% from X officer").
   *
   * Through a perk since the chair rework (2026-10-04): a skill no longer pays these channels, so
   * a high Chemistry is no line at all, and the Veteran's passive comes off the bill on its own.
   */
  it('names the officer behind a perk, and nobody for a skill', () => {
    const repos = openStack();
    const dealer = createCommander(
      'c-1',
      'Ola Nkemdirim',
      'veteran',
      { chemistry: 90, cybernetics: 70 },
      ['surplus_dealer'],
    );
    const chemist = createCommander('c-2', 'Someone Else', 'salvager', { chemistry: 100 });
    const base = seedBase(repos, { commanders: [dealer, chemist] });

    const page = musterBreakdownFor(repos, base, NOW);
    const named = page.cost.filter((line) => line.source === 'Ola Nkemdirim');
    expect(named).toHaveLength(1);
    expect(named[0]?.note).toBe('Surplus Dealer');
    expect(named[0]?.percent).toBeGreaterThan(0);
    expect(page.cost.some((line) => line.source === 'Someone Else')).toBe(false);
    expect(page.speed.some((line) => line.source === 'Someone Else')).toBe(false);
    expectAddsUp(repos, base);
  });

  /** The Lab's finished rungs, each by the programme's own name. */
  it('names the programme behind a researched discount', () => {
    const repos = openStack();
    const base = seedBase(repos, {
      research: { ...startingResearch(), technologies: ['tech_unit_costing', 'tech_drill_yard'] },
    });
    const page = musterBreakdownFor(repos, base, NOW);
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
        createCommander('c-1', 'Ola Nkemdirim', 'veteran', {
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
    const rates = musterRatesFor(repos, base, NOW);
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
    const page = musterBreakdownFor(repos, base, NOW);
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
   * What the bench does last to each figure (bug pass and maintainer ruling, 2026-10-01).
   *
   * `musterCost` stops the cut at `MAX_MUSTER_DISCOUNT`, a price floor. The supplies cut and
   * the speed used to stop at 40 and 60; they taper now (`suppliesLineCut`, toward 70 off the line
   * with the cost cut, and `musterSpeedAfterTaper`), so a card past the knee still pays a little. The roster once
   * shipped the raw cost sum, so a crew holding an Armory worked to level 10 read "-66% cost" over
   * a bill that was half price, and a unit's own ground was quoted on top of a crew already there.
   */
  it('stops the cost at the floor, tapers the supplies and the speed, and the page with them', () => {
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
        build('greenhouse', 20, ['greenhouse_sealed_growrooms', 'greenhouse_grey_water_loop']),
      ],
      // An Armory at 10 is 6 since the general cuts were cut (2026-10-01), so the floor price
      // takes a room of Headhunters to reach: eight of them, 6 each.
      commanders: OFFICER_ROLES.slice(0, 8).map((role, index) =>
        createCommander(`hh-${index}`, `Headhunter ${index}`, role, {}, ['sig_headhunter']),
      ),
    });
    const hold = (locationId: string, level: number): void =>
      repos.city.put({
        locationId,
        holder: { kind: 'crew', baseId: base.id },
        level,
        upgradingUntil: null,
        garrison: {},
      });
    hold(EVERY_LOCATION.find((location) => location.kind === 'armory')!.id, 10);
    // The Cyberhounds' own ground, to be quoted on top of a crew already past the knee.
    hold('steelbelt-kennels', 6);

    // The premise: every raw sum is past where the bench starts to bite, or there is nothing here.
    const rates = musterRatesFor(repos, base, NOW);
    expect(rates.costPercent).toBeGreaterThan(MAX_MUSTER_DISCOUNT);
    expect(rates.suppliesPercent).toBeGreaterThan(0);
    expect(rates.speedPercent).toBeGreaterThan(MUSTER_SPEED_KNEE);

    const roster = projectUnits(repos, base, NOW);
    expect(roster.musterCostReduction).toBe(MAX_MUSTER_DISCOUNT);
    // Shipped as sums, for `musterCost` and `musterSecondsFor` to taper with the unit's own ground.
    expect(roster.musterSuppliesReduction).toBe(rates.suppliesPercent);
    expect(roster.musterSpeedBonus).toBe(rates.speedPercent);
    expectAddsUp(repos, base);

    // Past the knee each page ends on the taper's line: under the sum, and never zero.
    const page = musterBreakdownFor(repos, base, NOW);
    for (const lines of [page.supplies, page.speed]) {
      const taper = lines.at(-1)!;
      expect(taper.source).toBe('Tapering');
      expect(taper.percent).toBeLessThan(0);
    }
    expect(sum(page.supplies)).toBeLessThan(rates.suppliesPercent);
    // Half price already, so the supplies line has 20 points of room and the cards fill part of it.
    expect(MAX_MUSTER_DISCOUNT + sum(page.supplies)).toBeCloseTo(
      suppliesLineCut(MAX_MUSTER_DISCOUNT, rates.suppliesPercent),
      6,
    );
    expect(MAX_MUSTER_DISCOUNT + sum(page.supplies)).toBeLessThan(70);
    expect(sum(page.speed)).toBeLessThan(rates.speedPercent);

    // The unit's own ground has no room left under the floor price, and its page says so rather
    // than adding it on. On the clock it still pays, a little less than its face value.
    const hounds = roster.units.find((unit) => unit.id === 'cyber_dogs')!;
    expect(hounds.homeBonus?.cost[0]?.percent ?? 0, 'the Doghouse still pays').toBeGreaterThan(0);
    expect(hounds.homeCostReduction).toBe(0);
    expect(sum(hounds.homeBonus?.cost ?? [])).toBe(0);
    expect(hounds.homeSpeedBonus).toBe(hounds.homeBonus?.speed[0]?.percent);
    const homeSpeed = sum(hounds.homeBonus?.speed ?? []);
    expect(homeSpeed).toBeGreaterThan(0);
    expect(homeSpeed).toBeLessThan(hounds.homeSpeedBonus ?? 0);
    expect(sum(page.speed) + homeSpeed).toBeCloseTo(
      musterSpeedAfterTaper(rates.speedPercent + (hounds.homeSpeedBonus ?? 0)),
      6,
    );

    // And the quote off the shipped figures is the bill and the clock off the raw ones.
    const spec = findUnit('cyber_dogs')!;
    const charged = ratesForUnit(rates, spec);
    expect(
      musterCost(
        spec,
        3,
        roster.musterCostReduction + (hounds.homeCostReduction ?? 0),
        roster.musterSuppliesReduction ?? 0,
      ),
    ).toEqual(musterCost(spec, 3, charged.costPercent, charged.suppliesPercent));
    expect(musterSecondsFor(spec, 3, roster.musterSpeedBonus + (hounds.homeSpeedBonus ?? 0))).toBe(
      musterSecondsFor(spec, 3, charged.speedPercent),
    );
  });

  /**
   * §A4: a unit's own ground, which the crew-wide lists do not cover and should not.
   *
   * The Doghouse makes Cyberhounds cheaper and does nothing at all for a Razor, so it is shipped
   * per row (`homeBonus`) rather than on the response. What is pinned here is the same contract the
   * three crew-wide lists have: the lines add up to the figure beside them, `homeCostReduction` and
   * `homeSpeedBonus`, which is what the muster route actually charges and clocks with.
   */
  it("names the ground a unit calls home, and adds up to that unit's own figures", () => {
    const repos = openStack();
    const base = seedBase(repos);
    // A Doghouse at level 6, held by this crew: five levels above the first, which is what pays.
    repos.city.put({
      locationId: 'steelbelt-kennels',
      holder: { kind: 'crew', baseId: base.id },
      level: 6,
      upgradingUntil: null,
      garrison: {},
    });

    const roster = projectUnits(repos, base, NOW);
    const hounds = roster.units.find((unit) => unit.id === 'cyber_dogs')!;
    expect(hounds.homeCostReduction ?? 0, 'the fixture has to grant something').toBeGreaterThan(0);
    expect(sum(hounds.homeBonus?.cost ?? [])).toBe(hounds.homeCostReduction);
    expect(sum(hounds.homeBonus?.speed ?? [])).toBe(hounds.homeSpeedBonus);
    expect(hounds.homeBonus?.cost[0]?.source).toBe('The Doghouse');
    expect(hounds.homeBonus?.cost[0]?.note).toContain('6');

    // And it is private to the unit: a Razor musters nowhere the Doghouse helps.
    const razors = roster.units.find((unit) => unit.id === 'razors')!;
    expect(razors.homeBonus).toBeUndefined();
    expect(razors.homeCostReduction ?? 0).toBe(0);
  });
});
