import { type UnitsResponse } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * What cancels a ground label, named on the card (maintainer, 2026-10-15).
 *
 * Three things stop a label biting a crew's unit and the engine reads all three: a Tolling Tower
 * whose bells ring (Noisy), a held place that makes the crew immune (the Frontier Chapel's
 * Eerie), and a unit's own door (the Crimson Stage's Crammed and Wet from level 4). The card used
 * to credit every one to the tower and missed the door's; each affinity row carries its own now.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

async function roster(
  holdings: Record<string, number>,
  switchedOn: readonly string[] = [],
): Promise<UnitsResponse> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'bellringer', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const baseId = (await chooseOverseer(app, token)).json<{ base: { id: string } }>().base.id;
  for (const [locationId, level] of Object.entries(holdings)) {
    const control = app.repos.city.control(locationId)!;
    app.repos.city.put({
      ...control,
      holder: { kind: 'crew', baseId },
      level,
      garrison: {},
      ...(switchedOn.includes(locationId) ? { switchedOn: true } : {}),
    });
  }
  const read = await app.inject({
    method: 'GET',
    url: '/api/units',
    headers: { authorization: `Bearer ${token}` },
  });
  expect(read.statusCode, read.body.slice(0, 300)).toBe(200);
  return read.json<UnitsResponse>();
}

const cancelled = (units: UnitsResponse, unitId: string, label: string) =>
  units.units.find((unit) => unit.id === unitId)?.affinities.find((row) => row.id === label)
    ?.cancelledBy;

describe('what cancels a ground label, on the card', () => {
  it('names nothing for a crew that holds nothing', async () => {
    const bare = await roster({});
    expect(cancelled(bare, 'ghosts', 'noisy')).toBeNull();
    expect(cancelled(bare, 'stitchers', 'eerie')).toBeNull();
    expect(cancelled(bare, 'the_crimson_dancer', 'crammed')).toBeNull();
  });

  it('names the Tolling Tower while its bells ring, and only then', async () => {
    const tower = 'bellfounders-tollingtower';
    expect(cancelled(await roster({ [tower]: 1 }), 'ghosts', 'noisy')).toBeNull();
    expect(cancelled(await roster({ [tower]: 1 }, [tower]), 'ghosts', 'noisy')).toBe(
      'The Tolling Tower, while the bells ring',
    );
  });

  it('names the held place that makes the crew immune', async () => {
    expect(cancelled(await roster({ 'blockhouse-chapel': 1 }), 'stitchers', 'eerie')).toBe(
      'The Frontier Chapel',
    );
  });

  it('names the door from the level that cancels the label, for that unit alone', async () => {
    expect(
      cancelled(await roster({ 'bloodstone-stage': 3 }), 'the_crimson_dancer', 'crammed'),
    ).toBeNull();
    const at4 = await roster({ 'bloodstone-stage': 4 });
    expect(cancelled(at4, 'the_crimson_dancer', 'crammed')).toBe('The Crimson Stage at level 4');
    expect(cancelled(at4, 'the_crimson_dancer', 'wet')).toBe('The Crimson Stage at level 4');
    // Her good ground is not a weakness, so nothing cancels it.
    expect(cancelled(at4, 'the_crimson_dancer', 'open')).toBeNull();
  });
});
