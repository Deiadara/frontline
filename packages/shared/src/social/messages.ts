import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from '../primitives.js';
import { BadgeSchema } from '../factions/badge.js';
import { FactionNameSchema } from '../factions/factions.js';

/**
 * Messages: one player writing to another, or to their whole faction.
 *
 * The shape every game with a mailbox uses, because players arrive knowing it: an inbox and a sent
 * folder, a subject and a body, unread bold until opened, a reply that quotes who you are replying
 * to, and a badge with a count on it.
 *
 * ## Fan-out at send, not at read
 *
 * A message to a faction is written **once per recipient**, at the moment it is sent, rather than
 * stored once and expanded when somebody opens their inbox. Three properties fall out of that and
 * all three are wanted:
 *
 *   1. Read state is per person, which is the only way "unread" means anything on a group message.
 *   2. Somebody who joins the faction tomorrow does not inherit today's conversation.
 *   3. Somebody who leaves keeps the messages they were actually sent, rather than having their
 *      mailbox rewritten by an act of somebody else's.
 *
 * The cost is a row per recipient, which for a five-person cap is not a cost.
 *
 * ## An invitation is a message
 *
 * Joining a faction starts in the inbox, because that is where a player looks for "has anybody
 * asked me anything". An invite is an ordinary message carrying {@link MessageInvite}: same list,
 * same unread badge, same read-on-open, with a button on it. The invitation itself still lives in
 * its own table and is still the thing the join route checks, so a message that has been deleted,
 * forwarded or kept forever cannot let anybody in on its own: `open` is a read of that row, not a
 * claim by the message.
 *
 * ## Deleting
 *
 * Deleting is per recipient too, and it is a flag rather than a delete: the sender's copy in their
 * sent folder is a different row and is not touched by the recipient throwing theirs away.
 */

export const MESSAGE_SUBJECT_MAX = 80;
export const MESSAGE_BODY_MAX = 2000;

export const MessageSubjectSchema = z.string().trim().min(1).max(MESSAGE_SUBJECT_MAX);
export const MessageBodySchema = z.string().trim().min(1).max(MESSAGE_BODY_MAX);

/**
 * Who a message was addressed to, as the sender chose it.
 *
 * Kept on the row after fan-out so the recipient can see *how* it reached them. "Vex wrote to the
 * faction" and "Vex wrote to you" are different social facts, and a mailbox that flattens them into
 * one makes a group announcement look like a personal note.
 */
export const MESSAGE_AUDIENCES = ['player', 'faction'] as const;
export const MessageAudienceSchema = z.enum(MESSAGE_AUDIENCES);
export type MessageAudience = z.infer<typeof MessageAudienceSchema>;

/**
 * The invitation a message carries, with everything the button needs to draw itself.
 *
 * `open` is computed from the invitation row at read time rather than stored on the message: an
 * invite that was accepted, declined, withdrawn, or whose faction filled up or was disbanded, has
 * to stop offering a way in the moment it stops being one, and a copy on the message would say yes
 * until somebody rewrote it.
 */
export const MessageInviteSchema = z.object({
  inviteId: IdSchema,
  factionId: IdSchema,
  factionName: FactionNameSchema,
  badge: BadgeSchema,
  open: z.boolean(),
});
export type MessageInvite = z.infer<typeof MessageInviteSchema>;

export const MessageSchema = z.object({
  id: IdSchema,
  /** Groups the copies made by one send, so a sent-folder row can count its recipients. */
  threadId: IdSchema,
  senderUserId: IdSchema,
  senderName: z.string().min(1),
  /** The faction the sender belonged to as they wrote it, drawn under their name. Null if none. */
  senderFaction: z.string().nullable(),
  audience: MessageAudienceSchema,
  /** Named for the header: a player's username, or the faction's name. */
  addressedTo: z.string().min(1),
  subject: MessageSubjectSchema,
  body: MessageBodySchema,
  sentAt: IsoDateTimeSchema,
  readAt: IsoDateTimeSchema.nullable(),
  /** Set when this message is an invitation to a faction. See the note at the top. */
  invite: MessageInviteSchema.nullable(),
});
export type Message = z.infer<typeof MessageSchema>;

/** A row in the sent folder: one send, however many people it reached. */
export const SentMessageSchema = z.object({
  threadId: IdSchema,
  audience: MessageAudienceSchema,
  addressedTo: z.string().min(1),
  subject: MessageSubjectSchema,
  body: MessageBodySchema,
  sentAt: IsoDateTimeSchema,
  /** How many mailboxes it landed in, and how many of those have opened it. */
  recipients: z.number().int().nonnegative(),
  readBy: z.number().int().nonnegative(),
});
export type SentMessage = z.infer<typeof SentMessageSchema>;

export const MESSAGE_REFUSALS = [
  'no_such_player',
  'not_in_a_faction',
  'cannot_write_to_yourself',
  'nobody_to_write_to',
] as const;
export const MessageRefusalSchema = z.enum(MESSAGE_REFUSALS);
export type MessageRefusal = z.infer<typeof MessageRefusalSchema>;

export const MESSAGE_REFUSAL_TEXT: Record<MessageRefusal, string> = {
  no_such_player: 'Nobody in this city goes by that name.',
  not_in_a_faction: 'You are not in a faction to write to.',
  cannot_write_to_yourself: 'You already know.',
  nobody_to_write_to: 'There is nobody at the other end of that.',
};

export function unreadMessages(messages: readonly Message[]): number {
  return messages.filter((entry) => entry.readAt === null).length;
}

/**
 * The subject a reply opens with.
 *
 * Prefixed once however many times a conversation goes back and forth: `Re: Re: Re:` is a thing
 * mail clients stopped doing thirty years ago and nobody has missed it.
 */
export function replySubject(subject: string): string {
  const trimmed = subject.trim();
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

/**
 * The body a reply opens with: the original, quoted, under a blank line.
 *
 * Quoting is what makes a mailbox a conversation rather than a stack of unrelated notes, and doing
 * it here rather than in the client means the sent copy and the received copy carry the same text.
 */
export function quoted(message: Pick<Message, 'senderName' | 'body'>): string {
  const lines = message.body
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return `\n\n${message.senderName} wrote:\n${lines}\n`;
}
