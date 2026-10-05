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
import type { Statement } from 'better-sqlite3';
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

/** One invitation letter, as the two invitation limits count it (`social/limits.ts`). */
export interface InvitationLetter {
  id: string;
  senderUserId: string;
  factionId: string;
  inviteeUserId: string;
  sentAt: string;
}

export interface NewNotification {
  id: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string;
  /** The id of the thing this is about (`0053`), or null where the kind has no single subject. */
  subjectId: string | null;
  createdAt: string;
}

export interface SocialRepo {
  // --- messages ---
  putMessage(message: NewMessage): void;
  inbox(userId: string, limit: number): Message[];
  sent(userId: string, limit: number): SentMessage[];
  findMessage(id: string, userId: string): Message | undefined;
  /** Letters this account has sent since `sinceIso`, deleted or not. */
  sentSince(userId: string, sinceIso: string): number;
  /** Letters from one sender put in one reader's mailbox since `sinceIso` (0139's day limit). */
  lettersToSince(senderUserId: string, recipientUserId: string, sinceIso: string): number;
  /** The reader stops, or starts again, taking letters from `blockedUserId` (0139). */
  setBlocked(userId: string, blockedUserId: string, blocked: boolean, at: string): void;
  /** Everybody this reader has blocked, oldest first. */
  blockedBy(userId: string): string[];
  /** Whether `userId` has blocked `senderUserId`. */
  hasBlocked(userId: string, senderUserId: string): boolean;
  markMessageRead(id: string, userId: string, at: string): void;
  markAllMessagesRead(userId: string, at: string): void;
  deleteMessage(id: string, userId: string): void;
  unreadMessages(userId: string): number;
  /**
   * Keeps a player's inbox to its newest `keep` letters, and drops the ones they threw away. Each
   * copy that goes is folded into its sender's sent copy first, so "1/3 read" stays true.
   */
  trimMailbox(userId: string, keep: number): void;
  /** Keeps a player's sent folder to its newest `keep` sends. */
  trimSentFolder(userId: string, keep: number): void;

  // --- invitation letters ---
  recordInvitationLetter(letter: InvitationLetter): void;
  /** Drops every invitation letter sent before `beforeIso`: no limit looks back that far. */
  forgetInvitationLettersBefore(beforeIso: string): void;
  /** Invitation letters this account has sent since `sinceIso`. */
  invitationLettersSince(senderUserId: string, sinceIso: string): number;
  /** Invitation letters to this invitee since `sinceIso`, from this sender or from this faction. */
  invitationsToSince(
    invitation: { inviteeUserId: string; senderUserId: string; factionId: string },
    sinceIso: string,
  ): number;

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
  /** Joined, not stored: the sending account's username now, or null if the account is gone. */
  sender_username: string | null;
  /** Joined, not stored: 1 while the invitation row is still open. See `toMessage`. */
  invite_open: number | null;
  invite_faction_name: string | null;
  invite_faction_badge: string | null;
}

interface DoomedLetter {
  id: string;
  thread_id: string;
  read_at: string | null;
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
  subject_id: string | null;
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
  // By the account, not by the signature: see `MessageSchema.replyTo`.
  replyTo: row.sender_user_id === row.recipient_user_id ? null : row.sender_username,
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
          su.username AS sender_username,
          CASE WHEN fi.id IS NULL THEN 0 ELSE 1 END AS invite_open,
          f.name AS invite_faction_name,
          f.badge AS invite_faction_badge
     FROM messages m
     LEFT JOIN users su ON su.id = m.sender_user_id
     LEFT JOIN faction_invites fi ON fi.id = m.invite_id
     LEFT JOIN factions f ON f.id = m.invite_faction_id`;

export function createSocialRepo(db: AppDatabase): SocialRepo {
  // Prepared on first use: `pruned_recipients` and `invitation_letters` arrived with 0133 and
  // 0134, and the repositories are also built over older schemas by the migration tests.
  const lazy = (sql: string): (() => Statement) => {
    let held: Statement | null = null;
    return () => (held ??= db.prepare(sql));
  };
  // The sender's copy is addressed to the sender, so the inbox index answers this.
  const lettersToSinceStmt = lazy(
    `SELECT COUNT(*) AS n FROM messages
      WHERE sender_user_id = ? AND recipient_user_id = ? AND is_sent_copy = 0 AND sent_at >= ?`,
  );
  const blockStmt = lazy(
    'INSERT OR IGNORE INTO blocked_senders (user_id, blocked_user_id, created_at) VALUES (?, ?, ?)',
  );
  const unblockStmt = lazy('DELETE FROM blocked_senders WHERE user_id = ? AND blocked_user_id = ?');
  const blockedByStmt = lazy(
    'SELECT blocked_user_id FROM blocked_senders WHERE user_id = ? ORDER BY created_at, blocked_user_id',
  );
  const hasBlockedStmt = lazy(
    'SELECT 1 FROM blocked_senders WHERE user_id = ? AND blocked_user_id = ?',
  );
  const sentSinceStmt = db.prepare(
    `SELECT COUNT(*) AS n FROM messages
      WHERE recipient_user_id = ? AND is_sent_copy = 1 AND sent_at >= ?`,
  );
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
  const sentStmt = lazy(
    `SELECT m.*,
            m.pruned_recipients + (SELECT COUNT(*) FROM messages o
              WHERE o.thread_id = m.thread_id AND o.is_sent_copy = 0) AS recipients,
            m.pruned_read + (SELECT COUNT(*) FROM messages o
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
  /*
   * Everything past the newest `keep` letters a player can still see, and everything they threw
   * away. Read or not: the cap is hard (maintainer, 2026-09-29), so an unread letter goes too, and
   * the badge never counts a letter the inbox cannot show.
   */
  const doomedLettersStmt = db.prepare(
    `SELECT id, thread_id, read_at FROM messages
      WHERE recipient_user_id = ? AND is_sent_copy = 0
        AND (deleted = 1 OR id NOT IN (
          SELECT id FROM messages
           WHERE recipient_user_id = ? AND is_sent_copy = 0 AND deleted = 0
           -- Unread letters and invitations are kept before anything read (maintainer,
           -- 2026-10-02): a flood of letters pushed out the ones the reader had not opened.
           ORDER BY (read_at IS NULL OR invite_id IS NOT NULL) DESC, sent_at DESC, id DESC
           LIMIT ?
        ))`,
  );
  const foldIntoSentCopyStmt = lazy(
    `UPDATE messages
        SET pruned_recipients = pruned_recipients + 1, pruned_read = pruned_read + ?
      WHERE thread_id = ? AND is_sent_copy = 1`,
  );
  const dropMessageStmt = db.prepare('DELETE FROM messages WHERE id = ?');
  const trimMailbox = db.transaction((userId: string, keep: number) => {
    for (const letter of doomedLettersStmt.all(userId, userId, keep) as DoomedLetter[]) {
      foldIntoSentCopyStmt().run(letter.read_at === null ? 0 : 1, letter.thread_id);
      dropMessageStmt.run(letter.id);
    }
  });
  const trimSentFolderStmt = db.prepare(
    `DELETE FROM messages
      WHERE recipient_user_id = ? AND is_sent_copy = 1
        AND id NOT IN (
          SELECT id FROM messages WHERE recipient_user_id = ? AND is_sent_copy = 1
           ORDER BY sent_at DESC, id DESC LIMIT ?
        )`,
  );

  const recordInvitationStmt = lazy(
    `INSERT INTO invitation_letters (id, sender_user_id, faction_id, invitee_user_id, sent_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const forgetInvitationsStmt = lazy('DELETE FROM invitation_letters WHERE sent_at < ?');
  const invitationsSinceStmt = lazy(
    'SELECT COUNT(*) AS n FROM invitation_letters WHERE sender_user_id = ? AND sent_at >= ?',
  );
  const invitationsToStmt = lazy(
    `SELECT COUNT(*) AS n FROM invitation_letters
      WHERE invitee_user_id = ? AND (sender_user_id = ? OR faction_id = ?) AND sent_at >= ?`,
  );

  const putNotificationStmt = db.prepare(
    `INSERT INTO notifications (id, user_id, kind, title, body, link, subject_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  /*
   * Ties broken by insertion order (maintainer, 2026-09-29). The ids are random UUIDs, so ordering
   * on them shuffled one settle's receipts differently on every read; `rowid` is the order they
   * were written in.
   */
  const notificationsStmt = db.prepare(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
  );
  const readNotificationStmt = db.prepare(
    'UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL',
  );
  const readAllNotificationsStmt = db.prepare(
    'UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL',
  );
  /*
   * Counted over the kinds the list will actually show.
   *
   * `notifications()` drops a row whose kind the catalogue no longer carries, which is the right
   * repair: a retired kind is not a reason to take a player's bell down. This count did not, so a
   * retirement left a badge saying 3 over a list showing nothing, and nothing could clear it:
   * `markNotificationRead` needs an id and the list never returned one. Kinds have been retired
   * before (`0054_battle_report_tiers.sql` exists to rewrite one).
   *
   * The list is built in SQL rather than filtered in JS so the badge stays one query.
   */
  const unreadNotificationsStmt = db.prepare(
    `SELECT COUNT(*) AS n FROM notifications
      WHERE user_id = ? AND read_at IS NULL
        AND kind IN (${NOTIFICATION_KINDS.map(() => '?').join(', ')})`,
  );
  const trimStmt = db.prepare(
    `DELETE FROM notifications
      WHERE user_id = ?
        AND id NOT IN (
          SELECT id FROM notifications WHERE user_id = ?
           ORDER BY created_at DESC, rowid DESC LIMIT ?
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
      return (sentStmt().all(userId, limit) as SentRow[]).map((row) => ({
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
    sentSince(userId, sinceIso) {
      const row = sentSinceStmt.get(userId, sinceIso) as { n: number };
      return row.n;
    },
    lettersToSince(senderUserId, recipientUserId, sinceIso) {
      const row = lettersToSinceStmt().get(senderUserId, recipientUserId, sinceIso) as {
        n: number;
      };
      return row.n;
    },
    setBlocked(userId, blockedUserId, blocked, at) {
      if (blocked) blockStmt().run(userId, blockedUserId, at);
      else unblockStmt().run(userId, blockedUserId);
    },
    blockedBy(userId) {
      return (blockedByStmt().all(userId) as { blocked_user_id: string }[]).map(
        (row) => row.blocked_user_id,
      );
    },
    hasBlocked(userId, senderUserId) {
      return hasBlockedStmt().get(userId, senderUserId) !== undefined;
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
    trimMailbox(userId, keep) {
      trimMailbox(userId, keep);
    },
    trimSentFolder(userId, keep) {
      trimSentFolderStmt.run(userId, userId, keep);
    },

    recordInvitationLetter(letter) {
      recordInvitationStmt().run(
        letter.id,
        letter.senderUserId,
        letter.factionId,
        letter.inviteeUserId,
        letter.sentAt,
      );
    },
    forgetInvitationLettersBefore(beforeIso) {
      forgetInvitationsStmt().run(beforeIso);
    },
    invitationLettersSince(senderUserId, sinceIso) {
      return (invitationsSinceStmt().get(senderUserId, sinceIso) as { n: number }).n;
    },
    invitationsToSince({ inviteeUserId, senderUserId, factionId }, sinceIso) {
      return (
        invitationsToStmt().get(inviteeUserId, senderUserId, factionId, sinceIso) as { n: number }
      ).n;
    },

    putNotification(notification) {
      putNotificationStmt.run(
        notification.id,
        notification.userId,
        notification.kind,
        notification.title,
        notification.body,
        notification.link,
        notification.subjectId,
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
                subjectId: row.subject_id,
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
      return (unreadNotificationsStmt.get(userId, ...NOTIFICATION_KINDS) as { n: number }).n;
    },
    trimNotifications(userId, keep) {
      trimStmt.run(userId, userId, keep);
    },

    settings(userId) {
      const row = settingsStmt.get(userId) as { muted_json: string } | undefined;
      if (!row) return defaultNotificationSettings();
      const stored = JSON.parse(row.muted_json) as unknown;
      /*
       * A kind the catalogue has retired (`battle_incoming`, 2026-09-29) is dropped from the list
       * rather than failing it: a failed parse falls back to the defaults, which would switch
       * every other kind this player had muted back on.
       */
      const parsed = NotificationSettingsSchema.safeParse({
        muted: Array.isArray(stored)
          ? stored.filter((kind): kind is string => typeof kind === 'string' && knownKind(kind))
          : stored,
      });
      return parsed.success ? parsed.data : defaultNotificationSettings();
    },
    putSettings(userId, settings) {
      putSettingsStmt.run(userId, JSON.stringify(settings.muted));
    },
  };
}
