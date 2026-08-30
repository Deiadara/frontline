import { randomUUID } from 'node:crypto';
import type { MessageAudience, NotificationKind } from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { notify } from './notify.js';

/**
 * Putting a message in somebody's mailbox.
 *
 * Lifted out of the `/messages` route the day a second thing needed to write to a player: a faction
 * invitation is a message (see `social/messages.ts`), and it has to land in the same list, with the
 * same unread badge and the same sent copy, or it is a different feature wearing the mailbox's
 * clothes. Two code paths writing rows into `messages` would have drifted on the first change to
 * either.
 *
 * The fan-out rule lives here with it: one row per recipient, plus one for the sender's own folder.
 */
export interface Outgoing {
  sender: { id: string; username: string };
  /** The faction the sender belonged to as they wrote it, or null. A snapshot, not a lookup. */
  senderFaction: string | null;
  /** Already resolved to user ids, and already excluding the sender. */
  recipients: readonly string[];
  audience: MessageAudience;
  addressedTo: string;
  subject: string;
  body: string;
  sentAt: Date;
  /** Set to make this message an invitation with a button on it. */
  invite?: { inviteId: string; factionId: string };
  /**
   * The bell entry each recipient gets. Separate from the message itself because the two are
   * filtered separately: a player who has muted `message_received` still hears about an invitation.
   */
  notification: { kind: NotificationKind; title: string; body: string; link: string };
  /**
   * Whether the sender keeps a copy in their sent folder. True for anything a player typed.
   *
   * False for an invitation: it is sent by pressing "invite", not by writing to somebody, and a
   * sent-folder entry for it would be a message the sender never wrote sitting in the list of
   * messages they did.
   */
  keepSentCopy: boolean;
}

export function sendMessage(repos: Repositories, outgoing: Outgoing): void {
  const common = {
    threadId: randomUUID(),
    senderUserId: outgoing.sender.id,
    senderName: outgoing.sender.username,
    senderFaction: outgoing.senderFaction,
    audience: outgoing.audience,
    addressedTo: outgoing.addressedTo,
    subject: outgoing.subject,
    body: outgoing.body,
    sentAt: outgoing.sentAt.toISOString(),
    inviteId: outgoing.invite?.inviteId ?? null,
    inviteFactionId: outgoing.invite?.factionId ?? null,
  };

  for (const recipientUserId of outgoing.recipients) {
    repos.social.putMessage({ ...common, id: randomUUID(), recipientUserId, isSentCopy: false });
    notify(repos, {
      userId: recipientUserId,
      kind: outgoing.notification.kind,
      title: outgoing.notification.title,
      body: outgoing.notification.body,
      link: outgoing.notification.link,
      now: outgoing.sentAt,
    });
  }

  if (outgoing.keepSentCopy) {
    repos.social.putMessage({
      ...common,
      id: randomUUID(),
      recipientUserId: outgoing.sender.id,
      isSentCopy: true,
    });
  }
}
