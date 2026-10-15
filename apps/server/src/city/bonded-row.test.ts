import {
  BLUEPRINTS,
  ITEM_RARITIES,
  RARITY_ODDS_BY_LEVEL,
  supplyPrice,
  STARTING_RESOURCES,
  featMeasureKey,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Base,
  type Building,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { buySupply, projectMarket } from '../market/board.js';
import { grantDaily } from './daily.js';

/**
 * Bonded Row, batch 8 (maintainer, 2026-10-09): the Long Bond's cheaper supply run, quoted where
 * it is charged, and the Seized Goods Office's daily pages, never one the crew already holds.
 */

const HOUR = '2026-09-01T12:00:00.000Z';
const NOW = new Date(HOUR);
const DAY = '2026-09-01';

function stack(buildings: Building[] = []): { repos: Repositories; base: Base } {
  const db = openDatabase(':memory:');
  runMigrations(db);
  const repos = createRepositories(db);
  repos.users.insert({ id: 'u', username: 'holder', passwordHash: 'x', createdAt: HOUR });
  const base: Base = {
    id: 'b',
    ownerId: 'u',
    name: 'The Yard',
    districtId: 'south-quay',
    level: 20,
    isBot: false,
    resources: { ...STARTING_RESOURCES },
    economy: startingEconomy(HOUR),
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [{ id: 'nexus', kind: 'nexus', level: 10, modifications: [] }, ...buildings],
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
  return { repos, base };
}

function take(repos: Repositories, baseId: string, locationId: string, level = 1): void {
  const control = repos.city.control(locationId)!;
  repos.city.put({ ...control, holder: { kind: 'crew', baseId }, level, garrison: {} });
}

describe('the Long Bond', () => {
  it('quotes and charges the supply run 10 to 20% less, the same figure both ways', () => {
    for (const [level, cut] of [
      [1, 10],
      [5, 20],
    ] as const) {
      const { repos, base } = stack();
      const plain = projectMarket(repos, base, NOW).supply.lines.find(
        (line) => line.key === 'oil',
      )!;
      take(repos, base.id, 'bonded-row-longbond', level);
      const market = projectMarket(repos, base, NOW);
      expect(market.supplyCutPercent).toBe(cut);
      const line = market.supply.lines.find((one) => one.key === 'oil')!;
      expect(line.capsPerUnit).toBeCloseTo(plain.capsPerUnit * (1 - cut / 100), 9);

      const units = 10;
      const before = repos.bases.findById(base.id)!;
      expect(buySupply(repos, before, 'oil', units, NOW, true).kind).toBe('done');
      const spent = before.resources.caps - repos.bases.findById(base.id)!.resources.caps;
      expect(spent).toBe(supplyPrice('oil', units, 0, null, cut));
      expect(spent).toBeLessThan(supplyPrice('oil', units));
    }
  });
});

describe('the Seized Goods Office', () => {
  const OFFICE = 'bonded-row-seized';

  it('delivers 1, 1, 2, 2, 3 pages a day, none of them one the crew holds', () => {
    for (const [level, count] of [
      [1, 1],
      [2, 1],
      [3, 2],
      [4, 2],
      [5, 3],
    ] as const) {
      const { repos, base } = stack();
      take(repos, base.id, OFFICE, level);
      const grant = grantDaily(repos, base, DAY, NOW)!;
      expect(grant.pages, `level ${level}`).toHaveLength(count);
      expect(new Set(grant.pages).size).toBe(count);
      expect(grant.pagesFrom).toEqual(
        Array.from({ length: count }, () => 'The Seized Goods Office'),
      );
      const after = repos.bases.findById(base.id)!;
      for (const page of grant.pages) expect(after.inventory[page]).toBe(1);
      expect(repos.feats.tallies(base.id)[featMeasureKey('pages_delivered')]).toBe(count);
    }
  });

  it('never hands over a page already held, and nothing once every page is', () => {
    const everyPage = Object.fromEntries(
      BLUEPRINTS.flatMap((spec) => spec.pages.map((page) => [page.id, 1])),
    );
    const { repos, base } = stack();
    repos.bases.updateHoldings(base.id, base.resources, everyPage);
    take(repos, base.id, OFFICE, 5);
    const grant = grantDaily(repos, repos.bases.findById(base.id)!, DAY, NOW)!;
    expect(grant.pages).toEqual([]);
  });

  it('improves the odds at levels 2 and 4, rows the shared table already prints', () => {
    // A guard on the fixture: each row the office reads leans rarer than the one before.
    const rare = (row: number) => {
      const odds = RARITY_ODDS_BY_LEVEL[row - 1]!;
      return odds.slice(1).reduce((sum, one) => sum + one, 0);
    };
    expect(rare(2)).toBeGreaterThan(rare(1));
    expect(rare(3)).toBeGreaterThan(rare(2));
    expect(ITEM_RARITIES).toHaveLength(4);
  });
});
