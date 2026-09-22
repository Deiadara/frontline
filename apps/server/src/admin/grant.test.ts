import { BLUEPRINTS, RESEARCH_ITEMS, type Base, type ScrapyardResponse } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * The Console's grants (maintainer request, 2026-09-11): documents, pages, parts and rungs handed over
 * so the yard can be looked at mid and late game without collecting a page.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

async function makeApp(admin: boolean): Promise<FastifyInstance> {
  const config = loadConfig({
    DATABASE_PATH: ':memory:',
    JWT_SECRET: 'test-secret',
    ADMIN: admin ? 'true' : 'false',
  });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  return app;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function crew(app: FastifyInstance, username = 'operator'): Promise<string> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  await chooseOverseer(app, token);
  return token;
}

const grant = (app: FastifyInstance, token: string, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/admin/grant', headers: auth(token), payload: body });

/** The bench knobs live on their own route: `/admin/grant` hands out things, this sets state. */
const knobs = (app: FastifyInstance, token: string, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/admin/knobs', headers: auth(token), payload: body });

async function me(app: FastifyInstance, token: string): Promise<Base> {
  const res = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
  return res.json<{ base: Base }>().base;
}

describe('the Console hands over', () => {
  it('every document of one category, so the yard opens those rows', async () => {
    const app = await makeApp(true);
    const token = await crew(app);
    const res = await grant(app, token, { blueprints: 'upgrade' });
    expect(res.statusCode, res.body).toBe(200);

    const base = await me(app, token);
    for (const spec of BLUEPRINTS) {
      expect(base.inventory[spec.id as keyof typeof base.inventory] ?? 0, spec.id).toBe(
        spec.category === 'upgrade' ? 1 : 0,
      );
    }
    // Granting again does not stack a document: holding one is a yes or no.
    await grant(app, token, { blueprints: 'upgrade' });
    const again = await me(app, token);
    expect(again.inventory.bp_mod_filed_sights).toBe(1);

    const yard = await app.inject({ method: 'GET', url: '/api/scrapyard', headers: auth(token) });
    const entries = yard.json<ScrapyardResponse>().entries;
    for (const entry of entries.filter((row) => row.kind === 'upgrade')) {
      expect(entry.documentHeld, entry.id).toBe(true);
    }
  });

  it('one of every page, this many of every part, and the rungs of one track', async () => {
    const app = await makeApp(true);
    const token = await crew(app);
    expect((await grant(app, token, { pages: 'all', parts: 7 })).statusCode).toBe(200);
    const base = await me(app, token);
    expect(base.inventory.pg_snipers_barrel_liners).toBe(1);
    expect(base.inventory.scrap_servo).toBe(7);
    expect(base.inventory.rotor_hub).toBe(7);

    expect((await grant(app, token, { technologies: 'security_officer' })).statusCode).toBe(200);
    const after = await me(app, token);
    const track = RESEARCH_ITEMS.filter((spec) => spec.track === 'security_officer');
    for (const spec of track) expect(after.research.technologies, spec.id).toContain(spec.id);
    const other = RESEARCH_ITEMS.find((spec) => spec.track !== 'security_officer')!;
    expect(after.research.technologies).not.toContain(other.id);
  });

  it('nothing at all when admin mode is off, and refuses an empty grant', async () => {
    const off = await makeApp(false);
    const token = await crew(off);
    expect((await grant(off, token, { blueprints: 'all' })).statusCode).toBe(404);

    const on = await makeApp(true);
    const other = await crew(on);
    expect((await grant(on, other, {})).statusCode).toBe(400);
  });
});

/**
 * The Console's officers are people, not slots (maintainer, 2026-09-22).
 *
 * They used to be called `Bench 1` through `Bench 19` while being seated in chairs, and every
 * screen that prints the person under the trade then contradicted itself: the research rail read
 * `Master of Whispers` over `Bench 1`, which is a crew simultaneously seated and benched. The
 * word was only ever the fixture's own id leaking onto the page.
 */
describe('the Console seats people with names', () => {
  it('gives every seated officer a name that is not a bench slot', async () => {
    const app = await makeApp(true);
    const token = await crew(app);
    expect((await knobs(app, token, { officers: { count: 6, rating: 7 } })).statusCode).toBe(200);
    const base = await me(app, token);

    expect(base.commanders).toHaveLength(6);
    for (const officer of base.commanders) {
      // Seated, so the chair is the half that is true.
      expect(officer.role, officer.name).not.toBeNull();
      // And the name says nothing about a bench.
      expect(officer.name, officer.name).not.toMatch(/bench/i);
      expect(officer.name.trim().length).toBeGreaterThan(2);
    }
    // Real names off the Bar's own list, so they are not nineteen copies of one string either.
    expect(new Set(base.commanders.map((officer) => officer.name)).size).toBeGreaterThan(1);
  });

  it('draws the same crew every time, so a screenshot of the preset is stable', async () => {
    const app = await makeApp(true);
    const first = await crew(app);
    await knobs(app, first, { officers: { count: 5, rating: 7 } });
    const one = (await me(app, first)).commanders.map((officer) => officer.name);

    const second = await crew(app, 'another');
    await knobs(app, second, { officers: { count: 5, rating: 7 } });
    const two = (await me(app, second)).commanders.map((officer) => officer.name);

    expect(two).toEqual(one);
  });
});
