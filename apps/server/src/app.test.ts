import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase, runMigrations, type AppDatabase } from './db/index.js';

let app: FastifyInstance | undefined;
let db: AppDatabase | undefined;

afterEach(async () => {
  await app?.close();
  db?.close();
});

describe('server skeleton', () => {
  it('boots against an in-memory db and serves /health', async () => {
    const config = loadConfig({ DATABASE_PATH: ':memory:' });
    db = openDatabase(config.databasePath);

    const applied = runMigrations(db);
    expect(applied).toContain('0001_init.sql');
    // idempotent: a second run applies nothing
    expect(runMigrations(db)).toEqual([]);

    app = await buildApp({ config, db, logger: false });
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('creates the domain tables', () => {
    const database = openDatabase(':memory:');
    runMigrations(database);
    const tables = database
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    for (const expected of ['users', 'overseers', 'bases', 'battles']) {
      expect(names).toContain(expected);
    }
    database.close();
  });
});
