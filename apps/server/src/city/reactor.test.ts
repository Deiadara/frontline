import {
  REACTOR_LOCK_MS,
  featMeasureKey,
  type DistrictDetailResponse,
  type LocationView,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';
import { standingEffectsFor } from '../crew/standing.js';
import { chooseReactor } from './ground.js';
import { startUpgrade } from './upgrade.js';

/**
 * The Reactor Shed and the Records Office at the server (maintainer, 2026-10-14): naming the
 * RADIOACTIVE unit, its 12-hour lock and its mark on the crew, and the Office's cut on the quote
 * and the charge alike.
 */

const SHED = 'blockhouse-reactor';
const OFFICE = 'blockhouse-records';

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

async function world(): Promise<{
  app: FastifyInstance;
  keeper: { token: string; baseId: string };
  stranger: { token: string; baseId: string };
}> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const crew = async (username: string) => {
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username, password: 'hunter2pass' },
    });
    const token = registered.json<{ token: string }>().token;
    const chosen = await chooseOverseer(app, token);
    return { token, baseId: chosen.json<{ base: { id: string } }>().base.id };
  };
  return { app, keeper: await crew('reactor'), stranger: await crew('stranger') };
}

/** A Gauntlet worked up, so the crew can field something to name (Razors and the rest). */
function barracks(app: FastifyInstance, baseId: string): void {
  const base = app.repos.bases.findById(baseId)!;
  app.repos.bases.updateBuildings(baseId, [
    ...base.buildings.filter((building) => building.kind !== 'gauntlet'),
    { id: 'gauntlet', kind: 'gauntlet', level: 10, modifications: [] },
  ]);
}

function keep(app: FastifyInstance, baseId: string, locationId: string, level = 1): void {
  const control = app.repos.city.control(locationId)!;
  app.repos.city.put({ ...control, holder: { kind: 'crew', baseId }, level, garrison: {} });
}

async function district(app: FastifyInstance, token: string, id: string) {
  const res = await app.inject({
    method: 'GET',
    url: `/api/city/${id}`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
  return res.json<DistrictDetailResponse>();
}

const at = (view: DistrictDetailResponse, locationId: string): LocationView =>
  view.locations.find((one) => one.location.id === locationId)!;

const choose = (app: FastifyInstance, token: string, unitId: string) =>
  app.inject({
    method: 'POST',
    url: '/api/city/reactor',
    headers: { authorization: `Bearer ${token}` },
    payload: { locationId: SHED, unitId },
  });

describe('the Reactor Shed', () => {
  it('names a fieldable unit RADIOACTIVE for its holder, and locks the choice for 12 hours', async () => {
    const { app, keeper } = await world();
    barracks(app, keeper.baseId);
    keep(app, keeper.baseId, SHED);
    const before = at(await district(app, keeper.token, 'blockhouse'), SHED).reactor!;
    expect(before.unitId).toBeNull();
    expect(before.options.length).toBeGreaterThan(0);
    const [first, second] = before.options;

    const named = await choose(app, keeper.token, first!.id);
    expect(named.statusCode, named.body.slice(0, 200)).toBe(200);
    const after = at(await district(app, keeper.token, 'blockhouse'), SHED).reactor!;
    expect(after.unitId).toBe(first!.id);
    expect(after.changesAt).not.toBeNull();
    const base = app.repos.bases.findById(keeper.baseId)!;
    expect(standingEffectsFor(app.repos, base).unitMarks[first!.id]).toContain('radioactive');
    expect(app.repos.feats.tallies(keeper.baseId)[featMeasureKey('reactor_choices')]).toBe(1);

    // Locked: a second choice inside the 12 hours is refused, in words.
    if (second) {
      const again = await choose(app, keeper.token, second.id);
      expect(again.statusCode).toBe(409);
      expect(again.body).toContain('locked');
    }
    // ...and allowed once the lock lifts.
    const later = new Date(Date.now() + REACTOR_LOCK_MS + 60_000);
    const next = chooseReactor(app.repos, base, SHED, second?.id ?? first!.id, later);
    expect(next.reactorUnit).toBe(second?.id ?? first!.id);
  });

  it('refuses a stranger, and a unit the holder cannot field', async () => {
    const { app, keeper, stranger } = await world();
    keep(app, keeper.baseId, SHED);
    expect((await choose(app, stranger.token, 'razors')).statusCode).toBe(409);
    expect(at(await district(app, stranger.token, 'blockhouse'), SHED).reactor?.options).toEqual(
      [],
    );
    const legend = await choose(app, keeper.token, 'the_colossus');
    expect(legend.statusCode).toBe(409);
    expect(legend.body).toContain('cannot field');
  });
});

describe('the Records Office', () => {
  it('takes its cut off the quote and the charge alike', async () => {
    const { app, keeper } = await world();
    keep(app, keeper.baseId, 'blockhouse-panel');
    const bare = await district(app, keeper.token, 'blockhouse');
    const full = at(bare, 'blockhouse-panel').upgrade!.cost;
    keep(app, keeper.baseId, OFFICE, 5);
    const cut = at(await district(app, keeper.token, 'blockhouse'), 'blockhouse-panel').upgrade!
      .cost;
    for (const [key, amount] of Object.entries(full)) {
      expect(cut[key as keyof typeof cut]!, key).toBeLessThan(amount!);
    }
    // The charge is the quote.
    const base = app.repos.bases.findById(keeper.baseId)!;
    app.repos.bases.updateResources(base.id, {
      ...base.resources,
      planks: 1_000_000,
      scrap: 1_000_000,
      oil: 1_000_000,
      highQualityMetal: 1_000_000,
      caps: 1_000_000,
      supplies: 1_000_000,
    });
    const rich = app.repos.bases.findById(keeper.baseId)!;
    const outcome = startUpgrade(app.repos, {
      base: rich,
      location: {
        ...at(await district(app, keeper.token, 'blockhouse'), 'blockhouse-panel').location,
      },
      control: app.repos.city.control('blockhouse-panel')!,
      now: new Date(),
    });
    expect(outcome.kind, JSON.stringify(outcome)).toBe('started');
    const paid = app.repos.city.control('blockhouse-panel')!.upgradePaid;
    expect(paid).toEqual(cut);
  });
});
