/**
 * §B7: the Gate hides what the raider can count, not only what a scout can.
 *
 * `gateIntelResistancePercent` is half of what the structure is for, and it reached exactly one
 * reader: the city map (`city/view.ts`). The deployment screen, which is where an attacker decides
 * how much to send and the one place a wrong count is paid for in units, folded only the crew's own
 * counter-intelligence. The same screen draws the Gate's figure two panels away, so the number was
 * printed beside the reading it did not affect.
 */
import {
  DECLARE_INFAMY_COST,
  declarationWindow,
  skirmishOutcome,
  type BattleTarget,
  type BattlesResponse,
  type Building,
  type SkirmishEngine,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';
import { settleMovements } from './movement.js';

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

const PRESS: BattleTarget = {
  kind: 'location',
  districtId: 'rustyard',
  locationId: 'rustyard-press',
};

async function register(app: FastifyInstance, username: string) {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  expect(chosen.statusCode, chosen.body.slice(0, 200)).toBe(201);
  // Both crews are the same person: a signature perk on one side only would land in the difference
  // below as if it were the Gate.
  pinOverseer(app, token);
  const baseId = chosen.json<{ base: { id: string } }>().base.id;
  const purse = app.repos.bases.findById(baseId)!.economy;
  app.repos.bases.updateEconomy(baseId, { ...purse, infamy: DECLARE_INFAMY_COST * 8 });
  return { token, baseId };
}

/** What the raider can make of the garrison standing in the way, with a Gate of `level` behind it. */
async function countedThroughGate(level: number): Promise<number | null> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const engine: SkirmishEngine = { resolve: () => skirmishOutcome({ winner: 'attacker' }) };
  const app = await buildApp({ config, db, skirmishEngine: engine, logger: false });
  instances.push({ app, db });

  const attacker = await register(app, 'attacker');
  const defender = await register(app, 'defender');

  const control = app.repos.city.control('rustyard-press')!;
  app.repos.city.put({ ...control, holder: { kind: 'crew', baseId: defender.baseId } });
  app.repos.city.markScouted(attacker.baseId, 'rustyard', new Date().toISOString());

  const base = app.repos.bases.findById(defender.baseId)!;
  const without = base.buildings.filter((building) => building.kind !== 'gate');
  const buildings: Building[] =
    level <= 0
      ? without
      : [...without, { id: 'gate-under-test', kind: 'gate', level, modifications: [], damage: 0 }];
  app.repos.bases.updateBuildings(defender.baseId, buildings);
  app.repos.bases.updateArmy(defender.baseId, { razors: 57 }, base.trainingQueue);

  const declared = await app.inject({
    method: 'POST',
    url: '/api/battles/declare',
    headers: auth(attacker.token),
    payload: { target: PRESS, scheduledFor: declarationWindow(new Date()).earliest.toISOString() },
  });
  expect(declared.statusCode, declared.body.slice(0, 200)).toBe(200);

  const theirs = await app.inject({
    method: 'GET',
    url: '/api/battles',
    headers: auth(defender.token),
  });
  const called = theirs.json<BattlesResponse>().coming[0];
  if (!called) throw new Error('fixture: the defender cannot see the fight');
  // `readEnemy` counts what has been sent, so the defender stands their squad on the ground.
  const stood = await app.inject({
    method: 'POST',
    url: '/api/battles/deploy',
    headers: auth(defender.token),
    payload: { battleId: called.battle.id, changes: { razors: 57 }, perimeterChanges: {} },
  });
  expect(stood.statusCode, stood.body.slice(0, 200)).toBe(200);
  // The column has to have landed: `sideForce` counts what is standing there at the mark, not what
  // is still on the road.
  db.prepare('UPDATE troop_movements SET departed_at = ?, arrives_at = ?').run(
    new Date(Date.now() - 120_000).toISOString(),
    new Date(Date.now() - 60_000).toISOString(),
  );
  settleMovements(app.repos, new Date());

  const board = await app.inject({
    method: 'GET',
    url: '/api/battles',
    headers: auth(attacker.token),
  });
  const view = board.json<BattlesResponse>().coming[0];
  if (!view) throw new Error('fixture: the attacker cannot see the fight');
  return view.enemySize;
}

describe('a Gate standing behind the fight', () => {
  it('blurs the count on the deployment screen', async () => {
    const open = await countedThroughGate(0);
    expect(open, 'the raider could not count an undefended door').toBeGreaterThan(0);

    const walled = await countedThroughGate(20);
    // Either the count is gone entirely or it is rounded away from the truth. Both are the blur
    // doing its job; what must not happen is the raider reading the exact figure regardless.
    expect(walled, 'a maxed Gate did nothing for the count it was built to hide').not.toBe(open);
  });
});
