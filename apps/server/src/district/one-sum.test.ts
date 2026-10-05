import {
  STARTING_RESOURCES,
  buildingBuildSeconds,
  buildingCost,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Base,
  type Building,
} from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { standingEffectsFor } from '../crew/standing.js';
import { buildClocksFor, buildQuotesFor } from './build.js';

/**
 * The build quote and clock, with the crew's points on the cards' sum (maintainer, 2026-10-01:
 * "make them add").
 *
 * The route used to price the structures' cut first and take the crew's discount off the result,
 * and divide the clock by the crew's build speed after the Generator and the cards had cut it. The
 * crew here is two Lab rungs, one on each channel, beside a Nexus carrying a card on each.
 */

const HOUR = '2026-08-16T12:00:00.000Z';
const NOW = new Date('2026-08-16T13:00:00.000Z');

const dbs: AppDatabase[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function openStack(): Repositories {
  const db = openDatabase(':memory:');
  dbs.push(db);
  runMigrations(db);
  return createRepositories(db);
}

const BUILDINGS: Building[] = [
  {
    id: 'nexus',
    kind: 'nexus',
    level: 20,
    modifications: ['nexus_requisition_ledger', 'nexus_automated_protocols'],
  },
  { id: 'generator', kind: 'generator', level: 10, modifications: [] },
  { id: 'quarters', kind: 'quarters', level: 9, modifications: [] },
];

function crew(repos: Repositories, technologies: string[]): Base {
  repos.users.insert({ id: 'u', username: 'adder', passwordHash: 'x', createdAt: HOUR });
  const base: Base = {
    id: 'b',
    ownerId: 'u',
    name: 'The Sum',
    districtId: 'neon-docks',
    level: 20,
    isBot: false,
    resources: { ...STARTING_RESOURCES },
    economy: startingEconomy(HOUR),
    progression: startingProgression(),
    research: { ...startingResearch(), technologies },
    buildings: BUILDINGS,
    buildQueue: [],
    army: {},
    musterQueue: [],
    training: startingTraining(HOUR),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [],
    createdAt: HOUR,
  };
  repos.bases.insert(base);
  return base;
}

describe('a build quote and clock', () => {
  it('put the crew on the same sum as the cards and the Generator', () => {
    const repos = openStack();
    const base = crew(repos, ['tech_capital_rationing', 'tech_load_tables']);
    const effects = standingEffectsFor(repos, base, NOW);
    // Positive control: the rungs reach the fold the route reads.
    expect(effects.buildCostPercent).toBeGreaterThan(0);
    expect(effects.buildSpeedPercent).toBeGreaterThan(0);

    expect(buildQuotesFor(repos, base).quarters).toEqual(
      buildingCost('quarters', 10, BUILDINGS, effects.buildCostPercent),
    );
    expect(buildClocksFor(repos, base, NOW, false).quarters).toBe(
      buildingBuildSeconds('quarters', 10, BUILDINGS, effects.buildSpeedPercent),
    );
  });
});
