import {
  OVERSEER_SUBJECT,
  TRAINING_SECONDS,
  createCommander,
  drillSeconds,
  makeAttributes,
  type TrainingResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';
import { openDoors } from '../testing/doors.js';
import { liftedOfficerSheet, officerLiftRoom } from './standing.js';

/**
 * Each person's own hour on the training floor (maintainer, 2026-10-01).
 *
 * Speed, Resolve and Organization off the lifted sheet shorten the session, and the route freezes
 * the answer on the session as `durationSeconds`. What is pinned: the route stores the person's own
 * figure, it reads the lifted sheet rather than the printed one, and the tab shows the same figure
 * the route will store.
 */

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

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

async function signIn(app: FastifyInstance): Promise<string> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'quick', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  await chooseOverseer(app, token);
  openDoors(app, token, 'crew');
  pinOverseer(app, token);
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
): Promise<TrainingResponse> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/training',
    headers: auth(token),
    payload: { subjectId, attribute },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<TrainingResponse>();
}

const baseOf = (app: FastifyInstance) =>
  app.repos.bases.findByOwnerId(app.repos.users.findByUsername('quick')?.id ?? '')!;

describe('how long a session lasts', () => {
  it("stores the Overseer's own hour on the session, the one the tab quoted", async () => {
    const app = await makeApp();
    const token = await signIn(app);
    const quoted = (await board(app, token)).subjects.find((one) => one.id === OVERSEER_SUBJECT)!;
    // No Right Hand in a fresh crew, so the Overseer's lifted sheet is their own.
    const own = drillSeconds(quoted.attributes);
    expect(own, 'the pinned Overseer has some pace').toBeLessThan(TRAINING_SECONDS);
    expect(quoted.sessionSeconds).toBe(own);

    const after = await train(app, token, OVERSEER_SUBJECT, 'cryptography');
    const overseer = after.subjects.find((one) => one.id === OVERSEER_SUBJECT)!;
    expect(overseer.session?.durationSeconds).toBe(own);
    expect(baseOf(app).training.sessions[0]?.durationSeconds).toBe(own);
  });

  it('gives a quick officer a shorter hour than a slow one', async () => {
    const app = await makeApp();
    const token = await signIn(app);
    const base = baseOf(app);
    // Everything at 100 is past anything a lift can add, so this one is an independent anchor:
    // 2 x 100 + 100 + 100 is 400 points, 45% off, 1,981 seconds.
    const quick = createCommander(
      'quick-one',
      'Quick',
      null,
      makeAttributes(100, { logic: 40 }),
      [],
    );
    const slow = createCommander('slow-one', 'Slow', null, makeAttributes(5), []);
    app.repos.bases.updateCommanders(base.id, [...base.commanders, quick, slow]);

    const view = await board(app, token);
    const seconds = (id: string): number | undefined =>
      view.subjects.find((one) => one.id === id)?.sessionSeconds;
    expect(seconds('quick-one')).toBe(1981);
    expect(seconds('slow-one')).toBeGreaterThan(seconds('quick-one')!);
    expect(seconds('slow-one')).toBeLessThan(TRAINING_SECONDS);

    const started = await train(app, token, 'quick-one', 'logic');
    expect(started.subjects.find((one) => one.id === 'quick-one')?.session?.durationSeconds).toBe(
      1981,
    );
  });

  /**
   * The sheet the crew fields them with, the one their march and spy work read (2026-09-30).
   * A seated Right Hand lifts every other officer's groups, Speed and Organization among them.
   */
  it('reads the lifted sheet, not the printed one', async () => {
    const app = await makeApp();
    const token = await signIn(app);
    const base = baseOf(app);
    const deputy = createCommander('deputy', 'The Deputy', 'right_hand', makeAttributes(90), []);
    const pupil = createCommander('pupil', 'Pupil', null, makeAttributes(20), []);
    app.repos.bases.updateCommanders(base.id, [...base.commanders, deputy, pupil]);

    const lifted = liftedOfficerSheet(pupil, officerLiftRoom(app.repos, baseOf(app))).attributes;
    expect(lifted.speed, 'the fixture has to lift the pupil').toBeGreaterThan(
      pupil.attributes.speed,
    );

    const started = await train(app, token, 'pupil', 'logic');
    const stored = started.subjects.find((one) => one.id === 'pupil')?.session?.durationSeconds;
    expect(stored).toBe(drillSeconds(lifted));
    expect(stored).toBeLessThan(drillSeconds(pupil.attributes));
  });

  it('settles the session at its own end, not at the end of the plain hour', async () => {
    const app = await makeApp();
    const token = await signIn(app);
    const base = baseOf(app);
    const quick = createCommander(
      'quick-one',
      'Quick',
      null,
      makeAttributes(100, { logic: 40 }),
      [],
    );
    app.repos.bases.updateCommanders(base.id, [...base.commanders, quick]);
    await train(app, token, 'quick-one', 'logic');

    // Backdated to just past its own 1,981 seconds: well short of the plain hour, and done.
    const running = baseOf(app);
    app.repos.bases.updateTraining(
      running.id,
      {
        ...running.training,
        sessions: running.training.sessions.map((session) => ({
          ...session,
          startedAt: new Date(Date.now() - (1981 + 5) * 1000).toISOString(),
        })),
      },
      running.commanders,
    );
    const view = await board(app, token);
    expect(view.subjects.find((one) => one.id === 'quick-one')?.session).toBeNull();
  });
});
