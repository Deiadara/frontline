import {
  DECLARE_INFAMY_COST,
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
import { chooseOverseer } from '../testing/overseer.js';

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
  const chosen = await chooseOverseer(app, token);
  expect(chosen.statusCode, chosen.body.slice(0, 200)).toBe(201);
  const baseId = chosen.json<{ base: { id: string } }>().base.id;
  // §D7: calling a fight costs infamy and nobody starts with any. Fixture money, enough for every
  // call this file makes.
  const purse = app.repos.bases.findById(baseId)!.economy;
  app.repos.bases.updateEconomy(baseId, { ...purse, infamy: DECLARE_INFAMY_COST * 8 });
  return { token, baseId };
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

  /**
   * §I1: what the winner's ring paid is a casualty like any other.
   *
   * A ring is a fight now rather than a toll, so it takes losses (`battle/perimeter.ts`), and those
   * losses were subtracted from the perimeter that marched home and then dropped. They were worth
   * no infamy to the crew that killed them, no Bone Market refund to the crew that lost them, and
   * nothing on the kill counter. The engine here kills nobody in the fight itself, so the whole of
   * what the defender banks below is the attacker's ring.
   */
  it('pays the loser for the winner ring it took down', async () => {
    const RING_DEAD = 2;
    const ringPays: SkirmishEngine = {
      resolve: () =>
        skirmishOutcome({
          winner: 'attacker',
          log: ['through'],
          killed: {},
          winnerLosses: {},
          perimeterLosses: { razors: RING_DEAD },
        }),
    };
    const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
    const db = openDatabase(config.databasePath);
    runMigrations(db);
    const app = await buildApp({ config, db, skirmishEngine: ringPays, logger: false });
    instances.push({ app, db });

    const attacker = await register(app, 'attacker');
    const defender = await register(app, 'defender');

    const spire = CITY_DISTRICTS.find((district) => district.id === 'combine-spire');
    const location = spire?.locations[0];
    if (!spire || !location) throw new Error('fixture: the Spire has no locations');
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

    // Enough at home for a line and a ring behind it.
    const home = app.repos.bases.findById(attacker.baseId)!;
    app.repos.bases.updateArmy(home.id, { razors: 12 }, home.trainingQueue);

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
    const sent = await app.inject({
      method: 'POST',
      url: '/api/battles/deploy',
      headers: auth(attacker.token),
      payload: {
        battleId: view.battle.id,
        changes: { razors: 4 },
        perimeterChanges: { razors: 4 },
      },
    });
    expect(sent.statusCode, sent.body.slice(0, 200)).toBe(200);

    db.prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?').run(
      new Date(Date.now() - 60_000).toISOString(),
      view.battle.id,
    );
    db.prepare('UPDATE troop_movements SET arrives_at = ?').run(
      new Date(Date.now() - 120_000).toISOString(),
    );
    settleMovements(app.repos, new Date());
    settleBattles(app.repos, ringPays, new Date());

    // Razors are one unit slot each, and §I1 prices a slot that does not walk off the field at one.
    const after = app.repos.bases.findById(defender.baseId)?.economy.infamy ?? 0;
    expect(after - before, 'the ring died for nothing').toBe(RING_DEAD);
  });
});
