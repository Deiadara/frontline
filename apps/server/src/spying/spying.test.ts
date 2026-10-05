import {
  SPY_DEFENCE_BREAK_EVEN,
  COMBINE_LEADERS,
  SPY_ACCURACY_RESEARCH_ID,
  SPY_ESTIMATE_RESEARCH_ID,
  SPY_PAID_TIERS_RESEARCH_ID,
  SPY_QUIET_RESEARCH_ID,
  SPY_SLEEPERS_RESEARCH_ID,
  SPY_TIER_SPECS,
  SPY_WHOLE_WIRE_RESEARCH_ID,
  SPY_WRITTEN_RESEARCH_ID,
  armySize,
  counterScore,
  roughAccuracy,
  roughUnseen,
  spyScore,
  unitSlotsUsed,
  createCommander,
  findDistrict,
  findLocation,
  makeAttributes,
  type BattlesResponse,
  type CityMutationResponse,
  type Commander,
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
import { chooseOverseer, overseerSpyGuardAt, pinOverseer } from '../testing/overseer.js';
import { groundBehind, settleSpying, snapshotSpying, spyStrengthFor } from './spying.js';

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
  // The rival's Overseer at the break-even, so their own Signals and Cryptography move no counter
  // here unless a test sets them (2026-10-04).
  overseerSpyGuardAt(app, rival.baseId, SPY_DEFENCE_BREAK_EVEN);
  return { me, rival };
}

/** A Master of Whispers at `rating`, and caps to spend. */
function hire(stack: Stack, rating = 60): void {
  const base = stack.app.repos.bases.findById(stack.baseId)!;
  stack.app.repos.bases.updateCommanders(base.id, [
    ...base.commanders,
    createCommander('spy', 'Wire', 'master_of_whispers', makeAttributes(rating), []),
  ]);
  stack.app.repos.bases.updateResources(base.id, { ...base.resources, caps: 50_000 });
}

/** The rung that opens a tier, and Written Reports, so a report names what it saw. */
function openTier(stack: Stack, tier: SpyTier): void {
  const rung = SPY_TIER_SPECS[tier].opensWith;
  teach(stack, SPY_WRITTEN_RESEARCH_ID, ...(rung === null ? [] : [rung]));
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
  const press = me.app.repos.city.control('steelbelt-press')!;
  me.app.repos.city.put({ ...press, holder: { kind: 'crew', baseId: rival.baseId }, garrison });
}

/** The rival seats a Master of Whispers at `rating` on every attribute. */
function theirWhispers(me: Stack, rival: Stack, rating: number): void {
  const theirs = me.app.repos.bases.findById(rival.baseId)!;
  me.app.repos.bases.updateCommanders(rival.baseId, [
    ...theirs.commanders.filter((officer) => officer.role !== 'master_of_whispers'),
    createCommander('their-spy', 'Quiet', 'master_of_whispers', makeAttributes(rating), []),
  ]);
}

const PRESS: SpyTarget = { kind: 'location', locationId: 'steelbelt-press' };

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
    openTier(me, 'paid_whisper');
    const before = caps(me);

    const res = await spy(me, PRESS, 'paid_whisper');
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    expect(before - caps(me)).toBe(SPY_TIER_SPECS.paid_whisper.caps);

    const district = res.json<CityMutationResponse>().district;
    expect(district.spyRuns).toHaveLength(1);
    expect(district.spyRuns[0]?.placeName).toBe(findLocation('steelbelt-press')!.name);
    expect(district.spyRuns[0]?.tier).toBe('paid_whisper');
    // One job at a time: anywhere else waits for the party...
    const gate = {
      kind: 'gate',
      districtId: me.app.repos.bases.findById(rival.baseId)!.districtId,
    } as const;
    const elsewhere = await spy(me, gate);
    expect(elsewhere.statusCode).toBe(400);
    expect(elsewhere.json<{ error: { message: string } }>().error.message).toMatch(/already out/);
    // ...and the same place says so (2026-10-05).
    const again = await spy(me, PRESS);
    expect(again.statusCode).toBe(400);
    expect(again.json<{ error: { message: string } }>().error.message).toMatch(
      /already on their way there/,
    );
  });

  it('refuses without the chair and without the caps, and asks for nothing else', async () => {
    const { me, rival } = await makeWorld();
    theirPress(me, rival, { razors: 20 });
    expect((await spy(me, PRESS)).statusCode).toBe(409);

    /*
     * The chair alone (maintainer, 2026-09-22).
     *
     * Spying needs no rung: a job is bought with caps the moment somebody is sitting in the
     * chair. Asserted with the research deliberately emptied, or this would pass on a crew that
     * happens to have one.
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
    openTier(me, 'total_intelligence');
    const broke = await spy(me, PRESS, 'total_intelligence');
    expect(broke.statusCode).toBe(409);
    expect(broke.json<{ error: { message: string } }>().error.message).toMatch(/caps/);
  });

  it('refuses your own ground, empty ground and a shut district, and reads anywhere else', async () => {
    const { me, rival } = await makeWorld();
    hire(me);
    const reader = () => me.app.repos.bases.findById(me.baseId)!;

    // Ground nobody of this crew's has been near is read like any other: the whole city is visible
    // (maintainer, 2026-09-29). The looters hold the Steelbelt end to end at the start, so its gate
    // is what there is to read, and the Press behind it is not.
    expect(groundBehind(me.app.repos, reader(), PRESS)).toEqual({
      kind: 'refused',
      reason: 'not_the_gate',
    });
    expect(
      groundBehind(me.app.repos, reader(), { kind: 'gate', districtId: 'steelbelt' }).kind,
    ).toBe('ground');
    const press = me.app.repos.city.control('steelbelt-press')!;
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
    for (const location of findDistrict('steelbelt')!.locations) {
      const control = me.app.repos.city.control(location.id)!;
      me.app.repos.city.put({ ...control, holder: { kind: 'crew', baseId: rival.baseId } });
    }
    expect(groundBehind(me.app.repos, reader(), PRESS)).toEqual({
      kind: 'refused',
      reason: 'not_the_gate',
    });
    const gate = groundBehind(me.app.repos, reader(), { kind: 'gate', districtId: 'steelbelt' });
    expect(gate.kind).toBe('ground');
    // Our own front door is not something we spy, and a rival's is read at the gate.
    expect(
      groundBehind(me.app.repos, reader(), { kind: 'gate', districtId: reader().districtId }),
    ).toEqual({ kind: 'refused', reason: 'own_ground' });
  });
});

/**
 * The job is clocked on the Master of Whispers' lifted sheet (maintainer, 2026-09-30), the one the
 * crew screen draws and every officer fights and is graded on. A peer who teaches the physical
 * group makes them quicker on the road and, with a fuller sheet, quicker on the ground; neither
 * showed while the clock read the printed card.
 */
describe('the clock on a lifted sheet', () => {
  const quote = async (stack: Stack): Promise<number> => {
    const seen = (
      await stack.app.inject({
        method: 'GET',
        url: '/api/city/steelbelt',
        headers: auth(stack.token),
      })
    ).json<DistrictDetailResponse>();
    expect(seen.spyQuote, 'a Master of Whispers is in the chair').not.toBeNull();
    return seen.spyQuote!.minutes;
  };

  it('quotes a shorter job once a peer teaches, and freezes the job it quoted', async () => {
    const { me, rival } = await makeWorld();
    hire(me, 30);
    theirPress(me, rival, { razors: 20 });
    const printed = await quote(me);

    const base = me.app.repos.bases.findById(me.baseId)!;
    me.app.repos.bases.updateCommanders(base.id, [
      ...base.commanders,
      createCommander('teacher', 'Old Hand', 'trader', {}, ['old_instructor']),
    ]);
    const lifted = await quote(me);
    expect(lifted).toBeLessThan(printed);

    const res = await spy(me, PRESS);
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    const run = res.json<CityMutationResponse>().district.spyRuns[0]!;
    const frozen = (Date.parse(run.returnsAt) - Date.parse(run.departedAt)) / 60_000;
    expect(frozen).toBe(lifted);
  });
});

describe('the report', () => {
  it('is written by the world clock, rings the bell, and lands on the board', async () => {
    const { me, rival } = await makeWorld();
    hire(me, 100);
    openTier(me, 'total_intelligence');
    theirPress(me, rival, { razors: 20, scrapers: 5 });
    expect((await spy(me, PRESS, 'total_intelligence')).statusCode).toBe(200);
    windBack(me);

    tickWorld(me.app.repos, me.app.skirmishEngine, new Date());

    const board = (
      await me.app.inject({ method: 'GET', url: '/api/battles', headers: auth(me.token) })
    ).json<BattlesResponse>();
    expect(board.spyReports).toHaveLength(1);
    const report = board.spyReports[0]!;
    expect(report.placeName).toBe(findLocation('steelbelt-press')!.name);
    expect(report.districtName).toBe(findDistrict('steelbelt')!.name);
    expect(report.holder.kind).toBe('crew');
    expect(report.capsPaid).toBe(SPY_TIER_SPECS.total_intelligence.caps);
    expect(report.failed).toBe(false);
    // An S chair with Total Intelligence on a bare looter-grade garrison reads all of it.
    expect(report.exposed).toEqual({ razors: 20, scrapers: 5 });
    // Neither readout without its rung: frozen onto the report, and not sent to be hidden by the
    // screen, since the exposed count over the accuracy is the whole garrison.
    expect(report.accuracyShown).toBe(false);
    expect(report.accuracy).toBeNull();
    expect(report.unseen).toBeNull();
    // The Whole Wire, which opened the tier, also prints the exact slots standing there.
    expect(report.totalSlots).toBe(unitSlotsUsed({ razors: 20, scrapers: 5 }));

    const rung = bell(me, 'spy_report');
    expect(rung).toHaveLength(1);
    expect(rung[0]!.link).toBe(`/game/battles?spy=${report.id}`);

    // The sheet quotes it, and the count stays theirs to give.
    const district = (
      await me.app.inject({ method: 'GET', url: '/api/city/steelbelt', headers: auth(me.token) })
    ).json<DistrictDetailResponse>();
    const view = district.locations.find((l) => l.location.id === 'steelbelt-press')!;
    expect(view.garrisonSize).toBeNull();
    expect(view.latestSpyReport?.id).toBe(report.id);
    expect(view.latestSpyReport?.accuracy).toBeNull();
    expect(district.spyRuns).toEqual([]);
  });

  it('prints the readouts once the rungs are in', async () => {
    const { me, rival } = await makeWorld();
    hire(me, 100);
    teach(me, SPY_ACCURACY_RESEARCH_ID, SPY_ESTIMATE_RESEARCH_ID);
    openTier(me, 'bought_eyes');
    theirPress(me, rival, { razors: 20 });
    await spy(me, PRESS, 'bought_eyes');
    windBack(me);
    settleSpying(me.app.repos, new Date());

    const report = me.app.repos.spying.reportsFor(me.baseId, 10)[0]!;
    expect(report.accuracyShown).toBe(true);
    expect(report.accuracy).toBe(1);
    expect(report.unseen).toBe(0);
    expect(report.totalSlots).toBeNull();
    expect(me.app.repos.feats.tallies(me.baseId).spy_jobs_returned).toBe(1);

    // The Whole Wire prints the exact slots, and the estimate has nothing left to guess at.
    teach(me, SPY_WHOLE_WIRE_RESEARCH_ID);
    await spy(me, PRESS, 'bought_eyes');
    windBack(me);
    settleSpying(me.app.repos, new Date());
    const wired = me.app.repos.spying.reportsFor(me.baseId, 1)[0]!;
    expect(wired.failed).toBe(false);
    expect(wired.accuracy).toBe(1);
    expect(wired.unseen).toBeNull();
    expect(wired.totalSlots).toBe(unitSlotsUsed({ razors: 20 }));
  });

  it('fails under the floor, keeps the caps, and counts only as a job home', async () => {
    const { me, rival } = await makeWorld();
    hire(me, 10);
    // A strong Master of Whispers of theirs against the worst chair and the cheapest tier:
    // nothing gets through.
    theirWhispers(me, rival, 100);
    theirPress(me, rival, { razors: 40 });
    // Both readouts on the track, and neither comes home on a failed report: the two together
    // would give back the count the empty list withholds.
    teach(me, SPY_ACCURACY_RESEARCH_ID, SPY_ESTIMATE_RESEARCH_ID);
    const before = caps(me);
    await spy(me, PRESS, 'loose_ears');
    windBack(me);
    settleSpying(me.app.repos, new Date());

    const report = me.app.repos.spying.reportsFor(me.baseId, 10)[0]!;
    expect(report.failed).toBe(true);
    expect(report.exposed).toEqual({});
    expect(report.accuracy).toBeNull();
    expect(report.unseen).toBeNull();
    expect(caps(me)).toBe(before - SPY_TIER_SPECS.loose_ears.caps);
    expect(bell(me, 'spy_report')[0]!.title).toMatch(/nothing/);
    // Nothing learnt, so not a report on the ladder that counts them; but the runners came home,
    // and the ladder that replaced scouting counts every job that did (2026-09-29).
    expect(me.app.repos.feats.tallies(me.baseId).spy_reports ?? 0).toBe(0);
    expect(me.app.repos.feats.tallies(me.baseId).spy_jobs_returned).toBe(1);
  });

  it('never lists a Sleeper without the rung, and lists planted ones with it', async () => {
    const { me, rival } = await makeWorld();
    hire(me, 100);
    openTier(me, 'total_intelligence');
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
      locationId: 'steelbelt-press',
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
    teach(me, SPY_ACCURACY_RESEARCH_ID);
    openTier(me, 'total_intelligence');
    const theirs = me.app.repos.bases.findById(rival.baseId)!;
    // The door, since the split (2026-09-22): what stands behind a player's gate is its garrison.
    me.app.repos.bases.updateGateArmy(rival.baseId, { razors: 12, the_specter: 1 });

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

describe('ground that changed while they walked (bug pass, 2026-09-28)', () => {
  it('fails when the district shut behind its gate, and the holder hears of it', async () => {
    const { me, rival } = await makeWorld();
    hire(me, 100);
    teach(me, SPY_ACCURACY_RESEARCH_ID);
    openTier(me, 'total_intelligence');
    theirPress(me, rival, { razors: 50 });
    expect((await spy(me, PRESS, 'total_intelligence')).statusCode).toBe(200);
    // While they walked, the rival took the rest of the district: the Press is behind a gate now.
    for (const location of findDistrict('steelbelt')!.locations) {
      const control = me.app.repos.city.control(location.id)!;
      me.app.repos.city.put({ ...control, holder: { kind: 'crew', baseId: rival.baseId } });
    }
    windBack(me);
    settleSpying(me.app.repos, new Date());

    // Fifty Razors stand there. It used to read as empty ground at full accuracy.
    const report = me.app.repos.spying.reportsFor(me.baseId, 10)[0]!;
    expect(report.failed).toBe(true);
    expect(report.exposed).toEqual({});
    expect(report.accuracy).toBeNull();
    expect(bell(rival, 'spied_on')).toHaveLength(1);
  });

  it('is still an empty report on ground that emptied, and nobody is told', async () => {
    const { me, rival } = await makeWorld();
    hire(me, 100);
    teach(me, SPY_ACCURACY_RESEARCH_ID);
    openTier(me, 'total_intelligence');
    theirPress(me, rival, { razors: 50 });
    await spy(me, PRESS, 'total_intelligence');
    const press = me.app.repos.city.control('steelbelt-press')!;
    me.app.repos.city.put({ ...press, holder: { kind: 'unoccupied' }, garrison: {} });
    windBack(me);
    settleSpying(me.app.repos, new Date());

    const report = me.app.repos.spying.reportsFor(me.baseId, 10)[0]!;
    expect(report.failed).toBe(false);
    expect(report.exposed).toEqual({});
    expect(report.accuracy).toBe(1);
    expect(bell(rival, 'spied_on')).toHaveLength(0);
  });
});

/*
 * The runners read the ground when they reach it, not when they get home (maintainer, 2026-10-02):
 * a garrison that walks off while they walk back is still on the report, dated when they looked.
 */
describe('a read taken at the target', () => {
  it('keeps what they saw when they got there, whatever moved while they walked home', async () => {
    const { me, rival } = await makeWorld();
    hire(me, 100);
    openTier(me, 'total_intelligence');
    theirPress(me, rival, { razors: 50 });
    expect((await spy(me, PRESS, 'total_intelligence')).statusCode).toBe(200);
    const run = me.app.repos.spying.activeFor(me.baseId)[0]!;
    // They have just reached the Press.
    const arrived = Date.now() - 1_000;
    me.db
      .prepare('UPDATE spy_runs SET departed_at = ?')
      .run(new Date(arrived - run.travelMinutes * 60_000).toISOString());
    expect(snapshotSpying(me.app.repos, new Date())).toBe(1);

    // The garrison walks off while the runners walk home.
    const press = me.app.repos.city.control('steelbelt-press')!;
    me.app.repos.city.put({ ...press, garrison: {} });
    windBack(me);
    settleSpying(me.app.repos, new Date());

    const report = me.app.repos.spying.reportsFor(me.baseId, 10)[0]!;
    expect(report.exposed).toEqual({ razors: 50 });
    expect(Date.parse(report.writtenAt)).toBeLessThanOrEqual(arrived + 1_000);
  });
});

describe("a Combine district's gate", () => {
  it.each(COMBINE_LEADERS.map((leader) => [leader.districtId, leader] as const))(
    '%s: counts every garrison but the leader, who never fights at the gate',
    async (districtId, leader) => {
      const { me } = await makeWorld();
      const { repos } = me.app;
      const district = findDistrict(districtId)!;
      for (const location of district.locations) repos.city.control(location.id);
      const standing = repos.city.control(leader.locationId)!.garrison;
      expect(standing[leader.unitId] ?? 0, 'the leader is on his plot').toBeGreaterThan(0);
      const everybody = district.locations.reduce(
        (total, location) => total + armySize(repos.city.control(location.id)!.garrison),
        0,
      );

      const looked = groundBehind(repos, repos.bases.findById(me.baseId)!, {
        kind: 'gate',
        districtId,
      });

      if (looked.kind !== 'ground') throw new Error(`refused: ${looked.reason}`);
      expect(looked.ground.army[leader.unitId]).toBeUndefined();
      expect(armySize(looked.ground.army)).toBe(everybody - (standing[leader.unitId] ?? 0));
    },
  );
});

/**
 * The officer side of spying is the chair's grade alone (maintainer, 2026-10-01): "spy bonuses
 * from the officer should only come based on his grade", and the same rule for defence. A crew of
 * 90s on every spy skill, the rungs that used to pay spying finished (three of the six, the Head of
 * Security's, went with the chair rework on 2026-10-04), adds nothing on either side; a perk
 * still does.
 */
describe('spy bonuses from the grade alone', () => {
  const OLD_SPY_RUNGS = ['tech_field_debriefs', 'tech_underground_routes', 'tech_citation_index'];

  it('reads no rating and no rung on either side, and a perk on both', async () => {
    const { me, rival } = await makeWorld();
    hire(me, 90);
    theirWhispers(me, rival, 90);
    teach(me, ...OLD_SPY_RUNGS);
    teach(rival, ...OLD_SPY_RUNGS);
    theirPress(me, rival, { razors: 20 });
    const ground = () => {
      const looked = groundBehind(me.app.repos, me.app.repos.bases.findById(me.baseId)!, PRESS);
      if (looked.kind !== 'ground' || looked.ground.counter.kind !== 'crew') {
        throw new Error('a crew holds the Press');
      }
      return looked.ground.counter;
    };
    const strength = () =>
      spyStrengthFor(me.app.repos, me.app.repos.bases.findById(me.baseId)!, 'loose_ears');
    expect(strength().chairPoints).toBeGreaterThan(50);
    expect(strength().intelPercent).toBe(0);
    expect(ground().intelResistancePercent).toBe(0);

    // A perk on each chair: Street Ears is 8 spy points, Paper Shredder 15 against.
    const perk = (stack: Stack, id: string) => {
      const base = stack.app.repos.bases.findById(stack.baseId)!;
      stack.app.repos.bases.updateCommanders(
        base.id,
        base.commanders.map((officer) =>
          officer.role === 'master_of_whispers' ? { ...officer, perks: [id] } : officer,
        ),
      );
    };
    perk(me, 'street_ears');
    perk(rival, 'paper_shredder');
    expect(strength().intelPercent).toBe(8);
    expect(ground().intelResistancePercent).toBe(15);
  });
});

/**
 * The holder's other officers guard its ground a little (maintainer, 2026-10-01): their Signals and
 * Cryptography, averaged, move the counter score from -10% at 1 to toward +25%, through nothing at
 * 30. Only officers seated and working, and never the Master of Whispers, whose sheet is their
 * grade on the other side of the line.
 */
describe("the holder's other officers", () => {
  const officer = (id: string, role: Commander['role'], rating: number): Commander =>
    createCommander(
      id,
      id,
      role,
      makeAttributes(50, { signals: rating, cryptography: rating }),
      [],
    );
  const seat = (stack: Stack, me: Stack, officers: Commander[]) => {
    const theirs = me.app.repos.bases.findById(stack.baseId)!;
    me.app.repos.bases.updateCommanders(stack.baseId, [
      ...theirs.commanders.filter((one) => one.role === 'master_of_whispers'),
      ...officers,
    ]);
  };
  const counterOf = (me: Stack) => {
    const looked = groundBehind(me.app.repos, me.app.repos.bases.findById(me.baseId)!, PRESS);
    if (looked.kind !== 'ground' || looked.ground.counter.kind !== 'crew') {
      throw new Error('a crew holds the Press');
    }
    return looked.ground.counter;
  };

  // The Overseer is in the room for this since 2026-10-04: at the break-even on this fixture.
  it('reads nothing with nobody but the Master of Whispers and an even Overseer', async () => {
    const { me, rival } = await makeWorld();
    hire(me, 60);
    theirWhispers(me, rival, 5);
    theirPress(me, rival, { razors: 20 });
    seat(rival, me, []);
    expect(counterOf(me).officersPercent).toBe(0);
  });

  it('counts the Overseer with the officers', async () => {
    const { me, rival } = await makeWorld();
    hire(me, 60);
    theirWhispers(me, rival, 60);
    theirPress(me, rival, { razors: 20 });
    seat(rival, me, []);
    overseerSpyGuardAt(me.app, rival.baseId, 90);
    expect(counterOf(me).officersPercent).toBeGreaterThan(20);
    overseerSpyGuardAt(me.app, rival.baseId, 1);
    expect(counterOf(me).officersPercent).toBeCloseTo(-10, 0);
  });

  it('takes 10% off a room of 1s and adds toward 25% for a room of 90s', async () => {
    const { me, rival } = await makeWorld();
    hire(me, 60);
    theirWhispers(me, rival, 60);
    theirPress(me, rival, { razors: 20 });
    overseerSpyGuardAt(me.app, rival.baseId, 1);
    seat(rival, me, [officer('a', 'salvager', 1), officer('b', 'veteran', 1)]);
    const weak = counterOf(me);
    expect(weak.officersPercent).toBeCloseTo(-10, 0);
    overseerSpyGuardAt(me.app, rival.baseId, 30);
    seat(rival, me, [officer('a', 'salvager', 30)]);
    expect(Math.abs(counterOf(me).officersPercent)).toBeLessThan(1.5);
    overseerSpyGuardAt(me.app, rival.baseId, 90);
    seat(rival, me, [officer('a', 'salvager', 90), officer('b', 'veteran', 90)]);
    const strong = counterOf(me);
    expect(strong.officersPercent).toBeGreaterThan(20);
    expect(strong.officersPercent).toBeLessThan(25);
    // The same chair and gate on both: the people alone moved the score.
    expect(counterScore(strong)).toBeGreaterThan(counterScore(weak));
  });

  it('leaves out the bench, the injured and the Master of Whispers', async () => {
    const { me, rival } = await makeWorld();
    hire(me, 60);
    theirWhispers(me, rival, 100);
    theirPress(me, rival, { razors: 20 });
    const later = new Date(Date.now() + 86_400_000).toISOString();
    seat(rival, me, [
      officer('working', 'salvager', 30),
      officer('benched', null, 100),
      { ...officer('hurt', 'veteran', 100), injuredUntil: later },
    ]);
    // Only the working Salvager is read: 30 and his lift, so close to nothing, where the
    // Master of Whispers' 100s, the bench and the bed would have made it +20% and more.
    expect(counterOf(me).officersPercent).toBeLessThan(5);
  });
});

/**
 * The holder's Master of Whispers defends (maintainer, 2026-10-01): "a master of whispers in
 * defense with same grade ... cancels out a spying master of whispers with equivalent strength".
 */
describe("the holder's Master of Whispers", () => {
  it('cancels an equal chair exactly, so the cheapest tier reads nothing', async () => {
    const { me, rival } = await makeWorld();
    hire(me, 60);
    theirWhispers(me, rival, 60);
    theirPress(me, rival, { razors: 20 });
    const reader = me.app.repos.bases.findById(me.baseId)!;
    const looked = groundBehind(me.app.repos, reader, PRESS);
    if (looked.kind !== 'ground') throw new Error(`refused: ${looked.reason}`);
    const strength = spyStrengthFor(me.app.repos, reader, 'loose_ears');
    expect(strength.chairPoints).toBeGreaterThan(0);
    const counter = looked.ground.counter;
    if (counter.kind !== 'crew') throw new Error('a crew holds the Press');
    // Chair for chair, so what is left of the budget is the bonuses on each side and nothing else.
    expect(counter.whispersChairPoints).toBe(strength.chairPoints);
    expect(spyScore(strength) - counterScore(counter)).toBeCloseTo(
      strength.intelPercent - counter.intelResistancePercent,
      9,
    );

    await spy(me, PRESS, 'loose_ears');
    windBack(me);
    settleSpying(me.app.repos, new Date());
    expect(me.app.repos.spying.reportsFor(me.baseId, 1)[0]!.failed).toBe(true);
  });

  it('defends nothing from the bench, and the same job reads the place', async () => {
    const { me, rival } = await makeWorld();
    hire(me, 60);
    theirWhispers(me, rival, 60);
    const theirs = me.app.repos.bases.findById(rival.baseId)!;
    me.app.repos.bases.updateCommanders(
      rival.baseId,
      theirs.commanders.map((officer) =>
        officer.role === 'master_of_whispers' ? { ...officer, role: null } : officer,
      ),
    );
    theirPress(me, rival, { razors: 20 });
    await spy(me, PRESS, 'loose_ears');
    windBack(me);
    settleSpying(me.app.repos, new Date());
    expect(me.app.repos.spying.reportsFor(me.baseId, 1)[0]!.failed).toBe(false);
  });
});

describe('the printed figures', () => {
  it('stores the accuracy and the unseen estimate rounded, never the exact count', async () => {
    const { me, rival } = await makeWorld();
    hire(me, 60);
    teach(me, SPY_WRITTEN_RESEARCH_ID, SPY_ACCURACY_RESEARCH_ID, SPY_ESTIMATE_RESEARCH_ID);
    // Cheap Razors the budget reads and Ghosts it mostly does not, so the read is partial.
    theirPress(me, rival, { razors: 33, ghosts: 41 });
    await spy(me, PRESS, 'loose_ears');
    windBack(me);
    settleSpying(me.app.repos, new Date());

    const report = me.app.repos.spying.reportsFor(me.baseId, 1)[0]!;
    expect(report.failed).toBe(false);
    const seen = armySize(report.exposed);
    expect(seen).toBeLessThan(74);
    expect(report.accuracy).toBe(roughAccuracy(seen / 74));
    expect(report.accuracy).not.toBe(seen / 74);
    expect(report.unseen).toBe(roughUnseen(74 - seen));
  });
});

describe('who is told', () => {
  /** One look at the Press, home and settled. The chair is S+, so with the rung nothing is seen. */
  async function look(me: Stack): Promise<void> {
    await spy(me, PRESS, 'loose_ears');
    windBack(me);
    settleSpying(me.app.repos, new Date());
  }

  it('names the player to the holder on every job before Traffic Analysis', async () => {
    const { me, rival } = await makeWorld();
    hire(me, 100);
    theirPress(me, rival, { razors: 20 });
    await look(me);

    const told = bell(rival, 'spied_on');
    expect(told).toHaveLength(1);
    expect(told[0]!.title).toMatch(/watcher/);
    // Who and where, and nothing about what they counted.
    expect(told[0]!.body).not.toMatch(/unit slots/);
    const report = me.app.repos.spying.reportsFor(me.baseId, 1)[0]!;
    expect(report.foundOut).toBe(true);
    expect(me.app.repos.feats.tallies(me.baseId).spy_jobs_unnoticed ?? 0).toBe(0);
  });

  // Review, 2026-10-02: the holder whose ground it was when they looked, whatever happens after.
  it('tells the crew that held the ground when the runners looked, not whoever holds it later', async () => {
    const { me, rival } = await makeWorld();
    hire(me, 100);
    theirPress(me, rival, { razors: 20 });
    await spy(me, PRESS, 'loose_ears');
    const run = me.app.repos.spying.activeFor(me.baseId)[0]!;
    me.db
      .prepare('UPDATE spy_runs SET departed_at = ?')
      .run(new Date(Date.now() - 1_000 - run.travelMinutes * 60_000).toISOString());
    expect(snapshotSpying(me.app.repos, new Date())).toBe(1);

    // The rival loses the Press while the runners walk home.
    const press = me.app.repos.city.control('steelbelt-press')!;
    me.app.repos.city.put({ ...press, holder: { kind: 'unoccupied' }, garrison: {} });
    windBack(me);
    settleSpying(me.app.repos, new Date());

    expect(bell(rival, 'spied_on')).toHaveLength(1);
  });

  it('after Traffic Analysis, an S+ chair is never seen, and nobody hears anything', async () => {
    const { me, rival } = await makeWorld();
    hire(me, 100);
    teach(me, SPY_QUIET_RESEARCH_ID);
    theirPress(me, rival, { razors: 20 });

    await look(me);
    expect(bell(rival, 'spied_on')).toHaveLength(0);
    expect(me.app.repos.spying.reportsFor(me.baseId, 1)[0]!.foundOut).toBe(false);
    expect(me.app.repos.feats.tallies(me.baseId).spy_jobs_unnoticed).toBe(1);
  });

  it('after Traffic Analysis, an F- chair is still seen every time', async () => {
    const { me, rival } = await makeWorld();
    hire(me, 0);
    teach(me, SPY_QUIET_RESEARCH_ID);
    theirPress(me, rival, {});
    await look(me);
    await look(me);
    expect(bell(rival, 'spied_on')).toHaveLength(2);
  });
});

describe('turning them round', () => {
  it('walks them home without a report, and the caps stay spent', async () => {
    const { me, rival } = await makeWorld();
    hire(me);
    openTier(me, 'bought_eyes');
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
    expect(recalled.json<CityMutationResponse>().district.spyRuns[0]?.recalledAt).not.toBeNull();
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

/**
 * The Master of Whispers' track as the maintainer redid it (2026-09-28): what the rungs open and
 * what a report says without them.
 */
describe("the chair's track", () => {
  it('refuses a tier until its rung is in, and takes no caps for the refusal', async () => {
    const { me, rival } = await makeWorld();
    hire(me);
    theirPress(me, rival, { razors: 20 });
    const before = caps(me);
    for (const tier of [
      'paid_whisper',
      'bought_eyes',
      'network_compromise',
      'total_intelligence',
    ] as const) {
      const refused = await spy(me, PRESS, tier);
      expect(refused.statusCode, tier).toBe(400);
      expect(refused.json<{ error: { message: string } }>().error.message).toMatch(/tier/);
    }
    expect(caps(me)).toBe(before);

    teach(me, SPY_PAID_TIERS_RESEARCH_ID);
    expect((await spy(me, PRESS, 'bought_eyes')).statusCode).toBe(200);
    // ...and the district read says which tiers are open, so the picker can shut the rest.
    const district = (
      await me.app.inject({ method: 'GET', url: '/api/city/steelbelt', headers: auth(me.token) })
    ).json<DistrictDetailResponse>();
    expect(district.spyTiersOpen).toEqual(['loose_ears', 'paid_whisper', 'bought_eyes']);
    expect(district.spyParties).toBe(1);
  });

  it('sends a second party with Two Sets of Eyes, and turns either round by name', async () => {
    const { me, rival } = await makeWorld();
    hire(me);
    teach(me, 'tech_two_sets_of_eyes');
    theirPress(me, rival, { razors: 20 });
    const gate = {
      kind: 'gate',
      districtId: me.app.repos.bases.findById(rival.baseId)!.districtId,
    } as const;

    expect((await spy(me, PRESS)).statusCode).toBe(200);
    const second = await spy(me, gate);
    expect(second.statusCode, second.body.slice(0, 200)).toBe(200);
    const runs = second.json<CityMutationResponse>().district.spyRuns;
    expect(runs).toHaveLength(2);
    expect(second.json<CityMutationResponse>().district.spyParties).toBe(2);
    // Two is the cap.
    expect((await spy(me, PRESS)).statusCode).toBe(400);

    const gateRun = runs.find((run) => run.target.kind === 'gate')!;
    const recalled = await me.app.inject({
      method: 'POST',
      url: '/api/city/spy/recall',
      headers: auth(me.token),
      payload: { runId: gateRun.id },
    });
    expect(recalled.statusCode, recalled.body.slice(0, 200)).toBe(200);
    const after = me.app.repos.spying.activeFor(me.baseId);
    expect(after.find((run) => run.id === gateRun.id)?.recalledAt).not.toBeNull();
    expect(after.find((run) => run.id !== gateRun.id)?.recalledAt).toBeNull();
  });

  /** Maintainer, 2026-10-05: one job per place, whatever parties are free. */
  it('sends no second party to a place one is already on its way to', async () => {
    const { me, rival } = await makeWorld();
    hire(me);
    teach(me, 'tech_two_sets_of_eyes');
    theirPress(me, rival, { razors: 20 });
    expect((await spy(me, PRESS)).statusCode).toBe(200);

    const again = await spy(me, PRESS);
    expect(again.statusCode).toBe(400);
    expect(again.body).toContain('Your runners are already on their way there');
    expect(me.app.repos.spying.activeFor(me.baseId)).toHaveLength(1);

    // The second party is free for anywhere else.
    const gate = {
      kind: 'gate',
      districtId: me.app.repos.bases.findById(rival.baseId)!.districtId,
    } as const;
    expect((await spy(me, gate)).statusCode).toBe(200);
  });

  it('counts unit slots and names nobody before Written Reports', async () => {
    const { me, rival } = await makeWorld();
    hire(me, 100);
    theirPress(me, rival, { razors: 20, scrapers: 5 });
    await spy(me, PRESS);
    windBack(me);
    settleSpying(me.app.repos, new Date());

    const report = me.app.repos.spying.reportsFor(me.baseId, 1)[0]!;
    expect(report.failed).toBe(false);
    expect(report.unitsShown).toBe(false);
    // Sent empty rather than hidden by the screen: the slots are the whole report.
    expect(report.exposed).toEqual({});
    expect(report.exposedSlots).toBe(unitSlotsUsed({ razors: 20, scrapers: 5 }));
    // Still a report that learnt something, for the ladder that counts them.
    expect(me.app.repos.feats.tallies(me.baseId).spy_reports).toBe(1);
    expect(bell(me, 'spy_report')[0]!.body).toMatch(/unit slots seen/);

    teach(me, SPY_WRITTEN_RESEARCH_ID);
    await spy(me, PRESS);
    windBack(me);
    settleSpying(me.app.repos, new Date());
    const written = me.app.repos.spying.reportsFor(me.baseId, 1)[0]!;
    expect(written.unitsShown).toBe(true);
    expect(written.exposed).toEqual({ razors: 20, scrapers: 5 });
  });

  it('prints the exact slots from The Whole Wire, a failed job included, and drops the estimate', async () => {
    const { me, rival } = await makeWorld();
    hire(me, 10);
    teach(me, SPY_ESTIMATE_RESEARCH_ID, SPY_WHOLE_WIRE_RESEARCH_ID, SPY_WRITTEN_RESEARCH_ID);
    theirWhispers(me, rival, 100);
    // A Specter is in no report, this figure included.
    theirPress(me, rival, { razors: 40, the_specter: 1 });
    await spy(me, PRESS, 'loose_ears');
    windBack(me);
    settleSpying(me.app.repos, new Date());

    const report = me.app.repos.spying.reportsFor(me.baseId, 1)[0]!;
    expect(report.failed).toBe(true);
    expect(report.exposed).toEqual({});
    expect(report.totalSlots).toBe(unitSlotsUsed({ razors: 40 }));
    expect(report.unseen).toBeNull();
  });
});

/**
 * The Master of Whispers programme, rung by rung (bug pass, 2026-10-01): what the chair has to be
 * doing for a job to go and to be read, and on whose clock.
 */
describe('the chair at work', () => {
  const HOUR = 3_600_000;

  /** Put `role` in hospital until `until`. */
  function injure(stack: Stack, role: 'master_of_whispers', until: Date): void {
    const base = stack.app.repos.bases.findById(stack.baseId)!;
    stack.app.repos.bases.updateCommanders(
      base.id,
      base.commanders.map((officer) =>
        officer.role === role ? { ...officer, injuredUntil: until.toISOString() } : officer,
      ),
    );
  }

  /** Swap this crew's Master of Whispers for one at `rating` on every attribute. */
  function reseat(stack: Stack, rating: number): void {
    const base = stack.app.repos.bases.findById(stack.baseId)!;
    stack.app.repos.bases.updateCommanders(base.id, [
      ...base.commanders.filter((officer) => officer.role !== 'master_of_whispers'),
      createCommander('spy-2', 'Swap', 'master_of_whispers', makeAttributes(rating), []),
    ]);
  }

  it('reads the job on the chair as it was at the send, whoever sits there at the settle', async () => {
    const { me, rival } = await makeWorld();
    hire(me, 100);
    // With Traffic Analysis an S+ chair is never seen and an F- one always is: the sharpest
    // reading of which chair the report was written on.
    teach(me, SPY_QUIET_RESEARCH_ID);
    theirPress(me, rival, { razors: 20 });
    expect((await spy(me, PRESS)).statusCode).toBe(200);
    // Swapped for the worst officer there is while the runners are out (maintainer, 2026-10-01:
    // "freeze at send").
    reseat(me, 0);
    settleSpying(me.app.repos, new Date(Date.now() + 12 * HOUR));

    const report = me.app.repos.spying.reportsFor(me.baseId, 1)[0]!;
    expect(report.foundOut, 'the report was read on the chair at the settle').toBe(false);
    expect(report.exposedSlots).toBe(unitSlotsUsed({ razors: 20 }));
  });

  it('gives a job sent on a poor chair nothing from a better one seated after it left', async () => {
    const { me, rival } = await makeWorld();
    hire(me, 10);
    // A defender the poor chair cannot read past and the good one reads through.
    theirWhispers(me, rival, 60);
    theirPress(me, rival, { razors: 40 });
    expect((await spy(me, PRESS)).statusCode).toBe(200);
    reseat(me, 100);
    settleSpying(me.app.repos, new Date(Date.now() + 12 * HOUR));

    expect(me.app.repos.spying.reportsFor(me.baseId, 1)[0]!.failed).toBe(true);
  });

  it('reads a run sent before the freeze off the chair at the settle', async () => {
    const { me, rival } = await makeWorld();
    hire(me, 100);
    teach(me, SPY_QUIET_RESEARCH_ID);
    theirPress(me, rival, { razors: 20 });
    expect((await spy(me, PRESS)).statusCode).toBe(200);
    me.db.prepare('UPDATE spy_runs SET chair_points = NULL, intel_percent = NULL').run();
    reseat(me, 0);
    settleSpying(me.app.repos, new Date(Date.now() + 12 * HOUR));

    expect(me.app.repos.spying.reportsFor(me.baseId, 1)[0]!.foundOut).toBe(true);
  });

  it("reads the holder's Master of Whispers at the tick that settles the job", async () => {
    const { me, rival } = await makeWorld();
    // A chair that reads forty Razors with nobody against it, and not past their chair at 100.
    hire(me, 60);
    theirPress(me, rival, { razors: 40 });
    theirWhispers(me, rival, 100);
    expect((await spy(me, PRESS)).statusCode).toBe(200);
    // In bed now, back at work by the tick, and nothing gets by them.
    injure(rival, 'master_of_whispers', new Date(Date.now() + HOUR));
    settleSpying(me.app.repos, new Date(Date.now() + 12 * HOUR));

    expect(me.app.repos.spying.reportsFor(me.baseId, 1)[0]!.failed).toBe(true);
  });

  it('refuses a hurt chair in words that do not call it empty', async () => {
    const { me, rival } = await makeWorld();
    hire(me);
    theirPress(me, rival, { razors: 20 });
    injure(me, 'master_of_whispers', new Date(Date.now() + HOUR));
    const refused = await spy(me, PRESS);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: { message: string } }>().error.message).toMatch(/hurt/);
  });

  it('turns round the job still inside its tenth when none is named', async () => {
    const { me, rival } = await makeWorld();
    hire(me);
    teach(me, 'tech_two_sets_of_eyes');
    theirPress(me, rival, { razors: 20 });
    const gate = {
      kind: 'gate',
      districtId: me.app.repos.bases.findById(rival.baseId)!.districtId,
    } as const;
    expect((await spy(me, PRESS)).statusCode).toBe(200);
    // The first job left six hours ago and is past its tenth; the second has just gone.
    me.db
      .prepare('UPDATE spy_runs SET departed_at = ?')
      .run(new Date(Date.now() - 6 * HOUR).toISOString());
    expect((await spy(me, gate)).statusCode).toBe(200);

    const recalled = await me.app.inject({
      method: 'POST',
      url: '/api/city/spy/recall',
      headers: auth(me.token),
      payload: {},
    });
    expect(recalled.statusCode, recalled.body.slice(0, 200)).toBe(200);
    const out = me.app.repos.spying.activeFor(me.baseId);
    expect(out.find((run) => run.target.kind === 'gate')?.recalledAt).not.toBeNull();
    expect(out.find((run) => run.target.kind === 'location')?.recalledAt).toBeNull();
  });
});
