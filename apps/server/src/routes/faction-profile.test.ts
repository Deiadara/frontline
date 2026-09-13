import {
  FACTION_RANKS,
  FOUND_FACTION_NEXUS_LEVEL,
  FOUND_FACTION_PLAYER_LEVEL,
  MAX_FACTION_MEMBERS,
  averageLevel,
  type FactionProfileResponse,
  type LeaderboardResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { seedMvpWorld } from '../seed/index.js';
import { MVP_BOT, MVP_FACTION, MVP_RIVAL_FACTION, MVP_RIVAL_SECOND } from '../seed/constants.js';

/**
 * A faction's file, readable by anybody (maintainer request, 2026-09-12).
 *
 * Two things are under test and they are separable. The **route** answers for a faction the reader
 * is not in, which is what makes an enemy roster something a player can read at all; the **seed**
 * now puts such a faction in the world from the first boot, so there is something to read without
 * a second account. Both matter: the route with nothing to point it at is a page nobody reaches.
 *
 * What is deliberately absent is as load-bearing as what is here. The faction screen a member
 * sees carries ally armies, ally battles and open invitations, and a rival reading those would be
 * scouting five crews with one request. See the note on the route.
 */

const PASSWORD = 'hunter2pass';

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app: open, db } of instances.splice(0)) {
    await open.close();
    db.close();
  }
});

async function makeApp(): Promise<{ app: FastifyInstance; db: AppDatabase }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  await seedMvpWorld({ db, repos: app.repos });
  return { app, db };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** A registered player with an Overseer, which is what settles their district. */
async function player(app: FastifyInstance, username: string) {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: PASSWORD },
  });
  const token = registered.json<{ token: string }>().token;
  await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
  return { token };
}

/**
 * §B1: gives a crew the level and the Nexus that founding a faction asks for.
 *
 * Written through the repositories because there is no route that hands a crew eleven levels, and
 * what these tests are about is what happens *after* a table exists.
 */
function establish(app: FastifyInstance, username: string): string {
  const id = app.repos.users.findByUsername(username)?.id;
  if (id === undefined) throw new Error(`no account for ${username}`);
  const base = app.repos.bases.findByOwnerId(id);
  if (!base) throw new Error(`no district for ${username}`);
  app.repos.bases.updateProgression(base.id, FOUND_FACTION_PLAYER_LEVEL, base.progression);
  app.repos.bases.updateBuildings(
    base.id,
    base.buildings.map((building) =>
      building.kind === 'nexus' ? { ...building, level: FOUND_FACTION_NEXUS_LEVEL } : building,
    ),
  );
  return id;
}

async function profileOf(
  app: FastifyInstance,
  token: string,
  factionId: string,
): Promise<FactionProfileResponse> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/factions/${factionId}/profile`,
    headers: auth(token),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<FactionProfileResponse>();
}

/** The NPC table, found by name rather than by a fixed id, because the seed mints a fresh uuid. */
function rivalFactionId(app: FastifyInstance): string {
  const faction = app.repos.factions.findByName(MVP_RIVAL_FACTION.name);
  if (!faction) throw new Error('the seeder did not found the NPC faction');
  return faction.id;
}

describe('the NPC faction the seeder founds', () => {
  it('seats the rival and their second at one table nobody can join', async () => {
    const { app } = await makeApp();

    const faction = app.repos.factions.findByName(MVP_RIVAL_FACTION.name);
    expect(faction, 'no NPC faction in the seeded world').toBeDefined();
    expect(faction?.blurb).toBe(MVP_RIVAL_FACTION.blurb);

    const members = app.repos.factions.members(faction!.id);
    expect(members).toHaveLength(2);
    expect(members.map((row) => row.rank).sort()).toEqual(['chief', 'leader']);
    // Two seats, not five: a table with room is a table a player could be invited to, and nobody
    // drives these two, so an invitation from them would never come.
    expect(members.length).toBeLessThan(MAX_FACTION_MEMBERS);

    const usernames = members.map(
      (row) => app.repos.users.findById(row.userId)?.username ?? '(missing)',
    );
    expect(usernames.sort()).toEqual([MVP_BOT.username, MVP_RIVAL_SECOND.username].sort());
  });

  it('is a different table from the one a new player is offered', async () => {
    const { app } = await makeApp();
    const ally = app.repos.factions.findByName(MVP_FACTION.name);
    expect(ally).toBeDefined();
    expect(rivalFactionId(app)).not.toBe(ally?.id);
  });

  it('stands both crews on real ground, so the roster reads off districts like anybody else', async () => {
    const { app } = await makeApp();
    for (const row of app.repos.factions.members(rivalFactionId(app))) {
      const base = app.repos.bases.findByOwnerId(row.userId);
      expect(base, `no district for a seated member`).toBeDefined();
      expect(base?.isBot).toBe(true);
    }
  });

  it('does not seat anybody twice when the seeder runs again', async () => {
    const { app, db } = await makeApp();
    await seedMvpWorld({ db, repos: app.repos });
    expect(app.repos.factions.members(rivalFactionId(app))).toHaveLength(2);
    expect(app.repos.factions.all().filter((f) => f.name === MVP_RIVAL_FACTION.name)).toHaveLength(
      1,
    );
  });
});

describe('GET /factions/:id/profile', () => {
  it('lets a player read a faction they are in no way part of', async () => {
    const { app } = await makeApp();
    const reader = await player(app, 'outsider_one');

    const profile = await profileOf(app, reader.token, rivalFactionId(app));

    expect(profile.isYours).toBe(false);
    expect(profile.faction.name).toBe(MVP_RIVAL_FACTION.name);
    expect(profile.faction.blurb).toBe(MVP_RIVAL_FACTION.blurb);
    expect(profile.faction.badge).toEqual(MVP_RIVAL_FACTION.badge);
    // Founded when, which is one of the things the maintainer asked the page to say.
    expect(Number.isNaN(Date.parse(profile.faction.foundedAt))).toBe(false);
    expect(profile.members).toHaveLength(2);
  });

  it('names every member, their rank and their own numbers', async () => {
    const { app } = await makeApp();
    const reader = await player(app, 'outsider_two');

    const profile = await profileOf(app, reader.token, rivalFactionId(app));

    for (const member of profile.members) {
      expect(FACTION_RANKS).toContain(member.rank);
      expect(member.username.length).toBeGreaterThan(0);
      expect(member.level).toBeGreaterThan(0);
      expect(member.districtName.length).toBeGreaterThan(0);
      // The face the roster draws, which is why the maintainer asked for it: a member's own Overseer
      // rather than a generated sigil.
      expect(member.portraitId).not.toBeNull();
      expect(member.isYou).toBe(false);
    }
    expect(profile.members.filter((member) => member.rank === 'leader')).toHaveLength(1);
  });

  it('reports the average level as a whole number off the roster it just listed', async () => {
    const { app } = await makeApp();
    const reader = await player(app, 'outsider_three');

    const profile = await profileOf(app, reader.token, rivalFactionId(app));

    expect(Number.isInteger(profile.averageLevel)).toBe(true);
    expect(profile.averageLevel).toBe(averageLevel(profile.members.map((one) => one.level)));
    // The two NPC crews are seeded at different levels, so a mean that merely echoed one of them
    // would be indistinguishable from the real thing on a roster where everybody matched.
    expect(new Set(profile.members.map((one) => one.level)).size).toBeGreaterThan(1);
  });

  it('moves the average when somebody joins', async () => {
    const { app } = await makeApp();
    const reader = await player(app, 'outsider_four');
    const factionId = rivalFactionId(app);
    const before = await profileOf(app, reader.token, factionId);

    /*
     * Seated straight through the repository rather than through an invitation.
     *
     * Nobody drives the NPC crews, so there is no invitation for a player to accept and no route
     * that would produce this state in play. What is under test is that the figure is computed off
     * the roster on every read rather than stored, and a direct seat is the smallest way to move
     * the roster and ask again.
     */
    const newcomer = app.repos.bases.findByOwnerId(
      app.repos.users.findByUsername('outsider_four')!.id,
    )!;
    app.repos.factions.addMember({
      userId: newcomer.ownerId,
      factionId,
      rank: 'member',
      joinedAt: new Date().toISOString(),
    });

    const after = await profileOf(app, reader.token, factionId);
    expect(after.members).toHaveLength(before.members.length + 1);
    expect(after.averageLevel).toBe(averageLevel(after.members.map((one) => one.level)));
    expect(after.averageLevel).not.toBe(before.averageLevel);
    // And the reader is now marked as themselves, which is what decides the doors the page offers.
    expect(after.isYours).toBe(true);
    expect(after.members.filter((one) => one.isYou)).toHaveLength(1);
  });

  it('carries none of what the faction screen shows the people at the table', async () => {
    const { app } = await makeApp();
    const reader = await player(app, 'outsider_five');

    const response = await app.inject({
      method: 'GET',
      url: `/api/factions/${rivalFactionId(app)}/profile`,
      headers: auth(reader.token),
    });

    const body = response.json<Record<string, unknown>>();
    // The three that would make this a free scout of every crew under the badge.
    expect(body).not.toHaveProperty('armies');
    expect(body).not.toHaveProperty('battles');
    expect(body).not.toHaveProperty('invites');
    expect(body).not.toHaveProperty('pending');
    // Nor an army size on a member row, which is the same leak one row at a time.
    for (const member of (body.members as Record<string, unknown>[]) ?? []) {
      expect(member).not.toHaveProperty('armySize');
      expect(member).not.toHaveProperty('supplyUsed');
    }
  });

  /*
   * The mail door, end to end (regression, 2026-09-13).
   *
   * The roster prints `displayNameOf(user)` and the composer hands whatever the door put in
   * `?to=` straight to `POST /messages`, which resolves login names only. So every member who
   * had set a display name was unreachable from the page whose whole job is to let a stranger
   * reach them: the composer opened addressed to a name no account answers to and the send came
   * back `no_such_player`. The row carries `handle` for that, and this walks the real path.
   */
  it('carries a handle the mailbox can actually address, display name or not', async () => {
    const { app } = await makeApp();
    const writer = await player(app, 'outsider_eight');
    const reader = await player(app, 'outsider_nine');

    const renamed = await app.inject({
      method: 'PATCH',
      url: '/api/settings/profile',
      headers: auth(reader.token),
      payload: { displayName: 'The Ninth Street Crew' },
    });
    expect(renamed.statusCode, renamed.body).toBe(200);

    const factionId = rivalFactionId(app);
    const now = new Date().toISOString();
    for (const username of ['outsider_eight', 'outsider_nine']) {
      const id = app.repos.users.findByUsername(username)!.id;
      app.repos.factions.addMember({ userId: id, factionId, rank: 'member', joinedAt: now });
    }

    const profile = await profileOf(app, writer.token, factionId);
    const row = profile.members.find(
      (member) => member.userId === app.repos.users.findByUsername('outsider_nine')!.id,
    );
    expect(row, 'the renamed member is off the roster').toBeDefined();
    // The name on screen is the one they chose; the handle is the credential underneath it.
    expect(row!.username).toBe('The Ninth Street Crew');
    expect(row!.handle).toBe('outsider_nine');

    const sent = await app.inject({
      method: 'POST',
      url: '/api/messages',
      headers: auth(writer.token),
      payload: { toUsername: row!.handle, subject: 'About your street', body: 'We should talk.' },
    });
    expect(sent.statusCode, sent.body).toBe(200);

    // And it landed in the right box, rather than merely not being refused.
    const inbox = await app.inject({
      method: 'GET',
      url: '/api/messages',
      headers: auth(reader.token),
    });
    const box = inbox.json<{ inbox: { subject: string }[] }>();
    expect(box.inbox.map((message) => message.subject)).toContain('About your street');
  });

  it('answers 404 for a faction that does not exist, and 401 without a token', async () => {
    const { app } = await makeApp();
    const reader = await player(app, 'outsider_six');

    const missing = await app.inject({
      method: 'GET',
      url: '/api/factions/not-a-faction/profile',
      headers: auth(reader.token),
    });
    expect(missing.statusCode).toBe(404);

    const anonymous = await app.inject({
      method: 'GET',
      url: `/api/factions/${rivalFactionId(app)}/profile`,
    });
    expect(anonymous.statusCode).toBe(401);
  });

  /*
   * The file, read while the table it describes is changing under the reader (maintainer request).
   *
   * Three accounts, one reader, and nothing cached: the roster, the seat count and the mean level
   * are all derived on every read, so the thing worth pinning is that the *other* screen agrees
   * after each change. A profile that had kept a copy of any of them, or a departure that clawed
   * back what the leaver won under the badge (§J8 says it must not), fails here rather than in a
   * bug report about two screens disagreeing.
   */
  it('keeps the file and the standings agreeing while somebody leaves the table', async () => {
    const { app } = await makeApp();
    const founder = await player(app, 'holds_the_table');
    const second = await player(app, 'walks_out_later');
    const reader = await player(app, 'watching_from_outside');

    establish(app, 'holds_the_table');
    const walkerId = establish(app, 'walks_out_later');

    const founded = await app.inject({
      method: 'POST',
      url: '/api/factions',
      headers: auth(founder.token),
      payload: { name: 'Iron Wolves', badge: MVP_RIVAL_FACTION.badge, blurb: 'A table.' },
    });
    expect(founded.statusCode, founded.body).toBe(200);
    const factionId = app.repos.factions.findByName('Iron Wolves')!.id;
    app.repos.factions.addMember({
      userId: walkerId,
      factionId,
      rank: 'member',
      joinedAt: new Date().toISOString(),
    });
    /*
     * Credited to the person who is about to walk, which is the whole of §J8's argument: what they
     * won they won while wearing the badge, and the table's record of it must survive them.
     */
    app.repos.factions.addInfamyEarned(walkerId, 640);

    const boardRow = async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/leaderboard?board=factions',
        headers: auth(reader.token),
      });
      const body = response.json<LeaderboardResponse>();
      if (body.board !== 'factions') throw new Error('asked for the factions board');
      return body.entries.find((entry) => entry.factionId === factionId);
    };

    const before = await profileOf(app, reader.token, factionId);
    expect(before.members).toHaveLength(2);
    expect(before.averageLevel).toBe(averageLevel(before.members.map((one) => one.level)));
    expect((await boardRow())?.members).toBe(2);

    const left = await app.inject({
      method: 'POST',
      url: '/api/factions/leave',
      headers: auth(second.token),
    });
    expect(left.statusCode, left.body).toBe(200);

    const after = await profileOf(app, reader.token, factionId);
    expect(after.members).toHaveLength(1);
    expect(after.members.map((one) => one.username)).toEqual(['holds_the_table']);
    expect(after.averageLevel).toBe(averageLevel(after.members.map((one) => one.level)));
    // §J8: what the leaver won while wearing the badge stays won.
    expect(after.faction.infamyEarned).toBe(640);

    const row = await boardRow();
    expect(row?.members).toBe(1);
    expect(row?.averageLevel).toBe(after.averageLevel);
    expect(row?.infamy).toBe(after.faction.infamyEarned);
    expect(row?.rank).toBe(after.rank);

    // And the leaver's own standing row no longer points at a table they are not at.
    const players = await app.inject({
      method: 'GET',
      url: '/api/leaderboard?board=players',
      headers: auth(reader.token),
    });
    const board = players.json<LeaderboardResponse>();
    if (board.board !== 'players') throw new Error('asked for the players board');
    const walker = board.entries.find((entry) => entry.username === 'walks_out_later');
    expect(walker?.factionId).toBeNull();
    expect(walker?.factionName).toBeNull();
  });

  /** ...and the same file, read a moment after the leader ends the table under it. */
  it('answers 404 once the faction it describes is disbanded', async () => {
    const { app } = await makeApp();
    const founder = await player(app, 'ends_it_himself');
    const reader = await player(app, 'reading_when_it_ends');
    establish(app, 'ends_it_himself');
    await app.inject({
      method: 'POST',
      url: '/api/factions',
      headers: auth(founder.token),
      payload: { name: 'Ash Wolves', badge: MVP_RIVAL_FACTION.badge, blurb: '' },
    });
    const factionId = app.repos.factions.findByName('Ash Wolves')!.id;
    expect((await profileOf(app, reader.token, factionId)).members).toHaveLength(1);

    const gone = await app.inject({
      method: 'POST',
      url: '/api/factions/disband',
      headers: auth(founder.token),
    });
    expect(gone.statusCode, gone.body).toBe(200);

    const missing = await app.inject({
      method: 'GET',
      url: `/api/factions/${factionId}/profile`,
      headers: auth(reader.token),
    });
    // 404 rather than an empty table: the reader's open page says the file is gone, and the
    // standings it was reached from no longer carries a door to it.
    expect(missing.statusCode).toBe(404);
    const board = await app.inject({
      method: 'GET',
      url: '/api/leaderboard?board=factions',
      headers: auth(reader.token),
    });
    const body = board.json<LeaderboardResponse>();
    if (body.board !== 'factions') throw new Error('asked for the factions board');
    expect(body.entries.map((entry) => entry.factionId)).not.toContain(factionId);
  });

  it('agrees with the standings about where the faction sits', async () => {
    const { app } = await makeApp();
    const reader = await player(app, 'outsider_seven');

    const board = await app.inject({
      method: 'GET',
      url: '/api/leaderboard?board=factions',
      headers: auth(reader.token),
    });
    const standings = board.json<LeaderboardResponse>();
    if (standings.board !== 'factions') throw new Error('asked for the factions board');

    for (const row of standings.entries) {
      const profile = await profileOf(app, reader.token, row.factionId);
      expect(profile.rank, row.name).toBe(row.rank);
      expect(profile.faction.infamyEarned, row.name).toBe(row.infamy);
      expect(profile.averageLevel, row.name).toBe(row.averageLevel);
    }
  });
});
