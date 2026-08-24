import { REPAIR_HOURS, type Base, type Building } from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import type { FastifyInstance } from 'fastify';
import { settleDistrict } from './settle.js';

/**
 * §A4 — the repair clock reaching the database.
 *
 * `building/repair.test.ts` proves the arithmetic. What this proves is the half that arithmetic
 * cannot: that a read *settles* it and *writes it down*. The failure it exists for is a quiet one —
 * the settle recomputes the repair correctly on every read, hands the caller a repaired district,
 * and never persists it, so the next read starts from the wrecked row again and the place never
 * actually comes back. Every unit test stays green through that.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

async function makeStack(): Promise<{ app: FastifyInstance; base: Base; token: string }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'foreman', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
  return { app, token, base: chosen.json<{ base: Base }>().base };
}

/**
 * Wrecks the first structure standing, `hoursAgo` hours ago.
 *
 * The district's own clock goes back with it, because that is the only district this can be: a
 * place that was hit half a day ago is a place nobody has settled since. Leaving
 * `productionSettledAt` at "now" would build a state the game cannot reach — and the settle would
 * take its short-window exit and do nothing, which is correct behaviour being measured on an
 * impossible input.
 */
function wreck(app: FastifyInstance, base: Base, damage: number, hoursAgo: number): Building {
  const standing = base.buildings[0];
  if (!standing) throw new Error('fixture error: a new district has structures');
  const when = new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
  const hit: Building = { ...standing, damage, damagedAt: when };
  app.repos.bases.updateBuildings(
    base.id,
    base.buildings.map((building) => (building.id === hit.id ? hit : building)),
  );
  app.repos.bases.updateEconomy(base.id, { ...base.economy, productionSettledAt: when });
  return hit;
}

const damageOf = (app: FastifyInstance, base: Base, id: string): number =>
  app.repos.bases.findById(base.id)?.buildings.find((b) => b.id === id)?.damage ?? -1;

describe('a wrecked district putting itself right on a read (§A4)', () => {
  it('writes the repair down, so the next read starts from it', async () => {
    const { app, base } = await makeStack();
    const hit = wreck(app, base, 80, 12);

    const stored = app.repos.bases.findById(base.id);
    if (!stored) throw new Error('expected the base to be there');
    settleDistrict(app.repos, stored, new Date());

    // Half the day is fifty points off a hundred-point wreck, so eighty comes down to thirty.
    expect(damageOf(app, base, hit.id)).toBe(30);
  });

  it('has it whole again a day after the strike', async () => {
    const { app, base } = await makeStack();
    const hit = wreck(app, base, 100, REPAIR_HOURS + 1);

    const stored = app.repos.bases.findById(base.id);
    if (!stored) throw new Error('expected the base to be there');
    settleDistrict(app.repos, stored, new Date());

    expect(damageOf(app, base, hit.id)).toBe(0);
    // ...and the clock is gone with it, so nothing is left ticking on an intact structure.
    expect(
      app.repos.bases.findById(base.id)?.buildings.find((b) => b.id === hit.id)?.damagedAt ?? null,
    ).toBeNull();
  });

  it('repairs it on an ordinary page load, without anybody asking', async () => {
    const { app, base, token } = await makeStack();
    const hit = wreck(app, base, 100, 6);

    // The whole point of a lazy clock: no scheduler, no repair button, no route of its own. Looking
    // at the district is what settles it.
    const seen = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
    expect(seen.statusCode).toBe(200);

    expect(damageOf(app, base, hit.id)).toBe(75);
  });
});
