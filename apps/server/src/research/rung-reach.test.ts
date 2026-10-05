import {
  RESEARCH_ITEMS,
  STARTING_RESOURCES,
  noCrewEffects,
  researchEffects,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Base,
} from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { crewEffectsFor, standingEffectsFor } from '../crew/standing.js';

/**
 * Every rung, through the two folds the consumers read (wiring audit, 2026-10-01).
 *
 * A rung pays nothing of its own: it lands on `CrewEffects` and every consumer reads it off
 * `standingEffectsFor` or `crewEffectsFor`. So the one place a rung can go dead without any
 * consumer test noticing is the seam between `researchEffects` and those two folds. This walks
 * the whole catalogue across it: what a finished rung moves on the bare fold is exactly what it
 * moves on each server fold, channel for channel, and nothing else moves.
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

function emptyCrew(repos: Repositories): Base {
  repos.users.insert({ id: 'u', username: 'reach', passwordHash: 'x', createdAt: HOUR });
  const base: Base = {
    id: 'b',
    ownerId: 'u',
    name: 'The Lab',
    districtId: 'neon-docks',
    level: 1,
    isBot: false,
    resources: { ...STARTING_RESOURCES },
    economy: startingEconomy(HOUR),
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [],
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

/** Every leaf that differs between two folds, as `path: before -> after`. */
function moved(before: unknown, after: unknown, path = ''): string[] {
  const leaf = (value: unknown): boolean =>
    typeof value === 'number' || typeof value === 'boolean' || Array.isArray(value);
  if (leaf(before) || leaf(after)) {
    const a = JSON.stringify(before ?? (Array.isArray(after) ? [] : 0));
    const b = JSON.stringify(after ?? (Array.isArray(before) ? [] : 0));
    return a === b ? [] : [`${path}: ${a} -> ${b}`];
  }
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...keys].flatMap((key) =>
    moved(
      (before as Record<string, unknown> | undefined)?.[key],
      (after as Record<string, unknown> | undefined)?.[key],
      path ? `${path}.${key}` : key,
    ),
  );
}

describe('every research rung reaches the folds its consumers read', () => {
  it.each(RESEARCH_ITEMS.filter((spec) => spec.payout.bonus !== undefined).map((s) => [s.id]))(
    '%s',
    (id) => {
      const repos = openStack();
      const base = emptyCrew(repos);
      const finished: Base = { ...base, research: { active: null, technologies: [id] } };

      const paid = moved(noCrewEffects(), researchEffects([id]));
      // A rung with a bonus that moves nothing on its own fold is dead before it reaches a seam.
      expect(paid.length).toBeGreaterThan(0);
      expect(
        moved(standingEffectsFor(repos, base, NOW), standingEffectsFor(repos, finished, NOW)),
      ).toEqual(paid);
      expect(moved(crewEffectsFor(repos, base, NOW), crewEffectsFor(repos, finished, NOW))).toEqual(
        paid,
      );
    },
  );
});
