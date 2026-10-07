import { canNameSuccessor, displayNameOf, leavingDisbands } from '@frontline/shared';
import type { FactionMemberRow } from '../db/repos/factions.js';
import type { Repositories } from '../db/repos/index.js';
import { AppError } from '../errors.js';
import { notify, notifyFaction } from '../social/notify.js';
import { cutFactionTies } from './ties.js';

/**
 * One member walking out of their faction: `POST /factions/leave`, and the Console's Clean slate,
 * which leaves on the old life's behalf (bug pass, 2026-09-29) so the table hears it the same way.
 *
 * A leader walking out takes the faction with them (board's rule, `leavingDisbands`), unless they
 * name a successor on the way out (maintainer, 2026-09-30): "If there are members there is a
 * warning about disbanding, and it allows you to choose another leader. You may still not do it
 * though." So `successorId` is optional. With it, leadership passes to that member and the caller
 * leaves as a chief would; without it, the faction ends as it always has.
 *
 * Leaving is always allowed, and the leader is told what it will cost before they do it, which is
 * the client's job (`LeaveDialog`) and the reason the rules are shared functions rather than
 * branches living here. Callers run this inside one transaction, so the handover and the walk out
 * land together or not at all: a faction with no leader is a state nothing else can read.
 */
export function leaveFaction(
  repos: Repositories,
  held: FactionMemberRow,
  username: string,
  now: Date,
  successorId?: string,
): void {
  const members = repos.factions.members(held.factionId);

  const heir =
    successorId === undefined
      ? null
      : handOverOnTheWayOut(repos, held, members, successorId, username, now);
  // After a handover the leaver is a chief, and a chief leaving is an ordinary departure.
  const rank = heir === null ? held.rank : 'chief';

  if (leavingDisbands(rank, members.length)) {
    notifyFaction(repos, held.factionId, {
      kind: 'faction_left',
      title: `${username} disbanded the faction`,
      body: 'The faction they led is gone.',
      link: '/game/faction',
      at: now,
      exceptUserId: held.userId,
    });
    const everyone = members.map((row) => row.userId);
    // At the caller's instant, not the wall clock's (bug pass, 2026-10-06).
    cutFactionTies(repos, everyone, everyone, now);
    repos.factions.disband(held.factionId);
    return;
  }

  cutFactionTies(
    repos,
    [held.userId],
    members.map((row) => row.userId).filter((id) => id !== held.userId),
    now,
  );
  repos.factions.removeMember(held.userId);
  repos.factions.dropInvitesSentBy(held.userId);
  notifyFaction(repos, held.factionId, {
    kind: 'faction_left',
    title: `${username} has left the faction`,
    body: heir === null ? '' : `${heir} leads it now.`,
    link: '/game/faction',
    at: now,
  });
}

/**
 * The handover a leader makes as they go, answering with the new leader's name. Refused, before
 * anything is written, when the caller is not a leader with somebody to hand it to, or when the
 * name is not somebody else at this table.
 */
function handOverOnTheWayOut(
  repos: Repositories,
  held: FactionMemberRow,
  members: readonly FactionMemberRow[],
  successorId: string,
  username: string,
  now: Date,
): string {
  if (!canNameSuccessor(held.rank, members.length)) {
    throw new AppError('FACTION_REFUSED', 'not_allowed');
  }
  const successor = members.find((row) => row.userId === successorId);
  if (!successor || successor.userId === held.userId) {
    throw new AppError('FACTION_REFUSED', 'not_a_member');
  }
  repos.factions.setRank(successor.userId, 'leader');
  notify(repos, {
    userId: successor.userId,
    kind: 'faction_joined',
    title: 'You lead the faction now',
    body: `${username} handed it to you on the way out.`,
    link: '/game/faction',
    at: now,
  });
  const heir = repos.users.findById(successor.userId);
  return heir ? displayNameOf(heir) : 'Somebody';
}
