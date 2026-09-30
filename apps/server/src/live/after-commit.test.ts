import { randomUUID } from 'node:crypto';
import type { Base, LiveEvent } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';
import { LiveHub, liveHub } from './hub.js';

/**
 * Chime after commit (maintainer, 2026-09-29).
 *
 * A live nudge used to go out the moment it was published, inside whatever transaction the
 * publisher sat in. A route that settled the crew and then refused rolled the receipt back, but
 * the tab had already heard `base` and played the "done" chime, and the next read settled the same
 * build and chimed again.
 */

const NOON = new Date('2026-09-29T12:00:00.000Z');

const dbs: AppDatabase[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of dbs.splice(0)) db.close();
});

function handle(): AppDatabase {
  const db = openDatabase(':memory:');
  dbs.push(db);
  return db;
}

function listening(hub: LiveHub, userId: string): LiveEvent['kind'][] {
  const heard: LiveEvent['kind'][] = [];
  hub.subscribe(userId, (event) => heard.push(event.kind));
  return heard;
}

describe('a nudge published inside a transaction', () => {
  it('waits for the commit', () => {
    const db = handle();
    const hub = new LiveHub();
    const heard = listening(hub, 'me');
    db.transaction(() => {
      hub.publish('me', 'base', NOON);
      expect(heard, 'sent before the commit').toEqual([]);
    })();
    expect(heard).toEqual(['base']);
  });

  it('waits for the commit of an immediate transaction too, which is how the seed opens one', () => {
    const db = handle();
    const hub = new LiveHub();
    const heard = listening(hub, 'me');
    db.transaction(() => {
      hub.publish('me', 'world', NOON);
      expect(heard, 'sent before the commit').toEqual([]);
    }).immediate();
    expect(heard).toEqual(['world']);
  });

  it('is dropped when the transaction rolls back', () => {
    const db = handle();
    const hub = new LiveHub();
    const heard = listening(hub, 'me');
    expect(() =>
      db.transaction(() => {
        hub.publish('me', 'base', NOON);
        hub.broadcast('world', NOON);
        throw new Error('refused');
      })(),
    ).toThrow('refused');
    expect(heard).toEqual([]);
  });

  it('drops only what an inner savepoint rolled back, and sends the rest at the outer commit', () => {
    const db = handle();
    const hub = new LiveHub();
    const heard = listening(hub, 'me');
    db.transaction(() => {
      hub.publish('me', 'base', NOON);
      try {
        db.transaction(() => {
          hub.publish('me', 'battle', NOON);
          throw new Error('inner refused');
        })();
      } catch {
        // The outer write carries on without it.
      }
      db.transaction(() => hub.publish('me', 'notification', NOON))();
      expect(heard, 'an inner release sent before the outer commit').toEqual([]);
    })();
    expect(heard).toEqual(['base', 'notification']);
  });

  it('goes out at once when no transaction is open', () => {
    const hub = new LiveHub();
    const heard = listening(hub, 'me');
    hub.publish('me', 'base', NOON);
    expect(heard).toEqual(['base']);
  });
});

describe('a refused action that settled a finished build first', () => {
  it('neither writes the receipt nor chimes, and the next read chimes once', async () => {
    const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
    const db = handle();
    runMigrations(db);
    const app = await buildApp({ config, db, logger: false });
    apps.push(app);
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'refused', password: 'hunter2pass' },
    });
    const { token, user } = registered.json<{ token: string; user: { id: string } }>();
    const chosen = await chooseOverseer(app, token);
    expect(chosen.statusCode).toBe(201);
    const base = chosen.json<{ base: Base }>().base;

    // A level that finished an hour ago, waiting for the next settle to land it.
    const [building] = base.buildings;
    if (!building) throw new Error('fixture: a crew with no buildings');
    app.repos.bases.updateDistrict(base.id, base.buildings, [
      {
        id: randomUUID(),
        kind: building.kind,
        level: building.level + 1,
        startedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
        durationSeconds: 3_600,
        paid: {},
        parts: {},
      },
    ]);
    const heard = listening(liveHub, user.id);
    const receipts = () =>
      app.repos.social.notifications(user.id, 50).filter((row) => row.kind === 'building_done');

    // Settles the crew inside its transaction, then refuses: there is no such drill.
    const refused = await app.inject({
      method: 'POST',
      url: '/api/training/cancel',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId: 'no-such-drill' },
    });
    expect(refused.statusCode).toBe(404);
    expect(receipts(), 'the rollback kept the receipt').toEqual([]);
    expect(heard, 'a refused action chimed').toEqual([]);

    // The next read lands the build for real, and that is the one chime.
    const read = await app.inject({
      method: 'GET',
      url: `/api/base/${base.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(read.statusCode).toBe(200);
    expect(receipts()).toHaveLength(1);
    expect(heard.filter((kind) => kind === 'base')).toHaveLength(1);
  });
});
