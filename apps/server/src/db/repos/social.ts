import {
  BadgeSchema,
  NOTIFICATION_KINDS,
  NotificationSettingsSchema,
  defaultNotificationSettings,
  type Message,
  type MessageAudience,
  type MessageInvite,
  type Notification,
  type NotificationKind,
  type NotificationSettings,
  type SentMessage,
} from '@frontline/shared';
import type { AppDatabase } from '../index.js';
import { readJson } from '../json.js';

/**
 * The mailbox and the bell.
 *
 * Both are per-player lists with a read flag, so they share a file: the two tables have different
 * columns but exactly the same three questions asked of them (what is there, how many are unread,
 * mark this one read), and splitting them would duplicate the answers.
 */

export interface NewMessage {
  id: string;
  threadId: string;
  senderUserId: string;
  senderName: string;
  senderFaction: string | null;
  recipientUserId: string;
  audience: MessageAudience;
  addressedTo: string;
  subject: string;
  body: string;
  sentAt: string;
  isSentCopy: boolean;
  /** Set on the two copies of a faction invitation. See `social/messages.ts`. */
  inviteId?: string | null;
  inviteFactionId?: string | null;
}

export interface NewNotification {
  id: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string;
  createdAt: string;
}

export interface SocialRepo {
  // --- messages ---
  putMessage(message: NewMessage): void;
  inbox(userId: string, limit: number): Message[];
  sent(userId: string, limit: number): SentMessage[];
  findMessage(id: string, userId: string): Message | undefined;
  markMessageRead(id: string, userId: string, at: string): void;
  markAllMessagesRead(userId: string, at: string): void;
  deleteMessage(id: string, userId: string): void;
  unreadMessages(userId: string): number;

  // --- notifications ---
  putNotification(notification: NewNotification): void;
  notifications(userId: string, limit: number): Notification[];
  markNotificationRead(id: string, userId: string, at: string): void;
  markAllNotificationsRead(userId: string, at: string): void;
  unreadNotifications(userId: string): number;
  /** Trims a player's list to the newest `keep`, so a long-lived account is not an unbounded table. */
  trimNotifications(userId: string, keep: number): void;

  settings(userId: string): NotificationSettings;
  putSettings(userId: string, settings: NotificationSettings): void;
}

interface MessageRow {
  id: string;
  thread_id: string;
  sender_user_id: string;
  sender_name: string;
  sender_faction: string | null;
  recipient_user_id: string;
  audience: string;
  addressed_to: string;
  subject: string;
  body: string;
  sent_at: string;
  read_at: string | null;
  invite_id: string | null;
  invite_faction_id: string | null;
  /** Joined, not stored: 1 while the invitation row is still open. See `toMessage`. */
  invite_open: number | null;
  invite_faction_name: string | null;
  invite_faction_badge: string | null;
}

interface SentRow extends MessageRow {
  recipients: number;
  read_by: number;
}

interface NotificationRow {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  link: string;
  created_at: string;
  read_at: string | null;
}

/**
 * The invitation a message carries, or null.
 *
 * Three things have to line up for a button to be drawn: the message was sent as an invitation, the
 * faction still exists to be joined, and the invitation itself is still open. The first two come
 * from columns on the message, the third from whether the join found a row. A faction that has been
 * disbanded drops the card entirely rather than offering a way into nothing.
 */
const toInvite = (row: MessageRow): MessageInvite | null => {
  if (!row.invite_id || !row.invite_faction_id) return null;
  if (!row.invite_faction_name || !row.invite_faction_badge) return null;
  return {
    inviteId: row.invite_id,
    factionId: row.invite_faction_id,
    factionName: row.invite_faction_name,
    badge: BadgeSchema.parse(readJson(row.invite_faction_badge)),
    open: row.invite_open === 1,
  };
};

const toMessage = (row: MessageRow): Message => ({
  id: row.id,
  threadId: row.thread_id,
  senderUserId: row.sender_user_id,
  senderName: row.sender_name,
  senderFaction: row.sender_faction,
  audience: row.audience === 'faction' ? 'faction' : 'player',
  addressedTo: row.addressed_to,
  subject: row.subject,
  body: row.body,
  sentAt: row.sent_at,
  readAt: row.read_at,
  invite: toInvite(row),
});

/** A kind the catalogue no longer carries is dropped rather than parsed into a broken row. */
const knownKind = (value: string): value is NotificationKind =>
  (NOTIFICATION_KINDS as readonly string[]).includes(value);

/*
 * Reading a message means reading its invitation too, so the two selects that produce one share
 * this instead of describing the join twice.
 *
 * `invite_open` is the existence of the invitation row; the faction is joined through the message's
 * own `invite_faction_id` rather than through the invitation, so an answered invitation still knows
 * which faction it was to. That is the difference between "you already joined The Ninth Circle" and
 * a card with a hole in it.
 */
const MESSAGE_SELECT = `SELECT m.*,
          CASE WHEN fi.id IS NULL THEN 0 ELSE 1 END AS invite_open,
          f.name AS invite_faction_name,
          f.badge AS invite_faction_badge
     FROM messages m
     LEFT JOIN faction_invites fi ON fi.id = m.invite_id
     LEFT JOIN factions f ON f.id = m.invite_faction_id`;

export function createSocialRepo(db: AppDatabase): SocialRepo {
  const putMessageStmt = db.prepare(
    `INSERT INTO messages
       (id, thread_id, sender_user_id, sender_name, sender_faction, recipient_user_id,
        audience, addressed_to, subject, body, sent_at, is_sent_copy, invite_id, invite_faction_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const inboxStmt = db.prepare(
    `${MESSAGE_SELECT}
      WHERE m.recipient_user_id = ? AND m.is_sent_copy = 0 AND m.deleted = 0
      ORDER BY m.sent_at DESC LIMIT ?`,
  );
  /*
   * The sent folder counts the other copies of the same send.
   *
   * A correlated subquery rather than a join, because the sender's own copy must not count itself
   * as a recipient: `is_sent_copy = 0` inside the subquery is what makes "went to 4 people, 2 have
   * read it" true rather than off by one.
   */
  const sentStmt = db.prepare(
    `SELECT m.*,
            (SELECT COUNT(*) FROM messages o
              WHERE o.thread_id = m.thread_id AND o.is_sent_copy = 0) AS recipients,
            (SELECT COUNT(*) FROM messages o
              WHERE o.thread_id = m.thread_id AND o.is_sent_copy = 0 AND o.read_at IS NOT NULL)
              AS read_by
       FROM messages m
      WHERE m.sender_user_id = ? AND m.is_sent_copy = 1 AND m.deleted = 0
      ORDER BY m.sent_at DESC LIMIT ?`,
  );
  const findMessageStmt = db.prepare(
    `${MESSAGE_SELECT} WHERE m.id = ? AND m.recipient_user_id = ? AND m.deleted = 0`,
  );
  const readMessageStmt = db.prepare(
    'UPDATE messages SET read_at = ? WHERE id = ? AND recipient_user_id = ? AND read_at IS NULL',
  );
  const readAllMessagesStmt = db.prepare(
    `UPDATE messages SET read_at = ?
      WHERE recipient_user_id = ? AND is_sent_copy = 0 AND deleted = 0 AND read_at IS NULL`,
  );
  const deleteMessageStmt = db.prepare(
    'UPDATE messages SET deleted = 1 WHERE id = ? AND recipient_user_id = ?',
  );
  const unreadMessagesStmt = db.prepare(
    `SELECT COUNT(*) AS n FROM messages
      WHERE recipient_user_id = ? AND is_sent_copy = 0 AND deleted = 0 AND read_at IS NULL`,
  );

  const putNotificationStmt = db.prepare(
    `INSERT INTO notifications (id, user_id, kind, title, body, link, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const notificationsStmt = db.prepare(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
  );
  const readNotificationStmt = db.prepare(
    'UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL',
  );
  const readAllNotificationsStmt = db.prepare(
    'UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL',
  );
  const unreadNotificationsStmt = db.prepare(
    'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL',
  );
  const trimStmt = db.prepare(
    `DELETE FROM notifications
      WHERE user_id = ?
        AND id NOT IN (
          SELECT id FROM notifications WHERE user_id = ?
           ORDER BY created_at DESC, id DESC LIMIT ?
        )`,
  );

  const settingsStmt = db.prepare('SELECT muted_json FROM notification_settings WHERE user_id = ?');
  const putSettingsStmt = db.prepare(
    `INSERT INTO notification_settings (user_id, muted_json) VALUES (?, ?)
     ON CONFLICT (user_id) DO UPDATE SET muted_json = excluded.muted_json`,
  );

  return {
    putMessage(message) {
      putMessageStmt.run(
        message.id,
        message.threadId,
        message.senderUserId,
        message.senderName,
        message.senderFaction,
        message.recipientUserId,
        message.audience,
        message.addressedTo,
        message.subject,
        message.body,
        message.sentAt,
        message.isSentCopy ? 1 : 0,
        message.inviteId ?? null,
        message.inviteFactionId ?? null,
      );
    },
    inbox(userId, limit) {
      return (inboxStmt.all(userId, limit) as MessageRow[]).map(toMessage);
    },
    sent(userId, limit) {
      return (sentStmt.all(userId, limit) as SentRow[]).map((row) => ({
        threadId: row.thread_id,
        audience: row.audience === 'faction' ? ('faction' as const) : ('player' as const),
        addressedTo: row.addressed_to,
        subject: row.subject,
        body: row.body,
        sentAt: row.sent_at,
        recipients: row.recipients,
        readBy: row.read_by,
      }));
    },
    findMessage(id, userId) {
      const row = findMessageStmt.get(id, userId) as MessageRow | undefined;
      return row ? toMessage(row) : undefined;
    },
    markMessageRead(id, userId, at) {
      readMessageStmt.run(at, id, userId);
    },
    markAllMessagesRead(userId, at) {
      readAllMessagesStmt.run(at, userId);
    },
    deleteMessage(id, userId) {
      deleteMessageStmt.run(id, userId);
    },
    unreadMessages(userId) {
      return (unreadMessagesStmt.get(userId) as { n: number }).n;
    },

    putNotification(notification) {
      putNotificationStmt.run(
        notification.id,
        notification.userId,
        notification.kind,
        notification.title,
        notification.body,
        notification.link,
        notification.createdAt,
      );
    },
    notifications(userId, limit) {
      return (notificationsStmt.all(userId, limit) as NotificationRow[]).flatMap((row) =>
        knownKind(row.kind)
          ? [
              {
                id: row.id,
                kind: row.kind,
                title: row.title,
                body: row.body,
                link: row.link,
                createdAt: row.created_at,
                readAt: row.read_at,
              },
            ]
          : [],
      );
    },
    markNotificationRead(id, userId, at) {
      readNotificationStmt.run(at, id, userId);
    },
    markAllNotificationsRead(userId, at) {
      readAllNotificationsStmt.run(at, userId);
    },
    unreadNotifications(userId) {
      return (unreadNotificationsStmt.get(userId) as { n: number }).n;
    },
    trimNotifications(userId, keep) {
      trimStmt.run(userId, userId, keep);
    },

    settings(userId) {
      const row = settingsStmt.get(userId) as { muted_json: string } | undefined;
      if (!row) return defaultNotificationSettings();
      const parsed = NotificationSettingsSchema.safeParse({
        muted: JSON.parse(row.muted_json) as unknown,
      });
      return parsed.success ? parsed.data : defaultNotificationSettings();
    },
    putSettings(userId, settings) {
      putSettingsStmt.run(userId, JSON.stringify(settings.muted));
    },
  };
}
