import {
  MISC_AREA_ID,
  MAX_ATTRIBUTE,
  OVERSEER_PRESETS,
  UNLED_PENALTY,
  composeProfile,
  createCommander,
  findMissionTemplate,
  itemsInTrack,
  leaningsFor,
  makeAttributes,
  missionOdds,
  scaledSuccessChance,
  startingEconomy,
  startingProgression,
  startingResearch,
  type Attributes,
  type Base,
  type Commander,
  type Overseer,
  type OverseerPreset,
  type ResearchResponse,
  type MissionTemplate,
  type ResearchState,
  type UnledRule,
  startingTraining,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { launchMission } from '../missions/launch.js';
import { settleResearch } from './settle.js';
import { startResearch } from './start.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * Research at the seam the browser actually touches: the two routes, end to end over a real
 * database, and what the Overseer is worth at the head of a run.
 *
 * The ladder itself is asserted in `packages/shared/src/research/tracks.test.ts` and the score-side
 * rules in `tracks.test.ts` next door. What only this file can say is that a rung started over HTTP
 * lands on the read that comes after its clock, and that the desk's route is gone.
 *
 * §F5 used to be here as `overseerMissionEdge`, a ±15% nudge off Speed and Stealth. Who leads a
 * run is a general rule now (`missions.leading.ts`) and the Overseer goes through it like anybody
 * else; what is left to check on this side is that the launch freezes what the shared model said
 * rather than working it out again.
 */

const NOW = new Date('2026-08-13T09:00:00.000Z');
const MINUTE_MS = 60_000;

const [firstPreset] = OVERSEER_PRESETS;
if (!firstPreset) throw new Error('expected an overseer preset');
const PRESET: OverseerPreset = firstPreset;

function makeOverseer(overrides: Partial<Overseer> = {}): Overseer {
  return {
    id: 'ov-1',
    name: PRESET.name,
    archetype: PRESET.archetype,
    portraitId: PRESET.portraitId,
    bio: PRESET.bio,
    attributes: PRESET.attributes,
    perks: PRESET.perks,
    ...overrides,
  };
}

function makeBase(overrides: Partial<Base> = {}): Base {
  return {
    id: 'base-1',
    ownerId: 'user-1',
    name: 'Test Hold',
    districtId: 'neon-docks',
    level: 1,
    isBot: false,
    resources: {
      caps: 500_000,
      supplies: 9000,
      oil: 9000,
      scrap: 500_000,
      highQualityMetal: 9000,
      planks: 9000,
    },
    economy: startingEconomy(NOW.toISOString()),
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [],
    buildQueue: [],
    army: {},
    trainingQueue: [],
    training: startingTraining('2026-08-16T00:00:00.000Z'),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [],
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

/** A repository double: research writes through three calls and the tests assert on what landed. */
function fakeRepos(): {
  repos: Parameters<typeof settleResearch>[0];
  written: { research?: ResearchState; level?: number; xpIntoLevel?: number };
} {
  const written: { research?: ResearchState; level?: number; xpIntoLevel?: number } = {};
  const repos = {
    bases: {
      updateResearch: (_id: string, research: ResearchState) => {
        written.research = research;
      },
      updateResources: () => undefined,
      updateEconomy: () => undefined,
      // §I1: a finished rung pays the player, and `awardPlayerXp` is the only writer of
      // `Base.level`. Captured, so the XP tests below can read it.
      updateProgression: (_id: string, level: number, progression: { xpIntoLevel: number }) => {
        written.level = level;
        written.xpIntoLevel = progression.xpIntoLevel;
      },
      // §I2's durable marker (migration 0083): `awardPlayerXp` merges a crossing into it so a
      // settle nobody can answer for still gets announced later. Nothing here asserts on it.
      pendingLevelUp: () => undefined,
      setPendingLevelUp: () => undefined,
      updateDistrict: () => undefined,
    },
    overseers: { updateAttributes: () => undefined },
    // A rung's clock is cut by the crew's standing as well as by the Lab. These doubles answer
    // "no ground, nobody", so the tests below stay about the rung.
    city: { controls: () => new Map() },
    users: { findById: () => undefined },
    // ...and at no table: the cards a faction deals are folded into the same standing.
    factions: { membershipOf: () => undefined },
  } as unknown as Parameters<typeof settleResearch>[0];
  return { repos, written };
}

/** Two chairs good enough for anything, so the tests below are never about a mark. */
function chairs(track: Commander['role']): Commander[] {
  return [
    createCommander('track', 'Track Officer', track, makeAttributes(95)),
    createCommander('head', 'Head', 'head_of_research', makeAttributes(95)),
  ];
}

/** Starts `techId` and runs the clock past its end, returning what the settlement produced. */
function runToCompletion(base: Base, overseer: Overseer, techId: string) {
  const { repos } = fakeRepos();
  const started = startResearch(repos, {
    base,
    project: { kind: 'technology', techId },
    id: 'r-1',
    now: NOW,
  });
  if (started.kind !== 'started') throw new Error(`refused: ${started.reason}`);
  const after = new Date(NOW.getTime() + started.active.durationMinutes * MINUTE_MS);
  return {
    minutes: started.active.durationMinutes,
    ...settleResearch(repos, started.base, overseer, after),
  };
}

const MEDIC_RUNGS = itemsInTrack('chief_medic');
const FIRST_MEDIC = MEDIC_RUNGS[0];
const LAST_MEDIC = MEDIC_RUNGS[MEDIC_RUNGS.length - 1];
if (!FIRST_MEDIC || !LAST_MEDIC) throw new Error('the medic track has no rungs');

describe('§F3: Charisma turns a finished rung into allegiance XP', () => {
  const base = () => makeBase({ commanders: chairs('chief_medic') });

  it('pays a charismatic Overseer more than a dour one for the same rung', () => {
    const bright = runToCompletion(
      base(),
      makeOverseer({ attributes: makeAttributes(10, { charisma: 100 }) }),
      FIRST_MEDIC.id,
    );
    const dour = runToCompletion(
      base(),
      makeOverseer({ attributes: makeAttributes(10, { charisma: 0 }) }),
      FIRST_MEDIC.id,
    );
    expect(bright.awards).toHaveLength(1);
    expect(bright.awards[0]!.xpGained).toBeGreaterThan(dour.awards[0]!.xpGained);
  });
});

/**
 * The third clock, and the third call site.
 *
 * `PLAYER_XP_AWARDS` calls research "the longest single commitment in the game", and it paid a flat
 * 150 whether the rung ran forty-five minutes or twelve hours. Asserted as the ratio between two
 * rungs rather than as a figure, because the settlement also adds the Overseer's charisma on top
 * and that is a different rule this test has no business pinning.
 */
describe('a rung pays XP off its own clock (§I1)', () => {
  const overseer = makeOverseer();

  it('pays the tenth rung of a track more than the first', () => {
    const shallow = runToCompletion(
      makeBase({ commanders: chairs('chief_medic') }),
      overseer,
      FIRST_MEDIC.id,
    );
    const deep = runToCompletion(
      makeBase({
        commanders: chairs('chief_medic'),
        research: {
          ...startingResearch(),
          technologies: MEDIC_RUNGS.slice(0, -1).map((spec) => spec.id),
        },
      }),
      overseer,
      LAST_MEDIC.id,
    );

    expect(deep.minutes).toBeGreaterThan(shallow.minutes);
    const shallowXp = shallow.awards[0]!.xpGained;
    const deepXp = deep.awards[0]!.xpGained;
    expect(deepXp).toBeGreaterThan(shallowXp);
    // The curve, not a step: twice the clock is roughly 2^0.8 of the pay.
    expect(deepXp / shallowXp).toBeCloseTo((deep.minutes / shallow.minutes) ** 0.8, 0);
  });
});

describe('the Overseer leads a run like anybody else (maintainer, 2026-09-10)', () => {
  const battle = findMissionTemplate('foundry-raid');
  const standard = findMissionTemplate('scrap-run');
  if (!battle || !standard) throw new Error('expected both mission kinds on the board');

  /** The odds the shared model says a run goes out with, restated from its own inputs. */
  function odds(template: MissionTemplate, leader: Attributes | null, unled: UnledRule) {
    return missionOdds({
      authored: scaledSuccessChance(template.successChance, 1),
      leader,
      profile: composeProfile(leaningsFor(template)),
      unled,
    });
  }

  it('freezes what the leader was worth onto the row, not a second arithmetic', () => {
    const base = makeBase();
    const sharp = makeOverseer({
      attributes: makeAttributes(10, {
        leadership: MAX_ATTRIBUTE,
        strategy: MAX_ATTRIBUTE,
        toughness: MAX_ATTRIBUTE,
      }),
    });
    const args = { areaId: MISC_AREA_ID, force: { razors: 1 }, unled: 'free' as const };
    const led = launchMission({
      id: 'm',
      base,
      template: battle,
      now: NOW,
      leader: { kind: 'overseer', id: sharp.id, attributes: sharp.attributes },
      ...args,
    });
    expect(led.successChance).toBe(odds(battle, sharp.attributes, 'free').chance);
    // A raid wants somebody who can hold a line, and this one can: it is worth more than the
    // authored figure, which is the whole reason the player is asked who goes.
    expect(led.successChance).toBeGreaterThan(battle.successChance);
  });

  it('takes the unled penalty off a crew that went out on its own', () => {
    const base = makeBase();
    const args = { areaId: MISC_AREA_ID, force: { razors: 1 } };
    const free = launchMission({
      id: 'm',
      base,
      template: standard,
      now: NOW,
      ...args,
      unled: 'free',
    });
    const docked = launchMission({
      id: 'm',
      base,
      template: standard,
      now: NOW,
      ...args,
      unled: 'penalised',
    });
    expect(free.successChance).toBe(scaledSuccessChance(standard.successChance, 1));
    expect(docked.successChance).toBeCloseTo(free.successChance - UNLED_PENALTY, 10);
  });

  it('reads the same for an officer as for the Overseer, on the same sheet', () => {
    const base = makeBase();
    const sheet = makeAttributes(40);
    const asOverseer = launchMission({
      id: 'm',
      base,
      template: battle,
      now: NOW,
      areaId: MISC_AREA_ID,
      force: { razors: 1 },
      unled: 'free',
      leader: { kind: 'overseer', id: 'ov-1', attributes: sheet },
    });
    const asOfficer = launchMission({
      id: 'm',
      base,
      template: battle,
      now: NOW,
      areaId: MISC_AREA_ID,
      force: { razors: 1 },
      unled: 'free',
      leader: { kind: 'officer', id: 'off-1', attributes: sheet },
    });
    expect(asOfficer.successChance).toBe(asOverseer.successChance);
    // Which of the two it was is still on the row: the Overseer is not on the books.
    expect(asOverseer.mission.overseerLed).toBe(true);
    expect(asOverseer.mission.officerId).toBeNull();
    expect(asOfficer.mission.overseerLed).toBe(false);
    expect(asOfficer.mission.officerId).toBe('off-1');
  });
});

describe('GET /research and POST /research/tech', () => {
  const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

  afterEach(async () => {
    for (const { app, db } of instances.splice(0)) {
      await app.close();
      db.close();
    }
  });

  async function makeApp(): Promise<FastifyInstance> {
    const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
    const db = openDatabase(config.databasePath);
    runMigrations(db);
    const app = await buildApp({ config, db, logger: false });
    instances.push({ app, db });
    return app;
  }

  async function makePlayer(app: FastifyInstance, username: string): Promise<string> {
    const register = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username, password: 'hunter2pass' },
    });
    expect(register.statusCode).toBe(201);
    const token = register.json<{ token: string }>().token;
    const overseer = await chooseOverseer(app, token);
    expect(overseer.statusCode).toBe(201);
    return token;
  }

  function userIdOf(app: FastifyInstance, token: string): string {
    return app.jwt.decode<{ sub: string }>(token)!.sub;
  }

  function baseOf(app: FastifyInstance, token: string) {
    return app.repos.bases.findByOwnerId(userIdOf(app, token))!;
  }

  const read = async (app: FastifyInstance, token: string): Promise<ResearchResponse> => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/research',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    return res.json<ResearchResponse>();
  };

  const startTech = (app: FastifyInstance, token: string, techId: string) =>
    app.inject({
      method: 'POST',
      url: '/api/research/tech',
      headers: { authorization: `Bearer ${token}` },
      payload: { techId },
    });

  it('serves a well-formed page to a crew that has never researched', async () => {
    const app = await makeApp();
    const token = await makePlayer(app, 'researcher');
    const body = await read(app, token);

    expect(body.active).toBeNull();
    expect(body.completesAt).toBeNull();
    expect(body.head, 'a fresh crew has no Head of Research').toBeNull();
    expect(body.tracks.length).toBeGreaterThan(0);
    expect(body.technologies.length).toBe(body.tracks.length * 10);
    expect(body.technologies.every((rung) => !rung.known)).toBe(true);
    expect(body.caps).toBeGreaterThan(0);
  });

  /**
   * The desk's route is gone rather than dormant.
   *
   * A route left registered but unreachable from the page is the failure `BattleRequestSchema` was
   * filed under, so this asserts the door itself is closed.
   */
  it('has no desk route left to post to', async () => {
    const app = await makeApp();
    const token = await makePlayer(app, 'nodesk');
    const res = await app.inject({
      method: 'POST',
      url: '/api/research',
      headers: { authorization: `Bearer ${token}` },
      payload: { kind: 'technology', techId: FIRST_MEDIC.id },
    });
    expect(res.statusCode).toBe(404);
  });

  it('refuses a rung the crew has nobody to run', async () => {
    const app = await makeApp();
    const token = await makePlayer(app, 'nochair');
    const res = await startTech(app, token, FIRST_MEDIC.id);
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('RESEARCH_OPTION_LOCKED');
  });

  it('refuses a rung that does not exist', async () => {
    const app = await makeApp();
    const token = await makePlayer(app, 'nosuch');
    const res = await startTech(app, token, 'tech_nothing_at_all');
    expect(res.statusCode).toBe(404);
  });

  /**
   * The whole feature, on the wire, over a real database.
   *
   * A rung settles lazily on the `GET /research` read, so nothing turns a finished clock into a
   * finished programme unless somebody asks. Started over HTTP, rewound in the row, then read: the
   * settle path is the only thing that can bank it and this is the read that has to prove it did.
   */
  it('runs a rung end to end and banks it on the read path', async () => {
    const app = await makeApp();
    const token = await makePlayer(app, 'trackrunner');
    app.repos.bases.updateCommanders(baseOf(app, token).id, chairs('chief_medic'));

    const started = await startTech(app, token, FIRST_MEDIC.id);
    expect(started.statusCode).toBe(200);
    const running = started.json<ResearchResponse>();
    expect(running.active?.project).toEqual({ kind: 'technology', techId: FIRST_MEDIC.id });
    expect(running.completesAt).not.toBeNull();

    // Mid-flight the page shows it running and the rung is not finished yet.
    const during = await read(app, token);
    expect(during.active?.id).toBe(running.active!.id);
    expect(during.technologies.find((rung) => rung.id === FIRST_MEDIC.id)?.known).toBe(false);

    // A second rung is refused while the bench is busy.
    const busy = await startTech(app, token, MEDIC_RUNGS[1]!.id);
    expect(busy.statusCode).toBe(409);
    expect(busy.json<{ error: { code: string } }>().error.code).toBe('RESEARCH_BUSY');

    const stored = baseOf(app, token);
    const past = new Date(
      NOW.getTime() - stored.research.active!.durationMinutes * MINUTE_MS * 2,
    ).toISOString();
    app.repos.bases.updateResearch(stored.id, {
      active: { ...stored.research.active!, startedAt: past },
      technologies: [],
    });

    const after = await read(app, token);
    expect(after.active, 'the bench is free again').toBeNull();
    expect(after.technologies.find((rung) => rung.id === FIRST_MEDIC.id)?.known).toBe(true);
    expect(baseOf(app, token).research.technologies).toEqual([FIRST_MEDIC.id]);
  });

  /**
   * And it banks on **any** read, not only on the Lab's own screen.
   *
   * `settleResearch` used to be called from these two routes and from nowhere else, which made the
   * Lab the one clock in the game that does not run unless the player is looking at it. A rung
   * finished at 03:00 was still "running" to every other route: the technology it grants was
   * absent from `base.research.technologies`, so the declaration slot, the mission slot, the chair
   * at the Bar and every percentage in the standing fold that rung opens stayed shut until
   * somebody happened to open Research. The `research_done` receipt had the same shape: the bell
   * only rang when the player opened the page it points at.
   */
  it('banks a finished rung on a read of a completely different screen', async () => {
    const app = await makeApp();
    const token = await makePlayer(app, 'elsewhere');
    app.repos.bases.updateCommanders(baseOf(app, token).id, chairs('chief_medic'));

    const started = await startTech(app, token, FIRST_MEDIC.id);
    expect(started.statusCode, started.body.slice(0, 200)).toBe(200);

    const stored = baseOf(app, token);
    const past = new Date(
      Date.now() - stored.research.active!.durationMinutes * MINUTE_MS * 2,
    ).toISOString();
    app.repos.bases.updateResearch(stored.id, {
      active: { ...stored.research.active!, startedAt: past },
      technologies: [],
    });

    // The shell's own poll, which is the read a player makes without meaning to.
    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode, me.body.slice(0, 200)).toBe(200);

    const banked = baseOf(app, token);
    expect(banked.research.active, 'the bench is free').toBeNull();
    expect(banked.research.technologies).toEqual([FIRST_MEDIC.id]);

    // ...and the bell rang on that read rather than waiting for the Lab's own page.
    const userId = userIdOf(app, token);
    const bells = app.repos.social
      .notifications(userId, 50)
      .filter((note) => note.kind === 'research_done');
    expect(bells).toHaveLength(1);

    // Read twice, banked once: the Lab's own screen finds nothing left to do.
    const page = await read(app, token);
    expect(page.active).toBeNull();
    expect(baseOf(app, token).research.technologies).toEqual([FIRST_MEDIC.id]);
    expect(
      app.repos.social.notifications(userId, 50).filter((n) => n.kind === 'research_done'),
    ).toHaveLength(1);
  });

  /**
   * §B8a: the response carries the marks and the derived percentages, and nothing keyed by role id
   * that a reader could invert. Asserted over the real unit rather than over the projection, since
   * a field added to the route and not to the schema still reaches the browser.
   */
  it('puts no raw role knowledge on the wire', async () => {
    const app = await makeApp();
    const token = await makePlayer(app, 'leakcheck');
    app.repos.bases.updateCommanders(baseOf(app, token).id, chairs('chief_medic'));
    const body = await read(app, token);

    expect(Object.keys(body).sort()).toEqual(
      ['active', 'caps', 'completesAt', 'head', 'serverNow', 'technologies', 'tracks'].sort(),
    );
    for (const track of body.tracks) {
      expect(Object.keys(track).sort()).toEqual(
        ['costCutPercent', 'done', 'mark', 'officerName', 'role'].sort(),
      );
    }
  });
});
