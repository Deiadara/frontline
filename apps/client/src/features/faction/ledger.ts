import type { FactionResponse } from '@frontline/shared';
import type { IconName } from '../../components/ui/Icon';

/**
 * What has happened at this table, derived from the screen's own payload.
 *
 * There is no events endpoint and this does not ask for one. Every fact a faction feed wants is
 * already on `GET /factions` carrying a timestamp: when each person sat down, when each unanswered
 * invitation went out, when each fight is marked for, and what this player has put into one. The
 * feed is those four read in one order.
 *
 * Pure, and apart from the component, for the reason `order.ts` is: a feed sorted the wrong way
 * still draws a plausible list of sentences, and the only way to see it is to read the dates. The
 * test pins the direction.
 */
export interface LedgerEntry {
  readonly id: string;
  /** ISO, from the payload. What the feed is ordered by. */
  readonly at: string;
  readonly icon: IconName;
  readonly text: string;
}

/**
 * How entries stamped with the same instant are ordered, low first among equals.
 *
 * A faction founded a minute ago has its founding, its leader's arrival and its first invitation
 * all on the same timestamp, and `sentAt` alone leaves those three in whatever order the arrays
 * happened to be built in. Newest first means a fight called goes above a person arriving, which
 * goes above the founding: the reading order of the sentences as anybody would tell the story.
 */
const KIND_ORDER = { fight: 0, help: 1, invite: 2, joined: 3, founded: 4 } as const;
type Kind = keyof typeof KIND_ORDER;

interface Draft extends LedgerEntry {
  readonly kind: Kind;
}

export function ledger(data: FactionResponse): LedgerEntry[] {
  const drafts: Draft[] = [];

  if (data.faction !== null) {
    drafts.push({
      kind: 'founded',
      id: 'founded',
      at: data.faction.foundedAt,
      icon: 'archive',
      text: `${data.faction.name} was put together`,
    });
  }

  for (const member of data.members) {
    drafts.push({
      kind: 'joined',
      id: `joined-${member.userId}`,
      at: member.joinedAt,
      icon: 'faction',
      text: `${member.username} came to the table`,
    });
  }

  for (const invite of data.pending) {
    /*
     * The invited player's *name* is not on the wire.
     *
     * `FactionInvite` carries `invitedUserId` and the name of whoever sent it, and nothing that
     * resolves the id to a username: the invited player is by definition not in `members`. So the
     * line says what the payload knows instead of inventing a name for them.
     */
    drafts.push({
      kind: 'invite',
      id: `invite-${invite.id}`,
      at: invite.sentAt,
      icon: 'crew',
      text: `${invite.invitedBy} asked somebody in, and nobody has answered`,
    });
  }

  for (const battle of data.battles) {
    drafts.push({
      kind: 'fight',
      id: `fight-${battle.battleId}`,
      at: battle.scheduledFor,
      icon: 'battles',
      text:
        battle.side === 'attacker'
          ? `${battle.memberName} called a fight at ${battle.targetName}`
          : `${battle.memberName} is being come for at ${battle.targetName}`,
    });
    if (battle.yourContribution > 0) {
      drafts.push({
        kind: 'help',
        id: `help-${battle.battleId}`,
        at: battle.scheduledFor,
        icon: 'units',
        text: `You sent ${battle.yourContribution.toLocaleString()} to ${battle.targetName}`,
      });
    }
  }

  return drafts
    .sort((left, right) => {
      const byTime = right.at.localeCompare(left.at);
      if (byTime !== 0) return byTime;
      const byKind = KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
      return byKind !== 0 ? byKind : left.id.localeCompare(right.id);
    })
    .map(({ kind: _kind, ...entry }) => entry);
}
