import {
  cardMark,
  dealCards,
  type FactionCard,
  type OfficerMark,
  type Seatable,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';

/** What one seat at a table is holding, and how well. */
export interface DealtCard {
  readonly card: FactionCard;
  readonly mark: OfficerMark;
}

/**
 * The cards dealt at a table, by member, with each holder's mark on theirs.
 *
 * Dealt off the same order the room draws (`seatOrder`, shared), so the card on a plate is the
 * card the server pays out on. The mark reads the holder's own sheet: the Overseer's attributes,
 * which is the player's character rather than anybody they hired. Read by the faction screen, to
 * say it, and by the standing fold, to pay it, and it is one function so the two cannot drift.
 */
export function cardsAtTable(repos: Repositories, factionId: string): Map<string, DealtCard> {
  const seatable = repos.factions.members(factionId).flatMap((row) => {
    const user = repos.users.findById(row.userId);
    const base = repos.bases.findByOwnerId(row.userId);
    if (!user || !base) return [];
    const armySize = Object.values(base.army).reduce((total, count) => total + count, 0);
    const seat: Seatable & { userId: string; overseerId: string | null } = {
      userId: row.userId,
      username: user.username,
      rank: row.rank,
      armySize,
      overseerId: user.overseerId ?? null,
    };
    return [seat];
  });
  const dealt = dealCards(seatable);
  const held = new Map<string, DealtCard>();
  for (const seat of seatable) {
    const card = dealt.get(seat.userId);
    const overseer = seat.overseerId ? repos.overseers.findById(seat.overseerId) : undefined;
    if (card === undefined || !overseer) continue;
    held.set(seat.userId, { card, mark: cardMark(card, overseer.attributes) });
  }
  return held;
}
