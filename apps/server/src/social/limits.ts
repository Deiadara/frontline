import { randomUUID } from 'node:crypto';
import {
  INVITES_TO_ONE_PLAYER_PER_DAY,
  INVITES_TO_ONE_PLAYER_PER_WEEK,
  MESSAGES_PER_DAY,
  type FactionRefusal,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';

/**
 * How many letters a player may send, and how often one player may be invited (hardening pass,
 * 2026-09-27; maintainer, 2026-09-29).
 *
 * Both windows roll: "a day" is the 24 hours before now, "a week" the seven days before now. That
 * is how `MESSAGES_PER_DAY` has always been counted, and a letter under two limits that turned
 * over at different moments (one at midnight, one 24 hours after the letter) would print two
 * different "come back" times for one refusal.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

const before = (now: Date, ms: number): string => new Date(now.getTime() - ms).toISOString();

/**
 * Whether this account has used up the day's letters.
 *
 * Counted off the send log (maintainer, 2026-10-06), which deleting or trimming letters cannot
 * touch: counted off the sent folder, a trim under the day would have handed sends back.
 *
 * An invitation is a letter (maintainer, 2026-09-29): it puts a row and a bell in somebody's
 * mailbox like any other, so it spends one of the hundred. It is logged in its own ledger rather
 * than as a letter, so it is counted off that and added.
 */
export function outOfLettersToday(repos: Repositories, userId: string, now: Date): boolean {
  const since = before(now, DAY_MS);
  const sent =
    repos.social.lettersSentSince(userId, since) +
    repos.social.invitationLettersSince(userId, since);
  return sent >= MESSAGES_PER_DAY;
}

/** Letters from one sender that reached one reader's mailbox in the last day, deleted or not. */
export function lettersToThemToday(
  repos: Repositories,
  senderUserId: string,
  recipientUserId: string,
  now: Date,
): number {
  return repos.social.lettersToSince(senderUserId, recipientUserId, before(now, DAY_MS));
}

/** One letter for the send log: who wrote it, the mailboxes it reached, and whether it is counted. */
export interface LoggedLetter {
  letterId: string;
  senderUserId: string;
  /** Every mailbox it actually landed in. A reader who blocked the sender is not one. */
  reached: readonly string[];
  /** Whether it spends one of the day's hundred. An invitation is counted off its own ledger. */
  countsForTheDay: boolean;
  sentAt: Date;
}

/**
 * Writes a letter into the send log both letter limits read, and forgets what neither reaches.
 *
 * A log rather than a count of what sits in the mailboxes (maintainer, 2026-10-06): the mailbox
 * trim hard-deletes what its reader threw away, so a spammer's ten letters, once deleted, stopped
 * counting, and the reader deleting spam was what reopened the gate.
 */
export function logLetter(repos: Repositories, letter: LoggedLetter): void {
  repos.social.forgetLetterSendsBefore(before(letter.sentAt, DAY_MS));
  const sentAt = letter.sentAt.toISOString();
  const row = { letterId: letter.letterId, senderUserId: letter.senderUserId, sentAt };
  if (letter.countsForTheDay) repos.social.logLetterSend({ ...row, recipientUserId: null });
  for (const recipientUserId of letter.reached) {
    repos.social.logLetterSend({ ...row, recipientUserId });
  }
}

/** Who is inviting whom, for the per-player limits. */
export interface Invitation {
  senderUserId: string;
  factionId: string;
  inviteeUserId: string;
  now: Date;
}

/**
 * Why this invitation would be one too many for its invitee, or null.
 *
 * Counted from the sender **or** their table, because the loop this closes ran through both: a
 * leader and a chief taking turns, each demotion dropping the last invitation, and a founder
 * founding and disbanding, a new table each time. Keyed on the sender alone, a table of five
 * could send fifteen a day; on the faction alone, one account could found its way round it.
 */
export function invitationRefusal(
  repos: Repositories,
  invitation: Invitation,
): FactionRefusal | null {
  const count = (ms: number) =>
    repos.social.invitationsToSince(invitation, before(invitation.now, ms));
  if (count(DAY_MS) >= INVITES_TO_ONE_PLAYER_PER_DAY) return 'invited_too_often_today';
  if (count(WEEK_MS) >= INVITES_TO_ONE_PLAYER_PER_WEEK) return 'invited_too_often_this_week';
  return null;
}

/** Writes the invitation into the ledger both limits read, and forgets what neither reaches. */
export function recordInvitationLetter(repos: Repositories, invitation: Invitation): void {
  repos.social.forgetInvitationLettersBefore(before(invitation.now, WEEK_MS));
  repos.social.recordInvitationLetter({
    id: randomUUID(),
    senderUserId: invitation.senderUserId,
    factionId: invitation.factionId,
    inviteeUserId: invitation.inviteeUserId,
    sentAt: invitation.now.toISOString(),
  });
}
