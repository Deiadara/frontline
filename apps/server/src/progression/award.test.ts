import {
  PLAYER_XP_AWARDS,
  STARTING_RESOURCES,
  findDistrict,
  playerXpToNextLevel,
  startingEconomy,
  startingAssignees,
  startingProgression,
  startingResearch,
  type Base,
  type BattleEngine,
  type BattleWinner,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { awardPlayerXp } from './award.js';

const NOW = '2026-08-13T09:30:00.000Z';
const open: AppDatabase[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of open.splice(0)) db.close();
});

function makeRepos(): { db: AppDatabase; repos: Repositories } {
  const db = openDatabase(':memory:');
  runMigrations(db);
  open.push(db);
  return { db, repos: createRepositories(db) };
}

function seedBase(db: AppDatabase, repos: Repositories, level: number): Base {
  db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1',
    'operator',
    'hash',
    NOW,
  );
  const base: Base = {
    id: 'base-1',
    ownerId: 'user-1',
    name: 'The Foothold',
    districtId: 'neon-docks',
    level,
    isBot: false,
    resources: STARTING_RESOURCES,
    economy: startingEconomy(NOW),
    progression: startingProgression(),
    research: startingResearch(),
    assignees: startingAssignees(),
    buildings: [],
    commanders: [],
    createdAt: NOW,
  };
  repos.bases.insert(base);
  return base;
}

describe('awardPlayerXp — the single XP write path (INTERFACES R7)', () => {
  it('banks XP without levelling when the award falls short', () => {
    const { db, repos } = makeRepos();
    const base = seedBase(db, repos, 1);

    const { base: after, award } = awardPlayerXp(repos, base, 'raidWon');

    expect(award).toMatchObject({ source: 'raidWon', xpGained: 80, levelsGained: 0, level: 1 });
    expect(after.progression.xpIntoLevel).toBe(80);
    // Persisted, not just returned.
    expect(repos.bases.findById('base-1')).toMatchObject({
      level: 1,
      progression: { xpIntoLevel: 80 },
    });
  });

  it('writes the new level and the carried-over XP together on a level-up', () => {
    const { db, repos } = makeRepos();
    const base = seedBase(db, repos, 1);

    awardPlayerXp(repos, base, 'raidWon'); // 80
    const reread = repos.bases.findById('base-1');
    expect(reread).toBeDefined();
    const { award } = awardPlayerXp(repos, reread as Base, 'questCompleted'); // +200 => 280, clears 100

    expect(award).toMatchObject({ level: 2, levelsGained: 1 });
    expect(repos.bases.findById('base-1')).toMatchObject({
      level: 2,
      progression: { xpIntoLevel: 180 },
    });
  });

  it('hands back the §I2 grants the new level unlocked', () => {
    const { db, repos } = makeRepos();
    // 580 of the 600 needed to clear level 3; one mission (120) crosses into level 4.
    const base = seedBase(db, repos, 3);
    repos.bases.updateProgression(base.id, 3, { xpIntoLevel: 580 });
    const at3 = repos.bases.findById('base-1') as Base;

    const { award } = awardPlayerXp(repos, at3, 'missionCompleted');

    expect(award.level).toBe(4);
    // Level 4 is where §G3's per-officer cap turns over from 1 to 2.
    expect(award.grants).toEqual({ assigneePool: 5, assigneeCapPerOfficer: 2, recruitSlots: 5 });
    expect(award.unlocks).toEqual([]); // §I3 catalogue is the board's to file
  });

  it("never leaves stored progress at or above the stored level's threshold", () => {
    const { db, repos } = makeRepos();
    let base = seedBase(db, repos, 1);
    for (let i = 0; i < 60; i += 1) {
      base = awardPlayerXp(repos, base, 'questCompleted').base;
      const stored = repos.bases.findById('base-1') as Base;
      expect(stored.progression.xpIntoLevel).toBeLessThan(playerXpToNextLevel(stored.level));
      expect(stored.level).toBe(base.level);
    }
    expect(base.level).toBeGreaterThan(1);
  });
});

describe('migration 0005_progression', () => {
  /**
   * The R6 trap, guarded: `0003_economy.sql` defaulted `economy_json` to `'{}'`, which its own
   * schema rejects — so only the fresh-insert path produced anything valid. Reading a row that
   * never wrote `progression_json` proves this column's DEFAULT does not repeat it.
   */
  it('defaults a row that predates the column to a valid, readable progression', () => {
    const { db, repos } = makeRepos();
    db.prepare(
      'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
    ).run('user-1', 'operator', 'hash', NOW);
    // Every column except progression_json — the shape an older row has after ADD COLUMN.
    db.prepare(
      `INSERT INTO bases
         (id, owner_id, name, district_id, level, is_bot,
          resources_json, economy_json, buildings_json, commanders_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'base-old',
      'user-1',
      'Legacy Hold',
      'neon-docks',
      2,
      0,
      JSON.stringify(STARTING_RESOURCES),
      JSON.stringify(startingEconomy(NOW)),
      '[]',
      '[]',
      NOW,
    );

    expect(repos.bases.findById('base-old')).toMatchObject({
      level: 2,
      progression: { xpIntoLevel: 0 },
    });
  });
});

describe('XP source pricing (§I1)', () => {
  it('pays for fighting, not only for winning', () => {
    expect(PLAYER_XP_AWARDS.raidLost).toBeGreaterThan(0);
    expect(PLAYER_XP_AWARDS.raidWon).toBeGreaterThan(PLAYER_XP_AWARDS.raidLost);
  });
});

/**
 * §I1 names "fighting other players" as an XP source, and raiding is the one fight the game can
 * currently stage — so this is the live wiring, not a unit test of it. The mission source (§E) is
 * wired at W3's resolution site by whoever lands second (INTERFACES §2 R7).
 */
describe('POST /api/battle awards XP (§I1)', () => {
  const raid = findDistrict('rustyard');
  if (!raid) throw new Error('fixture error: rustyard district missing');
  const raidId = raid.id;

  const engineThatAlways = (winner: BattleWinner): BattleEngine => ({
    simulate: () => ({ winner, log: ['test'], rewards: {} }),
  });

  async function raidOnce(winner: BattleWinner): Promise<Base> {
    const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
    const db = openDatabase(config.databasePath);
    runMigrations(db);
    open.push(db);
    const app = await buildApp({
      config,
      db,
      battleEngine: engineThatAlways(winner),
      logger: false,
    });
    apps.push(app);

    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'commander', password: 'hunter2pass' },
    });
    const token = reg.json<{ token: string }>().token;
    const headers = { authorization: `Bearer ${token}` };
    const created = await app.inject({
      method: 'POST',
      url: '/api/overseer',
      headers,
      payload: { presetId: 'enforcer' },
    });
    const baseId = created.json<{ base: { id: string } }>().base.id;

    const battle = await app.inject({
      method: 'POST',
      url: '/api/battle',
      headers,
      payload: { targetDistrictId: raidId },
    });
    expect(battle.statusCode).toBe(200);

    const detail = await app.inject({ method: 'GET', url: `/api/base/${baseId}`, headers });
    return detail.json<{ base: Base }>().base;
  }

  it('banks the win award on the attacker, readable on the next base read', async () => {
    const base = await raidOnce('attacker');
    expect(base.progression.xpIntoLevel).toBe(PLAYER_XP_AWARDS.raidWon);
    expect(base.level).toBe(1);
  });

  it('still pays, less, for a raid that failed', async () => {
    const base = await raidOnce('defender');
    expect(base.progression.xpIntoLevel).toBe(PLAYER_XP_AWARDS.raidLost);
  });
});
