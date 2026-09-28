import {
  STARTING_RESOURCES,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
} from '@frontline/shared';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from './index.js';
import { createRepositories } from './repos/index.js';

/**
 * Migration 0123: the fight tier becomes the grade (maintainer, 2026-09-28).
 *
 * A crew out on a fight when the build lands has to meet the force it left for. Each old tier is
 * mapped to the grade whose fight is nearest what that tier fielded, the Siege goes to Mayhem
 * because Mayhem inherited its guaranteed page and parts, and a plain row keeps a null grade that
 * the settle reads as the job's lowest.
 *
 * Run up to 0122 with rows in the old shape, then let the whole ladder resume, so what is measured
 * is the migration and not a read-time default beside it.
 */

const NOW = '2026-09-28T12:00:00.000Z';
const MIGRATIONS = fileURLToPath(new URL('./migrations/', import.meta.url));

/** Every tier the column could hold, and the grade the migration owes it. */
const TIER_TO_GRADE = [
  ['fight_1', 'F'],
  ['fight_2', 'E'],
  ['fight_3', 'D+'],
  ['fight_4', 'C+'],
  ['fight_5', 'B+'],
  ['siege', 'S-'],
] as const;

const dbs: AppDatabase[] = [];
const dirs: string[] = [];

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A database walked up to the migration before this one, the shape a live save was in. */
function beforeGrades(): AppDatabase {
  const before = mkdtempSync(path.join(tmpdir(), 'frontline-0122-'));
  dirs.push(before);
  for (const file of readdirSync(MIGRATIONS)) {
    if (file.endsWith('.sql') && file < '0123') {
      cpSync(path.join(MIGRATIONS, file), path.join(before, file));
    }
  }
  const db = openDatabase(':memory:');
  dbs.push(db);
  runMigrations(db, before);
  return db;
}

/** A crew to hang the rows off: `missions.base_id` is a foreign key. */
function seedBase(db: AppDatabase): string {
  const repos = createRepositories(db);
  repos.users.insert({ id: 'u', username: 'veteran', passwordHash: 'x', createdAt: NOW });
  repos.bases.insert({
    id: 'b',
    ownerId: 'u',
    name: 'The Yard',
    districtId: 'neon-docks',
    level: 1,
    isBot: false,
    resources: STARTING_RESOURCES,
    economy: startingEconomy(NOW),
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [],
    buildQueue: [],
    army: {},
    trainingQueue: [],
    training: startingTraining(NOW),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [],
    createdAt: NOW,
  });
  return 'b';
}

/** A row in the pre-grade shape, with only the columns that have no default. */
function insertRow(db: AppDatabase, id: string, templateId: string, tier: string | null): void {
  db.prepare(
    `INSERT INTO missions
       (id, base_id, template_id, started_at, travel_minutes, duration_minutes, success_chance,
        seed, status, battle_tier)
     VALUES (?, 'b', ?, ?, 5, 30, 0.75, 7, 'active', ?)`,
  ).run(id, templateId, NOW, tier);
}

describe('migration 0123, the fight tier as a grade', () => {
  it('maps every tier to its grade, leaves a plain row ungraded, and drops the tier', () => {
    const db = beforeGrades();
    seedBase(db);
    for (const [tier] of TIER_TO_GRADE) insertRow(db, `fight-${tier}`, 'convoy-ambush', tier);
    insertRow(db, 'plain', 'scrap-run', null);

    const applied = runMigrations(db);
    // The first thing the ladder picks up, not the whole tail of it: a migration written after
    // this one lands here too and is not what this test measures.
    expect(applied[0]).toBe('0123_mission_grade.sql');

    const grades = Object.fromEntries(
      (
        db.prepare('SELECT id, grade FROM missions').all() as { id: string; grade: string | null }[]
      ).map((row) => [row.id, row.grade]),
    );
    for (const [tier, grade] of TIER_TO_GRADE) expect(grades[`fight-${tier}`], tier).toBe(grade);
    expect(grades.plain).toBeNull();

    const columns = (db.prepare('PRAGMA table_info(missions)').all() as { name: string }[]).map(
      (column) => column.name,
    );
    expect(columns).toContain('grade');
    expect(columns).not.toContain('battle_tier');

    // And the repository reads the migrated rows, the Siege as Mayhem's lowest grade and the
    // plain row as null, which the settle reads as the job's lowest.
    const repos = createRepositories(db);
    expect(repos.missions.findById('fight-siege')?.mission.grade).toBe('S-');
    expect(repos.missions.findById('plain')?.mission.grade).toBeNull();
  });
});
