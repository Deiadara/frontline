import {
  createCommander,
  declarationWindow,
  type BattleTarget,
  type MissionsResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';

/**
 * One officer, one job.
 *
 * Three systems dispatch an officer and each used to check only its own table. `/battles/lead`
 * refused an officer already leading another unresolved battle, `/missions` checked injury and
 * nothing else, and `sendScout` checked that the *crew* had no run out rather than that the officer
 * was free. So a crew with one good officer could launch a six-hour mission with them at 15:00,
 * send them scouting at 15:05, and name them to lead the 21:00 fight at 15:10: at the mark
 * `leaderFor` finds them on the books and not injured and puts their sheet and their leading perks
 * into a battle they are nowhere near. One wage, three officers' worth of sheet.
 *
 * §D4 is checked here too, because `sendScout` was also the one door of the three that never asked
 * whether the officer was injured, and `scoutRunMinutes` reads their full sheet.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

interface Stack {
  app: FastifyInstance;
  token: string;
  baseId: string;
  officerId: string;
}

async function makeStack(): Promise<Stack> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'one_good_officer', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
  const baseId = chosen.json<{ base: { id: string } }>().base.id;

  const officer = createCommander('off-1', 'Halvard Nyx', 'field_commander');
  app.repos.bases.updateCommanders(baseId, [officer]);
  app.repos.bases.updateArmy(baseId, { razors: 40 }, []);
  return { app, token, baseId, officerId: officer.id };
}

/** Launches the first job on the board, with `officerId` at the head of it. */
async function launch(stack: Stack, officerId: string | undefined) {
  const board = await stack.app.inject({
    method: 'GET',
    url: '/api/missions',
    headers: auth(stack.token),
  });
  const area = board.json<MissionsResponse>().areas.find((entry) => entry.offers.length > 0);
  const offer = area?.offers[0];
  if (!area || !offer) throw new Error('fixture: the board has nothing on it');
  return stack.app.inject({
    method: 'POST',
    url: '/api/missions',
    headers: auth(stack.token),
    payload: {
      areaId: area.id,
      templateId: offer.templateId,
      force: { razors: 4 },
      ...(officerId === undefined ? {} : { officerId }),
    },
  });
}

async function scout(stack: Stack, districtId: string) {
  return stack.app.inject({
    method: 'POST',
    url: '/api/city/scout',
    headers: auth(stack.token),
    payload: { districtId, officerId: stack.officerId },
  });
}

describe('an officer who is already committed', () => {
  it('cannot be sent scouting while they are out on a job', async () => {
    const stack = await makeStack();
    const sent = await launch(stack, stack.officerId);
    expect(sent.statusCode, sent.body.slice(0, 300)).toBe(200);

    const scouting = await scout(stack, 'rustyard');
    expect(scouting.statusCode, scouting.body).toBe(400);
    expect(scouting.body).toContain('already out');
  });

  it('cannot be sent on a job while they are out scouting', async () => {
    const stack = await makeStack();
    const scouting = await scout(stack, 'rustyard');
    expect(scouting.statusCode, scouting.body.slice(0, 300)).toBe(200);

    const sent = await launch(stack, stack.officerId);
    expect(sent.statusCode, sent.body).toBe(409);
    expect(sent.body).toContain('already out scouting');
  });

  it('cannot be named to lead a fight while they are out on a job', async () => {
    const stack = await makeStack();
    stack.app.repos.city.markScouted(stack.baseId, 'rustyard', new Date().toISOString());
    const target: BattleTarget = {
      kind: 'location',
      districtId: 'rustyard',
      locationId: 'rustyard-press',
    };
    const declared = await stack.app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(stack.token),
      payload: { target, scheduledFor: declarationWindow(new Date()).earliest.toISOString() },
    });
    expect(declared.statusCode, declared.body.slice(0, 300)).toBe(200);
    const battleId = stack.app.repos.sieges.pending()[0]?.id;
    if (!battleId) throw new Error('fixture: no battle');

    const sent = await launch(stack, stack.officerId);
    expect(sent.statusCode, sent.body.slice(0, 300)).toBe(200);

    const led = await stack.app.inject({
      method: 'POST',
      url: '/api/battles/lead',
      headers: auth(stack.token),
      payload: { battleId, officerId: stack.officerId },
    });
    expect(led.statusCode, led.body).toBe(403);
    expect(led.body).toContain('already out on a job');
  });

  it('cannot be sent scouting while they are laid up (§D4)', async () => {
    const stack = await makeStack();
    const base = stack.app.repos.bases.findById(stack.baseId);
    if (!base) throw new Error('no base');
    stack.app.repos.bases.updateCommanders(
      stack.baseId,
      base.commanders.map((officer) => ({
        ...officer,
        injuredUntil: new Date(Date.now() + 3_600_000).toISOString(),
      })),
    );

    const scouting = await scout(stack, 'rustyard');
    expect(scouting.statusCode, scouting.body).toBe(400);
    expect(scouting.body).toContain('laid up');
  });

  it('is free to be sent when nothing else holds them, which is the ordinary case', async () => {
    const stack = await makeStack();
    const scouting = await scout(stack, 'rustyard');
    expect(scouting.statusCode, scouting.body.slice(0, 300)).toBe(200);
  });
});
