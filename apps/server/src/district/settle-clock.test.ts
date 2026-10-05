import {
  ATTRIBUTE_NAMES,
  MAX_ATTRIBUTE,
  createCommander,
  type Attributes,
  type Base,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { settleBase, settleDistrict } from './settle.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * The settle reads the crew at the instant it is settling, not at the instant the process is at.
 *
 * `settleDistrict` takes a `now` and threads it through the whole walk, and then read both crew
 * folds with the argument defaulted: `crewEffectsFor(repos, base)` and `standingEffectsFor(repos,
 * base)`. Both are step functions of time, so a settle for one instant was priced with the crew as
 * it stands at another. §D4 is the sharp edge, because an injured officer is a cliff rather than a
 * curve: the whole sheet is in the fold or none of it is.
 *
 * Measured as three settles of the same ten-hour window against the same district, so what is
 * asserted is a comparison between real runs rather than a production figure copied out of a table.
 * `fit` is the one the argument decides; `never hurt` is the positive control that says the
 * officer's sheet moves the number at all, without which `fit === out` would prove nothing.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const HOUR = 3_600_000;

/** Every rating at the ceiling, so the officer's chair is filled as well as it can be. */
function maxedSheet(): Attributes {
  return Object.fromEntries(ATTRIBUTE_NAMES.map((name) => [name, MAX_ATTRIBUTE])) as Attributes;
}

async function makeBase(): Promise<{ app: FastifyInstance; base: Base }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'clock_watcher', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  const raw = app.repos.bases.findById(chosen.json<{ base: { id: string } }>().base.id);
  if (!raw) throw new Error('fixture: no base');

  // A level-1 plot makes almost nothing in ten hours, and a difference of two units cannot separate
  // one production percentage from another. The ground is built up so the comparison has room.
  return {
    app,
    base: {
      ...raw,
      buildings: [
        ...raw.buildings.map((building) => ({ ...building, level: 12 })),
        {
          id: 'greenhouse-1',
          kind: 'greenhouse' as const,
          level: 12,
          modifications: [],
        },
        { id: 'scrapyard-1', kind: 'scrapyard' as const, level: 12, modifications: [] },
        {
          id: 'apothecary-1',
          kind: 'apothecary' as const,
          level: 12,
          modifications: [],
        },
      ],
    },
  };
}

/** Ten hours of production ending at `now`, with one officer on the books in the given state. */
function tenHoursTo(
  app: FastifyInstance,
  base: Base,
  now: Date,
  injuredUntil: string | null,
  settle: typeof settleDistrict = settleDistrict,
): Record<string, number> {
  const fixture: Base = {
    ...base,
    commanders: [
      {
        // A production perk on the officer, which is how somebody in a chair moves what the district
        // makes since skills stopped reaching the fold (2026-10-04); the bed takes it out the same.
        ...createCommander('engineer-1', 'Vess', 'engineer', maxedSheet(), [
          'night_shift',
          'shift_pattern',
        ]),
        injuredUntil,
      },
    ],
    economy: {
      ...base.economy,
      productionSettledAt: new Date(now.getTime() - 10 * HOUR).toISOString(),
    },
  };
  const after = settle(app.repos, fixture, now).base;
  return Object.fromEntries(
    Object.entries(after.resources).map(([key, value]) => [
      key,
      value - (base.resources[key as keyof Base['resources']] ?? 0),
    ]),
  );
}

describe('§D4: the settle prices the window at its own instant', () => {
  it('counts an officer whose recovery ended before the instant being settled', async () => {
    const { app, base } = await makeBase();
    const wall = Date.now();
    const recovered = new Date(wall + HOUR).toISOString();

    // The same window three ways. The officer is laid up until an hour from the wall clock, so:
    const out = tenHoursTo(app, base, new Date(wall + HOUR / 2), recovered); // still in a bed
    const fit = tenHoursTo(app, base, new Date(wall + 2 * HOUR), recovered); // back on their feet
    const never = tenHoursTo(app, base, new Date(wall + HOUR / 2), null); // never hurt at all

    const measurable = Object.keys(never).filter((key) => (never[key] ?? 0) > 40);
    expect(measurable.length, 'nothing produced enough in ten hours to measure').toBeGreaterThan(0);

    for (const key of measurable) {
      // The control: this officer's sheet is worth something, so an equality below is a signal.
      expect(never[key] ?? 0, `${key}: the fixture's officer changes nothing`).toBeGreaterThan(
        out[key] ?? 0,
      );
      // ...and the settle two hours out reads the roster as it stands *then*, not as it stands now.
      expect(fit[key] ?? 0, key).toBeGreaterThan(out[key] ?? 0);
      expect(fit[key] ?? 0, key).toBe(never[key] ?? 0);
    }
  });
});

/*
 * And a whole read, which cuts the window at every change to the crew, cuts it at a recovery too.
 * It did not: an officer laid up for nine hours of ten was paid for as though they had been on
 * their feet for all ten, because the one reading of the crew was taken at the end of the window
 * (bug pass, 2026-09-29).
 */
describe('§D4: a recovery inside the window is a cut', () => {
  it('prices the hours in bed without the officer and the hours after with them', async () => {
    // One crew for all three, because the Overseer is drawn at random and brings perks of their own:
    // three crews would be three different laid-up rates.
    const { app, base } = await makeBase();
    const wall = Date.now();
    const now = new Date(wall + 10 * HOUR);
    const run = (injuredUntil: string | null) =>
      tenHoursTo(app, base, now, injuredUntil, settleBase);
    const never = run(null);
    const throughout = run(new Date(wall + 20 * HOUR).toISOString());
    const lastHour = run(new Date(wall + 9 * HOUR).toISOString());

    const measurable = Object.keys(never).filter(
      (key) => (never[key] ?? 0) - (throughout[key] ?? 0) > 100,
    );
    expect(measurable.length, 'the officer moves nothing enough to measure').toBeGreaterThan(0);
    for (const key of measurable) {
      const fitHour = ((never[key] ?? 0) - (throughout[key] ?? 0)) / 10;
      // Nine hours at the laid-up rate and one at the fit one, to the unit either way.
      expect(Math.abs((lastHour[key] ?? 0) - ((throughout[key] ?? 0) + fitHour)), key).toBeLessThan(
        2,
      );
    }
  });
});
