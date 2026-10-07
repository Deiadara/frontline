import { AppError } from '../errors.js';
import type { RateLimiter } from './bucket.js';
import { LOGIN_FAILURE_LIMIT } from './rules.js';

/**
 * The per-account half of the sign-in limit (`LOGIN_FAILURE_LIMIT`), counted per address as well.
 *
 * Keyed on the name as typed, folded the way the `users.username` column compares it (`COLLATE
 * NOCASE`, which folds ASCII letters and nothing else), so `Operator` and `OPERATOR` are one
 * account's misses and not two budgets. A name nobody holds is counted the same way: refusing only
 * real accounts would turn the lock into a list of which usernames exist.
 *
 * And on the address the attempts come from (`addressBucket`, so an IPv6 /64 is one address), by
 * the maintainer's ruling of 2026-10-06: a stranger's wrong guesses lock only the stranger's address
 * out of that account. Keyed on the name alone, ten misses each time the window rolled over kept
 * the owner out of their own account for as long as somebody cared to keep typing.
 */
function failureKey(username: string, address: string): string {
  const name = username.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  return `sign-in-failures:${address}:${name}`;
}

/**
 * Counts one attempt against this account, and throws a 429 once it is past its misses, before
 * anything is hashed.
 *
 * Counted on the way in and forgiven on a success (`clearFailedSignIns`), rather than counted once
 * the password has been checked. The check is an `await`, and a count taken after it let every
 * attempt already in flight through: thirty sent at once from thirty addresses were thirty guesses.
 * Taken first, on the one thread, the eleventh is refused however many are waiting on a hash.
 */
export function admitSignIn(
  limiter: RateLimiter,
  attempt: { username: string; address: string },
  setRetryAfter: (seconds: number) => void,
): void {
  const decision = limiter.take(failureKey(attempt.username, attempt.address), LOGIN_FAILURE_LIMIT);
  if (decision.allowed) return;
  setRetryAfter(decision.retryAfterSeconds);
  const minutes = Math.ceil(decision.retryAfterSeconds / 60);
  throw new AppError(
    'RATE_LIMITED',
    `Too many wrong passwords for this account from here. Sign-in is paused for it for ${minutes} more minute${minutes === 1 ? '' : 's'}.`,
  );
}

/** A correct password wipes this address's slate: the misses before it were the owner's typing. */
export function clearFailedSignIns(
  limiter: RateLimiter,
  attempt: { username: string; address: string },
): void {
  limiter.forget(failureKey(attempt.username, attempt.address));
}
