import {
  PAY_WEEK_MS,
  STARTING_RESOURCES,
  createCommander,
  foodUpkeepFor,
  startOfPayWeek,
  startingEconomy,
  startingAssignees,
  startingProgression,
  startingResearch,
  type Base,
  startingTraining,
} from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { settleBaseEconomy } from './settle.js';

const dbs: AppDatabase[] = [];
afterEach(() => dbs.splice(0).forEach((db) => db.close()));

/** 2026-08-10 and 2026-08-17 are Mondays: the pay-week boundaries either side of the base. */
const FOUNDED = '2026-08-13T09:30:00.000Z';
const NEXT_MONDAY = new Date('2026-08-17T00:00:00.000Z');

function openStack(): Repositories {
  const db = openDatabase(':memory:');
  dbs.push(db);
  runMigrations(db);
  return createRepositories(db);
}

/** A base with `officerCount` officers on the books and a negotiated wage for each. */
function seedBase(repos: Repositories, officerCount: number, weeklyWage: number): Base {
  repos.users.insert({
    id: 'user-1',
    username: 'Payer',
    passwordHash: 'x',
    createdAt: FOUNDED,
  });

  const economy = startingEconomy(FOUNDED);
  const officers = Array.from({ length: officerCount }, (_, i) => `officer-${i}`);
  const base: Base = {
    id: 'base-1',
    ownerId: 'user-1',
    name: 'The Foothold',
    districtId: 'neon-docks',
    level: 1,
    isBot: false,
    resources: STARTING_RESOURCES,
    economy: {
      ...economy,
      payroll: {
        ...economy.payroll,
        commitments: Object.fromEntries(officers.map((o) => [o, weeklyWage])),
      },
    },
    progression: startingProgression(),
    research: startingResearch(),
    assignees: startingAssignees(),
    buildings: [],
    buildQueue: [],
    army: {},
    trainingQueue: [],
    training: startingTraining('2026-08-16T00:00:00.000Z'),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    // §F2 discounts the wage book off Authority and Negotiation, and these tests are about the
    // payroll arithmetic rather than about the discount, so the crew here has neither. The
    // discount has its own test below, where it is the only thing moving.
    commanders: officers.map((id) =>
      createCommander(id, id, 'head_spy', { authority: 0, negotiation: 0 }),
    ),
    createdAt: FOUNDED,
  };
  repos.bases.insert(base);
  return base;
}

/*
 * INTERFACES.md R6: `0003_attribute_model.sql` sorts before `0003_economy.sql` and clears `bases`,
 * so the economy migration's backfill never runs in a combined migration. The fresh-insert path is
 * therefore the only thing that can produce a valid `economy_json`, and the column's `DEFAULT '{}'`
 * would not satisfy `EconomyStateSchema`, so a base that skipped the write would fail to read back.
 */
describe('the migrated schema (INTERFACES.md R6)', () => {
  it('round-trips a schema-valid economy through a freshly inserted base', () => {
    const repos = openStack();
    const base = seedBase(repos, 1, 25);

    const reloaded = repos.bases.findById(base.id);

    expect(reloaded?.economy).toEqual(base.economy);
    expect(reloaded?.resources).toEqual(STARTING_RESOURCES);
  });

  it('refuses to read a base whose economy column was never written', () => {
    const repos = openStack();
    const base = seedBase(repos, 0, 0);
    repos.bases.updateEconomy(base.id, '{}' as unknown as Base['economy']);

    expect(() => repos.bases.findById(base.id)).toThrow();
  });
});

describe('settleBaseEconomy', () => {
  it('leaves the stockpile alone before the upkeep week turns over', () => {
    const repos = openStack();
    const base = seedBase(repos, 2, 100);

    const settled = settleBaseEconomy(repos, base, new Date('2026-08-16T23:59:59.999Z'));

    expect(settled.resources).toEqual(STARTING_RESOURCES);
    expect(repos.bases.findById(base.id)?.resources).toEqual(STARTING_RESOURCES);
  });

  /**
   * The whole shape of the rework, in one assertion pair. Officers eat, and that is upkeep; what
   * they are paid is a commitment against the payroll book and never leaves the stockpile.
   */
  it('eats food on the boundary and never touches caps', () => {
    const repos = openStack();
    const base = seedBase(repos, 2, 100);

    const settled = settleBaseEconomy(repos, base, NEXT_MONDAY);

    expect(settled.resources.caps).toBe(STARTING_RESOURCES.caps);
    expect(settled.resources.food).toBe(STARTING_RESOURCES.food - foodUpkeepFor(2));

    const reloaded = repos.bases.findById(base.id);
    expect(reloaded?.resources.food).toBe(STARTING_RESOURCES.food - foodUpkeepFor(2));
    expect(reloaded?.economy.payroll.paidThroughAt).toBe(NEXT_MONDAY.toISOString());
  });

  it('bills a settled week exactly once, however often it is read', () => {
    const repos = openStack();
    const base = seedBase(repos, 2, 100);

    const first = settleBaseEconomy(repos, base, NEXT_MONDAY);
    const second = settleBaseEconomy(repos, first, NEXT_MONDAY);
    const third = settleBaseEconomy(repos, second, new Date(NEXT_MONDAY.getTime() + 60_000));

    expect(third.resources.food).toBe(STARTING_RESOURCES.food - foodUpkeepFor(2));
  });

  it('charges every missed week when a base is left alone for a month', () => {
    const repos = openStack();
    const base = seedBase(repos, 1, 50);
    const fourWeeksOn = new Date(NEXT_MONDAY.getTime() + 3 * PAY_WEEK_MS);

    const settled = settleBaseEconomy(repos, base, fourWeeksOn);

    expect(settled.resources.food).toBe(STARTING_RESOURCES.food - 4 * foodUpkeepFor(1));
    expect(settled.economy.payroll.paidThroughAt).toBe(startOfPayWeek(fourWeeksOn).toISOString());
  });

  it('bottoms out at zero rather than going negative when the store is short', () => {
    const repos = openStack();
    const base = seedBase(repos, 40, 0);
    const aYearOn = new Date(NEXT_MONDAY.getTime() + 52 * PAY_WEEK_MS);

    const settled = settleBaseEconomy(repos, base, aYearOn);

    expect(settled.resources.food).toBe(0);
    // The week is still settled, so re-reading does not bill it again.
    expect(settled.economy.payroll.paidThroughAt).toBe(startOfPayWeek(aYearOn).toISOString());
    expect(repos.bases.findById(base.id)?.resources.food).toBe(0);
  });

  it('charges food for the crew whatever the payroll book says', () => {
    const repos = openStack();
    const base = seedBase(repos, 4, 0);

    const settled = settleBaseEconomy(repos, base, NEXT_MONDAY);

    expect(settled.resources.caps).toBe(STARTING_RESOURCES.caps);
    expect(settled.resources.food).toBe(STARTING_RESOURCES.food - foodUpkeepFor(4));
  });
});
