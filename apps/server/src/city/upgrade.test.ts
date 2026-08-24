import {
  MAX_LOCATION_LEVEL,
  bonusesAt,
  declarationWindow,
  findLocation,
  skirmishOutcome,
  upgradeCost,
  type BattleTarget,
  type BattlesResponse,
  type DistrictDetailResponse,
  type LocationView,
  type SkirmishEngine,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { settleBattles } from '../battle/resolve.js';
import { UPGRADE_SECONDS_SCALE, upgradeSeconds } from './upgrade.js';

/**
 * §A4 — a location is a post you take, work up, and lose.
 *
 * The whole board-game loop in one file, and the last assertion is the one the design turns on:
 * **a capture resets the level to 1.** Nobody inherits the previous holder's work, so a
 * well-developed location is a target worth taking rather than a wall that compounds forever, and
 * pouring three upgrades into ground you cannot hold is a mistake the game lets you make.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

/** The Bonefield: handed to the crew in `makeStack`, so it is the one they can work on. */
const MINE = 'rustyard-bonefield';
/** Kessler Press: still the looters', so it is the one somebody can take off them. */
const PRESS: BattleTarget = {
  kind: 'location',
  districtId: 'rustyard',
  locationId: 'rustyard-press',
};

interface Stack {
  app: FastifyInstance;
  db: AppDatabase;
  token: string;
  baseId: string;
}

const engine: SkirmishEngine = {
  resolve: () => skirmishOutcome({ winner: 'attacker', log: ['x'] }),
};

async function makeStack(): Promise<Stack> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, skirmishEngine: engine, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'landlord', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
  const baseId = chosen.json<{ base: { id: string } }>().base.id;

  await app.inject({
    method: 'POST',
    url: '/api/city/scout',
    headers: auth(token),
    payload: { districtId: 'rustyard' },
  });
  const control = app.repos.city.control(MINE);
  if (control)
    app.repos.city.put({ ...control, holder: { kind: 'faction', baseId }, garrison: {} });

  // Enough to cover three upgrades of anything on this ground without the test being about money.
  app.repos.bases.updateResources(baseId, {
    caps: 99_000,
    food: 9_000,
    oil: 9_000,
    scrap: 9_000,
    highQualityMetal: 900,
  });

  return { app, db, token, baseId };
}

const read = async (stack: Stack, locationId = MINE): Promise<LocationView> => {
  const res = await stack.app.inject({
    method: 'GET',
    url: '/api/city/rustyard',
    headers: auth(stack.token),
  });
  expect(res.statusCode, res.body).toBe(200);
  // `GET /city/:id` answers with the district detail itself, not wrapped.
  const view = res
    .json<DistrictDetailResponse>()
    .locations.find((candidate) => candidate.location.id === locationId);
  if (!view) throw new Error(`no view for ${locationId}`);
  return view;
};

const upgrade = (stack: Stack, locationId = MINE) =>
  stack.app.inject({
    method: 'POST',
    url: '/api/city/upgrade',
    headers: auth(stack.token),
    payload: { locationId },
  });

/** Drags a location's upgrade clock into the past, the way the battle tests drag a mark. */
function finishWork(stack: Stack, locationId = MINE): void {
  const control = stack.app.repos.city.control(locationId);
  if (!control?.upgradingUntil) throw new Error('nothing is being worked on');
  stack.app.repos.city.put({
    ...control,
    upgradingUntil: new Date(Date.now() - 1000).toISOString(),
  });
}

describe('working a location up (§A4)', () => {
  it('starts every location at level 1 and offers the first upgrade', async () => {
    const stack = await makeStack();
    const view = await read(stack);
    expect(view.level).toBe(1);
    expect(view.upgrade?.toLevel).toBe(2);
    expect(view.upgrade?.note.length ?? 0).toBeGreaterThan(20);
    expect(view.upgrade?.cost).toEqual(upgradeCost(view.location.kind, 1));
  });

  it('charges for it, puts a clock on it, and banks it on the next read', async () => {
    const stack = await makeStack();
    const before = stack.app.repos.bases.findById(stack.baseId)?.resources.caps ?? 0;
    const cost = upgradeCost(findLocation(MINE)!.kind, 1)?.caps ?? 0;

    const res = await upgrade(stack);
    expect(res.statusCode, res.body).toBe(200);
    expect(stack.app.repos.bases.findById(stack.baseId)?.resources.caps).toBe(before - cost);

    // Still level 1 while the work is under way — the clock is the whole point.
    const during = await read(stack);
    expect(during.level).toBe(1);
    expect(during.upgradingUntil).not.toBeNull();

    finishWork(stack);
    const after = await read(stack);
    expect(after.level).toBe(2);
    expect(after.upgradingUntil).toBeNull();
  });

  it('pays more at the new level, and says so on the card', async () => {
    const stack = await makeStack();
    const before = await read(stack);
    await upgrade(stack);
    finishWork(stack);
    const after = await read(stack);

    expect(after.bonuses).not.toEqual(before.bonuses);
    // Not just *different* — the same bonuses, described at the new level, one line each.
    expect(after.bonuses).toHaveLength(bonusesAt(after.location.kind, 2).length);
    for (const line of after.bonuses) expect(line.length).toBeGreaterThan(2);
  });

  it('takes three upgrades to the ceiling and then stops offering', async () => {
    const stack = await makeStack();
    for (let level = 1; level < MAX_LOCATION_LEVEL; level += 1) {
      expect((await upgrade(stack)).statusCode).toBe(200);
      finishWork(stack);
      expect((await read(stack)).level).toBe(level + 1);
    }
    const topped = await read(stack);
    expect(topped.level).toBe(MAX_LOCATION_LEVEL);
    expect(topped.upgrade).toBeNull();
    expect((await upgrade(stack)).statusCode).toBe(409);
  });

  it('refuses a second job while one is under way', async () => {
    const stack = await makeStack();
    expect((await upgrade(stack)).statusCode).toBe(200);
    const second = await upgrade(stack);
    expect(second.statusCode).toBe(409);
    expect(second.json<{ error: { message: string } }>().error.message).toMatch(/under way/i);
  });

  it('refuses ground somebody else is holding', async () => {
    const stack = await makeStack();
    const res = await upgrade(stack, 'rustyard-press');
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { message: string } }>().error.message).toMatch(/do not hold/i);
  });

  it('refuses a crew that cannot cover it, and charges them nothing', async () => {
    const stack = await makeStack();
    stack.app.repos.bases.updateResources(stack.baseId, {
      caps: 0,
      food: 0,
      oil: 0,
      scrap: 0,
      highQualityMetal: 0,
    });
    const res = await upgrade(stack);
    expect(res.statusCode).toBe(409);
    expect(stack.app.repos.city.control(MINE)?.upgradingUntil).toBeNull();
  });

  it('takes longer at each step, and longer on harder ground', () => {
    const kind = findLocation(MINE)!.kind;
    for (let level = 1; level < UPGRADE_SECONDS_SCALE.length; level += 1) {
      expect(upgradeSeconds(kind, level + 1)).toBeGreaterThan(upgradeSeconds(kind, level));
    }
    // The Bonefield is a war machine graveyard (defence 6); the Ramp is a skate ground (1).
    expect(upgradeSeconds('war_machine_graveyard', 1)).toBeGreaterThan(
      upgradeSeconds('skate_ground', 1),
    );
  });
});

describe('what a capture does to the work', () => {
  /**
   * The rule the whole level system stands on.
   *
   * The looters are holding Kessler Press at some level; the crew takes it; it is theirs at **1**,
   * not at whatever it was. Asserted from a fully-worked location rather than a fresh one, because
   * the failure mode is "the level came across with the ground" and a location already at 1 cannot
   * tell the difference.
   */
  it('resets a captured location to level 1, however far it had been worked up', async () => {
    const stack = await makeStack();

    // Somebody else's fully-developed location.
    const held = stack.app.repos.city.control('rustyard-press');
    if (!held) throw new Error('no control row for the press');
    stack.app.repos.city.put({ ...held, level: MAX_LOCATION_LEVEL, garrison: { razors: 1 } });
    expect((await read(stack, 'rustyard-press')).level).toBe(MAX_LOCATION_LEVEL);

    const declared = await stack.app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(stack.token),
      payload: {
        target: PRESS,
        scheduledFor: declarationWindow(new Date()).earliest.toISOString(),
      },
    });
    expect(declared.statusCode, declared.body).toBe(200);

    const board = await stack.app.inject({
      method: 'GET',
      url: '/api/battles',
      headers: auth(stack.token),
    });
    const view = board.json<BattlesResponse>().coming[0];
    if (!view) throw new Error('expected a declared battle');
    await stack.app.inject({
      method: 'POST',
      url: '/api/battles/deploy',
      headers: auth(stack.token),
      payload: { battleId: view.battle.id, changes: { razors: 4 }, perimeterChanges: {} },
    });
    stack.db
      .prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?')
      .run(new Date(Date.now() - 60_000).toISOString(), view.battle.id);
    settleBattles(stack.app.repos, stack.app.skirmishEngine, new Date());

    const taken = stack.app.repos.city.control('rustyard-press');
    expect(taken?.holder).toEqual({ kind: 'faction', baseId: stack.baseId });
    expect(taken?.level, 'a capture resets the work').toBe(1);
    expect(taken?.upgradingUntil).toBeNull();
  });

  /** And a capture kills work that was in progress, rather than handing it over half done. */
  it('cancels an upgrade that was under way when the ground changed hands', async () => {
    const stack = await makeStack();
    const held = stack.app.repos.city.control('rustyard-press');
    if (!held) throw new Error('no control row for the press');
    stack.app.repos.city.put({
      ...held,
      level: 3,
      upgradingUntil: new Date(Date.now() + 3_600_000).toISOString(),
      garrison: { razors: 1 },
    });

    const declared = await stack.app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(stack.token),
      payload: {
        target: PRESS,
        scheduledFor: declarationWindow(new Date()).earliest.toISOString(),
      },
    });
    expect(declared.statusCode, declared.body).toBe(200);
    const board = await stack.app.inject({
      method: 'GET',
      url: '/api/battles',
      headers: auth(stack.token),
    });
    const view = board.json<BattlesResponse>().coming[0];
    if (!view) throw new Error('expected a declared battle');
    await stack.app.inject({
      method: 'POST',
      url: '/api/battles/deploy',
      headers: auth(stack.token),
      payload: { battleId: view.battle.id, changes: { razors: 4 }, perimeterChanges: {} },
    });
    stack.db
      .prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?')
      .run(new Date(Date.now() - 60_000).toISOString(), view.battle.id);
    settleBattles(stack.app.repos, stack.app.skirmishEngine, new Date());

    const taken = stack.app.repos.city.control('rustyard-press');
    expect(taken?.level).toBe(1);
    expect(taken?.upgradingUntil).toBeNull();
  });
});
