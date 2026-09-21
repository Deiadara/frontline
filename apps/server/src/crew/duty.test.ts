import {
  DECLARE_INFAMY_COST,
  createCommander,
  declarationWindow,
  type ApiError,
  type BattlesResponse,
  type BattleTarget,
  type MissionLeader,
  type MissionsResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';

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
  const chosen = await chooseOverseer(app, token);
  const baseId = chosen.json<{ base: { id: string } }>().base.id;

  // §D7: calling a fight costs infamy and nobody starts with any. Fixture money, enough for every
  // call this file makes.
  const purse = app.repos.bases.findById(baseId)!.economy;
  app.repos.bases.updateEconomy(baseId, { ...purse, infamy: DECLARE_INFAMY_COST * 8 });

  const officer = createCommander('off-1', 'Halvard Nyx', 'field_commander');
  app.repos.bases.updateCommanders(baseId, [officer]);
  app.repos.bases.updateArmy(baseId, { razors: 40 }, []);
  return { app, token, baseId, officerId: officer.id };
}

/** Launches the first job on the board, with `leaderId` at the head of it. */
async function launch(stack: Stack, leaderId: string | undefined) {
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
      ...(leaderId === undefined ? {} : { leaderId }),
    },
  });
}

/** The officer's row on the mission board: what is holding them, and until when. */
async function heldOn(stack: Stack): Promise<MissionLeader> {
  const board = await stack.app.inject({
    method: 'GET',
    url: '/api/missions',
    headers: auth(stack.token),
  });
  expect(board.statusCode, board.body.slice(0, 200)).toBe(200);
  const row = board.json<MissionsResponse>().leaders.find((one) => one.id === stack.officerId);
  if (!row) throw new Error('fixture: the officer is not on the bench');
  return row;
}

/** Declares a fight this crew could name somebody on, and answers with its id. */
async function declareFight(stack: Stack): Promise<string> {
  /*
   * Chrome Row, because the 2026-09-19 re-cut handed the Steelbelt to the Combine and a district
   * the regime holds end to end is shut: the only thing a crew may declare on is its gate, and
   * this helper wants an ordinary location fight to name an officer on. Chrome Row is the one
   * contested district left with a seam, and the Exchange is in its squatted half.
   */
  stack.app.repos.city.markScouted(stack.baseId, 'chrome-row', new Date().toISOString());
  const target: BattleTarget = {
    kind: 'location',
    districtId: 'chrome-row',
    locationId: 'chrome-row-exchange',
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
  return battleId;
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
    // The scouting party names the officer and the hold, rather than the old flat "they are
    // already out": three different jobs used to read the same and a player could not tell which
    // one to go and undo.
    expect(scouting.json<ApiError>().error.message).toBe('Halvard Nyx is out leading a run');
  });

  it('cannot be sent on a job while they are out scouting', async () => {
    const stack = await makeStack();
    const scouting = await scout(stack, 'rustyard');
    expect(scouting.statusCode, scouting.body.slice(0, 300)).toBe(200);

    const sent = await launch(stack, stack.officerId);
    expect(sent.statusCode, sent.body).toBe(409);
    expect(sent.json<ApiError>().error.message).toBe('Halvard Nyx is out scouting');
  });

  it('cannot be named to lead a fight while they are out on a job', async () => {
    const stack = await makeStack();
    const battleId = await declareFight(stack);

    const sent = await launch(stack, stack.officerId);
    expect(sent.statusCode, sent.body.slice(0, 300)).toBe(200);

    const led = await stack.app.inject({
      method: 'POST',
      url: '/api/battles/lead',
      headers: auth(stack.token),
      payload: { battleId, officerId: stack.officerId },
    });
    expect(led.statusCode, led.body).toBe(403);
    // The same sentence the launch refuses a fight's leader with, in the other direction.
    expect(led.json<ApiError>().error.message).toBe('Halvard Nyx is out leading a run');
  });

  it('is left off the fight screen’s picker while they are out on a job', async () => {
    const stack = await makeStack();
    await declareFight(stack);

    const before = await stack.app.inject({
      method: 'GET',
      url: '/api/battles',
      headers: auth(stack.token),
    });
    expect(
      before.json<BattlesResponse>().coming[0]!.leaders.map((leader) => leader.officerId),
    ).toEqual([stack.officerId]);

    const sent = await launch(stack, stack.officerId);
    expect(sent.statusCode, sent.body.slice(0, 300)).toBe(200);

    // The picker asks the same question `/battles/lead` does, so it never offers a name the route
    // is going to turn away.
    const after = await stack.app.inject({
      method: 'GET',
      url: '/api/battles',
      headers: auth(stack.token),
    });
    expect(after.json<BattlesResponse>().coming[0]!.leaders).toEqual([]);
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
    expect(scouting.json<ApiError>().error.message).toBe('Halvard Nyx is still laid up');
  });

  it('is free to be sent when nothing else holds them, which is the ordinary case', async () => {
    const stack = await makeStack();
    // Nothing on them yet, which is what the board says and what the door then allows.
    const free = await heldOn(stack);
    expect(free.held).toBeNull();
    expect(free.heldUntil).toBeNull();

    const scouting = await scout(stack, 'rustyard');
    expect(scouting.statusCode, scouting.body.slice(0, 300)).toBe(200);
  });
});

/**
 * The other direction, and the reason on the wire (maintainer, 2026-09-10).
 *
 * The launch used to refuse an officer who was at a fight, out scouting or laid up with the same
 * shrug, and the board said only whether somebody was out on a *run*: an officer standing by for
 * tonight's siege looked free on the missions screen right up to the 409. One reason per leader
 * now, with the mark they are free at where the server knows one, and the launch says the same
 * sentence the other two doors do.
 */
describe('what holds a leader, on the wire and at the launch', () => {
  it('a declared fight, which has no clock on it until it settles', async () => {
    const stack = await makeStack();
    const battleId = await declareFight(stack);
    const led = await stack.app.inject({
      method: 'POST',
      url: '/api/battles/lead',
      headers: auth(stack.token),
      payload: { battleId, officerId: stack.officerId },
    });
    expect(led.statusCode, led.body.slice(0, 300)).toBe(200);

    const row = await heldOn(stack);
    expect(row.held).toBe('fight');
    expect(row.heldUntil, 'nobody knows when a declared fight lets them go').toBeNull();

    const sent = await launch(stack, stack.officerId);
    expect(sent.statusCode, sent.body.slice(0, 300)).toBe(409);
    expect(sent.json<ApiError>().error.message).toBe('Halvard Nyx is at a fight');
  });

  it('a scouting run, until they are back through the gate', async () => {
    const stack = await makeStack();
    const scouting = await scout(stack, 'rustyard');
    expect(scouting.statusCode, scouting.body.slice(0, 300)).toBe(200);

    const row = await heldOn(stack);
    expect(row.held).toBe('scouting');
    expect(row.heldUntil).toBe(stack.app.repos.scouting.activeFor(stack.baseId)[0]?.returnsAt);

    const sent = await launch(stack, stack.officerId);
    expect(sent.statusCode, sent.body.slice(0, 300)).toBe(409);
    expect(sent.json<ApiError>().error.message).toBe('Halvard Nyx is out scouting');
  });

  it('a bed, until they are well again (\u00a7D4)', async () => {
    const stack = await makeStack();
    const wellAt = new Date(Date.now() + 3_600_000).toISOString();
    const base = stack.app.repos.bases.findById(stack.baseId);
    if (!base) throw new Error('no base');
    stack.app.repos.bases.updateCommanders(
      stack.baseId,
      base.commanders.map((officer) => ({ ...officer, injuredUntil: wellAt })),
    );

    const row = await heldOn(stack);
    expect(row.held).toBe('injury');
    expect(row.heldUntil).toBe(wellAt);

    const sent = await launch(stack, stack.officerId);
    expect(sent.statusCode, sent.body.slice(0, 300)).toBe(409);
    expect(sent.json<ApiError>().error.message).toBe('Halvard Nyx is still laid up');
  });
});
