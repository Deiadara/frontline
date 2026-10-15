import {
  LAMPS_COOLDOWN_MS,
  featMeasureKey,
  findLocation,
  withLamps,
  type CityMutationResponse,
  type DistrictDetailResponse,
  type EnvLabel,
  type LocationView,
  type ScheduledBattle,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { battlefieldOf } from '../battle/resolve.js';
import { chooseOverseer } from '../testing/overseer.js';
import { throwLamps } from './ground.js';

/**
 * Lampman's Row (maintainer, 2026-10-09): the holder lights the lamps or puts them out, at most
 * once every six hours, and every reader of the ground (the district's chips and the fight) sees
 * the same Dark and Foggy.
 */

const ROW = 'ironmouth-lampman';
const SHAFTS = 'ironmouth-shafts';

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
  return { app, keeper: await crew('lampman'), stranger: await crew('stranger') };
}

function keep(app: FastifyInstance, baseId: string, level: number): void {
  const control = app.repos.city.control(ROW)!;
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

const lampLabels = (labels: readonly EnvLabel[]) =>
  labels
    .filter((label) => label.id === 'dark' || label.id === 'foggy')
    .sort((a, b) => a.id.localeCompare(b.id));

const flip = (app: FastifyInstance, token: string, lit: boolean, locationId = ROW) =>
  app.inject({
    method: 'POST',
    url: '/api/city/lamps',
    headers: { authorization: `Bearer ${token}` },
    payload: { locationId, lit },
  });

describe("Lampman's Row", () => {
  it('is taken lit, and lowers the district`s Dark and Foggy by its level', async () => {
    const { app, keeper } = await world();
    const bare = lampLabels(at(await district(app, keeper.token, 'ironmouth'), SHAFTS).labels);
    // A fixture guard: the shafts are Dark on their own, so lighting the lamps has something to do.
    expect(bare.some((label) => label.id === 'dark')).toBe(true);

    keep(app, keeper.baseId, 2);
    const view = await district(app, keeper.token, 'ironmouth');
    expect(at(view, ROW).lamps).toMatchObject({ lit: true, tiers: 2, wholeCity: false });
    expect(lampLabels(at(view, SHAFTS).labels)).toEqual(
      lampLabels(withLamps(bare, { lit: true, tiers: 2 })),
    );
  });

  it('lets the holder put them out, and every reader sees the heavier ground', async () => {
    const { app, keeper } = await world();
    const bare = lampLabels(at(await district(app, keeper.token, 'ironmouth'), SHAFTS).labels);
    keep(app, keeper.baseId, 3);

    const res = await flip(app, keeper.token, false);
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    const view = res.json<CityMutationResponse>().district;
    expect(at(view, ROW).lamps).toMatchObject({ lit: false, tiers: 3 });
    const out = lampLabels(withLamps(bare, { lit: false, tiers: 3 }));
    expect(lampLabels(at(view, SHAFTS).labels)).toEqual(out);
    // Foggy where there was none, at three tiers, unless the sky had already laid some.
    expect(out.find((label) => label.id === 'foggy')?.tier ?? 0).toBeGreaterThanOrEqual(3);

    // The fight on the shafts is had on the same ground the chips show.
    const battle = {
      target: { kind: 'location', districtId: 'ironmouth', locationId: SHAFTS },
      scheduledFor: new Date().toISOString(),
    } as ScheduledBattle;
    const field = battlefieldOf(battle, 'Ironmouth', app.repos.city.controls());
    expect(lampLabels(field.labels)).toEqual(out);
    expect(field.contexts).toContain('dark');
  });

  it('refuses a second change inside six hours, and anybody but the holder', async () => {
    const { app, keeper, stranger } = await world();
    keep(app, keeper.baseId, 1);
    expect((await flip(app, stranger.token, false)).statusCode).toBe(409);
    expect((await flip(app, keeper.token, true)).statusCode).toBe(409);
    expect((await flip(app, keeper.token, false)).statusCode).toBe(200);
    // Counted for the lamps feats, once per change that went through.
    expect(app.repos.feats.tallies(keeper.baseId)[featMeasureKey('lamps_thrown')]).toBe(1);
    const again = await flip(app, keeper.token, true);
    expect(again.statusCode).toBe(409);
    expect(again.json<{ error: { message: string } }>().error.message).toMatch(/changed recently/i);
    // The holder's sheet carries the wait; nobody else's does.
    const own = at(await district(app, keeper.token, 'ironmouth'), ROW).lamps!;
    expect(Date.parse(own.changesAt!) - Date.now()).toBeGreaterThan(LAMPS_COOLDOWN_MS - 60_000);
    expect(at(await district(app, stranger.token, 'ironmouth'), ROW).lamps!.changesAt).toBeNull();

    // Six hours on, it turns again.
    const later = new Date(Date.now() + LAMPS_COOLDOWN_MS + 1_000);
    const base = app.repos.bases.findById(keeper.baseId)!;
    expect(throwLamps(app.repos, base, ROW, true, later).switchedOn).toBe(false);
  });

  it('reaches the whole city at level 5, four tiers, and nothing while nobody keeps it', async () => {
    const { app, keeper } = await world();
    const elsewhere = findLocation('blockhouse-officershalt')!;
    const bare = lampLabels(
      at(await district(app, keeper.token, 'blockhouse'), elsewhere.id).labels,
    );
    const ashfallLabels = async () =>
      (await district(app, keeper.token, 'steelbelt')).locations.map((one) => one.labels);
    const ashfallBefore = await ashfallLabels();
    keep(app, keeper.baseId, 5);
    expect((await flip(app, keeper.token, false)).statusCode).toBe(200);
    const view = await district(app, keeper.token, 'blockhouse');
    expect(lampLabels(at(view, elsewhere.id).labels)).toEqual([
      { id: 'dark', tier: 4 },
      { id: 'foggy', tier: 4 },
    ]);
    // Another city's ground is untouched.
    expect(await ashfallLabels()).toEqual(ashfallBefore);
    // Back to the looters, and the lamps are nobody's: the ground is what it was.
    const control = app.repos.city.control(ROW)!;
    app.repos.city.put({ ...control, holder: { kind: 'looters' } });
    expect(
      lampLabels(at(await district(app, keeper.token, 'blockhouse'), elsewhere.id).labels),
    ).toEqual(bare);
  });
});
