import { RAID_DISRUPTION_PERCENT, type Base } from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { settleDistrict } from './settle.js';
import type { FastifyInstance } from 'fastify';

/**
 * §A4: a raid's disruption is a step function of time, and the settle walk has to treat it as one.
 *
 * `working` used to be read once, from `now`, and multiplied into every segment of the window. That
 * is only right for a factor that is constant across the window. A crew last settled three days ago
 * and raided an hour ago lost 30% of three days; the same crew opening the game after the six hours
 * had run out banked the disrupted hours at full rate. Both directions are wrong by the same
 * mechanism.
 *
 * Measured against a control with no disruption at all, so the number this asserts is a ratio
 * between two real settles rather than a figure copied out of the production tables.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const HOUR = 3_600_000;

async function makeBase(): Promise<{ app: FastifyInstance; base: Base }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'the_raided', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: { authorization: `Bearer ${token}` },
    payload: { presetId: 'enforcer' },
  });
  const baseId = chosen.json<{ base: { id: string } }>().base.id;
  const raw = app.repos.bases.findById(baseId);
  if (!raw) throw new Error('no base');
  // A level-1 plot produces almost nothing in ten hours, and a difference of two units cannot
  // separate 8.5 hours from 10. So the ground is built up first: this is a measurement fixture,
  // not a claim about what a new crew has.
  const base: Base = {
    ...raw,
    buildings: [
      ...raw.buildings.map((building) => ({ ...building, level: 12 })),
      { id: 'greenhouse-1', kind: 'greenhouse' as const, level: 12, modifications: [], damage: 0 },
      { id: 'scrapyard-1', kind: 'scrapyard' as const, level: 12, modifications: [], damage: 0 },
      { id: 'apothecary-1', kind: 'apothecary' as const, level: 12, modifications: [], damage: 0 },
    ],
  };
  return { app, base };
}

/** Settles a ten-hour window with the given disruption and answers with what was produced. */
function tenHoursWith(
  app: FastifyInstance,
  base: Base,
  now: Date,
  until: string | null,
): Record<string, number> {
  const fixture: Base = {
    ...base,
    economy: {
      ...base.economy,
      productionSettledAt: new Date(now.getTime() - 10 * HOUR).toISOString(),
      disruption: { until, percent: until === null ? 0 : RAID_DISRUPTION_PERCENT },
    },
  };
  const after = settleDistrict(app.repos, fixture, now).base;
  return Object.fromEntries(
    Object.entries(after.resources).map(([key, value]) => [
      key,
      value - (base.resources[key as keyof Base['resources']] ?? 0),
    ]),
  );
}

describe('what a raid takes off a district while it lasts', () => {
  it('charges the disrupted hours and only the disrupted hours', async () => {
    const { app, base } = await makeBase();
    const now = new Date();

    // Three windows over the same ten hours: no raid at all, a raid whose six hours ran out four
    // hours before the crew logged in, and a raid still running.
    const undisturbed = tenHoursWith(app, base, now, null);
    const expiredMidWindow = tenHoursWith(
      app,
      base,
      now,
      new Date(now.getTime() - 4 * HOUR).toISOString(),
    );
    const stillRunning = tenHoursWith(app, base, now, new Date(now.getTime() + HOUR).toISOString());

    const measurable = Object.keys(undisturbed).filter((key) => (undisturbed[key] ?? 0) > 40);
    expect(measurable.length, 'nothing produced enough in ten hours to measure').toBeGreaterThan(0);

    for (const key of measurable) {
      const full = undisturbed[key] ?? 0;
      // Six of the ten hours were disrupted, so the window is worth 6 x 0.75 + 4 = 8.5 hours.
      const expected = (full * 8.5) / 10;
      expect(expiredMidWindow[key] ?? 0, key).toBeGreaterThan(expected * 0.97);
      expect(expiredMidWindow[key] ?? 0, key).toBeLessThan(expected * 1.03);
      // And a raid that has not run out yet costs the whole window, which is the case the old
      // whole-window reading happened to get right: it is here so the fix cannot have broken it.
      expect(stillRunning[key] ?? 0, key).toBeLessThan(full);
    }
  });
});
