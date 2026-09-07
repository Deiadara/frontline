import type { AllyBattle } from '@frontline/shared';

/**
 * What order the table and the fights are read in.
 *
 * The server hands both back in the order its rows came out of the database, which is join order
 * for the members and battle-id order for the fights. Neither is the order a player wants: a roster
 * is a pecking order, and a list of fights is a queue with a clock on it.
 *
 * Pure, and apart from the components, because both are the kind of comparator that looks right and
 * sorts backwards. A fights list ordered latest-first still draws five plausible cards.
 */

/**
 * The table's order lives in shared now (`seatOrder` in `factions/cards.ts`), because the server
 * deals the cards off it: two copies of the comparator is how a card is dealt to one person and
 * drawn on another. Re-exported here so the room's own modules keep one import.
 */
export { seatOrder } from '@frontline/shared';

/**
 * The fights: the ones you can still walk into first, each group soonest mark first.
 *
 * A fight whose mark has passed is a receipt rather than a decision, so it goes under the ones that
 * are still open however recently it was called.
 */
export function fightOrder(battles: readonly AllyBattle[]): AllyBattle[] {
  return [...battles].sort((left, right) => {
    if (left.canReinforce !== right.canReinforce) return left.canReinforce ? -1 : 1;
    return left.scheduledFor.localeCompare(right.scheduledFor);
  });
}
