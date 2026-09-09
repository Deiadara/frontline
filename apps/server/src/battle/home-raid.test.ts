/**
 * Raiding a crew's home: the door, the day it is open for, and whose home is off limits.
 *
 * §A4, board 2026-09-09. Two rules meet here and neither worked before it:
 *
 *   * **A home is shut.** A residential district holds no locations, so `districtHolder` answers
 *     null for one and `gateArmed` therefore answered false. Every crew's home was open ground:
 *     each of their thirteen structures was its own target, reachable with no gate to break, and
 *     the gate fight that was supposed to guard them was refused for want of a gate.
 *   * **A raid is one call.** The target behind the gate is the district, not a roof. Thirteen
 *     roofs against a cap of three pending declarations meant nobody ever turned a district over.
 *
 * The own-ground half is the other reason this file exists. `defenderOf` answers the *district's*
 * holder, which is `unoccupied` for residential ground, so nothing stopped a crew calling a fight
 * on its own home: the settle then looted the resident, who was the declarer, and paid the haul
 * back off a stockpile read before the loot. The same fight minted resources out of nothing.
 */
import {
  GATE_BREACH_HOURS,
  declarationWindow,
  type BattleTarget,
  type BattlesResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

interface Crew {
  token: string;
  baseId: string;
  districtId: string;
}

async function register(app: FastifyInstance, username: string): Promise<Crew> {
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
  const base = chosen.json<{ base: { id: string; districtId: string } }>().base;
  return { token, baseId: base.id, districtId: base.districtId };
}

interface World {
  app: FastifyInstance;
  db: AppDatabase;
  raider: Crew;
  victim: Crew;
}

/** The plot the victim is moved onto: a crew cannot raid the district it lives in. */
const HOME = 'ashen-terraces';

async function makeWorld(): Promise<World> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const raider = await register(app, 'raider');
  const planted = await register(app, 'victim');
  db.prepare('UPDATE bases SET district_id = ? WHERE id = ?').run(HOME, planted.baseId);
  app.repos.city.markScouted(raider.baseId, HOME, new Date().toISOString());
  return { app, db, raider, victim: { ...planted, districtId: HOME } };
}

/** Calls a fight, and answers with the status and the sentence the player would read. */
async function declare(
  world: World,
  crew: Crew,
  target: BattleTarget,
): Promise<{ status: number; body: string }> {
  const response = await world.app.inject({
    method: 'POST',
    url: '/api/battles/declare',
    headers: auth(crew.token),
    payload: { target, scheduledFor: declarationWindow(new Date()).earliest.toISOString() },
  });
  return { status: response.statusCode, body: response.body };
}

const gate: BattleTarget = { kind: 'gate', districtId: HOME };
const raid: BattleTarget = { kind: 'district', districtId: HOME };

describe('a home with its gate standing', () => {
  it('is fought at the gate, and nowhere else', async () => {
    const world = await makeWorld();

    // The raid behind the door is refused, and refused *for the door* rather than for anything else.
    const early = await declare(world, world.raider, raid);
    expect(early.status, early.body.slice(0, 200)).toBe(409);
    expect(early.body).toContain('The gate is standing');

    // And the gate itself is legal, which is the half that used to answer `no_gate`.
    const called = await declare(world, world.raider, gate);
    expect(called.status, called.body.slice(0, 200)).toBe(200);
  });

  it('tells the screen the district is shut, so the raid is never offered', async () => {
    const world = await makeWorld();
    const board = await world.app.inject({
      method: 'GET',
      url: '/api/battles',
      headers: auth(world.raider.token),
    });
    const row = board.json<BattlesResponse>().gates.find((one) => one.districtId === HOME);
    expect(row, 'the visited district has no gate row on the board').toBeDefined();
    expect(row?.shut).toBe(true);
    expect(row?.brokenUntil).toBeNull();
  });

  /** An empty plot has nobody behind it, so there is no door and nothing to raid. */
  it('has no gate at all when nobody lives there', async () => {
    const world = await makeWorld();
    // The victim moves out. `glasshouse-fields` is another plot; nothing lives on HOME now.
    world.db
      .prepare('UPDATE bases SET district_id = ? WHERE id = ?')
      .run('glasshouse-fields', world.victim.baseId);

    const atGate = await declare(world, world.raider, gate);
    expect(atGate.status).toBe(409);
    expect(atGate.body).toContain('There is no gate to break');
  });
});

describe('a home inside a breach', () => {
  const breakItOpen = (world: World, hours = 1): void => {
    world.app.repos.sieges.breakGate(HOME, new Date(Date.now() + hours * 3_600_000).toISOString());
  };

  it('takes one raid on the whole district', async () => {
    const world = await makeWorld();
    breakItOpen(world);
    const called = await declare(world, world.raider, raid);
    expect(called.status, called.body.slice(0, 200)).toBe(200);
    // One call, and the row on the board names the district rather than a roof.
    const pending = world.app.repos.sieges.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.target).toEqual(raid);
  });

  it('shuts again exactly a day after the gate came down', async () => {
    const world = await makeWorld();
    // Broken a minute before the window runs out: still open.
    breakItOpen(world, GATE_BREACH_HOURS - 1 / 60);
    expect((await declare(world, world.raider, raid)).status).toBe(200);

    // And a minute past it, on the same fixture, the door is back.
    const stale = await makeWorld();
    stale.app.repos.sieges.breakGate(HOME, new Date(Date.now() - 60_000).toISOString());
    const late = await declare(stale, stale.raider, raid);
    expect(late.status, late.body.slice(0, 200)).toBe(409);
    expect(late.body).toContain('The gate is standing');
  });

  it('has nothing to raid once the crew has moved out', async () => {
    const world = await makeWorld();
    breakItOpen(world);
    world.db
      .prepare('UPDATE bases SET district_id = ? WHERE id = ?')
      .run('glasshouse-fields', world.victim.baseId);
    const called = await declare(world, world.raider, raid);
    expect(called.status).toBe(409);
    expect(called.body).toContain('Nobody lives there');
  });
});

describe('your own home', () => {
  it('is not a target, at the gate or behind it', async () => {
    const world = await makeWorld();
    const own = { kind: 'gate' as const, districtId: world.victim.districtId };
    const ownRaid = { kind: 'district' as const, districtId: world.victim.districtId };

    const atGate = await declare(world, world.victim, own);
    expect(atGate.status, atGate.body.slice(0, 200)).toBe(409);
    expect(atGate.body).toContain('That is yours');

    world.app.repos.sieges.breakGate(HOME, new Date(Date.now() + 3_600_000).toISOString());
    const inside = await declare(world, world.victim, ownRaid);
    expect(inside.status, inside.body.slice(0, 200)).toBe(409);
    expect(inside.body).toContain('That is yours');

    // The positive control: the same two calls from the crew next door stand.
    world.app.repos.city.markScouted(world.raider.baseId, HOME, new Date().toISOString());
    expect((await declare(world, world.raider, ownRaid)).status).toBe(200);
  });
});
