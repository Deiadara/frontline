import {
  EVERY_LOCATION,
  STARTING_RESOURCES,
  createCommander,
  findUnit,
  makeAttributes,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  suppliesLineCut,
  musterCost,
  type Base,
  type BonusLine,
  type Building,
} from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { musterBreakdownFor } from './breakdown.js';
import { projectUnits } from './roster.js';
import { ratesForUnit, musterRatesFor } from './muster.js';

/**
 * The supplies line of a muster bill (maintainer, 2026-10-01): "go up to about 70% off and
 * generally nerf the supply reduction bonuses so that it's hard to get there and a mid game crew
 * is expected to have reduced it by about 20% or so".
 *
 * The mid-game crew is the one the progression sim reached around level 42 (day 30 to 35) when the
 * ruling was made: six officers, a Chief Medic with Chemistry 40 in the chair, the Fabricator's
 * first rung (Jigs and Fixtures), a Greenhouse at 10 and Mess Rota in the Quarters, and no Armory
 * (five in a city of 141 locations) or cost perk (about one recruit in a hundred carries one).
 * Both chairs and the rung went with the chair rework (2026-10-04): the crew below keeps the
 * chemist as its Veteran, the Greenhouse and Mess Rota.
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

const sum = (lines: readonly BonusLine[]): number =>
  lines.reduce((total, line) => total + line.percent, 0);

function midGameCrew(repos: Repositories): Base {
  repos.users.insert({
    id: 'user-1',
    username: 'Middling',
    passwordHash: 'x',
    createdAt: NOW.toISOString(),
  });
  const base: Base = {
    id: 'base-1',
    ownerId: 'user-1',
    name: 'The Ninth Street Crew',
    districtId: 'neon-docks',
    level: 42,
    isBot: false,
    resources: STARTING_RESOURCES,
    economy: { ...startingEconomy(NOW.toISOString()), productionSettledAt: NOW.toISOString() },
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [
      build('nexus', 12),
      build('generator', 8),
      build('greenhouse', 10),
      build('quarters', 10, ['quarters_mess_rota']),
    ],
    buildQueue: [],
    army: {},
    musterQueue: [],
    training: startingTraining(NOW.toISOString()),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [
      // The Chief Medic of the 2026-10-01 ruling, sitting as Veteran since the chair rework.
      createCommander('medic', 'Doc', 'veteran', makeAttributes(30, { chemistry: 40 })),
    ],
    createdAt: NOW.toISOString(),
  };
  repos.bases.insert(base);
  return base;
}

describe('the supplies line for a mid-game crew', () => {
  it('lands near 20% off, with the general cut paid in full', () => {
    const repos = openStack();
    const base = midGameCrew(repos);
    const rates = musterRatesFor(repos, base, NOW);
    // The premise, in the halves the ruling names. Chemistry on a Chief Medic paid the general
    // cut until the chair rework (2026-10-04); the Veteran's passive comes off every line instead.
    expect(rates.suppliesPercent, 'a Greenhouse 10 and Mess Rota').toBe(9);
    expect(rates.costPercent, 'no general cut on this crew').toBe(0);
    expect(rates.veteranPercent).toBeGreaterThan(10);

    const line = suppliesLineCut(rates.costPercent, rates.suppliesPercent);
    const composed = 100 * (1 - (1 - line / 100) * (1 - rates.veteranPercent / 100));
    expect(composed).toBeGreaterThan(16.5);
    expect(composed).toBeLessThan(23);

    const razors = findUnit('razors')!;
    const bill = musterCost(
      razors,
      10,
      rates.costPercent,
      rates.suppliesPercent,
      rates.veteranPercent,
    );
    expect(bill.supplies).toBe(Math.round((razors.cost.supplies ?? 0) * 10 * (1 - composed / 100)));
  });

  it('prints a cost chip and a supplies chip that add up to the line', () => {
    const repos = openStack();
    const base = midGameCrew(repos);
    const roster = projectUnits(repos, base, NOW);
    const page = musterBreakdownFor(repos, base, NOW);
    expect(sum(page.cost) + sum(page.supplies)).toBeCloseTo(
      suppliesLineCut(roster.musterCostReduction, roster.musterSuppliesReduction ?? 0),
      6,
    );
    // The page names the Greenhouse and the card at their printed figures, then the taper.
    expect(page.supplies.map((line) => line.source)).toEqual([
      'The Greenhouse',
      'Mess Rota',
      'Tapering',
    ]);
    expect(page.supplies[0]?.percent).toBe(5);
    expect(page.supplies[1]?.percent).toBe(4);
  });
});

/**
 * The strong mid-game crew of the second ruling (maintainer, 2026-10-01: "nerf the general
 * sources so a very good advanced mid game crew that has played for low supplies gets about
 * 30%"): an Armory worked to 4, a Veteran (the Chemistry 55 chemist of the ruling, in the chair
 * that replaced the Chief Medic's), Unit Costing, Surplus Dealer, a Greenhouse 12 with Grey Water
 * Loop and Mess Rota in the Quarters.
 */
describe('the supplies line for a strong mid-game crew built for cheap supplies', () => {
  function strongCrew(repos: Repositories): Base {
    const base = midGameCrew(repos);
    const strong: Base = {
      ...base,
      research: {
        ...base.research,
        technologies: ['tech_unit_costing'],
      },
      buildings: [
        build('nexus', 14),
        build('generator', 8),
        build('greenhouse', 12, ['greenhouse_grey_water_loop']),
        build('quarters', 10, ['quarters_mess_rota']),
      ],
      commanders: [
        createCommander('medic', 'Doc', 'veteran', makeAttributes(40, { chemistry: 55 }), [
          'surplus_dealer',
        ]),
      ],
    };
    repos.bases.updateCommanders(base.id, strong.commanders);
    repos.city.put({
      locationId: EVERY_LOCATION.find((location) => location.kind === 'armory')!.id,
      holder: { kind: 'crew', baseId: base.id },
      level: 4,
      upgradingUntil: null,
      garrison: {},
    });
    return strong;
  }

  it('lands about 30% off, and well under the half price it was at', () => {
    const repos = openStack();
    const base = strongCrew(repos);
    const rates = musterRatesFor(repos, base, NOW);
    expect(rates.suppliesPercent).toBe(13);
    // The general cut, under the floor price by a long way: it was 69 before the cut.
    expect(rates.costPercent).toBeLessThan(12);
    const line = suppliesLineCut(rates.costPercent, rates.suppliesPercent);
    const composed = 100 * (1 - (1 - line / 100) * (1 - rates.veteranPercent / 100));
    expect(composed).toBeGreaterThan(28);
    expect(composed).toBeLessThan(36);
    // And the rest of the bill: about a quarter off the caps rather than half.
    const razors = findUnit('razors')!;
    const caps = (razors.cost.caps ?? 0) * 10;
    const charged = musterCost(razors, 10, rates.costPercent, 0, rates.veteranPercent).caps!;
    expect(charged).toBe(
      Math.round(caps * (1 - rates.costPercent / 100) * (1 - rates.veteranPercent / 100)),
    );
    expect(charged).toBeGreaterThan(caps * 0.6);
  });
});

describe('a unit whose own ground moves its cost cut', () => {
  it("carries the supplies line's share of the move, so its page adds up to its bill", () => {
    const repos = openStack();
    const base = midGameCrew(repos);
    repos.city.put({
      locationId: 'steelbelt-kennels',
      holder: { kind: 'crew', baseId: base.id },
      level: 6,
      upgradingUntil: null,
      garrison: {},
    });
    const roster = projectUnits(repos, base, NOW);
    const page = musterBreakdownFor(repos, base, NOW);
    const hounds = roster.units.find((unit) => unit.id === 'cyber_dogs')!;
    expect(hounds.homeCostReduction ?? 0, 'the Doghouse has to move the cost cut').toBeGreaterThan(
      0,
    );
    const own = hounds.homeBonus?.supplies ?? [];
    expect(own, 'the unit needs its own supplies line').toHaveLength(1);
    expect(own[0]!.percent).toBeLessThan(0);

    const cost = sum(page.cost) + sum(hounds.homeBonus?.cost ?? []);
    const supplies = sum(page.supplies) + sum(own);
    const spec = findUnit('cyber_dogs')!;
    const charged = ratesForUnit(musterRatesFor(repos, base, NOW), spec);
    expect(cost + supplies).toBeCloseTo(
      suppliesLineCut(charged.costPercent, charged.suppliesPercent),
      6,
    );
    // Positive control: without the unit's line the page would overstate the cut.
    expect(cost + sum(page.supplies)).toBeGreaterThan(
      suppliesLineCut(charged.costPercent, charged.suppliesPercent),
    );
  });
});
