import type { Base } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { chooseOverseer } from '../../testing/overseer.js';
import { openDatabase, runMigrations, type AppDatabase } from '../index.js';

/**
 * The lists that read every crew, with one crew this build cannot read (bug pass, 2026-10-06).
 *
 * Each threw on the first unreadable row: the standings took the Bar's room, the leaderboard and
 * the fence's shelf down for everybody, and the work-in-flight read stopped the world clock
 * finishing anybody's builds. The SQL behind that read failed outright on malformed JSON, before a
 * row reached the parser at all.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

async function crews(): Promise<{ app: FastifyInstance; db: AppDatabase; ids: string[] }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const ids: string[] = [];
  for (const name of ['readable_one', 'bad_economy', 'bad_research', 'bad_training']) {
    const register = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: name, password: 'hunter2pass' },
    });
    const token = register.json<{ token: string }>().token;
    const chosen = await chooseOverseer(app, token);
    ids.push(chosen.json<{ base: Base }>().base.id);
  }
  return { app, db, ids };
}

describe('a crew this build cannot read, in the lists of every crew', () => {
  it('is left out, and every other crew is still served', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { app, db, ids } = await crews();
    const [readable, badEconomy, badResearch, badTraining] = ids as [
      string,
      string,
      string,
      string,
    ];

    // The readable crew has a rung on the bench, so it is work in flight.
    const base = app.repos.bases.findById(readable)!;
    app.repos.bases.updateResearch(readable, {
      ...base.research,
      active: {
        id: 'rung',
        project: { kind: 'technology', techId: 'tech_open_intake' },
        startedAt: new Date().toISOString(),
        durationMinutes: 60,
        paid: {},
      },
    });
    const corrupt = (column: string, id: string) =>
      db.prepare(`UPDATE bases SET ${column} = '{not json' WHERE id = ?`).run(id);
    corrupt('economy_json', badEconomy);
    corrupt('research_json', badResearch);
    corrupt('training_json', badTraining);

    const standings = app.repos.bases.listStandings().map((row) => row.id);
    expect(standings).toContain(readable);
    expect(standings).not.toContain(badEconomy);
    expect(app.repos.bases.listWorkInFlight().map((row) => row.id)).toEqual([readable]);
    expect(app.repos.bases.listSummaries().map((row) => row.id)).toContain(readable);
  });
});
