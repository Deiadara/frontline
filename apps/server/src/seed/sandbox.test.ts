import {
  BUILDING_KINDS,
  BUILDING_MAX_LEVEL,
  UNIT_IDS,
  isBuildingUnlocked,
  startingAssignees,
  startingEconomy,
  startingProgression,
  startingResearch,
  STARTING_RESOURCES,
  storageCapacity,
  storageCapacityFor,
  type ResourceKey,
  type Base,
  startingTraining,
} from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { applyUnlockedSandbox, UNLOCKED_LEVEL } from './sandbox.js';

/**
 * The sandbox switch, checked against the thing it exists for: can a reviewer see the end-game?
 *
 * "Everything is unlocked" is a claim about *gates*, not about numbers, so the assertions below ask
 * the game's own gate functions rather than comparing levels: a base that is level 20 but still
 * fails `isBuildingUnlocked` would satisfy a naive check and show a reviewer the same locked plots
 * they were trying to get past.
 */

const dbs: AppDatabase[] = [];
afterEach(() => dbs.splice(0).forEach((db) => db.close()));

const NOW = '2026-08-15T12:00:00.000Z';

function stack(): Repositories {
  const db = openDatabase(':memory:');
  dbs.push(db);
  runMigrations(db);
  return createRepositories(db);
}

function seedFreshPlayer(repos: Repositories, username = 'Nikos'): Base {
  repos.users.insert({ id: 'u1', username, passwordHash: 'x', createdAt: NOW });
  const base: Base = {
    id: 'b1',
    ownerId: 'u1',
    name: 'The Ninth Street Crew',
    districtId: 'neon-docks',
    level: 1,
    isBot: false,
    resources: STARTING_RESOURCES,
    economy: startingEconomy(NOW),
    progression: startingProgression(),
    research: startingResearch(),
    assignees: startingAssignees(),
    buildings: [
      { id: 'b-nexus', kind: 'nexus', level: 1, modifications: [], damage: 0, fortification: 0 },
    ],
    buildQueue: [],
    army: {},
    trainingQueue: [],
    training: startingTraining('2026-08-16T00:00:00.000Z'),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [],
    createdAt: NOW,
  };
  repos.bases.insert(base);
  return base;
}

describe('UNLOCKED: the end-game sandbox', () => {
  it('is off unless the environment says exactly "true"', () => {
    expect(loadConfig({}).unlocked).toBe(false);
    expect(loadConfig({ UNLOCKED: 'true' }).unlocked).toBe(true);
    // A flag that turns on for several spellings turns on by accident.
    for (const value of ['1', 'yes', 'TRUE', 'on', '']) {
      expect(loadConfig({ UNLOCKED: value }).unlocked, value).toBe(false);
    }
  });

  it('leaves a fresh district behind every gate it starts behind', () => {
    const repos = stack();
    const base = seedFreshPlayer(repos);
    // The control: without the switch, most of the catalogue is locked. If this ever stopped being
    // true the assertion below would pass for free.
    const locked = BUILDING_KINDS.filter(
      (kind) => !isBuildingUnlocked(kind, base.buildings, base.level),
    );
    expect(locked.length).toBeGreaterThan(5);
  });

  it('puts every structure on the ground, past its own gate, at the ceiling', () => {
    const repos = stack();
    seedFreshPlayer(repos);

    expect(applyUnlockedSandbox(repos, 'Nikos').applied).toBe(true);
    const after = repos.bases.findById('b1');
    expect(after).toBeDefined();
    if (!after) return;

    expect(after.buildings).toHaveLength(BUILDING_KINDS.length);
    for (const kind of BUILDING_KINDS) {
      const standing = after.buildings.find((b) => b.kind === kind);
      expect(standing?.level, kind).toBe(BUILDING_MAX_LEVEL);
      // The gate function, not the level: this is the thing the client asks before it draws a plot
      // as buildable, so it is the thing that decides whether a reviewer sees the end-game.
      expect(isBuildingUnlocked(kind, after.buildings, after.level), kind).toBe(true);
    }
  });

  it('fields the whole roster, and a stockpile the rules could actually produce', () => {
    const repos = stack();
    seedFreshPlayer(repos);
    applyUnlockedSandbox(repos, 'Nikos');

    const after = repos.bases.findById('b1');
    expect(Object.keys(after?.army ?? {}).sort()).toEqual([...UNIT_IDS].sort());
    expect(after?.level).toBe(UNLOCKED_LEVEL);

    /*
     * Near the ceiling, under it, on **each shelf**. A flat six-figure handout was twenty times
     * what a maxed Apothecary can hold, which pinned every capacity bar in the HUD to full and
     * red: an end-game that spends its whole life warning about a state it can never leave.
     *
     * Per shelf rather than against one figure, because the three of them are different sizes: a
     * handout sized to the bulk shelf sits at 300% on the metal one and is exactly the bug this
     * assertion exists to catch, arriving from the other side.
     */
    const buildings = after?.buildings ?? [];
    const bulk = storageCapacity(buildings);
    for (const [key, value] of Object.entries(after?.resources ?? {})) {
      const room = storageCapacityFor(buildings, key as ResourceKey, bulk);
      // Caps have no shelf, so what is asserted of them is only that the wallet is not absurd.
      const against = Number.isFinite(room) ? room : bulk;
      expect(value, key).toBeLessThan(against);
      expect(value, key).toBeGreaterThan(against * 0.5);
    }
    expect(bulk).toBeGreaterThan(10_000);
  });

  it('clears the queues, so nothing is mid-build in a state meant to be finished', () => {
    const repos = stack();
    seedFreshPlayer(repos);
    repos.bases.updateDistrict(
      'b1',
      [{ id: 'n', kind: 'nexus', level: 1, modifications: [], damage: 0, fortification: 0 }],
      [{ id: 'q1', kind: 'quarters', level: 1, startedAt: NOW, durationSeconds: 60 }],
    );

    applyUnlockedSandbox(repos, 'Nikos');
    const after = repos.bases.findById('b1');
    expect(after?.buildQueue).toEqual([]);
    expect(after?.trainingQueue).toEqual([]);
  });

  /** Applied on every boot, so it has to be safe to apply twice. */
  it('is idempotent', () => {
    const repos = stack();
    seedFreshPlayer(repos);
    applyUnlockedSandbox(repos, 'Nikos');
    const once = repos.bases.findById('b1');
    applyUnlockedSandbox(repos, 'Nikos');
    expect(repos.bases.findById('b1')).toEqual(once);
  });

  it('does nothing at all for an account that is not there', () => {
    const repos = stack();
    expect(applyUnlockedSandbox(repos, 'Nobody')).toEqual({ applied: false });
  });
});
