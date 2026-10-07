import {
  featMeasureKey,
  MAX_ATTRIBUTE,
  MISC_AREA_ID,
  areasOffering,
  composeProfile,
  covers,
  createCommander,
  findMissionTemplate,
  leaningsFor,
  makeAttributes,
  missionCompletesAt,
  missionOdds,
  missionBoardKey,
  missionOffers,
  templateTimings,
  type Army,
  type Attributes,
  type Base,
  type Grade,
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
import { holdEveryBoard } from '../testing/footholds.js';
import { sureLeader } from '../testing/leader.js';
import { cardFor } from '../testing/card.js';

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
  repos.bases.updateArmy(minted.id, { razors: 80, wardens: 20, haulers: 20 }, minted.musterQueue);
  // A place in every district, so every board is open to the launches below.
  holdEveryBoard(repos, minted.id);
  const base = repos.bases.findByOwnerId(user.id);
  if (!base) throw new Error('no base');
  return { app, repos, base, token, overseer, userId: user.id };
}

/** What this crew has researched. */
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

function aJobToday(level = 1): { template: MissionTemplate; grade: Grade; areaId: string } {
  const now = new Date();
  // Misc, then the districts that actually post work. A residential district is somebody's plot
  // and a Combine district starts behind an armed gate (maintainer, 2026-09-21), so a walk over
  // every district in the catalogue would, on a day the misc board deals no standard job, pick
  // an area the launch route refuses, and the refusal would read as a fault in the thing under
  // test. Chrome Row and the Glasshouse Fields are the two that are open from the first day.
  for (const areaId of [MISC_AREA_ID, ...OPEN_ON_DAY_ONE]) {
    const job = missionOffers(areaId, missionBoardKey(areaId, now), level).find(
      (entry) => entry.template.kind === 'standard',
    );
    if (job) return { template: job.template, grade: job.grade, areaId };
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
  const { template, areaId } = aJobToday(stack.base.level);
  return stack.app.inject({
    method: 'POST',
    url: '/api/missions',
    headers: auth(stack.token),
    payload: {
      templateId: template.id,
      areaId,
      ...cardFor(areaId, template.id, stack.base.level),
      force: { razors: 1 },
      ...extra,
    },
  });
}

describe('the bench the board hands over', () => {
  it('puts the Overseer first, then the books, with nobody out', async () => {
    const stack = await makeStack();
    withOfficer(stack);
    const { leaders } = await board(stack);

    expect(leaders[0]?.id).toBe(stack.overseer.id);
    expect(leaders[0]?.kind).toBe('overseer');
    expect(leaders[0]?.attributes).toEqual(stack.overseer.attributes);
    expect(leaders[1]?.kind).toBe('officer');
    expect(leaders[1]?.name).toBe('Halvard Nyx');
    expect(leaders.map((leader) => leader.held)).toEqual([null, null]);
    expect(leaders.map((leader) => leader.heldUntil)).toEqual([null, null]);
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

    const { leaders, missions } = await board(stack);
    expect(leaders[0]?.kind).toBe('overseer');
    expect(leaders[0]?.held).toBe('run');
    // ...and the run itself is still on the answer, or the screen loses its in-flight row and its
    // recall and counts the crew one short of out (bug pass, 2026-10-02).
    expect(missions.find((one) => one.id === running.id)?.status).toBe('active');
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
  /**
   * The level picks the grades a board deals, and nothing else (maintainer, 2026-09-28).
   *
   * Level forty, so the crew's deal and a new crew's deal differ: a board that dealt at level one
   * whoever read it would agree with a level-one crew by accident. The control below says they do
   * differ on this day.
   */
  it('deals each card at the grade this crew\u2019s level draws, and says what the job leans on', async () => {
    const stack = await makeStack('carder');
    stack.repos.bases.updateProgression(stack.base.id, 40, { xpIntoLevel: 0 });

    const now = new Date();
    const { areas } = await board(stack);
    const dealtAt = (areaId: string, level: number) =>
      missionOffers(areaId, missionBoardKey(areaId, now), level).map((job) => ({
        templateId: job.template.id,
        grade: job.grade,
      }));
    const offers = areas.flatMap((area) => area.offers);
    expect(offers.length).toBeGreaterThan(0);
    let differsFromANewCrew = false;
    for (const area of areas) {
      const quoted = area.offers.map((offer) => ({
        templateId: offer.templateId,
        grade: offer.grade,
      }));
      expect(quoted, area.id).toEqual(dealtAt(area.id, 40));
      if (JSON.stringify(quoted) !== JSON.stringify(dealtAt(area.id, 1))) {
        differsFromANewCrew = true;
      }
    }
    expect(
      differsFromANewCrew,
      'level forty deals what level one does, so this measures nothing',
    ).toBe(true);
    for (const offer of offers) {
      const template = findMissionTemplate(offer.templateId) as MissionTemplate;
      // Only ever a grade the job can be dealt at.
      expect(covers(template, offer.grade), `${offer.templateId} at ${offer.grade}`).toBe(true);
      expect(offer.leanings, offer.templateId).toEqual(leaningsFor(template));
    }
  });

  /**
   * The card and the launch price the same grade.
   *
   * A card dealt above its job's floor, because at the floor a launch that read the job's lowest
   * grade rather than the card's would land on the same number. The control checks the two
   * readings really do differ here. Plain work only: a fight freezes the practice-fight chance
   * (`fightChanceFor`), and which kind of card the clock deals first changes through the day.
   */
  it('freezes the odds the card was reading, at the grade it was dealt', async () => {
    const stack = await makeStack('graded');
    stack.repos.bases.updateProgression(stack.base.id, 40, { xpIntoLevel: 0 });

    const oddsAt = (grade: Grade, leanings: MissionTemplate['leanings']) =>
      missionOdds({
        grade,
        leader: stack.overseer.attributes,
        profile: composeProfile(leanings),
      }).chance;
    const { areas } = await board(stack);
    const picked = areas
      .flatMap((area) => area.offers.map((offer) => ({ area, offer })))
      .find(({ offer }) => {
        if (offer.kind !== 'standard') return false;
        const template = findMissionTemplate(offer.templateId) as MissionTemplate;
        return oddsAt(offer.grade, offer.leanings) !== oddsAt(template.grades[0], offer.leanings);
      });
    if (!picked) throw new Error('no card today is priced apart from its floor');
    const { area, offer } = picked;

    const sent = await stack.app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(stack.token),
      payload: {
        templateId: offer.templateId,
        areaId: area.id,
        boardKey: offer.boardKey,
        grade: offer.grade,
        force: { haulers: 1 },
        leaderId: stack.overseer.id,
      },
    });
    expect(sent.statusCode, sent.body.slice(0, 200)).toBe(200);

    const stored = stack.repos.missions.findById(sent.json<{ mission: Mission }>().mission.id);
    expect(stored?.successChance).toBe(oddsAt(offer.grade, offer.leanings));
    expect(stored?.mission.grade).toBe(offer.grade);
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
      (id) => missionOffers(id, missionBoardKey(id, at), stack.base.level).length > 0,
    );
    if (!other) throw new Error('no second board today');
    const offer = missionOffers(other, missionBoardKey(other, at), stack.base.level)[0]?.template;
    if (!offer) throw new Error('no offer on the second board');

    const again = await stack.app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(stack.token),
      payload: {
        templateId: offer.id,
        areaId: other,
        ...cardFor(other, offer.id, stack.base.level, at),
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
      .map((areaId) => ({
        areaId,
        offer: missionOffers(areaId, missionBoardKey(areaId, now), stack.base.level)[0]?.template,
      }))
      .find((entry) => entry.offer !== undefined);
    if (!elsewhere?.offer) throw new Error('no second board today');

    const again = await stack.app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(stack.token),
      payload: {
        templateId: elsewhere.offer.id,
        areaId: elsewhere.areaId,
        ...cardFor(elsewhere.areaId, elsewhere.offer.id, stack.base.level, now),
        force: { razors: 1 },
        leaderId: stack.overseer.id,
      },
    });
    expect(again.statusCode, again.body.slice(0, 200)).toBe(200);
  });

  /**
   * Every run has a leader (maintainer, 2026-09-28). The two rungs that used to let a crew out
   * with nobody at its head keep their ids on the Right Hand's track and open nothing unled, so a
   * crew that researched both is refused the same as one that researched neither.
   */
  it('refuses a run with nobody at its head, whatever the crew has researched', async () => {
    const stack = await makeStack();
    teach(stack, 'tech_unled_runs', 'tech_unled_runs_free');
    const refused = await launch(stack);
    expect(refused.statusCode).toBe(400);
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
    expect(stack.repos.missions.countActiveByBaseId(stack.base.id)).toBe(0);
  });

  it('freezes exactly what the shared model priced, leader and all', async () => {
    const stack = await makeStack();
    const { template, grade } = aJobToday(stack.base.level);
    const led = await launch(stack, { leaderId: stack.overseer.id });
    expect(led.statusCode, led.body.slice(0, 200)).toBe(200);

    const stored = stack.repos.missions.findById(led.json<{ mission: Mission }>().mission.id);
    const priced = (leader: Attributes) =>
      missionOdds({ grade, leader, profile: composeProfile(leaningsFor(template)) });
    const expected = priced(stack.overseer.attributes);
    expect(stored?.successChance).toBe(expected.chance);
    expect(stored?.mission.grade).toBe(grade);
    // The control: the Overseer's sheet moved it, so this is not two ways of writing one figure.
    expect(expected.chance).not.toBe(priced(makeAttributes(0)).chance);
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
  /**
   * Who is at the head of it. The Overseer by default, which puts the crew's own character in the
   * line of a fight (`leaderOf` reads the row's `overseerLed`, not this sheet).
   */
  leader: { kind: 'overseer' | 'officer'; id: string; attributes: Attributes } = sureLeader(),
  /** When they left. `T0` is long past, so a test about a crew still on the road names its own. */
  startedAt: Date = T0,
  /** The grade the card was dealt: the job's lowest unless a test is about a harder one. */
  grade: Grade = template.grades[0],
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
        areasOffering(template.id, new Date(), base.level).includes(id),
      ) ?? MISC_AREA_ID,
    force,
    vehicles,
    now: startedAt,
    seed,
    leader,
    grade,
  });
  stack.repos.missions.insert(stored);
  // The roster moves with the row, the way the launch route moves it: a crew that is out is not at
  // home, and without this the survivors merge back into an army they never left.
  stack.repos.bases.updateArmy(base.id, removeForce(base.army, force), base.musterQueue);
  return stored.mission;
}

const after = (template: MissionTemplate) =>
  new Date(T0.getTime() + (templateTimings(template).totalMinutes + 1) * 60_000);

const total = (army: Army) => Object.values(army).reduce((sum, count) => sum + count, 0);

/** The first seed at which this crew is wiped out at this job, at this grade. */
function seedThatWipes(force: Army, jobName: string, grade: Grade): number {
  for (let seed = 1; seed < 200; seed += 1) {
    const fought = fightMissionBattle({
      seed,
      jobName,
      force,
      vehicles: {},
      grade,
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
    const force: Army = { razors: 80, wardens: 20, juggernauts: 10 };
    stack.repos.bases.updateArmy(stack.base.id, { ...force, haulers: 20 }, []);
    /*
     * A Siege (B-, the job's floor), and a force sized so holding the field still costs somebody.
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
     * At full stock the siege was genuinely close: a sweep of the first twenty seeds held the
     * field on fourteen of them and lost somebody on every one. A fixture this near a balance edge
     * will move again, and the number to reach for is the one a sweep says works rather than a
     * nudge.
     *
     * It moved on 2026-09-28, when the fight's weight came off the job's grade: a B- fields about
     * 14,700 where the old Fight V at level one fielded 7,900, and the whole stock lost on all of
     * the first twelve seeds. Ten Juggernauts on top, minted for this test alone, hold the field
     * on all twelve and lose between 28 and 47 people doing it. Seed 3 is one of the twelve.
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
    expect(total(roster)).toBe(total({ ...force, haulers: 20 }) - total(home.lost));
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

  /*
   * One officer on the books, leading the same fight job on a sweep of seeds, and what each run
   * lost.
   *
   * The officer rather than the Overseer on purpose: the Overseer's grade lifts every seated
   * officer and their perks reach the crew's fold, so two worlds with two Overseers fight two
   * different fights whether or not the leader reaches the engine, and a comparison would measure
   * nothing. The Overseer is held level instead, at the ceiling in every rating in every world, so
   * whatever differs between the two runs is the officer. (The officer used to sit on the bench for this, which
   * kept them off the fold; the bench leads nothing since 2026-09-28.)
   *
   * A sweep rather than one seed: nine Razors lose this fight under anybody, and the leader moves
   * how many of them get out. On one seed that can come out level, and seed 4 did from 2026-09-29,
   * when intimidation started reaching only 1.5 enemy slots per slot (`INTIMIDATION_REACH`) and a
   * leader's menace stopped carrying a party of nine. Measured then over seeds 1 to 16: the two
   * sheets lose a different number of Razors on 9 of them.
   */
  const LEADER_SEEDS = Array.from({ length: 16 }, (_, at) => at + 1);

  async function lostUnder(username: string, sheet: Attributes): Promise<Army[]> {
    const stack = await makeStack(username);
    stack.repos.overseers.updateAttributes(stack.overseer.id, makeAttributes(MAX_ATTRIBUTE));
    const officer = {
      ...createCommander('off-1', 'Halvard Nyx', 'field_commander'),
      attributes: sheet,
    };
    stack.repos.bases.updateCommanders(stack.base.id, [officer]);
    // Nine Razors for each run.
    const held = stack.repos.bases.findById(stack.base.id)!;
    stack.repos.bases.updateArmy(
      held.id,
      { ...held.army, razors: 9 * LEADER_SEEDS.length },
      held.musterQueue,
    );
    const runs = LEADER_SEEDS.map((seed) =>
      planted(
        stack,
        skirmish,
        { razors: 9 },
        seed,
        {},
        { kind: 'officer', id: officer.id, attributes: sheet },
        T0,
        skirmish.grades.at(-1),
      ),
    );
    const settled = resolveDueMissions(
      stack.repos,
      stack.repos.bases.findById(stack.base.id)!,
      after(skirmish),
    ).resolved;
    return runs.map((run) => {
      const home = settled.find((one) => one.id === run.id);
      if (!home) throw new Error(`${run.id} did not settle`);
      return home.lost;
    });
  }

  it('sends whoever led the run into the fight with them', async () => {
    // The same job, the same seeds, the same nine units: the only difference is the person at the
    // front, and the rows' casualty lists are where that shows up. Which way it moves is pinned in
    // `enemy.test.ts` on a fight balanced for it; what this file is about is that the row's leader
    // reaches the engine at all, which is `leaderOf`'s whole job.
    const weak = await lostUnder('weak_lead', makeAttributes(0));
    const sharp = await lostUnder('sharp_lead', makeAttributes(MAX_ATTRIBUTE));
    const moved = LEADER_SEEDS.filter((_, at) => total(sharp[at]!) !== total(weak[at]!));
    expect(
      moved.length,
      `seeds where the leader moved the dead: ${moved.join(', ')}`,
    ).toBeGreaterThanOrEqual(4);
  });

  /**
   * A crew turned around never reached the ground, so there is nobody there to fight.
   *
   * The settle reads the grade off the row, and a recalled row has to skip the fight: a battle job
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

    const progressBefore = stack.repos.bases.findById(stack.base.id)!.progression;
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
    // And it teaches nothing (bug pass, 2026-09-27): a share of the whole run's XP for turning
    // round made launch-and-recall the fastest way to level.
    expect(settled.base.progression).toEqual(progressBefore);
    // Everybody who left is back, which is the whole of what a recall costs.
    expect(stack.repos.bases.findById(stack.base.id)!.army).toEqual(before);
    expect((await board(stack)).leaders.find((one) => one.id === officerId)?.held).toBeNull();
  });

  it('pays nothing at all for a crew nobody came back from, and says so', async () => {
    const stack = await makeStack('wiped');
    const force: Army = { razors: 1 };
    const seed = seedThatWipes(force, siege.name, siege.grades[0]);
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
 * `fightMissionBattle` was handed a force, a grade and a leader, and nothing else: no territory, no
 * cohesion, no medicine, no salvage refund and no infamy multiplier. So the one mission kind that
 * kills people was the one fight in the game a crew fought bare. Every assertion below is about a
 * channel that pays a declared battle and paid nothing here.
 */
describe('what a battle job is fought with', () => {
  const siegeJob = findMissionTemplate('refinery-assault') as MissionTemplate;
  const convoyJob = findMissionTemplate('convoy-ambush') as MissionTemplate;

  /** Runs one job to its settlement with the crew's fold as the caller left it. */
  const runJob = async (
    username: string,
    prepare: (stack: Stack) => void,
    template: MissionTemplate = siegeJob,
    grade: Grade = template.grades[0],
  ) => {
    const stack = await makeStack(username);
    // Both worlds are the same person. Which of the thirty characters an account is offered is a
    // hash of a UUID minted at registration, and every one of them carries a signature perk loud
    // enough to decide a fight, so two worlds drawing differently would put the draw in the
    // difference these tests measure. Caught in the act: this file passed alone and failed in the
    // full suite, on a run where one crew killed nine and the other ten.
    pinOverseer(stack.app, stack.token);
    prepare(stack);
    planted(stack, template, { razors: 40 }, 5, {}, sureLeader(), T0, grade);
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
    // overrun either way and what decides who dies is the rout roll. At E rather than the job's
    // floor, because forty Razors walk over an E- and lose one either way (measured 2026-09-28).
    const winnable = findMissionTemplate('convoy-ambush') as MissionTemplate;
    const bare = await runJob('bare_job', () => {}, winnable, 'E');
    const backed = await runJob(
      'backed_job',
      (stack) => {
        // Ground that pays into the fight rather than into the economy: the Quiet Ward is
        // `unit_offense` and Saint Ferrous is `unit_vitality` (`city/locations.ts`). Holding a
        // Scrapyard or a kennel would have proved nothing, because neither writes a combat channel.
        hold(stack, 'annexes-ward');
        hold(stack, 'chrome-row-ferrous');
      },
      winnable,
      'E',
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
      const { stack, home } = await runJob(
        username,
        (one) => {
          if (holds) hold(one, 'ccs-martyrs');
        },
        // A fight the crew wins and kills plenty in, so a share of the name is not rounded away:
        // the siege killed two either way once skills stopped reaching the fold (2026-10-04).
        convoyJob,
        'E',
      );
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
    const graveyard = 'bonded-row-rendering';
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
    // ...and what it paid is earned, as a fight's refund is (bug pass, 2026-10-06).
    const earnedCaps = (stack: Stack): number =>
      stack.repos.feats.tallies(stack.base.id)[featMeasureKey('resources_earned', 'caps')] ?? 0;
    expect(earnedCaps(kitted.stack) - earnedCaps(plain.stack)).toBe(
      caps(kitted.stack) - caps(plain.stack),
    );
  });
});
