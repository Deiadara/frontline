import {
  STARTING_RESOURCES,
  findLocation,
  findUnit,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Base,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { heldCapRoom, queueMuster } from './muster.js';
import { projectUnits } from './roster.js';

/**
 * The Death Cloaks (maintainer, 2026-10-06): raised in Arca's Mausoleums, fifty of them for
 * every tomb held, counted everywhere the crew has people. `location-consumers.test.ts` holds the
 * other half of the rule, the thirty damage and vitality a tomb puts on each.
 */

const HOUR = '2026-10-06T12:00:00.000Z';
const NOW = new Date(HOUR);
const DEATH_CLOAKS = findUnit('death_cloaks')!;

function stack(): { repos: Repositories; base: () => Base } {
  const db = openDatabase(':memory:');
  runMigrations(db);
  const repos = createRepositories(db);
  repos.users.insert({ id: 'u', username: 'sexton', passwordHash: 'x', createdAt: HOUR });
  const base: Base = {
    id: 'b',
    ownerId: 'u',
    name: 'The Sextons',
    districtId: 'south-quay',
    level: 20,
    isBot: false,
    resources: { ...STARTING_RESOURCES, caps: 100_000, supplies: 50_000, scrap: 50_000 },
    economy: startingEconomy(HOUR),
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [
      { id: 'nexus', kind: 'nexus', level: 10, modifications: [] },
      { id: 'gauntlet', kind: 'gauntlet', level: 10, modifications: [] },
      // Beds for a few of them: the cap, not the housing, is what is measured here.
      { id: 'quarters', kind: 'quarters', level: 20, modifications: [] },
    ],
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
  return { repos, base: () => repos.bases.findById('b')! };
}

function hold(repos: Repositories, locationId: string): void {
  const location = findLocation(locationId);
  if (!location) throw new Error(`no ${locationId}`);
  const control = repos.city.control(locationId)!;
  repos.city.put({ ...control, holder: { kind: 'crew', baseId: 'b' }, garrison: {} });
}

const muster = (repos: Repositories, base: Base, count: number) =>
  queueMuster(repos, { base, unit: DEATH_CLOAKS, count, now: NOW });

describe('raising the Death Cloaks', () => {
  it('needs a Mausoleum, and any Mausoleum will do', () => {
    const { repos, base } = stack();
    expect(muster(repos, base(), 1)).toMatchObject({ kind: 'refused', reason: 'locked' });
    const view = projectUnits(repos, base(), NOW).units.find((one) => one.id === 'death_cloaks')!;
    expect(view.unlocked).toBe(false);
    expect(view.missing.join(' ')).toMatch(/Mausoleum/);
    expect(view.room).toBe(0);

    hold(repos, 'candlemarket-tomb');
    expect(muster(repos, base(), 1).kind).toBe('queued');
  });

  it('keeps fifty for every tomb held, counting the ones standing on the ground and on the bench', () => {
    const { repos, base } = stack();
    hold(repos, 'gravefields-mausoleums');
    expect(heldCapRoom(repos, base(), DEATH_CLOAKS)).toBe(50);

    // Forty-eight already raised: two more fit, three do not.
    repos.bases.updateArmy('b', { death_cloaks: 48 }, []);
    expect(heldCapRoom(repos, base(), DEATH_CLOAKS)).toBe(2);
    expect(muster(repos, base(), 3)).toMatchObject({ kind: 'refused', reason: 'at_the_cap' });
    expect(muster(repos, base(), 2).kind).toBe('queued');
    // The two on the bench count: nothing more fits, and the roster says so.
    expect(heldCapRoom(repos, base(), DEATH_CLOAKS)).toBe(0);
    expect(muster(repos, base(), 1)).toMatchObject({ kind: 'refused', reason: 'at_the_cap' });
    expect(
      projectUnits(repos, base(), NOW).units.find((one) => one.id === 'death_cloaks')?.room,
    ).toBe(0);

    // A second tomb is fifty more, and a congregation posted on it is still counted.
    hold(repos, 'candlemarket-tomb');
    expect(heldCapRoom(repos, base(), DEATH_CLOAKS)).toBe(50);
    const tomb = repos.city.control('candlemarket-tomb')!;
    repos.city.put({ ...tomb, garrison: { death_cloaks: 30 } });
    expect(heldCapRoom(repos, base(), DEATH_CLOAKS)).toBe(20);
  });

  /** Bug pass, 2026-10-06: delivered units are in the army already, so the bench counts the rest. */
  it('counts a part-delivered batch once', () => {
    const { repos, base } = stack();
    hold(repos, 'gravefields-mausoleums');
    // Thirty ordered, ten of them out and standing: forty held would be the double count.
    repos.bases.updateArmy('b', { death_cloaks: 10 }, [
      {
        id: 'order-1',
        unitId: 'death_cloaks',
        count: 30,
        delivered: 10,
        startedAt: HOUR,
        durationSeconds: 3600,
        paid: {},
      },
    ]);
    expect(heldCapRoom(repos, base(), DEATH_CLOAKS)).toBe(20);
  });

  it('is nobody else`s ceiling', () => {
    const { repos, base } = stack();
    expect(heldCapRoom(repos, base(), findUnit('razors')!)).toBe(null);
    expect(
      projectUnits(repos, base(), NOW).units.find((one) => one.id === 'razors')?.room,
    ).toBeUndefined();
  });
});
