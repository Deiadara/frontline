import {
  DECLARE_INFAMY_COST,
  LEADER_HOLD_MESSAGES,
  MISSION_TEMPLATES,
  createCommander,
  declarationWindow,
  type ApiError,
  type BattlesResponse,
  type BattleTarget,
  type FightLeaderQuoteResponse,
  type MissionLeader,
  type MissionsResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { openDoors } from '../testing/doors.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * One officer, one job.
 *
 * The systems that dispatch an officer each used to check only their own table. `/battles/lead`
 * refused an officer already leading another unresolved battle and `/missions` checked injury and
 * nothing else. So a crew with one good officer could launch a six-hour mission with them at 15:00
 * and name them to lead the 21:00 fight at 15:10: at the mark `leaderFor` finds them on the books
 * and not injured and puts their sheet and their leading perks into a battle they are nowhere near.
 * One wage, two officers' worth of sheet. §D4, the injury, is checked here too.
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
      boardKey: offer.boardKey,
      grade: offer.grade,
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

describe('an officer who is already committed', () => {
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

  it('is free to be sent when nothing else holds them, which is the ordinary case', async () => {
    const stack = await makeStack();
    // Nothing on them yet, which is what the board says and what the door then allows.
    const free = await heldOn(stack);
    expect(free.held).toBeNull();
    expect(free.heldUntil).toBeNull();

    // The launch is the door that reads the hold.
    const sent = await launch(stack, stack.officerId);
    expect(sent.statusCode, sent.body.slice(0, 300)).toBe(200);
  });
});

/**
 * The other direction, and the reason on the wire (maintainer, 2026-09-10).
 *
 * The launch used to refuse an officer who was at a fight or laid up with the same
 * shrug, and the board said only whether somebody was out on a *run*: an officer standing by for
 * tonight's siege looked free on the missions screen right up to the 409. One reason per leader
 * now, with the mark they are free at where the server knows one, and the launch says the same
 * sentence the other two doors do.
 */
/** What the training floor says to a drill for the stack's officer: its refusal, or null. */
async function drillRefusal(stack: Stack): Promise<string | null> {
  openDoors(stack.app, stack.token, 'training');
  const drilled = await stack.app.inject({
    method: 'POST',
    url: '/api/training',
    headers: auth(stack.token),
    payload: { subjectId: stack.officerId, attribute: 'strength' },
  });
  return drilled.statusCode === 200 ? null : drilled.json<ApiError>().error.message;
}

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
    // ...and nobody held for a fight drills (maintainer, 2026-10-06).
    expect(await drillRefusal(stack)).toBe('Held for a fight');
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
    // ...and a sickbed shuts the training floor too (maintainer, 2026-10-06).
    expect(await drillRefusal(stack)).toBe('Laid up');
  });
});

/**
 * The bench (maintainer, 2026-09-28): "unusable completely until they're placed in a seat".
 *
 * Every door that sends somebody asks `officerDuty`, so the bench is a hold like a bed: the board
 * dims them with a reason, the launch and the fight refuse them in the same words, and the fight
 * screen's picker leaves them off. What the bench does not stop is a drill, which is spent on a
 * person rather than asked of one, or letting them go.
 */
describe('an officer on the bench', () => {
  const BENCHED = `Halvard Nyx ${LEADER_HOLD_MESSAGES.bench}`;

  function bench(stack: Stack): void {
    const base = stack.app.repos.bases.findById(stack.baseId)!;
    stack.app.repos.bases.updateCommanders(
      stack.baseId,
      base.commanders.map((officer) => ({ ...officer, role: null })),
    );
  }

  it('is held on the board, with no clock, and the launch refuses them', async () => {
    const stack = await makeStack();
    bench(stack);

    const row = await heldOn(stack);
    expect(row.held).toBe('bench');
    expect(row.heldUntil, 'the bench ends when they are seated, not at a time').toBeNull();

    const sent = await launch(stack, stack.officerId);
    expect(sent.statusCode, sent.body.slice(0, 300)).toBe(409);
    expect(sent.json<ApiError>().error.message).toBe(BENCHED);
  });

  it('cannot be named to lead a declared fight, and is not offered for one', async () => {
    const stack = await makeStack();
    const battleId = await declareFight(stack);
    bench(stack);

    const screen = await stack.app.inject({
      method: 'GET',
      url: '/api/battles',
      headers: auth(stack.token),
    });
    // Seated, the same officer is on this list: see "is left off the fight screen's picker".
    expect(screen.json<BattlesResponse>().coming[0]!.leaders).toEqual([]);

    const led = await stack.app.inject({
      method: 'POST',
      url: '/api/battles/lead',
      headers: auth(stack.token),
      payload: { battleId, officerId: stack.officerId },
    });
    expect(led.statusCode, led.body).toBe(403);
    expect(led.json<ApiError>().error.message).toBe(BENCHED);
  });

  it('is left out of the fight-leader quote, which still rates them seated', async () => {
    const stack = await makeStack();
    const fight = MISSION_TEMPLATES.find((template) => template.kind === 'battle');
    if (!fight) throw new Error('fixture: no fight on the books');
    const quote = async () => {
      const response = await stack.app.inject({
        method: 'POST',
        url: '/api/missions/leaders/quote',
        headers: auth(stack.token),
        payload: { templateId: fight.id, grade: 'C', force: { razors: 4 } },
      });
      expect(response.statusCode, response.body.slice(0, 300)).toBe(200);
      return response.json<FightLeaderQuoteResponse>().leaders.map((one) => one.id);
    };

    expect(await quote()).toContain(stack.officerId);
    bench(stack);
    expect(await quote()).not.toContain(stack.officerId);
  });

  /*
   * The bench is asked last. The crew screen will not unseat somebody out on a run (below), but a
   * row written before that rule can hold a benched leader mid-run, and the release door refuses
   * on the run: answered `bench` first, a crew could let the leader of a run go mid-run.
   */
  it('still reads as out on the run when benched mid-run, and cannot be let go', async () => {
    const stack = await makeStack();
    const sent = await launch(stack, stack.officerId);
    expect(sent.statusCode, sent.body.slice(0, 300)).toBe(200);
    bench(stack);

    expect((await heldOn(stack)).held).toBe('run');
    const released = await stack.app.inject({
      method: 'POST',
      url: '/api/bar/release',
      headers: auth(stack.token),
      payload: { officerId: stack.officerId },
    });
    expect(released.statusCode, released.body.slice(0, 300)).toBe(409);
  });

  it('can still be drilled, and still be let go', async () => {
    const stack = await makeStack();
    bench(stack);
    openDoors(stack.app, stack.token, 'training');

    const drilled = await stack.app.inject({
      method: 'POST',
      url: '/api/training',
      headers: auth(stack.token),
      payload: { subjectId: stack.officerId, attribute: 'strength' },
    });
    expect(drilled.statusCode, drilled.body.slice(0, 300)).toBe(200);

    const released = await stack.app.inject({
      method: 'POST',
      url: '/api/bar/release',
      headers: auth(stack.token),
      payload: { officerId: stack.officerId },
    });
    expect(released.statusCode, released.body.slice(0, 300)).toBe(200);
  });
});

/**
 * Every run keeps its leader (maintainer, 2026-09-28), so the crew screen will not move somebody
 * out on a run or named to lead a fight: the bench leads nothing, and a chair swap would change
 * the rungs the settle spends. Refused in the hold's own words.
 */
describe('changing the seat of an officer who is out', () => {
  const reassign = (stack: Stack, role: string | null) =>
    stack.app.inject({
      method: 'POST',
      url: '/api/crew/reassign',
      headers: auth(stack.token),
      payload: { officerId: stack.officerId, role },
    });
  const WAIT = 'Seat changes wait until they are back';

  it('moves an idle officer to the bench and back, which is the ordinary case', async () => {
    const stack = await makeStack();
    openDoors(stack.app, stack.token, 'crew');

    expect((await reassign(stack, null)).statusCode).toBe(200);
    expect(stack.app.repos.bases.findById(stack.baseId)!.commanders[0]!.role).toBeNull();
    expect((await reassign(stack, 'field_commander')).statusCode).toBe(200);
  });

  it('refuses while they are out leading a run, to the bench or to another chair', async () => {
    const stack = await makeStack();
    openDoors(stack.app, stack.token, 'crew');
    const sent = await launch(stack, stack.officerId);
    expect(sent.statusCode, sent.body.slice(0, 300)).toBe(200);

    for (const role of [null, 'raid_boss']) {
      const moved = await reassign(stack, role);
      expect(moved.statusCode, moved.body.slice(0, 300)).toBe(409);
      expect(moved.json<ApiError>().error.message).toBe(
        `Halvard Nyx ${LEADER_HOLD_MESSAGES.run}. ${WAIT}`,
      );
    }
    expect(stack.app.repos.bases.findById(stack.baseId)!.commanders[0]!.role).toBe(
      'field_commander',
    );
  });

  it('refuses while they are named to lead a fight still to come', async () => {
    const stack = await makeStack();
    openDoors(stack.app, stack.token, 'crew');
    const battleId = await declareFight(stack);
    const led = await stack.app.inject({
      method: 'POST',
      url: '/api/battles/lead',
      headers: auth(stack.token),
      payload: { battleId, officerId: stack.officerId },
    });
    expect(led.statusCode, led.body.slice(0, 300)).toBe(200);

    const moved = await reassign(stack, null);
    expect(moved.statusCode, moved.body.slice(0, 300)).toBe(409);
    expect(moved.json<ApiError>().error.message).toBe(
      `Halvard Nyx ${LEADER_HOLD_MESSAGES.fight}. ${WAIT}`,
    );
  });
});
