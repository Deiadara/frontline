import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  BOT_DISTRICT_ID,
  MVP_DEV_CREDENTIALS,
  STARTING_RESOURCES,
  type CityResponse,
  type SkirmishEngine,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { ALLY_DISTRICT_ID, MVP_ALLY, MVP_BOT } from './constants.js';
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

/**
 * Every non-playing crew in the world.
 *
 * Two now, and the number is the point of the assertions below: the **rival** you fight and the
 * **ally** you fight beside. Both are `is_bot = 1` because neither is driven by a person, so a
 * count of one here was the old world and a count of three would mean the seeder had run twice.
 */
function countBotBases(db: AppDatabase): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM bases WHERE is_bot = 1').get() as { n: number };
  return row.n;
}

const SEEDED_BOTS = 2;

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
    expect(countBotBases(db)).toBe(SEEDED_BOTS);
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
    expect(countBotBases(db)).toBe(SEEDED_BOTS);

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
    expect(countBotBases(second.db)).toBe(SEEDED_BOTS);

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
    // The *rival's* row, not every bot row. The ally has a battle on the board with a foreign key
    // to their base, so deleting them here would be testing a state the game cannot reach and
    // failing on the integrity rule that stops it.
    db.prepare('DELETE FROM bases WHERE district_id = ?').run(BOT_DISTRICT_ID);
    expect(countBotBases(db)).toBe(SEEDED_BOTS - 1);

    const summary = await seedMvpWorld({ db, repos });

    expect(summary.createdBot).toBe(true);
    expect(countBotBases(db)).toBe(SEEDED_BOTS);
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
    expect(countBotBases(a.db)).toBe(SEEDED_BOTS);
  });

  it('places a fortified, lootable bot base in the bot district', async () => {
    const { db, repos } = await openStack(':memory:');
    await seedMvpWorld({ db, repos });

    const base = repos.bases.findBotByDistrictId(BOT_DISTRICT_ID);
    expect(base).toBeDefined();
    expect(base?.isBot).toBe(true);
    expect(base?.name).toBe(MVP_BOT.baseName);
    // Read off the constant rather than typed: the rival's plot has moved once already, and a
    // literal here only ever re-states what `seedMvpWorld` was given.
    expect(base?.districtId).toBe(BOT_DISTRICT_ID);
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
    // §A4: crews live on residential ground, and the map carries them on their own district.
    const bases = res
      .json<CityResponse>()
      .districts.flatMap((entry) => (entry.base ? [entry.base] : []));

    // Two non-playing crews on the map: the rival on their ground and the ally on theirs. Both are
    // ordinary district rows, which is what makes the ally visible to every screen without any of
    // them knowing they are a fixture.
    expect(bases.filter((b) => b.isBot)).toHaveLength(SEEDED_BOTS);
    const bot = bases.find((b) => b.districtId === BOT_DISTRICT_ID);
    expect(bot?.isBot).toBe(true);
    expect(bot?.name).toBe(MVP_BOT.baseName);
    const ally = bases.find((b) => b.districtId === ALLY_DISTRICT_ID);
    expect(ally?.isBot).toBe(true);
    expect(ally?.name).toBe(MVP_ALLY.baseName);
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

/*
 * The raid tests were here, and they went with `POST /api/city/raid` (board, battle rework).
 *
 * What they measured: that a raid moves a bounded share of the victim's stockpile, that a home
 * district never changes hands, and that it is left disrupted afterwards: is all still true and
 * all still tested. It happens through the declared path now: break the gate, then hit a structure
 * behind it. `battle/siege.test.ts` covers the loot bound and `battle/battle.test.ts` the settle.
 */

/**
 * The rival is one account with one base, wherever that base happens to stand.
 *
 * The guard used to be "is the rival standing in `BOT_DISTRICT_ID`", which answers no as soon as
 * the rival moves or the constant changes, and the next boot minted a second base for the same
 * user. A real database had three, in three districts, dated to the three occasions the constant
 * moved. Each was a ghost: `findByOwnerId` returns one row, so nothing could settle the others,
 * while they sat on the leaderboard, held a name and occupied ground.
 *
 * Idempotence-when-nothing-changes was already covered. This is idempotence when the world moves
 * underneath the seed, which is the case that actually broke.
 *
 * What enforces it is the unique index in `0074_one_base_per_account.sql`, not the guard above the
 * insert: `seedStep` swallows `SQLITE_CONSTRAINT_UNIQUE` and returns false, so with the index in
 * place a district-keyed guard would attempt the insert, be refused by the database, and report
 * nothing created. This test therefore pins the *invariant* and cannot tell the two apart, which is
 * worth saying out loud because it looks like a test of the guard. The guard is still worth having:
 * relying on a swallowed constraint violation as control flow means the seed cannot distinguish
 * "already correct" from "tried to corrupt the database and was stopped".
 */
describe('the rival, when the ground moves under it', () => {
  it('does not mint a second base when the rival is no longer where it was seeded', async () => {
    const { db, repos } = await openStack(':memory:');
    await seedMvpWorld({ db, repos });

    const bot = repos.users.findByUsername(MVP_BOT.username);
    expect(bot, 'the rival account should exist after seeding').toBeDefined();
    const seeded = repos.bases.findByOwnerId(bot!.id);
    expect(seeded, 'the rival should have a base after seeding').toBeDefined();

    /*
     * Move the rival *off* `BOT_DISTRICT_ID`, the way a settled fight or a retuned constant would.
     *
     * Somewhere else, deliberately, and asserted: the first version of this moved it to
     * `upper-roofs`, which is where the seed already puts it, so the district-keyed guard still
     * found it and the test passed against the bug it was written for.
     */
    const elsewhere = 'kettle-row';
    expect(elsewhere, 'the test must move the rival somewhere it was not seeded').not.toBe(
      BOT_DISTRICT_ID,
    );
    db.prepare('UPDATE bases SET district_id = ? WHERE id = ?').run(elsewhere, seeded!.id);

    const again = await seedMvpWorld({ db, repos });

    expect(again.createdBot, 'the seed minted a second rival').toBe(false);
    expect(countBotBases(db), 'the rival ended up with more than one base').toBe(SEEDED_BOTS);
    expect(db.prepare('SELECT COUNT(*) AS n FROM bases WHERE owner_id = ?').get(bot!.id)).toEqual({
      n: 1,
    });
  });
});
