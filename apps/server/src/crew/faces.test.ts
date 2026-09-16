import {
  ASSIGNABLE_OFFICER_PORTRAIT_IDS,
  createCommander,
  type BarResponse,
  type Base,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { barDay, barRoster } from '../bar/roster.js';
import { signRecruit } from '../bar/hire.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { backfillPortraits, rosterFaces, takenFaces } from './faces.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * One face per officer, across the whole city (maintainer request, 2026-09-11).
 *
 * The rule has three moments and each is pinned: the Bar never offers a face somebody in the city
 * already wears, a signed recruit keeps the face their card showed, and officers written before
 * faces were stored get one on boot without anybody else's moving.
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

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function player(
  app: FastifyInstance,
  username: string,
): Promise<{ token: string; base: Base }> {
  const register = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const token = register.json<{ token: string }>().token;
  const overseer = await chooseOverseer(app, token);
  return { token, base: overseer.json<{ base: Base }>().base };
}

async function readBar(app: FastifyInstance, token: string): Promise<BarResponse> {
  const res = await app.inject({ method: 'GET', url: '/api/bar', headers: auth(token) });
  expect(res.statusCode).toBe(200);
  return res.json<BarResponse>();
}

describe('faces across the city', () => {
  it('signs a recruit with the face the Bar showed, and stores it', async () => {
    const app = await makeApp();
    const one = await player(app, 'faces_one');
    const bar = await readBar(app, one.token);
    const shown = bar.recruits[0]!;
    expect(shown.portraitId).toBeTruthy();

    const roster = barRoster(barDay(new Date()), bar.recruits.length, 1);
    const recruit = roster.find((entry) => entry.id === shown.id)!;
    const face = rosterFaces(
      app.repos,
      roster.map((entry) => entry.id),
    ).get(recruit.id);
    expect(face).toBe(shown.portraitId);

    const base = app.repos.bases.findById(one.base.id)!;
    const signed = signRecruit(app.repos, {
      base,
      userId: base.ownerId,
      recruit,
      price: 10,
      now: new Date(),
      ...(face === undefined ? {} : { portraitId: face }),
    });
    expect(signed.kind).toBe('signed');
    const stored = app.repos.bases.findById(one.base.id)!.commanders[0]!;
    expect(stored.portraitId).toBe(shown.portraitId);
    expect(takenFaces(app.repos).has(shown.portraitId)).toBe(true);
  });

  it('never offers another crew a face somebody in the city already wears', async () => {
    const app = await makeApp();
    const one = await player(app, 'faces_two');
    const two = await player(app, 'faces_three');
    // Give crew one a full bench of officers wearing the first dozen faces outright.
    const base = app.repos.bases.findById(one.base.id)!;
    const worn = ASSIGNABLE_OFFICER_PORTRAIT_IDS.slice(0, 12);
    app.repos.bases.updateCommanders(
      base.id,
      worn.map((face, index) => ({
        ...createCommander(`worn-${index}`, `Officer ${index}`, null),
        portraitId: face,
      })),
    );

    const bar = await readBar(app, two.token);
    const offered = bar.recruits.map((recruit) => recruit.portraitId);
    for (const face of offered) expect(worn, face).not.toContain(face);
    // ...and no two recruits on the same board wear one face either.
    expect(new Set(offered).size).toBe(offered.length);
  });

  it('gives officers written before faces were stored a face each, once', async () => {
    const app = await makeApp();
    const one = await player(app, 'faces_four');
    const base = app.repos.bases.findById(one.base.id)!;
    const bare = Array.from({ length: 5 }, (_, index) =>
      createCommander(`bare-${index}`, `Bare ${index}`, null),
    );
    app.repos.bases.updateCommanders(base.id, bare);

    expect(backfillPortraits(app.repos)).toBe(5);
    const faced = app.repos.bases
      .findById(base.id)!
      .commanders.map((officer) => officer.portraitId);
    expect(faced.every((face) => typeof face === 'string')).toBe(true);
    expect(new Set(faced).size).toBe(5);

    // A second boot moves nobody.
    expect(backfillPortraits(app.repos)).toBe(0);
    expect(
      app.repos.bases.findById(base.id)!.commanders.map((officer) => officer.portraitId),
    ).toEqual(faced);
  });
});
