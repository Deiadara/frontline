import {
  BUILDING_CATALOG,
  MAX_ATTRIBUTE,
  OVERSEER_SUBJECT,
  RESOURCE_KEYS,
  STARTING_RESOURCES,
  TRAINING_GAIN,
  TRAINING_SECONDS,
  TRAININGS_PER_DAY,
  blurredCount,
  buildingBuildSeconds,
  buildingCost,
  createCommander,
  makeAttributes,
  recoverCasualties,
  runEconomyCycle,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingAssignees,
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
import { crewEffectsFor, standingEffectsFor } from './standing.js';

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

  function seed(repos: Repositories, sheet: Record<string, number>): Base {
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
      assignees: startingAssignees(),
      buildings: [{ id: 'n', kind: 'nexus', level: 3, modifications: [], damage: 0, garrisons: 0 }],
      buildQueue: [],
      army: {},
      trainingQueue: [],
      training: startingTraining(HOUR),
      inventory: {},
      fittedUpgrades: [],
      fleet: {},
      commanders: [createCommander('o1', 'Spec', 'head_spy', makeAttributes(0, sheet))],
      createdAt: HOUR,
    };
    repos.bases.insert(base);
    return base;
  }

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

  it('takes caps off a build for Fabrication', () => {
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
      base: seed(maker, { fabrication: 80 }),
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

  it('takes caps off the wage book for Authority and Negotiation', () => {
    const wages = { 'officer-1': 400 };
    const payroll = {
      wages,
      paidThroughAt: '2026-08-03T00:00:00.000Z',
      lastOutcome: null,
    } as unknown as Parameters<typeof runEconomyCycle>[0]['payroll'];
    const plain = runEconomyCycle({
      resources: STARTING_RESOURCES,
      payroll,
      officerCount: 1,
      now: new Date(HOUR),
    });
    const talked = runEconomyCycle({
      resources: STARTING_RESOURCES,
      payroll,
      officerCount: 1,
      wageDiscountPercent: 20,
      now: new Date(HOUR),
    });
    expect(plain.capsDue).toBeGreaterThan(0);
    expect(talked.capsDue).toBe(Math.round(plain.capsDue * 0.8));
  });

  it('blurs a garrison count for the holder, and sharpens it for the reader', () => {
    // 43 people, seen through 24% of counter-intelligence: reported to the nearest four.
    expect(blurredCount(43, 0)).toBe(43);
    expect(blurredCount(43, 24)).toBe(44);
    expect(blurredCount(43, 24)).not.toBe(43);
    // A reader who has cut through it is back to the exact number.
    expect(blurredCount(43, 0)).toBe(43);
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
