import { MAX_RAID_DISRUPTION_PERCENT, type Base } from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { settleDistrict } from './settle.js';
import type { FastifyInstance } from 'fastify';
import { chooseOverseer } from '../testing/overseer.js';

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
  const chosen = await chooseOverseer(app, token);
  const baseId = chosen.json<{ base: { id: string } }>().base.id;
  const raw = app.repos.bases.findById(baseId);
  if (!raw) throw new Error('no base');
  // A level-1 plot produces almost nothing in ten hours, and a difference of two units cannot
  // separate a cut window from a whole one. So the ground is built up first: a measurement fixture,
  // not a claim about what a new crew has.
  const base: Base = {
    ...raw,
    buildings: [
      ...raw.buildings.map((building) => ({ ...building, level: 12 })),
      { id: 'greenhouse-1', kind: 'greenhouse' as const, level: 12, modifications: [] },
      { id: 'scrapyard-1', kind: 'scrapyard' as const, level: 12, modifications: [] },
      { id: 'apothecary-1', kind: 'apothecary' as const, level: 12, modifications: [] },
    ],
  };
  return { app, base };
}

/**
 * Settles a ten-hour window with a raid that ran over the given stretch of it, in hours relative
 * to `now`: `[-8, -4]` is a raid that landed eight hours ago and wore off four hours ago. `null`
 * is a window with no raid in it at all.
 */
function tenHoursWith(
  app: FastifyInstance,
  base: Base,
  now: Date,
  window: [number, number] | null,
): Record<string, number> {
  const at = (hours: number): string => new Date(now.getTime() + hours * HOUR).toISOString();
  const fixture: Base = {
    ...base,
    economy: {
      ...base.economy,
      productionSettledAt: at(-10),
      disruption:
        window === null
          ? { until: null, since: null, percent: 0 }
          : { since: at(window[0]), until: at(window[1]), percent: MAX_RAID_DISRUPTION_PERCENT },
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

    // Four windows over the same ten hours: no raid at all, a raid that ran out four hours before
    // the crew logged in, a raid landed an hour ago that is still running, and one that covered
    // the whole window.
    const undisturbed = tenHoursWith(app, base, now, null);
    const expiredMidWindow = tenHoursWith(app, base, now, [-10, -4]);
    const landedAnHourAgo = tenHoursWith(app, base, now, [-1, 5]);
    const ranThroughout = tenHoursWith(app, base, now, [-12, 5]);

    const measurable = Object.keys(undisturbed).filter((key) => (undisturbed[key] ?? 0) > 40);
    expect(measurable.length, 'nothing produced enough in ten hours to measure').toBeGreaterThan(0);

    // The cut is charged against the hours it covers, so each case is priced by how many of the
    // ten hours the raid overlapped. Derived from the constant rather than typed out, because the
    // percentage moved with the defeat when it stopped being a flat quarter.
    const worth = (disruptedHours: number): number =>
      (disruptedHours * (1 - MAX_RAID_DISRUPTION_PERCENT / 100) + (10 - disruptedHours)) / 10;
    const cases: [string, Record<string, number>, number][] = [
      ['expired four hours ago', expiredMidWindow, worth(6)],
      // The over-charge the `since` field was added for. Before it the walk read the cut as
      // though it had always been on and charged half of ten hours for a raid that had taken one.
      ['landed an hour ago', landedAnHourAgo, worth(1)],
      ['ran the whole window', ranThroughout, worth(10)],
    ];

    for (const key of measurable) {
      const full = undisturbed[key] ?? 0;
      for (const [name, produced, share] of cases) {
        const expected = full * share;
        expect(produced[key] ?? 0, `${key}, raid ${name}`).toBeGreaterThan(expected * 0.97);
        expect(produced[key] ?? 0, `${key}, raid ${name}`).toBeLessThan(expected * 1.03);
      }
    }
  });
});
