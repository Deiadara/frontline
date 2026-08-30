import {
  NotificationSettingsRequestSchema,
  isAlwaysOn,
  SendMessageRequestSchema,
  type MessageMutationResponse,
  type MessageRefusal,
  type MessagesResponse,
  type NotificationMutationResponse,
  type NotificationsResponse,
} from '@frontline/shared';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { AppError, parseBody } from '../errors.js';
import { sendMessage } from '../social/send.js';

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

/** How much history a screen asks for. Deep enough to be an archive, bounded so it stays a payload. */
const INBOX_LIMIT = 200;
const NOTIFICATION_LIMIT = 200;

function refuseMessage(reason: MessageRefusal): never {
  throw new AppError('MESSAGE_REFUSED', reason);
}

const IdBody = z.object({ id: z.string().min(1) });

export function registerSocialRoutes(app: FastifyInstance): void {
  const messagesScreen = (userId: string): MessagesResponse => ({
    inbox: app.repos.social.inbox(userId, INBOX_LIMIT),
    sent: app.repos.social.sent(userId, INBOX_LIMIT),
    unread: app.repos.social.unreadMessages(userId),
    hasFaction: app.repos.factions.membershipOf(userId) !== undefined,
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
    const { toUsername, subject, body } = parseBody(SendMessageRequestSchema, request.body);
    const sender = request.currentUser;

    return app.db.transaction(() => {
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

      if (toUsername === null) {
        if (!membership || !faction) refuseMessage('not_in_a_faction');
        audience = 'faction';
        addressedTo = faction.name;
        recipients = app.repos.factions
          .members(membership.factionId)
          .map((row) => row.userId)
          .filter((id) => id !== sender.id);
        if (recipients.length === 0) refuseMessage('nobody_to_write_to');
      } else {
        const to = app.repos.users.findByUsername(toUsername);
        if (!to) refuseMessage('no_such_player');
        if (to.id === sender.id) refuseMessage('cannot_write_to_yourself');
        audience = 'player';
        addressedTo = to.username;
        recipients = [to.id];
      }

      const sentAt = new Date();
      sendMessage(app.repos, {
        sender: { id: sender.id, username: sender.username },
        senderFaction,
        recipients,
        audience,
        addressedTo,
        subject,
        body,
        sentAt,
        notification: {
          kind: 'message_received',
          title: `${sender.username} wrote to you`,
          body: subject,
          link: '/game/messages',
        },
        keepSentCopy: true,
      });

      return { messages: messagesScreen(sender.id) };
    })();
  });

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
