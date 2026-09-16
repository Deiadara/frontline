import { REPAIR_HOURS, storageCapacityFor, type Base, type ResourceKey } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { settleDistrict } from './settle.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * §A4: a structure repairing itself is a clock the settle walk has to be cut on.
 *
 * The walk prices each stretch of the window at its midpoint, which is exact while the factors are
 * linear across it. A repairing structure is linear right up to the moment its damage reaches zero
 * and flat after that, so a stretch that straddles that moment is priced off a line that is wrong on
 * one side of it. Reading the midpoint of a three day window after a total wreck found no damage at
 * all and banked all three days at full rate, when the first of them was spent in pieces.
 *
 * Measured as a **property** rather than against a table: the same window settled once and settled
 * hour by hour has to pay the same, because a lazy settle is only lazy if reading more often
 * changes nothing. The hourly run is the ground truth, since a one hour stretch cannot straddle
 * much of anything.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const HOUR = 3_600_000;
const START = new Date('2026-09-01T00:00:00.000Z');

async function makeApp(): Promise<{ app: FastifyInstance; base: Base }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'the_wrecked', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  const baseId = chosen.json<{ base: { id: string } }>().base.id;
  const raw = app.repos.bases.findById(baseId);
  if (!raw) throw new Error('no base');
  return { app, base: raw };
}

/**
 * A district wrecked at `START`, with an empty store and shelves it cannot fill.
 *
 * The Apothecary is deliberately whole and deliberately tall: it is what sets the storage ceiling,
 * and a window that fills the shelves measures the ceiling rather than the walk. Everything that
 * produces is at 100 damage, so the repair clock is the only thing moving.
 */
function wreckedDistrict(raw: Base): Base {
  const damagedAt = START.toISOString();
  const producer = (id: string, kind: 'greenhouse' | 'scrapyard') => ({
    id,
    kind,
    level: 10,
    modifications: [],
    damage: 100,
    damagedAt,
  });
  return {
    ...raw,
    buildings: [
      ...raw.buildings.map((building) => ({ ...building, level: 10, damage: 100, damagedAt })),
      producer('greenhouse-1', 'greenhouse'),
      producer('scrapyard-1', 'scrapyard'),
      {
        id: 'apothecary-1',
        kind: 'apothecary' as const,
        level: 18,
        modifications: [],
        damage: 0,
        damagedAt: null,
      },
    ],
    resources: { caps: 0, supplies: 0, oil: 0, scrap: 0, highQualityMetal: 0, planks: 0 },
    economy: { ...raw.economy, productionSettledAt: damagedAt },
  };
}

describe('a district that spent part of the window in pieces', () => {
  /** Three days, so the repair finishes well inside the window and the clamp has room to bite. */
  const WINDOW_HOURS = 3 * REPAIR_HOURS;

  it('pays the same whether it is read once or every hour', async () => {
    const { app, base } = await makeApp();
    const wrecked = wreckedDistrict(base);
    const end = new Date(START.getTime() + WINDOW_HOURS * HOUR);

    const atOnce = settleDistrict(app.repos, wrecked, end).base.resources;

    let hourly: Base = wrecked;
    for (let hour = 1; hour <= WINDOW_HOURS; hour++) {
      hourly = settleDistrict(app.repos, hourly, new Date(START.getTime() + hour * HOUR)).base;
    }

    const measurable = Object.entries(hourly.resources).filter(([, amount]) => amount > 100);
    expect(measurable.length, 'nothing produced enough to measure').toBeGreaterThan(0);

    for (const [key, truth] of measurable) {
      const once = atOnce[key as ResourceKey] ?? 0;
      /*
       * The shelves are not what is being measured.
       *
       * A window that fills the store pays the ceiling whatever the walk did, so both readings
       * would agree for a reason that has nothing to do with the repair clock. Checked on both,
       * because it is the *larger* of the two that would hit a ceiling first.
       */
      const ceiling = storageCapacityFor(hourly.buildings, key as ResourceKey);
      expect(Math.max(once, truth), `${key} filled the store`).toBeLessThan(ceiling);
      // Within a per cent. The residue is the repair's own whole-point granularity, which every
      // reading shares; the bug it replaces was worth nine.
      expect(once / truth, key).toBeGreaterThan(0.99);
      expect(once / truth, key).toBeLessThan(1.01);
    }
  });
});
