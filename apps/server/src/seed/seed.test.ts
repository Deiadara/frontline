import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  BOT_DISTRICT_ID,
  MVP_DEV_CREDENTIALS,
  STARTING_RESOURCES,
  findDistrict,
  MAX_RAID_SHARE,
  type CityResponse,
  type RaidDistrictResponse,
  type SkirmishEngine,
  skirmishOutcome,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { MVP_BOT } from './constants.js';
import { seedMvpWorld } from './index.js';

interface Stack {
  app: FastifyInstance;
  db: AppDatabase;
  repos: Repositories;
}

const stacks: Stack[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const { app, db } of stacks.splice(0)) {
    await app.close();
    db.close();
  }
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A migrated app over `databasePath`. Pass a file path to survive a close/reopen cycle. */
async function openStack(databasePath: string, skirmishEngine?: SkirmishEngine): Promise<Stack> {
  const config = loadConfig({ DATABASE_PATH: databasePath, JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = skirmishEngine
    ? await buildApp({ config, db, skirmishEngine, logger: false })
    : await buildApp({ config, db, logger: false });
  const stack: Stack = { app, db, repos: createRepositories(db) };
  stacks.push(stack);
  return stack;
}

/** A throwaway sqlite file that outlives an app close, so restarts can be simulated. */
function tempDatabasePath(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'frontline-seed-'));
  tempDirs.push(dir);
  return path.join(dir, 'frontline.sqlite');
}

function countUsers(db: AppDatabase, username: string): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM users WHERE username = ?').get(username) as {
    n: number;
  };
  return row.n;
}

function countBotBases(db: AppDatabase): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM bases WHERE is_bot = 1').get() as { n: number };
  return row.n;
}

async function login(app: FastifyInstance, password: string) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: MVP_DEV_CREDENTIALS.username, password },
  });
}

function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

/** Sign in as the seeded operator and settle their base by choosing an overseer. */
async function landAsDevPlayer(app: FastifyInstance): Promise<{ token: string; baseId: string }> {
  const res = await login(app, MVP_DEV_CREDENTIALS.password);
  expect(res.statusCode).toBe(200);
  const token = res.json<{ token: string }>().token;

  const overseer = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
  expect(overseer.statusCode).toBe(201);
  return { token, baseId: overseer.json<{ base: { id: string } }>().base.id };
}

describe('seedMvpWorld', () => {
  it('creates exactly one dev operator and one bot base', async () => {
    const { db, repos } = await openStack(':memory:');

    const summary = await seedMvpWorld({ db, repos });

    expect(summary.createdPlayer).toBe(true);
    expect(summary.createdBot).toBe(true);
    expect(countUsers(db, MVP_DEV_CREDENTIALS.username)).toBe(1);
    expect(countUsers(db, MVP_BOT.username)).toBe(1);
    expect(countBotBases(db)).toBe(1);
  });

  it('is idempotent when run twice against the same database', async () => {
    const { db, repos } = await openStack(':memory:');

    await seedMvpWorld({ db, repos });
    const before = repos.users.findByUsername(MVP_DEV_CREDENTIALS.username);
    expect(before).toBeDefined();

    const second = await seedMvpWorld({ db, repos });

    expect(second.createdPlayer).toBe(false);
    expect(second.createdBot).toBe(false);
    expect(countUsers(db, MVP_DEV_CREDENTIALS.username)).toBe(1);
    expect(countUsers(db, MVP_BOT.username)).toBe(1);
    expect(countBotBases(db)).toBe(1);

    const after = repos.users.findByUsername(MVP_DEV_CREDENTIALS.username);
    expect(after?.id).toBe(before?.id);
    expect(after?.passwordHash).toBe(before?.passwordHash);
  });

  it('does not reset or duplicate anything across a server restart', async () => {
    const databasePath = tempDatabasePath();

    const first = await openStack(databasePath);
    await seedMvpWorld({ db: first.db, repos: first.repos });
    const player = first.repos.users.findByUsername(MVP_DEV_CREDENTIALS.username);
    const botBase = first.repos.bases.findBotByDistrictId(BOT_DISTRICT_ID);
    // The player's progress must survive the restart too.
    await landAsDevPlayer(first.app);
    await first.app.close();
    first.db.close();
    stacks.length = 0;

    const second = await openStack(databasePath);
    const summary = await seedMvpWorld({ db: second.db, repos: second.repos });

    expect(summary.createdPlayer).toBe(false);
    expect(summary.createdBot).toBe(false);
    expect(countUsers(second.db, MVP_DEV_CREDENTIALS.username)).toBe(1);
    expect(countUsers(second.db, MVP_BOT.username)).toBe(1);
    expect(countBotBases(second.db)).toBe(1);

    const playerAfter = second.repos.users.findByUsername(MVP_DEV_CREDENTIALS.username);
    expect(playerAfter?.id).toBe(player?.id);
    expect(playerAfter?.passwordHash).toBe(player?.passwordHash);
    expect(playerAfter?.overseerId).toBeTruthy(); // the overseer picked before the restart
    expect(second.repos.bases.findBotByDistrictId(BOT_DISTRICT_ID)?.id).toBe(botBase?.id);
  });

  it('restores a rival whose base row was deleted, reusing its user and overseer', async () => {
    const { db, repos } = await openStack(':memory:');
    await seedMvpWorld({ db, repos });
    const botUser = repos.users.findByUsername(MVP_BOT.username);
    db.prepare('DELETE FROM bases WHERE is_bot = 1').run();
    expect(countBotBases(db)).toBe(0);

    const summary = await seedMvpWorld({ db, repos });

    expect(summary.createdBot).toBe(true);
    expect(countBotBases(db)).toBe(1);
    expect(countUsers(db, MVP_BOT.username)).toBe(1); // no duplicate rival account
    const restored = repos.bases.findBotByDistrictId(BOT_DISTRICT_ID);
    expect(restored?.name).toBe(MVP_BOT.baseName);
    expect(restored?.ownerId).toBe(botUser?.id);
    expect(repos.users.findByUsername(MVP_BOT.username)?.overseerId).toBe(botUser?.overseerId);
  });

  it('survives two processes seeding the same database at once', async () => {
    const databasePath = tempDatabasePath();
    const [a, b] = await Promise.all([openStack(databasePath), openStack(databasePath)]);

    // Both connections seed concurrently, exactly as two `pnpm dev` boots would.
    const summaries = await Promise.all([
      seedMvpWorld({ db: a.db, repos: a.repos }),
      seedMvpWorld({ db: b.db, repos: b.repos }),
    ]);

    expect(summaries.filter((s) => s.createdPlayer)).toHaveLength(1);
    expect(summaries.filter((s) => s.createdBot)).toHaveLength(1);
    expect(countUsers(a.db, MVP_DEV_CREDENTIALS.username)).toBe(1);
    expect(countUsers(a.db, MVP_BOT.username)).toBe(1);
    expect(countBotBases(a.db)).toBe(1);
  });

  it('places a fortified, lootable bot base in the bot district', async () => {
    const { db, repos } = await openStack(':memory:');
    await seedMvpWorld({ db, repos });

    const base = repos.bases.findBotByDistrictId(BOT_DISTRICT_ID);
    expect(base).toBeDefined();
    expect(base?.isBot).toBe(true);
    expect(base?.name).toBe(MVP_BOT.baseName);
    expect(base?.districtId).toBe('ashen-terraces');
    expect(base?.buildings.map((b) => b.kind)).toEqual(
      expect.arrayContaining(['gate', 'gauntlet', 'nexus']),
    );
    expect(base?.commanders.length).toBeGreaterThan(0);
    expect(base?.resources.caps).toBeGreaterThan(STARTING_RESOURCES.caps);
  });

  it('exposes the bot base to the city map as a hostile summary', async () => {
    const { app, db, repos } = await openStack(':memory:');
    await seedMvpWorld({ db, repos });
    const { token } = await landAsDevPlayer(app);

    const res = await app.inject({ method: 'GET', url: '/api/city', headers: auth(token) });
    expect(res.statusCode).toBe(200);
    // §A4 — crews live on residential ground, and the map carries them on their own district.
    const bases = res
      .json<CityResponse>()
      .districts.flatMap((entry) => (entry.base ? [entry.base] : []));

    expect(bases.filter((b) => b.isBot)).toHaveLength(1);
    const bot = bases.find((b) => b.isBot);
    expect(bot?.districtId).toBe(BOT_DISTRICT_ID);
    expect(bot?.name).toBe(MVP_BOT.baseName);
    expect(bases.filter((b) => !b.isBot)).toHaveLength(1); // exactly one human base
  });
});

describe('seeded dev login', () => {
  it('accepts the hardcoded credentials', async () => {
    const { app, db, repos } = await openStack(':memory:');
    await seedMvpWorld({ db, repos });

    const res = await login(app, MVP_DEV_CREDENTIALS.password);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ token: string; user: { username: string; overseerId: null } }>();
    expect(body.token).toBeTruthy();
    expect(body.user.username).toBe(MVP_DEV_CREDENTIALS.username);
    expect(body.user.overseerId).toBeNull();
  });

  it('rejects a wrong password', async () => {
    const { app, db, repos } = await openStack(':memory:');
    await seedMvpWorld({ db, repos });

    const res = await login(app, 'definitely-not-the-password');
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('still rejects a 5-character password at /auth/register', async () => {
    const { app, db, repos } = await openStack(':memory:');
    await seedMvpWorld({ db, repos });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'newbie', password: MVP_DEV_CREDENTIALS.password },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('raiding the bot crew (§A4)', () => {
  const botDistrict = findDistrict(BOT_DISTRICT_ID);
  if (!botDistrict) throw new Error('fixture error: bot district missing from the city map');

  const alwaysWins: SkirmishEngine = {
    resolve: () => skirmishOutcome({ winner: 'attacker', log: ['robbed'] }),
  };

  /**
   * §A4 — a home district cannot be taken, only robbed.
   *
   * What leaves is bounded by what the raiders can physically *carry*, which is the whole reason
   * `lootCapacity` is measured in kilograms. Four Razors carry very little, so this asserts the
   * shape of the transfer rather than a magic number: something left the victim, the same thing
   * arrived at the raider, and the victim still has a district.
   */
  it('moves a share of the victim’s stockpile to the raider, and leaves them disrupted', async () => {
    const { app, db, repos } = await openStack(':memory:', alwaysWins);
    await seedMvpWorld({ db, repos });
    const { token, baseId } = await landAsDevPlayer(app);

    const bot = repos.bases.findBotByDistrictId(BOT_DISTRICT_ID);
    if (!bot) throw new Error('fixture error: no bot base in the bot district');
    const before = { ...bot.resources };

    const res = await app.inject({
      method: 'POST',
      url: '/api/city/raid',
      headers: auth(token),
      payload: { districtId: BOT_DISTRICT_ID, force: { razors: 4 } },
    });
    expect(res.statusCode).toBe(200);

    const body = res.json<RaidDistrictResponse>();
    expect(body.result.winner).toBe('attacker');
    expect(body.carriedKg).toBeGreaterThan(0);

    const taken = body.result.rewards;
    expect(Object.keys(taken).length).toBeGreaterThan(0);

    const victim = repos.bases.findById(bot.id);
    const raider = repos.bases.findById(baseId);
    for (const [key, amount] of Object.entries(taken)) {
      const resource = key as keyof typeof before;
      expect(victim?.resources[resource]).toBe(before[resource] - (amount ?? 0));
      expect(raider?.resources[resource]).toBe(STARTING_RESOURCES[resource] + (amount ?? 0));
    }

    // The district itself never changes hands — that is the whole rule.
    expect(victim?.districtId).toBe(BOT_DISTRICT_ID);
    // And it is left running at reduced effectiveness for a while.
    expect(victim?.economy.disruption.until).not.toBeNull();
    expect(victim?.economy.disruption.percent).toBeGreaterThan(0);
  });

  it('never takes more than a quarter of any one line, however big the force', async () => {
    const { app, db, repos } = await openStack(':memory:', alwaysWins);
    await seedMvpWorld({ db, repos });
    const { token, baseId } = await landAsDevPlayer(app);

    // A force that can carry the whole city home.
    const hauler = repos.bases.findById(baseId);
    if (!hauler) throw new Error('fixture error: no raider base');
    repos.bases.updateArmy(baseId, { muckrakers: 400 }, []);

    const bot = repos.bases.findBotByDistrictId(BOT_DISTRICT_ID);
    if (!bot) throw new Error('fixture error: no bot base');
    const before = { ...bot.resources };

    const res = await app.inject({
      method: 'POST',
      url: '/api/city/raid',
      headers: auth(token),
      payload: { districtId: BOT_DISTRICT_ID, force: { muckrakers: 400 } },
    });
    expect(res.statusCode).toBe(200);

    const taken = res.json<RaidDistrictResponse>().result.rewards;
    for (const [key, amount] of Object.entries(taken)) {
      const resource = key as keyof typeof before;
      expect(amount ?? 0, key).toBeLessThanOrEqual(Math.floor(before[resource] * MAX_RAID_SHARE));
    }
    // A player who logs in to nothing has no move to make, so something always survives.
    const victim = repos.bases.findById(bot.id);
    expect(victim?.resources.caps).toBeGreaterThan(0);
  });
});
