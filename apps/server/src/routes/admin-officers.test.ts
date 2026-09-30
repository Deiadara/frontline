import { MISC_AREA_ID, OFFICER_ROLES, findMissionTemplate } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';
import { launchMission } from '../missions/launch.js';

/**
 * The console seats a bench (maintainer request, 2026-09-17).
 *
 * Hiring is an auction that settles at midnight, so a world that has just been stood up has nobody
 * in any chair, and everything downstream of a chair is unreachable from it: spying needs a Master
 * of Whispers, a fight wants somebody leading it, role fit and the attribute channels have nothing
 * to read. That made a whole half of the game untestable against a live server without waiting a
 * day for the Bar.
 *
 * The assertion below is not that four rows appeared. It is that the door those rows exist to open
 * is open: `POST /city/spy` refused with `NO_FORCE` before the knob and is accepted after it. A
 * count would pass on a bench the rest of the server could not see.
 */
const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function bench(): Promise<{ app: FastifyInstance; token: string }> {
  const config = loadConfig({
    DATABASE_PATH: ':memory:',
    JWT_SECRET: 'test-secret',
    ADMIN: 'true',
  });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'seater', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  await chooseOverseer(app, token);
  // The caps for a job up front, so the only thing a refusal below can be about is the chair.
  const base = app.repos.bases.findByOwnerId(app.repos.users.findByUsername('seater')!.id)!;
  app.repos.bases.updateResources(base.id, { ...base.resources, caps: 1_000 });
  return { app, token };
}

/** The cheapest look at the Spire's gate: the Combine holds it whole from the first minute. */
const spy = (app: FastifyInstance, token: string) =>
  app.inject({
    method: 'POST',
    url: '/api/city/spy',
    headers: auth(token),
    payload: { target: { kind: 'gate', districtId: 'ccs' }, tier: 'loose_ears' },
  });

describe('the officers knob', () => {
  it('turns a crew with nobody to send into one that can spy', async () => {
    const { app, token } = await bench();

    const before = await spy(app, token);
    expect(before.statusCode, 'a fresh crew has nobody in a chair').toBe(409);
    expect(before.json<{ error: { code: string } }>().error.code).toBe('NO_FORCE');

    const knobs = await app.inject({
      method: 'POST',
      url: '/api/admin/knobs',
      headers: auth(token),
      payload: { officers: { count: 4, rating: 70 } },
    });
    expect(knobs.statusCode, knobs.body.slice(0, 300)).toBe(200);

    // A job needs the chair and nothing else (2026-09-22): no rung, so the knob alone opens it.
    const after = await spy(app, token);
    expect(after.statusCode, after.body.slice(0, 300)).toBe(200);
  });

  /*
   * Bug pass, 2026-09-29: the spy job was the one errand the testing build still charged for, so
   * the fixture above has to hand the crew caps before a job can leave.
   */
  it('sends a job for nothing in the testing build, and still prints its price', async () => {
    const { app, token } = await bench();
    await app.inject({
      method: 'POST',
      url: '/api/admin/knobs',
      headers: auth(token),
      payload: { officers: { count: 4, rating: 70 } },
    });
    const baseId = app.repos.bases.findByOwnerId(app.repos.users.findByUsername('seater')!.id)!.id;
    const before = app.repos.bases.findById(baseId)!.resources;
    app.repos.bases.updateResources(baseId, { ...before, caps: 0 });

    const sent = await spy(app, token);
    expect(sent.statusCode, sent.body.slice(0, 300)).toBe(200);
    expect(app.repos.bases.findById(baseId)!.resources.caps).toBe(0);
    const [run] = app.repos.spying.activeFor(baseId);
    expect(run?.capsPaid, 'the report quotes the real price').toBeGreaterThan(0);
  });

  /*
   * Bug pass, 2026-09-29: the knob replaced the roster and left the drill of an officer it had
   * unseated on the floor, so every drill answered "The floor is taken" for the rest of the hour,
   * and left their fee in the payroll book with nobody to pay it to.
   */
  it('strikes an unseated officer off the floor and off the books', async () => {
    const { app, token } = await bench();
    const knobs = (count: number) =>
      app.inject({
        method: 'POST',
        url: '/api/admin/knobs',
        headers: auth(token),
        payload: { officers: { count, rating: 55 }, playerLevel: 3 },
      });
    const drill = (subjectId: string) =>
      app.inject({
        method: 'POST',
        url: '/api/training',
        headers: auth(token),
        payload: { subjectId, attribute: 'strength' },
      });
    expect((await knobs(2)).statusCode).toBe(200);
    const seated = app.repos.bases.findByOwnerId(app.repos.users.findByUsername('seater')!.id)!;
    const [drilling, paid] = seated.commanders;
    const drilled = await drill(drilling!.id);
    expect(drilled.statusCode, drilled.body.slice(0, 200)).toBe(200);
    app.repos.bases.updateEconomy(seated.id, {
      ...seated.economy,
      payroll: { ...seated.economy.payroll, commitments: { [paid!.id]: 40 } },
    });

    expect((await knobs(0)).statusCode).toBe(200);

    const overseer = await drill('overseer');
    expect(overseer.statusCode, overseer.body.slice(0, 200)).toBe(200);
    const after = app.repos.bases.findById(seated.id)!;
    expect(after.commanders).toEqual([]);
    expect(after.economy.payroll.commitments).toEqual({});
  });

  /*
   * Maintainer ruling, 2026-09-29: the knob struck off an officer who was out leading a run, and
   * the run landed with nobody on the books at its head. Refused now, and nothing is changed.
   */
  it('refuses to strike off an officer who is out leading a run', async () => {
    const { app, token } = await bench();
    const knobs = (count: number) =>
      app.inject({
        method: 'POST',
        url: '/api/admin/knobs',
        headers: auth(token),
        payload: { officers: { count, rating: 55 } },
      });
    expect((await knobs(2)).statusCode).toBe(200);
    const base = app.repos.bases.findByOwnerId(app.repos.users.findByUsername('seater')!.id)!;
    const leader = base.commanders[1]!;
    const template = findMissionTemplate('scrap-run')!;
    app.repos.missions.insert(
      launchMission({
        id: 'led-run',
        base,
        template,
        areaId: MISC_AREA_ID,
        force: {},
        now: new Date(),
        leader: { kind: 'officer', id: leader.id, attributes: leader.attributes },
        grade: template.grades[0],
      }),
    );

    const refused = await knobs(1);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: { message: string } }>().error.message).toContain(
      `${leader.name} is out leading a run`,
    );
    expect(app.repos.bases.findById(base.id)!.commanders.map((one) => one.id)).toEqual(
      base.commanders.map((one) => one.id),
    );

    // Asking for enough chairs to keep theirs is fine: nobody leading anything is struck off.
    expect((await knobs(3)).statusCode).toBe(200);
  });

  it('seats one per role at the rating it was given, and no more than were asked for', async () => {
    const { app, token } = await bench();
    await app.inject({
      method: 'POST',
      url: '/api/admin/knobs',
      headers: auth(token),
      payload: { officers: { count: 2, rating: 55 } },
    });

    const crew = await app.inject({ method: 'GET', url: '/api/crew', headers: auth(token) });
    const officers = crew.json<{
      officers: { role: string; attributes: Record<string, number> }[];
    }>().officers;

    expect(officers).toHaveLength(2);
    expect(officers.map((o) => o.role)).toEqual([...OFFICER_ROLES].slice(0, 2));
    // Flat, so a measurement taken against this bench measures the mechanic and not the draw.
    for (const officer of officers) {
      for (const [name, value] of Object.entries(officer.attributes)) {
        expect(value, `${officer.role}'s ${name} is not the rating that was asked for`).toBe(55);
      }
    }
  });
});
