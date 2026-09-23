import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { MVP_PLAYER } from '../seed/constants.js';
import { seedMvpWorld } from '../seed/index.js';
import { UNLOCKED_LEVEL } from '../seed/sandbox.js';
import { chooseOverseer, offeredOverseers } from '../testing/overseer.js';

/**
 * One base per account, with something durable behind it.
 *
 * The rule lived in exactly one `!==` against `request.currentUser`, a snapshot the `authenticate`
 * preHandler filled in before an await and outside the transaction that does the writing, and no
 * unique index anywhere in the schema backed it. A second base is not a duplicate a player can see:
 * `findByOwnerId` is a single-row read, so one of the two is playable and the other is a permanent
 * ghost that no route can reach and nothing will ever settle, while still sitting on the
 * leaderboard, counting in the city-level average that prices the Bar and the black market, and
 * occupying a district.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

async function makeApp(
  env: Record<string, string> = {},
): Promise<{ app: FastifyInstance; db: AppDatabase }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret', ...env });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  return { app, db };
}

/**
 * `UNLOCKED=true` is the seeded dev account's switch and nobody else's.
 *
 * The route used to hand `applyUnlockedSandbox` the caller's own username, so on a server with the
 * flag on every account that picked a character opened at the end-game. The seeded name is the
 * positive control: with the same flag it still opens at level 20, so the assertion about the
 * stranger is about the name and not about the flag being off.
 */
describe('the end-game sandbox and a freshly registered account', () => {
  async function pick(app: FastifyInstance, username: string): Promise<number> {
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username, password: 'hunter2pass' },
    });
    const token = registered.json<{ token: string }>().token;
    const chosen = await chooseOverseer(app, token);
    expect(chosen.statusCode, chosen.body.slice(0, 200)).toBe(201);
    return chosen.json<{ base: { level: number } }>().base.level;
  }

  it('opens the seeded account at the end-game and a stranger at level one', async () => {
    const { app } = await makeApp({ UNLOCKED: 'true' });
    expect(await pick(app, MVP_PLAYER.username)).toBe(UNLOCKED_LEVEL);
    expect(await pick(app, 'a_stranger')).toBe(1);
  });
});

describe('choosing an overseer', () => {
  it('refuses a second one, and leaves exactly one base behind', async () => {
    const { app } = await makeApp();
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'twice_over', password: 'hunter2pass' },
    });
    const token = registered.json<{ token: string }>().token;

    /*
     * The offer is read **before** the first choice, because since 2026-09-18 a settled crew
     * cannot ask again: `GET /overseer/choices` refuses one with the same code this test is
     * about, since an offer is a hold and a crew that can never take one must not take four
     * characters out of the pool by asking.
     *
     * The second name is one this account was offered and nobody has taken, so the refusal below
     * can only be the once-per-account rule. Reaching for an arbitrary name would have made it a
     * §F6 pool refusal instead, which is a different rule with the same status code.
     */
    const offered = await offeredOverseers(app, token);
    const free = offered[1];
    if (!free) throw new Error('fixture: the pool ran dry');

    const first = await chooseOverseer(app, token);
    expect(first.statusCode, first.body.slice(0, 200)).toBe(201);
    const second = await app.inject({
      method: 'POST',
      url: '/api/overseer',
      headers: auth(token),
      payload: { presetId: free.presetId },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json<{ error: { code: string } }>().error.code).toBe('OVERSEER_ALREADY_CHOSEN');
    expect(app.repos.bases.listSummaries()).toHaveLength(1);
  });

  it('cannot hold two bases for one account even with the guards bypassed', async () => {
    // The guards are the half that was already there. This is the half that was not: a second row
    // written straight past every check has to be refused by the database itself.
    const { app, db } = await makeApp();
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'twice_over', password: 'hunter2pass' },
    });
    const token = registered.json<{ token: string }>().token;
    const chosen = await chooseOverseer(app, token);
    const base = app.repos.bases.findById(chosen.json<{ base: { id: string } }>().base.id);
    if (!base) throw new Error('no base');

    expect(() => app.repos.bases.insert({ ...base, id: 'a-second-base' })).toThrow(/UNIQUE/i);
    expect(db.prepare('SELECT COUNT(*) AS n FROM bases').get()).toEqual({ n: 1 });
  });

  it('cannot hold two overseers for one account either', async () => {
    const { app, db } = await makeApp();
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'twice_over', password: 'hunter2pass' },
    });
    const token = registered.json<{ token: string }>().token;
    await chooseOverseer(app, token);
    const userId = (db.prepare('SELECT id FROM users').get() as { id: string }).id;
    expect(() =>
      db
        .prepare(
          `INSERT INTO overseers (id, user_id, preset_id, name, archetype, portrait_id, bio,
             attributes_json, perks_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'a-second-overseer',
          userId,
          // A preset id nobody can be holding, so the index this trips is the one on `user_id`
          // and not migration 0095's on `preset_id`.
          'nobody-at-all',
          'Nobody',
          'fixer',
          'overseer-3',
          '',
          '{}',
          '[]',
          new Date().toISOString(),
        ),
    ).toThrow(/UNIQUE/i);
  });
});

/**
 * What the picker's header says is left, against a database that has been through migration 0095.
 *
 * 0095 resolves a pre-pool save's duplicate claims by suffixing all but the earliest holder:
 * `enforcer` stays, and the accounts that shared it keep their character on a spent claim shaped
 * `enforcer:<uuid>`. Those rows are in `overseers`, so `claimedPresetIds` returns them, and the
 * route used to answer `total - claimed.size`. Each spent claim then read as a character somebody
 * holds.
 *
 * Asserted as a **delta** rather than against a number, because the seeder's rivals hold characters
 * too and this is not a test about how many of them there are. Adding a spent claim must move the
 * count by nothing: it is not a character, and nobody is holding one because of it.
 */
describe('how many characters the picker says are left', () => {
  async function remainingFor(app: FastifyInstance, token: string): Promise<number> {
    const res = await app.inject({
      method: 'GET',
      url: '/api/overseer/choices',
      headers: auth(token),
    });
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    return res.json<{ remaining: number }>().remaining;
  }

  it('does not count a spent 0095 claim as a character somebody holds', async () => {
    const { app, db } = await makeApp();
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'counts_rows', password: 'hunter2pass' },
    });
    const token = registered.json<{ token: string }>().token;

    const before = await remainingFor(app, token);
    expect(before).toBeGreaterThan(0);

    // Exactly the row 0095 leaves behind: a second account that was on `enforcer` before the pool
    // existed, still carrying the character, no longer carrying the claim.
    db.prepare(
      'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
    ).run('legacy-holder', 'legacy_holder', 'x', '2026-01-01T00:00:00.000Z');
    db.prepare(
      `INSERT INTO overseers (id, user_id, preset_id, name, archetype, portrait_id, bio,
         attributes_json, perks_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'legacy-overseer',
      'legacy-holder',
      'enforcer:legacy-overseer',
      'Marcus "Bulwark" Kane',
      'enforcer',
      'overseer-01',
      '',
      '{}',
      '[]',
      '2026-01-01T00:00:00.000Z',
    );

    expect(
      await remainingFor(app, token),
      'a spent claim was counted as a character off the board',
    ).toBe(before);
  });

  /**
   * The direction that bites hardest: more overseer rows than there are characters.
   *
   * A live world reaches this the moment it has thirty-one accounts, and every one of them past
   * the thirtieth is a spent claim on a save that predated the pool. `total - claimed.size` goes
   * through zero and prints a negative number on the one screen a new player cannot get past.
   */
  it('never reports a negative number of characters left', async () => {
    const { app, db } = await makeApp();
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'crowded', password: 'hunter2pass' },
    });
    const token = registered.json<{ token: string }>().token;

    const insertUser = db.prepare(
      'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
    );
    const insertOverseer = db.prepare(
      `INSERT INTO overseers (id, user_id, preset_id, name, archetype, portrait_id, bio,
         attributes_json, perks_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (let n = 0; n < 50; n += 1) {
      insertUser.run(`legacy-${n}`, `legacy_${n}`, 'x', '2026-01-01T00:00:00.000Z');
      insertOverseer.run(
        `legacy-o-${n}`,
        `legacy-${n}`,
        `enforcer:legacy-o-${n}`,
        'Marcus "Bulwark" Kane',
        'enforcer',
        'overseer-01',
        '',
        '{}',
        '[]',
        '2026-01-01T00:00:00.000Z',
      );
    }

    const remaining = await remainingFor(app, token);
    expect(remaining, 'the picker offered a negative pool').toBeGreaterThan(0);
    // ...and it still agrees with what the screen is actually showing.
    const offered = await offeredOverseers(app, token);
    expect(offered.length).toBeLessThanOrEqual(remaining);
  });
});

/**
 * The opening faction invitation has to be answerable on the day it arrives (bug pass,
 * 2026-09-22).
 *
 * Picking an overseer writes a `faction_invites` row for the seeded faction and tells the player
 * about it. For one build the telling was a bell entry alone, pointing at `/game/faction`, and
 * that screen is behind `AREA_REQUIREMENTS.faction`, which is **level 10**. The invitation
 * arrives at level one. So the first notification a new account ever received was a door it could
 * not open, for an offer it had no way to answer, while `FoundFaction`'s own copy told the player
 * the invitation would be "in your messages, with a button on it".
 *
 * What makes an invitation answerable is the message carrying `inviteId` and `factionId`: that is
 * what `InviteCard` draws an Accept button from, in the ungated mailbox. These pin the delivery
 * and then spend it, because a button that posts an id the answer route rejects is the same bug
 * one layer down.
 */
describe('the invitation a new crew is given', () => {
  /**
   * A seeded world, which is the only state where the invitation exists at all.
   *
   * `makeApp` builds the routes over a bare migrated database; the faction a new crew is invited
   * to is written by `seedMvpWorld`, which the real server runs at boot in `index.ts`. Without it
   * `seededFactionId` is undefined and the whole branch is skipped, so a test on the bare harness
   * would pass by never reaching the code it is about.
   */
  async function seededApp(): Promise<FastifyInstance> {
    const { app, db } = await makeApp();
    await seedMvpWorld({ db, repos: app.repos });
    return app;
  }

  it('arrives in the mailbox carrying the invitation, not just a bell', async () => {
    const app = await seededApp();
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'newcomer', password: 'hunter2pass' },
    });
    const token = registered.json<{ token: string }>().token;
    await chooseOverseer(app, token);

    const inbox = await app.inject({
      method: 'GET',
      url: '/api/messages',
      headers: auth(token),
    });
    expect(inbox.statusCode, inbox.body.slice(0, 200)).toBe(200);
    /*
     * `invite` is a nested object on the wire, not a flat `inviteId`.
     *
     * Worth the comment because the first version of this test read `message.inviteId !== null`,
     * which is `undefined !== null` on every message in the mailbox, so `find` returned the first
     * thing it saw and the test passed without the feature existing.
     */
    const { inbox: mail } = inbox.json<{
      inbox: { invite: { inviteId: string; factionId: string } | null; subject: string }[];
    }>();
    const invitation = mail.find((message) => message.invite != null);
    expect(
      invitation?.invite?.inviteId,
      'the opening invitation should be a message carrying an invite',
    ).toBeTruthy();

    // And the bell points at the screen that can answer it, not at one that is still locked.
    const bell = await app.inject({
      method: 'GET',
      url: '/api/notifications',
      headers: auth(token),
    });
    const entries = bell.json<{ notifications: { kind: string; link: string | null }[] }>()
      .notifications;
    const rung = entries.find((entry) => entry.kind === 'faction_invite');
    expect(rung?.link).toBe('/game/messages');
    // The positive control for the whole test: the screen it used to point at is *still* gated,
    // so this is not passing because somebody opened the faction door to level one.
    expect(rung?.link).not.toBe('/game/faction');
  });

  it('can actually be accepted by a level-one crew', async () => {
    const app = await seededApp();
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'joiner', password: 'hunter2pass' },
    });
    const token = registered.json<{ token: string }>().token;
    await chooseOverseer(app, token);

    const inbox = await app.inject({ method: 'GET', url: '/api/messages', headers: auth(token) });
    const mail = inbox.json<{ inbox: { invite: { inviteId: string } | null }[] }>().inbox;
    const inviteId = mail.find((message) => message.invite != null)?.invite?.inviteId;
    if (!inviteId) throw new Error('no invitation arrived');

    const answered = await app.inject({
      method: 'POST',
      url: '/api/factions/answer',
      headers: auth(token),
      payload: { inviteId, accept: true },
    });
    expect(answered.statusCode, answered.body.slice(0, 200)).toBe(200);
  });
});
