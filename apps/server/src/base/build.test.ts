import {
  BUILDING_MAX_LEVEL,
  PLAYER_XP_AWARDS,
  STARTING_RESOURCES,
  buildingCost,
  spendResources,
  type Base,
  type BuildingKind,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';

/**
 * The hideout's one write path (GDD §A1, §D3, §I1): oil comes out of the ledger W2 already owns,
 * the structure goes up, and W6's XP curve gets the award it was priced for.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

interface Player {
  app: FastifyInstance;
  token: string;
  baseId: string;
}

async function newPlayer(username = 'builder'): Promise<Player> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: { authorization: `Bearer ${token}` },
    payload: { presetId: 'enforcer' },
  });
  return { app, token, baseId: chosen.json<{ base: { id: string } }>().base.id };
}

function build(player: Player, kind: BuildingKind) {
  return player.app.inject({
    method: 'POST',
    url: '/api/base/build',
    headers: { authorization: `Bearer ${player.token}` },
    payload: { kind },
  });
}

/** Rewrites the stored base so a test can start from a state the starting stockpile cannot reach. */
function overwrite(player: Player, patch: Partial<Base>): Base {
  const base = player.app.repos.bases.findById(player.baseId);
  if (!base) throw new Error('base vanished');
  const next = { ...base, ...patch };
  if (patch.resources) player.app.repos.bases.updateResources(next.id, next.resources);
  if (patch.buildings) player.app.repos.bases.updateBuildings(next.id, next.buildings);
  return next;
}

describe('POST /base/build (GDD §A1, §D3)', () => {
  it('builds an empty plot at level 1 and charges the catalogue price in oil', async () => {
    const player = await newPlayer();
    // The starter base has a Command Center and a Reactor; the Foundry plot is empty.
    const res = await build(player, 'foundry');

    expect(res.statusCode).toBe(200);
    const { base } = res.json<{ base: Base }>();
    expect(base.buildings.find((b) => b.kind === 'foundry')?.level).toBe(1);
    expect(base.resources).toEqual(spendResources(STARTING_RESOURCES, buildingCost('foundry', 1)));
    expect(base.resources.oil).toBeLessThan(STARTING_RESOURCES.oil);
  });

  it('upgrades a standing structure instead of building a second one', async () => {
    const player = await newPlayer();
    overwrite(player, {
      resources: { caps: 90_000, food: 500, oil: 90_000, scrap: 90_000, highQualityMetal: 500 },
    });
    const res = await build(player, 'command_center');

    expect(res.statusCode).toBe(200);
    const { base } = res.json<{ base: Base }>();
    const centers = base.buildings.filter((b) => b.kind === 'command_center');
    expect(centers).toHaveLength(1);
    expect(centers[0]?.level).toBe(2);
  });

  /*
   * The shape of the opening — the thing a retune of either `STARTING_RESOURCES` or the catalogue
   * prices can quietly destroy, since the two constants live in different files and neither knows
   * about the other. Three properties, because pinning only the last two let through a state where
   * a fresh hideout could afford exactly *one* of its four empty plots and every other click was a
   * refusal, which reads as "tight" to a test and as a dead opening to a player.
   */
  const EMPTY_PLOTS: readonly BuildingKind[] = ['data_hub', 'foundry', 'barracks', 'wall'];

  it('leaves no empty plot unaffordable on turn one', async () => {
    for (const kind of EMPTY_PLOTS) {
      const player = await newPlayer();
      expect((await build(player, kind)).statusCode, kind).toBe(200);
    }
  });

  it('opens with three builds in reach, and makes oil the thing that runs out', async () => {
    const player = await newPlayer();
    // The cheapest three by oil; §D3 wants the sink to be what ends the first session.
    for (const kind of ['data_hub', 'foundry', 'wall'] as const) {
      expect((await build(player, kind)).statusCode, kind).toBe(200);
    }
    expect(player.app.repos.bases.findById(player.baseId)?.resources.oil).toBe(0);

    const fourth = await build(player, 'barracks');
    expect(fourth.statusCode).toBe(409);
    expect(fourth.json<{ error: { code: string } }>().error.code).toBe('INSUFFICIENT_RESOURCES');
  });

  it('makes the first Command Center upgrade something you have to earn', async () => {
    const player = await newPlayer();
    const upgrade = await build(player, 'command_center');

    expect(upgrade.statusCode).toBe(409);
    expect(upgrade.json<{ error: { code: string } }>().error.code).toBe('INSUFFICIENT_RESOURCES');
  });

  it('persists the spend and the structure', async () => {
    const player = await newPlayer();
    await build(player, 'foundry');

    const stored = player.app.repos.bases.findById(player.baseId);
    expect(stored?.buildings.map((b) => b.kind)).toContain('foundry');
    expect(stored?.resources.oil).toBe(
      STARTING_RESOURCES.oil - (buildingCost('foundry', 1).oil ?? 0),
    );
  });

  it('banks the §I1 XP that building things is worth', async () => {
    const player = await newPlayer();
    await build(player, 'foundry');

    const stored = player.app.repos.bases.findById(player.baseId);
    expect(stored?.progression.xpIntoLevel).toBe(PLAYER_XP_AWARDS.buildingConstructed);
  });

  it('announces the level a build paid for, and only on the response that crossed it', async () => {
    const player = await newPlayer();
    // Enough materials that the build itself cannot be the thing that refuses.
    overwrite(player, {
      resources: { caps: 90_000, food: 500, oil: 90_000, scrap: 90_000, highQualityMetal: 500 },
    });

    const first = await build(player, 'foundry');
    expect(first.json<{ levelUp?: unknown }>().levelUp).toBeUndefined();

    let crossed: unknown;
    for (let i = 0; i < 10 && crossed === undefined; i += 1) {
      crossed = (await build(player, 'command_center')).json<{ levelUp?: unknown }>().levelUp;
    }
    expect(crossed).toMatchObject({ level: 2, levelsGained: 1 });
  });

  it('refuses a structure the stockpile cannot cover, and takes nothing', async () => {
    const player = await newPlayer();
    const broke = { caps: 0, food: 0, oil: 0, scrap: 0, highQualityMetal: 0 };
    overwrite(player, { resources: broke });

    const res = await build(player, 'foundry');
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('INSUFFICIENT_RESOURCES');
    const stored = player.app.repos.bases.findById(player.baseId);
    expect(stored?.resources).toEqual(broke);
    expect(stored?.buildings.map((b) => b.kind)).not.toContain('foundry');
  });

  it('refuses to raise anything past the Command Center', async () => {
    const player = await newPlayer();
    overwrite(player, {
      resources: { caps: 90_000, food: 500, oil: 90_000, scrap: 90_000, highQualityMetal: 500 },
    });
    // Command Center 1, Reactor 1 — the reactor is already level with it.
    const res = await build(player, 'reactor');

    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('COMMAND_CENTER_CAP');
  });

  it('refuses a structure that is already at the content ceiling', async () => {
    const player = await newPlayer();
    overwrite(player, {
      resources: { caps: 900_000, food: 500, oil: 900_000, scrap: 900_000, highQualityMetal: 500 },
      buildings: [{ id: 'cc', kind: 'command_center', level: BUILDING_MAX_LEVEL }],
    });

    const res = await build(player, 'command_center');
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('STRUCTURE_AT_MAX_LEVEL');
  });

  it('rejects a kind that is not in the catalogue', async () => {
    const player = await newPlayer();
    const res = await player.app.inject({
      method: 'POST',
      url: '/api/base/build',
      headers: { authorization: `Bearer ${player.token}` },
      payload: { kind: 'orbital_cannon' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuses an unauthenticated caller', async () => {
    const player = await newPlayer();
    const res = await player.app.inject({
      method: 'POST',
      url: '/api/base/build',
      payload: { kind: 'foundry' },
    });
    expect(res.statusCode).toBe(401);
  });
});
