import {
  ATTRIBUTE_NAMES,
  STARTING_RESOURCES,
  createCommander,
  makeAttributes,
  startingEconomy,
  startingProgression,
  startingTraining,
  type Base,
  type Commander,
} from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { liftedOfficerSheet, officerLiftRoom } from './standing.js';

/**
 * Shared Knowledge (maintainer, 2026-09-28): "All other officers get +5 stealth, +3 deception and
 * +3 Cryptography", taught by the Master of Whispers.
 *
 * Driven through the lift every sheet in the game is read off (`liftedOfficerSheet`), so the
 * assertion is on the number a fight, a research gate and the crew screen all see.
 */

const HOUR = '2026-09-28T12:00:00.000Z';
const NOW = new Date(HOUR);
const RUNG = 'tech_shared_knowledge';
const LESSON = { stealth: 5, deception: 3, cryptography: 3 } as const;

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

function crew(repos: Repositories, officers: Commander[], technologies: string[] = [RUNG]): Base {
  repos.users.insert({ id: 'u', username: 'lessons', passwordHash: 'x', createdAt: HOUR });
  const base: Base = {
    id: 'b',
    ownerId: 'u',
    name: 'The Classroom',
    districtId: 'neon-docks',
    level: 1,
    isBot: false,
    resources: { ...STARTING_RESOURCES },
    economy: startingEconomy(HOUR),
    progression: startingProgression(),
    research: { active: null, technologies },
    buildings: [],
    buildQueue: [],
    army: {},
    trainingQueue: [],
    training: startingTraining(HOUR),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: officers,
    createdAt: HOUR,
  };
  repos.bases.insert(base);
  return base;
}

const whispers = () =>
  createCommander('wire', 'Wire', 'master_of_whispers', makeAttributes(20), []);
const trader = () => createCommander('pupil', 'Pupil', 'trader', makeAttributes(20), []);

function sheetOf(repos: Repositories, base: Base, officerId: string) {
  const officer = base.commanders.find((entry) => entry.id === officerId)!;
  return liftedOfficerSheet(officer, officerLiftRoom(repos, base, NOW));
}

describe('Shared Knowledge', () => {
  it('teaches every other seated officer the three lessons, and nothing else', () => {
    const repos = openStack();
    const base = crew(repos, [whispers(), trader()]);
    const { attributes, lift } = sheetOf(repos, base, 'pupil');
    for (const name of ATTRIBUTE_NAMES) {
      const lesson = (LESSON as Partial<Record<string, number>>)[name] ?? 0;
      expect(attributes[name], name).toBe(20 + lesson);
    }
    // The receipt names the teacher, the way it names a teaching perk.
    expect(
      lift
        .filter((line) => line.from === 'Wire')
        .map((line) => line.attribute)
        .sort(),
    ).toEqual(['cryptography', 'deception', 'stealth']);
  });

  it('never teaches the Master of Whispers their own lesson', () => {
    const repos = openStack();
    const base = crew(repos, [whispers(), trader()]);
    expect(sheetOf(repos, base, 'wire').attributes.stealth).toBe(20);
  });

  it('teaches nobody until the rung is finished', () => {
    const repos = openStack();
    const base = crew(repos, [whispers(), trader()], []);
    expect(sheetOf(repos, base, 'pupil').attributes.stealth).toBe(20);
  });

  it('gives the bench nothing', () => {
    const repos = openStack();
    const benched = createCommander('bench', 'Bench', null, makeAttributes(20), []);
    const base = crew(repos, [whispers(), benched]);
    expect(sheetOf(repos, base, 'bench').attributes.stealth).toBe(20);
  });

  it('needs somebody working the chair to do the teaching', () => {
    const repos = openStack();
    const inBed: Commander = { ...whispers(), injuredUntil: '2026-09-29T12:00:00.000Z' };
    const withoutChair = crew(repos, [trader()]);
    expect(sheetOf(repos, withoutChair, 'pupil').attributes.stealth).toBe(20);
    const repos2 = openStack();
    const injured = crew(repos2, [inBed, trader()]);
    expect(sheetOf(repos2, injured, 'pupil').attributes.deception).toBe(20);
  });
});
