import {
  OVERSEER_SUBJECT,
  createCommander,
  makeAttributes,
  type CrewResponse,
  type TrainingResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';
import { openDoors } from '../testing/doors.js';

/**
 * The faces and the marks the Training tab draws (maintainer, 2026-10-04).
 *
 * Everybody on the books has a portrait id, the bench included, and a seated officer carries the
 * same mark the crew screen stamps on their card. The mark is the crew screen's own figure, read
 * back from `GET /crew` rather than recomputed here, so the two screens cannot disagree.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

async function signedIn(): Promise<{ app: FastifyInstance; token: string }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'faces', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  await chooseOverseer(app, token);
  openDoors(app, token, 'crew');
  pinOverseer(app, token);
  return { app, token };
}

async function read<T>(app: FastifyInstance, token: string, url: string): Promise<T> {
  const res = await app.inject({ method: 'GET', url, headers: auth(token) });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<T>();
}

describe('the people on the Training tab', () => {
  it('gives everybody a face and a seated officer the mark their crew card shows', async () => {
    const { app, token } = await signedIn();
    const base = app.repos.bases.findByOwnerId(app.repos.users.findByUsername('faces')!.id)!;
    const seated = createCommander('seated', 'Seated', 'professor', makeAttributes(40), []);
    const benched = createCommander('benched', 'Benched', null, makeAttributes(40), []);
    app.repos.bases.updateCommanders(base.id, [...base.commanders, seated, benched]);

    const training = await read<TrainingResponse>(app, token, '/api/training');
    const crew = await read<CrewResponse>(app, token, '/api/crew');
    const subject = (id: string) => training.subjects.find((one) => one.id === id)!;

    for (const one of training.subjects) {
      expect(one.portraitId, `${one.name} has no face`).not.toBeNull();
    }
    expect(subject(OVERSEER_SUBJECT).portraitId).toBeTruthy();

    const card = crew.officers.find((officer) => officer.officerId === 'seated')!;
    expect(card.mark, 'the fixture needs a seated officer with a mark').not.toBeNull();
    expect(subject('seated').mark).toBe(card.mark);
    // The bench has no chair to be marked against.
    expect(subject('benched').mark).toBeNull();
  });
});
