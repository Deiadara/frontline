import {
  TRAINING_MAX_BATCH,
  createCommander,
  findUnit,
  maxTrainable,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  trainingCost,
  trainingSeconds,
  type Base,
  type Building,
  type LocationControl,
} from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { projectUnits } from './roster.js';
import { ratesForUnit, trainingRatesFor } from './training.js';

const dbs: AppDatabase[] = [];
afterEach(() => dbs.splice(0).forEach((db) => db.close()));
const NOW = new Date('2026-09-17T12:00:00.000Z');

const build = (kind: Building['kind'], level: number, modifications: string[] = []): Building => ({
  id: `b-${kind}`,
  kind,
  level,
  modifications,
  damage: 0,
});

function stack(): { repos: Repositories; base: Base } {
  const db = openDatabase(':memory:');
  dbs.push(db);
  runMigrations(db);
  const repos = createRepositories(db);
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
    level: 20,
    isBot: false,
    resources: {
      caps: 9e6,
      supplies: 9e6,
      oil: 9e6,
      scrap: 9e6,
      planks: 9e6,
      highQualityMetal: 9e6,
    },
    economy: { ...startingEconomy(NOW.toISOString()), productionSettledAt: NOW.toISOString() },
    progression: startingProgression(),
    research: { ...startingResearch(), technologies: ['tech_unit_costing', 'tech_batch_runs'] },
    buildings: [
      build('nexus', 20),
      build('gauntlet', 12, ['gauntlet_night_course']),
      build('greenhouse', 9, ['greenhouse_sealed_growrooms']),
    ],
    buildQueue: [],
    army: {},
    trainingQueue: [],
    training: startingTraining(NOW.toISOString()),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [createCommander('c1', 'Ola', 'wetware_chief', { chemistry: 88, cybernetics: 74 })],
    createdAt: NOW.toISOString(),
  };
  repos.bases.insert(base);
  // A Doghouse at level 6, so the Cyberhounds carry a private discount on top of the crew's.
  const control: LocationControl = {
    locationId: 'rustyard-kennels',
    holder: { kind: 'crew', baseId: base.id },
    level: 6,
    upgradingUntil: null,
    fortification: 0,
    fortifyingUntil: null,
    garrison: {},
  };
  repos.city.put(control);
  return { repos, base };
}

describe('the training stack: what the roster quotes is what the route charges', () => {
  it('agrees on every unit, for a crew carrying every kind of discount at once', () => {
    const { repos, base } = stack();
    const roster = projectUnits(repos, base, NOW);
    const rates = trainingRatesFor(repos, base, NOW);

    // The premise: all three discounts are live, or this compares zeroes.
    expect(roster.trainingCostReduction).toBeGreaterThan(0);
    expect(roster.trainingSuppliesReduction ?? 0).toBeGreaterThan(0);
    expect(roster.units.find((u) => u.id === 'cyber_dogs')?.homeCostReduction ?? 0).toBeGreaterThan(
      0,
    );

    const mismatched: string[] = [];
    for (const option of roster.units) {
      const unit = findUnit(option.id);
      if (!unit) continue;
      // What the screen quotes: the crew-wide cut plus this unit's own ground.
      const quotedPercent = roster.trainingCostReduction + (option.homeCostReduction ?? 0);
      const quoted = trainingCost(unit, 3, quotedPercent, roster.trainingSuppliesReduction ?? 0);
      // What the route charges.
      const own = ratesForUnit(rates, unit);
      const charged = trainingCost(unit, 3, own.costPercent, own.suppliesPercent);
      if (JSON.stringify(quoted) !== JSON.stringify(charged)) {
        mismatched.push(
          `${option.id}: quoted ${JSON.stringify(quoted)} charged ${JSON.stringify(charged)}`,
        );
      }
    }
    expect(mismatched, mismatched.join('\n')).toEqual([]);
  });

  it('never offers a Max batch the route would refuse', () => {
    const { repos, base } = stack();
    /*
     * A tight purse, and that is the premise rather than a detail.
     *
     * With nine million of everything `maxTrainable` is bounded by the batch ceiling and the beds,
     * so the affordability arithmetic the two sides have to agree on is never reached: the test
     * passes whatever the discounts do. Squeezed until money is what binds.
     */
    repos.bases.updateResources(base.id, {
      caps: 900,
      supplies: 300,
      oil: 300,
      scrap: 700,
      planks: 700,
      highQualityMetal: 120,
    });
    const reader = repos.bases.findById(base.id)!;
    const roster = projectUnits(repos, reader, NOW);
    const rates = trainingRatesFor(repos, reader, NOW);
    const spare = Math.max(0, roster.unitSlotsCap - roster.unitSlotsUsed);
    // ...and it really does bind: at least one unit's Max is short of the batch ceiling.
    const bounded = roster.units.some((option) => {
      const unit = findUnit(option.id);
      if (!unit) return false;
      const most = maxTrainable(
        unit,
        roster.resources,
        spare,
        roster.trainingCostReduction + (option.homeCostReduction ?? 0),
        roster.trainingSuppliesReduction ?? 0,
      );
      return most > 0 && most < TRAINING_MAX_BATCH;
    });
    expect(bounded, 'the purse has to be what limits Max or this measures nothing').toBe(true);

    const bad: string[] = [];
    for (const option of roster.units) {
      /*
       * Locked rows included, and deliberately.
       *
       * `maxTrainable` does not look at whether a row is unlocked and neither does the price: what
       * is being compared is the arithmetic on both sides of the wire. Filtering to the unlocked
       * skipped every unit with a home of its own, because all of them are high tier, which is
       * precisely the half of the discount this test exists to check.
       */
      const unit = findUnit(option.id);
      if (!unit) continue;
      const most = maxTrainable(
        unit,
        roster.resources,
        spare,
        roster.trainingCostReduction + (option.homeCostReduction ?? 0),
        roster.trainingSuppliesReduction ?? 0,
      );
      if (most < 1) continue;
      const own = ratesForUnit(rates, unit);
      const price = trainingCost(unit, most, own.costPercent, own.suppliesPercent);
      for (const [key, amount] of Object.entries(price)) {
        const wants = amount ?? 0;
        const held = (roster.resources as Record<string, number>)[key] ?? 0;
        if (wants > held) bad.push(`${option.id}: Max ${most} wants ${wants} ${key}, has ${held}`);
      }
      if (most * unit.unitSlots > spare) {
        bad.push(`${option.id}: Max ${most} wants ${most * unit.unitSlots} slots, has ${spare}`);
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });
});

describe('the clock', () => {
  /**
   * The server ships the two figures the price box adds up, and their sum is what it clocks with.
   *
   * The client cannot call `ratesForUnit`: it has no control table and no crew sheets. So it adds
   * `trainingSpeedBonus` to the row's own `homeSpeedBonus`, and this is the contract that makes
   * that sum right. Same shape as the cost assertion above, on the other half of the order.
   */
  it('ships a speed figure that adds up to what the route clocks with', () => {
    const { repos, base } = stack();
    const roster = projectUnits(repos, base, NOW);
    const rates = trainingRatesFor(repos, base, NOW);

    expect(roster.trainingSpeedBonus, 'the fixture has to have a clock discount').toBeGreaterThan(
      0,
    );
    const withHome = roster.units.filter((option) => (option.homeSpeedBonus ?? 0) > 0);
    expect(withHome.length, 'and at least one unit with a home of its own').toBeGreaterThan(0);

    const wrong: string[] = [];
    for (const option of roster.units) {
      const unit = findUnit(option.id);
      if (!unit) continue;
      const quoted = roster.trainingSpeedBonus + (option.homeSpeedBonus ?? 0);
      const charged = ratesForUnit(rates, unit).speedPercent;
      if (quoted !== charged) wrong.push(`${option.id}: quoted ${quoted}%, clocked ${charged}%`);
      // ...and the seconds that follow from it, which is the figure the box prints.
      const shown = trainingSeconds(unit, 3, quoted);
      const taken = trainingSeconds(unit, 3, charged);
      if (shown !== taken) wrong.push(`${option.id}: box ${shown}s, order ${taken}s`);
    }
    expect(wrong, wrong.join('\n')).toEqual([]);
  });
});
