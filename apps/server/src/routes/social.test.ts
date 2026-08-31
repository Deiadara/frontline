import {
  DEFAULT_BADGE,
  DEFAULT_CITY_ID,
  FOUND_FACTION_NEXUS_LEVEL,
  FOUND_FACTION_PLAYER_LEVEL,
  MAX_FACTION_MEMBERS,
  randomBadge,
  type FactionResponse,
  type LeaderboardResponse,
  type MessagesResponse,
  type NotificationsResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';

/**
 * Factions, the mailbox and the bell, over HTTP (board request).
 *
 * Driven through the real routes with real accounts rather than against the repos, because every
 * rule worth testing here is a *route* rule: who may invite, what happens at the fifth seat, whose
 * mailbox a message id opens, and whether a muted kind is written at all.
 */

const PASSWORD = 'hunter2pass';

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app: open, db } of instances.splice(0)) {
    await open.close();
    db.close();
  }
});

async function makeApp(): Promise<FastifyInstance> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const built = await buildApp({ config, db, logger: false });
  instances.push({ app: built, db });
  return built;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/**
 * A registered player who has picked an Overseer, which is what gives them a district.
 *
 * §B1 put two gates on founding a faction, a crew level and a Nexus level, and a brand-new
 * district clears neither. Every test in this file is about what happens *after* somebody founds
 * one, so the crew is established here rather than in each of them: the gate itself is tested by
 * name in `refuses a founder whose crew and Nexus are not established yet`.
 */
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
  const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
  const id = me.json<{ user: { id: string } }>().user.id;
  establish(app, id);
  return { token, username, id };
}

/** §B1: gives a crew the level and the Nexus that founding a faction asks for. */
function establish(app: FastifyInstance, userId: string): void {
  const base = app.repos.bases.findByOwnerId(userId);
  if (!base) throw new Error('no base for ' + userId);
  app.repos.bases.updateProgression(base.id, FOUND_FACTION_PLAYER_LEVEL, base.progression);
  app.repos.bases.updateBuildings(
    base.id,
    base.buildings.map((building) =>
      building.kind === 'nexus' ? { ...building, level: FOUND_FACTION_NEXUS_LEVEL } : building,
    ),
  );
}

const faction = async (app: FastifyInstance, token: string): Promise<FactionResponse> =>
  (await app.inject({ method: 'GET', url: '/api/factions', headers: auth(token) })).json();

const messages = async (app: FastifyInstance, token: string): Promise<MessagesResponse> =>
  (await app.inject({ method: 'GET', url: '/api/messages', headers: auth(token) })).json();

const notifications = async (app: FastifyInstance, token: string): Promise<NotificationsResponse> =>
  (await app.inject({ method: 'GET', url: '/api/notifications', headers: auth(token) })).json();

/** Founds a faction under `token`, leaving whatever the seeded world offered behind. */
async function found(app: FastifyInstance, token: string, name: string) {
  return app.inject({
    method: 'POST',
    url: '/api/factions',
    headers: auth(token),
    payload: { name, badge: DEFAULT_BADGE, blurb: '' },
  });
}

let app: FastifyInstance;
beforeEach(async () => {
  app = await makeApp();
});

describe('founding a faction', () => {
  /**
   * §B1: two gates, and the refusal names both.
   *
   * A crew level says the *person* has seen enough of the city to be worth following; a Nexus
   * level says the *place* can administer anybody. A brand-new district clears neither, which is
   * what this asserts: the raw account straight out of `POST /overseer`, before `establish`.
   */
  it('refuses a founder whose crew and Nexus are not established yet', async () => {
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'nobody', password: PASSWORD },
    });
    const token = registered.json<{ token: string }>().token;
    await app.inject({
      method: 'POST',
      url: '/api/overseer',
      headers: auth(token),
      payload: { presetId: 'enforcer' },
    });

    const refused = await found(app, token, 'The Premature');
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: { message: string } }>().error.message).toBe('not_established');

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
    const base = app.repos.bases.findByOwnerId(me.json<{ user: { id: string } }>().user.id);
    if (!base) throw new Error('fixture error: the new player has no district');
    const raiseNexus = (level: number) =>
      app.repos.bases.updateBuildings(
        base.id,
        base.buildings.map((building) =>
          building.kind === 'nexus' ? { ...building, level } : building,
        ),
      );

    // Either gate alone still refuses, and both legs are checked: a version that only ever tested
    // "crew too low" would pass with the Nexus clause deleted outright.
    raiseNexus(FOUND_FACTION_NEXUS_LEVEL);
    expect((await found(app, token, 'The Premature')).statusCode).toBe(409);

    raiseNexus(1);
    app.repos.bases.updateProgression(base.id, FOUND_FACTION_PLAYER_LEVEL, base.progression);
    expect((await found(app, token, 'The Premature')).statusCode).toBe(409);

    // Both, and it goes through.
    raiseNexus(FOUND_FACTION_NEXUS_LEVEL);
    expect((await found(app, token, 'The Premature')).statusCode).toBe(200);
  });

  it('makes the founder its leader, and refuses a second one', async () => {
    const one = await player(app, 'founder');
    expect((await found(app, one.token, 'Iron Wolves')).statusCode).toBe(200);

    const screen = await faction(app, one.token);
    expect(screen.faction?.name).toBe('Iron Wolves');
    expect(screen.rank).toBe('leader');
    expect(screen.members).toHaveLength(1);

    const again = await found(app, one.token, 'Second Table');
    expect(again.statusCode).toBe(409);
    expect(again.json<{ error: { message: string } }>().error.message).toBe('already_in_a_faction');
  });

  /** The same whitespace rule district names live by: two names that paint the same pixels are one. */
  it('refuses a name that only differs by spacing or case', async () => {
    const one = await player(app, 'first');
    const two = await player(app, 'second');
    await found(app, one.token, 'Iron Wolves');

    const clash = await found(app, two.token, 'iron   wolves');
    expect(clash.statusCode).toBe(409);
    expect(clash.json<{ error: { message: string } }>().error.message).toBe('name_taken');
  });
});

describe('getting in', () => {
  it('goes by invitation, and the invited player decides', async () => {
    const leader = await player(app, 'leader');
    const joiner = await player(app, 'joiner');
    await found(app, leader.token, 'Iron Wolves');

    const invited = await app.inject({
      method: 'POST',
      url: '/api/factions/invite',
      headers: auth(leader.token),
      payload: { username: 'joiner' },
    });
    expect(invited.statusCode).toBe(200);

    // The invitation is on the invited player's screen, and the faction can see it is outstanding.
    const theirs = await faction(app, joiner.token);
    const invite = theirs.invites.find((entry) => entry.factionName === 'Iron Wolves');
    expect(invite).toBeDefined();
    expect(invite?.invitedBy).toBe('leader');

    await app.inject({
      method: 'POST',
      url: '/api/factions/answer',
      headers: auth(joiner.token),
      payload: { inviteId: invite?.id, accept: true },
    });

    const after = await faction(app, joiner.token);
    expect(after.faction?.name).toBe('Iron Wolves');
    expect(after.rank).toBe('member');
    expect(after.members.map((member) => member.username).sort()).toEqual(['joiner', 'leader']);
  });

  it('will not take a sixth person', async () => {
    const leader = await player(app, 'leader');
    await found(app, leader.token, 'Iron Wolves');

    // Four more fill it to the cap.
    for (let index = 0; index < MAX_FACTION_MEMBERS - 1; index += 1) {
      const joiner = await player(app, `member${index}`);
      await app.inject({
        method: 'POST',
        url: '/api/factions/invite',
        headers: auth(leader.token),
        payload: { username: joiner.username },
      });
      const invite = (await faction(app, joiner.token)).invites.find(
        (entry) => entry.factionName === 'Iron Wolves',
      );
      await app.inject({
        method: 'POST',
        url: '/api/factions/answer',
        headers: auth(joiner.token),
        payload: { inviteId: invite?.id, accept: true },
      });
    }
    expect((await faction(app, leader.token)).members).toHaveLength(MAX_FACTION_MEMBERS);

    const sixth = await player(app, 'onetoomany');
    const refused = await app.inject({
      method: 'POST',
      url: '/api/factions/invite',
      headers: auth(leader.token),
      payload: { username: sixth.username },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: { message: string } }>().error.message).toBe('faction_full');
  });

  /**
   * The cap is checked when the seat is *taken*, not when it is offered.
   *
   * Five people can each be holding an invitation to the last chair, and only one of them can sit
   * in it. Checking only at invite time is the bug that lets a faction reach six.
   */
  it('checks the cap again at the moment of joining', async () => {
    const leader = await player(app, 'leader');
    await found(app, leader.token, 'Iron Wolves');

    const first = await player(app, 'racer1');
    const second = await player(app, 'racer2');
    for (const who of [first, second]) {
      await app.inject({
        method: 'POST',
        url: '/api/factions/invite',
        headers: auth(leader.token),
        payload: { username: who.username },
      });
    }
    // Fill the remaining seats so exactly one is left for the two invitations already out.
    for (let index = 0; index < MAX_FACTION_MEMBERS - 2; index += 1) {
      const filler = await player(app, `filler${index}`);
      await app.inject({
        method: 'POST',
        url: '/api/factions/invite',
        headers: auth(leader.token),
        payload: { username: filler.username },
      });
      const invite = (await faction(app, filler.token)).invites[0];
      await app.inject({
        method: 'POST',
        url: '/api/factions/answer',
        headers: auth(filler.token),
        payload: { inviteId: invite?.id, accept: true },
      });
    }

    const firstInvite = (await faction(app, first.token)).invites[0];
    const secondInvite = (await faction(app, second.token)).invites[0];
    const won = await app.inject({
      method: 'POST',
      url: '/api/factions/answer',
      headers: auth(first.token),
      payload: { inviteId: firstInvite?.id, accept: true },
    });
    expect(won.statusCode).toBe(200);

    const lost = await app.inject({
      method: 'POST',
      url: '/api/factions/answer',
      headers: auth(second.token),
      payload: { inviteId: secondInvite?.id, accept: true },
    });
    expect(lost.statusCode).toBe(409);
    expect(lost.json<{ error: { message: string } }>().error.message).toBe('faction_full');
    expect((await faction(app, leader.token)).members).toHaveLength(MAX_FACTION_MEMBERS);
  });
});

describe('rank', () => {
  async function table() {
    const leader = await player(app, 'leader');
    const member = await player(app, 'member');
    await found(app, leader.token, 'Iron Wolves');
    await app.inject({
      method: 'POST',
      url: '/api/factions/invite',
      headers: auth(leader.token),
      payload: { username: 'member' },
    });
    const invite = (await faction(app, member.token)).invites[0];
    await app.inject({
      method: 'POST',
      url: '/api/factions/answer',
      headers: auth(member.token),
      payload: { inviteId: invite?.id, accept: true },
    });
    return { leader, member };
  }

  it('lets an ordinary member neither invite nor remove', async () => {
    const { leader, member } = await table();
    const invited = await app.inject({
      method: 'POST',
      url: '/api/factions/invite',
      headers: auth(member.token),
      payload: { username: 'nobody' },
    });
    expect(invited.json<{ error: { message: string } }>().error.message).toBe('not_allowed');

    const kicked = await app.inject({
      method: 'POST',
      url: '/api/factions/member',
      headers: auth(member.token),
      payload: { userId: leader.id, action: 'kick' },
    });
    expect(kicked.json<{ error: { message: string } }>().error.message).toBe('not_allowed');
  });

  /**
   * The board's rule, and the reverse of what this used to do.
   *
   * A leader used to be refused and told to hand it over first, which left somebody who simply
   * wanted out with no way to be finished. Leaving is always allowed now, and a leader leaving ends
   * the faction for everybody: asserted from the *member's* side as well, because "the leader's own
   * screen is empty" is also true of a bug that only removed the leader.
   */
  it('takes the faction with it when the leader walks out', async () => {
    const { leader, member } = await table();
    const left = await app.inject({
      method: 'POST',
      url: '/api/factions/leave',
      headers: auth(leader.token),
    });
    expect(left.statusCode).toBe(200);
    expect((await faction(app, leader.token)).faction).toBeNull();
    expect((await faction(app, member.token)).faction).toBeNull();
  });

  /** ...unless they hand it on first, which is the whole point of being able to hand it on. */
  it('leaves the faction standing when the leader hands it over first', async () => {
    const { leader, member } = await table();
    await app.inject({
      method: 'POST',
      url: '/api/factions/member',
      headers: auth(leader.token),
      payload: { userId: member.id, action: 'hand_over' },
    });
    expect((await faction(app, member.token)).rank).toBe('leader');
    // The old leader is a chief now, so leaving is an ordinary departure.
    expect((await faction(app, leader.token)).rank).toBe('chief');

    const left = await app.inject({
      method: 'POST',
      url: '/api/factions/leave',
      headers: auth(leader.token),
    });
    expect(left.statusCode).toBe(200);
    expect((await faction(app, leader.token)).faction).toBeNull();
    const after = await faction(app, member.token);
    expect(after.faction?.name).toBe('Iron Wolves');
    expect(after.members).toHaveLength(1);
  });

  it('lets the leader disband on purpose, with people still at the table', async () => {
    const { leader, member } = await table();
    const gone = await app.inject({
      method: 'POST',
      url: '/api/factions/disband',
      headers: auth(leader.token),
    });
    expect(gone.statusCode).toBe(200);
    expect((await faction(app, member.token)).faction).toBeNull();
  });

  it('refuses to disband for anybody who does not lead it', async () => {
    const { member } = await table();
    const refused = await app.inject({
      method: 'POST',
      url: '/api/factions/disband',
      headers: auth(member.token),
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: { message: string } }>().error.message).toBe('not_allowed');
  });

  it('disbands when the last person leaves', async () => {
    const one = await player(app, 'alone');
    await found(app, one.token, 'Iron Wolves');
    const left = await app.inject({
      method: 'POST',
      url: '/api/factions/leave',
      headers: auth(one.token),
    });
    expect(left.statusCode).toBe(200);
    expect((await faction(app, one.token)).faction).toBeNull();
  });
});

describe('the mailbox', () => {
  it('reaches one player, and the sender keeps a copy that counts the readers', async () => {
    const from = await player(app, 'writer');
    const to = await player(app, 'reader');

    const sent = await app.inject({
      method: 'POST',
      url: '/api/messages',
      headers: auth(from.token),
      payload: { toUsername: 'reader', subject: 'The docks', body: 'Tonight.' },
    });
    expect(sent.statusCode).toBe(200);

    const inbox = await messages(app, to.token);
    expect(inbox.inbox).toHaveLength(1);
    expect(inbox.inbox[0]?.subject).toBe('The docks');
    expect(inbox.inbox[0]?.readAt).toBeNull();
    expect(inbox.unread).toBe(1);

    // The sender's own folder is the same table, so the two views cannot disagree.
    const outbox = await messages(app, from.token);
    expect(outbox.sent).toHaveLength(1);
    expect(outbox.sent[0]?.recipients).toBe(1);
    expect(outbox.sent[0]?.readBy).toBe(0);
    expect(outbox.unread, 'your own sent copy is not unread mail').toBe(0);

    await app.inject({
      method: 'POST',
      url: '/api/messages/read',
      headers: auth(to.token),
      payload: { id: inbox.inbox[0]?.id },
    });
    expect((await messages(app, to.token)).unread).toBe(0);
    expect((await messages(app, from.token)).sent[0]?.readBy).toBe(1);
  });

  it('fans a faction message out to everybody but the sender', async () => {
    const leader = await player(app, 'leader');
    const member = await player(app, 'member');
    await found(app, leader.token, 'Iron Wolves');
    await app.inject({
      method: 'POST',
      url: '/api/factions/invite',
      headers: auth(leader.token),
      payload: { username: 'member' },
    });
    const invite = (await faction(app, member.token)).invites[0];
    await app.inject({
      method: 'POST',
      url: '/api/factions/answer',
      headers: auth(member.token),
      payload: { inviteId: invite?.id, accept: true },
    });

    await app.inject({
      method: 'POST',
      url: '/api/messages',
      headers: auth(leader.token),
      payload: { toUsername: null, subject: 'Tonight', body: 'The docks.' },
    });

    // Asserted on the faction-addressed message rather than on the size of the inbox: the member
    // was invited to get here, and an invitation is a message too, so a count would be counting
    // the feature under test plus the one that set it up.
    const inbox = (await messages(app, member.token)).inbox;
    const addressed = inbox.filter((entry) => entry.audience === 'faction');
    expect(addressed).toHaveLength(1);
    expect(addressed[0]?.subject).toBe('Tonight');
    // One recipient, not two: the sender does not write to themselves.
    expect((await messages(app, leader.token)).sent[0]?.recipients).toBe(1);
    // ...and an invitation leaves no sent copy, so the leader's own inbox is still empty.
    expect((await messages(app, leader.token)).inbox).toHaveLength(0);
  });

  it('will not open somebody else’s mail', async () => {
    const from = await player(app, 'writer');
    const to = await player(app, 'reader');
    const nosy = await player(app, 'nosy');
    await app.inject({
      method: 'POST',
      url: '/api/messages',
      headers: auth(from.token),
      payload: { toUsername: 'reader', subject: 'Private', body: 'Between us.' },
    });
    const id = (await messages(app, to.token)).inbox[0]?.id;

    const peeked = await app.inject({
      method: 'POST',
      url: '/api/messages/read',
      headers: auth(nosy.token),
      payload: { id },
    });
    expect(peeked.statusCode).toBe(404);
    expect((await messages(app, to.token)).unread, 'still unread for its owner').toBe(1);
  });

  it('refuses a faction message from somebody with no faction', async () => {
    const alone = await player(app, 'alone');
    const refused = await app.inject({
      method: 'POST',
      url: '/api/messages',
      headers: auth(alone.token),
      payload: { toUsername: null, subject: 'Anyone', body: 'Hello?' },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: { message: string } }>().error.message).toBe('not_in_a_faction');
  });
});

describe('the bell', () => {
  it('writes a receipt a player asked for, and counts it unread until it is opened', async () => {
    const from = await player(app, 'writer');
    const to = await player(app, 'reader');
    await app.inject({
      method: 'POST',
      url: '/api/messages',
      headers: auth(from.token),
      payload: { toUsername: 'reader', subject: 'The docks', body: 'Tonight.' },
    });

    const bell = await notifications(app, to.token);
    const written = bell.notifications.find((entry) => entry.kind === 'message_received');
    expect(written).toBeDefined();
    // Every receipt goes somewhere: one that does not is a line of text that makes a player hunt.
    expect(written?.link).toBe('/game/messages');
    expect(bell.unread).toBeGreaterThan(0);

    await app.inject({
      method: 'POST',
      url: '/api/notifications/read',
      headers: auth(to.token),
      payload: { id: written?.id },
    });
    const after = await notifications(app, to.token);
    expect(after.notifications.find((entry) => entry.id === written?.id)?.readAt).not.toBeNull();
  });

  /**
   * The filter is applied at **write** time, which is the whole design.
   *
   * A muted kind is never recorded, so switching a category back on is a statement about the future
   * rather than an unpacking of three weeks of history, and the badge is always a count of things
   * the player asked for.
   */
  it('never records a kind the player has switched off', async () => {
    const from = await player(app, 'writer');
    const to = await player(app, 'reader');

    await app.inject({
      method: 'POST',
      url: '/api/notifications/settings',
      headers: auth(to.token),
      payload: { muted: ['message_received'] },
    });
    await app.inject({
      method: 'POST',
      url: '/api/messages',
      headers: auth(from.token),
      payload: { toUsername: 'reader', subject: 'Silent', body: 'Nothing rings.' },
    });

    const bell = await notifications(app, to.token);
    expect(bell.notifications.filter((entry) => entry.kind === 'message_received')).toHaveLength(0);
    // And the message still arrived: muting the bell does not mute the post.
    expect((await messages(app, to.token)).inbox).toHaveLength(1);
  });

  it('refuses to silence the two kinds that report something irreversible', async () => {
    const one = await player(app, 'player');
    const saved = await app.inject({
      method: 'POST',
      url: '/api/notifications/settings',
      headers: auth(one.token),
      payload: { muted: ['battle_report', 'district_attacked', 'training_done'] },
    });
    expect(saved.statusCode).toBe(200);
    const settings = saved.json<{ notifications: NotificationsResponse }>().notifications.settings;
    // The client is not a gate: an out-of-date one asking for this gets the settings it should
    // have had rather than an error.
    expect(settings.muted).toEqual(['training_done']);
  });

  it('marks everything read in one go, and the HUD count follows', async () => {
    const from = await player(app, 'writer');
    const to = await player(app, 'reader');
    for (const subject of ['One', 'Two', 'Three']) {
      await app.inject({
        method: 'POST',
        url: '/api/messages',
        headers: auth(from.token),
        payload: { toUsername: 'reader', subject, body: 'x' },
      });
    }
    expect((await notifications(app, to.token)).unread).toBeGreaterThanOrEqual(3);

    await app.inject({
      method: 'POST',
      url: '/api/notifications/read-all',
      headers: auth(to.token),
    });
    expect((await notifications(app, to.token)).unread).toBe(0);

    // The badge the standing bar draws comes off `/me`, so it has to move with them.
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(to.token) });
    expect(me.json<{ unread: { notifications: number } }>().unread.notifications).toBe(0);
    expect(me.json<{ unread: { messages: number } }>().unread.messages).toBe(3);
  });
});

/**
 * The rank the board asked for, over HTTP.
 *
 * The shared `factions.test.ts` pins the permission table as arithmetic; this pins that the routes
 * actually ask it. Both are needed: a correct table nobody consults is the same bug as a wrong one,
 * and it is the shape of bug that passes every unit test.
 */
describe('what a chief may do', () => {
  /** A leader, a chief and an ordinary member, which is the smallest table with every rank on it. */
  async function ranked() {
    const leader = await player(app, 'boss');
    const chief = await player(app, 'chief');
    const member = await player(app, 'grunt');
    await found(app, leader.token, 'Iron Wolves');

    for (const username of ['chief', 'grunt']) {
      await app.inject({
        method: 'POST',
        url: '/api/factions/invite',
        headers: auth(leader.token),
        payload: { username },
      });
    }
    for (const who of [chief, member]) {
      const invite = (await faction(app, who.token)).invites[0];
      await app.inject({
        method: 'POST',
        url: '/api/factions/answer',
        headers: auth(who.token),
        payload: { inviteId: invite?.id, accept: true },
      });
    }
    await app.inject({
      method: 'POST',
      url: '/api/factions/member',
      headers: auth(leader.token),
      payload: { userId: chief.id, action: 'promote' },
    });
    expect((await faction(app, chief.token)).rank).toBe('chief');
    return { leader, chief, member };
  }

  const refusal = (response: { json: <T>() => T }) =>
    response.json<{ error: { message: string } }>().error.message;

  it('invites, and removes an ordinary member', async () => {
    const { chief, member } = await ranked();
    await player(app, 'stranger');

    const invited = await app.inject({
      method: 'POST',
      url: '/api/factions/invite',
      headers: auth(chief.token),
      payload: { username: 'stranger' },
    });
    expect(invited.statusCode).toBe(200);

    const kicked = await app.inject({
      method: 'POST',
      url: '/api/factions/member',
      headers: auth(chief.token),
      payload: { userId: member.id, action: 'kick' },
    });
    expect(kicked.statusCode).toBe(200);
    expect((await faction(app, member.token)).faction).toBeNull();
  });

  it('rewrites the description, because the pitch is the chief’s job too', async () => {
    const { chief } = await ranked();
    const written = await app.inject({
      method: 'POST',
      url: '/api/factions/description',
      headers: auth(chief.token),
      payload: { blurb: 'We take the docks at midnight.' },
    });
    expect(written.statusCode).toBe(200);
    expect((await faction(app, chief.token)).faction?.blurb).toBe('We take the docks at midnight.');
  });

  it('cannot rename the faction or change its badge', async () => {
    const { chief } = await ranked();
    const renamed = await app.inject({
      method: 'POST',
      url: '/api/factions/identity',
      headers: auth(chief.token),
      payload: { name: 'Chief’s Own', badge: randomBadge(9) },
    });
    expect(renamed.statusCode).toBe(409);
    expect(refusal(renamed)).toBe('not_allowed');
    expect((await faction(app, chief.token)).faction?.name).toBe('Iron Wolves');
  });

  /**
   * The cell the whole two-argument permission exists for.
   *
   * Two chiefs who could remove each other turn a disagreement into a race, and both of them can
   * see the button.
   */
  it('cannot remove another chief, or the leader', async () => {
    const { leader, chief, member } = await ranked();
    await app.inject({
      method: 'POST',
      url: '/api/factions/member',
      headers: auth(leader.token),
      payload: { userId: member.id, action: 'promote' },
    });

    const onChief = await app.inject({
      method: 'POST',
      url: '/api/factions/member',
      headers: auth(chief.token),
      payload: { userId: member.id, action: 'kick' },
    });
    expect(refusal(onChief)).toBe('not_allowed');

    const onLeader = await app.inject({
      method: 'POST',
      url: '/api/factions/member',
      headers: auth(chief.token),
      payload: { userId: leader.id, action: 'kick' },
    });
    expect(refusal(onLeader)).toBe('not_allowed');
    expect((await faction(app, leader.token)).members).toHaveLength(3);
  });

  it('cannot make anybody else a chief', async () => {
    const { chief, member } = await ranked();
    const promoted = await app.inject({
      method: 'POST',
      url: '/api/factions/member',
      headers: auth(chief.token),
      payload: { userId: member.id, action: 'promote' },
    });
    expect(refusal(promoted)).toBe('not_allowed');
    expect((await faction(app, member.token)).rank).toBe('member');
  });
});

describe('the badge', () => {
  it('comes back exactly as it was drawn', async () => {
    const one = await player(app, 'artist');
    const badge = randomBadge(7);
    await app.inject({
      method: 'POST',
      url: '/api/factions',
      headers: auth(one.token),
      payload: { name: 'Iron Wolves', badge, blurb: '' },
    });
    expect((await faction(app, one.token)).faction?.badge).toEqual(badge);
  });

  it('is the leader’s to change, along with the name', async () => {
    const one = await player(app, 'artist');
    await found(app, one.token, 'Iron Wolves');
    const redrawn = randomBadge(21);
    const saved = await app.inject({
      method: 'POST',
      url: '/api/factions/identity',
      headers: auth(one.token),
      payload: { name: 'Iron Wolves Reborn', badge: redrawn },
    });
    expect(saved.statusCode).toBe(200);
    const screen = await faction(app, one.token);
    expect(screen.faction?.name).toBe('Iron Wolves Reborn');
    expect(screen.faction?.badge).toEqual(redrawn);
  });

  it('refuses a badge naming a shape that does not exist', async () => {
    const one = await player(app, 'artist');
    const bad = await app.inject({
      method: 'POST',
      url: '/api/factions',
      headers: auth(one.token),
      payload: { name: 'Iron Wolves', badge: { ...DEFAULT_BADGE, shape: 'hexagon' }, blurb: '' },
    });
    expect(bad.statusCode).toBe(400);
  });
});

/**
 * §J: the invitation arrives in the inbox, and is answered from there.
 *
 * The board asked for the invite to be a message with a button on it rather than a second list
 * somewhere else, so what is asserted is that the message *carries the invitation*: same id, so
 * pressing the button spends the same row the faction screen would.
 */
describe('an invitation in the mailbox', () => {
  async function invited() {
    const leader = await player(app, 'leader');
    const joiner = await player(app, 'joiner');
    await found(app, leader.token, 'Iron Wolves');
    await app.inject({
      method: 'POST',
      url: '/api/factions/invite',
      headers: auth(leader.token),
      payload: { username: 'joiner' },
    });
    return { leader, joiner };
  }

  it('lands as a message carrying the invitation and the faction’s badge', async () => {
    const { joiner } = await invited();
    const inbox = (await messages(app, joiner.token)).inbox;
    expect(inbox).toHaveLength(1);

    const carried = inbox[0]?.invite;
    expect(carried?.factionName).toBe('Iron Wolves');
    expect(carried?.badge).toEqual(DEFAULT_BADGE);
    expect(carried?.open).toBe(true);
    // The same row the faction screen offers, not a copy of it.
    expect(carried?.inviteId).toBe((await faction(app, joiner.token)).invites[0]?.id);
  });

  it('joins the faction when the button is pressed', async () => {
    const { joiner } = await invited();
    const carried = (await messages(app, joiner.token)).inbox[0]?.invite;
    const joined = await app.inject({
      method: 'POST',
      url: '/api/factions/answer',
      headers: auth(joiner.token),
      payload: { inviteId: carried?.inviteId, accept: true },
    });
    expect(joined.statusCode).toBe(200);
    expect((await faction(app, joiner.token)).faction?.name).toBe('Iron Wolves');
  });

  /**
   * The message outlives the invitation, and stops offering a way in.
   *
   * This is the reason `open` is a join rather than a stored flag: the row is deleted on answer, so
   * anything copied onto the message at send time would still say yes.
   */
  it('goes quiet once it has been answered', async () => {
    const { joiner } = await invited();
    const carried = (await messages(app, joiner.token)).inbox[0]?.invite;
    await app.inject({
      method: 'POST',
      url: '/api/factions/answer',
      headers: auth(joiner.token),
      payload: { inviteId: carried?.inviteId, accept: false },
    });

    const after = (await messages(app, joiner.token)).inbox[0]?.invite;
    expect(after?.open).toBe(false);
    // ...and still says which faction it was, which a deleted row could not have told it.
    expect(after?.factionName).toBe('Iron Wolves');
  });

  it('leaves no sent copy in the inviter’s folder', async () => {
    const { leader } = await invited();
    expect((await messages(app, leader.token)).sent).toHaveLength(0);
  });
});

/**
 * §J9: the standings.
 *
 * Two boards and a scope toggle, driven over HTTP. The rules worth pinning are the ones a naive
 * implementation gets wrong: ties share a place, the faction board ranks *earned* infamy rather
 * than the sum of its members' wallets, and your own rank is reported even when you are off the
 * end of the page.
 */
describe('the leaderboard', () => {
  const board = async (token: string, query = '') =>
    (
      await app.inject({
        method: 'GET',
        url: `/api/leaderboard${query}`,
        headers: auth(token),
      })
    ).json<LeaderboardResponse>();

  /** Gives a player a standing without fighting for it. */
  const setInfamy = (userId: string, infamy: number) => {
    const base = app.repos.bases.findByOwnerId(userId)!;
    app.repos.bases.updateEconomy(base.id, { ...base.economy, infamy });
  };

  it('ranks the players by infamy, highest first', async () => {
    const one = await player(app, 'ahead');
    const two = await player(app, 'behind');
    setInfamy(one.id, 5000);
    setInfamy(two.id, 900);

    const standings = await board(one.token);
    expect(standings.board).toBe('players');
    const names = standings.entries.map((entry) => ('username' in entry ? entry.username : ''));
    expect(names.indexOf('ahead')).toBeLessThan(names.indexOf('behind'));
    expect(standings.yourRank).toBe(1);
  });

  /** Two on the same score are both second, and the next one down is fourth. */
  it('gives a tie the same place, and skips the place it used up', async () => {
    const top = await player(app, 'top');
    const a = await player(app, 'tied_a');
    const b = await player(app, 'tied_b');
    const last = await player(app, 'last');
    setInfamy(top.id, 9000);
    setInfamy(a.id, 4000);
    setInfamy(b.id, 4000);
    setInfamy(last.id, 10);

    const rows = (await board(top.token)).entries as { username: string; rank: number }[];
    const rankOf = (name: string) => rows.find((row) => row.username === name)!.rank;
    expect(rankOf('top')).toBe(1);
    expect(rankOf('tied_a')).toBe(2);
    expect(rankOf('tied_b')).toBe(2);
    expect(rankOf('last')).toBe(4);
  });

  /**
   * The faction board ranks what was earned at the table.
   *
   * The two factions below are built so a wallet-summing board would order them the other way
   * round: the one that has earned nothing is full of rich members.
   */
  it('ranks factions by what they earned, not by what their members hold', async () => {
    const earner = await player(app, 'earner');
    const holder = await player(app, 'holder');
    await found(app, earner.token, 'Iron Wolves');
    await found(app, holder.token, 'Rich Idlers');

    setInfamy(holder.id, 90_000);
    app.repos.factions.addInfamyEarned(earner.id, 1200);

    const rows = (await board(earner.token, '?board=factions')).entries as {
      name: string;
      infamy: number;
      rank: number;
    }[];
    expect(rows[0]?.name).toBe('Iron Wolves');
    expect(rows[0]?.infamy).toBe(1200);
    // The rich faction is on the board, and on nothing.
    expect(rows.find((row) => row.name === 'Rich Idlers')?.infamy).toBe(0);
    expect((await board(earner.token, '?board=factions')).yourRank).toBe(1);
  });

  /**
   * The scope is the **city**, and there is one city.
   *
   * So both scopes list the same people today, which is the board's call and not an accident: the
   * filter is written against a city id so that a second city makes it real without a screen
   * change. What is asserted is that the request is honoured and scoped, rather than that it
   * removes anybody, because right now there is nobody to remove.
   */
  it('scopes the board to your own city when asked', async () => {
    const mine = await player(app, 'neighbour');
    const other = await player(app, 'stranger');
    setInfamy(other.id, 50_000);

    const everywhere = await board(mine.token);
    expect(everywhere.localOnly).toBe(false);
    expect(everywhere.scope).toBeNull();

    const local = await board(mine.token, '?localOnly=true');
    expect(local.localOnly).toBe(true);
    expect(local.scope).toBe(DEFAULT_CITY_ID);
    // Everybody in Ashfall, which is currently everybody.
    const named = (rows: LeaderboardResponse['entries']) =>
      (rows as { username: string }[]).map((row) => row.username);
    expect(named(local.entries)).toEqual(named(everywhere.entries));
    expect(named(local.entries)).toContain('stranger');
  });

  /** A district nobody authored has no city, so the local board falls back to everybody. */
  it('scopes by city rather than by district', async () => {
    const mine = await player(app, 'local');
    const neighbour = await player(app, 'two_streets_over');
    setInfamy(neighbour.id, 4_000);

    // Two players in different districts of the same city are on each other's local board.
    const base = app.repos.bases.findByOwnerId(neighbour.id)!;
    const home = app.repos.bases.findByOwnerId(mine.id)!.districtId;
    app.db
      .prepare('UPDATE bases SET district_id = ? WHERE id = ?')
      .run(home === 'rustyard' ? 'neon-docks' : 'rustyard', base.id);

    const local = await board(mine.token, '?localOnly=true');
    expect(
      (local.entries as { username: string }[]).some((row) => row.username === 'two_streets_over'),
    ).toBe(true);
  });

  /** A player with no district has no city, and gets everybody rather than an empty screen. */
  it('answers a local request with everybody when the caller has no district', async () => {
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'homeless', password: PASSWORD },
    });
    const token = registered.json<{ token: string }>().token;

    const local = await board(token, '?localOnly=true');
    expect(local.localOnly).toBe(false);
    expect(local.scope).toBeNull();
  });
});
