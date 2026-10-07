import {
  BlockSenderRequestSchema,
  IdSchema,
  LETTERS_TO_ONE_PLAYER_PER_DAY,
  MAILBOX_LIMIT,
  NotificationSettingsRequestSchema,
  hasVisibleText,
  isAlwaysOn,
  SendMessageRequestSchema,
  type MessageMutationResponse,
  type MessageRefusal,
  type MessagesResponse,
  type NotificationMutationResponse,
  type NotificationsResponse,
  displayNameOf,
} from '@frontline/shared';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { AppError, parseBody } from '../errors.js';
import { lettersToThemToday, outOfLettersToday } from '../social/limits.js';
import { sendMessage } from '../social/send.js';
import type { UserRecord } from '../types.js';

/**
 * The mailbox and the bell.
 *
 * Both are lists with a read flag, and both follow the pattern the rest of this server uses: a read
 * returns the whole screen, a write returns the whole refreshed screen, and nothing is assembled on
 * the client.
 *
 * ## Read on open, not on hover
 *
 * `POST /messages/read` and `POST /notifications/read` are what the client calls when a row is
 * *opened*. That is deliberate and it is what every game with a mailbox does: marking on render
 * would clear a badge the moment a list is glanced at, which is the one thing that makes an unread
 * count untrustworthy.
 */

/**
 * How much history a screen asks for. The mailbox is the whole of it: a send trims every mailbox
 * and sent folder to `MAILBOX_LIMIT`, so asking for that many shows every letter there is, and the
 * unread badge cannot count one the list leaves out.
 */
const NOTIFICATION_LIMIT = 200;

function refuseMessage(reason: MessageRefusal): never {
  throw new AppError('MESSAGE_REFUSED', reason);
}

const IdBody = z.object({ id: IdSchema });

export function registerSocialRoutes(app: FastifyInstance): void {
  const messagesScreen = (userId: string): MessagesResponse => ({
    inbox: app.repos.social.inbox(userId, MAILBOX_LIMIT),
    sent: app.repos.social.sent(userId, MAILBOX_LIMIT),
    unread: app.repos.social.unreadMessages(userId),
    hasFaction: app.repos.factions.membershipOf(userId) !== undefined,
    blocked: app.repos.social.blockedBy(userId).flatMap((blockedId) => {
      const user = app.repos.users.findById(blockedId);
      return user ? [{ userId: blockedId, name: displayNameOf(user) }] : [];
    }),
    serverNow: new Date().toISOString(),
  });
  const notificationsScreen = (userId: string): NotificationsResponse => ({
    notifications: app.repos.social.notifications(userId, NOTIFICATION_LIMIT),
    unread: app.repos.social.unreadNotifications(userId),
    settings: app.repos.social.settings(userId),
    serverNow: new Date().toISOString(),
  });

  // --- messages ---

  app.get('/messages', { preHandler: app.authenticate }, (request): MessagesResponse => {
    return messagesScreen(request.currentUser.id);
  });

  app.post('/messages', { preHandler: app.authenticate }, (request): MessageMutationResponse => {
    const { toUsernames, subject, body } = parseBody(SendMessageRequestSchema, request.body);
    const sender = request.currentUser;
    // A subject or body that draws nothing, a lone zero-width space say, is not a letter.
    if (!hasVisibleText(subject) || !hasVisibleText(body)) refuseMessage('blank_letter');

    return app.db.transaction(() => {
      if (outOfLettersToday(app.repos, sender.id, new Date())) refuseMessage('too_many_today');
      const membership = app.repos.factions.membershipOf(sender.id);
      const faction = membership ? app.repos.factions.find(membership.factionId) : undefined;
      const senderFaction = faction?.name ?? null;

      /*
       * Who this reaches, decided once, here.
       *
       * A faction message is fanned out to the members *as they are now*: somebody who joins
       * tomorrow does not inherit today's conversation, and somebody who leaves keeps what they
       * were actually sent. See `social/messages.ts`.
       */
      let recipients: string[];
      let addressedTo: string;
      let audience: 'player' | 'faction';

      if (toUsernames === null) {
        if (!membership || !faction) refuseMessage('not_in_a_faction');
        audience = 'faction';
        addressedTo = faction.name;
        recipients = app.repos.factions
          .members(membership.factionId)
          .map((row) => row.userId)
          .filter((id) => id !== sender.id);
        if (recipients.length === 0) refuseMessage('nobody_to_write_to');
      } else {
        /*
         * Every name resolved before anything is written, so a letter to three people with one
         * name wrong is refused whole rather than reaching two of them. The same person twice is
         * one recipient: the composer cannot pick a name twice, but a hand-written request can.
         * Deduplicated by account rather than by the text, because names match without regard to
         * case (`COLLATE NOCASE`): `bobby` and `BOBBY` put two copies and two bells in one mailbox,
         * and the sent folder read "to bobby, bobby, 2 recipients".
         */
        const byId = new Map<string, UserRecord>();
        for (const username of toUsernames) {
          const user = app.repos.users.findByUsername(username);
          if (!user) refuseMessage('no_such_player');
          if (user.id === sender.id) refuseMessage('cannot_write_to_yourself');
          byId.set(user.id, user);
        }
        const to = [...byId.values()];
        audience = 'player';
        addressedTo = to.map((user) => displayNameOf(user)).join(', ');
        recipients = to.map((user) => user.id);
      }

      const sentAt = new Date();
      /*
       * One sender, one mailbox, ten a day (maintainer, 2026-10-02): the day's hundred is about how
       * much an account writes, and one stranger could still spend it all on one player. A letter
       * to a reader who has blocked the sender is not counted: it never arrives. Letters to the
       * sender's own faction table are not held to it (review, 2026-10-02): they are not a stranger
       * filling somebody's mailbox, and the day's hundred still bounds them.
       */
      for (const recipientUserId of audience === 'player' ? recipients : []) {
        if (app.repos.social.hasBlocked(recipientUserId, sender.id)) continue;
        if (
          lettersToThemToday(app.repos, sender.id, recipientUserId, sentAt) >=
          LETTERS_TO_ONE_PLAYER_PER_DAY
        ) {
          refuseMessage('too_many_to_them');
        }
      }
      sendMessage(app.repos, {
        sender: { id: sender.id, signature: displayNameOf(sender) },
        senderFaction,
        recipients,
        audience,
        addressedTo,
        subject,
        body,
        sentAt,
        notification: {
          kind: 'message_received',
          // To the table or to you: the mailbox keeps the two apart (`audience`), so the bell does.
          title: `${displayNameOf(sender)} wrote to ${audience === 'faction' ? 'the faction' : 'you'}`,
          body: subject,
          link: '/game/messages',
        },
        keepSentCopy: true,
      });

      return { messages: messagesScreen(sender.id) };
    })();
  });

  /** Stop, or start again, taking letters from one player (maintainer, 2026-10-02). */
  app.post(
    '/messages/block',
    { preHandler: app.authenticate },
    (request): MessageMutationResponse => {
      const { userId: blockedUserId, blocked } = parseBody(BlockSenderRequestSchema, request.body);
      const userId = request.currentUser.id;
      if (blockedUserId === userId) refuseMessage('cannot_write_to_yourself');
      if (!app.repos.users.findById(blockedUserId)) refuseMessage('no_such_player');
      app.repos.social.setBlocked(userId, blockedUserId, blocked, new Date().toISOString());
      return { messages: messagesScreen(userId) };
    },
  );

  app.post(
    '/messages/read',
    { preHandler: app.authenticate },
    (request): MessageMutationResponse => {
      const { id } = parseBody(IdBody, request.body);
      const userId = request.currentUser.id;
      // Scoped to the reader: a message id is not a key to somebody else's mailbox.
      if (!app.repos.social.findMessage(id, userId))
        throw new AppError('NOT_FOUND', 'No such message');
      app.repos.social.markMessageRead(id, userId, new Date().toISOString());
      return { messages: messagesScreen(userId) };
    },
  );

  app.post(
    '/messages/read-all',
    { preHandler: app.authenticate },
    (request): MessageMutationResponse => {
      const userId = request.currentUser.id;
      app.repos.social.markAllMessagesRead(userId, new Date().toISOString());
      return { messages: messagesScreen(userId) };
    },
  );

  app.post(
    '/messages/delete',
    { preHandler: app.authenticate },
    (request): MessageMutationResponse => {
      const { id } = parseBody(IdBody, request.body);
      const userId = request.currentUser.id;
      app.repos.social.deleteMessage(id, userId);
      return { messages: messagesScreen(userId) };
    },
  );

  // --- notifications ---

  app.get('/notifications', { preHandler: app.authenticate }, (request): NotificationsResponse => {
    return notificationsScreen(request.currentUser.id);
  });

  app.post(
    '/notifications/read',
    { preHandler: app.authenticate },
    (request): NotificationMutationResponse => {
      const { id } = parseBody(IdBody, request.body);
      const userId = request.currentUser.id;
      app.repos.social.markNotificationRead(id, userId, new Date().toISOString());
      return { notifications: notificationsScreen(userId) };
    },
  );

  app.post(
    '/notifications/read-all',
    { preHandler: app.authenticate },
    (request): NotificationMutationResponse => {
      const userId = request.currentUser.id;
      app.repos.social.markAllNotificationsRead(userId, new Date().toISOString());
      return { notifications: notificationsScreen(userId) };
    },
  );

  /**
   * Which kinds this player wants.
   *
   * The whole settings object is written rather than one switch toggled, so a screen with thirteen
   * checkboxes cannot get into a state where two of them raced. `withMuted` on the client refuses
   * to mute an always-on kind and the schema is re-checked here, because a client is not a gate.
   */
  app.post(
    '/notifications/settings',
    { preHandler: app.authenticate },
    (request): NotificationMutationResponse => {
      const settings = parseBody(NotificationSettingsRequestSchema, request.body);
      const userId = request.currentUser.id;
      // Always-on kinds are dropped rather than refused: a client sending one is out of date, not
      // hostile, and the right answer is the settings it should have had. `isAlwaysOn` is the same
      // rule the catalogue and the settings screen read, so there is one list of them.
      const muted = settings.muted.filter((kind) => !isAlwaysOn(kind));
      app.repos.social.putSettings(userId, { muted });
      return { notifications: notificationsScreen(userId) };
    },
  );
}
