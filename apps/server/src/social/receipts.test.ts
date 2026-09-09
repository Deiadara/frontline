import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NOTIFICATION_KINDS,
  findUnit,
  trainingSeconds,
  type Base,
  type NotificationKind,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { settleBase } from '../district/settle.js';

/**
 * Every kind in the catalogue is something the server actually says.
 *
 * A notification kind with no emitter is a switch on the settings page that turns nothing off and
 * a row in a list that never appears. Five of the seventeen kinds the catalogue then carried were
 * in that state at once, and one of them, `district_attacked`, is a kind a player is not *allowed*
 * to switch off: §A4's whole premise is that a defender is told a fight has been called, and
 * nothing was telling them. Nothing failed, because nothing asked.
 *
 * So this asks. It is a source scan rather than a behavioural test on purpose: proving that every
 * kind can be provoked over HTTP would need a fixture apiece and would still miss the one somebody
 * adds tomorrow. What this catches is the cheap half, and the cheap half is the half that went
 * wrong.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = path.resolve(HERE, '..');

/**
 * Kinds the catalogue carries that nothing emits **on purpose**, each with the reason.
 *
 * An entry here is a decision, not a pass: adding one is the way to say "this is not built yet"
 * out loud, in a place a reviewer reads.
 */
const NOT_EMITTED_YET: Readonly<Partial<Record<NotificationKind, string>>> = {
  /*
   * "A mark you set is about to come up": a reminder to the attacker, some interval before a fight
   * they declared. There is nowhere to put it. The world clock ticks every second and holds no
   * state, so an emitter there would ring once a second from the moment the window opened; a
   * once-only reminder needs a durable "already reminded" marker on the battle row, and what the
   * interval should be is a design call rather than a bug. Recorded rather than invented.
   */
  battle_incoming: 'no reminder marker on the battle row; the interval is a design call',
  /*
   * "Somebody has finished an hour on the floor." The settle that would write it,
   * `settleTrainingFor`, runs on `GET /training` and `POST /training` and nowhere else, so the
   * receipt would only ever ring while the player was already looking at the screen it points at.
   * Moving that settle onto every read path is the same change made for the Lab, and it is harder:
   * it writes two tables (the base's training book and the Overseer's attributes) and its own doc
   * requires both inside one transaction at the call site, which `settleBase` does not provide.
   */
  training_done: 'the officer-drill settle runs only on its own screen; see settleTrainingFor',
};

/** Every non-test TypeScript file under `apps/server/src`. */
function serverSources(dir: string = SERVER_SRC): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return entry === 'node_modules' ? [] : serverSources(full);
    if (!full.endsWith('.ts') || full.endsWith('.test.ts')) return [];
    return [full];
  });
}

/**
 * Files that *name* a kind without emitting one.
 *
 * `live/kinds.ts` maps kinds to the screens they make stale, so it lists most of the catalogue and
 * would answer for every one of them.
 */
const NOT_AN_EMITTER = new Set([path.join(SERVER_SRC, 'live', 'kinds.ts')]);

describe('the notification catalogue', () => {
  const sources = serverSources().filter((file) => !NOT_AN_EMITTER.has(file));
  const bodies = new Map(sources.map((file) => [file, readFileSync(file, 'utf8')]));

  it('has at least one emitter for every kind it offers', () => {
    const orphans = NOTIFICATION_KINDS.filter((kind) => {
      if (kind in NOT_EMITTED_YET) return false;
      // `notify` and its two wrappers take the kind as a named field, so this is the shape every
      // emitter in the server has.
      return ![...bodies.values()].some((body) => body.includes(`kind: '${kind}'`));
    });
    expect(orphans, 'kinds on the settings page that nothing ever writes').toEqual([]);
  });

  it('does not carry a kind that is recorded as unemitted and then emitted anyway', () => {
    // The other direction: an entry above that has quietly been built must come off the list, or
    // the list stops being a record of decisions and becomes a place bugs hide.
    for (const kind of Object.keys(NOT_EMITTED_YET) as NotificationKind[]) {
      const emitted = [...bodies.values()].some((body) => body.includes(`kind: '${kind}'`));
      expect(emitted, `${kind} has an emitter now; take it off NOT_EMITTED_YET`).toBe(false);
    }
  });

  it('records a reason for every kind it excuses, and excuses only real kinds', () => {
    for (const [kind, reason] of Object.entries(NOT_EMITTED_YET)) {
      expect(NOTIFICATION_KINDS as readonly string[]).toContain(kind);
      expect(reason.length, kind).toBeGreaterThan(20);
    }
  });
});

/**
 * The bench, which is the kind this pass gave an emitter to.
 *
 * The rule that matters is *one per batch*: a training order hands its bodies over one at a time
 * (`trainingArrivedBy`), so the naive emitter, one per delivery, would ring every forty-five
 * seconds for an order of ten Razors and put ten rows in the list for one decision.
 */
describe('units coming off the bench', () => {
  const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
  afterEach(async () => {
    for (const { app, db } of instances.splice(0)) {
      await app.close();
      db.close();
    }
  });

  async function makeStack() {
    const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
    const db = openDatabase(config.databasePath);
    runMigrations(db);
    const app = await buildApp({ config, db, logger: false });
    instances.push({ app, db });
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'bench', password: 'hunter2pass' },
    });
    const { token, user } = registered.json<{ token: string; user: { id: string } }>();
    const chosen = await app.inject({
      method: 'POST',
      url: '/api/overseer',
      headers: { authorization: `Bearer ${token}` },
      payload: { presetId: 'enforcer' },
    });
    expect(chosen.statusCode).toBe(201);
    return { app, token, userId: user.id, base: chosen.json<{ base: Base }>().base };
  }

  const bells = (app: FastifyInstance, userId: string) =>
    app.repos.social.notifications(userId, 50).filter((note) => note.kind === 'unit_trained');

  it('rings once for the batch, not once for every body in it', async () => {
    const { app, userId, base } = await makeStack();
    const razors = findUnit('razors');
    if (!razors) throw new Error('fixture: no razors in the catalogue');

    const COUNT = 10;
    const startedAt = new Date('2026-09-07T09:00:00.000Z');
    const durationSeconds = trainingSeconds(razors, COUNT, 0);
    app.repos.bases.updateArmy(base.id, base.army, [
      {
        id: 'batch-1',
        unitId: razors.id,
        count: COUNT,
        delivered: 0,
        startedAt: startedAt.toISOString(),
        durationSeconds,
        paid: {},
      },
    ]);

    // Halfway: bodies are arriving, and the batch is not finished. Nothing rings.
    const half = new Date(startedAt.getTime() + (durationSeconds / 2) * 1000);
    settleBase(app.repos, app.repos.bases.findById(base.id)!, half);
    expect(app.repos.bases.findById(base.id)!.army.razors ?? 0).toBeGreaterThan(0);
    expect(bells(app, userId), 'a half-delivered batch is not a finished one').toHaveLength(0);

    // Past the end: the batch is off the bench and the bell rings, once.
    const after = new Date(startedAt.getTime() + (durationSeconds + 60) * 1000);
    settleBase(app.repos, app.repos.bases.findById(base.id)!, after);
    const rung = bells(app, userId);
    expect(rung).toHaveLength(1);
    expect(rung[0]?.title).toBe(`${COUNT} ${razors.name} off the bench`);
    expect(rung[0]?.link).toBe('/game/units');
    expect(app.repos.bases.findById(base.id)!.trainingQueue).toEqual([]);

    // Settled again: banked once, so rung once.
    settleBase(app.repos, app.repos.bases.findById(base.id)!, after);
    expect(bells(app, userId)).toHaveLength(1);
  });

  it('says nothing at all for a bench that was empty', async () => {
    const { app, userId, base } = await makeStack();
    settleBase(app.repos, app.repos.bases.findById(base.id)!, new Date(Date.now() + 86_400_000));
    expect(bells(app, userId)).toHaveLength(0);
  });
});
