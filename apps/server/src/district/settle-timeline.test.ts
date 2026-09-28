import { playerXpToNextLevel, type Base } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';
import { settleBase } from './settle.js';

/**
 * What changes inside a settle window is priced from the instant it changed (audit, 2026-09-28).
 *
 * The window used to be priced against one reading of the crew, taken before the drills landed
 * and before the Lab did: a rung that finished halfway through paid nothing for the half after it.
 * Measured on caps, because no structure makes them and no store caps them, so the only thing
 * that can move the till in these worlds is the rung under test.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const HOUR = 3_600_000;
/** `The Ledger Closes`: thirty caps an hour, the cleanest rung in the Lab to measure. */
const LEDGER = 'tech_the_ledger_closes';

async function makeBase(): Promise<{ app: FastifyInstance; base: Base }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'ledger_keeper', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  // The same character in every world, so a perk cannot be the difference between them.
  pinOverseer(app, token);
  const base = app.repos.bases.findById(chosen.json<{ base: { id: string } }>().base.id);
  if (!base) throw new Error('fixture: no base');
  return { app, base };
}

/** Caps made over the ten hours before `now`, with the Lab in the given state. */
async function tenHoursOfCaps(now: Date, lab: { owned: boolean; landsAt?: Date }): Promise<number> {
  const { app, base } = await makeBase();
  app.repos.bases.updateResources(base.id, { ...base.resources, caps: 0 });
  app.repos.bases.updateEconomy(base.id, {
    ...base.economy,
    productionSettledAt: new Date(now.getTime() - 10 * HOUR).toISOString(),
  });
  app.repos.bases.updateResearch(base.id, {
    technologies: lab.owned ? [LEDGER] : [],
    active: lab.landsAt
      ? {
          id: 'ledger-run',
          project: { kind: 'technology', techId: LEDGER },
          startedAt: new Date(lab.landsAt.getTime() - 60 * 60_000).toISOString(),
          durationMinutes: 60,
          paid: {},
        }
      : null,
  });
  const settled = settleBase(app.repos, app.repos.bases.findById(base.id)!, now).base;
  return settled.resources.caps;
}

describe('a Lab rung that lands inside the window', () => {
  it('pays from the moment it landed: half the window, half the till', async () => {
    const now = new Date();
    const never = await tenHoursOfCaps(now, { owned: false });
    const always = await tenHoursOfCaps(now, { owned: true });
    const halfway = await tenHoursOfCaps(now, {
      owned: false,
      landsAt: new Date(now.getTime() - 5 * HOUR),
    });

    // The controls: nothing else makes caps, and the rung is worth something over ten hours.
    expect(never).toBe(0);
    expect(always).toBeGreaterThan(100);
    // Neither ignored for the rest of the window nor back-dated over the whole of it.
    expect(Math.abs(2 * halfway - always)).toBeLessThanOrEqual(2);
  });
});

describe('a crew banked past its level on the old curve', () => {
  it('rolls over into the levels it has earned, once, and announces them', async () => {
    const { app, base } = await makeBase();
    const threshold = playerXpToNextLevel(5);
    app.repos.bases.updateProgression(base.id, 5, { xpIntoLevel: threshold + 10 });

    const now = new Date();
    const settled = settleBase(app.repos, app.repos.bases.findById(base.id)!, now).base;
    expect(settled.level).toBe(6);
    expect(settled.progression.xpIntoLevel).toBe(10);
    expect(app.repos.bases.findById(base.id)).toMatchObject({
      level: 6,
      progression: { xpIntoLevel: 10 },
    });
    expect(app.repos.bases.pendingLevelUp(base.id)).toMatchObject({ level: 6, levelsGained: 1 });

    // Idempotent: the next read finds nothing past the line and moves nothing.
    const again = settleBase(app.repos, app.repos.bases.findById(base.id)!, now).base;
    expect(again.level).toBe(6);
    expect(again.progression.xpIntoLevel).toBe(10);
  });
});
