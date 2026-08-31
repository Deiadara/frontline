import { z } from 'zod';
import { IdSchema } from '../primitives.js';
import { BadgeSchema } from '../factions/badge.js';
import { FactionNameSchema } from '../factions/factions.js';

/**
 * The standings (board request): who is ahead, of the players and of the factions.
 *
 * Two boards rather than one list with a filter, because they rank different things and the row
 * shapes differ: a player has a district and a level, a faction has a badge and a seat count.
 *
 * ## Infamy is the measure, and for a faction it is not a sum of wallets
 *
 * A player's standing is the infamy they hold (§D7). A faction's is the infamy its members have
 * **earned while at its table**, which is a different number and deliberately so:
 *
 *   * Infamy is spent. Buying notoriety would drop a faction down a wallet-summing board, so the
 *     board would punish the thing it is supposed to reward.
 *   * Arriving with 30,000 infamy would hand a faction 30,000 it had no part in. A faction should
 *     climb by fighting, not by recruiting somebody who already had.
 *
 * So the faction figure is an **append-only** total on the faction: infamy won in a fight is added
 * to whichever faction the winner was in at the time, and nothing ever takes any of it away. Not
 * even somebody leaving: what they won, they won while wearing the badge, and a faction's record
 * of what it has done should not be rewritten by who is at the table today. See migration `0050`
 * and `creditFaction` in `battle/resolve.ts`.
 */

export const LEADERBOARD_BOARDS = ['players', 'factions'] as const;
export const LeaderboardBoardSchema = z.enum(LEADERBOARD_BOARDS);
export type LeaderboardBoard = z.infer<typeof LeaderboardBoardSchema>;

export const LEADERBOARD_BOARD_LABELS: Record<LeaderboardBoard, string> = {
  players: 'Players',
  factions: 'Factions',
};

/** How many rows a board carries. Enough to scroll, small enough to be one request. */
export const LEADERBOARD_LIMIT = 100;

export const PlayerStandingSchema = z.object({
  rank: z.number().int().positive(),
  userId: IdSchema,
  username: z.string().min(1),
  districtId: z.string().min(1),
  /** Which city they are in: the scope the board filters on. */
  cityId: z.string().min(1),
  /** The name the player gave their own district, which is what other screens show. */
  districtName: z.string().min(1),
  level: z.number().int().positive(),
  infamy: z.number().nonnegative(),
  notoriety: z.number().int().nonnegative(),
  /** The faction they fight for, drawn beside them. Null for somebody at no table. */
  factionName: FactionNameSchema.nullable(),
  factionBadge: BadgeSchema.nullable(),
  /** A hardcoded neighbour who does not play. Shown, and marked. */
  isBot: z.boolean(),
});
export type PlayerStanding = z.infer<typeof PlayerStandingSchema>;

export const FactionStandingSchema = z.object({
  rank: z.number().int().positive(),
  factionId: IdSchema,
  name: FactionNameSchema,
  badge: BadgeSchema,
  members: z.number().int().nonnegative(),
  /** Won under this badge, ever. Never a sum of wallets. See the note at the top. */
  infamy: z.number().nonnegative(),
  /** The highest level at the table, which is the other thing a rival wants to know. */
  topLevel: z.number().int().nonnegative(),
});
export type FactionStanding = z.infer<typeof FactionStandingSchema>;

/**
 * One board, at one scope.
 *
 * A discriminated union rather than an object with two arrays, one of which is always empty: the
 * client narrows on `board` and cannot render a faction row into the player table.
 */
export const LeaderboardResponseSchema = z.discriminatedUnion('board', [
  z.object({
    board: z.literal('players'),
    /** True when the list is limited to the caller's own city. */
    localOnly: z.boolean(),
    /** The city the list is limited to, when it is limited. */
    scope: z.string().nullable(),
    entries: z.array(PlayerStandingSchema),
    /** Where the caller sits on this board, or null if they are off the end of it. */
    yourRank: z.number().int().positive().nullable(),
  }),
  z.object({
    board: z.literal('factions'),
    localOnly: z.boolean(),
    scope: z.string().nullable(),
    entries: z.array(FactionStandingSchema),
    yourRank: z.number().int().positive().nullable(),
  }),
]);
export type LeaderboardResponse = z.infer<typeof LeaderboardResponseSchema>;

/**
 * Ranks with ties sharing a place, the way a scoreboard does.
 *
 * Two factions on 4,000 are both second and the next one down is fourth. Standard competition
 * ranking: it is what a player expects, and the alternative (ordering ties arbitrarily and giving
 * them different numbers) makes the board look wrong to the two people it is wrong about.
 *
 * Takes the already-sorted list, because sorting is the caller's business: the two boards sort on
 * different fields and one of them needs a tiebreak the other does not.
 */
export function ranked<T>(
  sorted: readonly T[],
  scoreOf: (entry: T) => number,
): (T & { rank: number })[] {
  let lastScore = Number.NaN;
  let lastRank = 0;
  return sorted.map((entry, index) => {
    const score = scoreOf(entry);
    if (score !== lastScore) {
      lastRank = index + 1;
      lastScore = score;
    }
    return { ...entry, rank: lastRank };
  });
}
