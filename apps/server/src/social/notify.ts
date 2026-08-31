import { randomUUID } from 'node:crypto';
import { wantsNotification, type NotificationKind } from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { liveHub } from '../live/hub.js';
import { NOTIFICATION_LIVE_KINDS } from '../live/kinds.js';

/**
 * Writing a notification.
 *
 * **The only way one is created.** Every system that wants to tell a player something goes through
 * here, which is what makes the settings switch real: the filter is applied at the point of writing
 * (`wantsNotification`), so a muted kind never reaches the table at all. Filtering on read instead
 * would leave a player who switched a category back on facing three weeks of backlog, and would
 * make the unread badge a count of things they had asked not to see.
 *
 * ## Never throws
 *
 * A notification is a side effect of something that has already happened: the fight is resolved,
 * the building is up, the wage is paid. If writing the receipt fails, the thing it is about must
 * still stand. So every failure here is swallowed rather than propagated, and the alternative was
 * tried on paper and rejected: a settle path that rolls back a battle because the bell could not
 * ring is a worse bug than a missing line in a list.
 */

/** How many a player keeps. Old enough to be an archive, small enough not to grow without end. */
export const NOTIFICATION_HISTORY = 200;

export interface NotifyInput {
  userId: string;
  kind: NotificationKind;
  title: string;
  /** One line under the title. Empty where the title says the whole thing. */
  body?: string;
  /** Where this goes when clicked. A receipt with nowhere to go makes the player hunt. */
  link: string;
  /** The id of the thing this is about, so opening it can show it. */
  subjectId?: string | null;
  now: Date;
}

/**
 * Tells one player one thing, if they asked to hear about it.
 *
 * Returns whether anything was written, which is what the tests assert on: "muted means nothing is
 * recorded" is not observable from the outside any other way.
 */
export function notify(repos: Repositories, input: NotifyInput): boolean {
  try {
    if (!wantsNotification(repos.social.settings(input.userId), input.kind)) return false;
    repos.social.putNotification({
      id: randomUUID(),
      userId: input.userId,
      kind: input.kind,
      title: input.title,
      body: input.body ?? '',
      link: input.link,
      subjectId: input.subjectId ?? null,
      createdAt: input.now.toISOString(),
    });
    // Trimmed on write rather than on a schedule: there is no scheduler in this server, and the
    // only moment a list is known to have grown is the moment something was added to it.
    repos.social.trimNotifications(input.userId, NOTIFICATION_HISTORY);
    // The live nudge rides the same funnel as the receipt, which is why it is one line and not a
    // publisher wired into every emitter: anything worth writing down is worth telling an open tab
    // about, and the two can never disagree about whether it happened.
    liveHub.publish(input.userId, 'notification', input.now);
    const extra = NOTIFICATION_LIVE_KINDS[input.kind];
    if (extra) liveHub.publish(input.userId, extra, input.now);
    return true;
  } catch {
    return false;
  }
}

/** The same, to everybody at one table. Used for "somebody joined", "somebody left". */
export function notifyFaction(
  repos: Repositories,
  factionId: string,
  input: Omit<NotifyInput, 'userId'> & { exceptUserId?: string },
): void {
  try {
    for (const member of repos.factions.members(factionId)) {
      if (member.userId === input.exceptUserId) continue;
      notify(repos, { ...input, userId: member.userId });
    }
  } catch {
    // Same promise as `notify`: the thing that happened still happened.
  }
}

/**
 * The owner of a base, for the systems that know a district but not an account.
 *
 * Guarded like everything else here. The promise at the top of this file is that a receipt can
 * never take down the thing it is a receipt for, and an unguarded lookup broke it the first time
 * a caller passed repositories that did not implement every table: the settle threw on the way to
 * writing a notification nobody had asked for.
 */
export function ownerOf(repos: Repositories, baseId: string): string | undefined {
  try {
    return repos.bases.findById(baseId)?.ownerId;
  } catch {
    return undefined;
  }
}

/**
 * Tells the crew that owns a district something.
 *
 * A convenience with one job: most emitters know a `baseId` because that is what the game is made
 * of, and every one of them would otherwise repeat the same lookup-and-guard.
 */
export function notifyBase(
  repos: Repositories,
  baseId: string,
  input: Omit<NotifyInput, 'userId'>,
): boolean {
  const userId = ownerOf(repos, baseId);
  return userId === undefined ? false : notify(repos, { ...input, userId });
}
