import type { PlayerStanding } from '@frontline/shared';

/**
 * What the players' board can be sorted and searched by (maintainer request, 2026-09-12).
 *
 * Pure functions over the rows the server already sent, in their own file for two reasons: the
 * page is a table and a menu and has no business holding a matcher, and the ranking rules below
 * are the kind of thing that is only ever wrong in the third case nobody rendered. They are tested
 * directly.
 */

/**
 * The three orders the table can be in.
 *
 * The maintainer asked for two choices, Level and Total infamy. `standing` is the third because it is
 * the one the screen opens in: the server's own order, which is the ranking the `#` column prints.
 * Without an entry for it, picking either of the other two would be a one-way door and the reader
 * would have to reload the page to get the board back.
 */
export const PLAYER_SORTS = ['standing', 'level', 'total'] as const;
export type PlayerSort = (typeof PLAYER_SORTS)[number];

export const PLAYER_SORT_LABELS: Record<PlayerSort, string> = {
  standing: 'Standing',
  level: 'Level',
  total: 'Total infamy',
};

/** A line under each choice in the menu, because "Infamy" and "Total infamy" are one word apart. */
export const PLAYER_SORT_HINTS: Record<PlayerSort, string> = {
  standing: 'The board as it was ranked',
  level: 'Highest level first',
  total: 'Everything they have ever been paid, spent or not',
};

/**
 * The rows in the order a choice asks for, without touching the caller's array.
 *
 * Ties fall back on the rank the server gave, so two crews on level 9 stay in the order the board
 * ranked them rather than in whichever order `sort` happened to leave them: a table that reshuffles
 * its equal rows every time the menu is opened looks broken even though nothing moved.
 */
export function sortPlayers(
  entries: readonly PlayerStanding[],
  sort: PlayerSort,
): PlayerStanding[] {
  const rows = [...entries];
  if (sort === 'standing') return rows;
  const scoreOf = (entry: PlayerStanding) => (sort === 'level' ? entry.level : entry.totalInfamy);
  return rows.sort((a, b) => scoreOf(b) - scoreOf(a) || a.rank - b.rank);
}

/*
 * The name matcher lives in `@frontline/shared` (2026-10-06), because the server answers the
 * letter composer's lookup with it. Re-exported so this screen's imports stay where they were.
 */
export { filterPlayers, matchScore, suggestPlayers } from '@frontline/shared';
