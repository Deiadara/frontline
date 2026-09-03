import {
  buildingCost,
  createCommander,
  nextQueuedLevel,
  type Base,
  type BuildQuotes,
  type MeResponse,
  type Resources,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';

/**
 * The price on the dialog is the price at the till.
 *
 * `queueBuild` charges `discounted(buildingCost(...), buildCostPercent + buildingCostPercent[kind])`
 * and its affordability gate read the *bare* `buildingCost`, so a crew that could afford what it
 * would actually be charged was refused `cannot_afford` for a price nothing would ever have taken
 * off them. And the dialog quoted the catalogue price, because `buildingCostPercent` is a
 * per-structure record and the effects on the wire are flat numbers, so no client-side fix existed.
 * Same shape as the Downtown Market, where the shelf quoted the catalogue price and the till
 * charged the discounted one.
 *
 * Driven as an ordinary player throughout: admin mode waives `cannot_afford` outright, so a test
 * that ran under it could not see any of this.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

/** The Bench Sponsor: 25% off the Lab and nothing off anything else. */
const SPONSOR = 'bench_sponsor';
const SPONSORED = 'lab' as const;

async function makeStack(): Promise<{ app: FastifyInstance; token: string; baseId: string }> {
  const config = loadConfig({
    DATABASE_PATH: ':memory:',
    JWT_SECRET: 'test-secret',
    // The real economy, not the testing build: `cannot_afford` is one of the refusals admin waives.
    ADMIN: 'false',
  });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'the_builder', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
  const baseId = chosen.json<{ base: { id: string } }>().base.id;

  const base = app.repos.bases.findById(baseId);
  if (!base) throw new Error('no base');
  // Everything the Lab actually asks for, so the refusal under test is the price and not a gate in
  // front of it: a Nexus senior enough to authorise it, the Apothecary it wants, and the crew level.
  app.repos.bases.updateBuildings(baseId, [
    ...base.buildings.map((building) =>
      building.kind === 'nexus' ? { ...building, level: 10 } : building,
    ),
    { id: 'b-apothecary', kind: 'apothecary', level: 4, modifications: [], damage: 0 },
  ]);
  app.repos.bases.updateProgression(baseId, 9, base.progression);
  app.repos.bases.updateCommanders(baseId, [
    createCommander('off-1', 'Vasso', null, {}, [SPONSOR]),
  ]);
  return { app, token, baseId };
}

const quoteFor = async (app: FastifyInstance, token: string): Promise<BuildQuotes> => {
  const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
  return me.json<MeResponse>().buildQuotes ?? {};
};

describe('what a structure costs', () => {
  it('is quoted with the crew’s discount already taken off', async () => {
    const { app, token, baseId } = await makeStack();
    const base = app.repos.bases.findById(baseId);
    if (!base) throw new Error('no base');

    const level = nextQueuedLevel(SPONSORED, base.buildings, base.buildQueue);
    if (level === null) throw new Error('fixture: the Lab has nothing to queue');
    const catalogue = buildingCost(SPONSORED, level, base.buildings);

    const quotes = await quoteFor(app, token);
    const quoted = quotes[SPONSORED];
    if (!quoted) throw new Error('no quote for the sponsored structure');

    // Cheaper than the catalogue, which is the whole claim.
    expect(quoted.scrap ?? 0).toBeLessThan(catalogue.scrap ?? 0);
    /*
     * ...and the perk's 25% is *on top of* whatever comes off everything.
     *
     * The officer's own attributes already push `buildCostPercent`, so an unsponsored structure is
     * discounted too. The claim here is the narrow one: the Bench Sponsor names the Lab, so the Lab
     * has to be cheaper *as a share of its own catalogue price* than a structure the perk does not
     * name. A blanket discount wearing a per-structure perk's name would fail this.
     */
    const share = (kind: 'lab' | 'quarters') => {
      const next = nextQueuedLevel(kind, base.buildings, base.buildQueue);
      if (next === null) throw new Error(`fixture: nothing to queue for ${kind}`);
      const full = buildingCost(kind, next, base.buildings).scrap ?? 0;
      expect(full, kind).toBeGreaterThan(0);
      return (quotes[kind]?.scrap ?? 0) / full;
    };
    expect(share('lab')).toBeLessThan(share('quarters'));
  });

  it('lets a crew build what the quote says they can afford', async () => {
    const { app, token, baseId } = await makeStack();
    const quotes = await quoteFor(app, token);
    const quoted = quotes[SPONSORED];
    if (!quoted) throw new Error('no quote for the sponsored structure');

    // Exactly the quoted price on the shelf, and not a unit more. Under the old gate this is
    // refused, because the gate read the undiscounted figure.
    const exact = { ...(quoted as Partial<Resources>) } as Resources;
    const stocked: Resources = {
      caps: exact.caps ?? 0,
      supplies: exact.supplies ?? 0,
      oil: exact.oil ?? 0,
      scrap: exact.scrap ?? 0,
      highQualityMetal: exact.highQualityMetal ?? 0,
      planks: exact.planks ?? 0,
    };
    app.repos.bases.updateResources(baseId, stocked);

    const ordered = await app.inject({
      method: 'POST',
      url: '/api/base/build',
      headers: auth(token),
      payload: { kind: SPONSORED },
    });
    expect(ordered.statusCode, ordered.body.slice(0, 300)).toBe(200);

    // And it took exactly the quote, leaving nothing behind.
    const after = app.repos.bases.findById(baseId) as Base;
    for (const key of Object.keys(stocked) as (keyof Resources)[]) {
      expect(after.resources[key], key).toBe(0);
    }
    expect(after.buildQueue).toHaveLength(1);
  });

  it('still refuses a crew that is short of the discounted price', async () => {
    const { app, token, baseId } = await makeStack();
    const quotes = await quoteFor(app, token);
    const quoted = quotes[SPONSORED];
    if (!quoted) throw new Error('no quote for the sponsored structure');

    app.repos.bases.updateResources(baseId, {
      caps: (quoted.caps ?? 0) + 10,
      supplies: (quoted.supplies ?? 0) + 10,
      oil: (quoted.oil ?? 0) + 10,
      scrap: Math.max(0, (quoted.scrap ?? 0) - 1),
      highQualityMetal: (quoted.highQualityMetal ?? 0) + 10,
      planks: (quoted.planks ?? 0) + 10,
    });

    const ordered = await app.inject({
      method: 'POST',
      url: '/api/base/build',
      headers: auth(token),
      payload: { kind: SPONSORED },
    });
    expect(ordered.statusCode).toBe(409);
    // For the price, not for one of the gates in front of it: a 409 on its own would pass on a
    // locked structure and measure nothing.
    expect(ordered.json<{ error: { code: string } }>().error.code).toBe('INSUFFICIENT_RESOURCES');
  });
});
