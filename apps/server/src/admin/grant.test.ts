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

async function crew(app: FastifyInstance): Promise<string> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'operator', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  await chooseOverseer(app, token);
  return token;
}

const grant = (app: FastifyInstance, token: string, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/admin/grant', headers: auth(token), payload: body });

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
