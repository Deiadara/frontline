import {
  CITY_DISTRICTS,
  OVERSEER_HOLD_MS,
  STARTER_DISTRICT_ID,
  type OverseerChoicesResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';

/**
 * §F6: an offered character is held for the account it was offered to (maintainer, 2026-09-17).
 *
 * The offer used to reserve nothing. `GET /overseer/choices` was a pure function of the account id
 * over whatever was still unclaimed, so four accounts registering together were shown overlapping
 * sets and three of them pressed a button that could not work. Measured against a real server with
 * five accounts signing up at once: three of the five collided on their first pick.
 *
 * Three properties make it a reservation rather than a suggestion, and each is a case below:
 * nobody else is offered what you are holding, a refresh inside the window shows you the same four,
 * and the hold lapses so a closed tab does not take four of thirty out of the world for ever.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

async function makeApp(): Promise<{ app: FastifyInstance; db: AppDatabase }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  return { app, db };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function register(app: FastifyInstance, username: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ token: string }>().token;
}

async function choices(app: FastifyInstance, token: string): Promise<OverseerChoicesResponse> {
  const res = await app.inject({
    method: 'GET',
    url: '/api/overseer/choices',
    headers: auth(token),
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<OverseerChoicesResponse>();
}

const take = (app: FastifyInstance, token: string, presetId: string) =>
  app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId },
  });

/** Ages every live hold past its expiry, which is the only thing a clock would have done. */
function lapse(db: AppDatabase): void {
  db.prepare('UPDATE overseer_holds SET expires_at = ?').run(new Date(0).toISOString());
}

describe('an offered character is held', () => {
  it('never offers two accounts the same person', async () => {
    const { app } = await makeApp();
    const seen = new Map<string, string>();
    for (let i = 0; i < 6; i += 1) {
      const token = await register(app, `holder_${i}`);
      const offer = await choices(app, token);
      expect(offer.choices.length, 'everybody is offered somebody').toBeGreaterThan(0);
      for (const preset of offer.choices) {
        const alreadyWith = seen.get(preset.presetId);
        expect(
          alreadyWith,
          `${preset.presetId} was offered to both ${alreadyWith} and holder_${i}`,
        ).toBeUndefined();
        seen.set(preset.presetId, `holder_${i}`);
      }
    }
  });

  it('shows the same four on a refresh, and says when they lapse', async () => {
    const { app } = await makeApp();
    const token = await register(app, 'refresher');

    const first = await choices(app, token);
    const again = await choices(app, token);

    expect(again.choices.map((p) => p.presetId)).toEqual(first.choices.map((p) => p.presetId));
    expect(first.expiresAt, 'a held batch has to say when it stops being held').not.toBeNull();
    const window = Date.parse(first.expiresAt!) - Date.parse(first.serverNow);
    // Within a second of the stated window: the two timestamps are taken a few ms apart.
    expect(Math.abs(window - OVERSEER_HOLD_MS)).toBeLessThan(1000);
  });

  it('draws a different four once the hold has lapsed', async () => {
    const { app, db } = await makeApp();
    const token = await register(app, 'dawdler');

    const before = (await choices(app, token)).choices.map((p) => p.presetId);
    lapse(db);
    const after = (await choices(app, token)).choices.map((p) => p.presetId);

    expect(after.length).toBe(before.length);
    // A fresh batch, not the same one with a new expiry. Drawn off a new id rather than a hash of
    // the account, which is what makes this true.
    expect(after).not.toEqual(before);
  });

  /**
   * And what a player who dawdled is told, which is the half a status code decides.
   *
   * `PRESET_TAKEN` would be wrong here and actively misleading: nobody took the character, the
   * offer simply moved on, and what the screen has to do about it is reload rather than try the
   * next face along.
   */
  it('tells a lapsed picker to refresh rather than that somebody beat them', async () => {
    const { app, db } = await makeApp();
    const token = await register(app, 'latecomer');
    const offered = (await choices(app, token)).choices[0]!;

    lapse(db);
    const res = await take(app, token, offered.presetId);

    expect(res.statusCode).toBe(410);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('OFFER_EXPIRED');
  });

  it('refuses a character this account was never offered', async () => {
    const { app } = await makeApp();
    const mine = await register(app, 'honest');
    const theirs = await register(app, 'other');
    const offeredToThem = (await choices(app, theirs)).choices[0]!;
    await choices(app, mine);

    const res = await take(app, mine, offeredToThem.presetId);

    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('PRESET_TAKEN');
  });

  it('lets go of the rest of the batch once one of them is taken', async () => {
    const { app, db } = await makeApp();
    const token = await register(app, 'decisive');
    const offer = await choices(app, token);

    const res = await take(app, token, offer.choices[0]!.presetId);
    expect(res.statusCode, res.body).toBe(201);

    const left = db.prepare('SELECT COUNT(*) AS n FROM overseer_holds').get() as { n: number };
    expect(left.n, 'the three they did not take go back in the pool').toBe(0);
  });
});

describe('where a new crew lives', () => {
  it('puts the first crew on the starter and spreads the ones after it', async () => {
    const { app } = await makeApp();
    const homes: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const token = await register(app, `settler_${i}`);
      const offer = await choices(app, token);
      const res = await take(app, token, offer.choices[0]!.presetId);
      expect(res.statusCode, res.body).toBe(201);
      homes.push(res.json<{ base: { districtId: string } }>().base.districtId);
    }

    expect(homes[0], 'the first crew lands where the onboarding was written').toBe(
      STARTER_DISTRICT_ID,
    );
    expect(
      new Set(homes).size,
      `three players should fill three districts: ${homes.join(', ')}`,
    ).toBe(3);
    const residential = new Set(
      CITY_DISTRICTS.filter((d) => d.kind === 'residential').map((d) => d.id),
    );
    for (const home of homes)
      expect(residential.has(home), `${home} is not residential`).toBe(true);
  });
});
