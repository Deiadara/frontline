import {
  PLAYER_XP_AWARDS,
  declarationWindow,
  skirmishOutcome,
  type BattlesResponse,
  type SkirmishEngine,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { settleBattles } from './resolve.js';

/**
 * §I1: fighting pays XP, through the fight the game actually has.
 *
 * This replaces the two suites that drove `POST /api/city/attack`. They measured a real thing and
 * their route is gone, and the gap they left behind was not small: with the instant path removed
 * and nothing wired into the settler, **no fight in the game paid anything**, and every unit test
 * of `awardPlayerXp` stayed green because the function was still perfectly correct. Nobody was
 * calling it.
 *
 * So this stands where that hole was: the real routes, the real settler, and the crew's own
 * progression row read back out of the database afterwards.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

const engine = (winner: 'attacker' | 'defender'): SkirmishEngine => ({
  resolve: () => skirmishOutcome({ winner, log: ['decided'] }),
});

interface Stack {
  app: FastifyInstance;
  db: AppDatabase;
  token: string;
  baseId: string;
}

async function makeStack(winner: 'attacker' | 'defender'): Promise<Stack> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, skirmishEngine: engine(winner), logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'brawler', password: 'hunter2pass' },
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
  const control = app.repos.city.control('rustyard-bonefield');
  if (control) {
    app.repos.city.put({ ...control, holder: { kind: 'crew', baseId }, garrison: {} });
  }

  return { app, db, token, baseId };
}

/** Calls a fight on the press, sends four Razors, drags the mark into the past and settles it. */
async function fight(stack: Stack): Promise<void> {
  await stack.app.inject({
    method: 'POST',
    url: '/api/battles/declare',
    headers: auth(stack.token),
    payload: {
      target: { kind: 'location', districtId: 'rustyard', locationId: 'rustyard-press' },
      scheduledFor: declarationWindow(new Date()).earliest.toISOString(),
    },
  });
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
}

const xpOf = (stack: Stack): number =>
  stack.app.repos.bases.findById(stack.baseId)?.progression.xpIntoLevel ?? -1;

describe('§I1: what a settled fight pays', () => {
  it('pays the winner', async () => {
    const stack = await makeStack('attacker');
    const before = xpOf(stack);
    await fight(stack);
    expect(xpOf(stack) - before).toBe(PLAYER_XP_AWARDS.raidWon);
  });

  it('pays the loser too, because §I1 pays for fighting rather than for winning', async () => {
    const stack = await makeStack('defender');
    const before = xpOf(stack);
    await fight(stack);
    expect(xpOf(stack) - before).toBe(PLAYER_XP_AWARDS.raidLost);
  });

  it('pays less for losing than for winning', () => {
    // Written as a comparison rather than as two numbers, because the two numbers are the
    // catalogue's business. What must never invert is the order.
    expect(PLAYER_XP_AWARDS.raidLost).toBeGreaterThan(0);
    expect(PLAYER_XP_AWARDS.raidWon).toBeGreaterThan(PLAYER_XP_AWARDS.raidLost);
  });

  it('pays once per fight, not once per read of it', async () => {
    const stack = await makeStack('attacker');
    const before = xpOf(stack);
    await fight(stack);

    // The settler runs on every city read. A battle it has already resolved must not pay again,
    // and the guard for that is `resolvedAt` rather than anything in the award path, which is
    // exactly why it is worth checking from out here.
    settleBattles(stack.app.repos, stack.app.skirmishEngine, new Date());
    settleBattles(stack.app.repos, stack.app.skirmishEngine, new Date());

    expect(xpOf(stack) - before).toBe(PLAYER_XP_AWARDS.raidWon);
  });
});
