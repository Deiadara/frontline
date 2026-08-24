import {
  declarationWindow,
  skirmishOutcome,
  type Army,
  type BattleTarget,
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
 * §A4: "have the units stay after a successful capture".
 *
 * Two fights that used to be spelled the same way. A **raid** takes the ground and marches home: the
 * map changes colour and the crew is back on the roster tonight. An **occupation** takes the ground
 * and stays: the survivors are the location's garrison, they answer for it when somebody comes to take
 * it back, and they are gone from the roster until somebody pulls them out.
 *
 * What has to hold is a conservation law, and it is why every assertion here counts *both* ends. A
 * body is on the roster or it is on the ground, never both and never neither: the failure this
 * guards against is not "the flag did nothing", it is "the flag worked and the survivors were also
 * still at home", which doubles a crew's army every time it takes a location and which no assertion
 * about the garrison alone can see.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

const PRESS: BattleTarget = {
  kind: 'location',
  districtId: 'rustyard',
  locationId: 'rustyard-press',
};

/** How many bodies are in a force, whichever side of the line it is standing on. */
const bodies = (force: Army): number =>
  Object.values(force).reduce((total, count) => total + count, 0);

interface Stack {
  app: FastifyInstance;
  db: AppDatabase;
  token: string;
  baseId: string;
}

/**
 * The engine hands the fight to `winner` and kills nobody.
 *
 * A clean sweep on purpose: with no casualties, "the survivors" is exactly the committed force, so
 * the numbers below are the ones the deployment put in rather than a subtraction this test would
 * have to reproduce. What is being measured is *where the survivors end up*, not how many there are.
 *
 * A losing attacker's whole force runs, for the same reason: it separates "they came home because
 * they lost" from "they came home because the engine killed nobody and the settler had nothing left
 * to location".
 */
function engineFor(winner: 'attacker' | 'defender'): SkirmishEngine {
  return {
    resolve: (input) =>
      skirmishOutcome({
        winner,
        log: ['decided'],
        ...(winner === 'defender' ? { fled: input.attacking } : {}),
      }),
  };
}

async function makeStack(winner: 'attacker' | 'defender' = 'attacker'): Promise<Stack> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, skirmishEngine: engineFor(winner), logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'occupier', password: 'hunter2pass' },
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
  // One location off the looters, so the Rustyard's gate is no longer armed and a location can be called.
  const control = app.repos.city.control('rustyard-bonefield');
  if (control) {
    app.repos.city.put({ ...control, holder: { kind: 'faction', baseId }, garrison: {} });
  }

  return { app, db, token, baseId };
}

/** Declares, deploys `sent`, drags the mark into the past and settles. */
async function fight(
  stack: Stack,
  options: { hold: boolean; sent: Army; target?: BattleTarget },
): Promise<void> {
  const declared = await stack.app.inject({
    method: 'POST',
    url: '/api/battles/declare',
    headers: auth(stack.token),
    payload: {
      target: options.target ?? PRESS,
      scheduledFor: declarationWindow(new Date()).earliest.toISOString(),
      holdAfterCapture: options.hold,
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
    payload: { battleId: view.battle.id, changes: options.sent, perimeterChanges: {} },
  });

  stack.db
    .prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?')
    .run(new Date(Date.now() - 60_000).toISOString(), view.battle.id);

  settleBattles(stack.app.repos, stack.app.skirmishEngine, new Date());
}

const rosterOf = (stack: Stack): Army => stack.app.repos.bases.findById(stack.baseId)?.army ?? {};
const garrisonOf = (stack: Stack): Army =>
  stack.app.repos.city.control('rustyard-press')?.garrison ?? {};

describe('what happens to the crew that took the location', () => {
  it('marches them home and leaves the location empty when the box is not ticked', async () => {
    const stack = await makeStack();
    const before = bodies(rosterOf(stack));

    await fight(stack, { hold: false, sent: { razors: 4 } });

    expect(garrisonOf(stack), 'a raid leaves nobody behind').toEqual({});
    expect(bodies(rosterOf(stack)), 'a raid brings everybody back').toBe(before);
    // ...and the ground still changed hands. The flag decides where the crew sleeps, not who won.
    expect(stack.app.repos.city.control('rustyard-press')?.holder).toEqual({
      kind: 'faction',
      baseId: stack.baseId,
    });
  });

  it('leaves them holding it when the box is ticked, and off the roster', async () => {
    const stack = await makeStack();
    const before = bodies(rosterOf(stack));

    await fight(stack, { hold: true, sent: { razors: 4 } });

    expect(garrisonOf(stack), 'the survivors hold what they took').toEqual({ razors: 4 });
    // The conservation law: four bodies left the roster to fight and four are standing on the
    // press, so the roster is four short. A version that garrisoned them *and* sent them home
    // satisfies the line above and fails this one.
    expect(bodies(rosterOf(stack))).toBe(before - 4);
    expect(stack.app.repos.city.control('rustyard-press')?.holder).toEqual({
      kind: 'faction',
      baseId: stack.baseId,
    });
  });

  it('brings them home again when they are pulled out', async () => {
    const stack = await makeStack();
    const before = bodies(rosterOf(stack));
    await fight(stack, { hold: true, sent: { razors: 4 } });
    // Stated before the withdraw, so this test fails on a build where nobody ever stayed rather
    // than passing because the roster was already whole.
    expect(garrisonOf(stack), 'nobody was left to pull out').toEqual({ razors: 4 });

    // The withdraw the board asked for is the garrison call with a negative delta. There is no
    // second endpoint, and this is the half of "unless they are pulled out" that makes the other
    // half safe to offer.
    const pulled = await stack.app.inject({
      method: 'POST',
      url: '/api/city/garrison',
      headers: auth(stack.token),
      payload: { locationId: 'rustyard-press', changes: { razors: -4 } },
    });
    expect(pulled.statusCode, pulled.body).toBe(200);

    expect(garrisonOf(stack)).toEqual({});
    expect(bodies(rosterOf(stack))).toBe(before);
  });

  it('holds nothing when the fight was lost, however the box was ticked', async () => {
    const stack = await makeStack('defender');
    const before = bodies(rosterOf(stack));
    await fight(stack, { hold: true, sent: { razors: 4 } });

    // Losing means the ground never changed hands, so there is nothing of the attacker's to leave
    // on it, and whoever ran comes home, which is what losing has always done. The garrison is not
    // asserted to be empty, and deliberately: on a successful defence it holds the *defender's*
    // survivors, which is the existing rule and not this flag's business.
    expect(stack.app.repos.city.control('rustyard-press')?.holder).not.toEqual({
      kind: 'faction',
      baseId: stack.baseId,
    });
    expect(bodies(rosterOf(stack)), 'a beaten force that ran is still a force').toBe(before);
  });
});
