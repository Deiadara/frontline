import {
  AUTOMATION_RUNGS,
  MISC_AREA_ID,
  RESEARCH_UNLED_PENALISED,
  type MissionsResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * The two routes behind the Right Hand's screen (§C2b), and the one lock that is not on the
 * screen at all: while any standing order is on, `POST /missions` is refused, whatever the client.
 *
 * The screen version of that lock is proved in the browser. This is the real one.
 */
const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

async function crew(): Promise<{ app: FastifyInstance; token: string; baseId: string }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'deputy', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  return { app, token, baseId: chosen.json<{ base: { id: string } }>().base.id };
}

function grant(app: FastifyInstance, baseId: string, rungs: readonly string[]): void {
  const base = app.repos.bases.findById(baseId);
  if (!base) throw new Error('no base');
  app.repos.bases.updateResearch(baseId, { ...base.research, technologies: [...rungs] });
}

const save = (app: FastifyInstance, token: string, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/automations', headers: auth(token), payload: body });

const ORDER = { slot: 0, enabled: true, order: 'missions', force: { razors: 1 }, officerId: null };

describe('reading and writing a standing order', () => {
  it('answers a crew without the rung with nothing open, and refuses a write', async () => {
    const { app, token } = await crew();
    const read = await app.inject({ method: 'GET', url: '/api/automations', headers: auth(token) });
    expect(read.statusCode).toBe(200);
    expect(read.json<{ powers: { unlocked: boolean; slots: number } }>().powers).toMatchObject({
      unlocked: false,
      slots: 0,
    });
    const refused = await save(app, token, ORDER);
    expect(refused.statusCode).toBe(403);
  });

  it('refuses a slot that names both a party and a size, and one that names neither', async () => {
    const { app, token, baseId } = await crew();
    grant(app, baseId, [AUTOMATION_RUNGS.open, AUTOMATION_RUNGS.bestFit]);
    expect((await save(app, token, { ...ORDER, unitSlots: 4 })).statusCode).toBe(400);
    expect((await save(app, token, { ...ORDER, force: {}, unitSlots: null })).statusCode).toBe(400);
  });

  it('refuses every rung the crew has not earned, by name', async () => {
    const { app, token, baseId } = await crew();
    grant(app, baseId, [AUTOMATION_RUNGS.open]);
    expect((await save(app, token, { ...ORDER, force: {}, unitSlots: 4 })).statusCode).toBe(403);
    expect((await save(app, token, { ...ORDER, optimiseFor: 'caps' })).statusCode).toBe(403);
    expect((await save(app, token, { ...ORDER, order: 'battles' })).statusCode).toBe(403);
    expect((await save(app, token, { ...ORDER, slot: 1 })).statusCode).toBe(403);
  });

  it('writes a slot the crew may hold, and reads it back', async () => {
    const { app, token, baseId } = await crew();
    grant(app, baseId, [AUTOMATION_RUNGS.open]);
    const written = await save(app, token, ORDER);
    expect(written.statusCode, written.body).toBe(200);
    const slots = written.json<{ slots: { slot: number; enabled: boolean; force: unknown }[] }>()
      .slots;
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ slot: 0, enabled: true, force: { razors: 1 } });
    expect(app.repos.automations.get(baseId, 0)?.enabled).toBe(true);
  });
});

/**
 * The lock, at the API.
 *
 * The maintainer's rule is that the whole board is the Right Hand's while any order is on. A lock
 * drawn on the screen and not held by the route is not a lock, so this posts a launch a player
 * could have posted and expects the refusal, then switches the order off and posts it again.
 */
/**
 * The Console's rest knob (maintainer, 2026-09-23).
 *
 * The gap between automated parties is the one clock admin mode leaves alone, so a bench that
 * wants to watch a second party leave needs a way past it that a player does not have. It is a
 * knob, admin-only like every other, and it touches `restingSince` and nothing else on the slot.
 */
describe('the rest knob', () => {
  it('clears the rest on every slot and leaves the slot otherwise as it was', async () => {
    const config = loadConfig({
      DATABASE_PATH: ':memory:',
      JWT_SECRET: 'test-secret',
      ADMIN: 'true',
    });
    const db = openDatabase(config.databasePath);
    runMigrations(db);
    const app = await buildApp({ config, db, logger: false });
    instances.push({ app, db });
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'rested', password: 'hunter2pass' },
    });
    const token = registered.json<{ token: string }>().token;
    const chosen = await chooseOverseer(app, token);
    const baseId = chosen.json<{ base: { id: string } }>().base.id;
    grant(app, baseId, [AUTOMATION_RUNGS.open]);
    expect((await save(app, token, ORDER)).statusCode).toBe(200);
    const held = app.repos.automations.get(baseId, 0);
    if (!held) throw new Error('no slot');
    // Resting, and still pointing at a party that has long since come home (no such mission
    // any more is the same case: nothing active to wait on).
    app.repos.automations.put({
      ...held,
      restingSince: new Date().toISOString(),
      missionId: 'landed-long-ago',
    });

    const knob = await app.inject({
      method: 'POST',
      url: '/api/admin/knobs',
      headers: auth(token),
      payload: { automationsRested: true },
    });
    expect(knob.statusCode, knob.body).toBe(200);
    const after = app.repos.automations.get(baseId, 0);
    expect(after?.restingSince).toBeNull();
    expect(after?.missionId).toBeNull();
    expect(after?.enabled).toBe(true);
    expect(after?.force).toEqual({ razors: 1 });
  });
});

describe("the board is the Right Hand's while an order is on", () => {
  it('refuses a manual launch while any slot is on, and allows it once all are off', async () => {
    const { app, token, baseId } = await crew();
    // Written Orders too: a fresh crew has no officer to lead, and this is about the lock.
    grant(app, baseId, [RESEARCH_UNLED_PENALISED, AUTOMATION_RUNGS.open]);

    const board = await app.inject({ method: 'GET', url: '/api/missions', headers: auth(token) });
    const misc = board.json<MissionsResponse>().areas.find((area) => area.id === MISC_AREA_ID);
    const offer = misc?.offers.find((one) => one.kind !== 'battle');
    if (!misc || !offer) throw new Error('fixture: the misc board offers no plain job');
    const launch = () =>
      app.inject({
        method: 'POST',
        url: '/api/missions',
        headers: auth(token),
        payload: { templateId: offer.templateId, areaId: misc.id, force: { razors: 1 } },
      });

    expect((await save(app, token, ORDER)).statusCode).toBe(200);
    const locked = await launch();
    expect(locked.statusCode).toBe(409);
    expect(locked.body).toMatch(/Right Hand has the board/);

    expect((await save(app, token, { ...ORDER, enabled: false })).statusCode).toBe(200);
    const open = await launch();
    expect(open.statusCode, open.body).toBe(200);
  });
});
