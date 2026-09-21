import {
  CITY_DISTRICTS,
  CITY_LOCATIONS,
  districtHolder,
  districtIsShut,
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

/**
 * §A4: the ground a new crew is handed is ground it can actually work (maintainer, 2026-09-18).
 *
 * A first session opens with one district already walked, because scouting is a journey and a new
 * crew has nobody to send. The clause was "the nearest district nobody lives in", which was a good
 * enough proxy while every crew was planted on the same starter. Once they were spread across the
 * four residential plots it stopped being one: a district nobody lives in can still be held end to
 * end by one party, which shuts its gate, and nothing behind a shut gate can be called at all.
 *
 * Measured before the fix, one home in four was affected: a crew on the Ashen Terraces was handed
 * `datavault-sigma`, Combine-held from end to end, and opened its first evening looking at a
 * district it could not touch. It also made `live.spec.ts` fail depending on how many accounts had
 * registered before it, which is how it was found.
 */
describe('the district a new crew wakes up next to', () => {
  /**
   * Shuts a district by handing every location in it to one party.
   *
   * The fixture has to do this because a bare test world has no seeded holders and therefore
   * nothing shut, which is exactly how the first version of this test passed against the bug: the
   * filter it was meant to be proving never had anything to filter. The live world is not like
   * that, and `datavault-sigma` is Combine-held from end to end in it.
   */
  const shutTight = (app: FastifyInstance, districtId: string): void => {
    for (const location of CITY_LOCATIONS.filter((one) => one.districtId === districtId)) {
      const control = app.repos.city.control(location.id);
      if (!control) continue;
      app.repos.city.put({ ...control, holder: { kind: 'government' }, garrison: {} });
    }
  };

  it('is never one whose gate is shut', async () => {
    /*
     * Two worlds, because the home has to be identical in both.
     *
     * Shutting a district and then registering a *second* crew in the same world proves nothing:
     * new crews are spread across the residential plots, so the second one wakes up somewhere else
     * and is naturally sent somewhere else too. The assertion passes without the rule existing,
     * which is exactly what the first version of this test did.
     *
     * So the first world answers "where would this crew be sent", the second shuts that district
     * before anybody registers, and both crews are the first in their world and therefore land on
     * the same starter.
     */
    const plain = await makeApp();
    const scout = await register(plain.app, 'scout');
    const first = await take(
      plain.app,
      scout,
      (await choices(plain.app, scout)).choices[0]!.presetId,
    );
    const firstBase = first.json<{ base: { id: string; districtId: string } }>().base;
    const natural = [...plain.app.repos.city.scouted(firstBase.id)].find(
      (id) => id !== firstBase.districtId,
    );
    expect(natural, 'a new crew was handed nothing at all').toBeDefined();
    if (!natural) return;

    const { app } = await makeApp();
    shutTight(app, natural);
    const district = CITY_DISTRICTS.find((one) => one.id === natural)!;
    expect(
      districtIsShut(districtHolder(district, app.repos.city.controls()) ?? null, false),
      `the fixture failed to shut ${natural}, so this proves nothing`,
    ).toBe(true);

    const token = await register(app, 'waking');
    const made = await take(app, token, (await choices(app, token)).choices[0]!.presetId);
    const base = made.json<{ base: { id: string; districtId: string } }>().base;
    expect(base.districtId, 'the two worlds planted their first crew differently').toBe(
      firstBase.districtId,
    );
    const walked = [...app.repos.city.scouted(base.id)].filter((id) => id !== base.districtId);

    expect(walked.length, `${base.districtId} was handed nothing at all`).toBeGreaterThan(0);
    expect(walked, `a new crew was handed ${natural}, which is shut`).not.toContain(natural);
  });
});

/**
 * §F6: asking again after you have chosen does not take four more out of the world.
 *
 * `POST /overseer` always refused a crew that already had somebody, and this read did not. That
 * was free while an offer was only a suggestion. Once it became a hold it stopped being free: a
 * settled account calling `GET /overseer/choices` took four of the thirty characters for ten
 * minutes and could never take one of them, because the write would refuse it, and nothing
 * released them. A client polling the endpoint after choosing would hold four hostage for as long
 * as it kept asking, and a handful of them would empty the pool for everybody starting out.
 */
describe('asking after you have already chosen', () => {
  it('is refused, and takes nothing out of the pool', async () => {
    const { app, db } = await makeApp();
    const token = await register(app, 'settled');
    const offer = await choices(app, token);
    expect((await take(app, token, offer.choices[0]!.presetId)).statusCode).toBe(201);
    // Taking one releases the other three, which is the state this starts from.
    const between = db.prepare('SELECT COUNT(*) AS n FROM overseer_holds').get() as { n: number };
    expect(between.n).toBe(0);

    const again = await app.inject({
      method: 'GET',
      url: '/api/overseer/choices',
      headers: auth(token),
    });

    expect(again.statusCode).toBe(409);
    expect(again.json<{ error: { code: string } }>().error.code).toBe('OVERSEER_ALREADY_CHOSEN');
    const held = db.prepare('SELECT COUNT(*) AS n FROM overseer_holds').get() as { n: number };
    expect(held.n, 'a settled crew took characters out of the pool by asking').toBe(0);
  });
});
