import type { LimitRule } from './bucket.js';

/**
 * What each class of request is allowed, and why it is that number.
 *
 * Four classes rather than one, because the things worth stopping are different. Guessing a
 * password is a slow grind against one endpoint from one address; hammering the game is a lot of
 * ordinary writes from one logged-in account; and a screen full of live counters is a lot of
 * ordinary reads that must never be refused, because refusing them breaks the game for somebody
 * playing it properly.
 *
 * The numbers are set against what a real client actually does. The shell polls `/me` and `/city`
 * every five seconds, so a player with the game open makes about 24 reads a minute before touching
 * anything, and a player clicking through screens can easily triple that. `READS` is well clear of
 * it: a limit a legitimate player can reach is a bug report, not a defence.
 */

/** Signing in and signing up. Per address, because there is no account yet to count against. */
export const AUTH_LIMIT: LimitRule = { quota: 20, windowMs: 15 * 60_000 };

/** Everything that changes the world. Per account. */
export const WRITE_LIMIT: LimitRule = { quota: 120, windowMs: 60_000 };

/** Everything that only looks. Per account. */
export const READ_LIMIT: LimitRule = { quota: 600, windowMs: 60_000 };

/**
 * Opening the live channel.
 *
 * Its own class because it is neither a read nor a write: one is meant to be opened once and held
 * for hours, so the interesting number is how often somebody *opens* one. A client whose backoff
 * has failed, or one written by hand, can otherwise sit in a reconnect loop holding a file
 * descriptor per attempt. Generous enough for the real backoff plus a few tabs and reloads.
 */
export const STREAM_LIMIT: LimitRule = { quota: 60, windowMs: 60_000 };

/**
 * Paths that are password work by another name.
 *
 * `AUTH_LIMIT` exists because guessing a password is a slow grind against one endpoint, and it was
 * keyed on the `/api/auth/` prefix alone. `/api/settings/password` does *twice* the crypto of a
 * login (a `bcrypt.compare` and a `bcrypt.hash`, measured at 49ms and 55ms on this machine with the
 * repo's own `bcryptjs`) and sat on the 120/minute write bucket, so one account could spend 12.5
 * seconds of CPU a minute, on the single thread that serves every player's reads, settles and
 * battle resolutions. A wrong `currentPassword` is refused *after* the compare, so the refusal costs
 * the server 49ms and the caller nothing.
 */
const PASSWORD_PATHS: readonly string[] = ['/api/settings/password'];

/**
 * Which rule a request falls under, from its method and path.
 *
 * Path-prefixed rather than per-route, so a route added tomorrow is covered by default. The
 * default is the strict one: an unclassified write is limited as a write.
 */
export function ruleFor(method: string, path: string): { rule: LimitRule; scope: string } {
  if (path.startsWith('/api/auth/')) return { rule: AUTH_LIMIT, scope: 'auth' };
  if (PASSWORD_PATHS.includes(path)) return { rule: AUTH_LIMIT, scope: 'auth' };
  if (path === '/api/events') return { rule: STREAM_LIMIT, scope: 'stream' };
  if (method === 'GET' || method === 'HEAD') return { rule: READ_LIMIT, scope: 'read' };
  return { rule: WRITE_LIMIT, scope: 'write' };
}
