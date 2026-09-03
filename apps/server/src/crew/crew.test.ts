import {
  crewSheet,
  BENCH_SHARE,
  ATTRIBUTE_NAMES,
  PERK_CATALOG,
  type Commander,
  BUILDING_CATALOG,
  MAX_ATTRIBUTE,
  OVERSEER_SUBJECT,
  RESOURCE_KEYS,
  STARTING_RESOURCES,
  TRAINING_GAIN,
  TRAINING_SECONDS,
  TRAININGS_PER_DAY,
  blurredCount,
  INTEL_PERCENT_PER_GRAIN,
  buildingBuildSeconds,
  buildingCost,
  createCommander,
  MAX_WAGE_DISCOUNT,
  askingWage,
  makeAttributes,
  recoverCasualties,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Base,
  type TrainingResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { queueBuild } from '../district/build.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { crewEffectsFor, crewSheetsFor, standingEffectsFor } from './standing.js';
import { seatedRoles } from './roster.js';

/**
 * The crew layer end to end: the Training tab's rules over HTTP, and a positive control for each
 * place an attribute is supposed to change an outcome.
 *
 * The controls matter more than the rules here. Every one of these effects lands by *adding a
 * term* to a number some other module already computed, which is the single easiest kind of wiring
 * to leave half-connected: the code reads fine, the tests about that module still pass, and the
 * attribute does nothing. So each channel is measured against the same call with a crew that has
 * nothing, and the two are required to differ.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
const dbs: AppDatabase[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
  for (const db of dbs.splice(0)) db.close();
});

async function makeApp(): Promise<FastifyInstance> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  return app;
}

function openStack(): Repositories {
  const db = openDatabase(':memory:');
  dbs.push(db);
  runMigrations(db);
  return createRepositories(db);
}

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

async function signIn(app: FastifyInstance): Promise<string> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'driller', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
  return token;
}

async function board(app: FastifyInstance, token: string): Promise<TrainingResponse> {
  const res = await app.inject({ method: 'GET', url: '/api/training', headers: auth(token) });
  expect(res.statusCode).toBe(200);
  return res.json<TrainingResponse>();
}

async function train(
  app: FastifyInstance,
  token: string,
  subjectId: string,
  attribute: string,
): Promise<ReturnType<FastifyInstance['inject']> extends Promise<infer R> ? R : never> {
  return app.inject({
    method: 'POST',
    url: '/api/training',
    headers: auth(token),
    payload: { subjectId, attribute },
  });
}

describe('the Training tab over HTTP', () => {
  it('opens with the Overseer on it and the whole allowance unspent', async () => {
    const app = await makeApp();
    const view = await board(app, await signIn(app));

    expect(view.sessionsLeft).toBe(TRAININGS_PER_DAY);
    expect(view.perDay).toBe(TRAININGS_PER_DAY);
    const overseer = view.subjects.find((subject) => subject.id === OVERSEER_SUBJECT);
    expect(overseer?.role).toBe('Overseer');
    expect(overseer?.session).toBeNull();
    expect(overseer?.lastAttribute).toBeNull();
  });

  it('puts the Overseer in a session and spends one of the five', async () => {
    const app = await makeApp();
    const token = await signIn(app);

    const res = await train(app, token, OVERSEER_SUBJECT, 'cryptography');
    expect(res.statusCode).toBe(200);
    const view = res.json<TrainingResponse>();
    expect(view.sessionsLeft).toBe(TRAININGS_PER_DAY - 1);
    const overseer = view.subjects.find((subject) => subject.id === OVERSEER_SUBJECT);
    expect(overseer?.session?.attribute).toBe('cryptography');
    expect(overseer?.session?.durationSeconds).toBe(TRAINING_SECONDS);
  });

  it('will not put one person in two sessions at once', async () => {
    const app = await makeApp();
    const token = await signIn(app);
    await train(app, token, OVERSEER_SUBJECT, 'cryptography');

    const second = await train(app, token, OVERSEER_SUBJECT, 'logic');
    expect(second.statusCode).toBe(409);
    expect(second.json<{ error: { message: string } }>().error.message).toBe(
      'Already in a session',
    );
  });

  it('refuses a subject nobody on the books answers to', async () => {
    const app = await makeApp();
    const res = await train(app, await signIn(app), 'officer-nobody', 'logic');
    expect(res.statusCode).toBe(404);
  });

  it('refuses an attribute that is not one', async () => {
    const app = await makeApp();
    const res = await train(app, await signIn(app), OVERSEER_SUBJECT, 'marksmanship');
    expect(res.statusCode).toBe(400);
  });

  it('pays the gain out an hour later, once, and persists it', async () => {
    const app = await makeApp();
    const token = await signIn(app);
    const before =
      (await board(app, token)).subjects.find((s) => s.id === OVERSEER_SUBJECT)?.attributes
        .cryptography ?? 0;
    await train(app, token, OVERSEER_SUBJECT, 'cryptography');

    // Reach past the clock rather than waiting an hour: the session's own start time is what the
    // settle reads, so backdating it is the same thing to every line of code involved.
    const base = app.repos.bases.findByOwnerId(app.repos.users.findByUsername('driller')?.id ?? '');
    expect(base).toBeDefined();
    if (!base) return;
    const backdated = {
      ...base.training,
      sessions: base.training.sessions.map((session) => ({
        ...session,
        startedAt: new Date(Date.parse(session.startedAt) - TRAINING_SECONDS * 1000).toISOString(),
      })),
    };
    app.repos.bases.updateTraining(base.id, backdated, base.commanders);

    const after = await board(app, token);
    const overseer = after.subjects.find((s) => s.id === OVERSEER_SUBJECT);
    expect(overseer?.attributes.cryptography).toBe(before + TRAINING_GAIN);
    expect(overseer?.session).toBeNull();
    expect(overseer?.lastAttribute).toBe('cryptography');

    // Read twice: an hour must not pay twice.
    const again = await board(app, token);
    expect(again.subjects.find((s) => s.id === OVERSEER_SUBJECT)?.attributes.cryptography).toBe(
      before + TRAINING_GAIN,
    );
  });

  it('will not let the same person drill the same thing twice running', async () => {
    const app = await makeApp();
    const token = await signIn(app);
    await train(app, token, OVERSEER_SUBJECT, 'cryptography');

    const base = app.repos.bases.findByOwnerId(app.repos.users.findByUsername('driller')?.id ?? '');
    if (!base) throw new Error('no base');
    app.repos.bases.updateTraining(base.id, { ...base.training, sessions: [] }, base.commanders);

    const repeat = await train(app, token, OVERSEER_SUBJECT, 'cryptography');
    expect(repeat.statusCode).toBe(409);
    expect(repeat.json<{ error: { message: string } }>().error.message).toBe(
      'Trained that last time',
    );
    // Something else is fine.
    expect((await train(app, token, OVERSEER_SUBJECT, 'logic')).statusCode).toBe(200);
  });

  it('runs out after five in a day', async () => {
    const app = await makeApp();
    const token = await signIn(app);
    const username = app.repos.users.findByUsername('driller');
    const base = app.repos.bases.findByOwnerId(username?.id ?? '');
    if (!base) throw new Error('no base');

    // Five officers, so nobody is blocked by the one-session-per-person rule and the only thing
    // that can stop the sixth is the daily allowance.
    const officers = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) =>
      createCommander(`officer-${id}`, `Officer ${id}`, 'head_spy'),
    );
    app.repos.bases.updateCommanders(base.id, officers);

    for (const officer of officers.slice(0, TRAININGS_PER_DAY)) {
      expect((await train(app, token, officer.id, 'logic')).statusCode).toBe(200);
    }
    const sixth = await train(app, token, officers[5]?.id ?? '', 'logic');
    expect(sixth.statusCode).toBe(409);
    expect(sixth.json<{ error: { message: string } }>().error.message).toBe(
      'No sessions left today',
    );
  });

  it('trains an officer, not only the Overseer', async () => {
    const app = await makeApp();
    const token = await signIn(app);
    const base = app.repos.bases.findByOwnerId(app.repos.users.findByUsername('driller')?.id ?? '');
    if (!base) throw new Error('no base');
    const officer = createCommander('officer-1', 'Vex', 'salvager', { salvage: 20 });
    app.repos.bases.updateCommanders(base.id, [officer]);

    expect((await train(app, token, officer.id, 'salvage')).statusCode).toBe(200);
    const view = await board(app, token);
    const listed = view.subjects.find((subject) => subject.id === officer.id);
    expect(listed?.role).toBe('Salvager');
    expect(listed?.session?.attribute).toBe('salvage');
  });

  it('has nothing left to teach an attribute already at the ceiling', async () => {
    const app = await makeApp();
    const token = await signIn(app);
    const base = app.repos.bases.findByOwnerId(app.repos.users.findByUsername('driller')?.id ?? '');
    if (!base) throw new Error('no base');
    app.repos.bases.updateCommanders(base.id, [
      createCommander('officer-1', 'Vex', 'salvager', { salvage: MAX_ATTRIBUTE }),
    ]);

    const res = await train(app, token, 'officer-1', 'salvage');
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { message: string } }>().error.message).toBe(
      'Nothing left to learn here',
    );
  });
});

describe("the Overseer's own page", () => {
  it('answers with the crew sheet and what every channel is currently worth', async () => {
    const app = await makeApp();
    const token = await signIn(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/overseer/me',
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      overseer: { name: string };
      crewSheet: Record<string, number>;
      effects: Record<string, number>;
    }>();
    expect(body.overseer.name).toContain('Kane');
    // The enforcer preset's Intimidation is its highest number, and it is one person, so the crew
    // sheet is their sheet.
    expect(body.crewSheet.intimidation).toBe(34);
    expect(body.effects.intimidationFlat).toBeGreaterThan(0);
    // Nothing leaks that the player could not already read off their own sheet.
    expect(body.effects).not.toHaveProperty('roleFit');
  });
});

/**
 * One positive control per channel.
 *
 * Each measures the same call twice: once with a crew that has the driving attribute and once
 * with a crew that does not, and requires the two to differ. A wiring that got dropped passes
 * every other test in the suite and fails exactly these.
 */
describe('an attribute changes an outcome', () => {
  const HOUR = '2026-08-16T12:00:00.000Z';

  function seed(
    repos: Repositories,
    sheet: Record<string, number>,
    perks: readonly string[] = [],
    extra: Commander[] = [],
  ): Base {
    repos.users.insert({ id: 'u', username: 'crew', passwordHash: 'x', createdAt: HOUR });
    const base: Base = {
      id: 'b',
      ownerId: 'u',
      name: 'The Yard',
      districtId: 'neon-docks',
      level: 1,
      isBot: false,
      resources: { ...STARTING_RESOURCES, caps: 50_000, scrap: 50_000, oil: 50_000 },
      economy: startingEconomy(HOUR),
      progression: startingProgression(),
      research: startingResearch(),
      buildings: [{ id: 'n', kind: 'nexus', level: 3, modifications: [], damage: 0 }],
      buildQueue: [],
      army: {},
      trainingQueue: [],
      training: startingTraining(HOUR),
      inventory: {},
      fittedUpgrades: [],
      unitLoadouts: {},
      fleet: {},
      commanders: [
        createCommander('o1', 'Spec', 'head_spy', makeAttributes(0, sheet), perks),
        ...extra,
      ],
      createdAt: HOUR,
    };
    repos.bases.insert(base);
    return base;
  }

  /**
   * §B7: a perk on an officer reaches the game, through the same path an attribute does.
   *
   * This is a *server* test rather than another one in `crew/effects.ts`, and the reason is the
   * bug it was written for. The shared fold was correct and its unit tests passed; what was broken
   * was the wiring, because `crewSheetsFor` built every `CrewMember` from an officer's attributes
   * and role and simply never read their perks. The whole hundred-perk book applied to nobody, and
   * it compiled, because the field was optional at the time. It is required now, so that exact
   * mistake is a build error, and this pins the end-to-end path as well.
   */
  it('carries an officer perk from the roster through to the numbers the game runs on', () => {
    const plain = openStack();
    const helped = openStack();
    const plainBase = seed(plain, {});
    // `site_foreman` is +6% build speed, a channel with nothing else feeding it here.
    const helpedBase = seed(helped, {}, ['site_foreman']);

    const flat = queueBuild(plain, {
      base: plainBase,
      structure: 'quarters',
      id: 'q1',
      now: new Date(HOUR),
    });
    const quick = queueBuild(helped, {
      base: helpedBase,
      structure: 'quarters',
      id: 'q2',
      now: new Date(HOUR),
    });
    if (flat.kind !== 'queued' || quick.kind !== 'queued') throw new Error('both should queue');
    expect(quick.entry.durationSeconds, 'the perk book applies to nobody').toBeLessThan(
      flat.entry.durationSeconds,
    );
  });

  it('takes time off a build for Organization and Dexterity', () => {
    const plain = openStack();
    const skilled = openStack();
    const plainBase = seed(plain, {});
    const flat = queueBuild(plain, {
      base: plainBase,
      structure: 'quarters',
      id: 'q1',
      now: new Date(HOUR),
    });
    const quick = queueBuild(skilled, {
      base: seed(skilled, { organization: 80, dexterity: 80 }),
      structure: 'quarters',
      id: 'q2',
      now: new Date(HOUR),
    });
    if (flat.kind !== 'queued' || quick.kind !== 'queued') throw new Error('both should queue');

    // A crew with nothing pays the catalogue clock exactly, discount from the Nexus included.
    expect(flat.entry.durationSeconds).toBe(
      buildingBuildSeconds('quarters', 1, plainBase.buildings),
    );
    expect(quick.entry.durationSeconds).toBeLessThan(flat.entry.durationSeconds);
  });

  it('takes caps off a build for Craft', () => {
    const plain = openStack();
    const maker = openStack();
    const plainBase = seed(plain, {});
    const full = queueBuild(plain, {
      base: plainBase,
      structure: 'quarters',
      id: 'q1',
      now: new Date(HOUR),
    });
    const cheap = queueBuild(maker, {
      base: seed(maker, { craft: 80 }),
      structure: 'quarters',
      id: 'q2',
      now: new Date(HOUR),
    });
    if (full.kind !== 'queued' || cheap.kind !== 'queued') throw new Error('both should queue');

    const listed = buildingCost('quarters', 1, plainBase.buildings);
    const spent = (before: number, after: number) => before - after;
    const paidFull = spent(50_000, full.base.resources.scrap);
    const paidCheap = spent(50_000, cheap.base.resources.scrap);
    expect(paidFull).toBe(listed.scrap ?? 0);
    expect(paidCheap).toBeLessThan(paidFull);
    // Never free, whatever the crew.
    expect(paidCheap).toBeGreaterThan(0);
  });

  it('takes caps off what an officer asks for, for Authority and Negotiation', () => {
    const sheet = makeAttributes(30);
    expect(askingWage(sheet, 0, 20)).toBeLessThan(askingWage(sheet));
    // Never free, whatever the crew.
    expect(askingWage(sheet, 0, 100)).toBeGreaterThan(0);
    expect(askingWage(sheet, 0, 100)).toBe(askingWage(sheet, 0, MAX_WAGE_DISCOUNT));
  });

  it('blurs a garrison count for the holder, and sharpens it for the reader', () => {
    // 43 people, seen through 24% of counter-intelligence: reported to the nearest four.
    expect(blurredCount(43, 0)).toBe(43);
    expect(blurredCount(43, 24)).toBe(44);
    expect(blurredCount(43, 24)).not.toBe(43);
    // A reader who has cut through it is back to the exact number.
    expect(blurredCount(43, 0)).toBe(43);
  });

  /**
   * The two things a coarsened count must never do.
   *
   * Zero is not a coarse number: it is the one value the district screen reads as a fact about the
   * world rather than as an estimate, and it costs the reader a deployment. And "never
   * systematically high or low" has to survive the ties, which `Math.round` sends upward every
   * time.
   */
  it('never reports an occupied place as empty', () => {
    for (const blur of [8, 16, 24, 32, 40, 56, 63, 80]) {
      for (let standing = 1; standing <= 12; standing++) {
        expect(blurredCount(standing, blur), `${standing} through ${blur}`).toBeGreaterThan(0);
      }
    }
    // Empty stays empty: the blur must not invent a garrison either.
    expect(blurredCount(0, 32)).toBe(0);
  });

  it('is not biased upward across a spread, which rounding every tie up made it', () => {
    for (const blur of [8, 16, 32]) {
      let drift = 0;
      for (let standing = 1; standing <= 200; standing++) {
        drift += blurredCount(standing, blur) - standing;
      }
      // A quarter of a grain is what `Math.round` cost: 0.25, 0.5 and 1.25 for these three blurs.
      expect(Math.abs(drift / 200), `blur ${blur}`).toBeLessThan(0.1);
    }
  });

  it('stays inside half a grain of the truth, which is the promise it is made on', () => {
    for (const blur of [8, 16, 32, 48]) {
      const grain = 1 + Math.floor(blur / INTEL_PERCENT_PER_GRAIN);
      for (let standing = grain; standing <= 200; standing++) {
        expect(
          Math.abs(blurredCount(standing, blur) - standing),
          `${standing} through ${blur}`,
        ).toBeLessThanOrEqual(grain / 2);
      }
    }
  });

  it('brings some of the dead back for Medicine', () => {
    expect(recoverCasualties({ razors: 10 }, 0)).toEqual({ razors: 10 });
    expect(recoverCasualties({ razors: 10 }, 30)).toEqual({ razors: 7 });
    // Capped: a fight is never free.
    expect(recoverCasualties({ razors: 10 }, 500).razors).toBeGreaterThan(0);
  });

  it('reads the same effects whether the specialist is the Overseer or an officer', () => {
    const repos = openStack();
    const base = seed(repos, { cryptography: 80 });
    const effects = crewEffectsFor(repos, base);
    expect(effects.intelResistancePercent).toBeGreaterThan(0);
    // And the territory fold carries the crew's contribution through untouched.
    expect(standingEffectsFor(repos, base).intelResistancePercent).toBe(
      effects.intelResistancePercent,
    );
  });

  it('holds every resource key it was given', () => {
    // A guard on the fixture rather than on the code: `seed` spends scrap, and a resource key
    // renamed out from under it would make the cost assertions vacuous rather than failing.
    expect(RESOURCE_KEYS).toContain('scrap');
    expect(BUILDING_CATALOG.quarters).toBeDefined();
  });
});

/**
 * §B7: the perks that land on *other people's* sheets.
 *
 * The board's rule, in their words: a flat bonus an officer gives to their own attribute is not a
 * bonus, because the same officer with a higher attribute is the identical crew. So every
 * officer-facing perk reaches everybody on the books except the person carrying it, and the test
 * that matters here is the one that pins the exception.
 *
 * Driven through `crewSheetsFor` rather than through `liftOfficer`, because the bug this replaced
 * was not in the arithmetic. `officer_group` folded correctly into `officerGroupFlat` and the only
 * consumer of that channel read the *ground's* copy and never the crew's, so eight perks in the
 * book moved no number anywhere in the game. Unit tests of the fold all passed throughout.
 */
describe('a perk that lifts the other officers', () => {
  const HOUR = '2026-08-16T12:00:00.000Z';

  function roster(repos: Repositories, officers: Commander[]): Base {
    repos.users.insert({ id: 'u', username: 'lift', passwordHash: 'x', createdAt: HOUR });
    const base: Base = {
      id: 'b',
      ownerId: 'u',
      name: 'The Yard',
      districtId: 'neon-docks',
      level: 1,
      isBot: false,
      resources: { ...STARTING_RESOURCES },
      economy: startingEconomy(HOUR),
      progression: startingProgression(),
      research: startingResearch(),
      buildings: [],
      buildQueue: [],
      army: {},
      trainingQueue: [],
      training: startingTraining(HOUR),
      inventory: {},
      fittedUpgrades: [],
      unitLoadouts: {},
      fleet: {},
      commanders: officers,
      createdAt: HOUR,
    };
    repos.bases.insert(base);
    return base;
  }

  /** The perk in the book that lifts one named attribute for the rest of the crew. */
  const teacher = PERK_CATALOG.find((entry) => entry.bonus.kind === 'officer_attribute');
  if (!teacher || teacher.bonus.kind !== 'officer_attribute') {
    throw new Error('no officer_attribute perk in the book');
  }
  const { attribute, flat } = teacher.bonus;

  function sheetOf(repos: Repositories, base: Base, officerId: string) {
    const officer = base.commanders.find((entry) => entry.id === officerId)!;
    const index = base.commanders.indexOf(officer);
    // `crewSheetsFor` puts the Overseer first when there is one; there is not, in this fixture.
    return crewSheetsFor(repos, base)[index]!;
  }

  it('raises the attribute on everybody else', () => {
    const repos = openStack();
    const base = roster(repos, [
      createCommander('teacher', 'Teach', 'head_spy', makeAttributes(20), [teacher.id]),
      createCommander('pupil', 'Pupil', 'trader', makeAttributes(20), []),
    ]);

    expect(sheetOf(repos, base, 'pupil').attributes[attribute]).toBe(20 + flat);
  });

  /** The rule the board asked for, and the whole reason the perk book was reworked. */
  it('does not raise it on the officer carrying it', () => {
    const repos = openStack();
    const base = roster(repos, [
      createCommander('teacher', 'Teach', 'head_spy', makeAttributes(20), [teacher.id]),
      createCommander('pupil', 'Pupil', 'trader', makeAttributes(20), []),
    ]);

    expect(sheetOf(repos, base, 'teacher').attributes[attribute]).toBe(20);
  });

  it('stacks when two officers both carry one', () => {
    const repos = openStack();
    const base = roster(repos, [
      createCommander('one', 'One', 'head_spy', makeAttributes(20), [teacher.id]),
      createCommander('two', 'Two', 'trader', makeAttributes(20), [teacher.id]),
      createCommander('three', 'Three', 'raid_boss', makeAttributes(20), []),
    ]);

    // The two teachers lift each other once each; the third is lifted by both.
    expect(sheetOf(repos, base, 'one').attributes[attribute]).toBe(20 + flat);
    expect(sheetOf(repos, base, 'three').attributes[attribute]).toBe(20 + flat * 2);
  });

  it('leaves a lone officer exactly as they came in', () => {
    const repos = openStack();
    const base = roster(repos, [
      createCommander('alone', 'Alone', 'head_spy', makeAttributes(20), [teacher.id]),
    ]);

    expect(sheetOf(repos, base, 'alone').attributes[attribute]).toBe(20);
  });
});

/**
 * §C2: the bench, and what somebody on it is worth (board request).
 *
 * The Bar turns over at midnight and a good sheet walks away, so the pressure to sign is real and
 * the pressure to have already decided which chair was artificial. The bench removes the second
 * without removing the first: sign them now, seat them later, and pay for the delay in what they
 * contribute meanwhile.
 */
describe('the bench', () => {
  const HOUR = '2026-08-16T12:00:00.000Z';

  function roster(repos: Repositories, officers: Commander[]): Base {
    repos.users.insert({ id: 'u', username: 'bench', passwordHash: 'x', createdAt: HOUR });
    const base: Base = {
      id: 'b',
      ownerId: 'u',
      name: 'The Yard',
      districtId: 'neon-docks',
      level: 1,
      isBot: false,
      resources: { ...STARTING_RESOURCES },
      economy: startingEconomy(HOUR),
      progression: startingProgression(),
      research: startingResearch(),
      buildings: [],
      buildQueue: [],
      army: {},
      trainingQueue: [],
      training: startingTraining(HOUR),
      inventory: {},
      fittedUpgrades: [],
      unitLoadouts: {},
      fleet: {},
      commanders: officers,
      createdAt: HOUR,
    };
    repos.bases.insert(base);
    return base;
  }

  /**
   * The price of the bench, and the reason it is not a free parking space.
   *
   * A seated officer is paid in full in the skills their chair uses. A benched one is paid the
   * off-duty share in everything, which is the same share a seated officer gets in the skills
   * their own chair does not care about. So signing somebody is always worth something and seating
   * them is worth a great deal more.
   *
   * Asserted through `crewSheet`, which is where the share is actually applied. `crewSheetsFor`
   * hands back each person's *raw* sheet with the peer lifts on it; reading that would have shown
   * a benched officer at their full 40 and proved nothing about the discount.
   */
  it('pays somebody with no chair the off-duty share of everything', () => {
    const repos = openStack();
    const base = roster(repos, [createCommander('benched', 'Bench', null, makeAttributes(40), [])]);

    const sheet = crewSheet(crewSheetsFor(repos, base));
    for (const name of ATTRIBUTE_NAMES) {
      expect(sheet[name]).toBe(Math.round(40 * BENCH_SHARE));
    }
  });

  /** And the same person in a chair is worth more, in what that chair is actually for. */
  it('is worth less than the same person seated', () => {
    const benched = crewSheet(
      crewSheetsFor(
        openStack(),
        roster(openStack(), [createCommander('x', 'X', null, makeAttributes(40), [])]),
      ),
    );
    const seated = crewSheet(
      crewSheetsFor(
        openStack(),
        roster(openStack(), [createCommander('x', 'X', 'head_spy', makeAttributes(40), [])]),
      ),
    );

    // Ahead somewhere (the chair's own duties) and behind nowhere: the off-duty share is the floor
    // a seat can never pay less than.
    expect(ATTRIBUTE_NAMES.some((name) => seated[name] > benched[name])).toBe(true);
    expect(ATTRIBUTE_NAMES.every((name) => benched[name] <= seated[name])).toBe(true);
  });

  /**
   * A benched officer still lifts the people around them.
   *
   * Perks are things a person brought with them rather than something their chair does, so the
   * bench does not switch them off. It is what makes signing a teacher you have nowhere to put a
   * defensible move rather than a mistake.
   */
  it('still carries a perk that lifts the other officers', () => {
    const teacher = PERK_CATALOG.find((entry) => entry.bonus.kind === 'officer_attribute');
    if (!teacher || teacher.bonus.kind !== 'officer_attribute') throw new Error('no such perk');
    const { attribute, flat } = teacher.bonus;

    const withTeacher = openStack();
    const pairBase = roster(withTeacher, [
      createCommander('benched', 'Bench', null, makeAttributes(20), [teacher.id]),
      createCommander('seated', 'Seat', 'head_spy', makeAttributes(20), []),
    ]);
    const lifted = crewSheetsFor(withTeacher, pairBase).find(
      (member) => member.role === 'head_spy',
    )!;

    const alone = openStack();
    const loneBase = roster(alone, [
      createCommander('seated', 'Seat', 'head_spy', makeAttributes(20), []),
    ]);
    const unlifted = crewSheetsFor(alone, loneBase)[0]!;

    expect(lifted.attributes[attribute]).toBe(unlifted.attributes[attribute] + flat);
  });

  /** A chair holds one person. The bench holds everybody you have not placed. */
  it('holds as many people as have been signed', () => {
    const repos = openStack();
    const base = roster(repos, [
      createCommander('one', 'One', null, makeAttributes(20), []),
      createCommander('two', 'Two', null, makeAttributes(20), []),
      createCommander('three', 'Three', null, makeAttributes(20), []),
    ]);

    expect(crewSheetsFor(repos, base)).toHaveLength(3);
    expect(seatedRoles(base.commanders)).toEqual([]);
  });
});

/**
 * §B7: the Gate reaches the fight.
 *
 * Written at integration, because the two halves of this were built by different people and the
 * seam between them is exactly where a bonus stops applying. `gateDefensePercent` was authored,
 * levelled, and unit-tested against the building catalogue, and `standingEffectsFor` is the only
 * path from a district into `battle/effects.ts`. Until these two lines existed the Gate's whole
 * percentage was computed correctly and thrown away, which is the same failure the eight
 * `officer_group` perks shipped with: a channel with no consumer.
 *
 * Asserted through the funnel rather than on the helper, for that reason. The helper's own tests
 * pass either way.
 */
describe('the Gate, from the district into a fight', () => {
  const HOUR = '2026-08-16T12:00:00.000Z';

  function withGateAt(level: number): { repos: Repositories; base: Base } {
    const repos = openStack();
    repos.users.insert({ id: 'u', username: 'gate', passwordHash: 'x', createdAt: HOUR });
    const base: Base = {
      id: 'b',
      ownerId: 'u',
      name: 'The Yard',
      districtId: 'neon-docks',
      level: 1,
      isBot: false,
      resources: { ...STARTING_RESOURCES },
      economy: startingEconomy(HOUR),
      progression: startingProgression(),
      research: startingResearch(),
      buildings:
        level === 0 ? [] : [{ id: 'g', kind: 'gate', level, modifications: [], damage: 0 }],
      buildQueue: [],
      army: {},
      trainingQueue: [],
      training: startingTraining(HOUR),
      inventory: {},
      fittedUpgrades: [],
      unitLoadouts: {},
      fleet: {},
      commanders: [],
      createdAt: HOUR,
    };
    repos.bases.insert(base);
    return { repos, base };
  }

  it('puts a raised Gate on the channel the battle engine reads', () => {
    const none = withGateAt(0);
    const raised = withGateAt(6);

    const without = standingEffectsFor(none.repos, none.base).defensePercent;
    const with6 = standingEffectsFor(raised.repos, raised.base).defensePercent;

    expect(with6).toBeGreaterThan(without);
  });

  it('is worth more the higher it is raised', () => {
    const low = withGateAt(2);
    const high = withGateAt(10);

    expect(standingEffectsFor(high.repos, high.base).defensePercent).toBeGreaterThan(
      standingEffectsFor(low.repos, low.base).defensePercent,
    );
  });

  /** The other half of §B7: a raised Gate is a district that is harder to read. */
  it('makes the district harder to scout', () => {
    const none = withGateAt(0);
    const raised = withGateAt(6);

    expect(standingEffectsFor(raised.repos, raised.base).intelResistancePercent).toBeGreaterThan(
      standingEffectsFor(none.repos, none.base).intelResistancePercent,
    );
  });
});
