import { createCommander, type Base } from '@frontline/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { leadersFor } from './leaders.js';
import {
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
} from '@frontline/shared';

/**
 * What the send dialog is told about the people who could lead a run.
 *
 * The part worth a file of its own is `arrivalPercent`. `launchMission` shortens a led run by
 * `leadArrivalPercent` and the figure was on no payload the screen could read, so the dialog
 * quoted a run led by somebody with Short Way up to ten per cent long, on the one line the maintainer
 * asked to be exact. These pin that it reaches the wire and that it carries the launch's own rule
 * about who gets it.
 */

let db: AppDatabase;
let repos: Repositories;

const T0 = new Date('2026-09-13T12:00:00.000Z');
const OWNER = 'owner-1';

function makeBase(over: Partial<Base> = {}): Base {
  const now = T0.toISOString();
  return {
    id: 'base-1',
    ownerId: OWNER,
    name: 'The Yard',
    districtId: 'kettle-row',
    level: 6,
    isBot: false,
    resources: { caps: 0, supplies: 0, oil: 0, scrap: 0, planks: 0, highQualityMetal: 0 },
    economy: startingEconomy(now),
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [{ id: 'b-nexus', kind: 'nexus', level: 3, modifications: [], damage: 0 }],
    buildQueue: [],
    army: {},
    trainingQueue: [],
    training: startingTraining(now),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [],
    createdAt: now,
    ...over,
  };
}

/** The Overseer the bench is built around. Named, because the bench is a list of people. */
const OVERSEER = {
  id: 'overseer-1',
  userId: OWNER,
  presetId: 'enforcer',
  name: 'Marcus Kane',
  archetype: 'enforcer' as const,
  portraitId: 'overseer-1',
  bio: 'Runs it like a shift.',
  attributes: Object.fromEntries(
    ['strength', 'stamina', 'dexterity', 'speed', 'reflexes', 'toughness', 'stealth'].map(
      (name) => [name, 20],
    ),
  ) as never,
  perks: [],
};

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db);
  repos = createRepositories(db);
  db.prepare(
    `INSERT INTO users (id, username, password_hash, created_at) VALUES (?, 'one', 'x', ?)`,
  ).run(OWNER, T0.toISOString());
});

const bench = (base: Base) => leadersFor({ repos, base, overseer: undefined, active: [], now: T0 });

describe('what a leader takes off the road', () => {
  it('is nothing when nobody on the books has the perk', () => {
    const base = makeBase({
      commanders: [createCommander('off-1', 'Plain Officer', 'raid_boss', { leadership: 40 })],
    });
    repos.bases.insert(base);
    expect(bench(base).map((one) => one.arrivalPercent)).toEqual([0]);
  });

  /**
   * `Short Way` is ten per cent, and it reaches the wire.
   *
   * Mutating the figure back to zero used to change nothing anywhere in the server suite: the
   * whole point of shipping it is the screen, so without this the fix is only guarded on the
   * client and a projection that quietly stopped sending it would be invisible here.
   */
  it('is the perk’s own figure once somebody on the books has it', () => {
    const base = makeBase({
      commanders: [
        createCommander('off-1', 'The Quick Way', 'raid_boss', { leadership: 40 }, ['short_way']),
      ],
    });
    repos.bases.insert(base);
    expect(bench(base).map((one) => one.arrivalPercent)).toEqual([10]);
  });

  /**
   * The Overseer never gets it, which is the launch's own rule.
   *
   * `routes/missions.ts` spends `leadArrivalPercent` only when an officer leads. A screen that
   * shortened the clock for the Overseer would be promising a run the launch does not book.
   */
  it('is never paid to the Overseer, however good the books are', () => {
    const base = makeBase({
      commanders: [
        createCommander('off-1', 'The Quick Way', 'raid_boss', { leadership: 40 }, ['short_way']),
      ],
    });
    repos.bases.insert(base);
    const withOverseer = leadersFor({
      repos,
      base,
      overseer: OVERSEER,
      active: [],
      now: T0,
    });

    const overseer = withOverseer.find((one) => one.kind === 'overseer');
    const officer = withOverseer.find((one) => one.kind === 'officer');
    expect(overseer?.arrivalPercent).toBe(0);
    expect(officer?.arrivalPercent).toBe(10);
  });
});
