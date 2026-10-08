import {
  type Base,
  type Building,
  type BuildQueueEntry,
  type PartialResources,
  type Resources,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { standingEffectsFor } from '../crew/standing.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';
import { cancelBuild, queueBuild } from './build.js';
import { productionRatesFor, settleBase } from './settle.js';

/**
 * The district's economy over simulated days, through the real settle (bug pass 3, 2026-10-05).
 *
 * Every figure below is worked out by hand from the catalogue, written into the test as a number,
 * and then asked of the server three ways: settled once at the end, settled every minute, and
 * settled at a scatter of odd instants. A lazy settle that depended on when it was read would
 * split the three; one that priced a segment against the wrong district would miss the hand
 * figure.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const START = new Date('2026-10-05T00:00:00.000Z');
const at = (ms: number): Date => new Date(START.getTime() + ms);

let accounts = 0;

const plot = (kind: Building['kind'], level: number): Building => ({
  id: `${kind}-sim`,
  kind,
  level,
  modifications: [],
});

/**
 * A crew with nobody in a chair and the default Overseer pinned, on the district and stockpile
 * given, its production clock stamped at {@link START}.
 */
async function district(
  buildings: Building[],
  resources: Partial<Resources>,
  queue: BuildQueueEntry[] = [],
  disruption?: Base['economy']['disruption'],
): Promise<{ app: FastifyInstance; id: string }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  accounts += 1;
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: `economy_days_${accounts}`, password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  pinOverseer(app, token);
  const id = chosen.json<{ base: { id: string } }>().base.id;
  const fresh = app.repos.bases.findById(id)!;
  app.repos.bases.updateCommanders(
    id,
    fresh.commanders.map((one) => ({ ...one, role: null })),
  );
  app.repos.bases.updateDistrict(id, buildings, queue);
  app.repos.bases.updateResources(id, { ...fresh.resources, ...resources });
  app.repos.bases.updateEconomy(id, {
    ...fresh.economy,
    productionSettledAt: START.toISOString(),
    productionCarry: {},
    ...(disruption ? { disruption } : {}),
  });
  return { app, id };
}

const read = (app: FastifyInstance, id: string): Base => app.repos.bases.findById(id)!;
const settleAt = (app: FastifyInstance, id: string, when: Date): Base =>
  settleBase(app.repos, read(app, id), when).base;

const STOCK_KEYS = ['supplies', 'oil', 'scrap', 'highQualityMetal', 'planks'] as const;
const stockOf = (base: Base): PartialResources =>
  Object.fromEntries(STOCK_KEYS.map((key) => [key, base.resources[key]]));

describe('two days of a district, settled once, every minute and at odd instants', () => {
  /*
   * Greenhouse 7 (8 once its order lands at 7:13:07), Scrapyard 9, Generator 5, Apothecary 12.
   * A raid's 30% cut runs from 5:17 to 11:17, across the landing. The Apothecary holds 8,698 of
   * bulk, so 5,799 of supplies (two thirds), which the Greenhouse fills inside the two days.
   */
  const buildings = [
    plot('nexus', 6),
    plot('greenhouse', 7),
    plot('scrapyard', 9),
    plot('generator', 5),
    plot('apothecary', 12),
  ];
  const landsAfterSeconds = 7 * 3600 + 13 * 60 + 7;
  const queue: BuildQueueEntry[] = [
    {
      id: 'greenhouse-up',
      kind: 'greenhouse',
      level: 8,
      startedAt: START.toISOString(),
      durationSeconds: landsAfterSeconds,
      xp: 10,
      paid: {},
      parts: {},
    },
  ];
  const disruption = {
    since: at(5 * HOUR + 17 * MINUTE).toISOString(),
    until: at(11 * HOUR + 17 * MINUTE).toISOString(),
    percent: 30,
  };
  const empty = { supplies: 0, oil: 0, scrap: 0, highQualityMetal: 0, planks: 0 };
  const DAYS = 48 * HOUR;

  /*
   * By hand. Oil: 30 an hour for 48 hours, less 30% of six hours' worth: 1,440 - 54 = 1,386.
   * Scrap: 90 an hour, 4,320 - 162 = 4,158. Metal: 11.25 an hour, 540 - 20.25 = 519.75, so 519
   * banked and 0.75 carried. Planks: 56 an hour to the landing at 7.21861 h and 64 after it,
   * 3,014.2511, less 30% of what the raid window made (56 x 1.93528 + 64 x 4.06472 = 368.5178),
   * 110.5553: 2,903.6958, so 2,903. Supplies reach the 5,799 store.
   */
  const expected = { supplies: 5799, oil: 1386, scrap: 4158, highQualityMetal: 519, planks: 2903 };

  it('banks the hand-worked totals when settled once', async () => {
    const { app, id } = await district(buildings, empty, queue, disruption);
    // Nobody in a chair and no ground: the crew adds nothing, so the rates are the structures'.
    expect(productionRatesFor(app.repos, read(app, id), START)).toEqual({
      supplies: 134.4,
      oil: 30,
      scrap: 90,
      highQualityMetal: 11.25,
      planks: 56,
    });
    const lump = settleAt(app, id, at(DAYS));
    expect(stockOf(lump)).toEqual(expected);
    expect(lump.economy.productionCarry.highQualityMetal).toBeCloseTo(0.75, 9);
    expect(lump.buildings.find((one) => one.kind === 'greenhouse')?.level).toBe(8);
  });

  /*
   * 2,880 settles, each reading every control row in the world six times over (`standingEffectsFor`
   * and `unit-slots.ts`, through `repos.city.controls()`), which is 1.7 ms a settle with Arca's
   * 128 rows on the map (2026-10-07) and 5 s for the loop: the default timeout to the millisecond,
   * and over it under a full-suite load. The loop is the point of the case, so it gets the room.
   */
  it('banks the same totals settled every minute', async () => {
    const { app, id } = await district(buildings, empty, queue, disruption);
    let last = read(app, id);
    for (let t = MINUTE; t <= DAYS; t += MINUTE) last = settleAt(app, id, at(t));
    expect(stockOf(last)).toEqual(expected);
  }, 30_000);

  it('banks the same totals settled at odd instants, including sub-second rereads', async () => {
    const { app, id } = await district(buildings, empty, queue, disruption);
    // A deterministic scatter: steps of 1 ms to 97 minutes, with the raid's two edges and the
    // landing falling inside steps rather than on them.
    let t = 0;
    let step = 7;
    while (t < DAYS) {
      settleAt(app, id, at(t));
      step = (step * 7919 + 13) % (97 * MINUTE);
      t += Math.max(1, step);
    }
    const last = settleAt(app, id, at(DAYS));
    expect(stockOf(last)).toEqual(expected);
  });
});

describe('the store ceiling', () => {
  it('keeps a stockpile already over the ceiling, adds nothing to it and takes nothing away', async () => {
    // Apothecary 3: 1,453 of bulk, 969 of oil. 5,000 held, a Generator making 30 an hour.
    const { app, id } = await district(
      [plot('nexus', 6), plot('generator', 5), plot('apothecary', 3)],
      {
        oil: 5000,
        scrap: 0,
      },
    );
    const settled = settleAt(app, id, at(24 * HOUR));
    expect(settled.resources.oil).toBe(5000);
    expect(settled.resources.scrap).toBe(0);
  });
});

describe('a build queued, called off and queued again', () => {
  it('never gains a unit: each round trip costs exactly the tenth that is kept', async () => {
    const buildings = [
      plot('nexus', 8),
      plot('generator', 6),
      plot('quarters', 6),
      plot('apothecary', 14),
    ];
    const stock = {
      caps: 10_000,
      supplies: 5_000,
      oil: 1_000,
      scrap: 2_000,
      planks: 3_000,
      highQualityMetal: 500,
    };
    const { app, id } = await district(buildings, stock);
    // The figure the formula below assumes: no build points from the crew or the ground.
    const effects = standingEffectsFor(app.repos, read(app, id), START);
    expect(effects.buildCostPercent).toBe(0);
    expect(effects.buildSpeedPercent).toBe(0);

    /*
     * Quarters 7 by hand: the catalogue's line x 1.1 x 1.28^6 (4.83776), rounded; metal from the
     * fifth level, 30 x 1.1 x 1.28^2. The clock is 140 x 1.4^6 = 1,054 s, and a Generator 6 takes
     * 15 points off it, under the knee: 896 s.
     */
    const price = {
      caps: 242,
      supplies: 968,
      oil: 97,
      scrap: 194,
      planks: 532,
      highQualityMetal: 54,
    };
    const kept = { caps: 25, supplies: 97, oil: 10, scrap: 20, planks: 54, highQualityMetal: 6 };

    let base = read(app, id);
    let now = START;
    for (let round = 1; round <= 5; round += 1) {
      const queued = queueBuild(app.repos, { base, structure: 'quarters', id: `q-${round}`, now });
      if (queued.kind !== 'queued') throw new Error(`round ${round}: ${queued.reason}`);
      expect(queued.entry.level).toBe(7);
      expect(queued.entry.paid).toEqual(price);
      expect(queued.entry.durationSeconds).toBe(896);
      // Inside the first tenth of 896 s.
      now = new Date(now.getTime() + 89 * SECOND);
      const cancelled = cancelBuild(app.repos, queued.base, `q-${round}`, now);
      if (cancelled.kind !== 'cancelled') throw new Error(`round ${round}: ${cancelled.reason}`);
      base = cancelled.base;
      for (const key of Object.keys(price) as (keyof typeof price)[]) {
        expect(base.resources[key], `${key} after round ${round}`).toBe(
          stock[key] - round * kept[key],
        );
      }
      now = new Date(now.getTime() + SECOND);
    }
    // And the window shuts at a tenth: 90 s into 896 is past it.
    const late = queueBuild(app.repos, { base, structure: 'quarters', id: 'q-late', now });
    if (late.kind !== 'queued') throw new Error(late.reason);
    expect(
      cancelBuild(app.repos, late.base, 'q-late', new Date(now.getTime() + 90 * SECOND)).kind,
    ).toBe('refused');
  });
});
