import { z } from 'zod';
import { PlayerStandingSchema, type PlayerStanding } from './leaderboard.js';

/**
 * Finding a player by name: the standings search and the letter composer's To field.
 *
 * In shared because the server answers the composer's lookup (maintainer, 2026-10-06: the composer
 * looks names up on the server, not in the top 100 the standings carry) and the standings screen
 * still searches the rows it already has. One matcher for both, so a name the board's search finds
 * is a name the composer finds, ranked the same way.
 */

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

/**
 * How well a row answers to what was typed, on either of its names: the login and the name they go
 * by, which is the one the board prints (bug pass, 2026-10-02).
 */
function entryScore(entry: PlayerStanding, query: string): number | null {
  const scores = [entry.username, entry.displayName]
    .filter((name): name is string => name !== undefined)
    .map((name) => matchScore(name, query))
    .filter((score): score is number => score !== null);
  return scores.length === 0 ? null : Math.min(...scores);
}

/** The rows that answer to what was typed, in the order they were handed over. */
export function filterPlayers(entries: readonly PlayerStanding[], query: string): PlayerStanding[] {
  return entries.filter((entry) => entryScore(entry, query) !== null);
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
    .map((entry) => ({ entry, score: entryScore(entry, query) }))
    .filter((hit): hit is { entry: PlayerStanding; score: number } => hit.score !== null)
    .sort((a, b) => a.score - b.score || a.entry.rank - b.entry.rank)
    .slice(0, limit)
    .map((hit) => hit.entry);
}

// --- the composer's lookup ---

/** How many names one lookup answers with: what the composer's list shows. */
export const PLAYER_LOOKUP_LIMIT = 6;

/** `GET /players/lookup?q=`: what has been typed so far. */
export const PlayerLookupQuerySchema = z.object({
  q: z.string().max(64),
});
export type PlayerLookupQuery = z.infer<typeof PlayerLookupQuerySchema>;

/**
 * The best answers to a name, out of every player in the game rather than the standings' top 100,
 * ranked as {@link suggestPlayers} ranks them. The reader is never among them: nobody writes to
 * themselves.
 */
export const PlayerLookupResponseSchema = z.object({
  players: z.array(PlayerStandingSchema).max(PLAYER_LOOKUP_LIMIT),
});
export type PlayerLookupResponse = z.infer<typeof PlayerLookupResponseSchema>;
