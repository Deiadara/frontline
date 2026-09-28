/**
 * People: factions (found, invite, answer, ranks, kick, hand over, leave, disband, the profile),
 * the mailbox, the bell, and the live channel that nudges both.
 */
import {
  DEFAULT_BADGE,
  type FactionMutationResponse,
  type FactionProfileResponse,
  type FactionResponse,
  type MessageMutationResponse,
  type MessagesResponse,
  type NotificationMutationResponse,
  type NotificationsResponse,
  FOUND_FACTION_PLAYER_LEVEL,
} from '@frontline/shared';
import { reachFactionLevel, setLevel } from './playthrough-bench.js';
import type { Harness, Player } from './playthrough-harness.js';
import { player, type Cast } from './playthrough-cast.js';
import { checkLiveFrames, openLiveStream } from './playthrough-live.js';

async function faction(h: Harness, crew: Player): Promise<FactionResponse | undefined> {
  return h.ok<FactionResponse>({ as: crew, method: 'GET', route: '/api/factions' });
}

async function inviteFrom(
  h: Harness,
  leader: Player,
  invitee: Player,
): Promise<string | undefined> {
  await h.ok<FactionMutationResponse>({
    as: leader,
    method: 'POST',
    route: '/api/factions/invite',
    body: { username: invitee.username },
  });
  const theirs = await faction(h, invitee);
  const leadersFaction = (await faction(h, leader))?.faction?.id;
  return theirs?.invites.find((one) => one.factionId === leadersFaction)?.id;
}

export async function factions(h: Harness, cast: Cast): Promise<void> {
  const a = player(cast, 'A');
  const b = player(cast, 'B');
  const c = player(cast, 'C');
  const d = player(cast, 'D');
  const e = player(cast, 'E');

  h.at('factions: a table of its own');
  /*
   * The launch world has no seeded crews and so no seeded table (maintainer, 2026-09-28): a crew
   * reaching level 10 is sent no opening letter, and meets factions by founding one or being asked
   * by a player. D founds one, which is also what puts D at a table for the refusals below.
   */
  reachFactionLevel(h, d);
  const dScreen = await faction(h, d);
  h.check(dScreen?.invites.length === 0, 'a letter arrived from a table nobody seeded');
  const signal = await h.ok<FactionMutationResponse>({
    as: d,
    method: 'POST',
    route: '/api/factions',
    body: { name: 'Signal Table', badge: DEFAULT_BADGE },
  });
  h.check(
    signal?.faction.rank === 'leader',
    `D founded a table and holds rank ${signal?.faction.rank}`,
  );

  h.at('factions: founding one');
  await h.refuse({
    as: e,
    method: 'POST',
    route: '/api/factions',
    body: { name: 'Ember Pact', badge: DEFAULT_BADGE },
    expect: 409,
    code: 'FACTION_REFUSED',
  });
  const founded = await h.ok<FactionMutationResponse>({
    as: a,
    method: 'POST',
    route: '/api/factions',
    body: { name: 'Ash Wardens', badge: DEFAULT_BADGE, blurb: 'We hold the terraces.' },
  });
  const ashId = founded?.faction.faction?.id;
  h.check(founded?.faction.rank === 'leader', 'the founder does not lead the faction');
  h.check(
    founded?.faction.invites.length === 0,
    'founding a faction left old invitations standing',
  );
  if (ashId) cast.facts.set('faction:ash', ashId);
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/factions',
    body: { name: 'Second Table', badge: DEFAULT_BADGE },
    expect: 409,
    code: 'FACTION_REFUSED',
  });
  await h.refuse({
    as: c,
    method: 'POST',
    route: '/api/factions',
    body: { name: 'ash  WARDENS', badge: DEFAULT_BADGE },
    expect: 409,
    code: 'FACTION_REFUSED',
  });
  await h.refuse({
    as: c,
    method: 'POST',
    route: '/api/factions',
    body: { name: 'x', badge: DEFAULT_BADGE },
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  await h.refuseMalformed(c, '/api/factions', { name: 'Rail Ghosts', badge: 'skull' });

  h.at('factions: invitations');
  const bInvite = await inviteFrom(h, a, b);
  h.check(bInvite !== undefined, "B was not handed A's invitation");
  const bMail = await h.ok<MessagesResponse>({ as: b, method: 'GET', route: '/api/messages' });
  h.check(
    Boolean(bMail?.inbox.some((one) => one.invite?.inviteId === bInvite)),
    'the invitation did not arrive as a message with a button on it',
  );
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/factions/invite',
    body: { username: b.username },
    expect: 409,
    code: 'FACTION_REFUSED',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/factions/invite',
    body: { username: 'pt_nobody' },
    expect: 409,
    code: 'FACTION_REFUSED',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/factions/invite',
    body: { username: a.username },
    expect: 409,
    code: 'FACTION_REFUSED',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/factions/invite',
    body: { username: d.username },
    expect: 409,
    code: 'FACTION_REFUSED',
  });
  await h.refuse({
    as: b,
    method: 'POST',
    route: '/api/factions/invite',
    body: { username: c.username },
    expect: 409,
    code: 'FACTION_REFUSED',
  });
  await h.refuseMalformed(a, '/api/factions/invite', { username: '' });
  if (bInvite) {
    // Declined, then asked again, then accepted.
    await h.ok({
      as: b,
      method: 'POST',
      route: '/api/factions/answer',
      body: { inviteId: bInvite, accept: false },
    });
    await h.refuse({
      as: b,
      method: 'POST',
      route: '/api/factions/answer',
      body: { inviteId: bInvite, accept: true },
      expect: 409,
      code: 'FACTION_REFUSED',
    });
  }
  const bAgain = await inviteFrom(h, a, b);
  if (bAgain) {
    const joined = await h.ok<FactionMutationResponse>({
      as: b,
      method: 'POST',
      route: '/api/factions/answer',
      body: { inviteId: bAgain, accept: true },
    });
    h.check(
      joined?.faction.rank === 'member',
      `B joined A's faction at rank ${joined?.faction.rank}`,
    );
  }
  await h.refuseMalformed(b, '/api/factions/answer', { inviteId: 'x', accept: 'yes' });
  const aBell = await h.ok<NotificationsResponse>({
    as: a,
    method: 'GET',
    route: '/api/notifications',
  });
  h.check(
    Boolean(aBell?.notifications.some((one) => one.kind === 'faction_joined')),
    'A was not told B joined',
  );

  h.at('factions: ranks and the name');
  await h.refuse({
    as: b,
    method: 'POST',
    route: '/api/factions/description',
    body: { blurb: 'B wrote this.' },
    expect: 409,
    code: 'FACTION_REFUSED',
  });
  await h.refuse({
    as: b,
    method: 'POST',
    route: '/api/factions/identity',
    body: { name: 'B Wardens', badge: DEFAULT_BADGE },
    expect: 409,
    code: 'FACTION_REFUSED',
  });
  await h.ok({
    as: a,
    method: 'POST',
    route: '/api/factions/description',
    body: { blurb: 'The terraces, and whatever we can hold past them.' },
  });
  const renamed = await h.ok<FactionMutationResponse>({
    as: a,
    method: 'POST',
    route: '/api/factions/identity',
    body: { name: 'Ash Wardens Reborn', badge: { ...DEFAULT_BADGE, shape: DEFAULT_BADGE.shape } },
  });
  h.check(
    renamed?.faction.faction?.name === 'Ash Wardens Reborn',
    'the faction rename did not stick',
  );
  await h.refuseMalformed(a, '/api/factions/identity', { name: 'Ash', badge: null });
  await h.refuseMalformed(a, '/api/factions/description', { blurb: 5 });
  await h.ok({
    as: a,
    method: 'POST',
    route: '/api/factions/member',
    body: { userId: b.userId, action: 'promote' },
  });
  const bRank = await faction(h, b);
  h.check(bRank?.rank === 'chief', `B was promoted and holds rank ${bRank?.rank}`);
  await h.ok({
    as: b,
    method: 'POST',
    route: '/api/factions/description',
    body: { blurb: 'Kept current by a chief.' },
  });
  await h.refuse({
    as: b,
    method: 'POST',
    route: '/api/factions/identity',
    body: { name: 'Chief Wardens', badge: DEFAULT_BADGE },
    expect: 409,
    code: 'FACTION_REFUSED',
  });
  await h.refuse({
    as: b,
    method: 'POST',
    route: '/api/factions/member',
    body: { userId: a.userId, action: 'kick' },
    expect: 409,
    code: 'FACTION_REFUSED',
  });
  await h.refuse({
    as: b,
    method: 'POST',
    route: '/api/factions/member',
    body: { userId: a.userId, action: 'demote' },
    expect: 409,
    code: 'FACTION_REFUSED',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/factions/member',
    body: { userId: a.userId, action: 'demote' },
    expect: 409,
    code: 'FACTION_REFUSED',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/factions/member',
    body: { userId: c.userId, action: 'kick' },
    expect: 409,
    code: 'FACTION_REFUSED',
  });
  await h.refuseMalformed(a, '/api/factions/member', { userId: b.userId, action: 'exile' });
  await h.ok({
    as: a,
    method: 'POST',
    route: '/api/factions/member',
    body: { userId: b.userId, action: 'demote' },
  });

  h.at('factions: a second table, kicked, handed over, disbanded');
  const rail = await h.ok<FactionMutationResponse>({
    as: c,
    method: 'POST',
    route: '/api/factions',
    body: { name: 'Rail Ghosts', badge: DEFAULT_BADGE },
  });
  const railId = rail?.faction.faction?.id;
  // E has sat at level 1 for the door probes, which have run; joining needs level 10.
  setLevel(h, e, FOUND_FACTION_PLAYER_LEVEL);
  const eFirst = await inviteFrom(h, c, e);
  if (eFirst)
    await h.ok({
      as: e,
      method: 'POST',
      route: '/api/factions/answer',
      body: { inviteId: eFirst, accept: true },
    });
  await h.ok({
    as: c,
    method: 'POST',
    route: '/api/factions/member',
    body: { userId: e.userId, action: 'kick' },
  });
  const eAfterKick = await faction(h, e);
  h.check(eAfterKick?.faction === null, 'E was kicked and is still at the table');
  const eBell = await h.ok<NotificationsResponse>({
    as: e,
    method: 'GET',
    route: '/api/notifications',
  });
  h.check(
    Boolean(eBell?.notifications.some((one) => one.kind === 'faction_left')),
    'E was kicked and not told',
  );
  const eSecond = await inviteFrom(h, c, e);
  if (eSecond)
    await h.ok({
      as: e,
      method: 'POST',
      route: '/api/factions/answer',
      body: { inviteId: eSecond, accept: true },
    });
  await h.ok({
    as: c,
    method: 'POST',
    route: '/api/factions/member',
    body: { userId: e.userId, action: 'hand_over' },
  });
  const handed = await faction(h, e);
  h.check(handed?.rank === 'leader', `E was handed the faction and holds rank ${handed?.rank}`);
  h.check(
    (await faction(h, c))?.rank === 'chief',
    'the old leader is not a chief after handing over',
  );
  // A chief walking out leaves; the leader's table stays.
  await h.ok({ as: c, method: 'POST', route: '/api/factions/leave', body: {} });
  h.check((await faction(h, c))?.faction === null, 'C left and is still a member');
  await h.refuse({
    as: c,
    method: 'POST',
    route: '/api/factions/leave',
    body: {},
    expect: 409,
    code: 'FACTION_REFUSED',
  });
  await h.refuse({
    as: c,
    method: 'POST',
    route: '/api/factions/disband',
    body: {},
    expect: 409,
    code: 'FACTION_REFUSED',
  });
  if (railId) {
    const profile = await h.ok<FactionProfileResponse>({
      as: a,
      method: 'GET',
      route: '/api/factions/:id/profile',
      params: { id: railId },
    });
    h.check(
      profile?.isYours === false && profile.members.length === 1,
      `the Rail Ghosts profile reads ${JSON.stringify(profile?.members.map((one) => one.handle))}`,
    );
  }
  await h.ok({ as: e, method: 'POST', route: '/api/factions/disband', body: {} });
  h.check((await faction(h, e))?.faction === null, 'E disbanded the faction and is still in it');
  if (railId) {
    await h.call({
      as: a,
      method: 'GET',
      route: '/api/factions/:id/profile',
      params: { id: railId },
      expect: 404,
      code: 'NOT_FOUND',
    });
  }
  await h.call({
    as: a,
    method: 'GET',
    route: '/api/factions/:id/profile',
    params: { id: 'no-such-faction' },
    expect: 404,
    code: 'NOT_FOUND',
  });
  if (ashId) {
    const mine = await h.ok<FactionProfileResponse>({
      as: a,
      method: 'GET',
      route: '/api/factions/:id/profile',
      params: { id: ashId },
    });
    h.check(
      mine?.isYours === true && mine.members.length === 2,
      'the Ash Wardens profile does not show A and B',
    );
  }
  // C founds again, for the battles later: a table of one.
  await h.ok({
    as: c,
    method: 'POST',
    route: '/api/factions',
    body: { name: 'Rail Ghosts', badge: DEFAULT_BADGE },
  });
}

export async function mailAndBell(h: Harness, cast: Cast): Promise<void> {
  const a = player(cast, 'A');
  const b = player(cast, 'B');
  const c = player(cast, 'C');
  const e = player(cast, 'E');

  h.at('mail: the live channel is open');
  const bStream = await openLiveStream(h, b);
  h.check(bStream.status === 200, `the live channel answered ${bStream.status}`);
  h.check(
    Boolean(bStream.contentType?.startsWith('text/event-stream')),
    `the live channel is served as ${bStream.contentType}`,
  );
  h.check(await bStream.waitFor('ready'), 'the live channel never said it was ready');
  const anonymous = await fetch('http://127.0.0.1:4030/api/events');
  h.check(anonymous.status === 401, `an anonymous live channel answered ${anonymous.status}`);
  await anonymous.body?.cancel();

  h.at('mail: a letter');
  const sent = await h.ok<MessageMutationResponse>({
    as: a,
    method: 'POST',
    route: '/api/messages',
    body: { toUsernames: [b.username], subject: 'Terraces', body: 'Hold the east stair tonight.' },
  });
  h.check(
    Boolean(sent?.messages.sent.some((one) => one.subject === 'Terraces')),
    'the letter is not in the sent box',
  );
  h.check(
    await bStream.waitFor('message'),
    'B was not nudged on the live channel when mail arrived',
  );
  h.check(
    await bStream.waitFor('notification'),
    'B was not nudged on the live channel for the bell',
  );
  const inbox = await h.ok<MessagesResponse>({ as: b, method: 'GET', route: '/api/messages' });
  const letter = inbox?.inbox.find((one) => one.subject === 'Terraces');
  h.check(letter !== undefined && letter.readAt === null, 'the letter did not arrive unread');
  const unreadBefore = inbox?.unread ?? 0;
  if (letter) {
    const read = await h.ok<MessageMutationResponse>({
      as: b,
      method: 'POST',
      route: '/api/messages/read',
      body: { id: letter.id },
    });
    h.check(
      read?.messages.unread === unreadBefore - 1,
      `reading one letter took the count from ${unreadBefore} to ${read?.messages.unread}`,
    );
    // Not a key to somebody else's mailbox.
    await h.refuse({
      as: c,
      method: 'POST',
      route: '/api/messages/read',
      body: { id: letter.id },
      expect: 404,
      code: 'NOT_FOUND',
    });
    await h.unchanged({
      as: c,
      method: 'POST',
      route: '/api/messages/delete',
      body: { id: letter.id },
      expect: 200,
    });
    const still = await h.ok<MessagesResponse>({ as: b, method: 'GET', route: '/api/messages' });
    h.check(
      Boolean(still?.inbox.some((one) => one.id === letter.id)),
      "C's delete removed a letter from B's mailbox",
    );
    await h.ok<MessageMutationResponse>({
      as: b,
      method: 'POST',
      route: '/api/messages/delete',
      body: { id: letter.id },
    });
    const gone = await h.ok<MessagesResponse>({ as: b, method: 'GET', route: '/api/messages' });
    h.check(
      !gone?.inbox.some((one) => one.id === letter.id),
      'a deleted letter is still in the inbox',
    );
  }
  const readAll = await h.ok<MessageMutationResponse>({
    as: b,
    method: 'POST',
    route: '/api/messages/read-all',
    body: {},
  });
  h.check(readAll?.messages.unread === 0, `read-all left ${readAll?.messages.unread} unread`);
  await h.refuse({
    as: b,
    method: 'POST',
    route: '/api/messages/read',
    body: { id: 'no-such-letter' },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuseMalformed(b, '/api/messages/read', { id: 7 });
  await h.refuseMalformed(b, '/api/messages/delete', {});

  h.at('mail: letters that cannot be sent');
  const letterTo = (to: string[] | null) => ({ toUsernames: to, subject: 'x', body: 'y' });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/messages',
    body: letterTo([a.username]),
    expect: 409,
    code: 'MESSAGE_REFUSED',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/messages',
    body: letterTo([b.username, 'pt_nobody']),
    expect: 409,
    code: 'MESSAGE_REFUSED',
  });
  await h.refuse({
    as: e,
    method: 'POST',
    route: '/api/messages',
    body: letterTo(null),
    expect: 409,
    code: 'MESSAGE_REFUSED',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/messages',
    body: letterTo([]),
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/messages',
    body: letterTo(['a', 'b', 'c', 'd', 'e', 'f']),
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  await h.refuseMalformed(a, '/api/messages', { toUsernames: b.username, subject: 'x', body: 'y' });

  h.at('mail: a letter to the whole faction');
  const toTable = await h.ok<MessageMutationResponse>({
    as: a,
    method: 'POST',
    route: '/api/messages',
    body: {
      toUsernames: null,
      subject: 'Tonight',
      body: 'Everybody on the terraces at the half hour.',
    },
  });
  h.check(
    Boolean(toTable?.messages.sent.some((one) => one.audience === 'faction')),
    'the faction letter is not in the sent box',
  );
  const bTable = await h.ok<MessagesResponse>({ as: b, method: 'GET', route: '/api/messages' });
  h.check(
    Boolean(bTable?.inbox.some((one) => one.subject === 'Tonight' && one.audience === 'faction')),
    'B did not get the faction letter',
  );
  const cTable = await h.ok<MessagesResponse>({ as: c, method: 'GET', route: '/api/messages' });
  h.check(
    !cTable?.inbox.some((one) => one.subject === 'Tonight'),
    'C is not in the faction and got its letter',
  );

  h.at('the bell');
  const bell = await h.ok<NotificationsResponse>({
    as: b,
    method: 'GET',
    route: '/api/notifications',
  });
  const ring = bell?.notifications.find((one) => one.readAt === null);
  if (ring && bell) {
    const read = await h.ok<NotificationMutationResponse>({
      as: b,
      method: 'POST',
      route: '/api/notifications/read',
      body: { id: ring.id },
    });
    h.check(
      read?.notifications.unread === bell.unread - 1,
      `reading one notification took the count from ${bell.unread} to ${read?.notifications.unread}`,
    );
    await h.unchanged({
      as: c,
      method: 'POST',
      route: '/api/notifications/read',
      body: { id: ring.id },
      expect: 200,
    });
  }
  await h.refuseMalformed(b, '/api/notifications/read', { id: [] });
  const all = await h.ok<NotificationMutationResponse>({
    as: b,
    method: 'POST',
    route: '/api/notifications/read-all',
    body: {},
  });
  h.check(
    all?.notifications.unread === 0,
    `read-all left ${all?.notifications.unread} notifications unread`,
  );
  const muted = await h.ok<NotificationMutationResponse>({
    as: b,
    method: 'POST',
    route: '/api/notifications/settings',
    body: { muted: ['message_received', 'message_received'] },
  });
  h.check(
    JSON.stringify(muted?.notifications.settings.muted) === JSON.stringify(['message_received']),
    `muting one kind twice saved ${JSON.stringify(muted?.notifications.settings.muted)}`,
  );
  await h.refuse({
    as: b,
    method: 'POST',
    route: '/api/notifications/settings',
    body: { muted: ['the_end_of_days'] },
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  await h.refuseMalformed(b, '/api/notifications/settings', { muted: 'all' });
  await h.ok({
    as: a,
    method: 'POST',
    route: '/api/messages',
    body: { toUsernames: [b.username], subject: 'Quiet', body: 'You muted this.' },
  });
  const quiet = await h.ok<NotificationsResponse>({
    as: b,
    method: 'GET',
    route: '/api/notifications',
  });
  h.check(
    !quiet?.notifications.some((one) => one.kind === 'message_received' && one.readAt === null),
    'a muted kind still rang the bell',
  );
  await h.ok({ as: b, method: 'POST', route: '/api/notifications/settings', body: { muted: [] } });

  checkLiveFrames(h, bStream, 'B');
  bStream.close();
}
