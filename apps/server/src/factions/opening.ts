import { randomUUID } from 'node:crypto';
import { FOUND_FACTION_PLAYER_LEVEL, MAX_FACTION_MEMBERS } from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { seededFactionId } from '../seed/index.js';
import { sendMessage } from '../social/send.js';

/**
 * The seeded faction's invitation to a new crew, sent once the crew can accept it (2026-09-28).
 *
 * It used to arrive with the character, at level one. Joining a faction needs level 10 now, the
 * level the Faction screen opens at (maintainer: "level 10 everywhere"), so a letter on the first
 * day would be an offer the player could not take for days. It is sent from the XP funnel the
 * moment a crew reaches the level instead (`progression/award.ts`), and on the day a crew starts at
 * or past it (the dev sandbox).
 */
export function offerOpeningInvitationAt(
  repos: Repositories,
  userId: string,
  level: number,
  now: string,
): void {
  if (level < FOUND_FACTION_PLAYER_LEVEL) return;
  const user = repos.users.findById(userId);
  if (!user) return;
  /*
   * An invitation from the seeded faction, if there is room at it.
   *
   * A new account meets factions through the real door rather than by being quietly enrolled:
   * they get an invitation in their notifications and on the faction screen, and accepting it
   * runs the same `POST /factions/answer` anybody else's invitation does. Silently adding them
   * to a table they never agreed to join would have been the shorter route and the wrong one.
   */
  const seeded = seededFactionId(repos);
  const faction = seeded === undefined ? undefined : repos.factions.find(seeded);
  // Once: an account choosing again after a clean slate may still hold the first invitation,
  // and `invite` keeps that row, so a second letter pointed its button at an id that was never
  // written ("no such invite") (bug pass, 2026-09-27).
  const alreadyAsked =
    seeded !== undefined &&
    repos.factions.invitesFor(user.id).some((invite) => invite.factionId === seeded);
  if (
    seeded &&
    faction &&
    !alreadyAsked &&
    repos.factions.memberCount(seeded) < MAX_FACTION_MEMBERS
  ) {
    const leader = repos.factions.members(seeded).find((member) => member.rank === 'leader');
    const inviteId = randomUUID();
    repos.factions.invite({
      id: inviteId,
      factionId: seeded,
      invitedUserId: user.id,
      invitedByUserId: leader?.userId ?? user.id,
      sentAt: now,
    });
    /*
     * Delivered as a **message**, the way every other invitation is (`routes/factions.ts`).
     *
     * It used to be a bell entry alone, pointing at `/game/faction`. That screen is behind
     * `RequireUnlock area="faction"`, which is level 10, and this invitation arrives at level
     * one: the first notification a new account ever received was a door it could not open,
     * for an offer it had no way to answer. The mailbox is not gated, and a message carrying
     * `invite` is what makes `InviteCard` draw an Accept button, so this is the only delivery
     * that is actually actionable on the day it is sent. `FoundFaction`'s own copy already
     * told the player their invitation would be "in your messages, with a button on it".
     *
     * The bell still rings `faction_invite` rather than `message_received`, so a player who
     * has muted ordinary mail still hears this one.
     */
    const inviter = leader?.userId ?? user.id;
    sendMessage(repos, {
      sender: { id: inviter, username: faction.name },
      senderFaction: faction.name,
      recipients: [user.id],
      audience: 'player',
      addressedTo: user.username,
      subject: `An invitation to ${faction.name}`,
      body:
        `${faction.name} has asked you to join them.\n\n` +
        `${faction.blurb || 'They have not written down what they are for.'}\n\n` +
        'Accepting puts your district at their table: your army shows up on their roster, ' +
        'their fights show up on yours, and either of you can send help to the other.',
      sentAt: new Date(now),
      invite: { inviteId, factionId: faction.id },
      notification: {
        kind: 'faction_invite',
        title: `${faction.name} has asked you to join`,
        body: 'There is a table with a seat open.',
        link: '/game/messages',
      },
      keepSentCopy: false,
    });
  }
}
