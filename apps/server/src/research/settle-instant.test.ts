import {
  RESEARCH_ITEMS,
  buildingLevel,
  createCommander,
  makeAttributes,
  type Base,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';
import { settleDistrict } from '../district/settle.js';
import { settleMuster } from '../units/muster.js';
import { settleResearch } from './settle.js';

/**
 * A finished rung, unit or building pays its XP as the crew stood at the settle's instant (bug
 * pass, 2026-10-06).
 *
 * The award read the crew's XP bonus at the wall clock, so a world settle running for a later
 * instant paid without a perk officer who was laid up now and fit by then: the same mismatch the
 * mission award had.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

let accounts = 0;
const HOUR = 3_600_000;

/**
 * A crew whose one officer carries War Story (+10% XP), laid up until `injuredUntil`. In a chair,
 * because an officer on the bench counts for nothing at all.
 */
async function crewWithStoryteller(injuredUntil: string | null): Promise<{
  app: FastifyInstance;
  base: Base;
}> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  accounts += 1;
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: `rung_instant_${accounts}`, password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  pinOverseer(app, token);
  const baseId = chosen.json<{ base: { id: string } }>().base.id;
  const storyteller = {
    ...createCommander('storyteller', 'Storyteller', 'fixer', makeAttributes(50), ['war_story']),
    injuredUntil,
  };
  app.repos.bases.updateCommanders(baseId, [storyteller]);
  return { app, base: app.repos.bases.findById(baseId)! };
}

describe('a rung settled for a later instant', () => {
  it('pays with the officers fit at that instant, not at the wall clock', async () => {
    const later = new Date(Date.now() + 2 * HOUR);
    const rung = RESEARCH_ITEMS[0]!;
    const paidAt = async (injuredUntil: string | null) => {
      const { app, base } = await crewWithStoryteller(injuredUntil);
      const running: Base = {
        ...base,
        research: {
          ...base.research,
          active: {
            id: 'rung',
            project: { kind: 'technology', techId: rung.id },
            startedAt: new Date(Date.now() - HOUR).toISOString(),
            durationMinutes: 60,
            paid: {},
          },
        },
      };
      const { awards } = settleResearch(app.repos, running, undefined, later);
      expect(awards).toHaveLength(1);
      return awards[0]!;
    };

    const fitThroughout = await paidAt(null);
    const fitByThen = await paidAt(new Date(Date.now() + HOUR).toISOString());
    expect(fitByThen).toEqual(fitThroughout);
    // And the perk is worth something, or the comparison above proves nothing.
    const laidUpThen = await paidAt(new Date(Date.now() + 3 * HOUR).toISOString());
    expect(laidUpThen).not.toEqual(fitThroughout);
  });
});

/**
 * The same comparison for every award a settle pays: the crew fit throughout, fit by the settle's
 * instant, and still laid up then. The first two must pay alike and the third less.
 */
async function threeCrews(
  settle: (app: FastifyInstance, base: Base, later: Date) => unknown,
): Promise<unknown[]> {
  const later = new Date(Date.now() + 2 * HOUR);
  const results: unknown[] = [];
  for (const injuredUntil of [null, Date.now() + HOUR, Date.now() + 3 * HOUR]) {
    const { app, base } = await crewWithStoryteller(
      injuredUntil === null ? null : new Date(injuredUntil).toISOString(),
    );
    results.push(settle(app, base, later));
  }
  return results;
}

describe('a batch or a build settled for a later instant', () => {
  it('pays a mustered unit with the officers fit at that instant', async () => {
    const [fit, fitByThen, laidUp] = await threeCrews((app, base, later) => {
      const queued: Base = {
        ...base,
        musterQueue: [
          {
            id: 'batch',
            unitId: 'razors',
            count: 1,
            delivered: 0,
            startedAt: new Date(Date.now() - HOUR).toISOString(),
            durationSeconds: 60,
            paid: {},
          },
        ],
      };
      return settleMuster(app.repos, queued, later).awards;
    });
    expect(fitByThen).toEqual(fit);
    expect(laidUp).not.toEqual(fit);
  });

  it('pays a finished building with the officers fit at that instant', async () => {
    const [fit, fitByThen, laidUp] = await threeCrews((app, base, later) => {
      const queued: Base = {
        ...base,
        buildQueue: [
          {
            id: 'build',
            kind: 'lab',
            level: buildingLevel(base.buildings, 'lab') + 1,
            startedAt: new Date(Date.now() - HOUR).toISOString(),
            durationSeconds: 60,
            xp: 500,
            paid: {},
            parts: {},
          },
        ],
      };
      return settleDistrict(app.repos, queued, later).awards;
    });
    expect(fitByThen).toEqual(fit);
    expect(laidUp).not.toEqual(fit);
  });
});
