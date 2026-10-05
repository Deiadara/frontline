import { AppError } from '../errors.js';
import type { RateLimiter } from './bucket.js';
import { LOGIN_FAILURE_LIMIT } from './rules.js';

/**
 * The per-account half of the sign-in limit (`LOGIN_FAILURE_LIMIT`).
 *
 * Keyed on the name as typed, folded the way the `users.username` column compares it (`COLLATE
 * NOCASE`, which folds ASCII letters and nothing else), so `Operator` and `OPERATOR` are one
 * account's misses and not two budgets. A name nobody holds is counted the same way: refusing only
 * real accounts would turn the lock into a list of which usernames exist.
 */
function failureKey(username: string): string {
  return `sign-in-failures:${username.replace(/[A-Z]/g, (letter) => letter.toLowerCase())}`;
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
  username: string,
  setRetryAfter: (seconds: number) => void,
): void {
  const decision = limiter.take(failureKey(username), LOGIN_FAILURE_LIMIT);
  if (decision.allowed) return;
  setRetryAfter(decision.retryAfterSeconds);
  const minutes = Math.ceil(decision.retryAfterSeconds / 60);
  throw new AppError(
    'RATE_LIMITED',
    `Too many wrong passwords for this account. Sign-in is paused for it for ${minutes} more minute${minutes === 1 ? '' : 's'}.`,
  );
}

/** A correct password wipes the slate: the misses before it were the owner's own typing. */
export function clearFailedSignIns(limiter: RateLimiter, username: string): void {
  limiter.forget(failureKey(username));
}
