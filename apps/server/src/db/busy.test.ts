/**
 * A held write lock is a 503, not a 500 (soak finding, 2026-09-17).
 *
 * SQLite takes one writer at a time. A second process on the same file, which is a backup, an
 * admin script, a migration runner or a second instance, can hold that lock while the server is
 * mid-request. A transaction that has already read is then refused immediately rather than
 * waiting, because waiting for a read-to-write upgrade is how two connections deadlock, so SQLite
 * answers `SQLITE_BUSY` whatever `busy_timeout` says.
 *
 * It was surfaced by a soak that moved a battle's clock through a second connection while five
 * crews were playing: an ordinary `POST /units/train` came back `500 INTERNAL`. Nothing was
 * half-written and nothing was wrong with the request, so 500 is a lie in both directions. It
 * tells the player the game broke, and it tells an uptime check the server is unhealthy, when what
 * happened is that a moment was busy and the press is safe to repeat.
 *
 * Reproduced with a real second connection rather than a stubbed error, because the thing worth
 * pinning is the interleaving: a fake `SqliteError` would pass against a handler that never sees
 * the real one.
 *
 * The contended call is a **registration**, and that matters. It was `POST /units/train` until
 * 2026-09-18, on the argument that an authenticated write reads before it writes and is therefore
 * refused the lock instantly. That stopped being reliable the day the per-structure damage system
 * was retired: the settle walk it leaned on no longer writes when nothing has finished building,
 * so the request reached the unit gate and came back `UNIT_LOCKED` without ever touching the
 * database, and the test was measuring a refusal that had nothing to do with locks. A registration
 * writes unconditionally and has no gate in front of it, so the only thing that can refuse it here
 * is the lock.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { chooseOverseer } from '../testing/overseer.js';
import { openDatabase, runMigrations, type AppDatabase } from './index.js';

const open: { app: FastifyInstance; db: AppDatabase; other: AppDatabase; dir: string }[] = [];
afterEach(async () => {
  for (const one of open.splice(0)) {
    await one.app.close();
    one.other.close();
    one.db.close();
    rmSync(one.dir, { recursive: true, force: true });
  }
});

/**
 * A server on a file database with one crew already made, plus a second connection to the file.
 *
 * The crew exists *before* the lock is taken on purpose. The path this is about is a write that
 * reads first, which is every authenticated write the game has: it takes no lock at `BEGIN`, reads,
 * and is then refused instantly when it tries to upgrade. A transaction that writes immediately
 * would instead wait out `busy_timeout` and usually succeed, which is the behaviour we want and
 * not the one that was breaking.
 */
async function hosted(): Promise<{ app: FastifyInstance; other: AppDatabase; token: string }> {
  const dir = mkdtempSync(path.join(tmpdir(), 'frontline-busy-'));
  const file = path.join(dir, 'world.sqlite');
  const config = loadConfig({ DATABASE_PATH: file, JWT_SECRET: 'test-secret' });
  const db = openDatabase(file);
  /*
   * A short wait, so the test measures the refusal rather than the waiting.
   *
   * better-sqlite3 waits `busy_timeout` (five seconds by default) for a held write lock before it
   * gives up, and giving up is the case this file is about. A lock held longer than the wait and a
   * lock that cannot be waited for at all both arrive here as the same `SQLITE_BUSY`, which is the
   * thing being mapped.
   */
  db.pragma('busy_timeout = 150');
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  // Short, so a test that does hit the wait does not sit on it for the default five seconds.
  const other = openDatabase(file);
  open.push({ app, db, other, dir });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'holder', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  await chooseOverseer(app, token);
  return { app, other, token };
}

describe('a write that could not get the lock', () => {
  it('is refused as busy rather than reported as a fault', async () => {
    const { app, other } = await hosted();

    // The other connection takes the write lock and keeps it for the whole request.
    other.exec('BEGIN IMMEDIATE');
    other.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run('held-by-somebody-else');
    const tried = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'unlucky', password: 'hunter2pass' },
    });
    other.exec('ROLLBACK');

    expect(tried.statusCode, tried.body.slice(0, 200)).toBe(503);
    expect(tried.json<{ error: { code: string } }>().error.code).toBe('DATABASE_BUSY');
  });

  it('hands the request back to the game once the lock is let go', async () => {
    const { app, other } = await hosted();
    const order = {
      method: 'POST' as const,
      url: '/api/auth/register',
      payload: { username: 'unlucky', password: 'hunter2pass' },
    };
    other.exec('BEGIN IMMEDIATE');
    other.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run('held-by-somebody-else');
    const refused = await app.inject(order);
    expect(refused.statusCode, refused.body.slice(0, 200)).toBe(503);
    other.exec('ROLLBACK');

    /*
     * The same request again, now answered by the game rather than by the lock.
     *
     * A 201 is the proof that the refusal left nothing half-written: the username is free, so the
     * account it could not create the first time is created now. What must not come back is
     * another 503, which would mean the refusal was sticky, or a 409 `USERNAME_TAKEN`, which would
     * mean the first attempt wrote a row on its way to failing.
     */
    const again = await app.inject(order);
    expect(again.statusCode, again.body.slice(0, 200)).toBe(201);
  });
});
