import {
  CITY_DISTRICTS,
  MAX_ATTRIBUTE,
  MIN_SCALED_SUCCESS,
  MISC_AREA_ID,
  RESEARCH_UNLED_FREE,
  RESEARCH_UNLED_PENALISED,
  UNLED_PENALTY,
  areasOffering,
  battleTierFor,
  composeProfile,
  createCommander,
  findMissionTemplate,
  leaningsFor,
  makeAttributes,
  missionCompletesAt,
  missionOdds,
  missionBoardKey,
  missionOffers,
  scaledSuccessChance,
  templateTimings,
  type Army,
  type Attributes,
  type Base,
  type Mission,
  type MissionTemplate,
  type MissionsResponse,
  type Overseer,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { MISSION_HISTORY_LIMIT } from '../db/repos/missions.js';
import { removeForce } from '../battle/forces.js';
import { launchMission } from './launch.js';
import { resolveDueMissions } from './resolve.js';
import { fightMissionBattle } from './battle.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';

/**
 * Who leads a run, and what a battle job does to the crew that goes (maintainer, 2026-09-10).
 *
 * `missions.test.ts` next door is about clocks, pay and slots and sends the Overseer on
 * everything. This file is about the two rules that replaced §G6: the bench the wire hands over,
 * and what happens at the settle when the job is a fight.
 */

const PASSWORD = 'hunter2pass';
const T0 = new Date('2026-08-13T12:00:00.000Z');
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

interface Stack {
  app: FastifyInstance;
  repos: Repositories;
  base: Base;
  token: string;
  overseer: Overseer;
  userId: string;
}

async function makeStack(username = 'leader'): Promise<Stack> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: PASSWORD },
  });
  const { token, user } = registered.json<{ token: string; user: { id: string } }>();
  const chosen = await chooseOverseer(app, token);
  /*
   * The same character every run.
   *
   * A battle job is fought with the crew's own book since 2026-09-16 (perks, held ground,
   * cohesion), and `chooseOverseer` draws from the pool, so an unpinned world fought each run with
   * a different set of signature perks. The fights below are pinned on a seed and were not pinned
   * on a *person*, which is the same A/B-with-two-worlds trap `battle/gate-intel.test.ts` names:
   * the assertion that a won fight still costs somebody sat a hair from zero and tipped over it
   * about one run in eight.
   */
  pinOverseer(app, token);

  const repos = createRepositories(db);
  // Read back *after* the pin, not off the choose response: the sheet every assertion below
  // compares against has to be the one the server is actually holding.
  const chosenId = chosen.json<{ overseer: Overseer }>().overseer.id;
  const overseer = repos.overseers.findById(chosenId);
  if (!overseer) throw new Error('no character to lead with');

  const minted = repos.bases.findByOwnerId(user.id);
  if (!minted) throw new Error('no base');
  repos.bases.updateArmy(minted.id, { razors: 80, wardens: 20, haulers: 20 }, minted.trainingQueue);
  for (const district of CITY_DISTRICTS) {
    repos.city.markScouted(minted.id, district.id, new Date().toISOString());
  }
  const base = repos.bases.findByOwnerId(user.id);
  if (!base) throw new Error('no base');
  return { app, repos, base, token, overseer, userId: user.id };
}

/** What this crew has researched about going out with nobody in charge. */
function teach(stack: Stack, ...technologies: string[]): void {
  const base = stack.repos.bases.findById(stack.base.id);
  if (!base) throw new Error('no base');
  stack.repos.bases.updateResearch(base.id, { ...base.research, technologies });
}

function withOfficer(stack: Stack, id = 'off-1', name = 'Halvard Nyx'): string {
  const existing = stack.repos.bases.findById(stack.base.id)?.commanders ?? [];
  const officer = createCommander(id, name, 'field_commander');
  stack.repos.bases.updateCommanders(stack.base.id, [...existing, officer]);
  return officer.id;
}

/**
 * Any standard job on a board right now, so these tests never settle a fight by accident.
 *
 * Keyed through `missionBoardKey` rather than off the day, because the two boards no longer turn
 * over together: `misc` carries an hourly slot as well (`MISC_BOARD_ROTATION_MINUTES`), so a
 * fixture that asked the day for a misc job picked one off a board the route was not offering
 * and every launch here came back `That job is not on offer there`.
 */
/**
 * The contested districts nobody holds end to end on the first day (maintainer, 2026-09-21).
 *
 * Every other one starts behind an armed gate, and the four residential districts are plots and
 * post no work at all, so a helper that walked the whole catalogue would hand a launch an area
 * the route refuses. `missions/board.test.ts` is what holds this pair to the city as authored.
 */
const OPEN_ON_DAY_ONE = ['chrome-row', 'glasshouse-fields'];

function aJobToday(): { template: MissionTemplate; areaId: string } {
  const now = new Date();
  // Misc, then the districts that actually post work. A residential district is somebody's plot
  // and a Combine district starts behind an armed gate (maintainer, 2026-09-21), so a walk over
  // every district in the catalogue would, on a day the misc board deals no standard job, pick
  // an area the launch route refuses, and the refusal would read as a fault in the thing under
  // test. Chrome Row and the Glasshouse Fields are the two that are open from the first day.
  for (const areaId of [MISC_AREA_ID, ...OPEN_ON_DAY_ONE]) {
    const template = missionOffers(areaId, missionBoardKey(areaId, now)).find(
      (entry) => entry.kind === 'standard',
    );
    if (template) return { template, areaId };
  }
  throw new Error(`no standard job on any board at ${now.toISOString()}`);
}

async function board(stack: Stack): Promise<MissionsResponse> {
  const res = await stack.app.inject({
    method: 'GET',
    url: '/api/missions',
    headers: auth(stack.token),
  });
  expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
  return res.json<MissionsResponse>();
}

async function launch(stack: Stack, extra: Record<string, unknown> = {}) {
  const { template, areaId } = aJobToday();
  return stack.app.inject({
    method: 'POST',
    url: '/api/missions',
    headers: auth(stack.token),
    payload: { templateId: template.id, areaId, force: { razors: 1 }, ...extra },
  });
}

describe('the bench the board hands over', () => {
  it('puts the Overseer first, then the books, with nobody out', async () => {
    const stack = await makeStack();
    withOfficer(stack);
    const { leaders, unledRule } = await board(stack);

    expect(leaders[0]?.id).toBe(stack.overseer.id);
    expect(leaders[0]?.kind).toBe('overseer');
    expect(leaders[0]?.attributes).toEqual(stack.overseer.attributes);
    expect(leaders[1]?.kind).toBe('officer');
    expect(leaders[1]?.name).toBe('Halvard Nyx');
    expect(leaders.map((leader) => leader.held)).toEqual([null, null]);
    expect(leaders.map((leader) => leader.heldUntil)).toEqual([null, null]);
    // Nothing researched yet, so a crew cannot go out on its own at all.
    expect(unledRule).toBe('forbidden');
  });

  it('says a leader is held by a run, for the Overseer as much as for an officer', async () => {
    const stack = await makeStack();
    const officerId = withOfficer(stack);

    const led = await launch(stack, { leaderId: officerId });
    expect(led.statusCode, led.body.slice(0, 200)).toBe(200);
    const missionId = led.json<{ mission: Mission }>().mission.id;

    const withOfficerOut = await board(stack);
    const out = withOfficerOut.leaders.find((l) => l.id === officerId);
    expect(out?.held).toBe('run');
    // And the mark they are free at: the run's own return, not a flag the screen has to time.
    const row = stack.repos.missions.findById(missionId)?.mission;
    if (!row) throw new Error('the run went missing');
    expect(out?.heldUntil).toBe(missionCompletesAt(row).toISOString());
    expect(withOfficerOut.leaders[0]?.held).toBeNull();
    // The row says who it was, and the Overseer's half of that is its own column.
    expect(row.officerId).toBe(officerId);
    expect(row.overseerLed).toBe(false);
  });

  /**
   * A run that has fallen off the history page is still a run somebody is out on.
   *
   * `GET /missions` answers with the most recent {@link MISSION_HISTORY_LIMIT} rows, newest first,
   * and the bench used to be read off that page. A day-long job with two hundred short ones
   * launched after it is off the end of it, so the board said its leader was free while the launch
   * refused them with a 409: two doors on the same rule, disagreeing. The bench is read off the
   * active runs themselves now, which is a bound the game sets rather than the screen.
   */
  it('keeps a leader out even when their run has scrolled off the history page', async () => {
    const stack = await makeStack('longhaul');
    const led = await launch(stack, { leaderId: stack.overseer.id });
    expect(led.statusCode, led.body.slice(0, 200)).toBe(200);
    const running = led.json<{ mission: Mission }>().mission;

    // Enough finished work, all of it launched after theirs, to push the running row off the page.
    for (let index = 0; index <= MISSION_HISTORY_LIMIT; index += 1) {
      stack.repos.missions.insert({
        mission: {
          ...running,
          id: `history-${String(index).padStart(4, '0')}`,
          startedAt: new Date(Date.parse(running.startedAt) + (index + 1) * 60_000).toISOString(),
          overseerLed: false,
          status: 'resolved',
          outcome: 'success',
          resolvedAt: new Date(Date.parse(running.startedAt) + (index + 2) * 60_000).toISOString(),
        },
        seed: index,
        successChance: 0.5,
      });
    }

    const { leaders } = await board(stack);
    expect(leaders[0]?.kind).toBe('overseer');
    expect(leaders[0]?.held).toBe('run');
  });

  it('shows the Overseer out on the run they are leading', async () => {
    const stack = await makeStack();
    const led = await launch(stack, { leaderId: stack.overseer.id });
    expect(led.statusCode, led.body.slice(0, 200)).toBe(200);
    const mission = led.json<{ mission: Mission }>().mission;

    expect(mission.overseerLed).toBe(true);
    expect(mission.officerId).toBeNull();
    expect((await board(stack)).leaders[0]?.held).toBe('run');
  });
});

describe('what a card carries about the odds', () => {
  it('quotes the authored chance at this crew\u2019s level, and what the job leans on', async () => {
    const stack = await makeStack('carder');
    // Level 4, so the scaled figure and the authored one differ: at level 1 they are equal and a
    // card that quoted the raw template would pass this test without doing anything.
    stack.repos.bases.updateProgression(stack.base.id, 4, { xpIntoLevel: 0 });

    const { areas, unledRule: rule } = await board(stack);
    expect(rule).toBe('forbidden');
    const offers = areas.flatMap((area) => area.offers);
    expect(offers.length).toBeGreaterThan(0);
    for (const offer of offers) {
      const template = findMissionTemplate(offer.templateId) as MissionTemplate;
      expect(offer.authoredChance, offer.templateId).toBeCloseTo(
        scaledSuccessChance(template.successChance, 4),
        10,
      );
      expect(offer.authoredChance, offer.templateId).toBeLessThan(template.successChance);
      expect(offer.leanings, offer.templateId).toEqual(leaningsFor(template));
      expect(offer.battleTier, offer.templateId).toBe(battleTierFor(template));
      expect(offer.kind === 'battle', offer.templateId).toBe(offer.battleTier !== null);
    }
  });

  /**
   * The floor is where a card and a launch are most easily made to disagree.
   *
   * `scaledSuccessChance` takes half a point off per level and stops at `MIN_SCALED_SUCCESS`, so
   * high up the board every job quotes the same figure and any reader still working off the raw
   * template diverges from the one that is not. The card and the row go through the same function
   * with the same crew figure, so the needle and the frozen odds land on the same number there too.
   */
  it('quotes the floored figure, and freezes the odds the card was reading', async () => {
    const stack = await makeStack('floored');
    stack.repos.bases.updateProgression(stack.base.id, 200, { xpIntoLevel: 0 });

    const { areas } = await board(stack);
    const area = areas.find((entry) => entry.offers.length > 0);
    const offer = area?.offers[0];
    if (!area || !offer) throw new Error('no board offers anything today');
    expect(offer.authoredChance, 'the floor is not biting, so this measures nothing').toBe(
      MIN_SCALED_SUCCESS,
    );

    const sent = await stack.app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(stack.token),
      payload: {
        templateId: offer.templateId,
        areaId: area.id,
        force: { razors: 1 },
        leaderId: stack.overseer.id,
      },
    });
    expect(sent.statusCode, sent.body.slice(0, 200)).toBe(200);

    const expected = missionOdds({
      authored: offer.authoredChance,
      leader: stack.overseer.attributes,
      profile: composeProfile(offer.leanings),
      unled: 'forbidden',
    });
    const stored = stack.repos.missions.findById(sent.json<{ mission: Mission }>().mission.id);
    expect(stored?.successChance).toBe(expected.chance);
    // The control: the Overseer moved it, so this is not two ways of writing the same floor.
    expect(expected.edge).not.toBe(0);
  });

  it('reads the unled rule off the two rungs', async () => {
    const stack = await makeStack('ruled');
    teach(stack, RESEARCH_UNLED_PENALISED);
    expect((await board(stack)).unledRule).toBe('penalised');
    teach(stack, RESEARCH_UNLED_PENALISED, RESEARCH_UNLED_FREE);
    expect((await board(stack)).unledRule).toBe('free');
  });
});

describe('the launch', () => {
  it('refuses a leader who is already out on a run', async () => {
    const stack = await makeStack();
    const first = await launch(stack, { leaderId: stack.overseer.id });
    expect(first.statusCode, first.body.slice(0, 200)).toBe(200);

    // A second area, so the one-job-per-area rule is not what refuses this, and an area that is
    // actually open, so the shut-gate rule is not either: this test is about the leader and both
    // of the others answer with a 409 of their own.
    const at = new Date();
    const other = OPEN_ON_DAY_ONE.find(
      (id) => missionOffers(id, missionBoardKey(id, at)).length > 0,
    );
    if (!other) throw new Error('no second board today');
    const offer = missionOffers(other, missionBoardKey(other, at))[0];
    if (!offer) throw new Error('no offer on the second board');

    const again = await stack.app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(stack.token),
      payload: {
        templateId: offer.id,
        areaId: other,
        force: { razors: 1 },
        leaderId: stack.overseer.id,
      },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json<{ error: { message: string } }>().error.message).toBe(
      `${stack.overseer.name} is out leading a run`,
    );
  });

  it('frees a leader whose crew lands on this very request', async () => {
    const stack = await makeStack('homecoming');
    // A run of the Overseer's that is long overdue: the settle this launch does first brings it
    // home, and the person who led it is free again on the same request.
    const home = planted(
      stack,
      findMissionTemplate('scrap-run') as MissionTemplate,
      { razors: 1 },
      2,
      {},
      {
        kind: 'overseer',
        id: stack.overseer.id,
        attributes: stack.overseer.attributes,
      },
    );

    /*
     * Each board keyed the way the *server* keys it (`missionBoardKey`), which for the misc board
     * is a day plus an hourly slot since 2026-09-19 and for a district is the bare day.
     *
     * This read `missionBoardDay` for all of them, so whenever the crew's home area was not the
     * misc board this picked misc and then asked for the job yesterday's key offered, which the
     * route answers with "That job is not on offer there". It passed only when the home area
     * happened to be misc.
     */
    const now = new Date();
    // Only boards a launch is accepted on: misc and the districts open on the first day. The
    // walk over every district used to land on a Combine one, which is refused since 2026-09-21.
    const elsewhere = [MISC_AREA_ID, ...OPEN_ON_DAY_ONE]
      .filter((areaId) => areaId !== home.areaId)
      .map((areaId) => ({ areaId, offer: missionOffers(areaId, missionBoardKey(areaId, now))[0] }))
      .find((entry) => entry.offer !== undefined);
    if (!elsewhere?.offer) throw new Error('no second board today');

    const again = await stack.app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(stack.token),
      payload: {
        templateId: elsewhere.offer.id,
        areaId: elsewhere.areaId,
        force: { razors: 1 },
        leaderId: stack.overseer.id,
      },
    });
    expect(again.statusCode, again.body.slice(0, 200)).toBe(200);
  });

  it('refuses an unled run until the crew has written down how to run one', async () => {
    const stack = await makeStack();
    const refused = await launch(stack);
    expect(refused.statusCode).toBe(409);
    const { error } = refused.json<{ error: { code: string; message: string } }>();
    expect(error.code).toBe('MISSION_NEEDS_OFFICER');
    // The refusal names the way out of it rather than being a wall.
    expect(error.message).toContain('Written Orders');
  });

  it('lets an unled crew go once, at a cost to the odds, and then for nothing', async () => {
    const { template } = aJobToday();
    const authored = scaledSuccessChance(template.successChance, 1);

    const penalised = await makeStack('penalised');
    teach(penalised, RESEARCH_UNLED_PENALISED);
    const docked = await launch(penalised);
    expect(docked.statusCode, docked.body.slice(0, 200)).toBe(200);
    const dockedRow = penalised.repos.missions.findById(
      docked.json<{ mission: Mission }>().mission.id,
    );
    expect(dockedRow?.successChance).toBeCloseTo(authored - UNLED_PENALTY, 10);

    const free = await makeStack('free');
    teach(free, RESEARCH_UNLED_PENALISED, RESEARCH_UNLED_FREE);
    const whole = await launch(free);
    expect(whole.statusCode, whole.body.slice(0, 200)).toBe(200);
    const wholeRow = free.repos.missions.findById(whole.json<{ mission: Mission }>().mission.id);
    expect(wholeRow?.successChance).toBeCloseTo(authored, 10);
  });

  it('freezes exactly what the shared model priced, leader and all', async () => {
    const stack = await makeStack();
    const { template } = aJobToday();
    const led = await launch(stack, { leaderId: stack.overseer.id });
    expect(led.statusCode, led.body.slice(0, 200)).toBe(200);

    const stored = stack.repos.missions.findById(led.json<{ mission: Mission }>().mission.id);
    const expected = missionOdds({
      authored: scaledSuccessChance(template.successChance, stack.base.level),
      leader: stack.overseer.attributes,
      profile: composeProfile(leaningsFor(template)),
      unled: 'forbidden',
    });
    expect(stored?.successChance).toBe(expected.chance);
    // The control: the Overseer moved it, so this is not two ways of writing the authored figure.
    expect(expected.edge).not.toBe(0);
  });

  it('still refuses a leader nobody has heard of', async () => {
    const stack = await makeStack();
    const refused = await launch(stack, { leaderId: 'nobody-at-all' });
    expect(refused.statusCode).toBe(404);
  });
});

/** Puts a run on the books that is already overdue, so the next settle has to deal with it. */
function planted(
  stack: Stack,
  template: MissionTemplate,
  force: Army,
  seed: number,
  vehicles: Record<string, number> = {},
  /** Who is at the head of it, for the tests about what that is worth at the settle. */
  leader?: { kind: 'overseer' | 'officer'; id: string; attributes: Attributes },
  /** When they left. `T0` is long past, so a test about a crew still on the road names its own. */
  startedAt: Date = T0,
): Mission {
  const base = stack.repos.bases.findById(stack.base.id);
  if (!base) throw new Error('no base');
  const stored = launchMission({
    id: `run-${seed}-${template.id}`,
    base,
    template,
    // Misc, then a district open on the first day: `areasOffering` still lists districts the
    // Combine holds whole, and a run planted there is refused at the launch (2026-09-22).
    areaId:
      [MISC_AREA_ID, ...OPEN_ON_DAY_ONE].find((id) =>
        areasOffering(template.id, new Date()).includes(id),
      ) ?? MISC_AREA_ID,
    force,
    vehicles,
    now: startedAt,
    seed,
    unled: 'free',
    leader,
  });
  stack.repos.missions.insert(stored);
  // The roster moves with the row, the way the launch route moves it: a crew that is out is not at
  // home, and without this the survivors merge back into an army they never left.
  stack.repos.bases.updateArmy(base.id, removeForce(base.army, force), base.trainingQueue);
  return stored.mission;
}

const after = (template: MissionTemplate) =>
  new Date(T0.getTime() + (templateTimings(template).totalMinutes + 1) * 60_000);

const total = (army: Army) => Object.values(army).reduce((sum, count) => sum + count, 0);

/** The first seed at which this crew is wiped out at this job. */
function seedThatWipes(force: Army, jobName: string): number {
  for (let seed = 1; seed < 200; seed += 1) {
    const fought = fightMissionBattle({
      seed,
      jobName,
      force,
      vehicles: {},
      tier: 'siege',
      level: 1,
      anyRide: false,
    });
    if (total(fought.home) === 0) return seed;
  }
  throw new Error('no seed wipes this crew out');
}

describe('a battle job is a fight', () => {
  const skirmish = findMissionTemplate('convoy-ambush') as MissionTemplate;
  const siege = findMissionTemplate('refinery-assault') as MissionTemplate;

  it('pays a crew that held the field, and only the dead stay out there', async () => {
    const stack = await makeStack('victors');
    const force: Army = { razors: 80, wardens: 20 };
    /*
     * The siege tier, and a force sized so holding the field still costs somebody.
     *
     * This was sixty razors and twenty wardens against `convoy-ambush`, which the pinned crew
     * won without a scratch: `total(home.lost)` was zero and the assertion below had nothing to
     * measure. The rule under test is what a *won* fight does to the roster, so the fixture has
     * to be a fight rather than a walkover.
     *
     * Retuned again on 2026-09-19, when the Wardens moved from `ballistic` to `blunt` damage and
     * thirty-six and twelve stopped winning at all (0 of 12 seeds). This is the crew's **whole**
     * fighting stock, which is the most the fixture can send: `makeStack` mints 80 razors, 20
     * wardens and 20 haulers, and asking for more than that sends a force the crew does not have
     * and leaves the roster arithmetic below short.
     *
     * At full stock the siege is genuinely close: a sweep of the first twenty seeds holds the
     * field on fourteen of them and loses somebody on every one. Seed 3, which this test already
     * used, is one of the fourteen. A fixture this near a balance edge will move again, and the
     * number to reach for is the one a sweep says works rather than a nudge.
     */
    const mission = planted(stack, siege, force, 3);

    const settled = resolveDueMissions(
      stack.repos,
      stack.repos.bases.findById(stack.base.id)!,
      after(siege),
    );
    const home = settled.resolved[0];
    if (!home) throw new Error('nothing settled');

    expect(home.outcome).toBe('success');
    expect(home.reported).toBe(true);
    expect(Object.keys(home.rewards).length).toBeGreaterThan(0);
    // The roster is the force less the dead, and the row says who those were.
    const roster = stack.repos.bases.findById(stack.base.id)!.army;
    expect(total(roster)).toBe(total({ razors: 80, wardens: 20, haulers: 20 }) - total(home.lost));
    expect(total(home.lost), 'a fight nobody paid for measures nothing').toBeGreaterThan(0);
    expect(mission.lost).toEqual({});
  });

  it('brings the beaten home without the ones who did not get out', async () => {
    const stack = await makeStack('beaten');
    // Enough of them that a mauling leaves somebody. Twelve against a siege tier used to leave a
    // handful and now does not: the crew fights a battle job with its own book from 2026-09-16
    // (perks, held ground, cohesion), which moves the fight, and a dozen against the hardest tier
    // in the game is inside the noise either way. The rule under test is what happens to the
    // survivors, so the fixture has to have some.
    const force: Army = { razors: 40 };
    planted(stack, siege, force, 5);

    const settled = resolveDueMissions(
      stack.repos,
      stack.repos.bases.findById(stack.base.id)!,
      after(siege),
    );
    const home = settled.resolved[0];
    if (!home) throw new Error('nothing settled');

    expect(home.outcome).toBe('failure');
    expect(total(home.lost)).toBeGreaterThan(0);
    expect(total(home.lost)).toBeLessThan(total(force));
    expect(home.reported).toBe(true);
    // The survivors are back on the roster: 80 razors less the twelve sent, plus what came back.
    const roster = stack.repos.bases.findById(stack.base.id)!.army;
    expect(roster.razors).toBe(80 - (home.lost.razors ?? 0));
  });

  it('sends whoever led the run into the fight with them', async () => {
    const force: Army = { razors: 9 };
    const alone = await makeStack('unled_fight');
    const led = await makeStack('led_fight');
    // A sheet at the ceiling, so the direction is not in doubt: a middling Overseer is one more
    // unit in the line and can cost a fight as easily as win it, which is the honest model but a
    // coin flip to assert on.
    const sheet = makeAttributes(MAX_ATTRIBUTE);
    led.repos.overseers.updateAttributes(led.overseer.id, sheet);
    planted(alone, skirmish, force, 4);
    planted(
      led,
      skirmish,
      force,
      4,
      {},
      { kind: 'overseer', id: led.overseer.id, attributes: sheet },
    );

    const settle = (stack: Stack) =>
      resolveDueMissions(stack.repos, stack.repos.bases.findById(stack.base.id)!, after(skirmish))
        .resolved[0];
    const withoutOne = settle(alone);
    const withOne = settle(led);
    if (!withoutOne || !withOne) throw new Error('nothing settled');

    // The same job, the same seed, the same nine units: the only difference is the person at the
    // front, and the row's casualty list is where that shows up. Which way it moves is pinned in
    // `enemy.test.ts` on a fight balanced for it; what this file is about is that the row's leader
    // reaches the engine at all, which is `leaderOf`'s whole job.
    expect(withOne.lost).not.toEqual(withoutOne.lost);
  });

  /**
   * A crew turned around never reached the ground, so there is nobody there to fight.
   *
   * The settle reads the tier off the template, and a recalled row has to skip that: a battle job
   * that fought on the way home would kill people for a trip the player cancelled. The other half
   * is the bench, which must not free the leader the moment the order is given: they are on the
   * road, and the road is what the return leg is.
   */
  it('turns a battle job around without a fight, and keeps its leader out until they are home', async () => {
    const stack = await makeStack('recalled_fight');
    const officerId = withOfficer(stack);
    const before = stack.repos.bases.findById(stack.base.id)!.army;
    const force: Army = { razors: 12 };
    /*
     * A minute ago, rather than at `T0` or on this very millisecond.
     *
     * `T0` is long past, and the recall route refuses a crew whose clock has already run out: they
     * are at the gate. A crew that left *now* is the other knife edge: the walk home is however far
     * from home they are, so a recall in the same millisecond as the launch puts them home in zero
     * minutes and the settle in that same request brings them in, which made the assertion below
     * fail about a third of the time on a fast machine. A minute out is a minute's walk back.
     */
    const left = new Date(Date.now() - 60_000);
    const mission = planted(
      stack,
      siege,
      force,
      5,
      {},
      {
        kind: 'officer',
        id: officerId,
        attributes: stack.repos.bases.findById(stack.base.id)!.commanders[0]!.attributes,
      },
      left,
    );

    const recalled = await stack.app.inject({
      method: 'POST',
      url: '/api/missions/recall',
      headers: auth(stack.token),
      payload: { missionId: mission.id },
    });
    expect(recalled.statusCode, recalled.body.slice(0, 200)).toBe(200);
    // The order is given, the crew is still walking: the person leading them is still out.
    const { leaders } = recalled.json<MissionsResponse>();
    expect(leaders.find((one) => one.id === officerId)?.held).toBe('run');

    const settled = resolveDueMissions(
      stack.repos,
      stack.repos.bases.findById(stack.base.id)!,
      new Date(left.getTime() + (templateTimings(siege).totalMinutes + 1) * 60_000),
    );
    const home = settled.resolved[0];
    if (!home) throw new Error('nothing settled');
    expect(home.outcome).toBe('failure');
    expect(home.lost, 'a run nobody went on cannot kill anybody').toEqual({});
    expect(home.reported).toBe(true);
    // Everybody who left is back, which is the whole of what a recall costs.
    expect(stack.repos.bases.findById(stack.base.id)!.army).toEqual(before);
    expect((await board(stack)).leaders.find((one) => one.id === officerId)?.held).toBeNull();
  });

  it('pays nothing at all for a crew nobody came back from, and says so', async () => {
    const stack = await makeStack('wiped');
    const force: Army = { razors: 1 };
    const seed = seedThatWipes(force, siege.name);
    const before = stack.repos.bases.findById(stack.base.id)!.resources;
    planted(stack, siege, force, seed, { motorcycle: 1 });
    stack.repos.bases.updateFleet(stack.base.id, {});

    const settled = resolveDueMissions(
      stack.repos,
      stack.repos.bases.findById(stack.base.id)!,
      after(siege),
    );
    const home = settled.resolved[0];
    if (!home) throw new Error('nothing settled');

    expect(home.outcome).toBe('failure');
    expect(home.reported).toBe(false);
    expect(home.lost).toEqual(force);
    expect(home.rewards).toEqual({});
    expect(home.spoils).toEqual({});
    expect(home.pageWon).toBeNull();
    // Nothing banked: not the pay, not the XP, not the reputation.
    expect(stack.repos.bases.findById(stack.base.id)!.resources).toEqual(before);
    expect(settled.base.progression.xpIntoLevel).toBe(stack.base.progression.xpIntoLevel);
    // §C3: the machine they rode out on is gone with them.
    expect(stack.repos.bases.findById(stack.base.id)!.fleet.motorcycle ?? 0).toBe(0);

    const bell = stack.repos.social
      .notifications(stack.userId, 50)
      .filter((note) => note.kind === 'mission_home');
    expect(bell[0]?.body).toBe(`Nobody came back from ${siege.name}`);
  });
});

/**
 * §E5: a battle job is a fight, so it is fought with everything a fight is fought with.
 *
 * `fightMissionBattle` was handed a force, a tier and a leader, and nothing else: no territory, no
 * cohesion, no medicine, no salvage refund and no infamy multiplier. So the one mission kind that
 * kills people was the one fight in the game a crew fought bare. Every assertion below is about a
 * channel that pays a declared battle and paid nothing here.
 */
describe('what a battle job is fought with', () => {
  const siegeJob = findMissionTemplate('refinery-assault') as MissionTemplate;

  /** Runs one job to its settlement with the crew's fold as the caller left it. */
  const runJob = async (
    username: string,
    prepare: (stack: Stack) => void,
    template: MissionTemplate = siegeJob,
  ) => {
    const stack = await makeStack(username);
    // Both worlds are the same person. Which of the thirty characters an account is offered is a
    // hash of a UUID minted at registration, and every one of them carries a signature perk loud
    // enough to decide a fight, so two worlds drawing differently would put the draw in the
    // difference these tests measure. Caught in the act: this file passed alone and failed in the
    // full suite, on a run where one crew killed nine and the other ten.
    pinOverseer(stack.app, stack.token);
    prepare(stack);
    planted(stack, template, { razors: 40 }, 5);
    const settled = resolveDueMissions(
      stack.repos,
      stack.repos.bases.findById(stack.base.id)!,
      after(template),
    );
    const home = settled.resolved[0];
    if (!home) throw new Error('nothing settled');
    return { stack, home, settled };
  };

  /** Holds one location for this crew, which is how a real bonus gets onto the fold. */
  const hold = (stack: Stack, locationId: string): void => {
    const control = stack.repos.city.control(locationId);
    if (!control) throw new Error(`fixture: no control row for ${locationId}`);
    stack.repos.city.put({ ...control, holder: { kind: 'crew', baseId: stack.base.id } });
  };

  it('fights it with the crew fold, so held ground changes the outcome', async () => {
    // A fight the crew can hold, because that is where toughness shows: on a siege they are
    // overrun either way and what decides who dies is the rout roll.
    const winnable = findMissionTemplate('convoy-ambush') as MissionTemplate;
    const bare = await runJob('bare_job', () => {}, winnable);
    const backed = await runJob(
      'backed_job',
      (stack) => {
        // Ground that pays into the fight rather than into the economy: the Quiet Ward is
        // `unit_offense` and Saint Ferrous is `unit_vitality` (`city/locations.ts`). Holding a
        // Scrapyard or a kennel would have proved nothing, because neither writes a combat channel.
        hold(stack, 'datavault-sigma-ward');
        hold(stack, 'chrome-row-ferrous');
      },
      winnable,
    );
    expect(
      total(backed.home.lost),
      'a crew holding half a district fought exactly as well as one holding nothing',
    ).not.toBe(total(bare.home.lost));
  });

  /**
   * §D8: "a percentage more infamy off everything that earns any", which included this and did not.
   *
   * The Graveyard and `sig_name_maker` write `infamyGainPercent`, the declared-battle settler spent
   * it, and the mission settler banked the raw figure. The same forty units killed paid one number
   * on a raid and a smaller one on a job.
   *
   * The direction is what is pinned, not the ratio: holding ground puts a crew's whole fold into
   * the fight as well (see the test above it), so the two runs do not kill exactly the same number
   * of people and the exact multiple is not a figure this fixture can hold still. Deleting the
   * multiplier collapses the two to the same number, which is the control.
   */
  it('pays the crew’s infamy multiplier on what the job killed', async () => {
    const banked = async (username: string, holds: boolean) => {
      const { stack, home } = await runJob(username, (one) => {
        if (holds) hold(one, 'combine-spire-martyrs');
      });
      return { delta: stack.repos.bases.findById(stack.base.id)!.economy.infamy, home };
    };
    const plain = await banked('plain_name', false);
    const named = await banked('named_crew', true);

    expect(plain.delta, 'the job killed nobody, so there is no name to scale').toBeGreaterThan(0);
    expect(
      named.delta,
      'the Graveyard paid nothing on the one mission kind that earns a name',
    ).toBeGreaterThan(plain.delta);
  });

  it('gets the medics onto the winner’s dead, and the Bone Market onto the losses', async () => {
    const graveyard = 'rustyard-bones';
    const plain = await runJob('plain_job', () => {});
    const kitted = await runJob('kitted_job', (stack) => hold(stack, graveyard));

    // The Bone Market pays a share of what was lost, on a job as on a raid.
    const caps = (stack: Stack): number =>
      stack.repos.bases.findById(stack.base.id)!.resources.caps;
    expect(total(plain.home.lost), 'nobody died, so nothing can be refunded').toBeGreaterThan(0);
    expect(
      caps(kitted.stack),
      'the Bone Market paid nothing for the people who did not come back',
    ).toBeGreaterThan(caps(plain.stack));
  });
});
