/**
 * §D7: the reach on the drop-down is the reach the fight applies.
 *
 * `reach` is the only number on a boost card that is about this particular fight, and it was
 * computed off the deployment rows while the settler priced the boost against everything standing
 * on the ground. For a defender the two are not close: a location fight folds in the garrison and
 * a home raid folds in the whole roster (`assemble`), so a boost quoted at "+35%, reaches 100%"
 * could land on a force three times the size and be worth a third of that. The player pays first
 * and reads the real figure never.
 */
import {
  DECLARE_INFAMY_COST,
  boostCoverage,
  declarationWindow,
  findBattleBoost,
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
import { chooseOverseer } from '../testing/overseer.js';

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** A boost on one weight class, so the share of the force it reaches is a number worth reading. */
const PLATED = findBattleBoost('boost_plated_overnight');
if (!PLATED || PLATED.effect.kind !== 'tier') throw new Error('fixture: the tier boost moved');
const PLATED_ID = PLATED.id;
const PLATED_EFFECT = PLATED.effect;

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
  const baseId = chosen.json<{ base: { id: string } }>().base.id;
  const purse = app.repos.bases.findById(baseId)!.economy;
  app.repos.bases.updateEconomy(baseId, { ...purse, infamy: DECLARE_INFAMY_COST * 8 });
  return { token, baseId };
}

describe('what a boost card promises the defender', () => {
  it('prices it against the garrison that will be standing there', async () => {
    const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
    const db = openDatabase(config.databasePath);
    runMigrations(db);
    const engine: SkirmishEngine = { resolve: () => skirmishOutcome({ winner: 'attacker' }) };
    const app = await buildApp({ config, db, skirmishEngine: engine, logger: false });
    instances.push({ app, db });

    const attacker = await register(app, 'attacker');
    const defender = await register(app, 'defender');

    // The defender holds the place with heavy units on it, and sends nothing extra: the garrison
    // is the whole of what will fight, and it is exactly what the deployment rows do not carry.
    const garrison = { ironsides: 8 };
    const control = app.repos.city.control(PRESS.kind === 'location' ? PRESS.locationId : '')!;
    app.repos.city.put({
      ...control,
      holder: { kind: 'crew', baseId: defender.baseId },
      garrison,
    });
    app.repos.city.markScouted(attacker.baseId, 'rustyard', new Date().toISOString());

    const declared = await app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(attacker.token),
      payload: {
        target: PRESS,
        scheduledFor: declarationWindow(new Date()).earliest.toISOString(),
      },
    });
    expect(declared.statusCode, declared.body.slice(0, 200)).toBe(200);

    const board = await app.inject({
      method: 'GET',
      url: '/api/battles',
      headers: auth(defender.token),
    });
    const view = board.json<BattlesResponse>().coming[0];
    if (!view) throw new Error('fixture: the defender cannot see the fight');
    const card = view.boosts.find((option) => option.id === PLATED_ID);
    if (!card) throw new Error('fixture: the tier boost is not on the shelf');

    // What the settler will apply, computed off the same force `assemble` hands the engine.
    expect(card.reach, 'the card priced a force that is not the one that fights').toBe(
      Math.round(boostCoverage(PLATED_EFFECT, garrison) * 100),
    );
    expect(card.reach, 'a garrison of nothing but heavies reaches all of itself').toBe(100);
  });
});
