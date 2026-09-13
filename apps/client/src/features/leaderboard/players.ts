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

/** Everything that is not a letter or a digit, for the forgiving last pass. */
const NOISE = /[^a-z0-9]+/g;
const PUNCTUATION = /[^a-z0-9]/;

/** Where each word of a name starts: at the front, and after every mark between words. */
function wordStarts(name: string): number[] {
  const starts = [0];
  for (let at = 1; at < name.length; at++) {
    if (PUNCTUATION.test(name[at - 1] ?? '')) starts.push(at);
  }
  return starts;
}

/**
 * How well a name answers to what was typed, or null if it does not answer at all.
 *
 * Four tiers rather than a distance score. A player searching a leaderboard is looking for
 * somebody they already know the name of, so "starts with what I typed" has to beat "contains it
 * somewhere" every time: typing `mar` with a `Marrow` and a `Grimark` on the board must not put
 * Grimark first because it happens to be shorter or higher.
 *
 * The last tier is the forgiving one: punctuation is dropped from both sides, so `sableninth` and
 * `sable ninth` both find `Sable_Ninth`, which a plain substring test does not.
 */
export function matchScore(username: string, query: string): number | null {
  const wanted = query.trim().toLowerCase();
  if (wanted === '') return 0;
  const name = username.toLowerCase();
  if (name === wanted) return 0; // their whole name
  if (name.startsWith(wanted)) return 1; // the front of it
  if (wordStarts(name).some((at) => name.startsWith(wanted, at))) return 2; // the front of a word
  if (name.includes(wanted)) return 3; // somewhere in the middle
  const loose = wanted.replace(NOISE, '');
  const bare = name.replace(NOISE, '');
  if (loose !== '' && bare.includes(loose)) return 4; // ignoring the punctuation in either
  return null;
}

/** The rows that answer to what was typed, in the order they were handed over. */
export function filterPlayers(entries: readonly PlayerStanding[], query: string): PlayerStanding[] {
  return entries.filter((entry) => matchScore(entry.username, query) !== null);
}

/**
 * The best few answers to what has been typed so far, best first.
 *
 * Ties go to whoever is higher on the board, which is the only tiebreak a standings screen can
 * defend: of two `Marrow`s the reader is more likely to mean the one in the top ten.
 *
 * An empty query suggests nothing. The list under the field is a *recommendation*, and dropping
 * the first five rows of the board into it the moment the field is focused says nothing the table
 * two inches below is not already saying.
 */
export function suggestPlayers(
  entries: readonly PlayerStanding[],
  query: string,
  limit = 5,
): PlayerStanding[] {
  if (query.trim() === '') return [];
  return entries
    .map((entry) => ({ entry, score: matchScore(entry.username, query) }))
    .filter((hit): hit is { entry: PlayerStanding; score: number } => hit.score !== null)
    .sort((a, b) => a.score - b.score || a.entry.rank - b.entry.rank)
    .slice(0, limit)
    .map((hit) => hit.entry);
}
