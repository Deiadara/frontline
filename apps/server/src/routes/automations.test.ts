import {
  bestLeader,
  composeProfile,
  createCommander,
  findMissionTemplate,
  leaningsFor,
  makeAttributes,
  OFFICER_ROLES,
  concurrentMissionSlots,
  notorietyToField,
  AUTOMATION_RUNGS,
  MISC_AREA_ID,
  NO_RIGHT_HAND_TEXT,
  type MissionsResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';
import { holdEveryBoard } from '../testing/footholds.js';
import { settleAutomations } from '../automations/runners.js';
import { liftedOfficerSheet, officerLiftRoom } from '../crew/standing.js';

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

/**
 * Somebody on the books to lead, because a slot with nobody free stalls before it reaches any of
 * the doors the tests below are about ("No officer is free to lead").
 *
 * The first is always the Right Hand: the orders are that chair's work, and with it empty the
 * route refuses to switch one on and the runner stalls every slot (2026-09-29).
 */
const SEATS = ['right_hand', ...OFFICER_ROLES.filter((role) => role !== 'right_hand')] as const;

function withOfficers(app: FastifyInstance, baseId: string, count = 2): void {
  const base = app.repos.bases.findById(baseId);
  if (!base) throw new Error('no base');
  app.repos.bases.updateCommanders(
    baseId,
    Array.from({ length: count }, (_, index) =>
      // One chair each: the bench leads nothing (maintainer, 2026-09-28).
      createCommander(`auto-off-${index + 1}`, `Officer ${index + 1}`, SEATS[index]!),
    ),
  );
}

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

  /**
   * A party is units, and `POST /missions` has always said so: its `force` is keyed on the unit
   * catalogue, so a key that names no sheet is a 400 from the schema. This door took
   * `z.record(z.string(), ...)` and therefore took anything, including the names on
   * `Object.prototype`.
   *
   * That is not a cosmetic difference. `forceFor` asks `base.army[unitId] < count`, and
   * `army.constructor` on a parsed object is a *function*, so the comparison is `NaN < 1`, which
   * is false: the party was judged to be at home. A crew with an empty roster launched a real
   * job, succeeded at 85%, and banked the XP and every mission tally behind it, once every
   * cooldown, for ever. The same shape was closed on the deployment door in 2026-09-23
   * (`battle/deploy.ts`, "a handler that reads a key off an object should be the one deciding
   * which keys it will read"); this one was still open.
   */
  it('refuses a party naming something that is not a unit', async () => {
    const { app, token, baseId } = await crew();
    grant(app, baseId, [AUTOMATION_RUNGS.open]);
    for (const key of ['constructor', 'toString', 'valueOf', 'not_a_unit']) {
      const refused = await save(app, token, { ...ORDER, force: { [key]: 1 } });
      expect(refused.statusCode, `${key}: ${refused.body}`).toBe(400);
    }
    expect(app.repos.automations.get(baseId, 0)).toBeUndefined();
  });

  /** Found by the playthrough: the slot stored another crew's officer and stalled on it. */
  it('refuses a slot naming an officer who is not on this crew’s books', async () => {
    const { app, token, baseId } = await crew();
    grant(app, baseId, [AUTOMATION_RUNGS.open]);
    withOfficers(app, baseId);
    const refused = await save(app, token, { ...ORDER, officerId: 'somebody-elses-officer' });
    expect(refused.statusCode, refused.body).toBe(404);
    expect(app.repos.automations.get(baseId, 0)).toBeUndefined();
    const taken = await save(app, token, { ...ORDER, officerId: 'auto-off-1' });
    expect(taken.statusCode, taken.body).toBe(200);
  });

  /**
   * Bug pass, 2026-10-06: an order naming an officer since let go at the Bar could not be switched
   * off, which kept the mission board locked to the Right Hand.
   */
  it('lets an order naming an officer no longer on the books be switched off', async () => {
    const { app, token, baseId } = await crew();
    grant(app, baseId, [AUTOMATION_RUNGS.open]);
    withOfficers(app, baseId);
    expect((await save(app, token, { ...ORDER, officerId: 'auto-off-2' })).statusCode).toBe(200);
    // Released: gone from the books, still named on the slot.
    const base = app.repos.bases.findById(baseId)!;
    app.repos.bases.updateCommanders(
      baseId,
      base.commanders.filter((officer) => officer.id !== 'auto-off-2'),
    );
    const off = await save(app, token, { ...ORDER, enabled: false, officerId: 'auto-off-2' });
    expect(off.statusCode, off.body).toBe(200);
    expect(app.repos.automations.get(baseId, 0)?.enabled).toBe(false);
    // Switching it back on still needs somebody real.
    const on = await save(app, token, { ...ORDER, officerId: 'auto-off-2' });
    expect(on.statusCode, on.body).toBe(404);
  });

  /**
   * Bug pass, 2026-10-06: a party naming a unit since retired read back as stored, stalled the
   * runner for ever, and the switch-off (which resends the party) was refused as "No such unit".
   */
  it('lets an order naming a retired unit be switched off, and reads the unit as gone', async () => {
    const { app, token, baseId } = await crew();
    grant(app, baseId, [AUTOMATION_RUNGS.open]);
    withOfficers(app, baseId);
    expect((await save(app, token, ORDER)).statusCode).toBe(200);
    app.db
      .prepare('UPDATE automations SET force_json = ? WHERE base_id = ? AND slot = 0')
      .run(JSON.stringify({ razors: 1, retired_unit: 3 }), baseId);
    expect(app.repos.automations.get(baseId, 0)?.force).toEqual({ razors: 1 });
    // What the screen resends: the party as it last read it, the retired id included if stale.
    const off = await save(app, token, {
      ...ORDER,
      enabled: false,
      force: { razors: 1, retired_unit: 3 },
    });
    expect(off.statusCode, off.body).toBe(200);
    expect(app.repos.automations.get(baseId, 0)?.enabled).toBe(false);
  });

  /** Audit, 2026-09-28: the slot was saved, then stalled on every tick with "not free". */
  it('refuses switching on a slot that names an officer on the bench, and lets it be switched off', async () => {
    const { app, token, baseId } = await crew();
    grant(app, baseId, [AUTOMATION_RUNGS.open]);
    withOfficers(app, baseId);
    const base = app.repos.bases.findById(baseId)!;
    app.repos.bases.updateCommanders(baseId, [
      base.commanders[0]!,
      { ...base.commanders[1]!, role: null },
    ]);
    const refused = await save(app, token, { ...ORDER, officerId: 'auto-off-2' });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json<{ error: { message: string } }>().error.message).toBe(
      'Officer 2 is on the bench. Give them a chair first',
    );
    expect(app.repos.automations.get(baseId, 0)).toBeUndefined();
    const off = await save(app, token, { ...ORDER, enabled: false, officerId: 'auto-off-2' });
    expect(off.statusCode, off.body).toBe(200);
  });

  it('sends nobody for a party of nobody, whatever the slot was written with', async () => {
    const { app, token, baseId } = await crew();
    grant(app, baseId, [AUTOMATION_RUNGS.open]);
    withOfficers(app, baseId, 1);
    // Not one body on the books, and a slot written past the door: the row a save made before
    // this was closed looks exactly like this one.
    app.repos.bases.updateArmy(baseId, {}, []);
    expect((await save(app, token, ORDER)).statusCode).toBe(200);
    const held = app.repos.automations.get(baseId, 0);
    if (!held) throw new Error('fixture: no slot');
    app.repos.automations.put({ ...held, force: { constructor: 1 } });

    expect(settleAutomations(app.repos, new Date())).toBe(0);
    expect(app.repos.missions.listActiveByBaseId(baseId)).toHaveLength(0);
    expect(app.repos.feats.tallies(baseId).missions_done ?? 0).toBe(0);
  });

  it('refuses every rung the crew has not earned, by name', async () => {
    const { app, token, baseId } = await crew();
    grant(app, baseId, [AUTOMATION_RUNGS.open]);
    expect((await save(app, token, { ...ORDER, force: {}, unitSlots: 4 })).statusCode).toBe(403);
    expect((await save(app, token, { ...ORDER, optimiseFor: 'caps' })).statusCode).toBe(403);
    expect((await save(app, token, { ...ORDER, order: 'battles' })).statusCode).toBe(403);
    expect((await save(app, token, { ...ORDER, slot: 1 })).statusCode).toBe(403);
  });

  /**
   * "Need the officer seated" (maintainer, 2026-09-29): the runner stalls every slot while nobody
   * fit sits in the Right Hand's chair, so the door refuses to switch one on then, with the stall's
   * own words. Switching one off is never refused.
   */
  it('refuses switching an order on with no Right Hand at work, and never switching one off', async () => {
    const { app, token, baseId } = await crew();
    grant(app, baseId, [AUTOMATION_RUNGS.open]);
    withOfficers(app, baseId, 2);
    const seated = app.repos.bases.findById(baseId)!.commanders;
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const hurt = seated.map((one) =>
      one.role === 'right_hand' ? { ...one, injuredUntil: tomorrow } : one,
    );
    const empty = seated.filter((one) => one.role !== 'right_hand');

    for (const commanders of [hurt, empty]) {
      app.repos.bases.updateCommanders(baseId, commanders);
      const refused = await save(app, token, ORDER);
      expect(refused.statusCode, refused.body).toBe(403);
      expect(refused.json<{ error: { message: string } }>().error.message).toBe(NO_RIGHT_HAND_TEXT);
      expect(app.repos.automations.get(baseId, 0)?.enabled ?? false).toBe(false);
      expect((await save(app, token, { ...ORDER, enabled: false })).statusCode).toBe(200);
    }

    app.repos.bases.updateCommanders(baseId, seated);
    expect((await save(app, token, ORDER)).statusCode).toBe(200);
  });

  it('writes a slot the crew may hold, and reads it back', async () => {
    const { app, token, baseId } = await crew();
    grant(app, baseId, [AUTOMATION_RUNGS.open]);
    withOfficers(app, baseId, 1);
    const written = await save(app, token, ORDER);
    expect(written.statusCode, written.body).toBe(200);
    const slots = written.json<{ slots: { slot: number; enabled: boolean; force: unknown }[] }>()
      .slots;
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ slot: 0, enabled: true, force: { razors: 1 } });
    expect(app.repos.automations.get(baseId, 0)?.enabled).toBe(true);
  });

  /*
   * A slot's own leader stays on the list while out, marked so (maintainer, 2026-10-06). Dropping
   * them left a running order's dropdown reading "Choose the officer who leads". Somebody out whom
   * no slot names is still left off: the picker offers nobody the runner would refuse.
   */
  it('lists a slot’s own leader while out, marked out, and nobody else who is out', async () => {
    const { app, token, baseId } = await crew();
    grant(app, baseId, [AUTOMATION_RUNGS.open]);
    withOfficers(app, baseId, 3);
    expect((await save(app, token, { ...ORDER, officerId: 'auto-off-2' })).statusCode).toBe(200);
    const base = app.repos.bases.findById(baseId)!;
    const later = new Date(Date.now() + 3_600_000).toISOString();
    app.repos.bases.updateCommanders(
      baseId,
      base.commanders.map((one) =>
        one.id === 'auto-off-1' ? one : { ...one, injuredUntil: later },
      ),
    );

    const read = await app.inject({ method: 'GET', url: '/api/automations', headers: auth(token) });
    const officers = read.json<{ officers: { id: string; out: boolean }[] }>().officers;
    expect(officers).toEqual([
      expect.objectContaining({ id: 'auto-off-1', out: false }),
      expect.objectContaining({ id: 'auto-off-2', out: true }),
    ]);
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
/*
 * One slot this build cannot read (bug pass, 2026-10-06): saved for a resource since renamed, it
 * threw in the read of every enabled order and stopped every crew's standing orders, and in the
 * crew's own reads it answered 500 on the screen that switches it off.
 */
describe('a standing order this build cannot read', () => {
  it('is skipped, and every other order still runs', async () => {
    const { app, token, baseId } = await crew();
    grant(app, baseId, [AUTOMATION_RUNGS.open]);
    withOfficers(app, baseId);
    expect((await save(app, token, ORDER)).statusCode).toBe(200);
    const { db } = instances.at(-1)!;
    db.exec(
      `CREATE TEMP TABLE poisoned AS SELECT * FROM automations WHERE base_id = '${baseId}';
       UPDATE poisoned SET id = 'poisoned', slot = 1, optimise_for = 'rations';
       INSERT INTO automations SELECT * FROM poisoned;`,
    );
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    // The stage reads every enabled order before it settles any: one bad row threw it whole.
    expect(() => settleAutomations(app.repos, new Date())).not.toThrow();
    const read = await app.inject({ method: 'GET', url: '/api/automations', headers: auth(token) });
    expect(read.statusCode, read.body).toBe(200);
    expect((await save(app, token, { ...ORDER, enabled: false })).statusCode).toBe(200);
  });
});

/*
 * Bug pass, 2026-10-06: a standing order ranked its leader on the printed sheets and only lifted
 * the one it picked, while the board ranks the lifted bench. The Right Hand lifts everybody but
 * themselves, so a Right Hand a point ahead on paper lost the job to the officer they lift.
 */
describe('the leader a standing order picks', () => {
  it('is the one the board would pick, on the lifted sheets', async () => {
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
      payload: { username: 'picker', password: 'hunter2pass' },
    });
    const token = registered.json<{ token: string }>().token;
    const baseId = (await chooseOverseer(app, token)).json<{ base: { id: string } }>().base.id;
    grant(app, baseId, [AUTOMATION_RUNGS.open]);
    const longAgo = new Date(Date.now() - 48 * 3_600_000).toISOString();
    app.repos.bases.updateCommanders(baseId, [
      {
        ...createCommander('hand', 'The Hand', 'right_hand', makeAttributes(60)),
        seatedAt: longAgo,
      },
      {
        ...createCommander('lifted', 'The Lifted', 'fixer', makeAttributes(59)),
        seatedAt: longAgo,
      },
    ]);
    app.repos.bases.updateArmy(baseId, { razors: 5 }, []);
    expect((await save(app, token, ORDER)).statusCode).toBe(200);
    settleAutomations(app.repos, new Date());

    const [sent] = app.repos.missions.listActiveByBaseId(baseId);
    if (!sent) throw new Error('fixture: the slot sent nothing');
    const template = findMissionTemplate(sent.mission.templateId)!;
    const profile = composeProfile(leaningsFor(template));
    const base = app.repos.bases.findById(baseId)!;
    const room = officerLiftRoom(app.repos, base);
    const printed = bestLeader(base.commanders, profile)!;
    const lifted = bestLeader(
      base.commanders.map((one) => ({
        id: one.id,
        attributes: liftedOfficerSheet(one, room).attributes,
      })),
      profile,
    )!;
    // The fixture is only a test while the two rankings disagree on this job.
    expect(printed.id, 'the lifts no longer change who leads this job').not.toBe(lifted.id);
    expect(sent.mission.officerId).toBe(lifted.id);
  });
});

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
    withOfficers(app, baseId, 1);
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
    grant(app, baseId, [AUTOMATION_RUNGS.open]);
    withOfficers(app, baseId, 1);

    const board = await app.inject({ method: 'GET', url: '/api/missions', headers: auth(token) });
    const read = board.json<MissionsResponse>();
    const misc = read.areas.find((area) => area.id === MISC_AREA_ID);
    const offer = misc?.offers.find((one) => one.kind !== 'battle');
    if (!misc || !offer) throw new Error('fixture: the misc board offers no plain job');
    // The Overseer leads: a fresh crew has no officer, and every run has a leader.
    const leaderId = read.leaders.find((one) => one.kind === 'overseer')?.id;
    if (!leaderId) throw new Error('fixture: the bench has no Overseer on it');
    const launch = () =>
      app.inject({
        method: 'POST',
        url: '/api/missions',
        headers: auth(token),
        // What a fresh crew actually has on the books: eight Scavengers and no fighters
        // (`crew/starting.ts`, 2026-09-23). A Razor here refused with NO_FORCE long before the
        // lock this test is named for could answer.
        payload: {
          templateId: offer.templateId,
          areaId: misc.id,
          boardKey: offer.boardKey,
          grade: offer.grade,
          force: { scavengers: 1 },
          leaderId,
        },
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

/**
 * The three doors a standing order used to walk straight through (bug pass, 2026-09-23).
 *
 * A slot is a fourth way onto a field, beside `POST /missions`, a declaration and a deployment,
 * and it was the only one that asked none of the questions the other three ask. Each case below
 * pins the refusal against the manual route's, so the two cannot drift apart again.
 */
describe('a standing order obeys the same doors a player does', () => {
  /*
   * §D7 moved to the muster (maintainer, 2026-10-07): a unit on the books goes where the crew
   * goes, whatever the crew's name. Pinned on a rank-0 crew holding the sheet the old door
   * refused, by hand and by slot, so the gate cannot quietly come back on either.
   */
  it('sends whatever is on the books, whatever the crew’s name', async () => {
    const { app, token, baseId } = await crew();
    grant(app, baseId, [AUTOMATION_RUNGS.open, AUTOMATION_RUNGS.bestFit]);
    const base = app.repos.bases.findById(baseId)!;
    expect(base.economy.notoriety).toBe(0);
    expect(notorietyToField('juggernauts')).toBeGreaterThan(0);
    app.repos.bases.updateArmy(baseId, { juggernauts: 4, razors: 8 }, base.musterQueue);
    withOfficers(app, baseId);

    const board = await app.inject({ method: 'GET', url: '/api/missions', headers: auth(token) });
    const read = board.json<MissionsResponse>();
    const misc = read.areas.find((area) => area.id === MISC_AREA_ID);
    const offer = misc?.offers.find((one) => one.kind !== 'battle');
    if (!misc || !offer) throw new Error('fixture: the misc board offers no plain job');
    const byHand = await app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(token),
      payload: {
        templateId: offer.templateId,
        areaId: misc.id,
        boardKey: offer.boardKey,
        grade: offer.grade,
        force: { juggernauts: 1 },
        leaderId: read.leaders[0]?.id,
      },
    });
    expect(byHand.statusCode, byHand.body).toBe(200);

    // And by slot, naming the party, which is the branch that used to stall on the name. On a
    // second crew: the first's one leader is out on the job above, and a slot needs one.
    const slotted = await crew();
    grant(slotted.app, slotted.baseId, [AUTOMATION_RUNGS.open]);
    const second = slotted.app.repos.bases.findById(slotted.baseId)!;
    slotted.app.repos.bases.updateArmy(
      slotted.baseId,
      { juggernauts: 4, razors: 8 },
      second.musterQueue,
    );
    withOfficers(slotted.app, slotted.baseId);
    expect(
      (await save(slotted.app, slotted.token, { ...ORDER, force: { juggernauts: 1 } })).statusCode,
    ).toBe(200);
    settleAutomations(slotted.app.repos, new Date());
    const out = slotted.app.repos.missions.listActiveByBaseId(slotted.baseId);
    expect(out.length).toBe(1);
    expect(out[0]!.mission.force.juggernauts ?? 0).toBeGreaterThan(0);
  });

  it('stops at the ceiling on crews out at once, and says so', async () => {
    const { app, token, baseId } = await crew();
    grant(app, baseId, [AUTOMATION_RUNGS.open, AUTOMATION_RUNGS.secondSlot]);
    const base = app.repos.bases.findById(baseId)!;
    app.repos.bases.updateArmy(baseId, { razors: 40 }, base.musterQueue);
    withOfficers(app, baseId);
    // Boards to fill by hand: a district hires only a crew that holds a place in it.
    holdEveryBoard(app.repos, baseId);

    const ceiling = concurrentMissionSlots(base.level);
    expect(ceiling, 'a fixture with no ceiling proves nothing').toBeGreaterThan(0);

    /*
     * Filled to the ceiling by hand first, which is the shape the defect was found in: the manual
     * door counts the runs already out and the slot did not, so a player with every crew out could
     * put another two on the road by writing an order.
     */
    const board = await app.inject({ method: 'GET', url: '/api/missions', headers: auth(token) });
    const { areas, leaders } = board.json<MissionsResponse>();
    let sent = 0;
    for (const area of areas) {
      const offer = area.offers.find((one) => one.kind !== 'battle');
      if (!offer || sent >= ceiling) continue;
      const launched = await app.inject({
        method: 'POST',
        url: '/api/missions',
        headers: auth(token),
        // A different leader for each: one person leads one run at a time.
        payload: {
          templateId: offer.templateId,
          areaId: area.id,
          boardKey: offer.boardKey,
          grade: offer.grade,
          force: { razors: 2 },
          leaderId: leaders[sent]?.id,
        },
      });
      if (launched.statusCode === 200) sent += 1;
    }
    expect(sent, 'the fixture could not fill the board by hand').toBe(ceiling);
    expect(app.repos.missions.countActiveByBaseId(baseId)).toBe(ceiling);

    // Now the order, and enough ticks that it would have fired more than once.
    expect((await save(app, token, ORDER)).statusCode).toBe(200);
    for (let tick = 0; tick < 4; tick += 1) settleAutomations(app.repos, new Date());

    expect(app.repos.missions.countActiveByBaseId(baseId), 'the slot walked past the ceiling').toBe(
      ceiling,
    );
    // ...and it says why, rather than looking idle.
    expect(app.repos.automations.get(baseId, 0)?.stalled).toContain('Every crew is out');
  });
});
