import {
  CITY_DISTRICTS,
  declarationWindow,
  infamyForRaidWon,
  skirmishOutcome,
  type BattleTarget,
  type BattlesResponse,
  type SkirmishEngine,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { settleMovements } from './movement.js';
import { settleBattles } from './resolve.js';

/**
 * Holding your ground is not winning a raid.
 *
 * `infamyForRaidWon` prices what taking ground off the state is worth, the seat of power on top.
 * The defender's books were written through the same function with `won` set to "the attacker
 * lost", so a crew that repelled an attack on the Spire with nobody killed banked 140: the raid
 * premium, the Combine premium and the seat premium, for a fight it did not start. Two accounts
 * could farm it, the attacker risking nothing. The defender is paid for the kills and nothing else.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** The defender holds and nobody dies, so whatever is banked is not for a kill. */
const bloodlessHold: SkirmishEngine = {
  resolve: () =>
    skirmishOutcome({ winner: 'defender', log: ['held'], killed: {}, winnerLosses: {} }),
};

async function register(app: FastifyInstance, username: string) {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
  expect(chosen.statusCode, chosen.body.slice(0, 200)).toBe(201);
  return { token, baseId: chosen.json<{ base: { id: string } }>().base.id };
}

describe('what a successful defence pays', () => {
  it('pays the defender nothing for a bloodless hold, even on the seat of power', async () => {
    const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
    const db = openDatabase(config.databasePath);
    runMigrations(db);
    const app = await buildApp({ config, db, skirmishEngine: bloodlessHold, logger: false });
    instances.push({ app, db });

    const attacker = await register(app, 'attacker');
    const defender = await register(app, 'defender');

    // The ground where the premium is largest: Combine ground, and the seat of power.
    const spire = CITY_DISTRICTS.find((district) => district.id === 'combine-spire');
    const location = spire?.locations[0];
    if (!spire || !location) throw new Error('fixture: the Spire has no locations');
    expect(
      infamyForRaidWon({ fromTheState: true, seatOfPower: true }),
      'the premium this test is about',
    ).toBeGreaterThan(0);
    app.repos.city.put({
      locationId: location.id,
      holder: { kind: 'crew', baseId: defender.baseId },
      level: 1,
      upgradingUntil: null,
      fortification: 0,
      fortifyingUntil: null,
      garrison: { razors: 1 },
    });
    app.repos.city.markScouted(attacker.baseId, spire.id, new Date().toISOString());

    const before = app.repos.bases.findById(defender.baseId)?.economy.infamy ?? 0;
    const target: BattleTarget = {
      kind: 'location',
      districtId: spire.id,
      locationId: location.id,
    };
    const declared = await app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(attacker.token),
      payload: { target, scheduledFor: declarationWindow(new Date()).earliest.toISOString() },
    });
    expect(declared.statusCode, declared.body.slice(0, 200)).toBe(200);
    const board = await app.inject({
      method: 'GET',
      url: '/api/battles',
      headers: auth(attacker.token),
    });
    const view = board.json<BattlesResponse>().coming[0];
    if (!view) throw new Error('fixture: the declaration is not on the board');
    await app.inject({
      method: 'POST',
      url: '/api/battles/deploy',
      headers: auth(attacker.token),
      payload: { battleId: view.battle.id, changes: { razors: 1 }, perimeterChanges: {} },
    });

    db.prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?').run(
      new Date(Date.now() - 60_000).toISOString(),
      view.battle.id,
    );
    db.prepare('UPDATE troop_movements SET arrives_at = ?').run(
      new Date(Date.now() - 120_000).toISOString(),
    );
    settleMovements(app.repos, new Date());
    settleBattles(app.repos, bloodlessHold, new Date());

    const after = app.repos.bases.findById(defender.baseId)?.economy.infamy ?? 0;
    expect(after - before).toBe(0);
  });
});
