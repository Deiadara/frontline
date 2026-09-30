import { leavingDisbands } from '@frontline/shared';
import type { FactionMemberRow } from '../db/repos/factions.js';
import type { Repositories } from '../db/repos/index.js';
import { notifyFaction } from '../social/notify.js';
import { bringPostedUnitsHome } from './unpost.js';

/**
 * One member walking out of their faction: `POST /factions/leave`, and the Console's Clean slate,
 * which leaves on the old life's behalf (bug pass, 2026-09-29) so the table hears it the same way.
 *
 * A leader walking out takes the faction with them (board's rule, `leavingDisbands`).
 *
 * Not a refusal, which is what this used to be: a leader who wanted out was told to hand it over
 * first and had no way to simply be finished with it. Now leaving is always allowed and the leader
 * is told what it will cost before they do it, which is the client's job (`LeaveDialog`) and the
 * reason the same rule is a shared function rather than a branch living here. Handing over first
 * still works, and is the way to leave without ending it: after the handover the caller is a chief
 * and takes the ordinary path below.
 */
export function leaveFaction(
  repos: Repositories,
  held: FactionMemberRow,
  username: string,
  now: Date,
): void {
  const members = repos.factions.members(held.factionId);

  if (leavingDisbands(held.rank, members.length)) {
    notifyFaction(repos, held.factionId, {
      kind: 'faction_left',
      title: `${username} disbanded the faction`,
      body: 'The faction they led is gone.',
      link: '/game/faction',
      at: now,
      exceptUserId: held.userId,
    });
    const everyone = members.map((row) => row.userId);
    bringPostedUnitsHome(repos, everyone, everyone);
    repos.factions.disband(held.factionId);
    return;
  }

  bringPostedUnitsHome(
    repos,
    [held.userId],
    members.map((row) => row.userId).filter((id) => id !== held.userId),
  );
  repos.factions.removeMember(held.userId);
  repos.factions.dropInvitesSentBy(held.userId);
  notifyFaction(repos, held.factionId, {
    kind: 'faction_left',
    title: `${username} has left the faction`,
    body: '',
    link: '/game/faction',
    at: now,
  });
}
