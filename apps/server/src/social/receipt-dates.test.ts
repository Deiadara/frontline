import { randomUUID } from 'node:crypto';
import {
  OVERSEER_SUBJECT,
  RESEARCH_ITEMS,
  TRAINING_SECONDS,
  type Base,
  type NotificationKind,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { settleBase } from '../district/settle.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * A receipt is dated when its thing happened, not when the server noticed (maintainer, 2026-09-29).
 *
 * Every clock in this game settles lazily, so a build that finished at 03:00 is written at the
 * player's next read. Dated at that read, the whole bell said "just now" after a night away, which
 * is wrong for exactly the player the bell is for. Each fixture here finishes something, then
 * settles eight hours later, and asks what the row says.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const START = new Date('2026-09-07T01:00:00.000Z');
const LATE_MS = 8 * 3_600_000;

async function crew(): Promise<{ app: FastifyInstance; userId: string; base: Base }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'sleeper', password: 'hunter2pass' },
  });
  const { token, user } = registered.json<{ token: string; user: { id: string } }>();
  const chosen = await chooseOverseer(app, token);
  expect(chosen.statusCode).toBe(201);
  return { app, userId: user.id, base: chosen.json<{ base: Base }>().base };
}

/** Settles long after `finishedAt` and returns the one receipt of `kind` it wrote. */
function settleLateAndRead(
  app: FastifyInstance,
  userId: string,
  baseId: string,
  kind: NotificationKind,
  finishedAt: Date,
) {
  settleBase(
    app.repos,
    app.repos.bases.findById(baseId)!,
    new Date(finishedAt.getTime() + LATE_MS),
  );
  const rows = app.repos.social.notifications(userId, 50).filter((row) => row.kind === kind);
  expect(rows, `${kind} rang ${rows.length} times`).toHaveLength(1);
  return rows[0]!;
}

describe('a receipt settled hours late', () => {
  it('dates a finished build at its completion', async () => {
    const { app, userId, base } = await crew();
    const [building] = base.buildings;
    if (!building) throw new Error('fixture: a crew with no buildings');
    const durationSeconds = 600;
    app.repos.bases.updateDistrict(base.id, base.buildings, [
      {
        id: randomUUID(),
        kind: building.kind,
        level: building.level + 1,
        startedAt: START.toISOString(),
        durationSeconds,
        paid: {},
        parts: {},
      },
    ]);
    const done = new Date(START.getTime() + durationSeconds * 1000);
    const row = settleLateAndRead(app, userId, base.id, 'building_done', done);
    expect(row.createdAt).toBe(done.toISOString());
  });

  it('dates a batch off the bench at its last delivery', async () => {
    const { app, userId, base } = await crew();
    const durationSeconds = 900;
    app.repos.bases.updateArmy(base.id, base.army, [
      {
        id: randomUUID(),
        unitId: 'razors',
        count: 3,
        delivered: 0,
        startedAt: START.toISOString(),
        durationSeconds,
        paid: {},
      },
    ]);
    const done = new Date(START.getTime() + durationSeconds * 1000);
    const row = settleLateAndRead(app, userId, base.id, 'unit_trained', done);
    expect(row.createdAt).toBe(done.toISOString());
  });

  it('dates a finished drill at the end of the hour', async () => {
    const { app, userId, base } = await crew();
    app.repos.bases.updateTraining(
      base.id,
      {
        ...base.training,
        day: '2026-09-07',
        used: 1,
        sessions: [
          {
            id: 'drill-1',
            subjectId: OVERSEER_SUBJECT,
            attribute: 'chemistry',
            startedAt: START.toISOString(),
            durationSeconds: TRAINING_SECONDS,
          },
        ],
      },
      base.commanders,
    );
    const done = new Date(START.getTime() + TRAINING_SECONDS * 1000);
    const row = settleLateAndRead(app, userId, base.id, 'training_done', done);
    expect(row.createdAt).toBe(done.toISOString());
  });

  it("dates a Lab result at the rung's completion", async () => {
    const { app, userId, base } = await crew();
    const [rung] = RESEARCH_ITEMS;
    if (!rung) throw new Error('fixture: an empty research catalogue');
    const durationMinutes = 45;
    app.repos.bases.updateResearch(base.id, {
      active: {
        id: randomUUID(),
        project: { kind: 'technology', techId: rung.id },
        startedAt: START.toISOString(),
        durationMinutes,
        paid: {},
      },
      technologies: [],
    });
    const done = new Date(START.getTime() + durationMinutes * 60_000);
    const row = settleLateAndRead(app, userId, base.id, 'research_done', done);
    expect(row.createdAt).toBe(done.toISOString());
  });
});

describe('receipts written at the same instant', () => {
  /*
   * Ids are random UUIDs, so ordering ties on them came out in a different order every time a
   * settle wrote several rows at once. Twelve rows is 12! orders, so a list that is not in
   * insertion order is caught on every run rather than by luck.
   */
  it('come out newest-written first, the same way on every read', async () => {
    const { app, userId } = await crew();
    const at = START.toISOString();
    const titles = Array.from({ length: 12 }, (_, index) => `Row ${index}`);
    for (const title of titles) {
      app.repos.social.putNotification({
        id: randomUUID(),
        userId,
        kind: 'building_done',
        title,
        body: '',
        link: '/game/base',
        subjectId: null,
        createdAt: at,
      });
    }
    const read = () =>
      app.repos.social
        .notifications(userId, 50)
        .filter((row) => row.createdAt === at)
        .map((row) => row.title);
    expect(read()).toEqual([...titles].reverse());
  });
});
