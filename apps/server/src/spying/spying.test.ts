import {
  SCOUTING_RESEARCH_ID,
  SPY_ACCURACY_RESEARCH_ID,
  SPY_ESTIMATE_RESEARCH_ID,
  SPY_NOTICE_RESEARCH_ID,
  SPY_SLEEPERS_RESEARCH_ID,
  SPY_TIER_SPECS,
  SPY_TRACE_RESEARCH_ID,
  createCommander,
  findDistrict,
  findLocation,
  makeAttributes,
  type BattlesResponse,
  type CityMutationResponse,
  type DistrictDetailResponse,
  type Notification,
  type SpyTarget,
  type SpyTier,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { tickWorld } from '../live/clock.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';
import { groundBehind, settleSpying } from './spying.js';

/**
 * Spying, end to end (maintainer ruling, 2026-09-22): the refusals, the caps, the clock, the
 * report and who is told about it. The arithmetic itself is measured in
 * `@frontline/shared`'s `spying/spying.test.ts`; this file is about the save.
 */

interface Stack {
  app: FastifyInstance;
  db: AppDatabase;
  token: string;
  baseId: string;
}

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function register(
  app: FastifyInstance,
  username: string,
): Promise<Stack & { db: AppDatabase }> {
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
  return { app, db: instances[instances.length - 1]!.db, token, baseId };
}

async function makeWorld(): Promise<{ me: Stack; rival: Stack }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const me = await register(app, 'watcher');
  const rival = await register(app, 'watched');
  return { me, rival };
}

/** A Master of Whispers at `rating`, with the Scouting rung, and caps to spend. */
function hire(stack: Stack, rating = 60): void {
  const base = stack.app.repos.bases.findById(stack.baseId)!;
  stack.app.repos.bases.updateCommanders(base.id, [
    ...base.commanders,
    createCommander('spy', 'Wire', 'master_of_whispers', makeAttributes(rating), []),
  ]);
  teach(stack, SCOUTING_RESEARCH_ID);
  stack.app.repos.bases.updateResources(base.id, { ...base.resources, caps: 50_000 });
}

function teach(stack: Stack, ...ids: string[]): void {
  const base = stack.app.repos.bases.findById(stack.baseId)!;
  stack.app.repos.bases.updateResearch(base.id, {
    ...base.research,
    technologies: [...new Set([...base.research.technologies, ...ids])],
  });
}

/** The rival holds the Press with `garrison`, and we have seen the Rustyard. */
function theirPress(me: Stack, rival: Stack, garrison: Record<string, number>): void {
  const press = me.app.repos.city.control('rustyard-press')!;
  me.app.repos.city.put({ ...press, holder: { kind: 'crew', baseId: rival.baseId }, garrison });
  me.app.repos.city.markScouted(me.baseId, 'rustyard', new Date().toISOString());
}

const PRESS: SpyTarget = { kind: 'location', locationId: 'rustyard-press' };

const spy = (stack: Stack, target: SpyTarget, tier: SpyTier = 'loose_ears') =>
  stack.app.inject({
    method: 'POST',
    url: '/api/city/spy',
    headers: auth(stack.token),
    payload: { target, tier },
  });

const caps = (stack: Stack): number => stack.app.repos.bases.findById(stack.baseId)!.resources.caps;

/** Wind the job back so the world clock finds it due. */
function windBack(stack: Stack): void {
  stack.db
    .prepare('UPDATE spy_runs SET returns_at = ?')
    .run(new Date(Date.now() - 60_000).toISOString());
}

const bell = (stack: Stack, kind: Notification['kind']): Notification[] => {
  const base = stack.app.repos.bases.findById(stack.baseId)!;
  return stack.app.repos.social.notifications(base.ownerId, 50).filter((n) => n.kind === kind);
};

describe('sending the runners', () => {
  it('takes the caps at the send and puts the job on the clock', async () => {
    const { me, rival } = await makeWorld();
    hire(me);
    theirPress(me, rival, { razors: 20 });
    const before = caps(me);

    const res = await spy(me, PRESS, 'paid_whisper');
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    expect(before - caps(me)).toBe(SPY_TIER_SPECS.paid_whisper.caps);

    const district = res.json<CityMutationResponse>().district;
    expect(district.spyRun?.placeName).toBe(findLocation('rustyard-press')!.name);
    expect(district.spyRun?.tier).toBe('paid_whisper');
    // One job at a time.
    const again = await spy(me, PRESS);
    expect(again.statusCode).toBe(400);
    expect(again.json<{ error: { message: string } }>().error.message).toMatch(/already out/);
  });

  it('refuses without the chair and without the caps, and asks for nothing else', async () => {
    const { me, rival } = await makeWorld();
    theirPress(me, rival, { razors: 20 });
    expect((await spy(me, PRESS)).statusCode).toBe(409);

    /*
     * The chair alone (maintainer, 2026-09-22).
     *
     * Spying used to need the Scouting rung as well, the way a scout party does. It does not:
     * a job is bought with caps the moment somebody is sitting in the chair. Asserted with the
     * research deliberately emptied, or this would pass on a crew that happens to have it.
     */
    hire(me);
    const base = me.app.repos.bases.findById(me.baseId)!;
    me.app.repos.bases.updateResearch(me.baseId, { ...base.research, technologies: [] });
    expect((await spy(me, PRESS)).statusCode, 'the rung is still gating a job').toBe(200);

    // Home again before the next send, or the refusal below would be "one job at a time"
    // rather than the one this is measuring.
    windBack(me);
    settleSpying(me.app.repos, new Date());
    me.app.repos.bases.updateResources(me.baseId, { ...base.resources, caps: 0 });
    const broke = await spy(me, PRESS, 'total_intelligence');
    expect(broke.statusCode).toBe(409);
    expect(broke.json<{ error: { message: string } }>().error.message).toMatch(/caps/);
  });

  it('refuses your own ground, empty ground, unscouted ground and a shut district', async () => {
    const { me, rival } = await makeWorld();
    hire(me);
    const reader = () => me.app.repos.bases.findById(me.baseId)!;

    expect(groundBehind(me.app.repos, reader(), PRESS)).toEqual({
      kind: 'refused',
      reason: 'unscouted',
    });
    me.app.repos.city.markScouted(me.baseId, 'rustyard', new Date().toISOString());
    const press = me.app.repos.city.control('rustyard-press')!;
    me.app.repos.city.put({ ...press, holder: { kind: 'unoccupied' }, garrison: {} });
    expect(groundBehind(me.app.repos, reader(), PRESS)).toEqual({
      kind: 'refused',
      reason: 'nothing_there',
    });
    me.app.repos.city.put({ ...press, holder: { kind: 'crew', baseId: me.baseId } });
    expect(groundBehind(me.app.repos, reader(), PRESS)).toEqual({
      kind: 'refused',
      reason: 'own_ground',
    });
    // The rival takes the whole district: its gate is armed and the Press is behind it.
    for (const location of findDistrict('rustyard')!.locations) {
      const control = me.app.repos.city.control(location.id)!;
      me.app.repos.city.put({ ...control, holder: { kind: 'crew', baseId: rival.baseId } });
    }
    expect(groundBehind(me.app.repos, reader(), PRESS)).toEqual({
      kind: 'refused',
      reason: 'not_the_gate',
    });
    const gate = groundBehind(me.app.repos, reader(), { kind: 'gate', districtId: 'rustyard' });
    expect(gate.kind).toBe('ground');
    // Our own front door is not something we spy, and a rival's is read at the gate.
    expect(
      groundBehind(me.app.repos, reader(), { kind: 'gate', districtId: reader().districtId }),
    ).toEqual({ kind: 'refused', reason: 'own_ground' });
  });
});

describe('the report', () => {
  it('is written by the world clock, rings the bell, and lands on the board', async () => {
    const { me, rival } = await makeWorld();
    hire(me, 100);
    theirPress(me, rival, { razors: 20, scrapers: 5 });
    expect((await spy(me, PRESS, 'total_intelligence')).statusCode).toBe(200);
    windBack(me);

    tickWorld(me.app.repos, me.app.skirmishEngine, new Date());

    const board = (
      await me.app.inject({ method: 'GET', url: '/api/battles', headers: auth(me.token) })
    ).json<BattlesResponse>();
    expect(board.spyReports).toHaveLength(1);
    const report = board.spyReports[0]!;
    expect(report.placeName).toBe(findLocation('rustyard-press')!.name);
    expect(report.districtName).toBe(findDistrict('rustyard')!.name);
    expect(report.holder.kind).toBe('crew');
    expect(report.capsPaid).toBe(SPY_TIER_SPECS.total_intelligence.caps);
    expect(report.failed).toBe(false);
    // An S chair with Total Intelligence on a bare looter-grade garrison reads all of it.
    expect(report.exposed).toEqual({ razors: 20, scrapers: 5 });
    // Neither readout without its rung: frozen onto the report.
    expect(report.accuracyShown).toBe(false);
    expect(report.unseen).toBeNull();

    const rung = bell(me, 'spy_report');
    expect(rung).toHaveLength(1);
    expect(rung[0]!.link).toBe(`/game/battles?spy=${report.id}`);

    // The sheet quotes it, and the count stays theirs to give.
    const district = (
      await me.app.inject({ method: 'GET', url: '/api/city/rustyard', headers: auth(me.token) })
    ).json<DistrictDetailResponse>();
    const view = district.locations.find((l) => l.location.id === 'rustyard-press')!;
    expect(view.garrisonSize).toBeNull();
    expect(view.latestSpyReport?.id).toBe(report.id);
    expect(district.spyRun).toBeNull();
  });

  it('prints the readouts once the rungs are in', async () => {
    const { me, rival } = await makeWorld();
    hire(me, 100);
    teach(me, SPY_ACCURACY_RESEARCH_ID, SPY_ESTIMATE_RESEARCH_ID);
    theirPress(me, rival, { razors: 20 });
    await spy(me, PRESS, 'total_intelligence');
    windBack(me);
    settleSpying(me.app.repos, new Date());

    const report = me.app.repos.spying.reportsFor(me.baseId, 10)[0]!;
    expect(report.accuracyShown).toBe(true);
    expect(report.accuracy).toBe(1);
    expect(report.unseen).toBe(0);
  });

  it('fails under the floor, keeps the caps, and counts for nothing', async () => {
    const { me, rival } = await makeWorld();
    hire(me, 10);
    // A strong Consigliere against the worst chair and the cheapest tier: nothing gets through.
    const theirs = me.app.repos.bases.findById(rival.baseId)!;
    me.app.repos.bases.updateCommanders(rival.baseId, [
      ...theirs.commanders,
      createCommander('c', 'Quiet', 'consigliere', makeAttributes(100), []),
    ]);
    theirPress(me, rival, { razors: 40 });
    const before = caps(me);
    await spy(me, PRESS, 'loose_ears');
    windBack(me);
    settleSpying(me.app.repos, new Date());

    const report = me.app.repos.spying.reportsFor(me.baseId, 10)[0]!;
    expect(report.failed).toBe(true);
    expect(report.exposed).toEqual({});
    expect(caps(me)).toBe(before - SPY_TIER_SPECS.loose_ears.caps);
    expect(bell(me, 'spy_report')[0]!.title).toMatch(/nothing/);
    expect(me.app.repos.feats.tallies(me.baseId).spy_reports ?? 0).toBe(0);
  });

  it('never lists a Sleeper without the rung, and lists planted ones with it', async () => {
    const { me, rival } = await makeWorld();
    hire(me, 100);
    theirPress(me, rival, { razors: 10, sleepers: 6 });
    await spy(me, PRESS, 'total_intelligence');
    windBack(me);
    settleSpying(me.app.repos, new Date());
    expect(me.app.repos.spying.reportsFor(me.baseId, 10)[0]!.exposed).toEqual({ razors: 10 });

    teach(me, SPY_SLEEPERS_RESEARCH_ID);
    // A third crew's cell in place on the same ground.
    me.app.repos.sleepers.insert({
      id: 'cell',
      baseId: rival.baseId,
      locationId: 'rustyard-press',
      army: { sleepers: 3 },
      phase: 'waiting',
      departedAt: new Date().toISOString(),
      arrivesAt: new Date().toISOString(),
      travelMs: 0,
    });
    await spy(me, PRESS, 'total_intelligence');
    windBack(me);
    settleSpying(me.app.repos, new Date());
    expect(me.app.repos.spying.reportsFor(me.baseId, 10)[0]!.exposed).toEqual({
      razors: 10,
      sleepers: 9,
    });
  });

  it('reads a player district at its gate: the gate garrison, behind their Gate', async () => {
    const { me, rival } = await makeWorld();
    hire(me, 100);
    const theirs = me.app.repos.bases.findById(rival.baseId)!;
    // The door, since the split (2026-09-22): what stands behind a player's gate is its garrison.
    me.app.repos.bases.updateGateArmy(rival.baseId, { razors: 12, the_specter: 1 });
    me.app.repos.city.markScouted(me.baseId, theirs.districtId, new Date().toISOString());

    await spy(me, { kind: 'gate', districtId: theirs.districtId }, 'total_intelligence');
    windBack(me);
    settleSpying(me.app.repos, new Date());
    const report = me.app.repos.spying.reportsFor(me.baseId, 10)[0]!;
    expect(report.placeName).toBe('The gate');
    // The Specter is never in a report, and is not counted against the accuracy either.
    expect(report.exposed).toEqual({ razors: 12 });
    expect(report.accuracy).toBe(1);

    /*
     * ...and the door's own window knows it has been read.
     *
     * A location carries its last report on its own view; a gate is not a location, so without
     * `spyGateReport` the gate window told a crew that had already paid for a look that nobody
     * of theirs had ever been.
     */
    const theirDistrict = (
      await me.app.inject({
        method: 'GET',
        url: `/api/city/${theirs.districtId}`,
        headers: auth(me.token),
      })
    ).json<DistrictDetailResponse>();
    expect(theirDistrict.spyGateReport?.id).toBe(report.id);
    // Never on the crew's own door: there is nothing there to spy.
    const home = (
      await me.app.inject({
        method: 'GET',
        url: `/api/city/${me.app.repos.bases.findById(me.baseId)!.districtId}`,
        headers: auth(me.token),
      })
    ).json<DistrictDetailResponse>();
    expect(home.spyGateReport).toBeNull();
  });
});

describe('who is told', () => {
  it('says nothing to the holder without the rung, a word with it, and the name with the next', async () => {
    const { me, rival } = await makeWorld();
    hire(me, 100);
    theirPress(me, rival, { razors: 20 });
    const look = async () => {
      await spy(me, PRESS, 'total_intelligence');
      windBack(me);
      settleSpying(me.app.repos, new Date());
    };

    await look();
    expect(bell(rival, 'spied_on')).toHaveLength(0);

    teach(rival, SPY_NOTICE_RESEARCH_ID);
    await look();
    const word = bell(rival, 'spied_on');
    expect(word).toHaveLength(1);
    expect(word[0]!.body).toMatch(/caught wind/);
    expect(word[0]!.body).not.toMatch(/watcher/);

    teach(rival, SPY_TRACE_RESEARCH_ID);
    await look();
    const named = bell(rival, 'spied_on')[0]!;
    expect(named.body).toMatch(/20 of yours/);
    expect(named.body).toMatch(me.app.repos.bases.findById(me.baseId)!.name);
  });
});

describe('turning them round', () => {
  it('walks them home without a report, and the caps stay spent', async () => {
    const { me, rival } = await makeWorld();
    hire(me);
    theirPress(me, rival, { razors: 20 });
    const before = caps(me);
    await spy(me, PRESS, 'bought_eyes');

    const recalled = await me.app.inject({
      method: 'POST',
      url: '/api/city/spy/recall',
      headers: auth(me.token),
      payload: {},
    });
    expect(recalled.statusCode, recalled.body.slice(0, 200)).toBe(200);
    expect(recalled.json<CityMutationResponse>().district.spyRun?.recalledAt).not.toBeNull();
    expect(caps(me)).toBe(before - SPY_TIER_SPECS.bought_eyes.caps);

    windBack(me);
    settleSpying(me.app.repos, new Date());
    expect(me.app.repos.spying.reportsFor(me.baseId, 10)).toHaveLength(0);
    expect(me.app.repos.spying.activeFor(me.baseId)).toHaveLength(0);
  });

  it('refuses once the first tenth of the way out has passed', async () => {
    const { me, rival } = await makeWorld();
    hire(me);
    theirPress(me, rival, { razors: 20 });
    await spy(me, PRESS);
    me.db
      .prepare('UPDATE spy_runs SET departed_at = ?')
      .run(new Date(Date.now() - 6 * 3_600_000).toISOString());
    const late = await me.app.inject({
      method: 'POST',
      url: '/api/city/spy/recall',
      headers: auth(me.token),
      payload: {},
    });
    expect(late.statusCode).toBe(409);
  });
});
