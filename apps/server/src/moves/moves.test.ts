import {
  DEFAULT_BADGE,
  MOVE_GATE_MINUTES,
  type ActionsResponse,
  type MoveQuoteResponse,
  type MoveUnitsRequest,
  type UnitsResponse,
  unitSlotsUsed,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { tickWorld } from '../live/clock.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';
import { groundBehind } from '../spying/spying.js';
import { settleMoves } from './moves.js';

/**
 * Moving units between the crew's places (maintainer ruling, 2026-09-22): the clock, the
 * landing rules, the claim, the posting on an ally's ground, and the recall.
 */

interface Stack {
  app: FastifyInstance;
  db: AppDatabase;
  token: string;
  baseId: string;
  userId: string;
}

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function register(app: FastifyInstance, db: AppDatabase, username: string): Promise<Stack> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  expect(chosen.statusCode, chosen.body.slice(0, 200)).toBe(201);
  pinOverseer(app, token);
  const baseId = chosen.json<{ base: { id: string } }>().base.id;
  const userId = app.repos.bases.findById(baseId)!.ownerId;
  return { app, db, token, baseId, userId };
}

async function makeWorld(): Promise<{ me: Stack; ally: Stack }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const me = await register(app, db, 'mover');
  const ally = await register(app, db, 'friend');
  return { me, ally };
}

function arm(stack: Stack, army: Record<string, number>): void {
  const base = stack.app.repos.bases.findById(stack.baseId)!;
  stack.app.repos.bases.updateArmy(base.id, army, base.trainingQueue);
}

const move = (stack: Stack, body: MoveUnitsRequest) =>
  stack.app.inject({
    method: 'POST',
    url: '/api/actions/move',
    headers: auth(stack.token),
    payload: body,
  });

const base = (stack: Stack) => stack.app.repos.bases.findById(stack.baseId)!;

function windBack(stack: Stack): void {
  stack.db
    .prepare('UPDATE unit_moves SET returns_at = ?')
    .run(new Date(Date.now() - 60_000).toISOString());
}

describe('district and gate', () => {
  it('walks a column to the gate in ten minutes at base, and it stands there once landed', async () => {
    const { me } = await makeWorld();
    arm(me, { razors: 10 });
    const quote = await me.app.inject({
      method: 'POST',
      url: '/api/actions/move/quote',
      headers: auth(me.token),
      payload: {
        from: { kind: 'district' },
        to: { kind: 'gate' },
        army: { razors: 4 },
        vehicles: {},
      },
    });
    expect(quote.statusCode, quote.body.slice(0, 200)).toBe(200);
    // Ten minutes at base, cut by the column's speed: never more, never nothing.
    const minutes = quote.json<MoveQuoteResponse>().minutes;
    expect(minutes).toBeGreaterThan(0);
    expect(minutes).toBeLessThanOrEqual(MOVE_GATE_MINUTES);

    const res = await move(me, {
      from: { kind: 'district' },
      to: { kind: 'gate' },
      army: { razors: 4 },
      vehicles: {},
    });
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    const road = res.json<ActionsResponse>();
    expect(road.moves).toHaveLength(1);
    expect(road.moves[0]!.toName).toBe('Your Gate');
    expect(base(me).army).toEqual({ razors: 6 });

    windBack(me);
    tickWorld(me.app.repos, me.app.skirmishEngine, new Date());
    expect(base(me).gateArmy).toEqual({ razors: 4 });
    expect(base(me).army).toEqual({ razors: 6 });

    // The roster says so, and the door is what a spy reads behind a player's gate.
    const roster = (
      await me.app.inject({ method: 'GET', url: '/api/units', headers: auth(me.token) })
    ).json<UnitsResponse>();
    expect(roster.gateArmy).toEqual({ razors: 4 });
    expect(roster.moveDestinations.map((d) => d.label)).toEqual(['Your District', 'Your Gate']);
  });

  it('refuses what is not standing at the source, and vehicles from anywhere but home', async () => {
    const { me } = await makeWorld();
    arm(me, { razors: 2 });
    const short = await move(me, {
      from: { kind: 'district' },
      to: { kind: 'gate' },
      army: { razors: 5 },
      vehicles: {},
    });
    expect(short.statusCode).toBe(409);
    const same = await move(me, {
      from: { kind: 'gate' },
      to: { kind: 'gate' },
      army: { razors: 1 },
      vehicles: {},
    });
    expect(same.statusCode).toBe(400);
    const fromGate = await move(me, {
      from: { kind: 'gate' },
      to: { kind: 'district' },
      army: { razors: 1 },
      vehicles: { motorcycle: 1 },
    });
    expect(fromGate.statusCode).toBe(409);
  });

  it('turns a column round inside the first tenth, back to where it came from', async () => {
    const { me } = await makeWorld();
    arm(me, { razors: 10 });
    const sent = (
      await move(me, {
        from: { kind: 'district' },
        to: { kind: 'gate' },
        army: { razors: 3 },
        vehicles: {},
      })
    ).json<ActionsResponse>();
    const moveId = sent.moves[0]!.id;
    const recalled = await me.app.inject({
      method: 'POST',
      url: '/api/actions/move/recall',
      headers: auth(me.token),
      payload: { moveId },
    });
    expect(recalled.statusCode, recalled.body.slice(0, 200)).toBe(200);
    expect(recalled.json<ActionsResponse>().moves[0]!.recalledAt).not.toBeNull();
    windBack(me);
    settleMoves(me.app.repos, new Date());
    expect(base(me).army).toEqual({ razors: 10 });
    expect(base(me).gateArmy ?? {}).toEqual({});
  });

  it('sends the machines home on their own after the drop, and the yard waits for them', async () => {
    const { me } = await makeWorld();
    arm(me, { razors: 10 });
    const mine = base(me);
    me.app.repos.bases.updateFleet(mine.id, { motorcycle: 2 });

    const sent = await move(me, {
      from: { kind: 'district' },
      to: { kind: 'gate' },
      army: { razors: 4 },
      vehicles: { motorcycle: 2 },
    });
    expect(sent.statusCode, sent.body.slice(0, 200)).toBe(200);
    expect(base(me).fleet.motorcycle ?? 0, 'the yard still had them while they were out').toBe(0);

    windBack(me);
    settleMoves(me.app.repos, new Date());
    // The people are at the door, and the machines are on the road back rather than teleported.
    expect(base(me).gateArmy).toEqual({ razors: 4 });
    expect(base(me).fleet.motorcycle ?? 0).toBe(0);
    const home = me.app.repos.moves.activeFor(me.baseId);
    expect(home).toHaveLength(1);
    expect(home[0]!.army).toEqual({});
    expect(home[0]!.vehicles).toEqual({ motorcycle: 2 });
    expect(home[0]!.to).toEqual({ kind: 'district' });
    // ...and nobody can turn an empty column round.
    const late = await me.app.inject({
      method: 'POST',
      url: '/api/actions/move/recall',
      headers: auth(me.token),
      payload: { moveId: home[0]!.id },
    });
    expect(late.statusCode).toBe(409);

    windBack(me);
    settleMoves(me.app.repos, new Date());
    expect(base(me).fleet.motorcycle).toBe(2);
    expect(me.app.repos.moves.activeFor(me.baseId)).toHaveLength(0);
    // The drop is untouched by the machines coming home.
    expect(base(me).gateArmy).toEqual({ razors: 4 });
  });
});

describe('ground', () => {
  it('claims empty ground on arrival, with no fight', async () => {
    const { me } = await makeWorld();
    arm(me, { razors: 10 });
    const press = me.app.repos.city.control('rustyard-press')!;
    me.app.repos.city.put({ ...press, holder: { kind: 'unoccupied' }, garrison: {} });
    me.app.repos.city.markScouted(me.baseId, 'rustyard', new Date().toISOString());

    const res = await move(me, {
      from: { kind: 'district' },
      to: { kind: 'location', locationId: 'rustyard-press' },
      army: { razors: 4 },
      vehicles: {},
    });
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    windBack(me);
    settleMoves(me.app.repos, new Date());
    const taken = me.app.repos.city.control('rustyard-press')!;
    expect(taken.holder).toEqual({ kind: 'crew', baseId: me.baseId });
    expect(taken.garrison).toEqual({ razors: 4 });
    expect(me.app.repos.feats.tallies(me.baseId).locations_captured).toBe(1);
  });

  it('refuses ground somebody else holds, and ground nobody of yours has seen', async () => {
    const { me } = await makeWorld();
    arm(me, { razors: 10 });
    const dark = await move(me, {
      from: { kind: 'district' },
      to: { kind: 'location', locationId: 'rustyard-press' },
      army: { razors: 4 },
      vehicles: {},
    });
    expect(dark.statusCode).toBe(400);
    me.app.repos.city.markScouted(me.baseId, 'rustyard', new Date().toISOString());
    // The Press is the looters' in the seeded city.
    const theirs = await move(me, {
      from: { kind: 'district' },
      to: { kind: 'location', locationId: 'rustyard-press' },
      army: { razors: 4 },
      vehicles: {},
    });
    expect(theirs.statusCode).toBe(400);
    expect(theirs.json<{ error: { message: string } }>().error.message).toMatch(/Call a fight/);
  });

  it("posts units on a faction ally's ground: theirs, standing for the holder", async () => {
    const { me, ally } = await makeWorld();
    arm(me, { razors: 10 });
    const press = me.app.repos.city.control('rustyard-press')!;
    me.app.repos.city.put({
      ...press,
      holder: { kind: 'crew', baseId: ally.baseId },
      garrison: { razors: 3 },
    });
    me.app.repos.city.markScouted(me.baseId, 'rustyard', new Date().toISOString());

    // Strangers first: their ground is not a place to walk onto.
    const stranger = await move(me, {
      from: { kind: 'district' },
      to: { kind: 'location', locationId: 'rustyard-press' },
      army: { razors: 4 },
      vehicles: {},
    });
    expect(stranger.statusCode).toBe(400);

    me.app.repos.factions.insert({
      id: 'f1',
      name: 'The Compact',
      badge: DEFAULT_BADGE,
      blurb: '',
      foundedAt: new Date().toISOString(),
    });
    me.app.repos.factions.addMember({
      userId: ally.userId,
      factionId: 'f1',
      rank: 'leader',
      joinedAt: new Date().toISOString(),
    });
    me.app.repos.factions.addMember({
      userId: me.userId,
      factionId: 'f1',
      rank: 'member',
      joinedAt: new Date().toISOString(),
    });

    const roster = (
      await me.app.inject({ method: 'GET', url: '/api/units', headers: auth(me.token) })
    ).json<UnitsResponse>();
    expect(roster.moveDestinations.some((d) => d.group === 'faction')).toBe(true);

    const res = await move(me, {
      from: { kind: 'district' },
      to: { kind: 'location', locationId: 'rustyard-press' },
      army: { razors: 4 },
      vehicles: {},
    });
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    windBack(me);
    settleMoves(me.app.repos, new Date());

    // The ground is still the ally's, the garrison still theirs, and the posting is ours.
    const held = me.app.repos.city.control('rustyard-press')!;
    expect(held.holder).toEqual({ kind: 'crew', baseId: ally.baseId });
    expect(held.garrison).toEqual({ razors: 3 });
    expect(me.app.repos.alliedGarrisons.get('rustyard-press', me.baseId)).toEqual({ razors: 4 });
    const mine = (
      await me.app.inject({ method: 'GET', url: '/api/units', headers: auth(me.token) })
    ).json<UnitsResponse>();
    expect(mine.garrisoned).toEqual({ razors: 4 });
    expect(mine.standingAt['rustyard-press']).toEqual({ razors: 4 });
    /*
     * ...and reported in exactly one place.
     *
     * The slot draw counts a posting through `unitsAbroad`, because it has to count it once
     * wherever it is; the census reads `garrisoned` and `abroad` as two different places and
     * adds them up. Left in both, every posted unit was drawn twice on the one screen whose
     * whole job is counting.
     */
    expect(mine.abroad.razors ?? 0, 'the posting was counted twice').toBe(0);
    expect(mine.unitSlotsUsed).toBe(unitSlotsUsed({ ...base(me).army, razors: 10 }));

    // A spy on the place counts both, because both stand in the line: the ground is theirs, so
    // it can be read, and what is read is the garrison and the posting together.
    const reader = me.app.repos.bases.findById(me.baseId)!;
    const looked = groundBehind(me.app.repos, reader, {
      kind: 'location',
      locationId: 'rustyard-press',
    });
    expect(looked.kind).toBe('ground');
    if (looked.kind === 'ground') expect(looked.ground.army).toEqual({ razors: 7 });
  });
});
