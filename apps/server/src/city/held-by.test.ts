import {
  DEFAULT_BADGE,
  findDistrict,
  type DistrictDetailResponse,
  type LocationHolder,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * The table behind a district held whole, for the "Held by" plaque on its painting (maintainer,
 * 2026-09-30). Named only for a crew holding every location, and only when that crew sits at one.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function world() {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const player = async (username: string) => {
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username, password: 'hunter2pass' },
    });
    const token = registered.json<{ token: string }>().token;
    const chosen = await chooseOverseer(app, token);
    const baseId = chosen.json<{ base: { id: string } }>().base.id;
    return { token, baseId, userId: app.repos.bases.findById(baseId)!.ownerId };
  };
  return { app, reader: await player('reader'), holder: await player('holder') };
}

const STEELBELT = findDistrict('steelbelt')!;

function holdEvery(app: FastifyInstance, holder: LocationHolder, but: number = -1): void {
  STEELBELT.locations.forEach((location, index) => {
    const control = app.repos.city.control(location.id)!;
    app.repos.city.put({
      ...control,
      holder: index === but ? { kind: 'unoccupied' } : holder,
    });
  });
}

async function detail(app: FastifyInstance, token: string): Promise<DistrictDetailResponse> {
  return (
    await app.inject({ method: 'GET', url: '/api/city/steelbelt', headers: auth(token) })
  ).json<DistrictDetailResponse>();
}

describe('the table behind a district held whole', () => {
  it('names the faction of the crew holding every location', async () => {
    const { app, reader, holder } = await world();
    const at = new Date().toISOString();
    app.repos.factions.insert({
      id: 'held-table',
      name: 'The Held Table',
      badge: DEFAULT_BADGE,
      blurb: '',
      foundedAt: at,
    });
    app.repos.factions.addMember({
      userId: holder.userId,
      factionId: 'held-table',
      rank: 'leader',
      joinedAt: at,
    });
    holdEvery(app, { kind: 'crew', baseId: holder.baseId });

    const seen = await detail(app, reader.token);
    expect(seen.holder).toEqual({ kind: 'crew', baseId: holder.baseId });
    expect(seen.holderFaction).toEqual({ name: 'The Held Table', badge: DEFAULT_BADGE });
  });

  it('names none for a crew at no table, for the Combine, or for ground held in pieces', async () => {
    const { app, reader, holder } = await world();
    holdEvery(app, { kind: 'crew', baseId: holder.baseId });
    expect((await detail(app, reader.token)).holderFaction).toBeNull();

    holdEvery(app, { kind: 'government' });
    const combine = await detail(app, reader.token);
    expect(combine.holder).toEqual({ kind: 'government' });
    expect(combine.holderFaction).toBeNull();

    holdEvery(app, { kind: 'crew', baseId: holder.baseId }, 0);
    const pieces = await detail(app, reader.token);
    expect(pieces.holder).toBeNull();
    expect(pieces.holderFaction).toBeNull();
  });
});
