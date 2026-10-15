import {
  STARTING_RESOURCES,
  createCommander,
  findDistrict,
  makeAttributes,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Base,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { standingEffectsFor } from '../crew/standing.js';

/** The Frontier Chapel and the Last Platform held whole, read through the standing fold (2026-10-14). */

const HOUR = '2026-09-01T12:00:00.000Z';
const NOW = new Date(HOUR);

function stack(): { repos: Repositories; base: Base } {
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
    buildings: [{ id: 'nexus', kind: 'nexus', level: 10, modifications: [] }],
    buildQueue: [],
    army: {},
    musterQueue: [],
    training: startingTraining(HOUR),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [createCommander('o', 'Vasso', 'engineer', makeAttributes(20))],
    createdAt: HOUR,
  };
  repos.bases.insert(base);
  return { repos, base };
}

function take(repos: Repositories, baseId: string, locationId: string, level = 1): void {
  const control = repos.city.control(locationId);
  if (!control) throw new Error(`fixture: no ${locationId}`);
  repos.city.put({ ...control, holder: { kind: 'crew', baseId }, level, garrison: {} });
}

describe('the Frontier Chapel at the standing fold', () => {
  it('lists Eerie among the labels the crew ignores, beside nothing else', () => {
    const { repos, base } = stack();
    expect(standingEffectsFor(repos, base, NOW).ignoredLabels).toEqual([]);
    take(repos, base.id, 'blockhouse-chapel', 2);
    const standing = standingEffectsFor(repos, base, NOW);
    expect(standing.ignoredLabels).toEqual(['eerie']);
    expect(standing.unitMoraleFlat).toBe(6);
  });
});

describe('the Last Platform held whole', () => {
  it('pays 25% more infamy off fights alone', () => {
    const { repos, base } = stack();
    for (const location of findDistrict('last-platform')!.locations) {
      take(repos, base.id, location.id);
    }
    const standing = standingEffectsFor(repos, base, NOW);
    expect(standing.battleInfamyPercent).toBe(25);
    expect(standing.infamyGainPercent).toBe(0);
  });
});
